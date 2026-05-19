# CLAUDE.md

## Project: Presale Processing Agent (PoC)

AI-powered agent that analyzes presale requests via Microsoft Teams, estimates effort, and generates a structured WBS. Teams bot is a thin relay — all AI logic lives in n8n workflows.

## Architecture

```
Teams → Azure Bot Service (F0) → microsoft-teams-bot (Node.js) → n8n webhook → n8n AI Agent → Claude Haiku 4.5
```

> Qdrant (vector search) and SharePoint (file storage) are **planned but not yet implemented**.
> Current multi-turn memory uses n8n **Window Buffer Memory** (LangChain, in-memory, last 10 turns, lost on n8n restart).
> Bot uses **fire-and-forget** pattern — sends payload to n8n, n8n calls back via `PROACTIVE_CALLBACK_URL`.

## Directory Structure

```
microsoft-teams-bot/          # Node.js Teams bot (relay only)
  index.js                    # restify server + BotFrameworkAdapter
  src/bot.js                  # PresaleBot — downloads attachments, POSTs to n8n, replies
  src/config.js               # env var config (dotenv)
  package.json                # scripts: start, bot, n8n, tunnel, start:dev, build:teams
  Dockerfile                  # node:20-slim, EXPOSE 3978
  .env.example
  .claude/commands/
    deploy-n8n.md             # /deploy-n8n scoped to bot subdir
  teams-app/
    manifest.json             # Teams manifest v1.16, supportsFiles: true
    color.png / outline.png   # 192×192 and 32×32 icons
    build-package.js          # archives manifest + icons → presale-bot.zip
    presale-bot.zip           # sideload this in Teams

orchestrator/
  n8n/
    presale-agent-workflow.json  # Main 7-node workflow: webhook → AI Agent (LangChain) → proactive callback
    echo-workflow.json           # 3-node smoke-test echo workflow
    deploy.js                    # CLI: deploys/activates workflow via n8n REST API
    .env.example                 # ANTHROPIC_API_KEY=

integrations/                 # Docker stack
  docker-compose.yml          # n8n + Qdrant service definitions
  n8nac-config.json           # n8nac Dev environment config (localhost:5678)
  .env.example                # N8N_WEBHOOK_BASE_URL, GENERIC_TIMEZONE

.claude/
  commands/
    deploy-n8n.md             # /deploy-n8n slash command
    start-dev.md              # /start-dev slash command
```

## Rules

- **Always use the n8n MCP tools** (`n8n_*`) for all n8n workflow management (create, update, activate, deploy, list). Never use the CLI (`npx n8nac`, `node deploy.js`) unless the MCP tool is unavailable.

## Key Commands

```bash
# Start n8n via Docker (do this first)
cd integrations && docker compose up -d n8n

# Start bot + tunnel + n8nac watch (n8n is handled by Docker now)
cd microsoft-teams-bot && npm run start:dev

# Or start individually:
cd microsoft-teams-bot && npm run bot      # nodemon watch mode
cd microsoft-teams-bot && npm run tunnel   # devtunnel host tidy-river-mfkpvdl.euw

# Deploy/update n8n workflow (uses n8nac Dev environment — no URL/key needed)
npx n8nac push orchestrator/n8n/presale-agent-workflow.json --env Dev
npx n8nac push orchestrator/n8n/echo-workflow.json --env Dev

# Rebuild Teams app zip after manifest changes
cd microsoft-teams-bot && npm run build:teams

# n8nac — workflow as code (watches local workflow files and syncs with n8n)
npx n8nac watch                          # watch mode (also runs as part of start:dev)
npx n8nac list                           # list all workflows
npx n8nac push <path>                    # upload a local workflow to n8n
npx n8nac pull <workflowId>              # download a workflow from n8n
```

### Claude Slash Commands

```
/start-dev          # runs: cd microsoft-teams-bot && npm run start:dev
/deploy-n8n [args]  # runs: node orchestrator/n8n/deploy.js <args>
                    #   requires --url <n8n-server-url>
                    #   optional --key <api-key>, --file <path>, --name <workflow-name>
```

### n8nac One-time Setup

```bash
# Initialize the Dev environment (already done — stored in n8nac config)
npx n8nac env add Dev --base-url http://localhost:5678 --api-key <n8n-api-key>
```

### One-time setup

```bash
# Expose bot to Azure Bot Service
devtunnel user login
devtunnel create --allow-anonymous
devtunnel port create tidy-river-mfkpvdl.euw -p 3978

# Set messaging endpoint (URL is persistent — run once)
az account set --subscription 46e73b37-b5cd-40a3-8643-a9218e9d97c0
az bot update --resource-group presale-agent-rg --name presale-bot \
  --endpoint "https://tidy-river-mfkpvdl.euw-3978.devtunnels.ms/api/messages"
```

> **Note:** Docker is available. n8n runs via `integrations/docker-compose.yml`.
> Start n8n: `cd integrations && docker compose up -d n8n`
> Stop n8n: `cd integrations && docker compose down`

## Environment Setup

### `microsoft-teams-bot/.env`

