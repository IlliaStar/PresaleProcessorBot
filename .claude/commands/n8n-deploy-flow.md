# n8n Deploy Flow

Deploy one or all n8n workflows from local JSON files to the running n8n instance. Handles prompt injection, workflow update/import, and verification. All mechanics in `scripts/n8n-deploy-flow.js`.

**Usage:**
- `/n8n-deploy-flow` — deploy all workflows
- `/n8n-deploy-flow presale` — deploy workflow(s) matching the name fragment
- `/n8n-deploy-flow orchestrator/n8n/workflows/presale-agent-workflow.json` — deploy specific file

## Steps

### 1. Run deploy script

```bash
node scripts/n8n-deploy-flow.js <target>
```

Parse the JSON output for `results[]`, `promptInjected`, `deployCount`, `verified`, and `error`.

- If `error` is set → report it and stop
- If `promptInjected === false` → note that prompt injection was skipped

### 2. Handle errors

Common failures and their fixes:

- **`file not found`** — path doesn't exist. Use tab-completion or check the path.
- **`no workflows matched`** — name fragment doesn't match any file. List workflows dir and ask user to choose.
- **n8n not running** — start first: `docker compose -f orchestrator/n8n/docker-compose.yml up -d n8n`
- **`workflow not found`** (during update) — try importing instead (script handles this automatically)
- **`credential not found`** — after container recreation, recreate "Anthropic account" and "Microsoft SharePoint - t8lxc" credentials via n8n UI, then update credential IDs in the workflow JSON
- **`--jq returns null`** — script uses `node -e` internally, not `--jq`

### 3. Report

```
## Deploy Report

| File | Workflow ID | Status |
|---|---|---|
| file.json | unPvfldAhlEkBcqi | ✓ updated |
| file2.json | P8NecHn00l4qArkW | ✓ imported |

Prompt injection: ✓ complete
Deploy count: 2
Verified: ✓
```