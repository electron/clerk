import { describe, expect, it } from 'vitest';

import * as constants from '../src/constants';
import {
  countNotesInPRBody,
  findNoteInPRBody,
  updatePRBodyForNoNotes,
  createPRCommentFromNotes,
} from '../src/note-utils';

describe('note detection', () => {
  it('can find a note', () => {
    const note = findNoteInPRBody(prBodyWithNote);
    expect(note).toEqual('Added a memory leak.');
  });

  it('strips comments out of PR bodies', () => {
    const note = findNoteInPRBody(prBodyWithEmbeddedComment);
    expect(note).toEqual('no-notes');
  });

  it('strips embedded html out of note bodies', () => {
    const note = findNoteInPRBody(prBodyWithEmbeddedHtmlInNote);
    expect(note).toContain('&lt;input file="type"&gt;');
    expect(note).not.toContain('<input file="type">');
  });

  it('adds no-notes when necessary to build PRs', () => {
    const note = findNoteInPRBody(prBodyWithDefaultNote);
    expect(note).toEqual('');

    const updatedBody = updatePRBodyForNoNotes(prBodyWithDefaultNote);
    console.log(updatedBody);
    expect(updatedBody).toEqual(expect.stringContaining('Notes: none'));

    // Ensure it didn't try to replace other comments
    expect(updatedBody).toContain('Remove items that do not apply');
  });
});

describe('note counting', () => {
  it('returns 0 for a missing body or a body without notes', () => {
    expect(countNotesInPRBody(null)).toEqual(0);
    expect(countNotesInPRBody('')).toEqual(0);
    expect(countNotesInPRBody('oh no')).toEqual(0);
    expect(countNotesInPRBody('See the release notes: none needed')).toEqual(0);
  });

  it('returns 1 for a single one-line note', () => {
    expect(countNotesInPRBody(prBodyWithNote)).toEqual(1);
    expect(countNotesInPRBody(prBodyWithDefaultNote)).toEqual(1);
    expect(countNotesInPRBody('Notes: Fixed a thing.')).toEqual(1);
  });

  it('returns 1 for the bulleted multi-line form', () => {
    expect(countNotesInPRBody(prBodyWithMultilineNotes)).toEqual(1);
    expect(countNotesInPRBody(prBodyWithOnlyNotes)).toEqual(1);
  });

  it('counts repeated Notes: lines', () => {
    expect(countNotesInPRBody(prBodyWithMultipleNotesLines)).toEqual(2);
    expect(countNotesInPRBody('Notes: One.\r\nNotes: Two.\r\nNotes: Three.\r\n')).toEqual(3);
    expect(countNotesInPRBody('Notes: One.\nnotes: Two.\n')).toEqual(2);
    expect(countNotesInPRBody('Notes:\n* One.\n\nNotes: Two.\n')).toEqual(2);
    expect(countNotesInPRBody('Notes:\r\n\r\n* One.\r\n* Two.\r\n\r\nNotes: Three.\r\n')).toEqual(
      2,
    );
  });

  it('does not count a bare Notes: line that is not followed by bullets', () => {
    // Not a note to findNoteInPRBody either, so it must not be counted.
    expect(countNotesInPRBody('Notes:\nSee the original PR discussion.\n')).toEqual(0);
    expect(countNotesInPRBody('Notes:\n\nsome text\n')).toEqual(0);

    // A real one-liner alongside a bare heading over free text is one note.
    expect(
      countNotesInPRBody(
        'Notes: Backported fix for CVE-X.\n\nNotes:\nSee the original PR discussion.\n',
      ),
    ).toEqual(1);

    // The body updatePRBodyForNoNotes produces for a build: PR with a bare
    // Notes: heading must not trip the multiple-notes guard.
    expect(countNotesInPRBody('Notes:\n\nsome text\n\n---\n\nNotes: none')).toEqual(1);
  });
});

