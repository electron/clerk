import { Application, Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context'

const OMIT_FROM_RELEASE_NOTES_KEY = 'no-notes';

const getReleaseNotes = (pr: WebhookPayloadWithRepository["pull_request"]) => {
  const currentPRBody = pr.body;

  const releaseNotesMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(currentPRBody);

  if (!releaseNotesMatch || !releaseNotesMatch[1]) return null;
  let note = releaseNotesMatch[1].trim();
  return note !== OMIT_FROM_RELEASE_NOTES_KEY ? note : null;
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
      target_url: 'https://github.com/electron/clerk/blob/master/how.md',
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
