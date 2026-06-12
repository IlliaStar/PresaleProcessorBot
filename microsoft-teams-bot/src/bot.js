const { TeamsActivityHandler, MessageFactory, CardFactory, ActivityTypes, TurnContext } = require('botbuilder');
const { MicrosoftAppCredentials } = require('botframework-connector');
const config = require('./config');
const conversationStore = require('./conversationStore');

// After 3 minutes without a callback, give up and send a timeout message
const MAX_RESPONSE_WAIT_MS = 3 * 60 * 1000;

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
          await context.sendActivity(MessageFactory.attachment(
            this._greetingCard(member.name)
          ));
        }
      }
      await next();
    });
  }

  _greetingCard(name) {
    const firstName = name ? name.split(' ')[0] : 'there';
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          size: 'Large',
          weight: 'Bolder',
          text: 'Presale Processing Agent',
        },
        {
          type: 'TextBlock',
          text: `Hello, **${firstName}**! I help analyze presale requests, estimate effort, and generate structured WBS documents.\n\nHow would you like to proceed?`,
          wrap: true,
        },
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: '🆕 Start a new presale',
          data: { intent: 'new_presale' },
        },
        {
          type: 'Action.Submit',
          title: '📋 Continue an existing presale',
          data: { intent: 'continue_presale' },
        },
      ],
    });
  }

  async _handleMessage(context) {
    const activity = context.activity;
    const ref = TurnContext.getConversationReference(activity);
    const conversationId = ref.conversation.id;

    // Show typing indicator immediately
    await context.sendActivity({ type: ActivityTypes.Typing });

    // Download attachments
    const attachments = await Promise.all(
      (activity.attachments || [])
        .filter((a) => a.contentUrl || a.content?.downloadUrl)
        .map(async (a) => {
          const downloaded = await this._downloadAttachment(a);
          return { name: a.name, contentType: a.contentType, ...downloaded };
        })
    );

    // Adaptive Card Action.Submit sends data in activity.value, not activity.text
    const cardData = activity.value ? JSON.stringify(activity.value) : '';
    const userMessage = stripHtml(activity.text || '') || cardData;

    const payload = {
      message: userMessage,
      conversationId,
      userId: activity.from.id,
      aadObjectId: activity.from.aadObjectId || '',
      userName: activity.from.name || 'User',
      channelId: activity.channelId,
      serviceUrl: activity.serviceUrl,
      attachments,
      callbackUrl: config.proactiveCallbackUrl,
    };

    // Keep sending typing every 3 s while n8n processes
    await context.sendActivity({ type: ActivityTypes.Typing });
    const typingTimer = setInterval(async () => {
      const current = conversationStore.get(conversationId);
      if (!current?.typingTimer) return;
      try {
        await this.adapter.continueConversation(ref, async (tc) => {
          await tc.sendActivity({ type: ActivityTypes.Typing });
        });
      } catch (_) {}
    }, 3000);

    // Safeguard: if no callback arrives in MAX_RESPONSE_WAIT_MS, stop and apologise
    const responseDeadline = setTimeout(async () => {
      const entry = conversationStore.get(conversationId);
      if (!entry?.typingTimer) return; // already resolved by /proactive
      clearInterval(entry.typingTimer);
      entry.typingTimer = null;
      entry.responseDeadline = null;
      try {
        await this.adapter.continueConversation(ref, async (tc) => {
          await tc.sendActivity(
            MessageFactory.text('Processing took longer than expected. Please try again.')
          );
        });
      } catch (_) {}
    }, MAX_RESPONSE_WAIT_MS);

    conversationStore.set(conversationId, { ref, typingTimer, responseDeadline });

    // Fire and forget — n8n calls back via /proactive
    this._callN8n(payload).catch(async (err) => {
      console.error('[n8n error]', err.message);
      const entry = conversationStore.get(conversationId);
      if (entry?.typingTimer) { clearInterval(entry.typingTimer); entry.typingTimer = null; }
      if (entry?.responseDeadline) { clearTimeout(entry.responseDeadline); entry.responseDeadline = null; }
      try {
        await this.adapter.continueConversation(ref, async (tc) => {
          await tc.sendActivity(
            MessageFactory.text("Sorry, I'm unable to reach the processing service right now. Please try again in a moment.")
          );
        });
      } catch (_) {}
    });
  }

  async _downloadAttachment(attachment) {
    // Teams file attachments expose content.downloadUrl — a pre-authenticated short-lived URL
    // that does not require a Bearer token. contentUrl points to SharePoint and would require
    // a different OAuth scope than the Bot Framework token, so it reliably fails.
    const downloadUrl = attachment.content?.downloadUrl || attachment.contentUrl;
    const useAuth = !attachment.content?.downloadUrl;
    try {
      const headers = {};
      if (useAuth) {
        const creds = new MicrosoftAppCredentials(config.appId, config.appPassword, config.appTenantId);
        const token = await creds.getToken();
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) {
        console.warn(`File download failed: HTTP ${response.status} for ${downloadUrl}`);
        return { contentUrl: downloadUrl, content: null, sizeBytes: null };
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > config.maxAttachmentBytes) {
        console.warn(`File too large (${buffer.byteLength} bytes), skipping content`);
        return { contentUrl: downloadUrl, content: null, sizeBytes: buffer.byteLength };
      }
      return {
        content: Buffer.from(buffer).toString('base64'),
        sizeBytes: buffer.byteLength,
      };
    } catch (err) {
      console.warn(`File download error: ${err.message}`);
      return { contentUrl: downloadUrl, content: null, sizeBytes: null };
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
