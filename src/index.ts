import type { Probot, Context } from 'probot';

import { createPRCommentFromNotes, findNoteInPRBody, updatePRBodyForNoNotes } from './note-utils';

import d from 'debug';
import { SEMANTIC_BUILD_PREFIX } from './constants';
const debug = d('note-utils');

const submitFeedbackForPR = async (
  context: Context<'pull_request'>,
  pr: Context<'pull_request'>['payload']['pull_request'],
  shouldComment = false,
) => {
  const releaseNotes = findNoteInPRBody(pr.body);
  const github = context.octokit;

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
    debug(`Release Notes found: posting successful check.`);
    await github.rest.repos.createCommitStatus(
      context.repo({
        state: 'success' as 'success',
        sha: pr.head.sha,
        description: 'Release notes found',
        context: 'release-notes',
      }),
    );

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
