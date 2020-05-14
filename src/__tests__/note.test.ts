import * as constants from '../constants';
import * as noteUtils from '../note-utils';

describe('note detection', () => {
  it('can find a note', () => {
    expect(noteUtils.findNoteInPRBody(prBodyWithNote)).toEqual('Added a memory leak.');
  });
  it('strips comments out of PR bodies', () => {
    expect(noteUtils.findNoteInPRBody(prBodyWithEmbeddedComment)).toEqual('no-notes');
    expect(noteUtils.findNoteInPRBody(prBodyWithEmbeddedComment2)).toEqual('none');
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
    expect(noteUtils.createPRCommentFromNotes('no-notes')).toEqual(constants.NO_NOTES_BODY);
    expect(
      noteUtils.createPRCommentFromNotes(noteUtils.findNoteInPRBody(prBodyWithEmbeddedComment2)),
    ).toEqual(constants.NO_NOTES_BODY);
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
const prBodyWithEmbeddedComment2 =
  "#### Description of Change\r\n<!--\r\nThank you for your Pull Request. Please provide a description above and review\r\nthe requirements below.\r\n\r\nContributors guide: https://github.com/electron/electron/blob/master/CONTRIBUTING.md\r\n-->\r\nIt can cause build failures because the header is generated\r\nand there's no explicit dependency on a target that creates it.\r\n\r\nRelated to #21959.\r\n\r\n#### Checklist\r\n<!-- Remove items that do not apply. For completed items, change [ ] to [x]. -->\r\n\r\n- [x] PR description included and stakeholders cc'd\r\n- [x] `npm test` passes\r\n- [x] PR title follows semantic [commit guidelines](https://github.com/electron/electron/blob/master/docs/development/pull-requests.md#commit-message-guidelines)\r\n- [x] [PR release notes](https://github.com/electron/clerk/blob/master/README.md) describe the change in a way relevant to app developers, and are [capitalized, punctuated, and past tense](https://github.com/electron/clerk/blob/master/README.md#examples).\r\n\r\n#### Release Notes\r\n\r\nNotes: none <!-- Please add a one-line description for app developers to read in the release notes, or 'none' if no notes relevant to app developers. Examples and help on special cases: https://github.com/electron/clerk/blob/master/README.md#examples -->\r\n";
/* tslint:enable */
