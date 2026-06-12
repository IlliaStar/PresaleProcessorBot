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

const execLog = [];
function execTracked(label, cmd, opts = {}) {
  try {
    const result = exec(cmd, opts);
    execLog.push({ step: label, ok: true });
    return result;
  } catch (e) {
    execLog.push({ step: label, ok: false, err: e.message?.split('\n')[0] });
    throw e;
  }
}

const BRANCH = exec('git rev-parse --abbrev-ref HEAD');

// ── 1. Stage & commit ─────────────────────────────────────────────────────
execTracked('git add -A', 'git add -A');

if (execSilent('git diff --cached --quiet')) {
  console.log(JSON.stringify({ error: 'nothing to commit after git add', branch: BRANCH }));
  process.exit(0);
}

execTracked('git commit', `git commit -m "${COMMIT_MSG.replace(/"/g, '\\"')}"`);
const COMMIT_HASH = exec('git rev-parse HEAD');

// Parse diff stat for counts
const DIFF_STAT = execSilent('git diff --stat HEAD~1..HEAD');
const filesChanged = parseInt((DIFF_STAT.match(/(\d+) file/) || [])[1] || '1', 10);
const insertions = parseInt((DIFF_STAT.match(/(\d+) insertion/) || [])[1] || '0', 10);
const deletions = parseInt((DIFF_STAT.match(/(\d+) deletion/) || [])[1] || '0', 10);
const changedFiles = execSilent('git diff --name-only HEAD~1..HEAD').split('\n').filter(Boolean);

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
      execTracked('git pull --rebase', `git pull --rebase origin ${BRANCH}`);
      behindResolved = 'rebased';
      execTracked('git push', `git push origin ${BRANCH}`);
      pushed = true;
    } catch (e) {
      exec('git rebase --abort', { silent: true });
      behindResolved = 'conflict';
      pushed = false;
    }
  } else {
    execTracked('git push', `git push -u origin ${BRANCH}`);
    pushed = true;
    behindResolved = 'synced';
  }
} catch {
  // First push
  execTracked('git push', `git push -u origin ${BRANCH}`);
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
  changedFiles,
  behindResolved,
  pushed,
  execLog,
}, null, 2));