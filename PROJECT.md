# Presale Processing Agent — Project Description

## Executive Summary

AI-powered presale management system built on Microsoft 365 (Teams + SharePoint) and n8n. Sales teams submit presale requests and supporting files via Teams chat. The system analyzes requirements through a structured AI-driven lifecycle, producing effort estimates, Work Breakdown Structures (WBS), and other project artifacts — all persisted to SharePoint as the system of record.

## Problem Space

EPAM presale teams handle dozens of inbound opportunities per week. Each requires:

- Requirements extraction from RFPs, emails, slide decks, and call notes
- Clarification rounds with stakeholders
- Effort estimation across multiple roles (BA, Backend, Frontend, QA, DevOps, PM)
- Structured WBS generation
- Artifact storage and audit trail

Manual processing is inconsistent, slow, and hard to audit. The Presale Processing Agent standardizes this into a repeatable AI-assisted pipeline.

## Core Capabilities

### 1. Presale Project Intake

Users initiate presale processing by messaging the Teams bot. The bot supports:

- **Free-text requests** — unstructured descriptions of the opportunity ("We need a React dashboard for a logistics client, ~6 months, 3 devs")
- **File attachments** — PDFs, DOCX, PPTX, XLSX (max 10 MB each). The bot downloads and base64-encodes them, forwarding to n8n
- **Multi-turn conversations** — the system maintains context across messages within the same Teams conversation

### 2. Structured AI Lifecycle

Each presale conversation follows a deterministic state machine:

```
new → intake → clarification → estimation → review → completed
```

**Intake Phase:** Acknowledge the request, identify gaps, extract key parameters (domain, tech stack, timeline, team composition).

**Clarification Phase:** AI asks up to 3 targeted questions per turn. A `clarificationTurns` counter enforces a forced-advance after 5 rounds to prevent stalling. Intent classifier detects when the user is providing substantive answers vs. side comments.

**Estimation Phase:** Claude Sonnet 4.6 produces a structured effort estimate table broken down by role (BA, Backend, Frontend, QA, DevOps, PM) with min/max person-days and a confidence level (Low/Medium/High).

**Review Phase:** Estimates and WBS are presented for stakeholder approval. The system recognizes explicit approval signals ("approve", "confirm", "ship it", "одобряю", "подтверждаю").

**Completed Phase:** Final artifacts are archived. The conversation can be restarted for a new presale.

### 3. Artifact Generation

At the estimation/review phase, the system generates:

| Artifact | Format | Description |
|---|---|---|
| **Estimate Table** | Markdown | Role-by-role effort breakdown with confidence level |
| **WBS (Work Breakdown Structure)** | `wbs.md` | Hierarchical task decomposition with estimated durations |
| **Estimates JSON** | `estimates.json` | Machine-readable effort data for downstream tooling |

All artifacts are stored in the SharePoint Transcripts document library under a folder named by `conversationId`.

### 4. File Management

User-uploaded files (RFPs, presentations, spreadsheets) are automatically uploaded to SharePoint by the AI Agent. The system:

- Creates a per-conversation folder in the Transcripts library
- Preserves original filenames and content types
- Stores base64-encoded binary content for PDFs and other formats
- References all files in the conversation turn metadata

### 5. Intent Classification

A lightweight Claude Haiku 4.5 classifier (context-aware, ~16 tokens output) categorizes user messages as:

- `continue` — substantive input advancing the current step
- `status_query` — progress inquiry (non-advancing)
- `closing` — approval/sign-off
- `social_only` — pleasantries (no state change)
- `restart` — explicit new presale request

A regex pre-filter short-circuits trivial messages (≤3 words) to avoid unnecessary LLM calls.

## SharePoint as System of Record

All presale data lives in SharePoint Online, accessed via Microsoft Graph API.

### Site Structure

**Site:** `Presale Agent Bot` at `https://<tenant>.sharepoint.com/sites/PresaleAgentBot`

### List: Presales

One item per presale opportunity. Contains all intake data, status, and estimates in a single record.

| Column | Type | Purpose |
|---|---|---|
| `Title` | Text | Presale ID/name (e.g. `[PR-2026-001] CRM implementation for Client X`) |
| `Client` | Choice | Client name |
| `Status` | Choice | Draft / In Progress / Submitted / Won / Lost / Paused |
| `PresaleArchitect` | Person or Group | Assigned architect / lead |
| `Budget` | Currency | Estimated budget |
| `Deadline` | DateTime | Proposal submission due date |
| `Description` | Multi-line text | Scope description and business context |
| `TechStack` | MultiChoice | Technology stack (Power Platform, Azure, .NET, JS/TS, Python, Java, DevOps, AI/ML) |
| `ProposalLink` | Hyperlink | Link to final proposal document |