describe('comment generation', () => {
  it('knows when to show notes', () => {
    const note = 'some note';
    const comment = createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining(note));
  });

  it('knows when to show no-notes', () => {
    const note = findNoteInPRBody(prBodyWithNoNote);
    expect(createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);

    expect(createPRCommentFromNotes('no-notes')).toEqual(constants.NO_NOTES_BODY);
  });

  it('shows no-notes when a HTML comment is left in the PR', () => {
    const note = findNoteInPRBody(prBodyWithBadCase);
    expect(createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);
  });

  it('can handle missing notes', () => {
    const note = findNoteInPRBody('oh no');
    expect(createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);

    expect(createPRCommentFromNotes('no-notes')).toEqual(constants.NO_NOTES_BODY);
  });

  it('does not false positively match no-notes', () => {
    const surpriseNote = findNoteInPRBody(prBodyWithSurpriseNote);
    const comment = createPRCommentFromNotes(surpriseNote);

    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining('> no-notes but actually a note.'));
  });

  it('quotes a single-line note', () => {
    const note = 'some note';
    const comment = createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining(`> ${note}`));
  });

  it('quotes a multiline note', () => {
    const note = 'line one\nline two';
    const comment = createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining('> line one\n> line two'));
  });

  it('can handle different multiline note formatting', () => {
    const note = findNoteInPRBody(prBodyWithMultilineNotes);
    const comment = createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));

    const expected = `
> * Fixes the following issues for frameless when maximized on Windows:
> * fix unreachable task bar when auto hidden with position top
> * fix 1px extending to secondary monitor
> * fix 1px overflowing into taskbar at certain resolutions
> * fix white line on top of window under 4k resolutions`;

    expect(comment).toEqual(expect.stringContaining(expected));
  });

  it('can handle a PR body only containing a note', () => {
    const note = findNoteInPRBody(prBodyWithOnlyNotes);
    const comment = createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));

    const expected = `
> * Security: backported fix for CVE-2024-7965.
> * Security: backported fix for CVE-2024-7966.
> * Security: backported fix for CVE-2024-7967.
> * Security: backported fix for CVE-2024-8198.
> * Security: backported fix for CVE-2024-8193.`;

    expect(comment).toEqual(expect.stringContaining(expected));
  });
});

/* Test PR Bodies */

/* tslint:disable */
const prBodyWithDefaultNote = `#### Description of Change

Something

#### Checklist
<!-- Remove items that do not apply. For completed items, change [ ] to [x]. -->

- [x] PR description included and stakeholders cc'd

#### Release Notes

Notes: <!-- Please add a one-line description for app developers to read in the release notes, or 'none' if no notes relevant to app developers. Examples and help on special cases: https://github.com/electron/clerk/blob/master/README.md#examples -->
`;

/* tslint:disable */
const prBodyWithNote = `#### Description of Change

Does a thing.

#### Checklist
<!-- Remove items that do not apply. For completed items, change [ ] to [x]. -->

- [ ] PR description included and stakeholders cc'd
- [ ] \`npm test\` passes
- [ ] tests are [changed or added](https://github.com/electron/electron/blob/master/docs/development/testing.md)
- [ ] PR title follows semantic [commit guidelines](https://github.com/electron/electron/blob/master/docs/development/pull-requests.md#commit-message-guidelines)
- [ ] [PR release notes](https://github.com/electron/clerk/blob/master/README.md) describe the change in a way relevant to app developers, and are [capitalized, punctuated, and past tense](https://github.com/electron/clerk/blob/master/README.md#examples).


#### Release Notes

Notes: Added a memory leak.
`;
/* tslint:enable */

// source: https://github.com/electron/electron/pull/16886
/* tslint:disable */
const prBodyWithEmbeddedComment = `Backport of #16875

See that PR for details.


Notes: <!-- Please add a one-line description for app developers to read in the release notes, or \`no-notes\` if no notes relevant to app developers. Examples and help on special cases: https://github.com/electron/clerk/blob/master/README.md#examples -->no-notes
`;
/* tslint:enable */

