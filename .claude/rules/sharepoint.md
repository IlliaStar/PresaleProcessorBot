---
description: Rules for the SharePoint integration — provisioning templates, deployment script, and PnP conventions.
paths: 
  - integrations/sharepoint/**
---

# SharePoint Integration

Provisions and manages the SharePoint Online state store for the Presale Agent Bot.

## Structure

```
data/                        # PnP ListInstance fragments (xi:include targets)
  conversations-list.xml     # Conversations list schema
  turns-list.xml             # Turns list schema
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
