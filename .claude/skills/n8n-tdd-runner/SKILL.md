# n8n TDD Runner

Autonomous TDD agent for developing and debugging n8n workflows. Deploys workflow JSON to the local n8n instance, fires a test fixture through the webhook, polls for the execution result, reads error details from the log, fixes the workflow, and repeats until the run passes.

---

## When to invoke

- Developing a new n8n workflow or adding nodes to an existing one
- Debugging a workflow that errors out or produces wrong output
- Verifying that a workflow change works end-to-end before committing

---

## Prerequisites

```bash
# n8n must be running
cd orchestrator/n8n && docker compose up -d n8n

# N8N_API_KEY must be set in orchestrator/n8n/.env
```

---

## TDD Loop

Repeat the following steps until exit code is 0:

0. **Understand requirements** — derive fixture input and expected output from the user's description (see sections below)
1. **Edit** the workflow JSON (`orchestrator/n8n/workflows/<name>.json`)
2. **Run** the test runner (see command below)
3. **If PASS** (exit 0) → confirm output looks correct, then done
4. **If FAIL** (exit 1):
   - `status=error` → read `orchestrator/n8n/fixtures/latest-execution-log.json`, find the first node with an `error` key, fix it, go to step 1
   - `status=success` but `OUTPUT MISMATCH` → read the printed diff (expected subset vs actual), fix the node that produces the wrong output, go to step 1

---

## Run command

```bash
node '.claude/skills/n8n-tdd-runner/test-runner.js' \
  --workflow  'orchestrator/n8n/workflows/<your-workflow>.json' \
  --fixture   'orchestrator/n8n/fixtures/<your-trigger>.json' \
  --expected  'orchestrator/n8n/fixtures/<your-expected>.json'
```

**All flags:**

| Flag | Default | Purpose |
|---|---|---|
| `--workflow` | *(required)* | Workflow JSON to deploy |
| `--fixture` | *(required)* | Webhook payload to send |
| `--expected` | `(none)` | Expected output JSON; runner asserts terminal node output against this file (deep subset match) |
| `--timeout` | `90000` | Max ms to wait for execution |
| `--log-out` | `orchestrator/n8n/fixtures/latest-execution-log.json` | Where to save execution log |

---

## Fixture Generation

Before running the TDD loop, derive the fixture from the user's requirement:

1. Read the workflow's trigger node to understand what fields it expects
2. Create `orchestrator/n8n/fixtures/<workflow>-trigger.json` with realistic test values

**graph-api-agent example:**
```json
{
  "query": "Get the profile of user john.doe@contoso.com",
  "conversationId": "test-conv-001",
  "userName": "TDD Test User",
  "aadObjectId": "00000000-0000-0000-0000-000000000001"
}
```

**presale-agent example:**
```json
{
  "message": "We need a CRM system for 50 users",
  "conversationId": "test-conv-001",
  "userId": "user-001",
  "userName": "Test User",
  "channelId": "msteams",
  "serviceUrl": "https://smba.trafficmanager.net/emea/",
  "callbackUrl": "http://localhost:3978/proactive"
}
```

---

## Expected Output

Create `orchestrator/n8n/fixtures/<workflow>-expected.json` declaring what the terminal node must produce. Only the declared fields are checked — extra fields in the actual output are ignored (deep-subset match).

**Format:**
```json
{
  "$node": "Format Response",
  "status": "success",
  "data_type": "user_profile",
  "payload": {
    "displayName": "John Doe"
  }
}
```

| Key | Purpose |
|---|---|
| `$node` | *(optional)* Which terminal node to assert. Defaults to the last terminal node if omitted. |
| everything else | Deep-subset fields to match against `item[0].json` of the target node |

**Rules:**
- Use only fields the user explicitly cares about — avoid asserting timestamps, IDs, or metadata that changes per run
- For LLM-driven outputs, assert `status`, `data_type`, and top-level payload shape — not exact text
- `null` values are skipped (treated as don't-care)

---

## Reading the execution log

After each run, open `orchestrator/n8n/fixtures/latest-execution-log.json`.

```jsonc
{
  "status": "error",           // "success" | "error"
  "executionId": "42",
  "startedAt": "...",
  "stoppedAt": "...",
  "data": {
    "resultData": {
      "runData": {
        "NodeName": [          // one entry per node run
          {
            "error": { ... }   // present when node failed
          }
        ]
      }
    }
  }
}
```

Find the first node with an `error` key — that is the failing node.

---

## Common failure patterns and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `The workflow you are trying to execute doesn't exist` | Workflow `id` in JSON doesn't match n8n DB | Run `n8n_list_workflows` to find the real ID; update the `id` field in the JSON |
| `Credential not found` | Credential ID was reset after container recreation | Recreate the credential via `n8n_manage_credentials`, update the node's `credentials` reference |
| `Cannot read properties of undefined` | Expression bug (`$json.foo` on missing key) | Add null-guard or fix the expression in the node's parameters |
| HTTP 4xx / 5xx from external API | Wrong URL, auth, or payload | Check node parameters; verify credential values |
| Execution never appears (timeout) | Webhook not reachable or workflow inactive | Confirm `docker compose up` is running; runner auto-activates but check n8n UI |
| `Execution did not complete within Xs` | Long-running AI call | Increase `--timeout` (e.g. `--timeout 180000`) |

---

## What the runner does internally

1. Reads `N8N_API_KEY` and `N8N_BASE_URL` from `orchestrator/n8n/.env`
2. Strips read-only fields (`active`, `versionId`, `meta`, `tags`, `settings.binaryMode`) from the workflow JSON
3. `PUT /api/v1/workflows/:id` — deploys the latest edits
4. `POST /api/v1/workflows/:id/activate` — ensures the workflow is active (idempotent)
5. `POST /webhook/<path>` — fires the fixture payload
6. Polls `GET /api/v1/executions?workflowId=:id&limit=5` every 2.5 s until an execution started after the trigger timestamp is finished
7. Fetches full execution detail (`GET /api/v1/executions/:execId`) and saves to the log file
8. Exits **0** on `success`, **1** on `error` or timeout

---

## Project structure

```
.claude/skills/n8n-tdd-runner/
  SKILL.md          ← this file
  test-runner.js    ← Node.js orchestrator (no external deps)

orchestrator/n8n/
  workflows/        ← workflow JSON source files
  fixtures/
    <workflow>-trigger.json     ← one fixture per workflow
    latest-execution-log.json   ← written after every run
  .env              ← N8N_API_KEY, N8N_BASE_URL
```
