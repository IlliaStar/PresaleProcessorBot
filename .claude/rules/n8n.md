---
description: Rules for the n8n orchestrator — workflow JSON files, node conventions, and deployment.
paths: 
  - orchestrator/n8n/**
---

# n8n Orchestrator

Manages the n8n workflow files that power the Presale Agent pipeline.

## Rules

- **Always use n8n MCP tools** (`n8n_*`) for ALL workflow management: create, update, activate, deactivate, delete, list, validate, and execute. This is mandatory — never skip MCP in favour of the CLI, UI, or direct JSON edits unless the MCP tool explicitly returns an error or is unreachable. Fall back to `npx n8nac push` only as a last resort when the MCP connection is confirmed unavailable.
- **Node IDs** — every node must have a unique UUID (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`). Never reuse or increment IDs from other nodes.
- **typeVersion** — always use the latest stable typeVersion for each node type. Do not downgrade without a reason.
- **AI port connections** — Claude model nodes connect via `"ai_languageModel"` port; memory nodes via `"ai_memory"` port; tool nodes via `"ai_tool"` port. Never wire these through `"main"`.
- **Credential references** — use the existing credential IDs: Anthropic → `GQ2oI4MTfb66gp8c` ("Anthropic account"). After container recreation, credential IDs reset — recreate credentials and update all node references.
- **Webhook path** — the main webhook path is `presale-agent`. Do not change it without updating `N8N_WEBHOOK_URL` in the bot's `.env`.
- **`responseMode: onReceived`** — the webhook must respond immediately; all processing happens asynchronously with a proactive callback to the bot.
- **`continueOnFail: true`** on the Teams Callback node — a failed callback must not crash the workflow.
- **Window Buffer Memory sessionKey** — always set to `={{ $('Prepare Input').item.json.conversationId }}` so each Teams conversation has isolated memory.
- **executionOrder** — always `"v1"` in workflow settings.
- **Workflow Naming Conventions**:
  - **Action-Oriented**: Start names with an action verb (e.g., "Extract User Info from Entra").
  - **Contextual Prefixes**: Use tags for projects or environments (e.g., `[PPA]`, `[PROD]`).
  - **Formatting**: Use `kebab-case` for workflow file names (e.g., `get-user-info-workflow.json`) and Title/Sentence case for n8n UI display names.
  - **Modularity**: Clearly distinguish main workflows and sub-workflows (e.g., `Main - Presale Agent Processing`, `Sub - Get User Info`).
- **Workflow IDs & Version Control**:
  - **Stable IDs**: The `id` field in exported workflow JSONs must remain unchanged to prevent creating duplicates upon re-import.
  - **Sub-workflow Dependencies**: Keep sub-workflow IDs strictly identical across environments to ensure "Execute Workflow" node linkages do not break.
  - **UUIDv4 Generation**: When creating new workflows via code or AI, always generate a standard UUID v4 for the workflow ID.
