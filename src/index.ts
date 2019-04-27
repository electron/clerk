import { Toolkit } from 'actions-toolkit';
import * as noteUtils from './note-utils';

const submitFeedbackForPR = async (tools: Toolkit, pr: any, shouldComment = false) => {
  const releaseNotes = noteUtils.findNoteInPRBody(tools.context.payload.pull_request.body);
  const { owner, repo } = tools.context.repo;

  if (!releaseNotes) {
    await tools.github.repos.createStatus({
      owner,
      repo,
      state: 'failure' as 'failure',
      sha: pr.head.sha,
      target_url: 'https://github.com/electron/clerk/blob/master/README.md',
      description: 'Missing release notes',
      context: 'release-notes',
    });
  } else {
    await tools.github.repos.createStatus({
      owner,
      repo,
      state: 'success' as 'success',
      sha: pr.head.sha,
      description: 'Release notes found',
      context: 'release-notes',
    });
  }

  if (shouldComment) {
    await tools.github.issues.createComment({
      owner,
      repo,
      body: noteUtils.createPRCommentFromNotes(releaseNotes),
      number: pr.number,
    });
  }
};

Toolkit.run(
  async (tools: Toolkit) => {
    const { payload } = tools.context;

    if (payload.action === 'closed' && payload.pull_request.merged) {
      tools.log(`Checking release notes comment on PR #${payload.pull_request.number}`);
      await submitFeedbackForPR(tools, payload.pull_request, true);
      tools.exit.success('PR release notes status evaluated.');
    } else if (!payload.pull_request.merged && payload.pull_request.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      tools.log(`Checking & posting release notes comment on PR #${payload.pull_request.number}`);
      await submitFeedbackForPR(tools, payload.pull_request);
      tools.exit.success('PR release notes status evaluated.');
    }
  },
  {
    event: 'pull_requests',
  },
);
