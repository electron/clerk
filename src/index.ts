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

// Posts or updates the single clerk-owned lint comment on a PR. The comment is
// kept (not deleted) once the note is clean so the author's edit history stays
// visible and a later regression edits the same comment instead of spawning a
// new one.
const upsertLintComment = async (
  context: Context<'pull_request'>,
  pr: PullRequest,
  body: string | null,
) => {
  const github = context.octokit;
  const comments = await github.paginate(
    github.rest.issues.listComments,
    context.repo({ issue_number: pr.number, per_page: 100 }),
  );
  const existing = comments.find((c) => c.body?.includes(LINT_COMMENT_MARKER));

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
  shouldComment = false,
) => {
  const releaseNotes = findNoteInPRBody(pr.body);
  const github = context.octokit;
  const labels = pr.labels?.map((label) => label.name) ?? [];

  if (!shouldComment && labels.includes(OVERRIDE_LABEL)) {
    debug(`${OVERRIDE_LABEL} label present: posting successful check.`);
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
        await upsertLintComment(context, pr, createLintCommentBody(result));
        await setStatus(context, pr, 'failure', 'Release notes need style fixes (see comment)');
        return;
      }
      await upsertLintComment(context, pr, null);
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

    if (context.payload.action === 'closed' && pr.merged) {
      debug(`Checking release notes comment on PR ${repo}#${pr.number}`);
      await submitFeedbackForPR(context, pr, true);
    } else if (!pr.merged && pr.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      debug(`Checking & posting release notes comment on PR ${repo}#${pr.number}`);
      await submitFeedbackForPR(context, pr);
    }
  });
};

export default probotRunner;
