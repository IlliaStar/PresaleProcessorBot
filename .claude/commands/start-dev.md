# Start Dev

Run the full local dev environment (Teams bot + devtunnel) using concurrently.

First, kill any process already holding port 3978, then start the bot and tunnel:

```bash
PID=$(netstat -ano 2>/dev/null | grep ":3978" | grep LISTENING | awk '{print $NF}' | head -1); [ -n "$PID" ] && powershell -Command "Stop-Process -Id $PID -Force" && echo "Killed PID $PID on port 3978"; cd microsoft-teams-bot && npm run start:dev:inner
```
