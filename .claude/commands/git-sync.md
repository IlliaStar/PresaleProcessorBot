# Git Sync

Stage all changes, generate a conventional commit message from the diff, commit, fetch, rebase if needed, and push. All mechanics in `scripts/git-sync-summary.js` and `scripts/git-sync-commit-push.js`.

**Usage:** `/git-sync`

## Steps

### 1. Run summary script

```bash
node scripts/git-sync-summary.js
```

Parse the JSON output for `isClean`, `commitMessage`, `branch`, `behindRemote`, `hasUntracked`, and `files`.

- If `isClean === true` → stop, tell user nothing to commit
- If `hasUntracked` or untracked file warnings → mention them to user

### 2. Confirm via AskUserQuestion

One question with three options:

- **Option 1 (Recommended):** `"<commitMessage>"` and push to `origin/<branch>`
- **Option 2 (Other — free text):** Edit the commit message (then push automatically)
- **Option 3:** Cancel — exit cleanly

> If `behindRemote > 0` add: "⚠ Remote is ahead by N commits — will rebase."

> Only stage and commit if user confirms or edits. If cancelled, do nothing.

### 3. Run commit-push script

```bash
node scripts/git-sync-commit-push.js "<confirmed-message>"
```

Parse JSON output. If `error` is set, report it. If `behindResolved === "conflict"`, report rebase conflict and instruct manual resolution.

### 4. Report

```
## Git Sync Complete ✓

| | |
|---|---|
| Branch | `<branch>` |
| Commit | `<hash> - <message>` |
| Files | `<N> changed, +<N>/-<N>` |
| Remote | origin/<branch> — <behindResolved> ✓ |
```