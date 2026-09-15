// Deterministic style checks for a release note, mirroring the README's
// style guide. Pure: no I/O, no GitHub access.

import { LINT_COMMENT_MARKER, STYLE_GUIDE_URL } from './constants';

export type LintRule =
  | 'capitalized'
  | 'punctuated'
  | 'past-tense'
  | 'commit-prefix'
  | 'meta-text'
  | 'backticks'
  | 'article'
  | 'platform-case'
  | 'length'
  | 'breaking-described';

export interface LintFinding {
  rule: LintRule;
  message: string;
  suggestion?: string;
}

export interface LintContext {
  labels: string[];
  title: string;
}

export interface LintResult {
  findings: LintFinding[];
  // The note with every mechanical suggestion applied, or null when nothing
  // could be fixed automatically.
  fixed: string | null;
}

export const BREAKING_LABEL = 'semver/major';

// Present/imperative first words and the past-tense form to suggest instead.
const PAST_TENSE: Record<string, string> = {
  fix: 'Fixed',
  fixes: 'Fixed',
  fixing: 'Fixed',
  add: 'Added',
  adds: 'Added',
  adding: 'Added',
  remove: 'Removed',
  removes: 'Removed',
  removing: 'Removed',
  update: 'Updated',
  updates: 'Updated',
  updating: 'Updated',
  bump: 'Updated',
  bumps: 'Updated',
  backport: 'Backported',
  backports: 'Backported',
  implement: 'Implemented',
  implements: 'Implemented',
  allow: 'Allowed',
  allows: 'Allowed',
  make: 'Made',
  makes: 'Made',
  ensure: 'Ensured',
  ensures: 'Ensured',
  prevent: 'Prevented',
  prevents: 'Prevented',
  avoid: 'Avoided',
  avoids: 'Avoided',
  use: 'Used',
  uses: 'Used',
  support: 'Added support for',
  supports: 'Added support for',
  enable: 'Enabled',
  enables: 'Enabled',
  disable: 'Disabled',
  disables: 'Disabled',
  handle: 'Handled',
  handles: 'Handled',
  improve: 'Improved',
  improves: 'Improved',
  refactor: 'Refactored',
  revert: 'Reverted',
  reverts: 'Reverted',
  'cherry-pick': 'Cherry-picked',
  expose: 'Exposed',
  exposes: 'Exposed',
  introduce: 'Introduced',
  introduces: 'Introduced',
  deprecate: 'Deprecated',
  deprecates: 'Deprecated',
  migrate: 'Migrated',
  migrates: 'Migrated',
  upgrade: 'Upgraded',
  upgrades: 'Upgraded',
  change: 'Changed',
  changes: 'Changed',
};

export const COMMIT_PREFIX = /^\w+(\([^)]*\))?!?:\s+/;

// Whole tokens only (the lookarounds), so `semver/patches` or `no-notes-yet`
// is prose, not metadata.
const META_PHRASE =
  '(?<![\\w-])(?:semver\\/(?:none|patch|minor|major)|no user[- ]facing(?: changes?)?|see breaking changes|no-notes)(?![\\w-])';
// "Backported fix for none." is a mangled `Notes: none`; the whole line is metadata.
const MANGLED_NONE = /^backported (?:a )?fix(?:es)? for (?:none|nothing|n\/a)\.?$/i;
const META_TEXT = new RegExp(`${META_PHRASE}|${MANGLED_NONE.source}`, 'i');
// A parenthetical that is only metadata, e.g. `(See breaking changes.)`.
const META_PARENTHETICAL = new RegExp(`\\s*\\([^()]*${META_PHRASE}[^()]*\\)`, 'gi');
// A bare meta phrase with the clause punctuation around it, e.g. `; semver/patch`
// or `semver/patch: `, so removing it leaves the rest of the sentence intact.
// Whitespace is only consumed next to punctuation that is consumed too (or
// directly before the phrase), so removing `semver/patch` from `Bumped
// semver/patch version` leaves `Bumped version`, never `Bumpedversion`.
const META_CLAUSE = new RegExp(
  `(?:\\s*[;,:\u2013\u2014-])?\\s*${META_PHRASE}(?:\\s*[;,:\u2013\u2014-])?`,
  'gi',
);

