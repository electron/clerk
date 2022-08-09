import * as constants from '../constants';
import * as noteUtils from '../note-utils';

describe('note detection', () => {
  it('can find a note', () => {
    expect(noteUtils.findNoteInPRBody(prBodyWithNote)).toEqual('Added a memory leak.');
  });
  it('strips comments out of PR bodies', () => {
    expect(noteUtils.findNoteInPRBody(prBodyWithEmbeddedComment)).toEqual('no-notes');
  });
  it('strips embedded html out of note bodies', () => {
    const note = noteUtils.findNoteInPRBody(prBodyWithEmbeddedHtmlInNote);
    expect(note).toContain('&lt;input file="type"&gt;');
    expect(note).not.toContain('<input file="type">');
  });
});

describe('comment generation', () => {
  it('knows when to show notes', () => {
    const note = 'some note';
    const comment = noteUtils.createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining(note));
  });

  it('knows when to show no-notes', () => {
    const note = noteUtils.findNoteInPRBody(prBodyWithNoNote);
    expect(noteUtils.createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);

    expect(noteUtils.createPRCommentFromNotes('no-notes')).toEqual(constants.NO_NOTES_BODY);
  });

  it('shows no-notes when a HTML comment is left in the PR', () => {
    const note = noteUtils.findNoteInPRBody(prBodyWithBadCase);
    expect(noteUtils.createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);
  });

  it('can handle missing notes', () => {
    const note = noteUtils.findNoteInPRBody('oh no');
    expect(noteUtils.createPRCommentFromNotes(note)).toEqual(constants.NO_NOTES_BODY);

    expect(noteUtils.createPRCommentFromNotes('no-notes')).toEqual(constants.NO_NOTES_BODY);
  });

  it('does not false positively match no-notes', () => {
    const surpriseNote = noteUtils.findNoteInPRBody(prBodyWithSurpriseNote);
    const comment = noteUtils.createPRCommentFromNotes(surpriseNote);

    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining('> no-notes but actually a note.'));
  });

  it('quotes a single-line note', () => {
    const note = 'some note';
    const comment = noteUtils.createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining(`> ${note}`));
  });

  it('quotes a multiline note', () => {
    const note = 'line one\nline two';
    const comment = noteUtils.createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));
    expect(comment).toEqual(expect.stringContaining('> line one\n> line two'));
  });

  it('can handle different multiline note formatting', () => {
    const note = noteUtils.findNoteInPRBody(prBodyWithMultilineNotes);
    const comment = noteUtils.createPRCommentFromNotes(note);
    expect(comment).toEqual(expect.stringContaining(constants.NOTES_LEAD));

    const expected = `
> * Fixes the following issues for frameless when maximized on Windows:
> * fix unreachable task bar when auto hidden with position top
> * fix 1px extending to secondary monitor
> * fix 1px overflowing into taskbar at certain resolutions
> * fix white line on top of window under 4k resolutions`;

    expect(comment).toEqual(expect.stringContaining(expected));
  });
});

/* Test PR Bodies */

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
