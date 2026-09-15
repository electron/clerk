import type { Probot, Context } from 'probot';

import {
  countNotesInPRBody,
  createPRCommentFromNotes,
  findNoteInPRBody,
  isNoNotesNote,
  updatePRBodyForNoNotes,
} from './note-utils';
import { analyzeNote, createLintCommentBody } from './note-lint';
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

// Style findings are skipped for bot-authored PRs and for trop backports,
// which copy the original PR's note verbatim.
const shouldLintNote = (pr: PullRequest, note: string) =>
  pr.user.type !== 'Bot' && !/Backport of #/.test(pr.body ?? '') && !isNoNotesNote(note);

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
// that arrive together (a redelivery, or a quick double edit) would otherwise
// interleave their reads and writes: both could list the comments before
// either has created one, and each would create its own. The second call
// waits for the first to finish. Only fast work is queued (the deterministic
// checks and the GitHub writes); the Claude review runs outside the queue, see
// reviewInBackground, so a webhook response never waits on it.
const feedbackKey = (context: Context<'pull_request'>) =>
  `${context.payload.repository.full_name}#${context.payload.pull_request.number}`;
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

// Claude reviews still running, per PR. An event that reaches the queue marks
// the reviews started by earlier events for the same PR superseded, and a
// superseded review drops its result unwritten: the latest event wins, and a
// burst of pushes never piles up writes behind their reviews.
const reviewsInFlight = new Map<string, Set<{ superseded: boolean }>>();
const supersedeReviews = (key: string) =>
  reviewsInFlight.get(key)?.forEach((review) => (review.superseded = true));

// Work that outlives the webhook response. Errors are logged, never left
// unhandled; waitForIdle lets tests await the writes that follow a review.
const detached = new Set<Promise<void>>();
const detach = (context: Context<'pull_request'>, work: Promise<void>) => {
  const tracked: Promise<void> = work
    .catch((err) => context.log.error(err, 'Release note review failed'))
    .then(() => {
      detached.delete(tracked);
    });
  detached.add(tracked);
};
export const waitForIdle = async () => {
  while (detached.size > 0) await Promise.all(detached);
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

// The Claude review can take seconds. A push or description edit in that time
// makes the event's snapshot of the PR stale, and the event for that change
// posts its own result; writing from the stale snapshot could resolve the newer
// event's failing comment or set a status for the wrong head. A merge or close
// leaves the head and body alone, so the state is checked as well.
const isPRUnchanged = async (context: Context<'pull_request'>, pr: PullRequest) => {
  const { data } = await context.octokit.rest.pulls.get(context.repo({ pull_number: pr.number }));
  return (
    data.state === 'open' && data.head.sha === pr.head.sha && (data.body ?? '') === (pr.body ?? '')
  );
};

// Asks Claude about a note that passed the style rules and, once it answers,
// posts the comment and status for the event. The webhook handler does not
// await this; the write goes back through the per-PR queue and is skipped when
// a newer event has arrived or the PR moved on in the meantime.
const reviewInBackground = async (
  context: Context<'pull_request'>,
  pr: PullRequest,
  note: string,
  labels: string[],
  reviewClient: ReviewClient,
  botLogin: string,
) => {
  const key = feedbackKey(context);
  const handle = { superseded: false };
  const inFlight = reviewsInFlight.get(key) ?? new Set<{ superseded: boolean }>();
  inFlight.add(handle);
  reviewsInFlight.set(key, inFlight);
  try {
    const review = await reviewNote({ note, title: pr.title, labels }, reviewClient);
    await serializePerPR(key, async () => {
      if (handle.superseded) {
        debug(`A newer event arrived during the Claude review: leaving the write to it.`);
        return;
      }
      if (!(await isPRUnchanged(context, pr))) {
        debug(`PR changed during the Claude review: leaving the write to the newer event.`);
        return;
      }
      if (review.verdict === 'suggest') {
        debug(`Claude suggested a release note rewrite: posting advisory comment.`);
        await upsertLintComment(context, pr, createReviewCommentBody(review), botLogin);
        await setStatus(context, pr, 'success', REVIEW_STATUS_DESCRIPTION);
        return;
      }
      await upsertLintComment(context, pr, null, botLogin);
      debug(`Release Notes found: posting successful check.`);
      await setStatus(context, pr, 'success', 'Release notes found');
    });
  } finally {
    inFlight.delete(handle);
    if (inFlight.size === 0 && reviewsInFlight.get(key) === inFlight) reviewsInFlight.delete(key);
  }
};

const submitFeedbackForPR = async (
  context: Context<'pull_request'>,
  pr: Context<'pull_request'>['payload']['pull_request'],
  reviewClient: ReviewClient | null,
  botLogin: string,
  shouldComment = false,
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
        debug(`Release Notes need style fixes: posting failed check.`);
        await upsertLintComment(context, pr, createLintCommentBody(result), botLogin);
        await setStatus(context, pr, 'failure', 'Release notes need style fixes (see comment)');
        return;
      }

      // The style rules pass; optionally ask Claude whether the note tells app
      // developers what changed. Advisory only: the status stays green. The
      // review takes seconds, so it runs off the webhook response and posts
      // the comment and status itself when it returns.
      if (reviewClient) {
        detach(
          context,
          reviewInBackground(context, pr, releaseNotes, labels, reviewClient, botLogin),
        );
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
      // Only submit feedback for PRs that aren't merged and are open
      debug(`Checking & posting release notes comment on PR ${repo}#${pr.number}`);
      const key = feedbackKey(context);
      await serializePerPR(key, () => {
        // Whatever an earlier event is still asking Claude about is now stale.
        supersedeReviews(key);
        return submitFeedbackForPR(context, pr, reviewClient, botLogin);
      });
    }
  });
};

export const probotRunner = createProbotRunner(createReviewClient());

export default probotRunner;
