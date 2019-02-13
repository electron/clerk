#!/usr/bin/env node

import * as constants from './constants';

export const findNoteInPRBody = (body: string): string | null => {
  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch =
      /(?:(?:\r?\n)Notes:(?:\r?\n)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(body);

  let notes: string | null = null;
  if (onelineMatch && onelineMatch[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch && multilineMatch[1]) {
    notes = multilineMatch[1];
  }

  // remove the default PR template
  if (notes) {
    notes = notes.replace(/<!--.*?-->/g, '');
  }

  return notes;
};

const OMIT_FROM_RELEASE_NOTES_KEYS = [
  'blank',
  'empty',
  'no notes',
  'no',
  'no-notes',
  'no_notes',
  'none',
  'nothing',
];

export const createPRCommentFromNotes = (releaseNotes: string | null) => {
  let body = constants.NO_NOTES_BODY;
  if (releaseNotes && (OMIT_FROM_RELEASE_NOTES_KEYS.indexOf(releaseNotes) === -1)) {
    const splitNotes = releaseNotes.split('\n').filter(line => line !== '');
    if (splitNotes.length > 0) {
      const quoted = splitNotes.map(line => `> ${line}`).join('\n');
      body = `${constants.NOTES_LEAD}\n\n${quoted}`;
    }
  }

  return body;
};
