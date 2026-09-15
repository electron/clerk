import { describe, expect, it } from 'vitest';

import {
  analyzeNote,
  createLintCommentBody,
  escapeProse,
  exceedsNoteLength,
  isSecurityBackportNote,
  lintNote,
  MAX_LINT_LINE_LENGTH,
  MAX_NOTE_LENGTH,
} from '../src/note-lint';
import { LINT_COMMENT_MARKER } from '../src/constants';

const ctx = { labels: [], title: 'fix: something' };
const rules = (note: string, labels: string[] = []) =>
  lintNote(note, { labels, title: ctx.title }).map((f) => f.rule);

describe('lintNote', () => {
  it('accepts well-formed notes', () => {
    const good = [
      'Frameless windows on Linux now have rounded corners by default, just like on macOS and Windows.',
      '`&lt;webview&gt;` and `window.open` now inherit `nodeIntegrationInWorker` from the embedder.',
      'Added `webFrameMain.printToPDF()` to allow printing individual frames to PDF from the main process.',
      'Updated Chromium to 152.0.7977.54.',
      "Fixed a crash on macOS when a notification's icon could not be attached; it is now shown without the icon.",
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

  it('strips bare metadata but keeps the real note around it', () => {
    const cases: [string, string][] = [
      ['Fixed a crash on Windows; semver/patch.', 'Fixed a crash on Windows.'],
      ['Fixed a crash on Windows. See breaking changes.', 'Fixed a crash on Windows.'],
      ['semver/patch: Fixed a crash on Windows.', 'Fixed a crash on Windows.'],
      ['Fixed a crash on Windows (no user-facing change).', 'Fixed a crash on Windows.'],
      ['No user-facing changes.', 'none'],
      ['no-notes', 'none'],
      ['Bumped semver/patch version for internal tooling.', 'Bumped version for internal tooling.'],
      ['See breaking changes. Also improved performance.', 'Also improved performance.'],
    ];
    for (const [note, fixed] of cases) {
      const result = analyzeNote(note, ctx);
      expect(result.fixed, note).toEqual(fixed);
      expect(result.findings, note).toHaveLength(1);
      expect(result.findings[0], note).toMatchObject({ rule: 'meta-text', suggestion: fixed });
    }
    const body = createLintCommentBody(analyzeNote('Fixed a crash on Windows; semver/patch.', ctx));
    expect(body).toContain('```\nNotes: Fixed a crash on Windows.\n```');

    // Three sentences also trips the length rule; the meta suggestion itself
    // must not leave a doubled period behind.
    const mid = analyzeNote(
      'Fixed a crash on Windows. See breaking changes. Also improved performance.',
      ctx,
    );
    expect(mid.findings.map((f) => f.rule)).toEqual(['meta-text', 'length']);
    expect(mid.findings[0].suggestion).toEqual(
      'Fixed a crash on Windows. Also improved performance.',
    );
    expect(mid.fixed).toEqual('Fixed a crash on Windows. Also improved performance.');
  });

  it('only treats whole meta phrases as metadata', () => {
    const result = analyzeNote('Improve semver/patches handling.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['past-tense']);
    expect(result.fixed).toEqual('Improved semver/patches handling.');
    expect(rules('Added a no-notes-yet mode.')).toEqual([]);
  });

  it('treats a note that is only a meta parenthetical as Notes: none', () => {
    for (const note of ['(semver/patch)', '(no user-facing change)']) {
      const result = analyzeNote(note, ctx);
      expect(result.fixed, note).toEqual('none');
      expect(result.findings, note).toHaveLength(1);
      expect(result.findings[0], note).toMatchObject({ rule: 'meta-text', suggestion: 'none' });
      expect(result.findings[0].message, note).toContain('use `Notes: none`');
      expect(createLintCommentBody(result), note).toContain('Notes: none');
      expect(createLintCommentBody(result), note).not.toContain('Notes: .');
    }
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
      expect(result.fixed).toEqual(`Fixed ${noun === 'issue' ? 'an' : 'a'} ${noun} in the tray.`);
    }
    expect(rules('Fixed crashes in the tray.')).toEqual([]);
  });

  it('flags long single-line notes', () => {
    expect(rules('Fixed one thing. Fixed another thing. Fixed a third thing.')).toEqual(['length']);
    expect(rules(`Fixed ${'a very long thing '.repeat(20)}in the tray.`)).toEqual(['length']);
    expect(rules('Fixed one thing. Fixed another thing.')).toEqual([]);
    expect(rules('* Fixed one.\n* Fixed two.\n* Fixed three.')).toEqual([]);
  });

  it('capitalizes platform names where they clearly name the platform', () => {
    const result = analyzeNote('Fixed a shutdown crash on arm64 windows, macos and linux.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['platform-case']);
    expect(result.fixed).toEqual('Fixed a shutdown crash on arm64 Windows, macOS and Linux.');
    expect(analyzeNote('Fixed input on certain wayland compositors and x11.', ctx).fixed).toEqual(
      'Fixed input on certain Wayland compositors and X11.',
    );
    expect(analyzeNote('Fixed display errors on some versions of windows 10.', ctx).fixed).toEqual(
      'Fixed display errors on some versions of Windows 10.',
    );
    expect(analyzeNote('Fixed windows native message boxes.', ctx).fixed).toEqual(
      'Fixed Windows native message boxes.',
    );
    for (const note of [
      'Fixed child windows closing early.',
      'Fixed a crash (see https://example.com/linux/macos).',
      'Fixed `on windows` in code.',
    ]) {
      expect(rules(note), note).toEqual([]);
    }
  });

  it('wraps compound class names but not common product names', () => {
    const result = analyzeNote('Fixed a crash with BaseWindow and BrowserWindow.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['backticks']);
    expect(result.fixed).toEqual('Fixed a crash with `BaseWindow` and `BrowserWindow`.');
    expect(rules('Fixed DevTools and JavaScript errors on GitHub and in WebAssembly.')).toEqual([]);
  });

  it('accepts a semver/major dependency upgrade that names the version', () => {
    expect(rules('Upgraded Node.js to v22.9.0.', ['semver/major'])).toEqual([]);
    expect(rules('Updated Chromium to 134.0.6998.23.', ['semver/major'])).toEqual([]);
  });

  it('accepts a semver/major note that says what now happens', () => {
    expect(rules('`nativeImage` now normalizes pixel values to sRGB.', ['semver/major'])).toEqual(
      [],
    );
  });

  it('wraps environment variables in backticks', () => {
    const result = analyzeNote('Removed the ELECTRON_SKIP_BINARY_DOWNLOAD variable.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['backticks']);
    expect(result.fixed).toEqual('Removed the `ELECTRON_SKIP_BINARY_DOWNLOAD` variable.');
  });

  it('recognises other wordings of security backport notes', () => {
    for (const note of [
      'Backported a fix for route_id validation in the GPU command buffer.',
      'Backported upstream v8 fixes for a maglev use-count accounting issue.',
      'Backported upstream fixes for two edge cases in the WebNN TFLite graph builder.',
    ]) {
      expect(isSecurityBackportNote(note), note).toBe(true);
    }
    expect(isSecurityBackportNote('Backported fix in Skia for 495534710.')).toBe(true);
    expect(isSecurityBackportNote('Fixed a backported regression.')).toBe(false);
  });

  it('keeps links, images, mentions and references in comment prose inert', () => {
    const Z = String.fromCharCode(0x200b);
    expect(
      escapeProse('See [docs](https://evil.example/x) and ![p](https://t.example/p.png).'),
    ).toEqual(
      `See \\[docs\\](https:${Z}//evil.example/x) and !\\[p\\](https:${Z}//t.example/p.png).`,
    );
    expect(escapeProse('Ask @someone, see #123 and www.evil.example.')).toEqual(
      `Ask @${Z}someone, see #${Z}123 and www${Z}.evil.example.`,
    );
    expect(escapeProse('Mail someone@evil.example.')).toEqual(`Mail someone@${Z}evil.example.`);
    expect(escapeProse('See https://x.example/@victim and www.@user')).toEqual(
      `See https:${Z}//x.example/@${Z}victim and www${Z}.@${Z}user`,
    );
    expect(escapeProse('see _www.evil.example and _https://evil.example/x')).toEqual(
      `see _www${Z}.evil.example and _https:${Z}//evil.example/x`,
    );
    // Shown as literal text: `&` is escaped, so the entities never decode.
    expect(escapeProse('Ask &#64;someone or &commat;x')).toEqual(
      `Ask &amp;#${Z}64;someone or &amp;commat;x`,
    );
    expect(escapeProse('<img src=x>')).toEqual('&lt;img src=x&gt;');
    // Code spans are not linked or mentioned by GitHub, so they are left as written.
    expect(escapeProse('Run `npm i @electron/get` or see `https://x.example/#1`.')).toEqual(
      'Run `npm i @electron/get` or see `https://x.example/#1`.',
    );
    expect(escapeProse('Use `a[0] && b` <here> & more.')).toEqual(
      'Use `a[0] && b` &lt;here&gt; &amp; more.',
    );
  });

  it('does not let stray backticks hide prose from escaping', () => {
    const Z = String.fromCharCode(0x200b);
    expect(escapeProse('a ` b @someone www.x.example')).toEqual(
      `a &#96; b @${Z}someone www${Z}.x.example`,
    );
    expect(escapeProse('a ` [x](y) <b>')).toEqual('a &#96; \\[x\\](y) &lt;b&gt;');
    expect(escapeProse('``a`` [x](y)')).toEqual('&#96;&#96;a&#96;&#96; \\[x\\](y)');
    expect(escapeProse('\\` [x](y) `')).toEqual('&#96; \\[x\\](y) &#96;');
    expect(escapeProse('`a` ` [x](y)')).toEqual('`a` &#96; \\[x\\](y)');
    // Backticks are balanced per line, since GitHub never pairs them across blocks.
    expect(escapeProse('a `b\n\n- c` [x](y) <b>')).toEqual(
      'a &#96;b\n\n- c&#96; \\[x\\](y) &lt;b&gt;',
    );
    expect(escapeProse('see //evil.example/x and (//evil.example)')).toEqual(
      `see /${Z}/evil.example/x and (/${Z}/evil.example)`,
    );
  });

  it('leaves PascalCase product names alone', () => {
    expect(rules('Fixed sharing links to WhatsApp, OneDrive and PowerPoint.')).toEqual([]);
  });

  it('fixes Windows in any wrong casing', () => {
    const result = analyzeNote('Fixed a crash on WINDOWS and arm64 WinDows.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['platform-case']);
    expect(result.fixed).toEqual('Fixed a crash on Windows and arm64 Windows.');
  });

  it('does not count an unrelated "now" as describing a breaking change', () => {
    expect(rules('Fixed the tray icon for now.', ['semver/major'])).toEqual(['breaking-described']);
    expect(rules('Fixed the tray, right now it works.', ['semver/major'])).toEqual([
      'breaking-described',
    ]);
    expect(rules('`app.foo()` now throws when called early.', ['semver/major'])).toEqual([]);
  });

  it('checks a breaking change against the fixed note', () => {
    expect(rules('Bump Node.js to v22.9.0.', ['semver/major'])).toEqual(['past-tense']);
  });

  it('accepts an instruction bullet after the change it belongs to', () => {
    const note = [
      "* `getUserMedia` with `chromeMediaSource: 'desktop'` no longer accepts `WebContents` source ids.",
      "* Use `chromeMediaSource: 'tab'` with `webContents.getMediaSourceId()` instead.",
    ].join('\n');
    expect(rules(note)).toEqual([]);
    expect(rules('* Removed `foo()`.\n* Enable `bar` instead.')).toEqual([]);
    expect(rules('* Removed `foo()`.\n* Enable the sandbox flag to prevent this.')).toEqual([]);
    expect(rules('* Removed `foo()`.\n* Uses the new engine instead of polling.')).toEqual([
      'past-tense',
    ]);
    expect(rules('* Removed `foo()`.\n* Enable the new tray.')).toEqual(['past-tense']);
    expect(rules('* Use `foo` instead of `bar`.\n* Fixed a crash.')).toEqual(['past-tense']);
    expect(rules('Use `foo` instead of `bar`.')).toEqual(['past-tense']);
  });

  it('uses "an" before a vowel when adding the article', () => {
    expect(analyzeNote('Fixed issue with window resizing.', ctx).fixed).toEqual(
      'Fixed an issue with window resizing.',
    );
    expect(analyzeNote('Fixed crash on quit.', ctx).fixed).toEqual('Fixed a crash on quit.');
  });

  it('treats "Backported fix for none." as Notes: none', () => {
    const result = analyzeNote('Backported fix for none.', ctx);
    expect(result.findings.map((f) => f.rule)).toEqual(['meta-text']);
    expect(result.fixed).toEqual('none');
  });

  it('does not limit the length of security backport notes', () => {
    const cves = Array.from({ length: 12 }, (_, i) => `CVE-2026-${6300 + i}`).join(', ');
    expect(rules(`Backported fixes for ${cves}.`)).toEqual([]);
    expect(exceedsNoteLength(`Backported fixes for ${cves}.`)).toBe(false);
  });

  it('measures the length after the mechanical fixes', () => {
    // Exactly at the limit as written, over it once the three API names are backticked.
    const base =
      'Fixed crashes in sharedTexture, service-worker ipcRenderer and utilityProcess.fork() caused by object lifetime bugs';
    const note = `${base}${'!'.repeat(MAX_NOTE_LENGTH - 1 - base.length)}.`;
    const result = analyzeNote(note, ctx);
    expect(note).toHaveLength(MAX_NOTE_LENGTH);
    expect(result.findings.map((f) => f.rule)).toEqual(['backticks', 'length']);
    expect(result.findings[1].message).toContain(
      `is ${MAX_NOTE_LENGTH + 6} characters with the fixes above`,
    );
  });

  it(`limits each note and bullet to ${MAX_NOTE_LENGTH} characters`, () => {
    const note = (length: number) => `Fixed a crash in the tray${'!'.repeat(length - 26)}.`;
    expect(note(MAX_NOTE_LENGTH)).toHaveLength(MAX_NOTE_LENGTH);
    expect(rules(note(MAX_NOTE_LENGTH))).toEqual([]);
    expect(rules(note(MAX_NOTE_LENGTH + 1))).toEqual(['length']);

    const result = analyzeNote(`* Fixed one.\n* ${note(MAX_NOTE_LENGTH + 1)}`, ctx);
    expect(result.findings.map((f) => f.message)).toEqual([
      `Bullet 2: This bullet is ${MAX_NOTE_LENGTH + 1} characters; keep it to at most ${MAX_NOTE_LENGTH} by dropping detail readers can find in the PR.`,
    ]);
  });

  it('bounds the work done on a very long spaceless token', () => {
    const note = `${'a-'.repeat(25_000)}a`;
    const start = performance.now();
    const result = analyzeNote(note, ctx);
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.findings.map((f) => f.rule)).toEqual(['length']);
    expect(result.findings[0].message).toContain(`over ${MAX_LINT_LINE_LENGTH} characters`);
    expect(result.fixed).toBeNull();
  });

  it('reports only the length of an over-long bullet', () => {
    const result = analyzeNote(`* fix one\n* ${'app.foo '.repeat(400)}`, ctx);
    expect(result.findings.map((f) => f.rule)).toEqual([
      'capitalized',
      'punctuated',
      'past-tense',
      'length',
    ]);
    expect(result.findings[3].message).toMatch(/^Bullet 2: This bullet is over/);
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
