const { TeamsActivityHandler, MessageFactory, ActivityTypes } = require('botbuilder');
const { MicrosoftAppCredentials } = require('botframework-connector');
const config = require('./config');

class PresaleBot extends TeamsActivityHandler {
  constructor() {
    super();

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
    // Show typing indicator while waiting for n8n
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
      message: (activity.text || '').trim(),
      conversationId: activity.conversation.id,
      userId: activity.from.id,
      userName: activity.from.name || 'User',
      channelId: activity.channelId,
      serviceUrl: activity.serviceUrl,
      attachments,
    };

    const reply = await this._callN8n(payload);
    await context.sendActivity(MessageFactory.text(reply));
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
    const timer = setTimeout(() => controller.abort(), config.n8nTimeout);

    try {
      const response = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        return `n8n returned HTTP ${response.status}. Check your workflow configuration.`;
      }

      const data = await response.json();
      return data.reply || data.message || JSON.stringify(data);
    } catch (err) {
      if (err.name === 'AbortError') {
        return 'The request timed out. The n8n workflow is taking too long to respond.';
      }
      if (err.cause?.code === 'ECONNREFUSED') {
        return 'Cannot reach the n8n orchestrator. Make sure it is running (`n8n start`).';
      }
      return `Error contacting orchestrator: ${err.message}`;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { PresaleBot };
