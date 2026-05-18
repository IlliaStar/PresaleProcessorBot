# Presale Processing Agent — PoC

## Overview

An AI-powered agent that automates the analysis and estimation of presale requests for Microsoft 365 software projects. The agent accepts requirement documents, analyzes them against historical presale data, and produces a structured WBS, project plan, and cost estimate — all through a Microsoft Teams chat interface.

---

## Motivation

### Why This Project Matters

In a competitive services market, presale quality directly determines win rate. When a client sends an RFP, the window to respond is typically **3–5 business days** — but producing a credible estimate requires deep technical knowledge, awareness of past similar projects, and careful scope analysis. Most organizations struggle with this for three reasons:

**1. Institutional knowledge is trapped in documents**
Years of completed presales sit in folders — past WBS spreadsheets, estimation notes, lessons learned. This knowledge exists but is practically inaccessible. Engineers either don't know it's there or can't search it efficiently. Every new estimate starts nearly from scratch.

**2. Estimation quality depends on who is available**
A senior engineer who has seen 50 similar projects will produce a fundamentally different (and better) estimate than someone doing it for the third time. This creates unpredictable quality and scope gaps that lead to budget overruns or lost deals due to over-pricing.

**3. The cost of getting it wrong is high — in both directions**
- **Underestimate** → project runs over budget, damages client relationship, erodes margin
- **Overestimate** → deal is lost to a competitor who quoted more accurately

### Why AI is the Right Lever Here

This is precisely the class of problem where LLMs provide the most value: **synthesizing large volumes of unstructured historical data into structured, actionable output**. The agent doesn't replace the presale engineer — it gives them a calibrated starting point in minutes instead of hours, grounded in what the organization has actually delivered before.

The Teams + SharePoint integration means zero friction adoption: engineers work where they already work, documents stay where they already live, and the knowledge base grows automatically with every new presale processed.

### Business Impact (estimated)

| Metric | Current | With Agent |
|---|---|---|
| Time per presale estimate | 4–8 hours | 30–60 minutes |
| Estimates produced per week | 2–3 | 8–10 |
| Consistency across engineers | Low | High (shared knowledge base) |
| Historical presale reuse | Ad hoc | Systematic (RAG) |
| Onboarding time for new engineers | Months | Weeks |

---

## Problem Statement

Presale engineers spend significant time manually analyzing RFP documents, referencing past projects, and producing estimates. This process is:

- **Time-consuming** — 4–8 hours per presale request
- **Inconsistent** — estimations vary between engineers
- **Knowledge-siloed** — historical presale experience is hard to reuse
- **Document-heavy** — requirements come in mixed formats (PDF, Word, images, diagrams)

### Expected Value

| Before | After |
|---|---|
| 4–8h manual estimation | 30–60 min with AI assistance |
| Inconsistent estimates | Calibrated against historical data |
| Knowledge locked in files | Searchable presale knowledge base |
| Manual document parsing | Automated extraction and analysis |

---

## Target Users

- **Presale Engineers** — primary users, submit RFP requests and review outputs
- **Solution Architects** — validate generated WBS and technical scope
- **Delivery Managers** — review project plans and cost estimates

---

## Key Capabilities

### AI Capabilities
- Natural language understanding of requirement documents
- Semantic search over historical presales (RAG)
- Automated WBS generation based on requirements + past projects
- Cost estimation using role-based rate cards
- Risk identification and gap analysis

### User Interactions
- Upload documents directly in Teams chat
- Ask questions: *"What is the estimated effort for this project?"*
- Request refinements: *"Add a mobile app component to the estimate"*
- Get structured output: WBS, project plan, cost breakdown

---

## Architecture

### High-Level Data Flow

```
👤 Presale Engineer
        │
        │ message + documents (PDF, DOCX)
        ▼
┌───────────────────┐
│  Microsoft Teams  │
│       Bot         │
└────────┬──────────┘
         │ HTTP Webhook
         ▼
┌────────────────────────────────────────────────────────┐
│                   n8n (local orchestrator)              │
│                                                         │
│  Workflow 1: Document Ingestion                         │
│  ├── Save files → SharePoint /Incoming Requests        │
│  ├── Extract text (PDF/DOCX parsing)                   │
│  └── Embed + index → Qdrant (vector search)            │
│                                                         │
│  Workflow 2: AI Analysis (Agent Loop)                   │
│  ├── Tool: search_similar_presales() → Qdrant          │
│  ├── Tool: get_presale_details()    → SharePoint List  │
│  ├── Tool: get_rate_cards()         → SharePoint List  │
│  ├── Tool: generate_wbs()           → Claude Sonnet    │
│  ├── Tool: calculate_cost()         → rate × hours     │
│  └── Tool: save_result()            → SharePoint       │
│                                                         │
│  Workflow 3: Result Delivery                            │
│  └── Send summary + SharePoint links → Teams Bot       │
└──────────────┬─────────────────────┬───────────────────┘
               │                     │
               ▼                     ▼
     ┌──────────────┐      ┌──────────────────┐
     │ Qdrant       │      │   SharePoint     │
     │ (local)      │      │   (M365)         │
     │              │      │                  │
     │ • embeddings │      │ • input docs     │
     │ • RAG index  │      │ • presale history│
     └──────────────┘      │ • generated WBS  │
                           │ • rate cards     │
                           └──────────────────┘
```

