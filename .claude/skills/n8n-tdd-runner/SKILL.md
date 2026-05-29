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

1. **Edit** the workflow JSON (`orchestrator/n8n/workflows/<name>.json`)
2. **Run** the test runner (see command below)
3. **If PASS** (exit 0) → done
4. **If FAIL** (exit 1) → read `orchestrator/n8n/fixtures/latest-execution-log.json`, diagnose, fix, go to step 1

---

## Run command

```bash
node '.claude/skills/n8n-tdd-runner/test-runner.js' \
  --workflow 'orchestrator/n8n/workflows/<your-workflow>.json' \
  --fixture  'orchestrator/n8n/fixtures/<your-trigger>.json'
```

**All flags:**

| Flag | Default | Purpose |
|---|---|---|
| `--workflow` | *(required)* | Workflow JSON to deploy |
| `--fixture` | *(required)* | Webhook payload to send |
| `--timeout` | `90000` | Max ms to wait for execution |
| `--log-out` | `orchestrator/n8n/fixtures/latest-execution-log.json` | Where to save execution log |

---

## Fixtures

Create one JSON file per workflow under `orchestrator/n8n/fixtures/`. The file should contain the raw webhook payload the workflow expects. Name it `<workflow-name>-trigger.json` by convention.

**Example:**
```json
{ "message": "hello", "conversationId": "test-123", "callbackUrl": "http://localhost:3978/proactive" }
```

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
