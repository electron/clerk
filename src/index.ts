import { Application, Context } from 'probot';
import { WebhookPayloadWithRepository } from 'probot/lib/context';

const OMIT_FROM_RELEASE_NOTES_KEYS = [
  'no-notes',
  'no notes',
  'no_notes',
  'none',
  'no',
  'nothing',
  'empty',
  'blank',
];

const getReleaseNotes = (pr: WebhookPayloadWithRepository['pull_request']) => {
  const currentPRBody = pr.body;

  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(currentPRBody);
  const multilineMatch =
      /(?:(?:\r?\n)Notes:(?:\r?\n)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(currentPRBody);

  let notes: string | null = null;
  if (onelineMatch && onelineMatch[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch && multilineMatch[1]) {
    notes = multilineMatch[1];
  }

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