---

## Technology Stack

| Layer | Technology | Role |
|---|---|---|
| Entry Point | Microsoft Teams Bot | User interface |
| Orchestrator | n8n (local, Docker) | Workflow automation |
| Tunnel | ngrok | Expose local n8n to Teams |
| LLM | Claude Sonnet 4.6 (Anthropic) | Reasoning, WBS generation |
| Vector Search | Qdrant (local, Docker) | Semantic RAG over presale history |
| File Storage | SharePoint Document Libraries | Input docs, historical presales, outputs |
| Structured Data | SharePoint Lists | Presale registry, rate cards, WBS templates |
| Auth | Azure AD App Registration | SharePoint + Bot Service access |
| Bot Service | Azure Bot Service (F0 free) | Teams channel integration |

---

## SharePoint Structure

```
SharePoint Site: "Presale Agent"
│
├── 📁 Document Libraries
│   ├── /Incoming Requests
│   │   └── /{request_id}/          ← uploaded RFP documents
│   ├── /Historical Presales
│   │   └── /{presale_name}/
│   │       ├── requirements.pdf
│   │       ├── wbs.xlsx
│   │       └── metadata.json
│   └── /Generated Outputs
│       └── /{request_id}/
│           ├── wbs.md
│           └── estimate.md
│
└── 📋 Lists
    ├── Presale Registry            ← structured presale metadata
    ├── Rate Cards                  ← role × seniority × hourly rate
    └── WBS Templates               ← reusable phase/task templates
```

### Presale Registry List Schema

| Column | Type | Example |
|---|---|---|
| Title | Text | HR Portal M365 |
| Client | Text | Contoso |
| TechStack | Text | SharePoint, Teams, Azure AD |
| DurationWeeks | Number | 12 |
| TotalCostUSD | Number | 42000 |
| TeamSize | Number | 4 |
| Complexity | Choice | High / Medium / Low |
| SharePointFolder | Hyperlink | /Historical/HR-Portal-2023 |

### Rate Cards List Schema

| Column | Type | Example |
|---|---|---|
| Role | Text | Backend Developer |
| Seniority | Choice | Junior / Middle / Senior |
| HourlyRateUSD | Number | 65 |

---

## Agent Tools (LLM-callable)

```
search_similar_presales(query, top_k)
  → semantic search in Qdrant over historical presale documents
  → returns: list of similar presale IDs + similarity scores

get_presale_details(presale_id)
  → reads SharePoint List: Presale Registry
  → returns: metadata, cost, team composition, duration

get_rate_cards()
  → reads SharePoint List: Rate Cards
  → returns: role/seniority/rate table

generate_wbs(requirements, similar_presales)
  → Claude Sonnet structured generation
  → returns: phases → deliverables → tasks with effort hours

calculate_cost(wbs_items)
  → hours × rate by role from rate cards
  → returns: cost breakdown + total + risk buffer

save_result(request_id, wbs, estimate)
  → saves to SharePoint /Generated Outputs
  → updates SharePoint List: Presale Registry

ask_clarification(question)
  → sends question back to user in Teams
  → waits for response before continuing
```

---

## Example Interaction

**User in Teams:**
> "Need to estimate a project: SharePoint intranet portal + Teams bot for HR. Files attached: requirements.pdf, architecture.png"

**Agent response (~60 seconds later):**
> ✅ **Analysis complete!**
>
> **Similar past projects found:**
> - HR Portal 2023 (Contoso) — 520h / $42,000
> - Intranet Redesign 2024 (Fabrikam) — 380h / $31,000
>
> **Generated WBS:** [link to SharePoint]
>
> **Estimate:** 480 hours / $39,500
> *(Senior Dev ×2: 240h, BA: 80h, QA: 80h, PM: 80h)*
>
> **Identified risks:**
> - ⚠️ Legacy AD integration — no details in requirements (High)
> - ⚠️ Mobile requirements unclear (Medium)
>
> *Want me to adjust the estimate or add components?*

---

## Presale Request Processing Flow

The diagram below illustrates how a single presale request moves through the system from submission to final output.

