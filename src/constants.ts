export const NO_NOTES_BODY = '**No Release Notes**';
export const NOTES_LEAD = '**Release Notes Persisted**';
export const SEMANTIC_BUILD_PREFIX = 'build:';
// Bot accounts whose PRs are written like a human's, so their notes are still
// linted and reviewed. Other bots (rollers, trop) are skipped.
export const LINTED_BOT_LOGINS = ['claude[bot]'];
export const OVERRIDE_LABEL = 'release-notes-override';
export const LINT_COMMENT_MARKER = '<!-- clerk-notes-lint -->';
export const LINT_COMMENT_RESOLVED = 'Release note looks good now.';
export const STYLE_GUIDE_URL = 'https://github.com/electron/clerk#style-rules-clerk-checks';
