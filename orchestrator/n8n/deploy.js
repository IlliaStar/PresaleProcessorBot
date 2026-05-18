#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load .env from this script's directory
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const clean = line.replace(/#.*$/, '').trim();
    const eq = clean.indexOf('=');
    if (eq > 0) process.env[clean.slice(0, eq).trim()] ??= clean.slice(eq + 1).trim();
  });
}

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const n8nUrl = (getArg('--url') || process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');
const apiKey  = getArg('--key') || process.env.N8N_API_KEY;
const file    = getArg('--file') || path.join(__dirname, 'presale-agent-workflow.json');

if (!apiKey) {
  console.error('Error: n8n API key is required.');
  console.error('  Option 1: node deploy.js --key <key>');
  console.error('  Option 2: set N8N_API_KEY env var');
  console.error('  Get key:  n8n UI → Settings (bottom-left) → n8n API → Enable → Create API Key');
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`Error: workflow file not found: ${file}`);
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', 'X-N8N-API-KEY': apiKey };
const base = `${n8nUrl}/api/v1`;

async function deploy() {
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Deploying: "${workflow.name}"`);
  console.log(`Target:    ${n8nUrl}`);

  const listRes = await fetch(`${base}/workflows?limit=100`, { headers });
  if (!listRes.ok) throw new Error(`List failed: ${listRes.status} ${await listRes.text()}`);
  const { data: existing } = await listRes.json();
  const found = existing.find(w => w.name === workflow.name);

  const body = { ...workflow };
  delete body.id;
  delete body.tags;

  let workflowId;
  if (found) {
    console.log(`Found existing workflow (id: ${found.id}), updating...`);
    const res = await fetch(`${base}/workflows/${found.id}`, {
      method: 'PUT', headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
    workflowId = found.id;
    console.log('Updated.');
  } else {
    console.log('Creating new workflow...');
    const res = await fetch(`${base}/workflows`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Create failed: ${res.status} ${await res.text()}`);
    workflowId = (await res.json()).id;
    console.log(`Created (id: ${workflowId}).`);
  }

  const activateRes = await fetch(`${base}/workflows/${workflowId}/activate`, {
    method: 'POST', headers,
  });
  if (!activateRes.ok) throw new Error(`Activate failed: ${activateRes.status} ${await activateRes.text()}`);

  console.log('Activated.');
  console.log(`Webhook: ${n8nUrl}/webhook/presale-agent`);
}

deploy().catch(err => { console.error(`Deploy failed: ${err.message}`); process.exit(1); });
