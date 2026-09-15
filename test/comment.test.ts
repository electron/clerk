import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import nock from 'nock';
import { type Context, Probot } from 'probot';

import { createProbotRunner, probotRunner, settleFeedback } from '../src/index';
import {
  clearReviewCache,
  JUDGE_MODEL,
  REVIEW_CANDIDATES,
  REVIEW_STATUS_DESCRIPTION,
  type ReviewClient,
  type ReviewMessage,
  type ReviewResult,
} from '../src/note-review';
import * as noteUtils from '../src/note-utils';
import {
  LINT_COMMENT_MARKER,
  LINT_COMMENT_RESOLVED,
  NO_NOTES_BODY,
  OVERRIDE_LABEL,
  SEMANTIC_BUILD_PREFIX,
} from '../src/constants';

type PullRequestOpenedEvent = Context<'pull_request.opened'>['payload'];
type PullRequestClosedEvent = Context<'pull_request.closed'>['payload'];

// Feedback for open PRs runs after the webhook is acknowledged, so a test
// delivery waits for that background work too.
const deliver = async (probot: Probot, event: Parameters<Probot['receive']>[0]) => {
  await probot.receive(event);
  await settleFeedback();
};

const GH_API = 'https://api.github.com';
const COMMENTS_PATH = '/repos/electron/electron/issues/1/comments';
const PULL_PATH = '/repos/electron/electron/pulls/1';

const noExistingComments = () => nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);

