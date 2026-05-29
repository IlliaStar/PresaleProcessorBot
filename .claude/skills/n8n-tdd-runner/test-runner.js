#!/usr/bin/env node
'use strict';

/**
 * n8n TDD Test Runner
 * Deploys a workflow JSON, triggers it, polls execution result, saves log.
 *
 * Supports two trigger modes (auto-detected from the workflow JSON):
 *   webhook              — fires POST /webhook/<path> with the fixture payload
 *   executeWorkflowTrigger — creates a temporary wrapper webhook workflow that
 *                            calls the sub-workflow, then deletes it after the test
 *
 * Usage:
 *   node test-runner.js [--workflow <path>] [--fixture <path>] [--timeout <ms>] [--log-out <path>]
 *
 * Defaults:
 *   --workflow  orchestrator/n8n/workflows/presale-agent-workflow.json
 *   --fixture   orchestrator/n8n/fixtures/presale-agent-trigger.json
 *   --timeout   90000
 *   --log-out   orchestrator/n8n/fixtures/latest-execution-log.json
 *
 * Env (read from orchestrator/n8n/.env):
 *   N8N_API_KEY    required
 *   N8N_BASE_URL   default http://localhost:5678
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1];
      result[argv[i]] = (next && !next.startsWith('--')) ? next : true;
      if (next && !next.startsWith('--')) i++;
    }
  }
  return result;
}

function loadEnv(envFile) {
  if (!fs.existsSync(envFile)) return {};
  const vars = {};
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
  return vars;
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const lib = options.protocol === 'https:' ? https : http;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function urlOpts(baseUrl, method, apiPath, apiKey) {
  const u = new URL(baseUrl);
  return {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    protocol: u.protocol,
    path: apiPath,
    method,
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      apiKey ? { 'X-N8N-API-KEY': apiKey } : {}
    ),
  };
}

// ---------------------------------------------------------------------------
// n8n API calls
// ---------------------------------------------------------------------------

async function deployWorkflow(baseUrl, apiKey, wfJson) {
  const cleaned = { ...wfJson };
  ['id', 'active', 'versionId', 'meta', 'tags'].forEach(f => delete cleaned[f]);
  if (cleaned.settings) delete cleaned.settings.binaryMode;

  const opts = urlOpts(baseUrl, 'PUT', `/api/v1/workflows/${wfJson.id}`, apiKey);
  const res = await request(opts, cleaned);
  if (res.status !== 200)
    throw new Error(`Deploy failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

async function activateWorkflow(baseUrl, apiKey, workflowId) {
  const opts = urlOpts(baseUrl, 'POST', `/api/v1/workflows/${workflowId}/activate`, apiKey);
  const res = await request(opts, {});
  // 200 = activated, 409 = already active — both are fine
  if (res.status !== 200 && res.status !== 409)
    throw new Error(`Activate failed (${res.status}): ${JSON.stringify(res.body)}`);
}

async function deactivateWorkflow(baseUrl, apiKey, workflowId) {
  const opts = urlOpts(baseUrl, 'POST', `/api/v1/workflows/${workflowId}/deactivate`, apiKey);
  await request(opts, {});
}

async function createWorkflow(baseUrl, apiKey, wfJson) {
  const opts = urlOpts(baseUrl, 'POST', '/api/v1/workflows', apiKey);
  const res = await request(opts, wfJson);
  if (res.status !== 200 && res.status !== 201)
    throw new Error(`Create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.id || res.body.data?.id;
}

async function deleteWorkflow(baseUrl, apiKey, workflowId) {
  await deactivateWorkflow(baseUrl, apiKey, workflowId);
  const opts = urlOpts(baseUrl, 'DELETE', `/api/v1/workflows/${workflowId}`, apiKey);
  await request(opts);
}

async function triggerWebhook(baseUrl, webhookPath, payload) {
  const opts = urlOpts(baseUrl, 'POST', `/webhook/${webhookPath}`, null);
  return request(opts, payload);
}

async function getExecution(baseUrl, apiKey, executionId) {
  const opts = urlOpts(baseUrl, 'GET', `/api/v1/executions/${executionId}?includeData=true`, apiKey);
  const res = await request(opts);
  if (res.status !== 200) throw new Error(`Get execution failed (${res.status})`);
  return res.body;
}

async function pollExecution(baseUrl, apiKey, workflowId, afterTs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2500);
    const opts = urlOpts(baseUrl, 'GET', `/api/v1/executions?workflowId=${workflowId}&limit=5`, apiKey);
    const res = await request(opts);
    if (res.status !== 200) continue;
    const executions = (res.body.data || []);
    const hit = executions.find(e => {
      const startedAt = new Date(e.startedAt).getTime();
      return startedAt >= afterTs && (e.finished || e.status === 'success' || e.status === 'error');
    });
    if (hit) return getExecution(baseUrl, apiKey, hit.id);
  }
  throw new Error(`Execution did not complete within ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Sub-workflow wrapper
// Creates a minimal webhook → Execute Workflow wrapper to invoke a sub-workflow
// that uses executeWorkflowTrigger (which has no external HTTP entry point).
// ---------------------------------------------------------------------------

function buildWrapperWorkflow(subWorkflowId, webhookPath) {
  return {
    name: `__TDD_WRAPPER_${Date.now()}__`,
    nodes: [
      {
        id: 'tdd-wh-001',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [256, 304],
        parameters: {
          path: webhookPath,
          responseMode: 'onReceived',
          httpMethod: 'POST'
        }
      },
      {
        // Strip the webhook envelope so the sub-workflow receives clean fixture fields
        id: 'tdd-code-001',
        name: 'Extract Body',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [496, 304],
        parameters: {
          jsCode: 'return { json: $json.body || $json };'
        }
      },
      {
        id: 'tdd-ex-001',
        name: 'Execute Sub-Workflow',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1,
        position: [736, 304],
        parameters: {
          workflowId: subWorkflowId
        }
      }
    ],
    connections: {
      Webhook: {
        main: [[{ node: 'Extract Body', type: 'main', index: 0 }]]
      },
      'Extract Body': {
        main: [[{ node: 'Execute Sub-Workflow', type: 'main', index: 0 }]]
      }
    },
    settings: { executionOrder: 'v1' }
  };
}

// ---------------------------------------------------------------------------
// Execution analysis
// ---------------------------------------------------------------------------

function findErrorNode(execution) {
  try {
    const runData = execution.data?.resultData?.runData || {};
    for (const [name, runs] of Object.entries(runData)) {
      for (const run of (runs || [])) {
        if (run.error) return { name, error: run.error };
      }
    }
  } catch {}
  return null;
}

/** Nodes with no outgoing main connections — the workflow's output nodes. */
function findTerminalNodes(workflowJson, runData) {
  const nodesWithOutgoing = new Set(Object.keys(workflowJson.connections || {}));
  return Object.keys(runData).filter(name => !nodesWithOutgoing.has(name));
}

