#!/usr/bin/env node

import * as constants from './constants';
import d from 'debug';
const debug = d('note-utils');

export const updatePRBodyForNoNotes = (body: string | null) => {
  if (!body) return '';

  let notesBody = body;
  if (/(?:(?:\r?\n)|^)Notes: (.+?)(?:(?:\r?\n)|$)/gi.test(notesBody)) {
    debug('Updating existing default notes template');
    notesBody = notesBody.replace(/<!-- Please add a one-line description[\s\S]*?-->/gi, 'none');
  } else {
    debug('Adding Notes: none to PR body');
    notesBody += '\n\n---\n\nNotes: none';
  }

  return notesBody;
};

export const findNoteInPRBody = (body: string | null) => {
  if (!body) return null;

  const onelineMatch = /(?:(?:\r?\n)|^)Notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch = /(?:(?:\r?\n)Notes:(?:\r?\n+)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(body);

  let notes: string | null = null;
  if (onelineMatch?.[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch?.[1]) {
    notes = multilineMatch[1];
  }

  // Remove the default PR template if it exists.
  notes = notes ? notes.replace(/<!--.*?-->/g, '') : null;

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

export const createPRCommentFromNotes = (releaseNotes: string | null) => {
  let body = constants.NO_NOTES_BODY;
  if (releaseNotes && !OMIT_FROM_RELEASE_NOTES_KEYS.some((rx) => rx.test(releaseNotes))) {
    const splitNotes = releaseNotes.split('\n').filter((line) => line !== '');
    if (splitNotes.length > 0) {
      const quoted = splitNotes.map((line) => `> ${line}`).join('\n');
      body = `${constants.NOTES_LEAD}\n\n${quoted}`;
    }
  }

  debug(`Created PR comment from releaseNotes: ${body}`);

  return body;
};
