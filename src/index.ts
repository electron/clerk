import { PullRequest } from '@octokit/webhooks-types/schema';
import { Probot, Context } from 'probot';

import * as noteUtils from './note-utils';

import d from 'debug';
import { SEMANTIC_BUILD_PREFIX } from './constants';
const debug = d('note-utils');

const submitFeedbackForPR = async (
  context: Context<'pull_request'>,
  pr: PullRequest,
  shouldComment = false,
) => {
  const releaseNotes = pr.body && noteUtils.findNoteInPRBody(pr.body);
  const github = context.octokit;

  if (!releaseNotes) {
    if (pr.user.login === 'dependabot[bot]') {
      debug(`Adding 'Notes: none' to Dependabot PR body`);
      await github.pulls.update(
        context.repo({
          pull_number: pr.number,
          body: pr.body + '\n\n---\n\nNotes: none',
        }),
      );
      return;
    }

    if (pr.title.startsWith(SEMANTIC_BUILD_PREFIX)) {
      debug("Adding 'Notes: none' to build: PR body");
      await github.pulls.update(
        context.repo({
          pull_number: pr.number,
          body: pr.body + '\n\n---\n\nNotes: none',
        }),
      );
      return;
    }

    debug(`No Release Notes: posting failed check.`);
    await github.repos.createCommitStatus(
      context.repo({
        state: 'failure' as 'failure',
        sha: pr.head.sha,
        description: 'Missing release notes',
        context: 'release-notes',
      }),
    );
  } else {
    debug(`Release Notes found: posting successful check.`);
    await github.repos.createCommitStatus(
      context.repo({
        state: 'success' as 'success',
        sha: pr.head.sha,
        description: 'Release notes found',
        context: 'release-notes',
      }),
    );

    if (shouldComment) {
      debug(`Creating comment from Release Notes.`);
      await github.issues.createComment(
        context.repo({
          body: noteUtils.createPRCommentFromNotes(releaseNotes),
          issue_number: pr.number,
        }),
      );
    }
  }
};

export const probotRunner = (app: Probot) => {
  app.on('pull_request', async (context) => {
    const pr = context.payload.pull_request;

    if (context.payload.action === 'closed' && pr.merged) {
      debug(`Checking release notes comment on PR #${pr.number}`);
      await submitFeedbackForPR(context, pr, true);
    } else if (!pr.merged && pr.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      debug(`Checking & posting release notes comment on PR #${pr.number}`);
      await submitFeedbackForPR(context, pr);
    }
  });
};

export default probotRunner;
