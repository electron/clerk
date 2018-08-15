# What is Clerk?

Clerk ensures that release notes can be generated from PRs by looking for a
[semantic-commit](https://seesparkbox.com/foundry/semantic_commit_messages)-like 
`notes: ` line in the PR description. Please add this line to make your
PR pass this check,

# How do I use it?

* **`commit -m` is for maintainers. `notes:` is for users.**
  Describe the change in user terms.
  ```diff
  - notes: Bump libcc to latest.
  - notes: Backport patch to fix Widget::OnSizeConstraintsChanged crash (3.0.x)
  + notes: Fixed crash in Widget::OnSizeConstraintsChanged.
  ```

* Omit notes for changes that users won't care about.
  ```diff
  - notes: roll libcc
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

**Your release bot overlords thank you.**

