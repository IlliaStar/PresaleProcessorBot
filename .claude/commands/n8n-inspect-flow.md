# n8n Inspect Flow

Fetch the last failed execution of an n8n workflow, identify the error, and propose a fix plan. Data fetching is in `scripts/n8n-inspect-flow.js`; error analysis is LLM.

Accepts one parameter in three forms:
- **Workflow name** — e.g. `"Sub - SharePoint Agent"` or `"Presale Agent"`
- **Execution URL** — e.g. `http://localhost:5678/workflow/<id>/executions/<execution-id>`
- **Workflow JSON path** — e.g. `orchestrator/n8n/workflows/presale-agent-workflow.json`

## Steps

### 1. Run debug script

```bash
node scripts/n8n-inspect-flow.js "<arg>"
```

Parse the JSON output for `workflowId`, `workflowName`, `execution`, `failedNode`, `availableNodes`, and `error`.

- If `error` is set → report it and stop
- If `failedNode === null` but execution exists → no error found, report status
- If `no failed execution found` → report and suggest checking if n8n is running

### 2. Error analysis (LLM)

Based on `failedNode.error` and `failedNode.input`, determine root cause and fix:

| Error pattern | Likely cause | Fix |
|---|---|---|
| `Received tool input did not match expected schema` | Sub-workflow parameter mismatch | Check the AI Agent tool definition parameters |
| `credential` | Missing or invalid credential | Recreate credentials in n8n UI, update IDs |
| `ENV` | Missing environment variable | Check `docker-compose.yml` env vars |
| `connect ECONNREFUSED` | Service not running | Check docker containers |
| `$fromAI` / empty output | AI agent not producing expected output | Re-inject prompts, check AI node configuration |
| `Cannot read properties of undefined` | Missing input data upstream | Check previous node's output schema |
| `400 Bad Request` / Graph API | SharePoint/Graph auth issue | Check AZURE_GRAPH_* env vars |

### 3. Optional: Get failed node config

If the error context from step 1 isn't enough:

```bash
N8N_DIR="C:/Users/IlliaStaradubets/EPAM/Presale Processing Agent/orchestrator/n8n"
cd "$N8N_DIR" && n8n-cli workflow get <workflowId> --json 2>&1 | node -e "
const wf = JSON.parse(require('fs').readFileSync(0,'utf8'));
const node = wf.nodes.find(n => n.name === '<failedNodeName>');
if (node) {
  const out = { name: node.name, type: node.type, typeVersion: node.typeVersion };
  if (node.parameters) out.parameters = node.parameters;
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('Node not found');
  wf.nodes.forEach(n => console.log('Available:', n.name, n.type));
}
"
```

### 4. Report

```
## Debug Report: <workflowName>
**ID:** `<workflowId>`
**Active:** yes/no

### Failed Execution
**Execution ID:** `<id>` | **Started:** `<timestamp>` | **Duration:** `<N>s`

### Failed Node
**Node:** `<name>` (`<nodeType>`)
**Error:** `<message>`

### Data at point of failure
```json
<first 500 chars of node input>
```

### Root Cause Analysis
<2-3 sentences>

### Fix Plan
1. ...
2. ...
3. ...
```