# n8n Workflow Patterns

Reference library for the Integration Specialist agent. Use these patterns as building blocks.

---

## 1. Routing Patterns

### IF node (binary branch)

```json
{
  "name": "Check Status",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "parameters": {
    "conditions": {
      "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" },
      "conditions": [
        {
          "id": "cond-1",
          "leftValue": "={{ $json.status }}",
          "rightValue": "active",
          "operator": { "type": "string", "operation": "equals" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

Connection: `main[0]` = true branch, `main[1]` = false branch.

### Switch node (multi-branch routing)

```json
{
  "name": "Route By Type",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "parameters": {
    "mode": "rules",
    "rules": {
      "values": [
        { "conditions": { "conditions": [{ "leftValue": "={{ $json.type }}", "rightValue": "A", "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" } },
        { "conditions": { "conditions": [{ "leftValue": "={{ $json.type }}", "rightValue": "B", "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" } }
      ]
    },
    "fallbackOutput": "last"
  }
}
```

Connection: `main[0]` = rule 1 match, `main[1]` = rule 2 match, `main[last]` = fallback.

---

## 2. Pagination Pattern

Use `Loop Over Items` + `Merge` to aggregate paginated API responses.

```
HTTP Request (page 1) → Split Out → Loop Over Items → HTTP Request (next page)
                                          ↓ (done)
                                        Merge → Continue
```

HTTP Request pagination config:
```json
{
  "parameters": {
    "url": "https://api.example.com/items",
    "options": {
      "pagination": {
        "paginationMode": "updateAParameterInEachRequest",
        "nextURL": "={{ $response.body.nextPageUrl }}",
        "limitPagesFetched": true,
        "maxRequests": 10
      }
    }
  }
}
```

---

## 3. Error Handling Pattern

### Per-node error capture

Set `continueOnFail: true` on the node, then add an IF to check for errors:

```json
{ "continueOnFail": true }
```

```
Risky Node (continueOnFail: true) → IF ($json.error != undefined)
                                        ↓ true          ↓ false
                                    Error Handler    Success Path
```

IF condition for error check:
```json
{
  "leftValue": "={{ $json.error }}",
  "operator": { "type": "string", "operation": "exists" }
}
```

### Workflow-level error workflow

Set in `settings`:
```json
{
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "<error-workflow-id>"
  }
}
```

---

## 4. Webhook Patterns

### Fire-and-forget (async) webhook

Respond immediately, process in background:
```json
{
  "name": "Webhook",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "parameters": {
    "path": "my-webhook",
    "responseMode": "onReceived",
    "responseData": "firstEntryJson",
    "options": {}
  }
}
```

### Synchronous webhook (respond with result)

```json
{
  "name": "Webhook",
  "parameters": {
    "path": "my-webhook",
    "responseMode": "lastNode",
    "options": {}
  }
}
```

Pair with `Respond to Webhook` node at the end:
```json
{
  "name": "Send Response",
  "type": "n8n-nodes-base.respondToWebhook",
  "typeVersion": 1,
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ JSON.stringify($json) }}",
    "options": { "responseCode": 200 }
  }
}
```

---

## 5. Sub-Workflow Call Pattern

```json
{
  "name": "Call Sub-Workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1,
  "parameters": {
    "source": "database",
    "workflowId": { "__rl": true, "value": "<workflow-id>", "mode": "id" },
    "options": {
      "waitForSubWorkflow": true
    }
  }
}
```

The sub-workflow must start with an `Execute Workflow Trigger` node.
Pass data via `inputData`: it arrives as `$json` in the sub-workflow.

---

## 6. Expression Cheat Sheet

| Goal | Expression |
|---|---|
| Field from current item | `{{ $json.fieldName }}` |
| Nested field | `{{ $json.user.email }}` |
| Field from upstream node | `{{ $('Node Name').item.json.field }}` |
| First item from upstream | `{{ $('Node Name').first().json.field }}` |
| All items count | `{{ $('Node Name').all().length }}` |
| Current timestamp ISO | `{{ $now.toISO() }}` |
| Current timestamp Unix | `{{ $now.toUnixInteger() }}` |
| Format date | `{{ $now.toFormat('yyyy-MM-dd') }}` |
| Env variable | `{{ $env.MY_VAR }}` |
| Ternary | `{{ $json.value > 0 ? 'positive' : 'negative' }}` |
| Default if null | `{{ $json.name ?? 'Unknown' }}` |
| String interpolation | `{{ 'Hello ' + $json.name }}` |
| AI tool parameter | `{{ $fromAI('paramName', 'description') }}` |

---

## 7. AI Agent Pattern

Minimal AI Agent setup (Claude Sonnet 4.6):

**Nodes needed:**
1. `@n8n/n8n-nodes-langchain.agent` (typeVersion 1.7) — main agent
2. `@n8n/n8n-nodes-langchain.lmChatAnthropic` (typeVersion 1.3) — language model → connect via `ai_languageModel`
3. `@n8n/n8n-nodes-langchain.memoryBufferWindow` (typeVersion 1.3) — memory → connect via `ai_memory` (optional)

Agent parameters:
```json
{
  "promptType": "define",
  "text": "={{ $json.userMessage }}",
  "systemMessage": "You are a helpful assistant.",
  "options": { "maxIterations": 10 }
}
```

LM parameters:
```json
{
  "model": "claude-sonnet-4-6",
  "options": { "maxTokens": 4096 }
}
```

Credentials block for LM node:
```json
{
  "credentials": {
    "anthropicApi": { "id": "tveGybvizLkoc6QO", "name": "Anthropic account" }
  }
}
```
