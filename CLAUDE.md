# CLAUDE.md

## Project: Presale Processing Agent (PoC)

AI-powered agent that analyzes presale requests via Microsoft Teams, estimates effort, and generates a structured WBS. Teams bot is a thin relay — all AI logic lives in n8n workflows.

## Architecture

```
Teams → Azure Bot Service (F0) → microsoft-teams-bot (Node.js) → n8n webhook → Claude Sonnet 4.6
```

> Qdrant (vector search) and SharePoint (file storage) are **planned but not yet implemented**.
> Current multi-turn memory uses n8n workflow `staticData` (in-memory, lost on n8n restart, last 10 turns).

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
    presale-agent-workflow.json  # Main 6-node workflow: webhook → history → Claude → reply
    echo-workflow.json           # 3-node smoke-test echo workflow
    deploy.js                    # CLI: deploys/activates workflow via n8n REST API
    .env.example                 # ANTHROPIC_API_KEY=

integrations/                 # Future Docker stack (not in use — no virtualization)
  docker-compose.yml          # n8n + Qdrant service definitions
  .env.example                # N8N_WEBHOOK_BASE_URL, GENERIC_TIMEZONE

.claude/
  commands/
    deploy-n8n.md             # /deploy-n8n slash command
    start-dev.md              # /start-dev slash command
```

## Key Commands

```bash
# Start all dev services at once (n8n + bot + tunnel via concurrently)
cd microsoft-teams-bot && npm run start:dev

# Or start individually:
cd microsoft-teams-bot && npm run n8n      # n8n (Windows: sets N8N_BLOCK_ENV_ACCESS_IN_NODE=false)
cd microsoft-teams-bot && npm run bot      # nodemon watch mode
cd microsoft-teams-bot && npm run tunnel   # devtunnel host tidy-river-mfkpvdl.euw

# Deploy/update n8n workflow
node orchestrator/n8n/deploy.js --url http://localhost:5678 --key <api-key>
node orchestrator/n8n/deploy.js --url http://localhost:5678 --key <api-key> --file orchestrator/n8n/echo-workflow.json

# Rebuild Teams app zip after manifest changes
cd microsoft-teams-bot && npm run build:teams
```

### Claude Slash Commands

```
/start-dev          # runs: cd microsoft-teams-bot && npm run start:dev
/deploy-n8n [args]  # runs: node orchestrator/n8n/deploy.js <args>
                    #   requires --url <n8n-server-url>
                    #   optional --key <api-key>, --file <path>, --name <workflow-name>
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

> **Note:** Docker/virtualization is not available on this machine.
> `integrations/docker-compose.yml` is kept for future reference.

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
```

### `orchestrator/n8n/.env`

```
N8N_API_KEY=<n8n api key>
ANTHROPIC_API_KEY=<key>     # used by the n8n workflow via httpRequest node
```

## n8n Workflow: presale-agent

Pipeline (6 nodes):

1. **Teams Bot Webhook** — POST `/webhook/presale-agent`, `responseMode: responseNode`
2. **Load Conversation History** — reads per-`conversationId` turn history from `staticData` (in-memory)
3. **Prepare Claude Request** — builds Anthropic Messages API body:
   - System: expert EPAM presale consultant → Executive Summary, Key Requirements, WBS, Effort Estimates, Risks
   - PDF attachments sent as `document` content blocks (`pdfs-2024-09-25` beta); other file types noted as unsupported
   - Model: `claude-sonnet-4-6`, `max_tokens: 4096`, last 10 turns prepended
4. **Call Claude** — HTTP POST `https://api.anthropic.com/v1/messages` with header `anthropic-beta: pdfs-2024-09-25`
5. **Extract Reply** — extracts `content[0].text`
6. **Save Conversation History** — appends user+assistant turn to staticData, capped at 10 turns
7. **Respond to Webhook** — returns `{ reply: "..." }` to the bot

Echo workflow: POST `/webhook/echo-test` → echoes message + file names (smoke test).

## n8n Webhook Contract

The bot POSTs to `N8N_WEBHOOK_URL` with:
```json
{
  "message": "user text",
  "conversationId": "...",
  "userId": "...",
  "userName": "...",
  "channelId": "msteams",
  "serviceUrl": "...",
  "attachments": [{
    "name": "file.pdf",
    "contentType": "application/pdf",
    "contentUrl": "...",
    "content": "<base64-encoded bytes, max 10 MB>"
  }]
}
```

Attachments are **downloaded by the bot** (Bearer token via `MicrosoftAppCredentials`) and base64-encoded before being forwarded. n8n responds with `{ "reply": "..." }`.

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

## Tech Stack

| Layer | Technology |
|---|---|
| Teams Bot | Node.js, botbuilder ^4.23, restify |
| Orchestrator | n8n (global npm — `n8n start`) |
| LLM | Claude Sonnet 4.6 (Anthropic, via n8n httpRequest) |
| Conversation Memory | n8n workflow staticData (in-memory, 10-turn window) |
| Vector DB | Qdrant — **deferred** (needs Docker/virtualization) |
| File Storage | SharePoint — **planned**, not yet integrated |
| Tunnel (dev) | devtunnel (Microsoft) |
| Bot Service | Azure Bot Service F0 |
| Auth | Azure AD App Registration (SingleTenant) |
