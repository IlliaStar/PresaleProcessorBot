---
description: Deploy and activate an n8n presale agent workflow to an n8n server
---

Deploy a workflow JSON file to n8n via the REST API, then activate it.

The API key is loaded automatically from `orchestrator/n8n/.env` (one level up from the bot directory).

**Required argument:** `--url <n8n-server-url>`
**Optional:**
- `--file <path>` — workflow JSON to deploy (default: `presale-agent-workflow.json`)
- `--key <api-key>` — override the API key from `.env`

Arguments passed by user: `$ARGUMENTS`

## Steps

1. Confirm `--url` was provided in `$ARGUMENTS`. If missing, ask the user for the n8n server URL.

2. Run the deploy script from the bot directory (one level up leads to the project root):
   ```bash
   node ../orchestrator/n8n/deploy.js $ARGUMENTS
   ```

3. Report back:
   - Whether the workflow was created or updated
   - The workflow ID
   - The live webhook URL
   - Any errors with clear remediation steps
