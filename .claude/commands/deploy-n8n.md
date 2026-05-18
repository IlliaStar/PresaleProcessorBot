---
description: Deploy and activate an n8n workflow to n8n using n8nac
---

Deploy a workflow JSON file to n8n using `n8nac push`, then activate it.

The `Dev` environment is pre-configured (http://localhost:5678) — no URL or API key needed.

**Select workflow (pick one):**
- `--file <path>` — path to any workflow JSON file
- *(omit)* — defaults to `orchestrator/n8n/presale-agent-workflow.json`

Arguments passed by user: `$ARGUMENTS`

## Steps

1. Resolve the workflow file path:
   - If `--file <path>` is in `$ARGUMENTS`, use that path.
   - Otherwise default to `orchestrator/n8n/presale-agent-workflow.json`.

2. Push the workflow using n8nac:
   ```bash
   npx n8nac push <resolved-path> --env Dev
   ```

3. Activate the workflow:
   ```bash
   npx n8nac workflow activate <workflowId> --env Dev
   ```

4. Report back:
   - Whether the workflow was created or updated
   - The workflow ID
   - The live webhook URL
   - Any errors with clear remediation steps
