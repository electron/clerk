[![Test](https://github.com/electron/clerk/actions/workflows/test.yml/badge.svg)](https://github.com/electron/clerk/actions/workflows/test.yml)

# What is Clerk?

Clerk ensures that release notes can be generated from PRs by looking for
a release note in the PR description. You can add a note to your PR by
adding a single line to its description beginning with `notes: `.

# Examples
  
* **`commit -m` is for maintainers. `notes:` is for users.**
  Describe the change in user terms.
  ```diff
  - notes: Bump libcc to latest.
  - notes: Backport patch to fix Widget::OnSizeConstraintsChanged crash (3.0.x)
  + notes: Fixed crash in Widget::OnSizeConstraintsChanged.
  ```

* Omit notes for changes that users won't care about.
  ```diff
  - notes: only define WIN32_LEAN_AND_MEAN if not already defined
  + notes: no-notes
  ```

* For consistency in notes, use the past tense and capitalize and punctuate your notes.
  ```diff
  - notes: fix ipcRemote.sendSync regression introduced in a previous 3.0.0 beta
  + notes: Fixed ipcRemote.sendSync regression introduced in a previous 3.0.0 beta.
  - notes: remove upstream code that used private Mac APIs
  + notes: Removed upstream code that used private Mac APIs.
  ```
  
* Multi-line release notes
  ```md
  Notes:
  * Line 1
  * Line 2
  ```

**Your release bot overlords thank you.**

