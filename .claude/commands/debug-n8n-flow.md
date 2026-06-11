# debug-n8n-flow

Analyze the last failed execution of an n8n workflow, identify the error, and propose a fix plan using `n8n-cli`. Accepts one parameter in three forms:

- **Workflow name** — e.g. `"Sub - SharePoint Agent"` or `"Presale Agent"` → finds by name, fetches last execution
- **Execution URL** — e.g. `http://localhost:5678/workflow/<id>/executions/<execution-id>` → fetches that specific execution
- **Workflow JSON path** — e.g. `orchestrator/n8n/workflows/presale-agent-workflow.json` → reads local file, extracts name, then proceeds by name

## Performance Rules

Execute steps in strict order. Use **single combined Bash calls** with `&&` chaining. **Never use `--jq` for `execution get --include-data` or `workflow get` node listing** — n8n-cli `--jq` fails on deep nested structures (returns `null`/empty). Use `node -e` for those two operations instead. Use a fixed absolute path for `N8N_DIR`.

```bash
N8N_DIR="/c/Users/IlliaStaradubets/EPAM/Presale Processing Agent/orchestrator/n8n"
```

## Steps

### 1. Parse input parameter

Determine parameter type:
- If param contains `/execution` → **Execution URL**
- If param contains `.json` or `/workflows/` → **Workflow JSON path**
- Otherwise → **Workflow name**

### 2. Get workflow ID + failed execution (single pipeline — 2 calls chained)

```bash
cd "$N8N_DIR" && \
WF_ID=$(n8n-cli workflow list --name="$PARAM" --jq '.[0].id' | tr -d '"') && \
echo "WF_ID=$WF_ID" && \
EXEC_ID=$(n8n-cli execution list --workflow=$WF_ID --status=error --limit=1 --jq '.[0].id' | tr -d '"') && \
echo "EXEC_ID=$EXEC_ID" && \
[ -n "$EXEC_ID" ] && n8n-cli execution get $EXEC_ID --include-data 2>&1 | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const rd = d.data?.resultData?.runData || {};
const fn = Object.entries(rd).find(([,v]) => v[0]?.executionStatus === 'error');
const result = {
  execution: { id: d.id, status: d.status, startedAt: d.startedAt, stoppedAt: d.stoppedAt },
  lastNodeExecuted: d.data?.lastNodeExecuted || null,
  failedNode: fn ? { name: fn[0], error: fn[1][0]?.error?.message } : null,
  workflowId: d.workflowId
};
// Also capture failed node input
if (fn && fn[1][0]?.data?.main?.[0]?.[0]?.json) {
  result.failedNode.input = fn[1][0].data.main[0][0].json;
}
console.log(JSON.stringify(result, null, 2));
"
```

If no match on exact name, fall back:
```bash
cd "$N8N_DIR" && \
WF_ID=$(n8n-cli workflow list --jq '.[] | select(.name | test("'"$PARAM"'"; "i")) | .id' | tr -d '"') && \
echo "WF_ID=$WF_ID"
```
Then re-run the execution pipeline from step 2.

### 3. Error analysis — get failed node config (only if needed)

If step 2 didn't give enough context, fetch just the failed node's config:

```bash
cd "$N8N_DIR" && n8n-cli workflow get <workflowId> --json 2>&1 | node -e "
const wf = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
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

### 4. Error context (only if needed — skip if step 2 is sufficient)

Run only relevant checks based on error type:

- **`Received tool input did not match expected schema`** → check sub-workflow nodes:
  ```bash
  cd "$N8N_DIR" && n8n-cli workflow get <subWorkflowId> --json 2>&1 | node -e "
  const wf = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  wf.nodes.forEach(n => console.log(n.name, '|', n.type));
  "
  ```
- **`credential`** → check credential:
  ```bash
  n8n-cli credential list --jq '.[] | {id, name, type}'
  ```
- **`ENV`** → check docker-compose:
  ```bash
  grep N8N_ENV_VARS "$N8N_DIR/docker-compose.yml"
  ```
- **`$fromAI` / AI agent prompt** → check prompt freshness:
  ```bash
  cd "$N8N_DIR" && node scripts/inject-prompt.js inject
  ```

### 5. Report (single output)

Format everything from step 2 into a structured report directly. No need to re-query data already in context:

```
## Debug Report: <name>
**ID:** `<id>`
**Active:** yes/no

### Failed Execution
**Execution ID:** `<id>` | **Started:** `<timestamp>` | **Duration:** `<N>s`

### Failed Node
**Node:** `<name>` (`<type>`)
**Error:** `<message>`

### Data at point of failure
```json
<node input, first 500 chars>
```

### Root Cause Analysis
<2-3 sentences>

### Fix Plan
1. ...
2. ...
3. ...

### Commands
```bash
<ready-to-run fix commands>
```
```

## Key Optimizations

| Before (old) | After (new) |
|---|---|
| `execution list` + `execution get --jq` — 2 calls, jq returns empty for nested data | `execution list` + `execution get` piped to `node -e` — 1 pipeline, always works |
| `workflow get --jq '.nodes[]'` — returns `null` for all nodes | `workflow get --json \| node -e` — reliable node listing |
| `EXEC_ID=$(n8n-cli ...)` without `tr -d '"'` — ID has quotes, next call fails | `tr -d '"'` strips quotes in the same expression |
| 4+ attempts debugging `--jq` output before switching to `node -e` | Switch to `node -e` immediately for deep/nested data |
| `--jq` for everything | `--jq` for flat queries only; `node -e` for nested/`runData`/`nodes[]` |

## Requirements

- n8n must be running: `cd <N8N_DIR> && docker compose up -d n8n`
- `n8n-cli` installed and logged in (`n8n-cli login`)