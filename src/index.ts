import type { Probot, Context } from 'probot';

import {
  countNotesInPRBody,
  createPRCommentFromNotes,
  findNoteInPRBody,
  isNoNotesNote,
  updatePRBodyForNoNotes,
} from './note-utils';
import { analyzeNote, createLintCommentBody, exceedsNoteLength } from './note-lint';
import {
  createReviewClient,
  createReviewCommentBody,
  REVIEW_STATUS_DESCRIPTION,
  reviewNote,
  type ReviewClient,
} from './note-review';

import d from 'debug';
import {
  LINT_COMMENT_MARKER,
  LINT_COMMENT_RESOLVED,
  LINTED_BOT_LOGINS,
  OVERRIDE_LABEL,
  SEMANTIC_BUILD_PREFIX,
} from './constants';
const debug = d('note-utils');

type PullRequest = Context<'pull_request'>['payload']['pull_request'];

const setStatus = (
  context: Context<'pull_request'>,
  pr: PullRequest,
  state: 'success' | 'failure',
  description: string,
) =>
  context.octokit.rest.repos.createCommitStatus(
    context.repo({ state, sha: pr.head.sha, description, context: 'release-notes' }),
  );

// Style findings are skipped for bot-authored PRs (except those in
// LINTED_BOT_LOGINS) and for trop backports, which copy the original PR's note
// verbatim.
const shouldLintNote = (pr: PullRequest, note: string) =>
  (pr.user.type !== 'Bot' || LINTED_BOT_LOGINS.includes(pr.user.login)) &&
  !/Backport of #/.test(pr.body ?? '') &&
  !isNoNotesNote(note);

// Login of the app's own bot user, e.g. `release-clerk[bot]`. Resolved once
// from the app's slug; the constant is the fallback when that lookup is not
// possible (tests, mocks, or a transient API failure).
const DEFAULT_BOT_LOGIN = 'release-clerk[bot]';
let botLogin: Promise<string> | undefined;
const getBotLogin = (app: Probot) => {
  botLogin ??= (async () => {
    try {
      // GET /app only accepts the app JWT, not an installation token, so it
      // cannot go through context.octokit.
      const octokit = await app.auth();
      const { data } = await octokit.rest.apps.getAuthenticated();
      if (data?.slug) return `${data.slug}[bot]`;
    } catch (err) {
      debug(`Could not resolve the app's bot login, using ${DEFAULT_BOT_LOGIN}: ${err}`);
    }
    botLogin = undefined; // retry on the next event
    return DEFAULT_BOT_LOGIN;
  })();
  return botLogin;
};

// Feedback for one PR is serialised: two webhook deliveries for the same PR
// that arrive together (a redelivery, a quick double edit, or a push while an
// earlier event still waits on the Claude review) would otherwise interleave
// their reads and writes. Both could list the comments before either has
// created one and each would create its own; or the newer push's failing
// comment could be posted first and then marked resolved by the older, slower
// event. The second call waits for the first to finish entirely.
const pendingFeedback = new Map<string, Promise<void>>();
const serializePerPR = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = pendingFeedback.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  // Track settlement only (the caller handles rejections) and drop the entry
  // once this is the last queued task, so the map does not grow per PR.
  const settled: Promise<void> = run.then(
    () => undefined,
    () => undefined,
  );
  const tracked: Promise<void> = settled.then(() => {
    if (pendingFeedback.get(key) === tracked) pendingFeedback.delete(key);
  });
  pendingFeedback.set(key, tracked);
  return run;
};

// Posts or updates the single clerk-owned lint comment on a PR. The comment is
// kept (not deleted) once the note is clean so the author's edit history stays
// visible and a later regression edits the same comment instead of spawning a
// new one. Only a comment authored by clerk's own bot user counts: a human
// comment that quotes the marker must never be overwritten. Callers run inside
// serializePerPR, which is what keeps the list-then-create from racing.
const upsertLintComment = async (
  context: Context<'pull_request'>,
  pr: PullRequest,
  body: string | null,
  botLogin: string,
) => {
  const github = context.octokit;
  const comments = await github.paginate(
    github.rest.issues.listComments,
    context.repo({ issue_number: pr.number, per_page: 100 }),
  );
  const existing = comments.find(
    (c) =>
      c.user?.type === 'Bot' && c.user.login === botLogin && c.body?.includes(LINT_COMMENT_MARKER),
  );

  if (existing) {
    const nextBody = body ?? `${LINT_COMMENT_MARKER}\n${LINT_COMMENT_RESOLVED}`;
    if (existing.body !== nextBody) {
      debug(`Updating release note lint comment ${existing.id}`);
      await github.rest.issues.updateComment(
        context.repo({ comment_id: existing.id, body: nextBody }),
      );
    }
  } else if (body) {
    debug('Creating release note lint comment');
    await github.rest.issues.createComment(context.repo({ issue_number: pr.number, body }));
  }
};

