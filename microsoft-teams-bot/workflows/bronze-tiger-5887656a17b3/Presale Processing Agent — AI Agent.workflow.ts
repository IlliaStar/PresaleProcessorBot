import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Presale Processing Agent — AI Agent
// Nodes   : 7  |  Connections: 4
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// TeamsBotWebhook                    webhook
// PrepareInput                       code
// AiAgent                            agent                      [AI]
// AnthropicChatModel                 lmChatAnthropic            [creds] [ai_languageModel]
// WindowBufferMemory                 memoryBufferWindow         [ai_memory]
// FormatReply                        code
// ProactiveCallback                  httpRequest
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// TeamsBotWebhook
//    → PrepareInput
//      → AiAgent
//        → FormatReply
//          → ProactiveCallback
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: AnthropicChatModel, ai_memory: WindowBufferMemory })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'kXMKFIPi1ZYUqJ4c',
    name: 'Presale Processing Agent — AI Agent',
    active: true,
    isArchived: false,
    settings: { executionOrder: 'v1' },
})
export class PresaleProcessingAgentAiAgentWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: 'b1c2d3e4-0001-4000-8000-000000000001',
        webhookId: 'presale-agent',
        name: 'Teams Bot Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2,
        position: [240, 300],
    })
    TeamsBotWebhook = {
        httpMethod: 'POST',
        path: 'presale-agent',
        responseMode: 'onReceived',
        options: {},
    };

    @node({
        id: 'b1c2d3e4-0002-4000-8000-000000000002',
        name: 'Prepare Input',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [460, 300],
    })
    PrepareInput = {
        jsCode: `const body = $input.first().json.body || $input.first().json;
const conversationId = body.conversationId || 'default';
const message = (body.message || '').trim();
const userName = body.userName || 'User';
const attachments = body.attachments || [];

let userMessage = message
  ? \`Message from \${userName}:\\n\${message}\`
  : \`Hello from \${userName}.\`;

for (const att of (attachments || [])) {
  if (att.name) {
    const tag = att.content
      ? \`[PDF attached: \${att.name}, \${Math.round((att.sizeBytes || 0) / 1024)} KB]\`
      : \`[File attached: \${att.name} — could not be downloaded]\`;
    userMessage += '\\n' + tag;
  }
}

return [{ json: { userMessage, conversationId, sessionId: conversationId } }];`,
    };

    @node({
        id: 'b1c2d3e4-0003-4000-8000-000000000003',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 1.7,
        position: [680, 300],
    })
    AiAgent = {
        promptType: 'define',
        text: '={{ $json.userMessage }}',
        options: {
            systemMessage: `You are an expert presale consultant and software architect at EPAM Systems.
Analyze the presale request and produce a structured response:

1. **Executive Summary** — 2-3 sentence scope overview
2. **Key Requirements** — functional and non-functional requirements identified
3. **Work Breakdown Structure (WBS)** — hierarchical breakdown of work packages
4. **Effort Estimates** — per work package in person-days (min/max range)
5. **Total Estimate** — combined effort with confidence level (Low / Medium / High)
6. **Risks & Assumptions** — key risks and assumptions affecting the estimate

Format in Markdown. Be specific and actionable.
If the request lacks detail, note what additional information would improve the estimate.
If this is a follow-up message in an ongoing conversation, build on the previous context.

[n8nac push test — 2026-05-18]`,
        },
    };

    @node({
        id: 'b1c2d3e4-0004-4000-8000-000000000004',
        name: 'Anthropic Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
        version: 1.3,
        position: [560, 520],
        credentials: { anthropicApi: { id: 'TfwgNbVG9bAOs5ST', name: 'Anthropic account' } },
    })
    AnthropicChatModel = {
        model: {
            __rl: true,
            value: 'claude-haiku-4-5-20251001',
            mode: 'id',
        },
        options: {
            maxTokens: 4096,
            timeout: 120000,
        },
    };

    @node({
        id: 'b1c2d3e4-0005-4000-8000-000000000005',
        name: 'Window Buffer Memory',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        version: 1.3,
        position: [800, 520],
    })
    WindowBufferMemory = {
        sessionIdType: 'fromInput',
        contextWindowLength: 10,
    };

    @node({
        id: 'b1c2d3e4-0006-4000-8000-000000000006',
        name: 'Format Reply',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [900, 300],
    })
    FormatReply = {
        jsCode: `const output = $input.first().json.output;
return [{ json: { reply: output || 'No response from the agent.' } }];`,
    };

    @node({
        id: 'b1c2d3e4-0008-4000-8000-000000000008',
        name: 'Proactive Callback',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.1,
        position: [1120, 300],
    })
    ProactiveCallback = {
        method: 'POST',
        url: "={{ $('Teams Bot Webhook').item.json.body.callbackUrl }}",
        sendBody: true,
        contentType: 'json',
        bodyParameters: {
            parameters: [
                {
                    name: 'conversationId',
                    value: "={{ $('Prepare Input').item.json.conversationId }}",
                },
                {
                    name: 'reply',
                    value: "={{ $('Format Reply').item.json.reply }}",
                },
            ],
        },
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.TeamsBotWebhook.out(0).to(this.PrepareInput.in(0));
        this.PrepareInput.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.FormatReply.in(0));
        this.FormatReply.out(0).to(this.ProactiveCallback.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.AnthropicChatModel.output,
            ai_memory: this.WindowBufferMemory.output,
        });
    }
}