const BOT_USER = { login: 'release-clerk[bot]', type: 'Bot' };
const HUMAN_USER = { login: 'codebytere', type: 'User' };
const botLintComment = (id: number) => ({
  id,
  body: `${LINT_COMMENT_MARKER}\nstale findings`,
  user: BOT_USER,
});

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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

    await deliver(probot, { id: '123', name: 'pull_request', payload });
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

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('updates the existing lint comment instead of creating a new one', async () => {
      const payload = openPR();

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [{ id: 7, body: 'unrelated comment', user: HUMAN_USER }, botLintComment(8)]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toContain(LINT_COMMENT_MARKER);
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(200);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not edit a human comment that quotes the marker', async () => {
      const payload = openPR();

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [
          { id: 7, body: `Quoting clerk: ${LINT_COMMENT_MARKER}`, user: HUMAN_USER },
          {
            id: 9,
            body: `${LINT_COMMENT_MARKER}\nfrom another bot`,
            user: { login: 'other[bot]', type: 'Bot' },
          },
        ]);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain(LINT_COMMENT_MARKER);
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('updates only the comment authored by the bot when a human also quotes the marker', async () => {
      const payload = openPR();

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [
          { id: 7, body: `Quoting clerk: ${LINT_COMMENT_MARKER}`, user: HUMAN_USER },
          botLintComment(8),
        ]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(200);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('marks the lint comment resolved once the note is clean', async () => {
      const payload = openPR({ body: 'Notes: Fixed a crash for Notification close.\n' });

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [botLintComment(8)]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toEqual(`${LINT_COMMENT_MARKER}\n${LINT_COMMENT_RESOLVED}`);
          return true;
        })
        .reply(200);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not lint Notes: none', async () => {
      const payload = openPR({ body: 'Notes: none\n' });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not lint a bulleted none', async () => {
      for (const body of ['Notes:\n* none\n', 'Notes: - No notes\n']) {
        const payload = openPR({ body });
        noExistingComments();
        expectStatus(payload, 'success', 'Release notes found');

        await deliver(probot, { id: '123', name: 'pull_request', payload });
        expect(nock.isDone(), body).toBe(true);
      }
    });

    it('still lints a bulleted note with a real item next to none', async () => {
      const payload = openPR({ body: 'Notes:\n* fix crash on close\n* none\n' });
      noExistingComments();
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain('Bullet 1: Use the past tense');
          expect(body.body).toContain('Notes:\n* Fixed a crash on close.\n* None.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('posts No Release Notes at merge time for a bulleted none', async () => {
      const payload = {
        ...openPR({ body: 'Notes:\n* none\n', state: 'closed', merged: true }),
        action: 'closed',
      } as unknown as PullRequestClosedEvent;

      expectStatus(payload, 'success', 'Release notes found');
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toEqual(NO_NOTES_BODY);
          return true;
        })
        .reply(201);

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('creates a single lint comment when two deliveries for one PR race', async () => {
      const payload = openPR();
      let created: string | undefined;

      // The first delivery sees no comment and creates one; the second must
      // wait for it, see the created comment and leave it alone.
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(created).toBeUndefined();
          created = body.body;
          return true;
        })
        .reply(201);
      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, () => {
          expect(created).toBeDefined();
          return [{ id: 8, body: created, user: BOT_USER }];
        });
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await Promise.all([
        deliver(probot, { id: '123', name: 'pull_request', payload }),
        deliver(probot, { id: '124', name: 'pull_request', payload }),
      ]);
      expect(nock.isDone()).toBe(true);
    });

    it('skips lint for bot authors', async () => {
      const payload = openPR({ user: { login: 'trop[bot]', type: 'Bot' } });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('lints notes from claude[bot]', async () => {
      const payload = openPR({ user: { login: 'claude[bot]', type: 'Bot' } });
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain('Notes: Fixed a crash for Notification close.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('skips lint for backports', async () => {
      const payload = openPR({
        body: 'Backport of #12345\n\nNotes: fix crash for Notification close\n',
      });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('forces success with the override label despite findings, without commenting', async () => {
      const payload = openPR({ labels: [{ name: OVERRIDE_LABEL }] });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('forces success with the override label when notes are missing', async () => {
      const payload = openPR({
        body: 'Fixes something broken',
        labels: [{ name: OVERRIDE_LABEL }],
      });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('resolves a stale lint comment when the note becomes Notes: none', async () => {
      const payload = openPR({ body: 'Notes: none\n' });

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [botLintComment(8)]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toEqual(`${LINT_COMMENT_MARKER}\n${LINT_COMMENT_RESOLVED}`);
          return true;
        })
        .reply(200);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('resolves a stale lint comment when the override label is added', async () => {
      const payload = openPR({ labels: [{ name: OVERRIDE_LABEL }] });

      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [botLintComment(8)]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toEqual(`${LINT_COMMENT_MARKER}\n${LINT_COMMENT_RESOLVED}`);
          return true;
        })
        .reply(200);
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
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

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('Claude review of the note', () => {
    const CLEAN_NOTE = 'Fixed a UAF with the tray.';
    const SUGGESTION = 'Fixed a use-after-free crash when destroying a tray icon.';

    const openPR = (overrides: Record<string, unknown> = {}) =>
      ({
        action: 'synchronize',
        pull_request: {
          number: 1,
          body: `Fixes something broken\n\nNotes: ${CLEAN_NOTE}\n`,
          title: 'fix: UAF in TrayIconCocoa',
          user: { login: 'codebytere', type: 'User' },
          labels: [{ name: 'semver/patch' }],
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

    const claudeReplies = (json: unknown) =>
      ({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-fable-5-1',
        content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }) as unknown as ReviewMessage;

    // After the review the PR is re-read to make sure the event's snapshot is
    // still current; this answers with the snapshot itself (or overrides).
    const pullFetch = (
      payload: PullRequestOpenedEvent,
      overrides: Partial<{ head: { sha: string }; body: string }> = {},
    ) =>
      nock(GH_API)
        .get(PULL_PATH)
        .reply(200, {
          number: 1,
          head: payload.pull_request.head,
          body: payload.pull_request.body,
          ...overrides,
        });

    // The judge accepts the first candidate it is shown.
    const judgeAccepts = () =>
      claudeReplies({
        assessments: [{ candidate: 1, problems: [] }],
        best: 1,
        closest: 1,
        worth_posting: true,
      });

    // Replaces the default probot (whose runner has no client in tests) with
    // one wired to the given review-model mock; judge requests are answered by
    // judgeAccepts. null means "ANTHROPIC_API_KEY unset".
    const loadWithClient = <T extends ReviewClient['beta']['messages']['create'] | null>(
      create: T,
    ) => {
      probot = new Probot({
        privateKey: '9489ead8d9cb3566ba761a2c3dd278822f8d1205',
        appId: 690857,
      });
      const routed: ReviewClient['beta']['messages']['create'] = async (params) =>
        params.model === JUDGE_MODEL ? judgeAccepts() : create!(params);
      probot.load(createProbotRunner(create && { beta: { messages: { create: routed } } }));
      return create;
    };

    beforeEach(() => clearReviewCache());

    it('posts the suggestion in the marker comment and keeps the status green', async () => {
      const create = loadWithClient(
        vi.fn(async () =>
          claudeReplies({
            verdict: 'suggest',
            suggestion: SUGGESTION,
            reasons: ['UAF is internal jargon.'],
          }),
        ),
      );
      const payload = openPR();

      pullFetch(payload);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain(LINT_COMMENT_MARKER);
          expect(body.body).toContain('Suggested release note (advisory)');
          expect(body.body).toContain(`Notes: ${SUGGESTION}`);
          expect(body.body).toContain('- UAF is internal jargon.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'success', REVIEW_STATUS_DESCRIPTION);

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
      const request = create.mock.calls[0][0];
      expect(request.messages[0].content).toContain(CLEAN_NOTE);
      expect(request.messages[0].content).toContain(
        '<pr_title>\nUAF in TrayIconCocoa\n</pr_title>',
      );
      expect(request.messages[0].content).not.toContain('Fixes something broken');
    });

    it('posts nothing when Claude says the note is fine', async () => {
      const create = loadWithClient(
        vi.fn(async () => claudeReplies({ verdict: 'ok', suggestion: '', reasons: [] })),
      );
      const payload = openPR();

      pullFetch(payload);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
    });

    it('keeps the status green and posts nothing when the API fails', async () => {
      loadWithClient(vi.fn(async () => Promise.reject(new Error('Request timed out.'))));
      const payload = openPR();

      pullFetch(payload);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not review when no client is configured', async () => {
      loadWithClient(null);
      const payload = openPR();

      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('does not review a note that still has style findings', async () => {
      const create = loadWithClient(vi.fn());
      const payload = openPR({ body: 'Notes: fix crash for Notification close\n' });

      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API).post(COMMENTS_PATH).reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).not.toHaveBeenCalled();
    });

    it('does not review bot authors, backports or Notes: none', async () => {
      const create = loadWithClient(vi.fn());
      for (const overrides of [
        { user: { login: 'trop[bot]', type: 'Bot' } },
        { body: `Backport of #12345\n\nNotes: ${CLEAN_NOTE}\n` },
        { body: 'Notes: none\n' },
      ]) {
        const payload = openPR(overrides);
        noExistingComments();
        expectStatus(payload, 'success', 'Release notes found');
        await deliver(probot, { id: '123', name: 'pull_request', payload });
      }
      expect(nock.isDone()).toBe(true);
      expect(create).not.toHaveBeenCalled();
    });

    it('shows a shorter rewrite from Claude in the failing comment for a long note', async () => {
      const long =
        'Fixed a crash on macOS when the tray was closed while its context menu was still open and the owning window was being destroyed.';
      const short = 'Fixed a crash on macOS when closing a tray with its context menu open.';
      const create = loadWithClient(
        vi.fn(async () =>
          claudeReplies({
            note_kind: 'fix',
            verdict: 'suggest',
            suggestion: short,
            reasons: ['Drops detail readers can find in the PR.'],
            suggestion_kind: 'fix',
          }),
        ),
      );
      const payload = openPR({ body: `Notes: ${long}\n` });

      pullFetch(payload);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain('**Release note style suggestions**');
          expect(body.body).toContain(`This note is ${long.length} characters`);
          expect(body.body).toContain('Suggested shorter note (written by Claude');
          expect(body.body).toContain(`Notes: ${short}`);
          expect(body.body).toContain('- Drops detail readers can find in the PR.');
          return true;
        })
        .reply(201);
      expectStatus(payload, 'failure', 'Release notes need style fixes (see comment)');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
      expect(create.mock.calls[0][0].messages[0].content).toContain('over the 120-character limit');
    });

    it('reviews notes from claude[bot]', async () => {
      const create = loadWithClient(
        vi.fn(async () => claudeReplies({ verdict: 'ok', suggestion: '', reasons: [] })),
      );
      const payload = openPR({ user: { login: 'claude[bot]', type: 'Bot' } });

      pullFetch(payload);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      expectStatus(payload, 'success', 'Release notes found');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
    });

    it('does not review when the override label is present', async () => {
      const create = loadWithClient(vi.fn());
      const payload = openPR({ labels: [{ name: OVERRIDE_LABEL }] });
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes check overridden by label');

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).not.toHaveBeenCalled();
    });

    it('calls the API once for repeated events with the same note', async () => {
      const create = loadWithClient(
        vi.fn(async () =>
          claudeReplies({ verdict: 'suggest', suggestion: SUGGESTION, reasons: ['r'] }),
        ),
      );

      pullFetch(openPR());
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API).post(COMMENTS_PATH).reply(201, { id: 8 });
      expectStatus(openPR(), 'success', REVIEW_STATUS_DESCRIPTION);
      await deliver(probot, { id: '1', name: 'pull_request', payload: openPR() });

      // Second push: the comment already exists with the same body, so it is
      // left alone, and the cached verdict means no second API call.
      const second = openPR({ head: { sha: 'def456' } });
      pullFetch(second);
      nock(GH_API)
        .get(COMMENTS_PATH)
        .query(true)
        .reply(200, [{ id: 8, body: `${LINT_COMMENT_MARKER}\nstale`, user: BOT_USER }]);
      nock(GH_API)
        .patch(`/repos/electron/electron/issues/comments/8`, (body: Record<string, string>) => {
          expect(body.body).toContain(`Notes: ${SUGGESTION}`);
          return true;
        })
        .reply(200);
      expectStatus(second, 'success', REVIEW_STATUS_DESCRIPTION);
      await deliver(probot, { id: '2', name: 'pull_request', payload: second });

      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
    });

    it('writes nothing when the PR head moved on during the review', async () => {
      const create = loadWithClient(
        vi.fn(async () =>
          claudeReplies({ verdict: 'suggest', suggestion: SUGGESTION, reasons: ['r'] }),
        ),
      );
      const payload = openPR();

      // No comments listing, no comment and no status are mocked: any of them
      // would be an unmatched request and fail the delivery.
      pullFetch(payload, { head: { sha: 'def456' } });

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
    });

    it('acknowledges the webhook before the review finishes', async () => {
      const pending: ((message: ReviewMessage) => void)[] = [];
      const create = loadWithClient(
        vi.fn(() => new Promise<ReviewMessage>((resolve) => pending.push(resolve))),
      );
      const payload = openPR();
      pullFetch(payload);
      noExistingComments();
      expectStatus(payload, 'success', 'Release notes found');

      await probot.receive({ id: '123', name: 'pull_request', payload });
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES));
      expect(nock.isDone()).toBe(false);

      for (const resolve of pending.splice(0)) {
        resolve(claudeReplies({ verdict: 'ok', suggestion: '', reasons: [] }));
      }
      await settleFeedback();
      expect(nock.isDone()).toBe(true);
    });

    it('writes nothing when the PR description changed during the review', async () => {
      loadWithClient(
        vi.fn(async () => claudeReplies({ verdict: 'ok', suggestion: '', reasons: [] })),
      );
      const payload = openPR();

      pullFetch(payload, { body: 'Fixes something broken\n\nNotes: Fixed the tray.\n' });

      await deliver(probot, { id: '123', name: 'pull_request', payload });
      expect(nock.isDone()).toBe(true);
    });

    it('lets a newer failing push win over an older event still in review', async () => {
      // The first delivery is mid-review when a push arrives whose note fails
      // the style rules. Deliveries are serialised per PR, so the second waits;
      // the first then re-reads the PR, sees the newer head and writes nothing,
      // and the second posts its findings. Without this the second's failing
      // comment would be posted and then marked resolved by the first.
      const pending: ((message: ReviewMessage) => void)[] = [];
      const finishReview = (result: ReviewResult & { suggestion: string }) => {
        for (const resolve of pending.splice(0)) resolve(claudeReplies(result));
      };
      const create = loadWithClient(
        vi.fn(
          () =>
            new Promise<ReviewMessage>((resolve) => {
              pending.push(resolve);
            }),
        ),
      );
      const first = openPR();
      const second = openPR({
        head: { sha: 'def456' },
        body: 'Fixes something broken\n\nNotes: fix crash for Notification close\n',
      });

      pullFetch(second);
      nock(GH_API).get(COMMENTS_PATH).query(true).reply(200, []);
      nock(GH_API)
        .post(COMMENTS_PATH, (body: Record<string, string>) => {
          expect(body.body).toContain('Release note style suggestions');
          expect(body.body).not.toContain(SUGGESTION);
          return true;
        })
        .reply(201);
      expectStatus(second, 'failure', 'Release notes need style fixes (see comment)');

      const deliveries = Promise.all([
        deliver(probot, { id: '1', name: 'pull_request', payload: first }),
        deliver(probot, { id: '2', name: 'pull_request', payload: second }),
      ]);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES));
      finishReview({ verdict: 'suggest', suggestion: SUGGESTION, reasons: ['r'] });
      await deliveries;

      expect(nock.isDone()).toBe(true);
      expect(create).toHaveBeenCalledTimes(REVIEW_CANDIDATES);
    });
  });
});
