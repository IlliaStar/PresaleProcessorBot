# Git Sync

Stage all changes, generate a conventional commit message from the diff, commit, fetch, rebase if needed, and push. All mechanics in `scripts/git-sync-summary.js` and `scripts/git-sync-commit-push.js`.

**Usage:** `/git-sync`

## Steps

### 1. Run summary script

```bash
node scripts/git-sync-summary.js
```

Parse the JSON output for `isClean`, `commitMessage`, `branch`, `behindRemote`, `hasUntracked`, `files`, and `execLog`.

- If `isClean === true` → stop, tell user nothing to commit
- If `hasUntracked` → mention untracked paths

### 2. Show file list + confirm

Before asking for confirmation, display the files that will be committed, grouped by status:

```
**Files to commit:**
- Staged:    .claude/rules/n8n.md
- Unstaged:  CLAUDE.md, microsoft-teams-bot/src/bot.js
- Untracked: microsoft-teams-bot/scripts/ ⚠ (will be staged by git add -A)
```

Then ask one question with three options:

- **Option 1 (Recommended):** `"<commitMessage>"` and push to `origin/<branch>`
- **Option 2 (Other — free text):** Edit the commit message (then push automatically)
- **Option 3:** Cancel — exit cleanly

> If `behindRemote > 0` add: "⚠ Remote is ahead by N commits — will rebase."

> Only stage and commit if user confirms or edits. If cancelled, do nothing.

### 3. Run commit-push script

```bash
node scripts/git-sync-commit-push.js "<confirmed-message>"
```

Parse JSON output. Fields available: `commitHash`, `filesChanged`, `insertions`, `deletions`, `changedFiles[]`, `behindResolved`, `pushed`, `execLog[]`.

If `error` is set, report it. If `behindResolved === "conflict"`, report rebase conflict and instruct manual resolution.

### 4. Report

```
## Git Sync Complete ✓

| | |
|---|---|
| Branch | `<branch>` |
| Commit | `<hash> - <message>` |
| Files   | `<N> changed, +<N>/-<N>` |
| Changed | `file1.js, file2.md` (first 5, then "+N more" if over 5) |
| Remote  | origin/<branch> — <behindResolved> ✓ |
```

After the table, show the execution log as a compact inline trace:

```
**Steps:** git add -A ✓ → git commit ✓ → git fetch ✓ → git push ✓
```

Use ✓ for `ok: true` and ✗ for `ok: false`. If any step failed, call it out explicitly below the trace.
