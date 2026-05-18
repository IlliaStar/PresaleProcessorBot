---
description: Start n8n, Teams bot, and ngrok in separate Windows Terminal tabs
---

Start all three dev services — n8n orchestrator, Teams bot, and ngrok tunnel — each in its own Windows Terminal tab.

Arguments passed by user: `$ARGUMENTS`

## Steps

1. Run the following command to launch all three services at once:

```bash
wt new-tab --title "n8n" cmd /k "set N8N_BLOCK_ENV_ACCESS_IN_NODE=false && n8n start" \; new-tab --title "Teams Bot" cmd /k "cd /d \"C:\Users\IlliaStaradubets\EPAM\Presale Processing Agent\microsoft-teams-bot\" && npm start" \; new-tab --title "ngrok" cmd /k "ngrok http 3978"
```

2. Wait ~5 seconds, then remind the user:
   - **n8n** is at http://localhost:5678
   - **Teams bot** is at http://localhost:3978
   - **ngrok** — once it shows a URL, update Azure Bot Service endpoint:
     ```bash
     az account set --subscription 46e73b37-b5cd-40a3-8643-a9218e9d97c0
     az bot update --resource-group presale-agent-rg --name presale-bot \
       --endpoint "https://XXXX.ngrok-free.app/api/messages"
     ```
   - Or run `/update-ngrok --url https://XXXX.ngrok-free.app` if that command exists.