// Words that look like APIs but are prose. Compared case-insensitively
// without any trailing period.
const BACKTICK_ALLOWLIST = new Set(
  [
    'Node.js',
    'Electron.js',
    'Squirrel.Mac',
    'Squirrel.Windows',
    'e.g',
    'i.e',
    'etc',
    'vs',
    'Chromium',
    'V8',
    'macOS',
    'iOS',
    'tvOS',
    '.NET',
    'iPhone',
    'iPad',
    'iCloud',
    'sRGB',
    'webOS',
    'JavaScript',
    'TypeScript',
    'DevTools',
    'GitHub',
    'WebAssembly',
    'WebAuthn',
    'WebSocket',
    'WebSockets',
    'WebKit',
    'PowerShell',
    'FaceTime',
    'YouTube',
    'MacBook',
    'AppKit',
    'CoreAudio',
    'PipeWire',
    'FreeBSD',
    'OpenSSL',
    'BoringSSL',
  ].map((word) => word.toLowerCase()),
);

// Outside backticks, in order: URLs (kept as-is), dotted identifiers with an
// optional call, bare calls, CLI flags, angle-bracket tags, camelCase names,
// environment variables (`ELECTRON_RUN_AS_NODE`), and Electron's own
// multi-word class names (`WebContents`, `BrowserWindow`). Other PascalCase
// words are left alone, since most are product names (`WhatsApp`, `OneDrive`).
// Every alternative is anchored (lookbehind or `\b`) and the URL alternative
// is bounded, so a long spaceless token cannot make the scan quadratic: the
// note text is attacker-controlled (any fork PR), like the body in note-utils.
const API_TOKEN =
  /(?<![\w+.-])[a-z][\w+.-]{0,63}:\/\/\S{1,2048}|(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?|\b\w+\(\)|--[\w-]+|<\/?\w+>|\b[a-z]+[A-Z][A-Za-z\d]*\b|\b[A-Z][A-Z\d]*(?:_[A-Z\d]+)+\b|\b(?:BaseWindow|BrowserView|BrowserWindow|ClientRequest|CommandLine|DownloadItem|ImageView|IncomingMessage|IpcMainEvent|IpcMainInvokeEvent|IpcMainServiceWorkerEvent|IpcRendererEvent|MenuItem|MessageChannelMain|MessagePortMain|NativeImage|NavigationHistory|ServiceWorkerMain|ServiceWorkers|ShareMenu|TouchBar\w*|UtilityProcess|WebContents|WebContentsView|WebFrame|WebFrameMain|WebRequest)\b/g;

// A note line longer than this is not style-checked at all (only its length
// is reported), which keeps the per-line regex work bounded.
export const MAX_LINT_LINE_LENGTH = 2000;

// The style guide's limit for a one-line note or a single bullet.
export const MAX_NOTE_LENGTH = 160;

// Backport notes ("Backported fixes for CVE-2026-1234, ...", "Backported a fix
// in Skia for 123456.") follow a fixed convention and often list every bug they
// fix, so they are exempt from the length limit and from the Claude review.
const SECURITY_BACKPORT = /^(security: )?backported\b/i;
const lengthExempt = (item: string) => SECURITY_BACKPORT.test(item);

// True when any line of the note is a backport line.
export const hasBackportLine = (note: string) => noteItems(note).some(lengthExempt);

// True when every line of the note is a security backport line.
export const isSecurityBackportNote = (note: string) => {
  const items = noteItems(note);
  return items.length > 0 && items.every(lengthExempt);
};

// The note's lines (or bullets) with any bullet marker removed.
const noteItems = (note: string) =>
  unescapeNote(note)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/^[*-]\s+/, ''));

// True when some line is over MAX_NOTE_LENGTH but still short enough to be
// linted (and reviewed) at all.
export const exceedsNoteLength = (note: string) => {
  const items = noteItems(note);
  return (
    items.some((item) => item.length > MAX_NOTE_LENGTH && !lengthExempt(item)) &&
    items.every((item) => item.length <= MAX_LINT_LINE_LENGTH)
  );
};

