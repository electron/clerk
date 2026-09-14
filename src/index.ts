import type { Probot, Context } from 'probot';

import {
  countNotesInPRBody,
  createPRCommentFromNotes,
  findNoteInPRBody,
  isNoNotesNote,
  updatePRBodyForNoNotes,
} from './note-utils';
import { analyzeNote, createLintCommentBody } from './note-lint';

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

// Posts or updates the single clerk-owned lint comment on a PR. The comment is
// kept (not deleted) once the note is clean so the author's edit history stays
// visible and a later regression edits the same comment instead of spawning a
// new one. Only a comment authored by clerk's own bot user counts: a human
// comment that quotes the marker must never be overwritten.
//
// Upserts are serialised per PR: two webhook deliveries for the same PR that
// arrive together (a redelivery, or a quick double edit) would otherwise both
// list the comments before either has created one, and each would then create
// its own. The second call waits for the first and so sees its comment.
const pendingUpserts = new Map<string, Promise<void>>();
const upsertLintComment = (
  context: Context<'pull_request'>,
  pr: PullRequest,
  body: string | null,
  botLogin: string,
) => {
  const { owner, repo } = context.repo();
  const key = `${owner}/${repo}#${pr.number}`;
  const previous = pendingUpserts.get(key) ?? Promise.resolve();
  const run = previous.then(() => doUpsertLintComment(context, pr, body, botLogin));
  // Track settlement only (the caller handles rejections) and drop the entry
  // once this is the last queued upsert, so the map does not grow per PR.
  const settled: Promise<void> = run.then(
    () => undefined,
    () => undefined,
  );
  const tracked: Promise<void> = settled.then(() => {
    if (pendingUpserts.get(key) === tracked) pendingUpserts.delete(key);
  });
  pendingUpserts.set(key, tracked);
  return run;
};

const doUpsertLintComment = async (
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

const submitFeedbackForPR = async (
  context: Context<'pull_request'>,
  pr: Context<'pull_request'>['payload']['pull_request'],
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

export const probotRunner = (app: Probot) => {
  app.on('pull_request', async (context) => {
    const pr = context.payload.pull_request;
    const repo = context.payload.repository.full_name;
    const botLogin = await getBotLogin(app);

    if (context.payload.action === 'closed' && pr.merged) {
      debug(`Checking release notes comment on PR ${repo}#${pr.number}`);
      await submitFeedbackForPR(context, pr, botLogin, true);
    } else if (!pr.merged && pr.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      debug(`Checking & posting release notes comment on PR ${repo}#${pr.number}`);
      await submitFeedbackForPR(context, pr, botLogin);
    }
  });
};

export default probotRunner;
