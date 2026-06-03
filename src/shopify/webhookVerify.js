const crypto = require('crypto');

function hmacMatches(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader || !rawBody || rawBody.length === 0) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const digestBuffer = Buffer.from(digest, 'utf8');
  const hmacBuffer = Buffer.from(hmacHeader, 'utf8');

  if (digestBuffer.length !== hmacBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

function verifyShopifyWebhookHmac(rawBody, hmacHeader) {
  const customSecret = (process.env.SHOPIFY_WEBHOOK_SECRET || '').trim();
  const manualSecret = (process.env.SHOPIFY_MANUAL_WEBHOOK_SECRET || '').trim();

  if (customSecret && hmacMatches(rawBody, hmacHeader, customSecret)) {
    return { valid: true, matchedSecret: 'custom_app' };
  }

  if (manualSecret && hmacMatches(rawBody, hmacHeader, manualSecret)) {
    return { valid: true, matchedSecret: 'manual_webhook' };
  }

  return { valid: false, matchedSecret: 'none' };
}

function isCustomAppWebhookSecretConfigured() {
  return Boolean((process.env.SHOPIFY_WEBHOOK_SECRET || '').trim());
}

function isManualWebhookSecretConfigured() {
  return Boolean((process.env.SHOPIFY_MANUAL_WEBHOOK_SECRET || '').trim());
}

module.exports = {
  verifyShopifyWebhookHmac,
  isCustomAppWebhookSecretConfigured,
  isManualWebhookSecretConfigured,
};
