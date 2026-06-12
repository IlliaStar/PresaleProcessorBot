#!/usr/bin/env node
/**
 * n8n-deploy-flow.js — Deploy n8n workflows to local n8n instance.
 *
 * Usage:
 *   node scripts/n8n-deploy-flow.js                          # deploy all
 *   node scripts/n8n-deploy-flow.js <name-fragment>           # deploy matching
 *   node scripts/n8n-deploy-flow.js <path/to/workflow.json>   # deploy single file
 *
 * Output: JSON with { targets, results[{file,wfId,status}], promptInjected,
 *           deployCount, verified, error? }
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const N8N_DIR = path.resolve(__dirname, '../orchestrator/n8n');
const WORKFLOWS_DIR = path.join(N8N_DIR, 'workflows');

function exec(cmd, opts = {}) {
  const { silent, ...execOpts } = opts;
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      ...execOpts
    }).trim();
  } catch (e) {
    if (silent) return '';
    throw e;
  }
}

function execSilent(cmd) { return exec(cmd, { silent: true }); }

// ── 1. Parse target ───────────────────────────────────────────────────────
const target = process.argv[2] || '';
let targetFiles = [];

if (!target) {
  targetFiles = fs.readdirSync(WORKFLOWS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(WORKFLOWS_DIR, f));
} else if (target.endsWith('.json') || target.includes('/workflows/')) {
  const candidates = [
    target,
    path.join(N8N_DIR, target),
    path.join(WORKFLOWS_DIR, path.basename(target)),
  ];
  const found = candidates.find(f => fs.existsSync(f));
  if (!found) {
    console.log(JSON.stringify({ error: `file not found: ${target}` }));
    process.exit(1);
  }
  targetFiles = [path.resolve(found)];
} else {
  const re = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  targetFiles = fs.readdirSync(WORKFLOWS_DIR)
    .filter(f => f.endsWith('.json') && re.test(f))
    .map(f => path.join(WORKFLOWS_DIR, f));
  if (!targetFiles.length) {
    console.log(JSON.stringify({ error: `no workflows matched: ${target}` }));
    process.exit(1);
  }
}

// ── 2. Inject prompts ─────────────────────────────────────────────────────
let promptInjected = false;
const injectScript = path.join(N8N_DIR, 'scripts', 'inject-prompt.js');
if (fs.existsSync(injectScript)) {
  try {
    exec(`cd "${N8N_DIR}" && node scripts/inject-prompt.js inject`);
    promptInjected = true;
  } catch { /* injection failure noted but we continue */ }
}

// ── 3. Deploy each workflow ───────────────────────────────────────────────
const results = [];
for (const wfFile of targetFiles) {
  const wfBasename = path.basename(wfFile);
  let wfId = '';
  let status = '';

  try {
    const wfJson = JSON.parse(fs.readFileSync(wfFile, 'utf8'));
    wfId = wfJson.id || '';

    if (wfId) {
      const cleanJson = { ...wfJson };
      delete cleanJson.id;
      const jsonStr = JSON.stringify(cleanJson);
      const child = spawnSync('n8n-cli', ['workflow', 'update', wfId, '--stdin'], {
        cwd: N8N_DIR,
        input: jsonStr,
        encoding: 'utf8',
        shell: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      status = child.status === 0 ? 'updated' : 'update-failed';
    } else {
      exec(`cd "${N8N_DIR}" && n8n-cli workflow import "${wfFile}"`);
      status = 'imported';
    }
  } catch (e) {
    status = wfId ? 'update-failed' : 'import-failed';
  }

  results.push({ file: wfBasename, wfId: wfId || 'new', status });
}

// ── 4. Verify ─────────────────────────────────────────────────────────────
let verified = false;
try {
  const list = JSON.parse(exec('n8n-cli workflow list --json'));
  verified = targetFiles.every(f => {
    const name = path.basename(f, '.json');
    return list.some(w => w.name && (w.name === name || w.name.includes(name)));
  });
} catch { /* verification non-fatal */ }

console.log(JSON.stringify({
  targets: targetFiles,
  promptInjected,
  deployCount: results.length,
  results,
  verified,
}, null, 2));