const CODE_SPAN = /`[^`]*`/g;

const looksLikeProse = (token: string) => {
  const bare = token.replace(/\.$/, '').toLowerCase();
  return (
    token.includes('://') ||
    /^v?\d+(\.\d+)*$/i.test(bare) ||
    /\.(com|org|io|dev|net)$/.test(bare) ||
    BACKTICK_ALLOWLIST.has(bare)
  );
};

// Applies fn to the stretches of text that are not already inside backticks.
const mapOutsideCode = (line: string, fn: (text: string) => string) => {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(CODE_SPAN)) {
    out += fn(line.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fn(line.slice(last));
};

const wrapApiTokens = (line: string) => {
  const wrapped: string[] = [];
  const fixed = mapOutsideCode(line, (text) =>
    text.replace(API_TOKEN, (token) => {
      if (looksLikeProse(token)) return token;
      // Keep a sentence-ending period outside the backticks.
      const core = token.replace(/\.$/, '');
      wrapped.push(core);
      return `\`${core}\`${token.slice(core.length)}`;
    }),
  );
  return { fixed, wrapped };
};

const countSentences = (line: string) => {
  const prose = line.replace(CODE_SPAN, 'x').replace(/\b(e\.g|i\.e|etc|vs)\./gi, '$1');
  return prose.match(/[.!?]+(?=\s|$)/g)?.length ?? 0;
};

const firstWord = (line: string) => /^([A-Za-z][\w-]*)/.exec(line)?.[1] ?? null;

// Lints one line (a one-line note or a single bullet) and returns both the
// findings and the line with every mechanical fix applied.
// A later bullet such as "Use `X` instead of `Y`." tells apps what to do about
// the change above it; it is an instruction, not a change to put in past tense.
const INSTRUCTION = /^\w+\b.*\binstead\b/i;

const lintLine = (
  original: string,
  { instruction = false } = {},
): { findings: LintFinding[]; fixed: string } => {
  const findings: LintFinding[] = [];
  let line = original;

  const prefix = COMMIT_PREFIX.exec(line);
  if (prefix) {
    line = line.slice(prefix[0].length);
    findings.push({
      rule: 'commit-prefix',
      message: `Drop the commit-style prefix "${prefix[0].trim()}"; notes are for users, not commit logs.`,
      suggestion: line,
    });
  }

  const meta = META_TEXT.exec(line);
  if (meta) {
    // Remove just the metadata and keep any real note around it (e.g. `Fixed a
    // crash on Windows; semver/patch.` keeps `Fixed a crash on Windows.`). A
    // note that is only metadata (e.g. `(semver/patch)` or `No user-facing
    // change; semver/none.`) is a `Notes: none`, not an empty note to punctuate.
    // A phrase that was its own sentence (`See breaking changes. Also ...`)
    // leaves its period behind, so orphaned and doubled sentence punctuation
    // is normalised anywhere in the line, not just at the end.
    const stripped = line
      .replace(META_PARENTHETICAL, '')
      .replace(META_CLAUSE, '')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([.!?])[.,;:]+(?=\s|$)/g, '$1')
      .replace(/^[.,;:!?]+\s*/, '')
      .trim();
    line = /[A-Za-z\d]/.test(stripped) && !MANGLED_NONE.test(line) ? stripped : 'none';
    findings.push({
      rule: 'meta-text',
      message: `Leave out metadata like "${meta[0]}"; use \`Notes: none\` for changes users won't notice.`,
      suggestion: line,
    });
    if (line === 'none') return { findings, fixed: line };
  }

  // Decided after backtick wrapping below: a line that ends up starting with a
  // code span (e.g. `webContents.print()`) needs no capital, and capitalizing
  // it here would corrupt the API's casing in the suggestion.
  const lowercaseStart = /^[a-z]/.test(line);
  const capitalizedIndex = findings.length;
  const capitalized = lowercaseStart ? line[0].toUpperCase() + line.slice(1) : null;

  const needsPeriod = !/[.!?][`)]*$/.test(line);
  if (needsPeriod) {
    findings.push({
      rule: 'punctuated',
      message: 'End the note with a period.',
      suggestion: `${line}.`,
    });
  }

  const verb = firstWord(line);
  const pastTense = verb && !instruction && PAST_TENSE[verb.toLowerCase()];
  if (pastTense) {
    line = pastTense + line.slice(verb.length);
    findings.push({
      rule: 'past-tense',
      message: `Use the past tense: "${pastTense}" instead of "${verb}".`,
      suggestion: line,
    });
  }

  const article = /^Fixed (crash|issue|bug|regression|leak)\b/.exec(line);
  if (article) {
    const fixedWith = `Fixed ${/^[aeiou]/.test(article[1]) ? 'an' : 'a'} ${article[1]}`;
    line = line.replace(article[0], fixedWith);
    findings.push({
      rule: 'article',
      message: `Say "${fixedWith}", not "${article[0]}".`,
      suggestion: line,
    });
  }

  const platforms = fixPlatformCase(line);
  if (platforms.fixed.length > 0) {
    line = platforms.result;
    findings.push({
      rule: 'platform-case',
      message: `Capitalize platform names: ${platforms.fixed.join(', ')}.`,
      suggestion: line,
    });
  }

  const { fixed, wrapped } = wrapApiTokens(line);
  if (wrapped.length > 0) {
    line = fixed;
    findings.push({
      rule: 'backticks',
      message: `Wrap API names, calls, flags and tags in backticks: ${wrapped.map((t) => `\`${t}\``).join(', ')}.`,
      suggestion: line,
    });
  }

  const needsCapital = lowercaseStart && !line.startsWith('`');
  if (needsCapital && capitalized) {
    findings.splice(capitalizedIndex, 0, {
      rule: 'capitalized',
      message: 'Start the note with a capital letter.',
      suggestion: capitalized,
    });
    line = line[0].toUpperCase() + line.slice(1);
  }
  if (needsPeriod) line += '.';

  return { findings, fixed: line };
};

