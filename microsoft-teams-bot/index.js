const restify = require('restify');
const { BotFrameworkAdapter, MessageFactory } = require('botbuilder');
const config = require('./src/config');
const { PresaleBot } = require('./src/bot');
const conversationStore = require('./src/conversationStore');

const adapter = new BotFrameworkAdapter({
  appId: config.appId,
  appPassword: config.appPassword,
  appType: config.appType,
  channelAuthTenant: config.appTenantId,
});

adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError]', error);
  await context.sendActivity('The bot encountered an error. Please try again.');
};

const bot = new PresaleBot(adapter);

const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.post('/api/messages', async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

server.post('/proactive', async (req, res) => {
  const { conversationId, reply } = req.body || {};
  if (!conversationId || !reply) {
    res.json(400, { error: 'conversationId and reply are required' });
    return;
  }
  const stored = conversationStore.get(conversationId);
  if (!stored) {
    res.json(404, { error: `No conversation reference for conversationId: ${conversationId}` });
    return;
  }
  const { ref, typingTimer, responseDeadline } = stored;
  if (typingTimer) { clearInterval(typingTimer); stored.typingTimer = null; }
  if (responseDeadline) { clearTimeout(responseDeadline); stored.responseDeadline = null; }
  try {
    await adapter.continueConversation(ref, async (turnContext) => {
      await turnContext.sendActivity(MessageFactory.text(reply));
    });
    res.json(200, { ok: true });
  } catch (err) {
    console.error('[proactive error]', err);
    res.json(500, { error: err.message });
  }
});

server.listen(config.port, () => {
  console.log(`Presale Teams Bot listening on port ${config.port}`);
  console.log(`n8n webhook → ${config.n8nWebhookUrl}`);
  console.log(`proactive callback → ${config.proactiveCallbackUrl}`);
});
