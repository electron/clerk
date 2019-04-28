import { Toolkit } from 'actions-toolkit';
import * as noteUtils from './note-utils';

const submitFeedbackForPR = async (tools: Toolkit, pr: any, shouldComment = false) => {
  const releaseNotes = noteUtils.findNoteInPRBody(tools.context.payload.pull_request.body);
  const { owner, repo } = tools.context.repo;

  if (!releaseNotes) {
    tools.log(`No Release Notes: posting failed check.`);
    tools.exit.failure('Missing release notes.');
  } else {
    tools.log(`Release Notes found: posting successful check.`);

    if (shouldComment) {
      tools.log(`Creating comment from Release Notes.`);
      await tools.github.issues.createComment({
        owner,
        repo,
        body: noteUtils.createPRCommentFromNotes(releaseNotes),
        number: pr.number,
      });
    }

    tools.exit.success('Release notes found');
  }
};

Toolkit.run(
  async (tools: Toolkit) => {
    const { payload } = tools.context;

    if (payload.action === 'closed' && payload.pull_request.merged) {
      tools.log(`Checking release notes comment on PR #${payload.pull_request.number}`);
      await submitFeedbackForPR(tools, payload.pull_request, true);
    } else if (!payload.pull_request.merged && payload.pull_request.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      tools.log(`Checking & posting release notes comment on PR #${payload.pull_request.number}`);
      await submitFeedbackForPR(tools, payload.pull_request);
    }
  },
  {
    event: ['pull_request.opened', 'pull_request.reopened', 'pull_request.synchronize'],
  },
);
