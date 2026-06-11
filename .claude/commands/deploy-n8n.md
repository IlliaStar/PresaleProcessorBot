# deploy-n8n

Deploy one or all n8n workflows to the local n8n instance.

**Usage:**
- `/deploy-n8n` — deploy all workflows
- `/deploy-n8n presale` — deploy workflow(s) matching the name fragment
- `/deploy-n8n orchestrator/n8n/workflows/presale-agent-workflow.json` — deploy specific file

## Variables

```
N8N_DIR=/c/Users/IlliaStaradubets/EPAM/Presale\ Processing\ Agent/orchestrator/n8n
```

## Steps

### 1. Parse the parameter

Determine scope:
- No param → **all** — operate on every `*.json` in `$N8N_DIR/workflows/`
- Param ends with `.json` or contains `/workflows/` → **single file** — resolve full path
- Otherwise → **name fragment** — match against workflow file names in `$N8N_DIR/workflows/`

### 2. Inject prompts (required before every deploy)

Run inject for the targeted files only. Skip if the workflow has no AI agent nodes (script handles this automatically):

```bash
cd "$N8N_DIR" && node scripts/inject-prompt.js inject
```

For a single file:
```bash
cd "$N8N_DIR" && node scripts/inject-prompt.js inject workflows/<target>.json
```

### 3. Deploy each workflow via n8n-cli

For each target file, get the workflow `id` from the JSON and update.
**Important:** strip the `id` field before sending — the API rejects it as read-only. Use `--stdin` to pipe the cleaned JSON:

```bash
cd "$N8N_DIR" && \
WF_ID=$(node -e "const f=require('./workflows/<file>');console.log(f.id)") && \
echo "Deploying $WF_ID from <file>..." && \
node -e "const f=require('./workflows/<file>'); delete f.id; process.stdout.write(JSON.stringify(f))" \
  | n8n-cli workflow update $WF_ID --stdin && \
echo "  [OK] $WF_ID deployed"
```

For new workflows (no `id` in JSON), import instead:
```bash
cd "$N8N_DIR" && \
n8n-cli workflow import workflows/<file> && \
echo "  [IMPORTED] <file>"
```

### 4. Verify deployment

After deploying, verify the workflow is present and active.
**Note:** `--jq` with `select()` returns nulls — use Python filter instead:

```bash
cd "$N8N_DIR" && \
n8n-cli workflow list --json \
  | python -c "import sys,json;d=json.load(sys.stdin);w=next((x for x in d if x['id']=='<WF_ID>'),None);print(json.dumps({k:w[k] for k in ['id','name','active']},indent=2))"
```

### 5. Report

Print a summary table:

```
## Deploy Report

| File | Workflow ID | Status |
|---|---|---|
| presale-agent-workflow.json | unPvfldAhlEkBcqi | ✓ Updated |
| graph-api-agent-workflow.json | P8NecHn00l4qArkW | ✓ Updated |
| sharepoint-agent-workflow.json | rDK4JWk961DRUUuP | ✓ Updated |

Prompt injection: ✓ complete
```

## Known Workflow IDs

| File | ID |
|---|---|
| `presale-agent-workflow.json` | `unPvfldAhlEkBcqi` |
| `graph-api-agent-workflow.json` | `P8NecHn00l4qArkW` |
| `sharepoint-agent-workflow.json` | `rDK4JWk961DRUUuP` |
| `sharepoint-upload-file-workflow.json` | `NbSxfbw80T5P6Ewh` |
| `sharepoint-list-operations-workflow.json` | _(check via `n8n-cli workflow list`)_ |

## Error Handling

- **`n8n not running`** — start first: `cd "$N8N_DIR" && docker compose up -d n8n`
- **`workflow not found`** — workflow may not exist yet; use `n8n-cli workflow import` instead of `update`
- **`credential not found`** — after container recreation, recreate "Anthropic account" and "Microsoft SharePoint - t8lxc" credentials in the n8n UI, then update IDs in workflow JSON
- **`request/body/id is read-only`** — strip the `id` field before sending; always use `--stdin` with `delete f.id` as shown in Step 3, never `--file` directly
- **`--jq select()` returns nulls** — use the Python filter from Step 4 for verification instead
- **`Nonexistent flags`** — `--id=`, `--yes`, `--skip-validation` do NOT exist in n8n-cli v0.5.0; correct syntax is `n8n-cli workflow update <ID> --stdin`

## Requirements

- n8n running: `cd "$N8N_DIR" && docker compose up -d n8n`
- n8n-cli logged in: `n8n-cli auth login -H http://localhost:5678 -k <api-key>`
