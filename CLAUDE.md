# CLAUDE.md

## Project: Presale Processing Agent (PoC)

AI-powered agent that analyzes presale requests via Microsoft Teams, estimates effort, and generates a structured WBS. Teams bot is a thin relay — all AI logic lives in n8n workflows.

## What Belongs in This File

Keep only what cannot be derived from reading the codebase:
- Architecture diagrams (intent and data flow, not file locations)
- Behavior specs (lifecycle phases, approval signals, artifact schemas)
- Env setup and Azure resources (non-obvious, not in code)
- Known issues and config gotchas (institutional knowledge)

Remove anything derivable from the filesystem (directory trees, file lists, code patterns).

## Architecture

```
Teams → Azure Bot Service (F0) → microsoft-teams-bot (Node.js) → n8n webhook (/presale-agent)
                                                                       ↓
                                                                  Prepare Input
                                                                       ↓
                                                               Presale AI Agent
                                                              (Claude Sonnet 4.6)
                                                              + Window Buffer Memory
                                                                       ↓
                                     ┌───────────────────────────────────┐
                                     ▼                                   ▼
                              SharePoint Agent                    Format Reply
                              (Haiku 4.5,                         → Teams
                               SharePoint CRUD)                   Proactive Callback
                                     │
                                     ▼
                              SharePoint Online (Graph API)
                              List: Presales
                              Library: Transcripts
```

### Lifecycle Phase Behavior

| Step | Behavior |
|---|---|
| **new** | Initial state. Route to greeting or directly to intake based on message content. |
| **intake** | Acknowledge the request. Extract: domain, tech stack, timeline, team size, client context. Identify gaps — if requirements are vague, transition to `clarification`. |
| **clarification** | Ask up to **3 targeted questions per turn**. Increment `clarificationTurns` counter. At **≥5 clarification turns**, forced-advance to `estimation` regardless of completeness. |
| **estimation** | Produce a structured effort estimate table by role (see [Estimate Role Schema](#estimate-role-schema)) with min/max person-days and confidence (Low/Medium/High). Generate `wbs.md` and `estimates.json` artifacts. Transition to `review`. |
| **review** | Present estimates and WBS for stakeholder approval. Recognizes explicit approval signals to transition to `completed`. On rejection or revision requests, loop back to `clarification` or `estimation`. |
| **completed** | Final artifacts archived. Conversation idle unless user sends `restart` intent to begin a new presale. |

#### Estimate Role Schema

All 6 roles must appear in every estimate table:

| Role | Deliverable scope |
|---|---|
| BA | Requirements elicitation, stakeholder workshops, backlog definition |
| Backend | API design, data modeling, integration, core business logic |
| Frontend | UI components, state management, responsive layout, accessibility |
| QA | Test planning, automation, manual testing, UAT coordination |
| DevOps | CI/CD pipelines, infrastructure as code, environment provisioning |
| PM | Sprint planning, risk management, stakeholder reporting, coordination |

#### Approval Signals

Recognized during `review` phase to transition → `completed`:

- **English:** `approve`, `approved`, `confirm`, `confirmed`, `looks good`, `lgtm`, `ship it`, `go ahead`, `accepted`
- **Russian:** `одобряю`, `подтверждаю`, `согласен`, `принято`, `ок`, `добро`

#### Artifact Specifications

| Artifact | File | Format |
|---|---|---|
| Estimate Table | inline in chat reply | Markdown table (roles × rows, min/max pd + notes columns) |
| WBS | `wbs.md` | Markdown — hierarchical headings: `## Phase` → `### Deliverable` → `#### Task`, each task with estimated hours |
| Estimates JSON | `estimates.json` | `{ conversationId, generatedAt, roles: [{ role, minPd, maxPd, notes }], totalMinPd, totalMaxPd, confidence }` |

### Claude Slash Commands

```
/git-sync                # Stage, commit, sync with remote, push
/n8n-deploy-flow [args]  # Deploy n8n workflows from local JSON files
/n8n-inspect-flow [args] # Inspect last failed n8n execution
/bot-dev-start           # Start bot dev environment (bot + tunnel)
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

## Teams App Sideload

Package: `microsoft-teams-bot/teams-app/presale-bot.zip`
Teams → Apps → Manage your apps → Upload a custom app → select the zip.

## Config Gotchas

- **Service Principal missing** — had to run `az ad sp create --id 44c69ed7-637b-48ec-922e-a5eacbfcb938` manually
- **Bot silently drops all Teams messages** — caused by `MICROSOFT_APP_TYPE=MultiTenant` (must be `SingleTenant`) and missing `MICROSOFT_APP_TENANT_ID` in `microsoft-teams-bot/.env`. BotFramework rejects incoming tokens without the correct app type + tenant ID. Refer to `.env.example` for the correct template.

## Tech Stack

| Layer | Technology |
|---|---|
| Teams Bot | Node.js, botbuilder ^4.23, restify |
| Orchestrator | n8n (Docker) |
| Intent Classifier | Claude Haiku 4.5 (context-aware: currentStep + last 2 turns, 16 tokens max) |
| LLM (presale/clarification/status) | Claude Sonnet 4.6 (Anthropic, via n8n LangChain AI Agent) |
| Conversation State | SharePoint Online via Microsoft Graph (List `Presales`, Library `Transcripts`) |
| State Persistence | Per-turn writes — no in-memory state; restart-safe |
| Vector DB | Qdrant — **deferred** (needs Docker/virtualization) |
| Tunnel (dev) | devtunnel (Microsoft) |
| Bot Service | Azure Bot Service F0 |
| Auth | Azure AD App Registration (SingleTenant) |
