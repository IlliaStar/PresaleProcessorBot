#!/bin/bash
cp "/c/Users/IlliaStaradubets/EPAM/Presale Processing Agent/orchestrator/n8n/workflows/presale-agent-workflow.json" "/c/Users/IlliaStaradubets/EPAM/Presale Processing Agent/orchestrator/n8n/backups/presale-agent-workflow-pre-patch.json"
if [ $? -eq 0 ]; then
  echo "BACKUP_OK"
else
  echo "BACKUP_FAILED"
fi