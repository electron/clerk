import { describe, expect, it } from 'vitest';

import { analyzeNote, createLintCommentBody, lintNote } from '../src/note-lint';
import { LINT_COMMENT_MARKER } from '../src/constants';

const ctx = { labels: [], title: 'fix: something' };
const rules = (note: string, labels: string[] = []) =>
  lintNote(note, { labels, title: ctx.title }).map((f) => f.rule);

describe('lintNote', () => {
  it('accepts well-formed notes', () => {
    const good = [
      'Frameless windows on Linux now have rounded corners by default, just like on macOS and Windows.',
      '`&lt;webview&gt;` and `window.open` now inherit `nodeIntegrationInWorker` from the embedder, consistent with the other Node and sandbox preferences.',
      'Added `webFrameMain.printToPDF()` to allow printing individual frames to PDF from the main process.',
      'Updated Chromium to 152.0.7977.54.',
      "Fixed a crash on macOS when a notification's icon could not be attached; the notification is now shown without the icon.",
      'Improved app startup time by booting the main process from an embedded Node.js startup snapshot.',
      'Fixed a UAF with the tray.',
      'Updated Node.js to v22.1.0 (see https://nodejs.org/en/blog, e.g. the changelog on electronjs.org).',
      '* Fixed a crash on close.\n* Added `app.foo()`.',
    ];
    for (const note of good) {
      expect(lintNote(note, ctx), note).toEqual([]);
      expect(analyzeNote(note, ctx).fixed, note).toBeNull();
    }
  });

  it('flags lowercase, present-tense, unpunctuated notes and fixes them', () => {
    const result = analyzeNote('fix crash for Notification close', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual([
      'capitalized',
      'punctuated',
      'past-tense',
      'article',
    ]);
    expect(result.findings[2].suggestion).toEqual('Fixed crash for Notification close');
    expect(result.fixed).toEqual('Fixed a crash for Notification close.');
  });

  it('does not treat a leading noun as a verb', () => {
    expect(rules('Frameless windows now have rounded corners.')).toEqual([]);
    expect(rules('Fixes a crash.')).toEqual(['past-tense']);
    expect(rules('bump libcc to latest.')).toEqual(['capitalized', 'past-tense']);
    expect(rules('support foo.')).toEqual(['capitalized', 'past-tense']);
    expect(analyzeNote('support foo.', ctx).fixed).toEqual('Added support for foo.');
  });

  it('rejects commit-style prefixes', () => {
    const note = 'Fix: If a nativeImage was passed to the tray it was not resized.';
    const result = analyzeNote(note, ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['commit-prefix', 'backticks']);
    expect(result.fixed).toEqual('If a `nativeImage` was passed to the tray it was not resized.');

    expect(rules('feat(tray)!: add a thing.')).toEqual([
      'commit-prefix',
      'capitalized',
      'past-tense',
    ]);
    expect(analyzeNote('feat: add a thing', ctx).fixed).toEqual('Added a thing.');
  });

  it('rejects metadata mixed into the note', () => {
    const none = analyzeNote('No user-facing change; semver/none.', ctx);
    expect(none.findings.map((f) => f.rule)).toEqual(['meta-text']);
    expect(none.fixed).toEqual('none');

    const breaking = analyzeNote(
      'Removed support for the Unity desktop environment on Linux. (See breaking changes.)',
      ctx,
    );
    expect(breaking.findings.map((f) => f.rule)).toEqual(['meta-text']);
    expect(breaking.fixed).toEqual('Removed support for the Unity desktop environment on Linux.');

    expect(rules('Fixed a thing (no-notes).')).toEqual(['meta-text']);
  });

  it('wraps API-looking tokens in backticks', () => {
    const cases: [string, string][] = [
      [
        'Fixed webContents.print() returning "Invalid printer settings" on Windows.',
        'Fixed `webContents.print()` returning "Invalid printer settings" on Windows.',
      ],
      [
        'Fixed a crash in sharedTexture module when the texture was released early.',
        'Fixed a crash in `sharedTexture` module when the texture was released early.',
      ],
      [
        'Fixed desktopCapturer thumbnail generation on Wayland.',
        'Fixed `desktopCapturer` thumbnail generation on Wayland.',
      ],
      [
        'Added webContents.caretBrowsingEnabled for toggling caret browsing.',
        'Added `webContents.caretBrowsingEnabled` for toggling caret browsing.',
      ],
      [
        'Added the --enable-foo flag and &lt;webview&gt; support for app.whenReady.',
        'Added the `--enable-foo` flag and `<webview>` support for `app.whenReady`.',
      ],
    ];
    for (const [note, fixed] of cases) {
      const result = analyzeNote(note, ctx);
      expect(
        result.findings.map((f) => f.rule),
        note,
      ).toEqual(['backticks']);
      expect(result.fixed, note).toEqual(fixed);
    }
  });

  it('does not ask for a capital when the note will start with a code span', () => {
    const result = analyzeNote('webContents.print() failed unexpectedly.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['backticks']);
    expect(result.fixed).toEqual('`webContents.print()` failed unexpectedly.');
    expect(result.fixed?.startsWith('`')).toBe(true);
    expect(rules('* webContents.print() failed.\n* app.quit() now works.')).toEqual([
      'backticks',
      'backticks',
    ]);
  });

  it('leaves prose, versions, URLs and domains alone', () => {
    expect(rules('Updated Node.js and Squirrel.Mac, i.e. the macOS updater, to v2.0.1.')).toEqual(
      [],
    );
    expect(
      rules('Updated the docs at https://electronjs.org/docs/api.foo and example.com.'),
    ).toEqual([]);
    expect(rules('Fixed an issue on iOS, tvOS and .NET hosts, etc.')).toEqual([]);
  });

  it('adds the missing article after Fixed', () => {
    for (const noun of ['crash', 'issue', 'bug', 'regression', 'leak']) {
      const result = analyzeNote(`Fixed ${noun} in the tray.`, ctx);
      expect(result.findings.map((f) => f.rule)).toEqual(['article']);
      expect(result.fixed).toEqual(`Fixed a ${noun} in the tray.`);
    }
    expect(rules('Fixed crashes in the tray.')).toEqual([]);
  });

  it('flags long single-line notes', () => {
    expect(rules('Fixed one thing. Fixed another thing. Fixed a third thing.')).toEqual(['length']);
    expect(rules(`Fixed ${'a very long thing '.repeat(20)}in the tray.`)).toEqual(['length']);
    expect(rules('Fixed one thing. Fixed another thing.')).toEqual([]);
    expect(rules('* Fixed one.\n* Fixed two.\n* Fixed three.')).toEqual([]);
  });

  it('requires semver/major notes to describe the break', () => {
    expect(rules('Added a thing.', ['semver/major'])).toEqual(['breaking-described']);
    expect(rules('Added a thing.', ['semver/minor'])).toEqual([]);
    for (const note of [
      'Removed the `remote` module.',
      'Changed the default of `foo` to `bar`.',
      'Deprecated `app.foo()`.',
      'Renamed `foo` to `bar`.',
      'Dropped support for Windows 7.',
      '`app.foo()` is no longer available.',
      '`app.foo()` now requires a callback.',
      'The `clipboard` module is now aligned with the W3C Clipboard API.',
      '* Added a thing.\n* Removed another thing.',
    ]) {
      expect(rules(note, ['semver/major']), note).toEqual([]);
    }
  });

  it('lints each bullet of a multi-line note', () => {
    const result = analyzeNote('* fix crash on close\n* Added `foo`.\n* remove bar', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual([
      'capitalized',
      'punctuated',
      'past-tense',
      'article',
      'capitalized',
      'punctuated',
      'past-tense',
    ]);
    expect(result.findings[0].message).toMatch(/^Bullet 1: /);
    expect(result.findings[4].message).toMatch(/^Bullet 3: /);
    expect(result.fixed).toEqual('* Fixed a crash on close.\n* Added `foo`.\n* Removed bar.');
  });
});

describe('createLintCommentBody', () => {
  it('lists findings and a suggested note behind the marker', () => {
    const body = createLintCommentBody(analyzeNote('fix crash for &lt;webview&gt; close', ctx));
    expect(body.startsWith(LINT_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('- Start the note with a capital letter.');
    expect(body).toContain('Suggestion: Fix crash for &lt;webview&gt; close');
    expect(body).toContain(
      'Suggested note:\n\n```\nNotes: Fixed a crash for `<webview>` close.\n```',
    );
  });

  it('writes a bulleted suggested note for multi-line notes', () => {
    const body = createLintCommentBody(analyzeNote('* fix one\n* Fixed two.', ctx));
    expect(body).toContain('```\nNotes:\n* Fixed one.\n* Fixed two.\n```');
  });

  it('omits the suggested note when nothing can be fixed mechanically', () => {
    const body = createLintCommentBody(
      analyzeNote('Added a thing.', { labels: ['semver/major'], title: '' }),
    );
    expect(body).toContain('semver/major');
    expect(body).not.toContain('Suggested note:');
  });
});