### Document Library: Transcripts

One folder per `conversationId`, containing:

- User-uploaded files (PDFs, DOCX, PPTX, XLSX)
- `wbs.md` — generated Work Breakdown Structure
- `estimates.json` — machine-readable effort data
- `transcript-overflow-<turnNo>.md` — overflow storage for long messages

## Technical Architecture

### Component Diagram

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  MS Teams    │────▶│  Azure Bot       │────▶│  microsoft-teams-bot │
│  (user chat) │     │  Service (F0)    │     │  (Node.js/restify)   │
└──────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                         │ POST (fire-and-forget)
                                                         ▼
                                              ┌─────────────────────┐
                                              │  n8n Webhook        │
                                              │  /presale-agent     │
                                              └──────────┬──────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  Presale AI Agent   │
                                              │  (Claude Sonnet 4.6)│
                                              └──────────┬──────────┘
                                                         │
                                     ┌───────────────────┼───────────────────┐
                                     ▼                   ▼                   ▼
                              ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
                              │ SharePoint  │    │  Graph API  │    │  Proactive  │
                              │ Agent       │    │  Agent      │    │  Callback   │
                              │ (file ops)  │    │  (user/org) │    │  → Teams    │
                              └──────┬──────┘    └──────┬──────┘    └─────────────┘
                                     │                   │
                                     ▼                   ▼
                              ┌─────────────────────────────────────┐
                              │        SharePoint Online            │
                              │  List: Presales                     │
                              │  Library: Transcripts               │
                              └─────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|---|---|
| User Interface | Microsoft Teams (chat-based) |
| Bot Framework | Azure Bot Service F0, BotBuilder SDK v4.23 |
| Bot Runtime | Node.js + restify, Docker (node:20-slim) |
| Orchestration | n8n (Docker, Community Edition) |
| AI — Main Agent | Claude Sonnet 4.6 (via Anthropic API) |
| AI — Intent Classifier | Claude Haiku 4.5 (context-aware, 16-token max) |
| AI — SharePoint Agent | Claude Haiku 4.5 (file operations) |
| State Persistence | SharePoint Online via Microsoft Graph API |
| Document Storage | SharePoint Document Library (Transcripts) |
| Auth | Azure AD App Registration (SingleTenant) |
| Dev Tunnel | Microsoft devtunnel |

### Sub-Workflows

1. **SharePoint Agent** (`sharepoint-agent-workflow.json`) — AI agent with tools for file download and Presales list CRUD. Handles attachment ingestion and artifact storage.

### Key Design Decisions

- **Fire-and-forget from bot**: Bot sends payload to n8n with 10s timeout; n8n processes asynchronously and POSTs result to `/proactive` callback endpoint.
- **SharePoint over in-memory state**: Restart-safe, auditable via SP UI, no per-topic memory isolation issues. Trade-off: ~100-300ms Graph API latency per turn.
- **Presales list (not Conversations + Turns)**: Single-record schema with all intake fields, status workflow, budget, tech stack, and architect. No join needed.
- **Explicit state machine over LLM routing**: Deterministic, easy to audit, fewer LLM calls. Intent classifier provides hints; routing rules make final decisions.
- **SharePoint-first identity**: Uses existing Microsoft 365 identities; no separate user database.

## SharePoint Provisioning

Lists and libraries are defined as PnP ListInstance XML fragments and deployed via `deploy.ps1`:

```
integrations/sharepoint/
  data/
    presales-list.xml          # Presales list schema
    transcripts-library.xml   # Document library schema
  deployment/
    provisioning.xml          # Root PnP template (assembles fragments via xi:include)
    deploy.ps1                # Provisions SharePoint + outputs env IDs
```

Deployment supports interactive and app-only (certificate) authentication methods.

## Future Extensions (Planned)

- **Qdrant Vector Search**: Semantic search across past presales for similar estimates and reuse
- **PRF (Project Request Form)**: Structured form intake as alternative to free-text Teams chat
- **Multi-language RFP parsing**: Automated extraction from non-English RFPs
- **Downstream integration**: Push estimates to Jira, SAP, or internal EPAM systems
- **Dashboards**: Power BI reports on presale pipeline metrics