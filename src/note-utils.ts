#!/usr/bin/env node

import * as constants from './constants';
import d from 'debug';
const debug = d('note-utils');

export const updatePRBodyForNoNotes = (body: string | null) => {
  if (!body) return '';

  let notesBody = body;
  if (/(?:(?:\r?\n)|^)Notes: (.+?)(?:(?:\r?\n)|$)/gi.test(notesBody)) {
    debug('Updating existing default notes template');
    // Bound the lazy scan to a constant number of characters. The real GitHub
    // template comment is well under this length, but an unbounded `[\s\S]*?`
    // under the global flag lets an attacker-controlled body (many copies of
    // the literal prefix with no closing `-->`) force a re-scan to end-of-string
    // per occurrence, which is O(n^2) in the body length. Capping the span keeps
    // each match attempt O(1) so the overall replace stays linear.
    notesBody = notesBody.replace(
      /<!-- Please add a one-line description[\s\S]{0,1000}?-->/gi,
      'none',
    );
  } else {
    debug('Adding Notes: none to PR body');
    notesBody += '\n\n---\n\nNotes: none';
  }

  return notesBody;
};

// Counts the well-formed `Notes:` blocks in a body, mirroring what
// findNoteInPRBody recognises: the one-line form (`Notes: text`) and the
// bulleted multi-line form (a bare `Notes:` followed by one or more `* item`
// lines). A bare `Notes:` with no bullets is not a note to findNoteInPRBody,
// so it is not counted here either. Only the first note is ever persisted, so
// more than one is almost certainly a mistake.
export const countNotesInPRBody = (body: string | null) => {
  if (!body) return 0;

  // Strip HTML comments first so an unfilled template placeholder
  // (`Notes: <!-- Please add a one-line description ... -->`) is not counted:
  // findNoteInPRBody strips the comment and treats that line as an empty note,
  // so it must not be counted here either. Same bounded scan as there.
  const stripped = body.replace(/<!--.{0,1000}?-->/g, '');

  // The one-line form needs non-whitespace content after `Notes: ` so that a
  // placeholder line that stripped down to `Notes: ` does not count.
  return stripped.match(/^Notes: .*\S|^Notes:(?:\r?\n)+(?:\*.+(?:\r?\n|$))+/gim)?.length ?? 0;
};

export const findNoteInPRBody = (body: string | null) => {
  if (!body) return null;

  const onelineMatch = /(?:(?:\r?\n)|^)Notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch = /(?:(?:\r?\n)|^)Notes:(?:\r?\n+)((?:\*.+(?:(?:\r?\n)|$))+)/gi.exec(body);

  let notes: string | null = null;
  if (onelineMatch?.[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch?.[1]) {
    notes = multilineMatch[1];
  }

  // Remove the default PR template if it exists. Bound the lazy scan for the
  // same reason as in updatePRBodyForNoNotes: `notes` is derived from the
  // attacker-controlled PR body, and an unbounded `.*?` under the global flag
  // is O(n^2) when the input contains many `<!--` prefixes with no closing
  // `-->`. Capping the span keeps this linear in the input length.
  notes = notes ? notes.replace(/<!--.{0,1000}?-->/g, '') : null;

  if (notes) {
    debug(`Found Notes: ${JSON.stringify(notes.trim())}`);

    const sanitizeMap = new Map([
      ['<', '&lt;'],
      ['>', '&gt;'],
    ]);
    for (const [oldVal, newVal] of sanitizeMap.entries()) {
      notes = notes.replaceAll(oldVal, newVal);
    }
  }

  return notes ? notes.trim() : notes;
};

const OMIT_FROM_RELEASE_NOTES_KEYS = [
  /^blank.?$/i,
  /^empty.?$/i,
  /^no notes.?$/i,
  /^no.?$/i,
  /^no-notes.?$/i,
  /^no_notes.?$/i,
  /^`no-notes.?`$/i,
  /^`no notes.?`$/i,
  /^none.?$/i,
  /^nothing.?$/i,
];

// True for the `none` synonyms that mean "this change has no release note".
export const isNoNotesNote = (note: string) =>
  OMIT_FROM_RELEASE_NOTES_KEYS.some((rx) => rx.test(note));

export const createPRCommentFromNotes = (releaseNotes: string | null) => {
  let body = constants.NO_NOTES_BODY;
  if (releaseNotes && !isNoNotesNote(releaseNotes)) {
    const splitNotes = releaseNotes.split('\n').filter((line) => line !== '');
    if (splitNotes.length > 0) {
      const quoted = splitNotes.map((line) => `> ${line}`).join('\n');
      body = `${constants.NOTES_LEAD}\n\n${quoted}`;
    }
  }

  debug(`Created PR comment from releaseNotes: ${body}`);

  return body;
};
