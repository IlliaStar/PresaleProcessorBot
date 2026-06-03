#!/usr/bin/env node
/**
 * fix-sharepoint-credential.js
 *
 * Fixes the stale microsoftSharePointOAuth2Api credential ID in
 * sharepoint-agent-workflow.json, then pushes the corrected workflow
 * to the running n8n instance via the REST API.
 *
 * Usage (from project root):
 *   node orchestrator/n8n/fix-sharepoint-credential.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Minimal .env parser (no dotenv dependency)
// ---------------------------------------------------------------------------
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(path.join(__dirname, '.env'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const N8N_API_URL   = process.env.N8N_API_URL   || 'http://localhost:5678';
const N8N_API_KEY   = process.env.N8N_API_KEY;
const WORKFLOW_FILE = path.join(__dirname, 'workflows', 'sharepoint-agent-workflow.json');
const STALE_CRED_ID = 'TMsE638TJIXdcIF6';
const TARGET_TYPE   = 'microsoftSharePointOAuth2Api';

if (!N8N_API_KEY) {
  console.error('ERROR: N8N_API_KEY not found in orchestrator/n8n/.env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const base = N8N_API_URL.endsWith('/') ? N8N_API_URL.slice(0, -1) : N8N_API_URL;
    const fullUrl = new URL(urlPath, base + '/');
    const lib = fullUrl.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
      path: fullUrl.pathname + (fullUrl.search || ''),
      method,
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== SharePoint credential fix ===');
  console.log(`n8n:          ${N8N_API_URL}`);
  console.log(`Stale ID:     ${STALE_CRED_ID}`);
  console.log(`Target type:  ${TARGET_TYPE}`);
  console.log(`Workflow:     ${WORKFLOW_FILE}`);
  console.log('');

  // ── Step 1: List credentials ────────────────────────────────────────────
  console.log('Step 1: Listing n8n credentials...');
  const listRes = await apiRequest('GET', '/api/v1/credentials?limit=100');

  if (listRes.status !== 200) {
    console.error(`ERROR: GET /api/v1/credentials → HTTP ${listRes.status}`);
    console.error(JSON.stringify(listRes.body, null, 2));
    process.exit(1);
  }

  const allCreds = listRes.body.data || [];
  console.log(`  Total credentials: ${allCreds.length}`);

  const allTypes = [...new Set(allCreds.map(c => c.type))].sort();
  console.log(`  Types present:     ${allTypes.join(', ') || '(none)'}`);

  const spCreds = allCreds.filter(c => c.type === TARGET_TYPE);
  console.log(`  ${TARGET_TYPE}: ${spCreds.length} found`);

  if (spCreds.length === 0) {
    // No SharePoint credential at all — list everything and exit
    console.error(`\nERROR: No credential of type "${TARGET_TYPE}" exists in this n8n instance.`);
    console.error('You must create one in n8n UI → Settings → Credentials → New.');
    console.error('\nAll existing credentials:');
    allCreds.forEach(c => console.error(`  [${c.id}]  "${c.name}"  (${c.type})`));
    process.exit(1);
  }

  // Pick best match: prefer name containing "sharepoint"/"presale", else first
  const chosen =
    spCreds.find(c => /sharepoint|presale/i.test(c.name)) ||
    spCreds[0];

  console.log(`\n  Selected:`);
  console.log(`    ID:   ${chosen.id}`);
  console.log(`    Name: ${chosen.name}`);
  console.log(`    Type: ${chosen.type}`);

  if (spCreds.length > 1) {
    console.log(`  (${spCreds.length - 1} other SharePoint credential(s) ignored)`);
  }

  // ── Step 2: Patch the local JSON ─────────────────────────────────────────
  console.log('\nStep 2: Patching local workflow JSON...');
  const raw = fs.readFileSync(WORKFLOW_FILE, 'utf8');
  const workflow = JSON.parse(raw);

  let patchCount = 0;
  for (const node of workflow.nodes) {
    const creds = node.credentials || {};
    if (creds[TARGET_TYPE] && creds[TARGET_TYPE].id === STALE_CRED_ID) {
      const oldName = creds[TARGET_TYPE].name;
      creds[TARGET_TYPE].id   = chosen.id;
      creds[TARGET_TYPE].name = chosen.name;
      patchCount++;
      console.log(`  Patched "${node.name}"  (was: "${oldName}" / ${STALE_CRED_ID})`);
    }
  }

  if (patchCount === 0) {
    console.log('  No nodes had the stale credential ID — local file unchanged.');
  } else {
    fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(workflow, null, 2) + '\n');
    console.log(`\n  Saved → ${WORKFLOW_FILE}`);
  }

  // ── Step 3: Push to n8n ──────────────────────────────────────────────────
  const workflowId = workflow.id;
  if (!workflowId) {
    console.error('ERROR: workflow JSON missing "id" field — cannot push to n8n.');
    process.exit(1);
  }

  // Build the PUT body — omit read-only fields (active, versionId, meta, tags)
  const putBody = {
    name:        workflow.name,
    nodes:       workflow.nodes,
    connections: workflow.connections,
    settings:    workflow.settings || { executionOrder: 'v1' },
    staticData:  workflow.staticData ?? null
  };

  console.log(`\nStep 3: Pushing workflow "${workflow.name}" (${workflowId}) to n8n...`);
  const putRes = await apiRequest('PUT', `/api/v1/workflows/${workflowId}`, putBody);

  if (putRes.status === 200 || putRes.status === 201) {
    const w = putRes.body;
    console.log(`  SUCCESS`);
    console.log(`  Name:    ${w.name}`);
    console.log(`  Version: ${w.versionId}`);
    console.log(`  Active:  ${w.active}`);
  } else {
    console.error(`\nERROR: PUT /api/v1/workflows/${workflowId} → HTTP ${putRes.status}`);
    console.error(JSON.stringify(putRes.body, null, 2));
    process.exit(1);
  }

  console.log('\n=== Fix complete ===');
  console.log(`Credential now in use: [${chosen.id}] "${chosen.name}"`);
  console.log('');
  console.log('Verify by running the SharePoint sub-workflow with a test payload.');
}

main().catch(err => {
  console.error('Unhandled error:', err.message || err);
  process.exit(1);
});
