import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import nock from 'nock';
import { type Context, Probot } from 'probot';

import { probotRunner } from '../src/index';
import * as noteUtils from '../src/note-utils';
import {
  LINT_COMMENT_MARKER,
  LINT_COMMENT_RESOLVED,
  OVERRIDE_LABEL,
  SEMANTIC_BUILD_PREFIX,
} from '../src/constants';

type PullRequestOpenedEvent = Context<'pull_request.opened'>['payload'];
type PullRequestClosedEvent = Context<'pull_request.closed'>['payload'];

const GH_API = 'https://api.github.com';
const COMMENTS_PATH = '/repos/electron/electron/issues/1/comments';

const expectStatus = (
  payload: { pull_request: { head: { sha: string } } },
  state: 'success' | 'failure',
  description: string,
) =>
  nock(GH_API)
    .post(
      `/repos/electron/electron/statuses/${payload.pull_request.head.sha}`,
      (body: Record<string, string>) => {
        expect(body).toMatchObject({ context: 'release-notes', description, state });
        return true;
      },
    )
    .reply(200);

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
    vi.restoreAllMocks();
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
        full_name: 'electron/electron',
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

  it('should post a failure status if there are multiple Notes: lines', async () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        body: 'Fixes something broken\n\nNotes: Fixed one thing.\nNotes: Fixed another thing.\n',
        title: 'fix: something broken',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'open',
        merged: false,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
        full_name: 'electron/electron',
      },
    } as PullRequestOpenedEvent;

    nock(GH_API)
      .post(
        `/repos/electron/electron/statuses/${payload.pull_request.head.sha}`,
        (body: Record<string, string>) => {
          expect(body).toMatchObject({
            context: 'release-notes',
            description: 'Multiple Notes: lines; use one Notes: with a bulleted list',
            state: 'failure',
          });
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
    expect(nock.isDone()).toBe(true);
  });

  it('should still comment with the first note at merge time if there are multiple Notes: lines', async () => {
    const payload = {
      action: 'closed',
      pull_request: {
        number: 1,
        body: 'Fixes something broken\n\nNotes: Fixed one thing.\nNotes: Fixed another thing.\n',
        title: 'fix: something broken',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'closed',
        merged: true,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
        full_name: 'electron/electron',
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
          expect(body.body).toContain('Fixed one thing.');
          expect(body.body).not.toContain('Fixed another thing.');
          return true;
        },
      )
      .reply(200);

    await probot.receive({ id: '123', name: 'pull_request', payload });
    expect(nock.isDone()).toBe(true);
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
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
        full_name: 'electron/electron',
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
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
        full_name: 'electron/electron',
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
    vi.spyOn(noteUtils, 'findNoteInPRBody').mockReturnValue('Added a new feature.');

    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        body: 'Notes: Added a new feature.',
        title: 'feat: add new exciting feature',
        user: { login: 'codebytere' },
        head: { sha: 'abc123' },
        state: 'open',
        merged: false,
      },
      repository: {
        name: 'electron',
        owner: { login: 'electron' },
        full_name: 'electron/electron',
      },
    } as PullRequestOpenedEvent;

    nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
    expectStatus(payload, 'success', 'Release notes found');

    await probot.receive({ id: '123', name: 'pull_request', payload });
    expect(nock.isDone()).toBe(true);
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
        full_name: 'electron/electron',
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

  describe('release note style lint', () => {
    const openPR = (overrides: Record<string, unknown> = {}) =>
      ({
        action: 'edited',
        pull_request: {
          number: 1,
          body: 'Fixes something broken\n\nNotes: fix crash for Notification close\n',
          title: 'fix: something broken',
          user: { login: 'codebytere', type: 'User' },
          labels: [],
          head: { sha: 'abc123' },
          state: 'open',
          merged: false,
          ...overrides,
        },
        repository: {
          name: 'electron',
          owner: { login: 'electron' },
          full_name: 'electron/electron',
        },
      }) as PullRequestOpenedEvent;

    it('posts a lint comment and a failure status when the note has style findings', async () => {
      const payload = openPR();

      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain(LINT_COMMENT_MARKER);
          expect(body.body).toContain('Use the past tense: "Fixed" instead of "fix".');
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('updates the existing lint comment instead of creating a new one', async () => {
      const payload = openPR();

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [
          { id: 7, body: 'unrelated comment' },
          { id: 8, body: `${LINT_COMMENT_MARKER}\nstale findings` },
        ]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toContain(LINT_COMMENT_MARKER);
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(200);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('marks the lint comment resolved once the note is clean', async () => {
      const payload = openPR({ body: 'Notes: Fixed a crash for Notification close.\n' });

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [{ id: 8, body: `${LINT_COMMENT_MARKER}\nstale findings` }]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toEqual(`${LINT_COMMENT_MARKER}\n${LINT_COMMENT_RESOLVED}`);
          return true;
        })
        .reply(200);
      expectStatus(payload, 'success', 'Release notes found');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not lint Notes: none', async () => {
      const payload = openPR({ body: 'Notes: none\n' });
      expectStatus(payload, 'success', 'Release notes found');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('skips lint for bot authors', async () => {
      const payload = openPR({ user: { login: 'trop[bot]', type: 'Bot' } });
      expectStatus(payload, 'success', 'Release notes found');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('skips lint for backports', async () => {
      const payload = openPR({
        body: 'Backport of #12345\n\nNotes: fix crash for Notification close\n',
      });
      expectStatus(payload, 'success', 'Release notes found');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('forces success with the override label despite findings, without commenting', async () => {
      const payload = openPR({ labels: [{ name: OVERRIDE_LABEL }] });
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('forces success with the override label when notes are missing', async () => {
      const payload = openPR({
        body: 'Fixes something broken',
        labels: [{ name: OVERRIDE_LABEL }],
      });
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not lint or override at merge time', async () => {
      const payload = {
        ...openPR({ state: 'closed', merged: true, labels: [{ name: OVERRIDE_LABEL }] }),
        action: 'closed',
      } as unknown as PullRequestClosedEvent;

      expectStatus(payload, 'success', 'Release notes found');
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain('> fix crash for Notification close');
          return true;
        })
        .reply(201);

      await probot.receive({ id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });
  });
});
