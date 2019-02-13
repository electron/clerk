export const getReleaseNotes = (prBody: string) => {
  const currentPRBody = prBody;

  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(currentPRBody);
  const multilineMatch =
      /(?:(?:\r?\n)Notes:(?:\r?\n)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(currentPRBody);

  let notes: string | null = null;
  if (onelineMatch && onelineMatch[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch && multilineMatch[1]) {
    notes = multilineMatch[1];
  }

  // remove the default PR template
  if (notes) {
    notes = notes.replace(/<!--.*?-->/g, '');
    notes = notes.trim();
  }

  return notes && notes.length ? notes : null;
};
