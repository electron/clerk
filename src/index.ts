import { Application, Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context';

const OMIT_FROM_RELEASE_NOTES_KEYS = [
  'no-notes',
  'no notes',
  'no_notes',
];

const getReleaseNotes = (pr: WebhookPayloadWithRepository['pull_request']) => {
  const currentPRBody = pr.body;

  const notesMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(currentPRBody);
  const notes = notesMatch && notesMatch[1] ? notesMatch[1] : null;

  // check that they didn't leave the default PR template
  if (notes === '<!-- One-line Change Summary Here-->') {
    return null;
  }
  return notes;
};

const submitFeedbackForPR = async (
  context: Context,
  pr: WebhookPayloadWithRepository['pull_request'],
  shouldComment = false,
) => {
  const releaseNotes = getReleaseNotes(context.payload.pull_request);
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
    if (releaseNotes && (OMIT_FROM_RELEASE_NOTES_KEYS.indexOf(releaseNotes) === -1)) {
      await context.github.issues.createComment(context.repo({
        number: pr.number,
        body: `**Release Notes Persisted**

> ${releaseNotes || 'No Release'}`,
      }));
    } else {
      await context.github.issues.createComment(context.repo({
        number: pr.number,
        body: `**No Release Notes**`,
      }));
    }
  }
};

const probotRunner = (app: Application) => {
  app.on('pull_request', async (context) => {
    // Only respond to events from electron/electron
    if (context.payload.repository.owner.name !== 'electron'
        || context.payload.repository.name !== 'electron') return;

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
