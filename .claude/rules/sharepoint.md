---
description: SharePoint integration — state store schema, artifact storage conventions, provisioning templates, deployment script, and PnP conventions.
paths: 
  - integrations/sharepoint/**
---

# SharePoint Integration

Provisions and manages the SharePoint Online state store for the Presale Agent Bot.

## State Store

**Site:** `Presale Agent Bot` at `https://<tenant>.sharepoint.com/sites/PresaleAgentBot`  
**Setup guide:** `orchestrator/n8n/sharepoint-setup.md`

Presale data lives in SharePoint (List `Presales` + Document Library `Transcripts`). Each presale record stores the intake details, status, budget, tech stack, and architect assignment.

### List `Presales` (one item per presale opportunity)

| Column | Type | Purpose |
|---|---|---|
| `Title` | Single line of text | Presale ID / name (e.g. `[PR-2026-001] CRM implementation for Client X`) |
| `Client` | Choice | Client name |
| `Status` | Choice | `Draft` / `In Progress` / `Submitted` / `Won` / `Lost` / `Paused` |
| `PresaleArchitect` | Person or Group | Assigned architect / lead |
| `Budget` | Currency | Estimated budget (USD/EUR/PLN) |
| `Deadline` | Date and Time | Proposal submission due date |
| `Description` | Multiple lines of text | Scope description and business context |
| `TechStack` | MultiChoice | Technology stack (Power Platform, Azure, .NET, JS/TS, Python, Java, DevOps, AI/ML, Other) |
| `ProposalLink` | Hyperlink | Link to the final proposal document |

### Document Library `Transcripts`

One folder per `conversationId` containing user-uploaded PDFs, `wbs.md`, `estimates.json`, and any `transcript-overflow-<turnNo>.md` files.

**Folder convention:** `Transcripts/<conversationId>/` — all artifacts and user-uploaded files for a presale go into this folder.

| Artifact | Path | Format |
|---|---|---|
| WBS | `Transcripts/<conversationId>/wbs.md` | Markdown hierarchical structure |
| Estimates JSON | `Transcripts/<conversationId>/estimates.json` | `{ conversationId, generatedAt, roles: [...], totalMinPd, totalMaxPd, confidence }` |

## Architecture Decisions

- **SharePoint over n8n Window Buffer for memory** — restart-safe persistence, auditable in SP UI, no per-topic isolation. Trade-off: ~100–300 ms Graph latency per turn.
- **Presales List instead of Conversations + Turns** — consolidated single-record schema with all intake fields, status workflow, estimated budget, tech stack, and architect assignment. Each presale is one row — no join needed.

## Provisioning Structure

```
integrations/sharepoint/
  data/                        # PnP ListInstance fragments (xi:include targets)
    presales-list.xml          # Presales list schema
    transcripts-library.xml    # Transcripts document library schema
  deployment/
    provisioning.xml           # Root PnP template — xi:include assembles data/ fragments
    deploy.ps1                 # Provisions SharePoint + prints .env IDs
```

## Rules

- **data/ files are `<pnp:ListInstance>` fragments** — root element is `<pnp:ListInstance>`, not `<pnp:Provisioning>`. They are assembled into provisioning.xml via `xi:include`.
- **Namespace** — all `pnp:` elements must use `http://schemas.dev.office.com/PnP/2022/09/ProvisioningSchema`.
- **Field IDs** — every `<pnp:Field>` must have a unique GUID generated with `[guid]::NewGuid()`. Never use sequential or placeholder GUIDs.
- **DisplayName** — use human-readable "Title Case" (e.g. `User Name`, `Conversation ID`). The `Name` attribute stays camelCase (SharePoint internal name).
