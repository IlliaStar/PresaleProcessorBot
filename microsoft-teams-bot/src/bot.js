const { TeamsActivityHandler, MessageFactory, ActivityTypes, TurnContext } = require('botbuilder');
const { MicrosoftAppCredentials } = require('botframework-connector');
const config = require('./config');
const conversationStore = require('./conversationStore');

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class PresaleBot extends TeamsActivityHandler {
  constructor(adapter) {
    super();
    this.adapter = adapter;

    this.onMessage(async (context, next) => {
      await this._handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(
            MessageFactory.text(
              'Hello! I\'m the **Presale Processing Agent**.\n\n' +
              'Send me a presale request, paste requirement text, or attach a PDF/DOCX file ' +
              'and I\'ll analyze it, estimate the effort, and generate a structured WBS.'
            )
          );
        }
      }
      await next();
    });
  }

  async _handleMessage(context) {
    const ref = TurnContext.getConversationReference(context.activity);
    conversationStore.set(ref.conversation.id, { ref, typingTimer: null });

    await context.sendActivity({ type: ActivityTypes.Typing });

    const activity = context.activity;
    const attachments = await Promise.all(
      (activity.attachments || [])
        .filter((a) => a.contentUrl)
        .map(async (a) => {
          const downloaded = await this._downloadAttachment(a.contentUrl);
          return { name: a.name, contentType: a.contentType, ...downloaded };
        })
    );

    const payload = {
      message: stripHtml(activity.text || ''),
      conversationId: activity.conversation.id,
      userId: activity.from.id,
      userName: activity.from.name || 'User',
      channelId: activity.channelId,
      serviceUrl: activity.serviceUrl,
      attachments,
      callbackUrl: config.proactiveCallbackUrl,
    };

    await context.sendActivity({ type: ActivityTypes.Typing });
    const entry = conversationStore.get(activity.conversation.id);
    const typingTimer = setInterval(async () => {
      const current = conversationStore.get(activity.conversation.id);
      if (!current?.typingTimer) return;
      try {
        await this.adapter.continueConversation(ref, async (tc) => {
          await tc.sendActivity({ type: ActivityTypes.Typing });
        });
      } catch (_) {}
    }, 3000);
    if (entry) entry.typingTimer = typingTimer;

    this._callN8n(payload).catch((err) => {
      console.error('[n8n fire-and-forget error]', err.message);
    });
  }

  async _downloadAttachment(contentUrl) {
    try {
      const creds = new MicrosoftAppCredentials(config.appId, config.appPassword, config.appTenantId);
      const token = await creds.getToken();
      const response = await fetch(contentUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        console.warn(`File download failed: HTTP ${response.status} for ${contentUrl}`);
        return { contentUrl, content: null, sizeBytes: null };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > config.maxAttachmentBytes) {
        console.warn(`File too large (${buffer.byteLength} bytes), skipping content`);
        return { contentUrl, content: null, sizeBytes: buffer.byteLength };
      }
      return {
        content: Buffer.from(buffer).toString('base64'),
        sizeBytes: buffer.byteLength,
      };
    } catch (err) {
      console.warn(`File download error: ${err.message}`);
      return { contentUrl, content: null, sizeBytes: null };
    }
  }

  async _callN8n(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { PresaleBot };
