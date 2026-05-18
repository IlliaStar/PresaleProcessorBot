const restify = require('restify');
const { BotFrameworkAdapter } = require('botbuilder');
const config = require('./src/config');
const { PresaleBot } = require('./src/bot');

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

const bot = new PresaleBot();

const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.post('/api/messages', async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

server.listen(config.port, () => {
  console.log(`Presale Teams Bot listening on port ${config.port}`);
  console.log(`n8n webhook → ${config.n8nWebhookUrl}`);
});
