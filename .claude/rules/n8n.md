---
description: Rules for the n8n orchestrator — workflow JSON files, node conventions, and deployment.
globs: orchestrator/n8n/**
---

# n8n Orchestrator

Manages the n8n workflow files that power the Presale Agent pipeline.

## Structure

```
orchestrator/n8n/
  docker-compose.yml               # n8n + Qdrant Docker stack
  presale-agent-workflow.json      # Main workflow: Webhook → AI Agent (Claude Sonnet 4.6 + Memory) → Callback
  .env.example                     # ANTHROPIC_API_KEY, AZURE_GRAPH_*, SHAREPOINT_*
  _backup/
    presale-agent-workflow.json    # Archived dispatcher (SharePoint state machine, 22 nodes)
```

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