/** Print the JSON output of each terminal node. */
function printTerminalOutputs(workflowJson, execution) {
  const runData = execution.data?.resultData?.runData || {};
  const terminals = findTerminalNodes(workflowJson, runData);
  if (!terminals.length) return;

  console.log('\n[TDD] Output:');
  for (const name of terminals) {
    const runs = runData[name] || [];
    const items = runs[0]?.data?.main?.[0] || [];
    if (!items.length) { console.log(`  [${name}] (no items)`); continue; }
    console.log(`  [${name}]`);
    items.forEach((item, i) => {
      const out = JSON.stringify(item.json, null, 2).replace(/\n/g, '\n    ');
      console.log(`    item[${i}]: ${out}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const WORKFLOW_FILE = args['--workflow'];
  const FIXTURE_FILE = args['--fixture'];
  const LOG_FILE = args['--log-out'] ||
    path.join(PROJECT_ROOT, 'orchestrator/n8n/fixtures/latest-execution-log.json');
  const TIMEOUT_MS = parseInt(args['--timeout'] || '90000');
  const ENV_FILE = path.join(PROJECT_ROOT, 'orchestrator/n8n/.env');

  const env = loadEnv(ENV_FILE);
  const N8N_BASE_URL = (env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/, '');
  const N8N_API_KEY = env.N8N_API_KEY;

  if (!N8N_API_KEY) {
    console.error(`ERROR: N8N_API_KEY not set in ${ENV_FILE}`);
    process.exit(1);
  }

  if (!WORKFLOW_FILE) { console.error('ERROR: --workflow <path> is required'); process.exit(1); }
  if (!FIXTURE_FILE)  { console.error('ERROR: --fixture <path> is required');  process.exit(1); }

  if (!fs.existsSync(WORKFLOW_FILE)) { console.error(`ERROR: workflow not found: ${WORKFLOW_FILE}`); process.exit(1); }
  if (!fs.existsSync(FIXTURE_FILE))  { console.error(`ERROR: fixture not found: ${FIXTURE_FILE}`);  process.exit(1); }

  const workflowJson = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
  const workflowId = workflowJson.id;

  if (!workflowId) { console.error('ERROR: workflow JSON is missing the "id" field'); process.exit(1); }

  // Detect trigger type
  const webhookNode = (workflowJson.nodes || []).find(n =>
    n.type === 'n8n-nodes-base.webhook' || n.type === 'n8n-nodes-base.webhookTrigger'
  );
  const isSubWorkflow = !webhookNode && !!(workflowJson.nodes || []).find(n =>
    n.type === 'n8n-nodes-base.executeWorkflowTrigger'
  );

  // Deploy the target workflow first (always)
  process.stdout.write('[TDD] Deploying workflow... ');
  await deployWorkflow(N8N_BASE_URL, N8N_API_KEY, workflowJson);
  console.log('OK');

  let execution;

  if (isSubWorkflow) {
    // -----------------------------------------------------------------------
    // Sub-workflow path: create a temporary webhook wrapper that calls it
    // -----------------------------------------------------------------------
    const wrapperPath = `__tdd-${Date.now()}__`;
    const wrapperJson = buildWrapperWorkflow(workflowId, wrapperPath);

    console.log(`[TDD] Workflow : ${path.relative(PROJECT_ROOT, WORKFLOW_FILE)} (id: ${workflowId})`);
    console.log(`[TDD] Fixture  : ${path.relative(PROJECT_ROOT, FIXTURE_FILE)}`);
    console.log(`[TDD] Mode     : sub-workflow (executeWorkflowTrigger)`);
    console.log(`[TDD] Timeout  : ${TIMEOUT_MS / 1000}s`);
    console.log('');

    let wrapperId;
    try {
      process.stdout.write('[TDD] Creating wrapper workflow... ');
      wrapperId = await createWorkflow(N8N_BASE_URL, N8N_API_KEY, wrapperJson);
      console.log(`OK (id: ${wrapperId})`);

      process.stdout.write('[TDD] Activating wrapper... ');
      await activateWorkflow(N8N_BASE_URL, N8N_API_KEY, wrapperId);
      console.log('OK');

      // Small delay to ensure webhook is registered
      await sleep(1000);

      const triggerTs = Date.now();
      process.stdout.write('[TDD] Triggering wrapper webhook... ');
      const triggerRes = await triggerWebhook(N8N_BASE_URL, wrapperPath, fixture);
      console.log(`${triggerRes.status}`);

      process.stdout.write('[TDD] Waiting for sub-workflow execution');
      execution = await (async () => {
        const interval = setInterval(() => process.stdout.write('.'), 2500);
        try {
          return await pollExecution(N8N_BASE_URL, N8N_API_KEY, workflowId, triggerTs, TIMEOUT_MS);
        } finally {
          clearInterval(interval);
          process.stdout.write('\n');
        }
      })();
    } finally {
      if (wrapperId) {
        process.stdout.write('[TDD] Cleaning up wrapper... ');
        try { await deleteWorkflow(N8N_BASE_URL, N8N_API_KEY, wrapperId); console.log('OK'); }
        catch (e) { console.log(`WARN: ${e.message}`); }
      }
    }

  } else {
    // -----------------------------------------------------------------------
    // Webhook path: existing behaviour
    // -----------------------------------------------------------------------
    const webhookPath = webhookNode?.parameters?.path || 'webhook';
    if (!webhookNode) console.warn('[TDD] Warning: no webhook trigger node found; using path "webhook"');

    console.log(`[TDD] Workflow : ${path.relative(PROJECT_ROOT, WORKFLOW_FILE)} (id: ${workflowId})`);
    console.log(`[TDD] Fixture  : ${path.relative(PROJECT_ROOT, FIXTURE_FILE)}`);
    console.log(`[TDD] Endpoint : ${N8N_BASE_URL}/webhook/${webhookPath}`);
    console.log(`[TDD] Timeout  : ${TIMEOUT_MS / 1000}s`);
    console.log('');

    process.stdout.write('[TDD] Activating workflow... ');
    await activateWorkflow(N8N_BASE_URL, N8N_API_KEY, workflowId);
    console.log('OK');

    const triggerTs = Date.now();
    process.stdout.write('[TDD] Triggering webhook... ');
    const triggerRes = await triggerWebhook(N8N_BASE_URL, webhookPath, fixture);
    console.log(`${triggerRes.status}`);

    process.stdout.write('[TDD] Waiting for execution');
    execution = await (async () => {
      const interval = setInterval(() => process.stdout.write('.'), 2500);
      try {
        return await pollExecution(N8N_BASE_URL, N8N_API_KEY, workflowId, triggerTs, TIMEOUT_MS);
      } finally {
        clearInterval(interval);
        process.stdout.write('\n');
      }
    })();
  }

  // -------------------------------------------------------------------------
  // Save log & report (shared)
  // -------------------------------------------------------------------------
  const log = {
    runAt: new Date().toISOString(),
    workflowFile: path.relative(PROJECT_ROOT, WORKFLOW_FILE),
    fixtureFile: path.relative(PROJECT_ROOT, FIXTURE_FILE),
    executionId: execution.id,
    status: execution.status,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    data: execution.data,
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  console.log(`[TDD] Log saved → ${path.relative(PROJECT_ROOT, LOG_FILE)}`);

  // Always print terminal node outputs so no separate execution fetch is needed
  printTerminalOutputs(workflowJson, execution);

  if (execution.status === 'success') {
    console.log('\n[TDD] PASS — workflow completed successfully');
    process.exit(0);
  } else {
    console.error(`\n[TDD] FAIL — execution status: ${execution.status}`);
    const errorNode = findErrorNode(execution);
    if (errorNode) {
      console.error(`[TDD] Failing node: ${errorNode.name}`);
      console.error('[TDD] Error:', JSON.stringify(errorNode.error, null, 2));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[TDD] Fatal:', err.message);
  process.exit(1);
});
