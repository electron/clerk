import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import nock from 'nock';
import { Probot } from 'probot';

import { probotRunner } from '../src/index';
import * as noteUtils from '../src/note-utils';
import { SEMANTIC_BUILD_PREFIX } from '../src/constants';
import { PullRequestOpenedEvent, PullRequestClosedEvent } from '@octokit/webhooks-types';

const GH_API = 'https://api.github.com';

describe('probotRunner', () => {
  let probot: Probot;

  beforeEach(() => {
    nock.disableNetConnect();

    probot = new Probot({
      // ruby -rsecurerandom -e 'puts SecureRandom.hex(20)'
      privateKey: '9489ead8d9cb3566ba761a2c3dd278822f8d1205',
      appId: 690857,
    });

    probot.load(probotRunner);
  });

  afterEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('should post a failure status if release notes are missing', async () => {
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue(null);

    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        body: 'Fixes something broken',
        title: 'fix: something broken',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'open',
        merged: false,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
      },
    } as PullRequestOpenedEvent;

    nock(GH_API)
      .post(
        `/repos/electron/electron/statuses/${payload.pull_request.head.sha}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            context: 'release-notes',
            description: 'Missing release notes',
            state: 'failure',
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
  });

  it('should add "Notes: none" to Dependabot PR body', async () => {
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue(null);

    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        title: 'chore(deps): bump lodash from 4.17.15 to 4.17.19',
        body: 'Update lodash to the latest version',
        user: {
          login: 'dependabot[bot]',
        },
      },
    } as PullRequestOpenedEvent;

    nock(GH_API)
      .patch(
        `/repos/electron/electron/pulls/${payload.pull_request.number}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            body: 'This is a test PR\n\n---\n\nNotes: none',
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
  });

  it('should add "Notes: none" to build PR body', async () => {
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue(null);

    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        title: `${SEMANTIC_BUILD_PREFIX} Build PR`,
        body: 'Fix something to do with GitHub Actions',
        user: { login: 'codebytere' },
      },
    } as PullRequestOpenedEvent;

    nock(GH_API)
      .patch(
        `/repos/electron/electron/pulls/${payload.pull_request.number}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            body: 'This is a test PR\n\n---\n\nNotes: none',
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
  });

  it('should post a success status if release notes are found', async () => {
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue('Notes: added a new feature');

    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        body: 'Notes: Added a new feature',
        title: 'feat: add new exciting feature',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'open',
        merged: false,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
      },
    } as PullRequestOpenedEvent;

    nock(GH_API)
      .post(
        `/repos/electron/electron/statuses/${payload.pull_request.head.sha}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            context: 'release-notes',
            description: 'Release notes found',
            state: 'success',
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
  });

  it('should create a comment if release notes are found and shouldComment is true', async () => {
    const releaseNotesComment = 'Comment from release notes';
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue('Added a new feature');
    vi.spyOn(noteUtils, 'createPRCommentFromNotes').mockReturnValue(releaseNotesComment);

    const payload = {
      action: 'closed',
      pull_request: {
        number: 1,
        body: 'Notes: Added a new feature',
        title: 'feat: add new exciting feature',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'closed',
        merged: true,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
      },
    } as PullRequestClosedEvent;

    nock(GH_API)
      .post(
        `/repos/electron/electron/statuses/${payload.pull_request.head.sha}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            context: 'release-notes',
            description: 'Release notes found',
            state: 'success',
          });
          return true;
        },
      )
      .reply(200);

    nock(GH_API)
      .post(
        `/repos/electron/electron/issues/${payload.pull_request.number}/comments`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            body: releaseNotesComment,
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
  });
});
