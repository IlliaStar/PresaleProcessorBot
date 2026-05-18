# CLAUDE.md

## Project: Presale Processing Agent (PoC)

AI-powered agent that analyzes presale requests via Microsoft Teams, estimates effort, and generates a structured WBS. Teams bot is a thin relay — all AI logic lives in n8n workflows.

## Architecture

```
Teams → Azure Bot Service (F0) → microsoft-teams-bot (Node.js) → n8n webhook → Claude Sonnet 4.6
                                                                              → Qdrant (vector search)
                                                                              → SharePoint (data store)
```

## Directory Structure

```
microsoft-teams-bot/          # Node.js Teams bot (relay only)
  index.js                    # restify server + BotFrameworkAdapter
  src/bot.js                  # PresaleBot — forwards messages to n8n
  src/config.js               # env var config
  package.json
  Dockerfile
  .env.example
  teams-app/                  # Teams sideload package
    manifest.json             # Teams app manifest (bot ID, scopes)
    color.png                 # 192×192 icon
    outline.png               # 32×32 icon
    build-package.js          # builds presale-bot.zip
    presale-bot.zip           # sideload this in Teams

integrations/                 # Local orchestration stack
  docker-compose.yml          # n8n + Qdrant (for future Docker use)
  .env.example
```

## Key Commands

```bash
# Start n8n (global npm install, no Docker required)
n8n start

# Start Teams bot (dev)
cd microsoft-teams-bot && npm start

# Expose bot to Azure Bot Service
ngrok http 3978

# Rebuild Teams app zip after manifest changes
cd microsoft-teams-bot && npm run build:teams
```

> **Note:** Docker/virtualization is not available on this machine.
> `integrations/docker-compose.yml` is kept for future reference (Qdrant, cloud deployment).
> Qdrant will be addressed separately when building AI search workflows.

## Environment Setup

`.env` is already populated. Key variables:

```
MICROSOFT_APP_ID=44c69ed7-637b-48ec-922e-a5eacbfcb938
MICROSOFT_APP_TYPE=SingleTenant
MICROSOFT_APP_TENANT_ID=0d9ed809-b1ed-46bd-b3e3-5ccb093ae299
PORT=3978
N8N_WEBHOOK_URL=http://localhost:5678/webhook/presale-agent
```

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
| Current ngrok URL | `https://watch-spinner-boondocks.ngrok-free.dev` (changes on restart) |

### Update messaging endpoint after ngrok restarts

```bash
az account set --subscription 46e73b37-b5cd-40a3-8643-a9218e9d97c0
az bot update --resource-group presale-agent-rg --name presale-bot \
  --endpoint "https://XXXX.ngrok-free.app/api/messages"
```

## Teams App Sideload

Package is at `microsoft-teams-bot/teams-app/presale-bot.zip`.
To install: Teams → Apps → Manage your apps → Upload a custom app → select the zip.

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
  "attachments": [{ "name": "file.pdf", "contentUrl": "...", "contentType": "..." }]
}
```
n8n must respond with `{ "reply": "text to send back to Teams" }`.

## Known Issues Fixed

- **Service Principal missing** — had to run `az ad sp create --id 44c69ed7-637b-48ec-922e-a5eacbfcb938` manually after App Registration creation
- **ngrok port mismatch** — must run `ngrok http 3978` (not default port 80)

## Tech Stack

| Layer | Technology |
|---|---|
| Teams Bot | Node.js, botbuilder ^4.23, restify |
| Orchestrator | n8n (global npm — `n8n start`) |
| Vector DB | Qdrant (deferred — needs Docker/virtualization) |
| LLM | Claude Sonnet 4.6 (Anthropic) |
| File Storage | SharePoint Document Libraries |
| Tunnel (dev) | ngrok |
| Bot Service | Azure Bot Service F0 |
| Auth | Azure AD App Registration (SingleTenant) |
