#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ENV_FILE = path.join(__dirname, '.env');
const WF_FILE = path.join(__dirname, 'workflows', 'presale-agent-workflow.json');

function loadEnv(f) {
  const vars = {};
  if (!fs.existsSync(f)) return vars;
  fs.readFileSync(f, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  });
  return vars;
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
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

async function main() {
  const env = loadEnv(ENV_FILE);
  const apiKey = env.N8N_API_KEY;
  const baseUrl = env.N8N_API_URL || 'http://localhost:5678';
  if (!apiKey) { console.error('N8N_API_KEY not set'); process.exit(1); }

  const wf = JSON.parse(fs.readFileSync(WF_FILE, 'utf8'));
  const workflowId = wf.id;

  // Strip read-only fields before PUT
  const payload = { ...wf };
  delete payload.active;
  delete payload.versionId;
  delete payload.meta;
  delete payload.tags;
  if (payload.settings) delete payload.settings.binaryMode;

  const u = new URL(baseUrl);
  const opts = {
    hostname: u.hostname,
    port: u.port || 80,
    protocol: u.protocol,
    path: `/api/v1/workflows/${workflowId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey
    }
  };

  console.log(`Deploying workflow ${workflowId} to ${baseUrl}...`);
  const res = await request(opts, payload);
  if (res.status === 200) {
    console.log('Deploy SUCCESS. Workflow updated.');
    // Re-activate since it was active before
    const activateOpts = { ...opts, path: `/api/v1/workflows/${workflowId}/activate`, method: 'POST' };
    const ar = await request(activateOpts, {});
    if (ar.status === 200 || ar.status === 409) {
      console.log('Workflow re-activated (or was already active).');
    } else {
      console.error('Activate failed:', ar.status, JSON.stringify(ar.body));
    }
  } else {
    console.error('Deploy FAILED:', res.status, JSON.stringify(res.body));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