// source: https://github.com/electron/electron/pull/35173
/* tslint:disable */
const prBodyWithBadCase = `Backport of #34723

See that PR for details.


Notes: <!-- Please add a one-line description for app developers to read in the release notes, or 'none' if no notes relevant to app developers. Examples and help on special cases: https://github.com/electron/clerk/blob/master/README.md#examples -->None
`;
/* tslint:enable */

// source: https://github.com/electron/electron/pull/25112
/* tslint:disable */
const prBodyWithNoNote = `#### Description of Change

Fixes an issue where interacting with a BrowserWindow which had a BrowserView attached whose \`webContents\` had been destroyed could cause a crash in \`BaseWindow::ResetBrowserViews()\`.

cc @nornagon @MarshallOfSound 

#### Checklist
<!-- Remove items that do not apply. For completed items, change [ ] to [x]. -->

- [x] PR description included and stakeholders cc'd
- [x] \`npm test\` passes
- [x] tests are [changed or added](https://github.com/electron/electron/blob/master/docs/development/testing.md)
- [x] PR title follows semantic [commit guidelines](https://github.com/electron/electron/blob/master/docs/development/pull-requests.md#commit-message-guidelines)
- [x] [PR release notes](https://github.com/electron/clerk/blob/master/README.md) describe the change in a way relevant to app developers, and are [capitalized, punctuated, and past tense](https://github.com/electron/clerk/blob/master/README.md#examples).
- [x] This is **NOT A BREAKING CHANGE**. Breaking changes may not be merged to master until 11-x-y is branched.

#### Release Notes

Notes: none.
`;
/* tslint:enable */

/* tslint:disable */
const prBodyWithSurpriseNote = `#### Description of Change

Fixes something!

cc @nornagon @MarshallOfSound 

Notes: no-notes but actually a note.
`;
/* tslint:enable */

// Source: https://github.com/electron/electron/pull/25219
/* tslint:disable */
const prBodyWithMultilineNotes = `#### Description of Change

Backports https://github.com/electron/electron/pull/25052

#### Checklist
<!-- Remove items that do not apply. For completed items, change [ ] to [x]. -->

- [x] PR description included and stakeholders cc'd
- [x] \`npm test\` passes
- [x] PR title follows semantic [commit guidelines](https://github.com/electron/electron/blob/master/docs/development/pull-requests.md#commit-message-guidelines)
- [x] [PR release notes](https://github.com/electron/clerk/blob/master/README.md) describe the change in a way relevant to app developers, and are [capitalized, punctuated, and past tense](https://github.com/electron/clerk/blob/master/README.md#examples).
- [x] This is **NOT A BREAKING CHANGE**. Breaking changes may not be merged to master until 11-x-y is branched.

#### Release Notes

Notes:

* Fixes the following issues for frameless when maximized on Windows:
* fix unreachable task bar when auto hidden with position top
* fix 1px extending to secondary monitor
* fix 1px overflowing into taskbar at certain resolutions
* fix white line on top of window under 4k resolutions
`;
/* tslint:enable */

// Source: https://github.com/electron/electron/pull/26217
/* tslint:disable */
const prBodyWithEmbeddedHtmlInNote = `Backport of #25030

See that PR for details.


Notes: Fixed an issue where packages could not be selected with <input file="type"> on macOS.
`;
/* tslint:enable */

const prBodyWithOnlyNotes = `
Notes:
* Security: backported fix for CVE-2024-7965.
* Security: backported fix for CVE-2024-7966.
* Security: backported fix for CVE-2024-7967.
* Security: backported fix for CVE-2024-8198.
* Security: backported fix for CVE-2024-8193.
`;

// A body with the repeated one-line form, which is not supported.
const prBodyWithMultipleNotesLines = `#### Description of Change

Does two things.

#### Release Notes

Notes: Fixed a crash when closing a window.
Notes: Added a new \`foo\` option to \`BrowserWindow\`.
`;
