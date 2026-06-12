# Git Push

Stage, commit with an auto-generated message, check remote for conflicts, and offer to sync.

**Usage:**
- `/git-push` — show changes, generate commit message, check remote, offer push

## Steps

### 1. Show current status

```bash
git status
git diff --stat
```

Show the working tree so the user sees what will be committed.

### 2. Generate commit message

Analyze the diff and generate a Conventional Commits message.

Logic:
1. Run `git diff --stat` to see changed files
2. Identify scope based on file paths:
   - `orchestrator/n8n/workflows/` → `feat(n8n):`
   - `microsoft-teams-bot/` → `feat(bot):`
   - `orchestrator/n8n/prompts/` → `feat(prompt):`
   - Mix of areas → `feat: <summary>`
3. Generate a short description by examining the diff (e.g., `add team-size field to intake`, `update estimate schema`, `fix webhook timeout`)

Show the generated message to the user and ask for confirmation via `AskUserQuestion`:
- Option 1: Use the generated message as-is
- Option 2 (Other — free text): Edit the message

### 3. Stage changes

```bash
git add -A
```

### 4. Create commit

```bash
git commit -m "<generated-or-edited-message>"
```

### 5. Check remote for changes (fetch + compare)

```bash
# Fetch latest from remote
git fetch origin

# Get current branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Check if remote branch exists and has diverged
REMOTE_EXISTS=$(git rev-parse --quiet --verify "origin/$BRANCH" 2>/dev/null && echo "yes" || echo "no")

if [ "$REMOTE_EXISTS" = "yes" ]; then
  BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null)
  if [ "$BEHIND" -gt 0 ]; then
    echo "⚠ Remote has $BEHIND new commit(s). Local branch is behind."
    CONFLICT_NEEDED=true
  else
    CONFLICT_NEEDED=false
  fi
else
  # No remote branch yet — first push (no conflict possible)
  CONFLICT_NEEDED=false
fi
```

### 6. Offer to sync with remote

Ask the user via `AskUserQuestion` with a preview of the commit and remote state:

**If remote is ahead (local behind):**
- "Pull rebase & push" → `git pull --rebase origin <branch> && git push origin <branch>`
- "Cancel" → exit cleanly

**If remote is behind or synced (no new remote commits, or no remote branch yet):**
- "Push" → `git push -u origin <branch>` (adds `-u` on first push)
- "Cancel" → exit cleanly

### 7. Report

```
## Git Push Complete ✓

| | |
|---|---|
| Branch | `feature/my-branch` |
| Commit | `abc1234 - feat(n8n): add team-size to intake` |
| Files | 3 changed, +45/-12 |
| Remote | origin — synced ✓ |
```

## Error Handling

- **`nothing to commit`** — no changes found; show `git status` and stop
- **`no upstream branch`** (first push) — use `git push -u origin <branch>` automatically
- **`merge conflict during rebase`** — abort the rebase with `git rebase --abort`, tell the user manual resolution is needed
- **`push rejected`** — remote has newer commits; advise pulling first
- **User cancels** — exit cleanly, no changes made