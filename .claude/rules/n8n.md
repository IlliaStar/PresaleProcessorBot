---
description: Rules for the n8n orchestrator — workflow JSON files, node conventions, deployment, Docker management, and known issues.
paths: 
  - orchestrator/n8n/**
---

# n8n Orchestrator

Manages the n8n workflow files that power the Presale Agent pipeline.

## Directory Structure

```
orchestrator/n8n/
  docker-compose.yml               # n8n + Qdrant Docker stack
  .env.example                     # ANTHROPIC_API_KEY, AZURE_GRAPH_*, SHAREPOINT_*
  workflows/
    presale-agent-workflow.json    # Main workflow: Webhook → AI Agent (Claude Sonnet 4.6 + Memory) → Callback
    sharepoint-agent-workflow.json # SharePoint agent sub-workflow
  prompts/                         # AI agent system prompts (injected before deploy)
    presale-agent-workflow-Presale Agent.md
    sharepoint-agent-workflow-SharePoint AI Agent.md
  fixtures/                        # Pinned data fixtures for TDD testing
  _backup/
    presale-agent-workflow.json    # Archived dispatcher version (SharePoint state machine)
```

## Environment

See [`orchestrator/n8n/.env`](../../orchestrator/n8n/.env) (template: [`orchestrator/n8n/.env.example`](../../orchestrator/n8n/.env.example)).

## Docker Management

```bash
# Start n8n
cd orchestrator/n8n && docker compose up -d n8n

# Stop n8n
cd orchestrator/n8n && docker compose down
```

## Sub-Workflows

| Workflow | File | AI Model | Purpose |
|---|---|---|---|
| SharePoint Agent | `sharepoint-agent-workflow.json` | Haiku 4.5 | File download via SharePoint connector + Presales list CRUD via direct HTTP tools. |

> Qdrant (vector search) is **planned but not yet implemented**.

## Architecture Decisions

- **Greeting handled outside the AI agent** — greetings are detected in the Prepare Input node and short-circuit to a static Adaptive Card, bypassing the AI agent entirely. This keeps the agent stateless for the happy path and prevents accidental state resets from mid-conversation pleasantries.

## Rules

- **Always use `/n8n-deploy-flow` for all n8n workflow deployments** — this is the canonical deploy tool. It handles prompt injection + n8n-cli update in the correct order. Never deploy a workflow by running `node scripts/inject-prompt.js` or `n8n-cli workflow update` manually in isolation. The command is defined in `.claude/commands/n8n-deploy-flow.md`.
- **`n8n-cli` is the primary deployment tool** — use it for all workflow create/update/activate operations. MCP tools (`n8n_*`) are secondary and used only for inspection (list, read) or when n8n-cli is unavailable.
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
- **Prompt Injection (Option #4)** — AI agent node system prompts are stored as standalone `.md` files in `orchestrator/n8n/prompts/` for clean editing with proper git diff. The script `scripts/inject-prompt.js` syncs them into the workflow JSON.
  - **Edit prompts** in `orchestrator/n8n/prompts/<workflow-slug>-<node-name>.md` — plain markdown, no escaping.
  - **Before ANY deploy**, always run `node scripts/inject-prompt.js inject` from `orchestrator/n8n/` to bake the latest prompt text into the workflow JSON files. This is a required step — if you skip it, the deployed workflow will have stale prompt text.
  - **Extract** from JSON back to `.md` (e.g. after editing in n8n UI): `node scripts/inject-prompt.js extract`.
  - **Deploy sequence** for workflows with AI agent nodes: `inject` → `update` (via `n8n-cli` or MCP).
  - Only workflows with `@n8n/n8n-nodes-langchain.agent` nodes are affected. Trigger-only workflows skip automatically.
  - Current prompt mapping:
    - `presale-agent-workflow-Presale Agent.md` → `presale-agent-workflow.json` / "Presale Agent" node
    - `sharepoint-agent-workflow-SharePoint AI Agent.md` → `sharepoint-agent-workflow.json` / "SharePoint AI Agent" node
- **Workflow IDs & Version Control**:
  - **Stable IDs**: The `id` field in workflow JSONs must remain unchanged to prevent creating duplicates upon re-import.
  - **Sub-workflow Dependencies**: Keep sub-workflow IDs strictly identical across environments to ensure "Execute Workflow" node linkages do not break.
  - **UUIDv4 Generation**: When creating new workflows, always generate a standard UUID v4 for the workflow `id`.

## Known Issues

- **Proactive callback unreachable from Docker** — n8n container cannot reach `localhost:3978`; use `PROACTIVE_CALLBACK_URL=http://host.docker.internal:3978/proactive`.
- **Credential ID reset on container recreation** — fresh n8n DB assigns new credential IDs; must recreate "Anthropic account" + "Microsoft Graph - Presale Agent" credentials and update workflow node references.
- **OAuth token exchange fails with ENETUNREACH (IPv6)** — Docker Desktop on Windows tries IPv6 for `login.microsoftonline.com` which is unreachable. Fix: add `extra_hosts` to `docker-compose.yml` with a known IPv4 of `login.microsoftonline.com` (e.g. `40.126.31.71`). `NODE_OPTIONS=--dns-result-order=ipv4first` and `sysctls` do NOT work on Docker Desktop/Windows.
