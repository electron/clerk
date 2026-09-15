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

* Omit notes for changes that users won't care about.
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
* `backticks`: API names, calls, CLI flags and tags such as `webContents.print()`, `--enable-foo`, `<webview>` are wrapped in backticks.
* `article`: `Fixed a crash`, not `Fixed crash`.
* `length`: a single-line note over 300 characters or more than two sentences should become bullets.
* `breaking-described`: a `semver/major` PR's note says what breaks (starts with `Removed`/`Changed`/`Deprecated`/`Renamed`/`Dropped`, or contains `no longer`, `now requires`, `is now`).

Bot-authored PRs and trop backports (`Backport of #...`) are not linted.

## Claude review of the note

Once a note passes the style rules above, clerk can ask Claude for a second,
advisory opinion on what the rules cannot judge: whether the note tells an app
developer what actually changed. It looks for

* vague notes (`Improved runtime performance.` should say what got faster or why),
* internal jargon and C++ class names (`UAF` should be `use-after-free crash`;
  `NativeWindowViews::SetBounds()` should become the user-visible effect),
* notes that read like a commit subject or describe the implementation rather
  than the effect on apps,
* for `semver/major` PRs, whether the note says what breaks.

When Claude has a rewrite, clerk posts it (with one to three short reasons) in
the same comment the style lint uses. This is advisory only: the
`release-notes` status stays green (`Release notes found (suggestion posted)`),
and any API error or timeout is logged and ignored. The review is one request
with no retries and a hard 15-second deadline; past the deadline the note is
treated as fine and nothing is posted. It runs in the background: the webhook
is acknowledged immediately and the comment and status follow once Claude
answers. If the PR is pushed to, its description edited or it is closed while
the review is running, that result is discarded: only the newest event for a
PR writes. Only the note, the PR title and the labels are sent, never the PR
body or diff. Complete verdicts are cached in memory by
note, title and labels so pushes that do not touch the description do not call
the API again.

To enable it, set `ANTHROPIC_API_KEY` on the Heroku app; without it this step
is skipped. Cost is roughly one small Sonnet call (a few hundred input tokens,
at most 400 output tokens) per change to a PR's note.

## Overriding the check

Add the `release-notes-override` label to a PR to force the `release-notes`
check to success, whatever the note looks like (including a missing note).
Clerk re-runs on label changes, so the status updates as soon as the label is
added.

**Your release bot overlords thank you.**