// Platform names written in the wrong case. "windows" is only fixed where it
// clearly names the platform ("on windows", "arm64 windows", "windows native"),
// since it is also an ordinary word. URLs are skipped.
const PLATFORM_CASE =
  /(\S+:\/\/\S*)|\b(mac ?os)\b|\b(linux|wayland|x11)\b|\b(on|arm|arm64|x64|ia32) (windows)\b|\b(windows) (native|arm64|x64|ia32|\d+)\b/gi;

const PROPER_NAMES: Record<string, string> = { linux: 'Linux', wayland: 'Wayland', x11: 'X11' };

const fixPlatformCase = (line: string) => {
  const fixed: string[] = [];
  const result = mapOutsideCode(line, (text) =>
    text.replace(PLATFORM_CASE, (match, url, mac, linux, before, win1, win2, after) => {
      if (url) return match;
      if (mac) {
        if (mac === 'macOS') return match;
        fixed.push(`"${mac}" → "macOS"`);
        return 'macOS';
      }
      if (linux) {
        const proper = PROPER_NAMES[linux.toLowerCase()];
        if (linux === proper) return match;
        fixed.push(`"${linux}" → "${proper}"`);
        return proper;
      }
      const win = win1 ?? win2;
      if (win === 'Windows') return match;
      fixed.push(`"${win}" → "Windows"`);
      return win1 ? `${before} Windows` : `Windows ${after}`;
    }),
  );
  return { result, fixed };
};

