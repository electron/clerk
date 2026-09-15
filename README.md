[![Test](https://github.com/electron/clerk/actions/workflows/test.yml/badge.svg)](https://github.com/electron/clerk/actions/workflows/test.yml)

# What is Clerk?

Clerk ensures that release notes can be generated from PRs by looking for
a release note in the PR description. You can add a note to your PR by
adding a single line to its description beginning with `Notes: `.
A PR body with more than one `Notes:` line fails the check; to write
multiple notes, use a single `Notes:` followed by a bulleted list (see below).

# Examples
  
* **`commit -m` is for maintainers. `Notes:` is for users.**
  Describe the change in user terms.
  ```diff
  - Notes: Bump libcc to latest.
  - Notes: Backport patch to fix Widget::OnSizeConstraintsChanged crash (3.0.x)
  + Notes: Fixed crash in Widget::OnSizeConstraintsChanged.
  ```

* Omit notes for changes that users won't care about. A reason in parentheses is fine: `Notes: none (reverts an unreleased change)`.
  ```diff
  - Notes: only define WIN32_LEAN_AND_MEAN if not already defined
  + Notes: none
  ```

* For consistency in notes, use the past tense and capitalize and punctuate your notes.
  ```diff
  - Notes: fix ipcRemote.sendSync regression introduced in a previous 3.0.0 beta
  + Notes: Fixed ipcRemote.sendSync regression introduced in a previous 3.0.0 beta.
  - Notes: remove upstream code that used private Mac APIs
  + Notes: Removed upstream code that used private Mac APIs.
  ```

* Keep notes (and each bullet) to 120 characters or fewer.
  ```diff
  - Notes: Deprecated the synchronous `safeStorage.isEncryptionAvailable()`, `safeStorage.encryptString()` and `safeStorage.decryptString()` in favor of `isAsyncEncryptionAvailable()`, `encryptStringAsync()` and `decryptStringAsync()`.
  + Notes: Deprecated synchronous `safeStorage` functions.
  ```
  
* Multi-line release notes
  ```md
  Notes:
  * Line 1
  * Line 2
  ```

# Style rules clerk checks

Once a note is present, clerk lints it against the guide above and fails the
`release-notes` check when it finds any of the following, posting a single
comment with a suggested rewrite. The comment is updated (not re-posted) as
the description is edited. Bulleted notes are checked one bullet at a time.

* `capitalized`: starts with a capital letter (unless it starts with a backtick, `<`, or a digit).
* `punctuated`: ends with `.`, `!` or `?` (a closing backtick or `)` before it is fine).
* `past-tense`: does not start with a present-tense or imperative verb such as `fix`, `add`, `update`, `bump`.
* `commit-prefix`: no commit-style prefix like `fix:` or `feat(tray):`.
* `meta-text`: no `semver/none`, `no user-facing`, `see breaking changes` or `no-notes` mixed into the note. Use `Notes: none` instead.
* `backticks`: API names, calls, class names, CLI flags, tags and environment variables such as `webContents.print()`, `BrowserWindow`, `--enable-foo`, `<webview>`, `ELECTRON_RUN_AS_NODE` are wrapped in backticks.
* `article`: `Fixed a crash`, not `Fixed crash`.
* `platform-case`: platform names are capitalized (`macOS`, `Linux`, `Wayland`, `X11`, and `Windows` where it clearly names the platform, as in `on arm64 Windows`).
* `length`: a note or bullet is at most 120 characters (counted after the fixes above), and a single-line note with more than two sentences should become bullets. Backport notes (any note starting with `Backported`, such as `Backported fixes for CVE-...`) are exempt from the 120-character limit, and Claude only checks them for clear grammar errors and typos.
* `breaking-described`: a `semver/major` PR's note says what breaks (starts with `Removed`/`Changed`/`Deprecated`/`Renamed`/`Dropped`, says what `now` or `no longer` happens, or names the new version of an upgraded dependency).

Bot-authored PRs (other than `claude[bot]`) and trop backports (`Backport of #...`) are not linted.

## Claude review of the note

Once a note has been through the style rules above, clerk can ask Claude about
what the rules cannot judge.

* A note over the 120-character limit fails the `length` rule, which has no
  mechanical fix, so Claude writes a shorter version and clerk shows it in the
  failing comment. The check still fails until the author edits the note.
* Any other note that passes the rules gets an advisory suggestion only when it
  has a real problem: it is vague (`Fixed a bug.`), names internal or C++ code
  (`NativeWindowViews::SetBounds()`) instead of the effect on apps, reads like a
  commit subject, says the opposite of what it means (a fix that describes the
  correct behaviour as the bug), calls a new feature a fix, contradicts the PR
  title, describes a change that does not affect apps (which should be
  `Notes: none`), leaves out the platform, or, for `semver/major` PRs, does not
  say what breaks. Notes are never rewritten just to trim them.
  When the problem can be fixed from the note and the PR title, Claude suggests
  a rewrite; when it needs detail only the author has, Claude asks for it
  instead. Either is posted in the same comment the style lint uses, and the
  `release-notes` status stays green (`Release notes found (suggestion posted)`).

A rewrite keeps what app developers need: the kind of change, any instruction
they must act on, every condition that limits who is affected (platform,
options, triggers), public API and tool names, and the symptom users see. It
drops how the fix works, internal names and causes, and aims for about 100
characters.

How a review runs:

1. Claude Fable 5.1 (thinking on, default effort) writes three candidates in
   parallel. A note within the limit that none of them flags is left alone.
2. Candidates that change the kind of change (Claude labels both: fix,
   behaviour change, addition, deprecation, removal), fail the style rules, or
   drop a backticked name from the note without saying so in their reasons are
   set aside.
3. A judge, Claude Opus 5 at medium effort, checks the rest against the
   original note (facts, dropped conditions or API names, meaning, whether it
   reads as a plain headline, whether it is worth posting) and picks one or
   rejects them all with specific problems. For a note over the limit the
   judge works at high effort.
4. If all are rejected, the judge also writes its own corrected version, and
   the closest candidate gets a revision turn with the problems listed. Both are
   checked again: once more for a note within the limit, twice for a note over
   it, with a final check of the judge's last correction. If nothing is
   accepted, nothing is posted.

If a model's safety classifiers decline a request, the API reruns it on the
fallback model it recommends (`fallbacks: "default"`). Clerk acknowledges the
webhook first and runs the check and review afterwards, so a slow review never
fails the delivery. A review, including every call and SDK retry, is abandoned
after 5 minutes or 20 API calls and the note is treated as fine; API errors are
logged and ignored the same way. At most four reviews run at once; an event that
arrives while four are running skips the review. If the PR is pushed to or
its description edited while the review is running, that result is discarded
and the event for the newer change posts its own. Only the note, the PR title
(without its `fix:`-style prefix) and the labels are sent, never the PR body or
diff. Complete verdicts are cached in memory by note, title and labels so pushes
that do not touch the description do not call the API again.

To enable it, set `ANTHROPIC_API_KEY` on the Heroku app; without it this step
is skipped. The key's organization must allow Claude Fable 5.1 (it requires
30-day data retention). A review usually makes three to nine calls (three candidates, then
up to a few judge calls with a revision before each retry).

## Overriding the check

Add the `release-notes-override` label to a PR to force the `release-notes`
check to success, whatever the note looks like (including a missing note).
Clerk re-runs on label changes, so the status updates as soon as the label is
added.

**Your release bot overlords thank you.**

