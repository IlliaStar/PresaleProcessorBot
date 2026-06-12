#!/usr/bin/env node
/**
 * git-sync-summary.js — Analyze working tree and emit structured commit proposal as JSON.
 *
 * Output: { isClean, type, scope, description, commitMessage, files{staged,unstaged,untracked},
 *           totalInsertions, totalDeletions, branch, behindRemote,
 *           hasUntracked, untrackedCount, untrackedWarnings[], error? }
 *
 * Usage: node scripts/git-sync-summary.js
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function execSilent(cmd) {
  return exec(cmd, { silent: true });
}

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

// ── 1. Status ─────────────────────────────────────────────────────────────
const STATUS_SHORT = execSilent('git status --porcelain');
if (!STATUS_SHORT) {
  console.log(JSON.stringify({ isClean: true, message: 'nothing to commit, working tree clean' }));
  process.exit(0);
}

// ── 2. Parse status — staged, unstaged, untracked ─────────────────────────
const staged = [];
const unstaged = [];
const untracked = [];

STATUS_SHORT.split('\n').filter(Boolean).forEach(line => {
  const index = line[0];
  const worktree = line[1];
  const file = line.substring(3);

  if (index !== ' ' && index !== '?') staged.push({ path: file, status: index + worktree });
  if (worktree !== ' ' && worktree !== '?') unstaged.push({ path: file, status: index + worktree });
  if (index === '?' && worktree === '?') untracked.push({ path: file });
});

// ── 3. Diff stat vs HEAD ──────────────────────────────────────────────────
const DIFF_STAT = execSilent('git diff HEAD --stat');
let totalInsertions = 0;
let totalDeletions = 0;
const statMatch = DIFF_STAT.match(/(\d+) insertion/);
if (statMatch) totalInsertions = parseInt(statMatch[1], 10);
const delMatch = DIFF_STAT.match(/(\d+) deletion/);
if (delMatch) totalDeletions = parseInt(delMatch[1], 10);

const CHANGED_FILES = execSilent('git diff --name-only HEAD').split('\n').filter(Boolean);
const UNT_LIST = execSilent('git ls-files --others --exclude-standard').split('\n').filter(Boolean);
const ALL_CHANGED = [...CHANGED_FILES, ...UNT_LIST];

// ── 4. Type detection ─────────────────────────────────────────────────────
let type = 'feat';
let scope = '';
let isOnlyScripts = false;
let scriptsFiles = 0;

if (ALL_CHANGED.length) {
  const allMd = ALL_CHANGED.every(f => f.endsWith('.md'));
  if (allMd) type = 'docs';

  const configExts = /\.(md|yml|yaml|json|env.*)$/;
  const configFiles = [/package\.json$/, /tsconfig/, /docker-compose/, /Dockerfile/, /\.gitignore/];
  const allConfig = ALL_CHANGED.every(f =>
    configExts.test(f) || configFiles.some(re => re.test(f))
  );
  if (allConfig && type !== 'docs') type = 'chore';

  if (totalDeletions > 0 && totalDeletions > totalInsertions * 2) type = 'refactor';

  scriptsFiles = ALL_CHANGED.filter(f => f.startsWith('scripts/')).length;
  if (scriptsFiles > 0) {
    isOnlyScripts = ALL_CHANGED.every(f =>
      f.startsWith('scripts/') || f.startsWith('.claude/commands/')
    );
    if (isOnlyScripts && type === 'feat') type = 'refactor';
  }

  // Scope
  const n8nFiles = ALL_CHANGED.filter(f => f.includes('orchestrator/n8n/')).length;
  const botFiles = ALL_CHANGED.filter(f => f.includes('microsoft-teams-bot/')).length;
  const claudeFiles = ALL_CHANGED.filter(f => f.startsWith('.claude/')).length;

  if (n8nFiles && !botFiles && !scriptsFiles && !claudeFiles) scope = 'n8n';
  else if (botFiles && !n8nFiles && !scriptsFiles && !claudeFiles) scope = 'bot';
  else if (claudeFiles && !n8nFiles && !botFiles && !scriptsFiles) scope = 'claude';
  else if (scriptsFiles && !n8nFiles && !botFiles && !claudeFiles) scope = 'scripts';
}

// ── 5. Description ────────────────────────────────────────────────────────
let description = 'update project files';
if (ALL_CHANGED.length) {
  const nouns = [...new Set(
    ALL_CHANGED
      .map(f => path.basename(f).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').toLowerCase())
      .filter(Boolean)
      .flatMap(s => s.split(' '))
  )].slice(0, 6).join(', ');

  if (type === 'docs') {
    if (ALL_CHANGED.some(f => /prompts?|readme|guide|manual/i.test(f))) description = 'update prompts and guides';
    else if (ALL_CHANGED.some(f => /commands?|\.claude\//.test(f))) description = 'update slash commands';
    else description = 'update documentation';
  } else if (type === 'refactor') {
    description = `restructure ${nouns}`;
  } else if (type === 'chore') {
    description = `update config for ${nouns}`;
  } else if (isOnlyScripts) {
    description = `add scripts for ${nouns}`;
  } else {
    description = `update ${nouns}`;
  }
}

// ── 6. Build commit message (fit ≤72 chars) ──────────────────────────────
const statSuffix = (totalInsertions + totalDeletions) > 100
  ? ` (+${totalInsertions}/-${totalDeletions})`
  : '';
const msgPrefix = scope ? `${type}(${scope}): ` : `${type}: `;
const descMax = Math.max(30, 60 - statSuffix.length);
description = description.slice(0, descMax) || 'update project files';
let commitMessage = `${msgPrefix}${description}${statSuffix}`.slice(0, 72);

// ── 7. Remote check ──────────────────────────────────────────────────────
const branch = exec('git rev-parse --abbrev-ref HEAD');
let behindRemote = '0';

try {
  execTracked('git fetch', `git fetch --no-tags origin ${branch}`, { silent: true });
} catch { exec('git fetch origin', { silent: true }); }

try {
  exec(`git rev-parse --quiet --verify origin/${branch}`, { silent: true });
  behindRemote = exec(`git rev-list --count HEAD..origin/${branch}`, { silent: true }) || '0';
  execLog.push({ step: 'remote check', ok: true, behind: parseInt(behindRemote, 10) });
} catch { behindRemote = 'no-remote'; }

// ── 8. Untracked warnings ─────────────────────────────────────────────────
const untrackedWarnings = [];
if (UNT_LIST.length) {
  for (const f of UNT_LIST) {
    try {
      const stat = fs.statSync(f);
      if (stat.size > 1048576) untrackedWarnings.push(`large: ${f} (${stat.size} bytes)`);
      if (/\.claude\/(projects|memory)\//.test(f)) untrackedWarnings.push(`memory: ${f}`);
    } catch { /* skip unreadable */ }
  }
}

// ── 9. Output ─────────────────────────────────────────────────────────────
console.log(JSON.stringify({
  isClean: false,
  branch,
  type,
  scope,
  description,
  commitMessage,
  files: { staged, unstaged, untracked },
  totalInsertions,
  totalDeletions,
  behindRemote,
  hasUntracked: UNT_LIST.length > 0,
  untrackedCount: UNT_LIST.length,
  untrackedWarnings,
  execLog,
}, null, 2));