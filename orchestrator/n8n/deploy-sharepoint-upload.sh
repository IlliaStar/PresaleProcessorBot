#!/usr/bin/env bash
# Deploy SharePoint Upload File sub-workflow and update SharePoint Agent workflow
# Run from the repo root or from orchestrator/n8n/

set -e

N8N_URL="${N8N_API_URL:-http://localhost:5678}"
N8N_KEY="${N8N_API_KEY:-$(grep N8N_API_KEY orchestrator/n8n/.env | cut -d= -f2-)}"

WORKFLOW_DIR="orchestrator/n8n/workflows"
UPLOAD_WF="${WORKFLOW_DIR}/sharepoint-upload-file-workflow.json"
SHAREPOINT_WF="${WORKFLOW_DIR}/sharepoint-agent-workflow.json"

echo "==> Deploying Sub - SharePoint Upload File..."
CREATED=$(curl -s -X POST "${N8N_URL}/api/v1/workflows" \
  -H "X-N8N-API-KEY: ${N8N_KEY}" \
  -H "Content-Type: application/json" \
  -d @"${UPLOAD_WF}")

UPLOAD_WF_ID=$(echo "$CREATED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

if [ -z "$UPLOAD_WF_ID" ]; then
  echo "ERROR: Failed to create sub-workflow. Response: $CREATED"
  exit 1
fi

echo "    Created with n8n ID: ${UPLOAD_WF_ID}"

# If n8n assigned a different ID, patch the JSON file and update the toolWorkflow reference
if [ "$UPLOAD_WF_ID" != "a1b2c3d4-e5f6-4789-abcd-ef0123456789" ]; then
  echo "    n8n assigned a different ID. Updating workflow files..."
  # Update the sub-workflow file's id field
  python3 -c "
import json, sys
with open('${UPLOAD_WF}', 'r') as f:
    wf = json.load(f)
wf['id'] = '${UPLOAD_WF_ID}'
with open('${UPLOAD_WF}', 'w') as f:
    json.dump(wf, f, indent=2)
print('Updated ${UPLOAD_WF}')
"
  # Update the sharepoint-agent-workflow.json toolWorkflow node's workflowId
  python3 -c "
import json, sys
with open('${SHAREPOINT_WF}', 'r') as f:
    wf = json.load(f)
for node in wf['nodes']:
    if node.get('name') == 'Upload File via Graph API':
        node['parameters']['workflowId']['value'] = '${UPLOAD_WF_ID}'
        print('Updated toolWorkflow reference in ${SHAREPOINT_WF}')
        break
with open('${SHAREPOINT_WF}', 'w') as f:
    json.dump(wf, f, indent=2)
"
fi

echo "==> Updating Sub - SharePoint Agent (rDK4JWk961DRUUuP)..."
UPDATE_RESULT=$(curl -s -X PUT "${N8N_URL}/api/v1/workflows/rDK4JWk961DRUUuP" \
  -H "X-N8N-API-KEY: ${N8N_KEY}" \
  -H "Content-Type: application/json" \
  -d @"${SHAREPOINT_WF}")

UPDATED_ID=$(echo "$UPDATE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

if [ -z "$UPDATED_ID" ]; then
  echo "ERROR: Failed to update SharePoint Agent workflow. Response: $UPDATE_RESULT"
  exit 1
fi

echo "    Updated Sub - SharePoint Agent (ID: ${UPDATED_ID})"

echo ""
echo "==> Deployment complete!"
echo "    Sub-workflow ID : ${UPLOAD_WF_ID}"
echo "    SharePoint Agent: rDK4JWk961DRUUuP (updated)"
echo ""
echo "Note: Both workflows are inactive by default. Activate them in the n8n UI if needed."
echo "      The sub-workflow is called as a tool and does not need to be activated independently."