// The Claude review can take minutes. A push or description edit in that time
// makes the event's snapshot of the PR stale, and the event for that change
// posts its own result; writing from the stale snapshot could resolve the newer
// event's failing comment or set a status for the wrong head. A PR closed or
// merged in that time gets no write either.
const isPRUnchanged = async (context: Context<'pull_request'>, pr: PullRequest) => {
  const { data } = await context.octokit.rest.pulls.get(context.repo({ pull_number: pr.number }));
  return (
    data.state === 'open' &&
    !data.merged &&
    data.head.sha === pr.head.sha &&
    (data.body ?? '') === (pr.body ?? '')
  );
};

// The newest event seen for each PR. An event queued behind a slow review
// skips its own review once a newer event for the same PR has arrived; the
// newer event does the work.
const latestEvent = new Map<string, number>();

const submitFeedbackForPR = async (
  context: Context<'pull_request'>,
  pr: Context<'pull_request'>['payload']['pull_request'],
  reviewClient: ReviewClient | null,
  botLogin: string,
  shouldComment = false,
  isSuperseded = () => false,
) => {
  const releaseNotes = findNoteInPRBody(pr.body);
  const github = context.octokit;
  const labels = pr.labels?.map((label) => label.name) ?? [];

  if (!shouldComment && labels.includes(OVERRIDE_LABEL)) {
    debug(`${OVERRIDE_LABEL} label present: posting successful check.`);
    // A failing lint comment from before the label was added would contradict
    // the green check, so mark it resolved.
    await upsertLintComment(context, pr, null, botLogin);
    await setStatus(context, pr, 'success', 'Release notes check overridden by label');
    return;
  }

  // Only guard against repeated Notes: blocks while the PR is still open. At
  // merge time (shouldComment) the author can no longer fix the body, so keep
  // persisting the first note rather than leaving no comment at all.
  if (!shouldComment && countNotesInPRBody(pr.body) > 1) {
    debug(`Multiple Notes: lines found: posting failed check.`);
    await github.rest.repos.createCommitStatus(
      context.repo({
        state: 'failure' as 'failure',
        sha: pr.head.sha,
        description: 'Multiple Notes: lines; use one Notes: with a bulleted list',
        context: 'release-notes',
      }),
    );
    return;
  }

  if (!releaseNotes) {
    if (pr.user.login === 'dependabot[bot]') {
      debug(`Adding 'Notes: none' to Dependabot PR body`);
      await github.rest.pulls.update(
        context.repo({
          pull_number: pr.number,
          body: updatePRBodyForNoNotes(pr.body),
        }),
      );
      return;
    }

    if (pr.title.startsWith(SEMANTIC_BUILD_PREFIX)) {
      debug("Adding 'Notes: none' to build: PR body");
      await github.rest.pulls.update(
        context.repo({
          pull_number: pr.number,
          body: updatePRBodyForNoNotes(pr.body),
        }),
      );
      return;
    }

    debug(`No Release Notes: posting failed check.`);
    await github.rest.repos.createCommitStatus(
      context.repo({
        state: 'failure' as 'failure',
        sha: pr.head.sha,
        description: 'Missing release notes',
        context: 'release-notes',
      }),
    );
  } else {
    if (!shouldComment && shouldLintNote(pr, releaseNotes)) {
      const result = analyzeNote(releaseNotes, { labels, title: pr.title });
      if (result.findings.length > 0) {
        // A note over the length limit has no mechanical fix, so ask Claude
        // for a shorter one to show with the findings. The check still fails.
        if (isSuperseded()) {
          debug(`A newer event for this PR is queued: leaving the write to it.`);
          return;
        }
        const review =
          reviewClient && exceedsNoteLength(result.fixed ?? releaseNotes)
            ? await reviewNote(
                { note: result.fixed ?? releaseNotes, title: pr.title, labels },
                reviewClient,
              )
            : null;
        if (review && !(await isPRUnchanged(context, pr))) {
          debug(`PR changed during the Claude review: leaving the write to the newer event.`);
          return;
        }
        const rewrite =
          review?.verdict === 'suggest'
            ? { suggestion: review.suggestion ?? '', reasons: review.reasons }
            : undefined;
        debug(`Release Notes need style fixes: posting failed check.`);
        await upsertLintComment(context, pr, createLintCommentBody(result, rewrite), botLogin);
        await setStatus(context, pr, 'failure', 'Release notes need style fixes (see comment)');
        return;
      }

      // The style rules pass; optionally ask Claude whether the note tells app
      // developers what changed. Advisory only: the status stays green.
      if (isSuperseded()) {
        debug(`A newer event for this PR is queued: leaving the write to it.`);
        return;
      }
      const review = reviewClient
        ? await reviewNote({ note: releaseNotes, title: pr.title, labels }, reviewClient)
        : null;
      if (reviewClient && !(await isPRUnchanged(context, pr))) {
        debug(`PR changed during the Claude review: leaving the write to the newer event.`);
        return;
      }
      if (review && review.verdict !== 'ok') {
        debug(`Claude suggested a release note rewrite: posting advisory comment.`);
        await upsertLintComment(context, pr, createReviewCommentBody(review), botLogin);
        await setStatus(context, pr, 'success', REVIEW_STATUS_DESCRIPTION);
        return;
      }
      await upsertLintComment(context, pr, null, botLogin);
    } else if (!shouldComment) {
      // The note is no longer linted (`Notes: none`, bot author or backport);
      // resolve any comment left behind by an earlier failing run.
      await upsertLintComment(context, pr, null, botLogin);
    }

    debug(`Release Notes found: posting successful check.`);
    await setStatus(context, pr, 'success', 'Release notes found');

    if (shouldComment) {
      debug(`Creating comment from Release Notes.`);
      await github.rest.issues.createComment(
        context.repo({
          body: createPRCommentFromNotes(releaseNotes),
          issue_number: pr.number,
        }),
      );
    }
  }
};

