# Bot Dev Start

Start the full Microsoft Teams bot development environment: kill any process on port 3978, then launch the bot and devtunnel via concurrently. All mechanics in `scripts/bot-dev-start.js`.

**Usage:** `/bot-dev-start`

## Steps

### 1. Run start-dev script

```bash
node scripts/bot-dev-start.js
```

### 2. Report

```
## Dev Environment Started ✓
- Port: 3978
- n8n: http://localhost:5678
- Bot: https://tidy-river-mfkpvdl-3978.euw.devtunnels.ms/api/messages
```