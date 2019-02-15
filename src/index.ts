import { Application, Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context';
import * as noteUtils from './note-utils';
import { getTargetVersionsForPr } from './pr';

const submitFeedbackForPR = async (
  context: Context,
  pr: WebhookPayloadWithRepository['pull_request'],
  shouldComment = false,
) => {
  const releaseNotes = noteUtils.findNoteInPRBody(context.payload.pull_request.body);
  if (!releaseNotes) {
    await context.github.repos.createStatus(context.repo({
      state: 'failure' as 'failure',
      sha: pr.head.sha,
      target_url: 'https://github.com/electron/clerk/blob/master/README.md',
      description: 'Missing release notes',
      context: 'release-notes',
    }));
  } else {
    await context.github.repos.createStatus(context.repo({
      state: 'success' as 'success',
      sha: pr.head.sha,
      description: 'Release notes found',
      context: 'release-notes',
    }));
  }

  if (shouldComment) {
    const targetVersions = await getTargetVersionsForPr(context, pr);
    await context.github.issues.createComment(context.repo({
      body: noteUtils.createPRCommentFromNotes(releaseNotes, targetVersions),
      number: pr.number,
    }));
  }
};

const probotRunner = (app: Application) => {
  app.on('pull_request', async (context) => {
    // Only respond to events from electron/electron
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    if (owner !== 'electron' || repo !== 'electron') {
      console.log(`Not responding to event from: ${owner}/${repo}`);
      return;
    }

    const { payload } = context;

    if (payload.action === 'closed' && payload.pull_request.merged) {
      await submitFeedbackForPR(context, context.payload.pull_request, true);
    } else if (!payload.pull_request.merged && payload.pull_request.state === 'open') {
      // Only submit feedback for PRs that aren't merged and are open
      await submitFeedbackForPR(context, context.payload.pull_request);
    }
  });
};

module.exports = probotRunner;