```
  PRESALE ENGINEER                 n8n AGENT                    DATA LAYER
        │                              │                              │
        │  1. Upload RFP docs          │                              │
        │  + describe project in Teams │                              │
        │─────────────────────────────►│                              │
        │                              │                              │
        │                              │  2. Save uploaded files      │
        │                              │─────────────────────────────►│
        │                              │     SharePoint               │
        │                              │     /Incoming Requests       │
        │                              │                              │
        │                              │  3. Extract text from docs   │
        │                              │  (PDF parser / DOCX reader)  │
        │                              │◄─────────────────────────────│
        │                              │                              │
        │                              │  4. Embed + index content    │
        │                              │─────────────────────────────►│
        │                              │     Qdrant (vector DB)       │
        │                              │                              │
        │                              │  5. Search similar presales  │
        │                              │─────────────────────────────►│
        │                              │◄─────────────────────────────│
        │                              │  top-3 matches + metadata    │
        │                              │                              │
        │                              │  6. Fetch rate cards         │
        │                              │─────────────────────────────►│
        │                              │◄─────────────────────────────│
        │                              │  SharePoint List             │
        │                              │                              │
        │                              │  7. LLM reasoning            │
        │                              │  ┌───────────────────────┐   │
        │                              │  │ Claude Sonnet 4.6     │   │
        │                              │  │                       │   │
        │                              │  │ • Analyze requirements│   │
        │                              │  │ • Compare to history  │   │
        │                              │  │ • Identify gaps/risks │   │
        │                              │  │ • Generate WBS        │   │
        │                              │  │ • Calculate estimate  │   │
        │                              │  └───────────────────────┘   │
        │                              │                              │
        │  8. Clarification needed?    │                              │
        │◄─────────────────────────────│                              │
        │  "What is the expected       │                              │
        │   number of users?"          │                              │
        │─────────────────────────────►│                              │
        │  "Around 500 internal users" │                              │
        │                              │  (agent continues loop)      │
        │                              │                              │
        │                              │  9. Save outputs             │
        │                              │─────────────────────────────►│
        │                              │     SharePoint               │
        │                              │     /Generated Outputs       │
        │                              │     + Presale Registry List  │
        │                              │                              │
        │  10. Receive result in Teams │                              │
        │◄─────────────────────────────│                              │
        │                              │                              │
        │  ✅ WBS (link)               │                              │
        │  📊 Estimate: 480h / $39,500 │                              │
        │  🔍 Similar: HR Portal 2023  │                              │
        │  ⚠️  Risks: 2 identified     │                              │
        ▼                              ▼                              ▼
```

### Processing Stages Summary

| Stage | Action | Duration |
|---|---|---|
| **Ingestion** | Upload → SharePoint → text extraction → embed | ~15 sec |
| **Retrieval** | Vector search → fetch top-3 similar presales | ~5 sec |
| **Analysis** | LLM reads requirements + historical context | ~20 sec |
| **Generation** | WBS + cost estimate structured output | ~15 sec |
| **Delivery** | Save to SharePoint + notify in Teams | ~5 sec |
| **Total** | End-to-end with no clarification needed | **~60 sec** |

---

## Local Stack Setup

```yaml
# docker-compose.yml
services:
  n8n:
    image: n8nio/n8n
    ports:
      - "5678:5678"
    volumes:
      - ~/.n8n:/home/node/.n8n

  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
```

```bash
# Start local stack
docker-compose up -d

# Expose to Teams via ngrok
ngrok http 5678
```

### External Services Required (all free tier)

| Service | Purpose | Cost |
|---|---|---|
| SharePoint (M365) | Data storage | Existing license |
| Azure Bot Service F0 | Teams integration | Free |
| Azure AD App Registration | OAuth for SharePoint | Free |
| Anthropic API | Claude LLM | Pay per use |
| ngrok | Tunnel for local dev | Free tier |

---

## PoC Scope

### In Scope
- PDF and Word document input
- Manual file upload via Teams chat
- 15 synthetic historical presales as knowledge base
- WBS generation as structured text output
- Basic cost estimate (hours × fixed rate)
- SharePoint as primary data store
- Local n8n deployment

### Out of Scope (v2+)
- Image and diagram analysis (vision model)
- Automatic Teams notifications on presale status change
- Real-time market rate cards
- Full Word/Excel document generation via Graph API
- Multi-tenant / production deployment
- Client-facing portal

---

## Data Preparation

For the PoC, a synthetic dataset of **15 historical presales** will be created covering:

| Category | Count |
|---|---|
| SharePoint / Intranet portals | 4 |
| Teams bots and integrations | 4 |
| Azure-based web applications | 3 |
| Mobile apps with M365 backend | 2 |
| Power Platform / BI solutions | 2 |

Each presale record will include: requirements summary, WBS, team composition, duration, total cost, and lessons learned.

---

## Presentation Summary (3–5 min)

1. **Problem** — manual presale estimation is slow, inconsistent, and doesn't leverage past experience
2. **Solution** — AI agent in Teams that reads RFP docs, searches historical presales, and generates WBS + estimate
3. **Architecture** — n8n local orchestrator, Claude LLM, Qdrant RAG, SharePoint as data layer
4. **Demo flow** — upload PDF → get WBS + estimate in Teams in under 60 seconds
5. **Value** — from 4–8h manual work to 30–60 min AI-assisted estimation
