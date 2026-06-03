#!/usr/bin/env node
/**
 * Deploy Sub - SharePoint Upload File and update Sub - SharePoint Agent
 *
 * Usage (from repo root):
 *   node orchestrator/n8n/deploy-sharepoint-upload.js
 *
 * Reads N8N_API_KEY and N8N_API_URL from orchestrator/n8n/.env
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Load .env
const envPath = path.join(__dirname, '.env');
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) envVars[m[1]] = m[2].trim();
});

const N8N_URL = envVars.N8N_API_URL || 'http://localhost:5678';
const N8N_KEY = envVars.N8N_API_KEY;

if (!N8N_KEY) {
  console.error('ERROR: N8N_API_KEY not found in orchestrator/n8n/.env');
  process.exit(1);
}

const WORKFLOWS_DIR = path.join(__dirname, 'workflows');
const UPLOAD_WF_PATH = path.join(WORKFLOWS_DIR, 'sharepoint-upload-file-workflow.json');
const SHAREPOINT_WF_PATH = path.join(WORKFLOWS_DIR, 'sharepoint-agent-workflow.json');
const SHAREPOINT_WF_ID = 'rDK4JWk961DRUUuP';

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_URL + urlPath);
    const isHttps = url.protocol === 'https:';
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'X-N8N-API-KEY': N8N_KEY,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Step 1: Create the sub-workflow
  console.log('==> Creating Sub - SharePoint Upload File...');
  const uploadWfJson = JSON.parse(fs.readFileSync(UPLOAD_WF_PATH, 'utf8'));

  const createRes = await apiRequest('POST', '/api/v1/workflows', uploadWfJson);
  if (createRes.status !== 200 && createRes.status !== 201) {
    console.error('ERROR: Failed to create sub-workflow.');
    console.error('Status:', createRes.status);
    console.error('Response:', JSON.stringify(createRes.body, null, 2));
    process.exit(1);
  }

  const createdWf = createRes.body;
  const assignedId = createdWf.id;
  console.log(`    Created: "${createdWf.name}" with n8n ID: ${assignedId}`);

  // Step 2: If n8n assigned a different ID, update both files
  const originalId = uploadWfJson.id;
  if (assignedId !== originalId) {
    console.log(`    Note: n8n assigned ID ${assignedId} (file had ${originalId}). Updating files...`);

    // Update sub-workflow file
    uploadWfJson.id = assignedId;
    fs.writeFileSync(UPLOAD_WF_PATH, JSON.stringify(uploadWfJson, null, 2) + '\n');
    console.log(`    Updated ${UPLOAD_WF_PATH}`);

    // Update reference in sharepoint-agent-workflow.json
    const spWfJson = JSON.parse(fs.readFileSync(SHAREPOINT_WF_PATH, 'utf8'));
    for (const node of spWfJson.nodes) {
      if (node.name === 'Upload File via Graph API') {
        node.parameters.workflowId.value = assignedId;
        console.log(`    Updated toolWorkflow reference in ${SHAREPOINT_WF_PATH}`);
        break;
      }
    }
    fs.writeFileSync(SHAREPOINT_WF_PATH, JSON.stringify(spWfJson, null, 2) + '\n');
  }

  // Step 3: Update the SharePoint Agent workflow
  console.log(`\n==> Updating Sub - SharePoint Agent (${SHAREPOINT_WF_ID})...`);
  const spWfJson = JSON.parse(fs.readFileSync(SHAREPOINT_WF_PATH, 'utf8'));

  const updateRes = await apiRequest('PUT', `/api/v1/workflows/${SHAREPOINT_WF_ID}`, spWfJson);
  if (updateRes.status !== 200 && updateRes.status !== 201) {
    console.error('ERROR: Failed to update SharePoint Agent workflow.');
    console.error('Status:', updateRes.status);
    console.error('Response:', JSON.stringify(updateRes.body, null, 2));
    process.exit(1);
  }

  console.log(`    Updated: "${updateRes.body.name}" (ID: ${updateRes.body.id})`);

  console.log('\n==> Deployment complete!');
  console.log(`    Sub-workflow "Sub - SharePoint Upload File": ${assignedId}`);
  console.log(`    SharePoint Agent "Sub - SharePoint Agent": ${SHAREPOINT_WF_ID} (updated)`);
  console.log('\nNote: The sub-workflow is inactive — this is expected for sub-workflows.');
  console.log('      It is invoked as a tool and does not need to be independently activated.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
