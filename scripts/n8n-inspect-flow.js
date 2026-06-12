#!/usr/bin/env node
/**
 * n8n-inspect-flow.js — Fetch last failed execution of an n8n workflow and
 * output structured JSON with error details.
 *
 * Usage:
 *   node scripts/n8n-inspect-flow.js "Workflow Name"
 *   node scripts/n8n-inspect-flow.js http://localhost:5678/workflow/<id>/executions/<exec-id>
 *   node scripts/n8n-inspect-flow.js orchestrator/n8n/workflows/presale-agent-workflow.json
 *
 * Output: JSON with { workflowId, workflowName, active, execution, failedNode,
 *           nodeInput?, availableNodes[], error? }
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const N8N_DIR = path.resolve(__dirname, '../orchestrator/n8n');

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

const INPUT = process.argv[2];
if (!INPUT) {
  console.log(JSON.stringify({ error: 'usage: node scripts/debug-n8n-execution.js <name|url|path>' }));
  process.exit(1);
}

// ── 1. Parse input → workflowId + executionId ─────────────────────────────
let wfId = '';
let wfName = '';
let execId = '';
let wfActive = false;

if (/\/execution/.test(INPUT)) {
  const urlMatch = INPUT.match(/\/workflow\/([^/]+)\/executions\/([^/]+)/);
  if (urlMatch) { wfId = urlMatch[1]; execId = urlMatch[2]; wfName = wfId; }
} else if (INPUT.endsWith('.json') || INPUT.includes('/workflows/')) {
  const resolvedPath = fs.existsSync(INPUT) ? INPUT : path.join(N8N_DIR, INPUT);
  if (!fs.existsSync(resolvedPath)) {
    console.log(JSON.stringify({ error: `file not found: ${INPUT}` }));
    process.exit(1);
  }
  const wfJson = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  wfName = wfJson.name || 'unknown';
  const list = JSON.parse(execSilent('n8n-cli workflow list --json') || '[]');
  const found = list.find(w => w.name === wfName);
  if (!found) {
    console.log(JSON.stringify({ error: `workflow not found in n8n: ${wfName}`, wfName }));
    process.exit(1);
  }
  wfId = found.id;
  wfActive = found.active || false;
} else {
  wfName = INPUT;
  const list = JSON.parse(execSilent('n8n-cli workflow list --json') || '[]');
  const found = list.find(w => w.name === INPUT)
    || list.find(w => w.name.toLowerCase().includes(INPUT.toLowerCase()));
  if (!found) {
    console.log(JSON.stringify({ error: `workflow not found in n8n: ${INPUT}` }));
    process.exit(1);
  }
  wfId = found.id;
  wfActive = found.active || false;
}

// ── 2. Get execution data ─────────────────────────────────────────────────
if (!execId) {
  execId = execSilent(`n8n-cli execution list --workflow=${wfId} --status=error --limit=1 --jq '.[0].id'`).replace(/"/g, '');
}

if (!execId) {
  console.log(JSON.stringify({
    error: 'no failed execution found',
    workflowId: wfId,
    workflowName: wfName,
  }));
  process.exit(0);
}

const execRaw = execSilent(`n8n-cli execution get ${execId} --include-data`);
let execData;
try { execData = JSON.parse(execRaw); } catch {
  const m = execRaw.match(/\{[\s\S]*\}/);
  execData = m ? JSON.parse(m[0]) : null;
}

if (!execData) {
  console.log(JSON.stringify({ error: 'failed to parse execution data', raw: execRaw.slice(0, 500) }));
  process.exit(0);
}

// ── 3. Build result ───────────────────────────────────────────────────────
const runData = execData.data?.resultData?.runData || {};
const failedEntry = Object.entries(runData).find(([, v]) => v[0]?.executionStatus === 'error');

const result = {
  workflowId: execData.workflowId || wfId,
  workflowName: wfName,
  active: wfActive,
  execution: {
    id: execData.id || null,
    status: execData.status || null,
    startedAt: execData.startedAt || null,
    stoppedAt: execData.stoppedAt || null,
    lastNodeExecuted: execData.data?.lastNodeExecuted || null,
  },
  failedNode: null,
  availableNodes: [],
};

if (failedEntry) {
  const [nodeName, runs] = failedEntry;
  const err = runs[0]?.error || {};
  result.failedNode = {
    name: nodeName,
    error: err.message || err.description || 'unknown error',
    errorDetails: err,
    nodeType: runs[0]?.sourceMetadata?.nodeType || null,
    executionStatus: runs[0]?.executionStatus || null,
  };
  if (runs[0]?.data?.main?.[0]?.[0]?.json) {
    result.failedNode.input = runs[0].data.main[0][0].json;
  }
}

Object.entries(runData).forEach(([name, runs]) => {
  result.availableNodes.push({
    name,
    status: runs[0]?.executionStatus || 'unknown',
    nodeType: runs[0]?.sourceMetadata?.nodeType || null,
  });
});

console.log(JSON.stringify(result, null, 2));