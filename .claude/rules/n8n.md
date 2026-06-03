---
description: Rules for the n8n orchestrator — workflow JSON files, node conventions, and deployment.
paths: 
  - orchestrator/n8n/**
---

# n8n Orchestrator

Manages the n8n workflow files that power the Presale Agent pipeline.

## Rules

- **Variables ($vars vs $env)** — We use the Free/Community Edition of n8n, which does **NOT** support Instance Variables (`$vars`). Never use `$vars` in expressions. Instead, retrieve configuration from environment variables via `$env.VARIABLE_NAME`.
- **Environment variables in UI (`N8N_ENV_VARS_UI_ALLOWED`)** — By default, `$env` variables are blocked from the UI and show as `undefined`. Always explicitly allow needed variables (e.g., `SHAREPOINT_SITE_URL`) by appending them to `N8N_ENV_VARS_UI_ALLOWED` in `docker-compose.yml`.
- **Deploy command** — `n8n-cli workflows update <id> --file <path> --yes --skip-validation`. Use `--skip-validation` because n8n-cli does not know LangChain node types locally.
- **Create command** — `n8n-cli workflows import <path>` for new workflows. Note: assign the returned ID back into the JSON `id` field.
- **Activate after creation** — newly created workflows are inactive by default. Always activate the workflow immediately after creation using `n8n_update_partial_workflow` with `activateWorkflow` operation (or `n8n-cli workflows activate <id>`). Never leave a newly created workflow inactive.
- **Source JSON must not contain read-only fields** — never include `active`, `versionId`, `meta`, `tags`, or `settings.binaryMode` in workflow JSON files. The API rejects them on write.
- **Auth** — credentials are stored in `~/.n8nrc.json` (set once via `n8n-cli auth login -H http://localhost:5678 -k <key>`). API key lives in `orchestrator/n8n/.env` as `N8N_API_KEY`.
- **Node IDs** — every node must have a unique UUID (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`). Never reuse or increment IDs from other nodes.
- **typeVersion** — always use the latest stable typeVersion for each node type. Do not downgrade without a reason.
- **AI port connections** — Claude model nodes connect via `"ai_languageModel"` port; memory nodes via `"ai_memory"` port; tool nodes via `"ai_tool"` port. Never wire these through `"main"`.
- **Credential references** — use the existing credential IDs from the running n8n instance. After container recreation, credential IDs reset — recreate credentials and update all node references. Current Anthropic credential: `tveGybvizLkoc6QO` ("Anthropic account").
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
  - **Stable IDs**: The `id` field in workflow JSONs must remain unchanged to prevent creating duplicates upon re-import.
  - **Sub-workflow Dependencies**: Keep sub-workflow IDs strictly identical across environments to ensure "Execute Workflow" node linkages do not break.
  - **UUIDv4 Generation**: When creating new workflows, always generate a standard UUID v4 for the workflow `id`.
