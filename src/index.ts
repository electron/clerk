import { Application, Context } from 'probot';
import * as noteUtils from './note-utils';

import d from 'debug';
const debug = d('note-utils');

const submitFeedbackForPR = async (context: Context, pr: any, shouldComment = false) => {
  const releaseNotes = noteUtils.findNoteInPRBody(pr.body);
  const github = context.github;

  if (!releaseNotes) {
    debug(`No Release Notes: posting failed check.`);
    await github.repos.createStatus(
      context.repo({
        state: 'failure' as 'failure',
        sha: pr.head.sha,
        description: 'Missing release notes',
        context: 'release-notes',
      }),
    );
  } else {
    debug(`Release Notes found: posting successful check.`);
    await github.repos.createStatus(
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

const probotRunner = (app: Application) => {
  app.on(
    ['pull_request.opened', 'pull_request.reopened', 'pull_request.synchronize'],
    async context => {
      const pr = context.payload.pull_request;

      if (context.payload.action === 'closed' && pr.merged) {
        debug(`Checking release notes comment on PR #${pr.number}`);
        await submitFeedbackForPR(context, pr, true);
      } else if (!pr.merged && pr.state === 'open') {
        // Only submit feedback for PRs that aren't merged and are open
        debug(`Checking & posting release notes comment on PR #${pr.number}`);
        await submitFeedbackForPR(context, pr);
      }
    },
  );
};

module.exports = probotRunner;
