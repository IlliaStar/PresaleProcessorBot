#!/usr/bin/env node
/**
 * git-sync-commit-push.js — Stage all, commit, sync with remote, push.
 *
 * Output: JSON with { branch, commitHash, commitMessage, filesChanged,
 *           insertions, deletions, behindResolved, pushed, error? }
 *
 * Usage: node scripts/git-sync-commit-push.js "<commit-message>"
 */
'use strict';

const { execSync } = require('child_process');

const COMMIT_MSG = process.argv[2];
if (!COMMIT_MSG) {
  console.log(JSON.stringify({
    error: 'commit message is required',
    usage: 'node scripts/git-commit-push.js "<commit-message>"'
  }));
  process.exit(1);
}

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
process.chdir(ROOT);

function exec(cmd, opts = {}) {
  const { silent, ...execOpts } = opts;
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...execOpts }).trim();
  } catch (e) {
    if (silent) return '';
    throw e;
  }
}

function execSilent(cmd) { return exec(cmd, { silent: true }); }

const BRANCH = exec('git rev-parse --abbrev-ref HEAD');

// ── 1. Stage & commit ─────────────────────────────────────────────────────
exec('git add -A');

if (execSilent('git diff --cached --quiet')) {
  console.log(JSON.stringify({ error: 'nothing to commit after git add', branch: BRANCH }));
  process.exit(0);
}

exec(`git commit -m "${COMMIT_MSG.replace(/"/g, '\\"')}"`);
const COMMIT_HASH = exec('git rev-parse HEAD');

// Parse diff stat for counts
const DIFF_STAT = execSilent('git diff --stat HEAD~1..HEAD');
const filesChanged = parseInt((DIFF_STAT.match(/(\d+) file/) || [])[1] || '1', 10);
const insertions = parseInt((DIFF_STAT.match(/(\d+) insertion/) || [])[1] || '0', 10);
const deletions = parseInt((DIFF_STAT.match(/(\d+) deletion/) || [])[1] || '0', 10);

// ── 2. Fetch & push ───────────────────────────────────────────────────────
let pushed = false;
let behindResolved = 'not-needed';

try {
  exec(`git fetch --no-tags origin ${BRANCH}`, { silent: true });
} catch { exec('git fetch origin', { silent: true }); }

try {
  exec(`git rev-parse --quiet --verify origin/${BRANCH}`, { silent: true });
  const behind = parseInt(exec(`git rev-list --count HEAD..origin/${BRANCH}`) || '0', 10);

  if (behind > 0) {
    try {
      exec(`git pull --rebase origin ${BRANCH}`);
      behindResolved = 'rebased';
      exec(`git push origin ${BRANCH}`);
      pushed = true;
    } catch (e) {
      exec('git rebase --abort', { silent: true });
      behindResolved = 'conflict';
      pushed = false;
    }
  } else {
    exec(`git push -u origin ${BRANCH}`);
    pushed = true;
    behindResolved = 'synced';
  }
} catch {
  // First push
  exec(`git push -u origin ${BRANCH}`);
  pushed = true;
  behindResolved = 'first-push';
}

console.log(JSON.stringify({
  branch: BRANCH,
  commitHash: COMMIT_HASH,
  commitMessage: COMMIT_MSG,
  filesChanged,
  insertions,
  deletions,
  behindResolved,
  pushed,
}, null, 2));