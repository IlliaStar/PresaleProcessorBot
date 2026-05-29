# CLAUDE.md

## Project: Presale Processing Agent (PoC)

AI-powered agent that analyzes presale requests via Microsoft Teams, estimates effort, and generates a structured WBS. Teams bot is a thin relay — all AI logic lives in n8n workflows.

## Architecture

```
Teams → Azure Bot Service (F0) → microsoft-teams-bot (Node.js) → n8n webhook
                                                                       ↓
                                                                  Dispatcher
                                                                       ↓
                                  SharePoint state store ←→ Resolve Routing Step (state machine)
                                  (Conversations + Turns)            ↓
                                                                Topic Router
                                                                       ↓
                                                ┌─── presale_analysis (Claude Sonnet 4.6)
                                                ├─── clarification   (Claude Sonnet 4.6)
                                                ├─── status_check    (Claude Sonnet 4.6)
                                                └─── greeting        (static reply)
                                                                       ↓
                                                          Append turns to SharePoint
                                                                       ↓
                                                         Proactive Callback → Teams
```

> **Conversation state lives in SharePoint** (List `Conversations` + List `Turns` + Document Library `Transcripts`). Each turn reads/writes the lifecycle step (`new → intake → clarification → estimation → review → completed`) — no in-memory state. See [SharePoint State Store](#sharepoint-state-store).
> Qdrant (vector search) is **planned but not yet implemented**.
> Bot uses **fire-and-forget** pattern — sends payload to n8n, n8n calls back via `PROACTIVE_CALLBACK_URL`.
> **Intent classification** is **context-aware** — Haiku 4.5 receives `currentStep` + last 2 turns and outputs one of `continue / status_query / closing / social_only / restart`. A cheap regex pre-filter short-circuits trivial pleasantries.

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
    docker-compose.yml               # n8n + Qdrant Docker stack
    .env.example                     # ANTHROPIC_API_KEY, AZURE_GRAPH_*, SHAREPOINT_*
    workflows/
      presale-agent-workflow.json    # Main workflow: Webhook → AI Agent (Claude Sonnet 4.6 + Memory) → Callback
      graph-api-agent-workflow.json  # Graph API agent sub-workflow
      sharepoint-agent-workflow.json # SharePoint agent sub-workflow
    fixtures/                        # Pinned data fixtures for TDD testing
    _backup/
      presale-agent-workflow.json    # Archived dispatcher version (SharePoint state machine)

integrations/
  sharepoint/                        # SharePoint provisioning (state store — future use)
    data/                            # PnP ListInstance fragments
    deployment/                      # deploy.ps1 + provisioning.xml
  .env.example

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
cd orchestrator/n8n && docker compose up -d n8n

# Start bot + tunnel
cd microsoft-teams-bot && npm run start:dev

# Or start individually:
cd microsoft-teams-bot && npm run bot      # nodemon watch mode
cd microsoft-teams-bot && npm run tunnel   # devtunnel host tidy-river-mfkpvdl.euw

# Deploy/update n8n workflow via MCP (preferred) — or n8nac as fallback:
npx n8nac push orchestrator/n8n/workflows/presale-agent-workflow.json --env Dev

# Rebuild Teams app zip after manifest changes
cd microsoft-teams-bot && npm run build:teams

# n8nac — workflow as code
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
  --endpoint "https://tidy-river-mfkpvdl-3978.euw.devtunnels.ms/api/messages"
```

> **Note:** Docker is available. n8n runs via `orchestrator/n8n/docker-compose.yml`.
> Start n8n: `cd orchestrator/n8n && docker compose up -d n8n`
> Stop n8n: `cd orchestrator/n8n && docker compose down`

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
ANTHROPIC_API_KEY=<key>                  # n8n credential "Anthropic account" (type: anthropicApi)

# Microsoft Graph credentials for SharePoint state store
AZURE_GRAPH_CLIENT_ID=44c69ed7-637b-48ec-922e-a5eacbfcb938
AZURE_GRAPH_CLIENT_SECRET=<value>
AZURE_GRAPH_TENANT_ID=0d9ed809-b1ed-46bd-b3e3-5ccb093ae299

# SharePoint identifiers (resolve via Graph after creating the site — see sharepoint-setup.md)
SHAREPOINT_SITE_URL=<value>
SHAREPOINT_CONVERSATIONS_LIST_ID=<value>
SHAREPOINT_TURNS_LIST_ID=<value>
SHAREPOINT_DRIVE_ID=<value>
```

## n8n Workflows

### Main Workflow: Presale Agent

**Workflow ID:** `unPvfldAhlEkBcqi`  
**File:** `orchestrator/n8n/workflows/presale-agent-workflow.json`

Pipeline (7 nodes):

1. **Teams Bot Webhook** — POST `/webhook/presale-agent`, `webhookId: presale-agent`, `responseMode: onReceived`
2. **Prepare Input** — normalizes body → `{ userMessage, rawMessage, conversationId, callbackUrl, userName }`; inlines attachment metadata
3. **Presale Agent** (`@n8n/n8n-nodes-langchain.agent`) — Claude Sonnet 4.6, system prompt with intake/clarification/estimation/WBS/closing lifecycle
4. **Claude Sonnet 4.6** (`lmChatAnthropic`) — connected via `ai_languageModel`; maxTokens 4096, timeout 120 s; credential `GQ2oI4MTfb66gp8c`
5. **Window Buffer Memory** (`memoryBufferWindow`) — connected via `ai_memory`; `sessionKey = conversationId`; `contextWindowLength = 20`
6. **Format Reply** — extracts `$json.output` → `{ conversationId, reply, callbackUrl }`
7. **Teams Callback** — POST `callbackUrl` with `{ conversationId, reply }`; `continueOnFail: true`

> **After n8n container recreation:** credential IDs reset. Recreate "Anthropic account" (anthropicApi), then update the credential ID in the Claude Sonnet 4.6 node.

> **Archived dispatcher workflow** (SharePoint state machine, 22 nodes) is preserved in `orchestrator/n8n/_backup/presale-agent-workflow.json`.
**Workflow files** are in `orchestrator/n8n/workflows/`.

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
| devtunnel URL | `https://tidy-river-mfkpvdl-3978.euw.devtunnels.ms` (persistent) |

## SharePoint State Store

**Site:** `Presale Agent Bot` at `https://<tenant>.sharepoint.com/sites/PresaleAgentBot`  
**Setup guide:** `orchestrator/n8n/sharepoint-setup.md`

### List `Conversations` (one item per conversationId)

| Column | Type | Purpose |
|---|---|---|
| `conversationId` | Single line, indexed | Logical key |
| `userId`, `userName`, `channelId` | Single line | Identity |
| `currentStep` | Choice: `new` / `intake` / `clarification` / `estimation` / `review` / `completed` | Lifecycle position |
| `status` | Choice: `Active` / `Archived` | Soft delete |
| `createdAt`, `modifiedAt` | DateTime | Audit |
| `clarificationTurns` | Number | Counter for `≥5` forced-advance rule |
| `summary` | Multi-line text | LLM-maintained one-paragraph summary |
| `wbsArtifactRef` | Hyperlink | Link to `wbs.md` in Transcripts |
| `lastTurnNo` | Number | Monotonic counter for turn ordering |

### List `Turns` (one item per message)

| Column | Type | Purpose |
|---|---|---|
| `conversationId` | Single line, indexed | FK |
| `turnNo` | Number, indexed | Monotonic per conversation |
| `role` | Choice: `user` / `assistant` | |
| `step` | Choice (same enum) | Step at time of turn |
| `intent` | Single line | Classifier output (user turns only) |
| `text` | Multi-line text | Message body (≤63K chars) |
| `ts` | DateTime | |
| `overflowRef` | Hyperlink | Points to `transcript-overflow-<n>.md` in Transcripts when text >63K |
| `attachmentsJson` | Multi-line text | `[{name, contentType, sizeBytes}]` |

### Document Library `Transcripts`

One folder per `conversationId` containing user-uploaded PDFs, `wbs.md`, `estimates.json`, and any `transcript-overflow-<turnNo>.md` files.

### Classifier Categories

Context-aware Haiku 4.5 receives `currentStep` + last 2 turns and returns one of:
- `continue` — substantive content for current step
- `status_query` — asking about progress (non-advancing)
- `closing` — approval / sign-off
- `social_only` — pure pleasantry (no content)
- `restart` — explicit request for a new presale

A regex pre-filter sets `prefilterIntent` directly on `≤3 word` social messages and short closing phrases, bypassing the LLM call for predictable shortcuts.

## Teams App Sideload

Package: `microsoft-teams-bot/teams-app/presale-bot.zip`
Teams → Apps → Manage your apps → Upload a custom app → select the zip.

## Known Issues Fixed

- **Service Principal missing** — had to run `az ad sp create --id 44c69ed7-637b-48ec-922e-a5eacbfcb938` manually
- **Proactive callback unreachable from Docker** — n8n container cannot reach `localhost:3978`; use `PROACTIVE_CALLBACK_URL=http://host.docker.internal:3978/proactive`
- **Credential ID reset on container recreation** — fresh n8n DB assigns new credential IDs; must recreate "Anthropic account" + "Microsoft Graph - Presale Agent" credentials and update workflow node references
- **OAuth token exchange fails with ENETUNREACH (IPv6)** — Docker Desktop on Windows tries IPv6 for `login.microsoftonline.com` which is unreachable. Fix: add `extra_hosts` to `docker-compose.yml` with a known IPv4 of `login.microsoftonline.com` (e.g. `40.126.31.71`). `NODE_OPTIONS=--dns-result-order=ipv4first` and `sysctls` do NOT work on Docker Desktop/Windows.
- **Bot silently drops all Teams messages** — caused by `MICROSOFT_APP_TYPE=MultiTenant` (must be `SingleTenant`) and missing `MICROSOFT_APP_TENANT_ID` in `microsoft-teams-bot/.env`. BotFramework rejects incoming tokens without the correct app type + tenant ID, so n8n is never called. Refer to `.env.example` for the correct template.

## Architecture Decisions

- **SharePoint over n8n Window Buffer for memory** — restart-safe persistence, auditable in SP UI, no per-topic isolation. Trade-off: ~100–300 ms Graph latency per turn.
- **Turns as a List instead of `messages.jsonl` in Library** — no GET-then-PUT race on appends, queryable/filterable in SP UI, structured per-turn metadata. Trade-off: SP multi-line text columns cap at ~63K chars per row — handled via `overflowRef` to a fallback file in the Library.
- **Explicit state machine (`new → intake → clarification → estimation → review → completed`) over LLM-driven routing** — deterministic for PoC, easy to audit, fewer LLM calls per turn. Intent classifier (Haiku 4.5) serves as a hint; routing rules in `Resolve Routing Step` make the final decision.
- **Greeting WF reachable only at `new`/`completed`** — social pleasantries mid-conversation route to the active step's WF (e.g., clarification), preventing accidental state resets.

## Tech Stack

| Layer | Technology |
|---|---|
| Teams Bot | Node.js, botbuilder ^4.23, restify |
| Orchestrator | n8n (Docker) + n8nac (workflow as code) |
| Intent Classifier | Claude Haiku 4.5 (context-aware: currentStep + last 2 turns, 16 tokens max) |
| LLM (presale/clarification/status) | Claude Sonnet 4.6 (Anthropic, via n8n LangChain AI Agent) |
| Conversation State | SharePoint Online via Microsoft Graph (Lists `Conversations` + `Turns`, Library `Transcripts`) |
| State Persistence | Per-turn writes — no in-memory state; restart-safe |
| Vector DB | Qdrant — **deferred** (needs Docker/virtualization) |
| Tunnel (dev) | devtunnel (Microsoft) |
| Bot Service | Azure Bot Service F0 |
| Auth | Azure AD App Registration (SingleTenant) |
