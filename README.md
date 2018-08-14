# How do you use release notes?

All you need to do to make your PR pass the `release-notes` check is add a section
at the bottom of the PR body with the following format.

```markdown
notes: this is a human friendly sentence about what this PR does
```

## Good examples of release notes

```markdown
notes: removed upstream code that used private Mac APIs
```

```markdown
notes: fixed issue where electron crashes on exit
```

To tell `clerk` that this PR has no user-facing changes and should not be
included in release notes:

```markdown
notes: no-notes
```