// Resolves once every queued feedback task has finished. Feedback for open PRs
// runs after the webhook handler returns (see below), so tests await this.
export const settleFeedback = async () => {
  while (pendingFeedback.size > 0) await Promise.all(pendingFeedback.values());
};

// The Claude client is injected so tests can substitute a mock; the default
// runner builds the real one once, at load, only when ANTHROPIC_API_KEY is set.
export const createProbotRunner = (reviewClient: ReviewClient | null) => (app: Probot) => {
  app.on('pull_request', async (context) => {
    const pr = context.payload.pull_request;
    const repo = context.payload.repository.full_name;
    const botLogin = await getBotLogin(app);

    if (context.payload.action === 'closed' && pr.merged) {
      debug(`Checking release notes comment on PR ${repo}#${pr.number}`);
      await submitFeedbackForPR(context, pr, reviewClient, botLogin, true);
    } else if (!pr.merged && pr.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open. The
      // Claude review can take minutes, far longer than GitHub waits for a
      // webhook response, so the feedback runs after the handler returns and
      // the delivery is acknowledged straight away.
      debug(`Checking & posting release notes comment on PR ${repo}#${pr.number}`);
      const key = `${repo}#${pr.number}`;
      const seq = (latestEvent.get(key) ?? 0) + 1;
      latestEvent.set(key, seq);
      serializePerPR(key, () =>
        submitFeedbackForPR(
          context,
          pr,
          reviewClient,
          botLogin,
          false,
          () => latestEvent.get(key) !== seq,
        ),
      )
        .catch((err) => {
          context.log.error({ err }, `Release notes feedback failed for ${repo}#${pr.number}`);
        })
        .finally(() => {
          if (latestEvent.get(key) === seq) latestEvent.delete(key);
        });
    }
  });
};

export const probotRunner = createProbotRunner(createReviewClient());

export default probotRunner;