const describesBreakingChange = (line: string) =>
  /^`?(removed|changed|deprecated|renamed|dropped)\b/i.test(line) ||
  // A major dependency upgrade names the version apps now get.
  /^(updated|upgraded|bumped) \S+.* to v?\d/i.test(line) ||
  /\bno longer\b/i.test(line) ||
  // "now" followed by what happens ("now throws", "is now required"), but not
  // "for now", "right now" or "now and then".
  /(?<!\b(?:for|right|until|by|just|even|from) )\bnow\s+(?!and\b|on\b)[a-z]/i.test(line);

// findNoteInPRBody escapes angle brackets; this undoes that so tags are visible.
export const unescapeNote = (note: string) => note.replaceAll('&lt;', '<').replaceAll('&gt;', '>');

// A note as it would appear in a PR body: one-line, or `Notes:` over bullets.
export const formatNotesBlock = (note: string) =>
  note.includes('\n') ? `Notes:\n${note}` : `Notes: ${note}`;

export const analyzeNote = (note: string, ctx: LintContext): LintResult => {
  const lines = unescapeNote(note)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const bulleted = lines.length > 1 || /^[*-]\s/.test(lines[0] ?? '');
  const items = lines.map((line) => line.replace(/^[*-]\s+/, ''));

  const findings: LintFinding[] = [];
  const fixedItems: string[] = [];
  let changed = false;

  items.forEach((item, i) => {
    const prefix = bulleted ? `Bullet ${i + 1}: ` : '';
    if (item.length > MAX_LINT_LINE_LENGTH) {
      findings.push({
        rule: 'length',
        message: `${prefix}This ${bulleted ? 'bullet' : 'note'} is over ${MAX_LINT_LINE_LENGTH} characters; shorten it.`,
      });
      fixedItems.push(item);
      return;
    }
    const result = lintLine(item, { instruction: i > 0 && INSTRUCTION.test(item) });
    findings.push(...result.findings.map((f) => ({ ...f, message: prefix + f.message })));
    // Measured after the mechanical fixes (added backticks can push a line over).
    if (result.fixed.length > MAX_NOTE_LENGTH && !lengthExempt(result.fixed)) {
      const fixedNote = result.fixed === item ? '' : ' with the fixes above';
      findings.push({
        rule: 'length',
        message: `${prefix}This ${bulleted ? 'bullet' : 'note'} is ${result.fixed.length} characters${fixedNote}; keep it to at most ${MAX_NOTE_LENGTH} by dropping detail readers can find in the PR.`,
      });
    }
    if (result.fixed !== item) changed = true;
    fixedItems.push(result.fixed);
  });

  if (!bulleted && items.length === 1) {
    const line = items[0];
    if (line.length <= MAX_NOTE_LENGTH && countSentences(line) > 2) {
      findings.push({
        rule: 'length',
        message:
          'This note is long; consider splitting it into bullets (`Notes:` on its own line, then `* ...` lines).',
      });
    }
  }

  // Checked on the fixed text, so "Bump Node.js to v22" counts as the
  // "Updated Node.js to v22" the author is shown.
  if (ctx.labels.includes(BREAKING_LABEL) && !fixedItems.some(describesBreakingChange)) {
    findings.push({
      rule: 'breaking-described',
      message: `This PR is ${BREAKING_LABEL}; say what breaks for app developers.`,
    });
  }

  const fixed = bulleted ? fixedItems.map((line) => `* ${line}`).join('\n') : fixedItems[0];
  return { findings, fixed: changed ? fixed : null };
};

export const lintNote = (note: string, ctx: LintContext): LintFinding[] =>
  analyzeNote(note, ctx).findings;

// Escapes angle brackets outside backticks so GitHub does not swallow a raw
// `<webview>` as HTML; inside inline code they render literally.
export const escapeProse = (text: string) =>
  mapOutsideCode(text, (prose) => prose.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));

// A shorter rewrite from the Claude review, shown in place of the mechanical
// fix when the note is over the length limit.
export interface LintRewrite {
  suggestion: string;
  reasons: string[];
}

// Model output: keep it from opening or closing a code fence in the comment.
export const stripFences = (text: string) => text.replace(/`{3,}/g, '').trim();

export const createLintCommentBody = ({ findings, fixed }: LintResult, rewrite?: LintRewrite) => {
  const bullets = findings.map((f) => {
    const suggestion = f.suggestion ? `\n  Suggestion: ${escapeProse(f.suggestion)}` : '';
    return `- ${escapeProse(f.message)}${suggestion}`;
  });
  let suggested = fixed ? `\n\nSuggested note:\n\n\`\`\`\n${formatNotesBlock(fixed)}\n\`\`\`` : '';
  if (rewrite) {
    const reasons = rewrite.reasons
      .map(stripFences)
      .filter((reason) => reason !== '')
      .map((reason) => `\n- ${escapeProse(reason)}`)
      .join('');
    suggested =
      `\n\nSuggested shorter note (written by Claude; it may be wrong, so keep your own facts):\n\n` +
      `\`\`\`\n${formatNotesBlock(stripFences(rewrite.suggestion))}\n\`\`\`` +
      (reasons ? `\n${reasons}` : '');
  }

  return (
    [
      LINT_COMMENT_MARKER,
      '**Release note style suggestions**',
      '',
      `The \`Notes:\` line in this PR does not match the [release notes style guide](${STYLE_GUIDE_URL}) yet:`,
      '',
      ...bullets,
    ].join('\n') +
    suggested +
    '\n\nThis comment updates as the PR description is edited.'
  );
};
