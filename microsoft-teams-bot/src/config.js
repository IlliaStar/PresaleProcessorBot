require('dotenv').config();

const config = {
  appId: process.env.MICROSOFT_APP_ID || '',
  appPassword: process.env.MICROSOFT_APP_PASSWORD || '',
  appType: process.env.MICROSOFT_APP_TYPE || 'SingleTenant',
  appTenantId: process.env.MICROSOFT_APP_TENANT_ID || '',
  port: parseInt(process.env.PORT || '3978', 10),
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/presale-agent',
  n8nTimeout: parseInt(process.env.N8N_TIMEOUT || '120000', 10),
  maxAttachmentBytes: parseInt(process.env.MAX_ATTACHMENT_BYTES || String(10 * 1024 * 1024), 10),
};

module.exports = config;
