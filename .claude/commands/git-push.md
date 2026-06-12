# Git Push

Stage, commit with an auto-generated message (generated from `--stat` only — no full diff read), check remote, and offer to sync.

**Token-efficient design:**
- Commit message is generated from **`git diff --stat`** only (file paths + line counts), never from full file diffs
- Single `AskUserQuestion` combines commit confirmation + push decision
- `git add -A` only runs **after** user confirms, not before

**Usage:**
- `/git-push` — show changes, detect commit type, generate message, confirm, push

---

## Steps

### 1. Show status with untracked highlights

```bash
git status
git diff --stat
```

Also check for any **untracked files** that look suspicious (large binaries, cache dirs, `.claude/projects/` memory files) and mention them to the user.

### 2. Generate commit message (from `--stat` only — NO full diff read)

Use a **type-detection heuristic** based on file paths + stat ratio (additions vs deletions):

#### Type detection logic:

```
files = git diff --stat output

if any path is in orchestrator/n8n/prompts/ or orchestrator/n8n/workflows/:
  scope candidates: n8n
if any path is in microsoft-teams-bot/:
  scope candidates: bot

type = "feat"  (default)
if all changed files are .md only (excluding workflow json):
  type = "docs"
if stat shows deletions > additions × 2:
  type = "refactor"
if only config files (docker-compose.yml, .env*, package.json, tsconfig, etc.):
  type = "chore"

scope:
  if only one scope candidate → use it as (scope)
  if multiple → omit scope, use just "feat:"
  if none → omit scope

description:
  extract key nouns from file names — strip extensions, take meaningful segments
  combine with stat insight (e.g. "add X nodes" if new JSON nodes detected)
  keep under 72 chars
```

**Example outputs:**
- `orchestrator/n8n/workflows/presale-agent-workflow.json` + `microsoft-teams-bot/index.js` → `feat: add Adaptive Card support and presale selection`
- Only `*.md` files → `docs: update SharePoint prompt with Graph API URL guide`
- Config files only → `chore: update n8n env configuration`
- High delete/rewrite ratio → `refactor(bot): restructure proactive callback handling`

### 3. Confirm in a single AskUserQuestion

One question with commit preview + push option:

- **Option 1:** `"feat(bot): add Adaptive Card support and presale selection" and push to origin/develop`
- **Option 2 (Other — free text):** Edit the commit message (then push will happen automatically)
- **Option 3:** Cancel — exit cleanly

> Only stage and commit if user confirms or edits. If cancelled, do nothing.

### 4. Stage and commit (only after confirmation)

```bash
git add -A
git commit -m "<confirmed-message>"
```

### 5. Fetch + check remote

Run fetch and compare **before** pushing. Skip fetch if `--no-fetch` flag was passed.

```bash
# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Fetch (cheap — only new ref data, not full objects)
git fetch --no-tags origin "$BRANCH" 2>/dev/null || git fetch origin 2>/dev/null

# Check if remote branch exists
if git rev-parse --quiet --verify "origin/$BRANCH" >/dev/null 2>&1; then
  BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null)
else
  BEHIND="no-remote"
fi
```

### 6. Sync with remote

**If `BEHIND > 0`** (remote ahead):
```bash
git pull --rebase origin "$BRANCH"
if [ $? -ne 0 ]; then
  git rebase --abort 2>/dev/null
  echo "CONFLICT: rebase failed. Manual merge needed."
  exit 1
fi
git push origin "$BRANCH"
```

**If `BEHIND = 0`** (synced):
```bash
git push -u origin "$BRANCH"
```

**If `BEHIND = "no-remote"`** (first push):
```bash
git push -u origin "$BRANCH"
```

### 7. Report

Print summary:

```
## Git Push Complete ✓

| | |
|---|---|
| Branch | `develop` |
| Commit | `9f0ddf5 - feat(bot): add Adaptive Card support and presale selection flow` |
| Files | 9 changed, +383/-7 |
| Remote | origin/develop — synced ✓ |
```

---

## Error Handling

- **`nothing to commit`** — no changes; show `git status` and stop with a clean message
- **`merge conflict during rebase`** — `git rebase --abort`, then print: "⚠ Rebase failed due to conflicts. Resolve manually with `git pull --rebase`, then push."
- **`push rejected`** — remote has newer commits; print: "⚠ Push rejected. Remote has newer commits. Run `/git-push` again to auto-rebase."
- **User cancels** — clean exit, no files staged, no commit made
- **Large untracked files (>1 MB)** — warn before staging
- **`.claude/projects/` or `.claude/memory/` untracked** — mention them so user knows they'll be committed