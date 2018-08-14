import { Application, Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context'

const getReleaseNotes = (pr: WebhookPayloadWithRepository["pull_request"]) => {
  const currentPRBody = pr.body;

  const releaseNotesMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/g.exec(currentPRBody);
  if (!releaseNotesMatch) return null;

  return releaseNotesMatch[1] || null;
};

const submitFeedbackForPR = async (
  context: Context,
  pr: WebhookPayloadWithRepository["pull_request"],
  shouldComment = false
) => {
  const releaseNotes = getReleaseNotes(context.payload.pull_request);
  if (!releaseNotes) {
    await context.github.repos.createStatus(context.repo({
      state: 'failure' as 'failure',
      sha: pr.head.sha,
      target_url: 'https://github.com/electron/clerk',
      description: 'Missing release notes',
      context: 'release-notes'
    }));
  } else {
    await context.github.repos.createStatus(context.repo({
      state: 'success' as 'success',
      sha: pr.head.sha,
      description: 'Release notes found',
      context: 'release-notes'
    }));
  }

  if (shouldComment) {
    if (releaseNotes) {
      await context.github.issues.createComment(context.repo({
        number: pr.number,
        body: `**Release Notes Persisted**

> ${releaseNotes || 'No Release'}`,
      }));
    } else {
      await context.github.issues.createComment(context.repo({
        number: pr.number,
        body: `**No Release Notes**`
      }));
    }
  }
};

const probotRunner = (app: Application) => {
  app.on('pull_request', async (context) => {
    const { payload } = context;

    if (payload.action === 'closed' && payload.pull_request.merged) {
      await submitFeedbackForPR(context, context.payload.pull_request, true);
    } else if (!payload.pull_request.merged) {
      await submitFeedbackForPR(context, context.payload.pull_request);
    }
  });
};

module.exports = probotRunner;
