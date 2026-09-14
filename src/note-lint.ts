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

const COMMIT_PREFIX = /^\w+(\([^)]*\))?!?:\s+/;

const META_TEXT =
  /semver\/(none|patch|minor|major)|no user[- ]facing|see breaking changes|\bno-notes\b/i;
// A parenthetical that is only metadata, e.g. `(See breaking changes.)`.
const META_PARENTHETICAL =
  /\s*\([^()]*(?:semver\/|no user[- ]facing|see breaking changes|no-notes)[^()]*\)/gi;

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
    'webOS',
  ].map((word) => word.toLowerCase()),
);

// Outside backticks, in order: URLs (kept as-is), dotted identifiers with an
// optional call, bare calls, CLI flags, angle-bracket tags, camelCase names.
// Every alternative is anchored (lookbehind or `\b`) and the URL alternative
// is bounded, so a long spaceless token cannot make the scan quadratic: the
// note text is attacker-controlled (any fork PR), like the body in note-utils.
const API_TOKEN =
  /(?<![\w+.-])[a-z][\w+.-]{0,63}:\/\/\S{1,2048}|(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?|\b\w+\(\)|--[\w-]+|<\/?\w+>|\b[a-z]+[A-Z][A-Za-z\d]*\b/g;

// A note line longer than this is not style-checked at all (only its length
// is reported), which keeps the per-line regex work bounded.
export const MAX_LINT_LINE_LENGTH = 2000;

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
const lintLine = (original: string): { findings: LintFinding[]; fixed: string } => {
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
    const stripped = line.replace(META_PARENTHETICAL, '').trim();
    // A note that is only metadata (e.g. `(semver/patch)`) strips to nothing;
    // that is a `Notes: none`, not an empty note to punctuate.
    line = stripped === '' || META_TEXT.test(stripped) ? 'none' : stripped;
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
  const pastTense = verb && PAST_TENSE[verb.toLowerCase()];
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
    line = line.replace(article[0], `Fixed a ${article[1]}`);
    findings.push({
      rule: 'article',
      message: `Say "Fixed a ${article[1]}", not "${article[0]}".`,
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

const describesBreakingChange = (line: string) =>
  /^`?(removed|changed|deprecated|renamed|dropped)\b/i.test(line) ||
  /\b(no longer|now requires|is now|are now)\b/i.test(line);

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
    const result = lintLine(item);
    findings.push(...result.findings.map((f) => ({ ...f, message: prefix + f.message })));
    if (result.fixed !== item) changed = true;
    fixedItems.push(result.fixed);
  });

  if (!bulleted && items.length === 1) {
    const line = items[0];
    if (line.length <= MAX_LINT_LINE_LENGTH && (line.length > 300 || countSentences(line) > 2)) {
      findings.push({
        rule: 'length',
        message:
          'This note is long; consider splitting it into bullets (`Notes:` on its own line, then `* ...` lines).',
      });
    }
  }

  if (ctx.labels.includes(BREAKING_LABEL) && !items.some(describesBreakingChange)) {
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

export const createLintCommentBody = ({ findings, fixed }: LintResult) => {
  const bullets = findings.map((f) => {
    const suggestion = f.suggestion ? `\n  Suggestion: ${escapeProse(f.suggestion)}` : '';
    return `- ${escapeProse(f.message)}${suggestion}`;
  });
  const suggested = fixed
    ? `\n\nSuggested note:\n\n\`\`\`\n${formatNotesBlock(fixed)}\n\`\`\``
    : '';

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