```
MICROSOFT_APP_ID=44c69ed7-637b-48ec-922e-a5eacbfcb938
MICROSOFT_APP_PASSWORD=<client secret>
MICROSOFT_APP_TYPE=SingleTenant
MICROSOFT_APP_TENANT_ID=0d9ed809-b1ed-46bd-b3e3-5ccb093ae299
PORT=3978
N8N_WEBHOOK_URL=http://localhost:5678/webhook/presale-agent
N8N_TIMEOUT=120000          # ms, default 120 s
MAX_ATTACHMENT_BYTES=10485760  # 10 MB cap on downloaded attachments
PROACTIVE_CALLBACK_URL=http://host.docker.internal:3978/proactive  # required: n8n runs in Docker
```

### `orchestrator/n8n/.env`

```
N8N_API_KEY=<n8n api key>
ANTHROPIC_API_KEY=<key>     # stored as n8n credential "Anthropic account" (type: anthropicApi)
```

## n8n Workflow: presale-agent

**Workflow ID:** `Crhg0EtBQyP0vEWx`

Pipeline (7 nodes):

1. **Teams Bot Webhook** — POST `/webhook/presale-agent`, `responseMode: onReceived` (returns 200 immediately)
2. **Prepare Input** — extracts `conversationId`, `userMessage`, `sessionId` from body; formats attachment tags
3. **AI Agent** (LangChain) — runs Claude with system prompt: expert EPAM presale consultant → Executive Summary, Key Requirements, WBS, Effort Estimates, Risks
4. **Anthropic Chat Model** — `claude-haiku-4-5-20251001`, `max_tokens: 4096`; credential: "Anthropic account"
5. **Window Buffer Memory** — per-`sessionId` conversation window, last 10 turns (in-memory)
6. **Format Reply** — extracts `output` text from agent response
7. **Proactive Callback** — POST to `callbackUrl` (from request body) with `{ conversationId, reply }`

Echo workflow: POST `/webhook/echo-test` → echoes message + file names (smoke test).

> **After n8n container recreation:** credential ID changes. Create "Anthropic account" credential in UI, then update workflow node via MCP: `updateNode` on "Anthropic Chat Model" with new credential ID.

## n8n Webhook Contract

The bot fires-and-forgets to `N8N_WEBHOOK_URL` (10 s timeout, no response body used):
```json
{
  "message": "user text",
  "conversationId": "...",
  "userId": "...",
  "userName": "...",
  "channelId": "msteams",
  "serviceUrl": "...",
  "callbackUrl": "http://host.docker.internal:3978/proactive",
  "attachments": [{
    "name": "file.pdf",
    "contentType": "application/pdf",
    "contentUrl": "...",
    "content": "<base64-encoded bytes, max 10 MB>",
    "sizeBytes": 12345
  }]
}
```

Attachments are **downloaded by the bot** (Bearer token via `MicrosoftAppCredentials`) and base64-encoded before forwarding.

n8n processes asynchronously, then POSTs to `callbackUrl` with `{ conversationId, reply }`. The bot's `/proactive` endpoint receives this and sends the reply to Teams via `adapter.continueConversation`.

## Azure Resources

| Resource | Value |
|---|---|
| Subscription | Visual Studio Enterprise (`46e73b37-b5cd-40a3-8643-a9218e9d97c0`) |
| Tenant | `0d9ed809-b1ed-46bd-b3e3-5ccb093ae299` (ilya.staradubets@gmail.com) |
| Resource Group | `presale-agent-rg` (West Europe) |
| Bot Service | `presale-bot` (F0, SingleTenant) |
| App Registration | `Presale Bot` — App ID `44c69ed7-637b-48ec-922e-a5eacbfcb938` |
| Service Principal | `fd588b93-82ef-4b9d-8c90-4bf1cd6ec5fb` (created manually) |
| Teams Channel | Enabled |
| devtunnel URL | `https://tidy-river-mfkpvdl.euw-3978.devtunnels.ms` (persistent) |

## Teams App Sideload

Package: `microsoft-teams-bot/teams-app/presale-bot.zip`
Teams → Apps → Manage your apps → Upload a custom app → select the zip.

## Known Issues Fixed

- **Service Principal missing** — had to run `az ad sp create --id 44c69ed7-637b-48ec-922e-a5eacbfcb938` manually
- **Proactive callback unreachable from Docker** — n8n container cannot reach `localhost:3978`; use `PROACTIVE_CALLBACK_URL=http://host.docker.internal:3978/proactive`
- **Credential ID reset on container recreation** — fresh n8n DB assigns new credential IDs; must recreate "Anthropic account" credential and update workflow node

## Tech Stack

| Layer | Technology |
|---|---|
| Teams Bot | Node.js, botbuilder ^4.23, restify |
| Orchestrator | n8n (Docker) + n8nac (workflow as code) |
| LLM | Claude Haiku 4.5 (Anthropic, via n8n LangChain AI Agent) |
| Conversation Memory | n8n Window Buffer Memory (LangChain, in-memory, 10-turn window) |
| Vector DB | Qdrant — **deferred** (needs Docker/virtualization) |
| File Storage | SharePoint — **planned**, not yet integrated |
| Tunnel (dev) | devtunnel (Microsoft) |
| Bot Service | Azure Bot Service F0 |
| Auth | Azure AD App Registration (SingleTenant) |
