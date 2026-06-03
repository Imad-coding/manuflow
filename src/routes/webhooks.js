const express = require('express');
const { getShopIdByDomain, ensureConnectedShop } = require('../services/shops');
const { recordWebhookEvent, updateWebhookEvent } = require('../services/webhookEvents');
const { scheduleWebhookSync } = require('../services/webhookSync');
const { handleShopifyOrderCancelled } = require('../services/productionOrders');
const { broadcastOrdersChanged } = require('../services/liveEvents');
const { getConnectionInfo } = require('../shopify/client');
const { verifyShopifyWebhookHmac } = require('../shopify/webhookVerify');

const router = express.Router();

function isWebhookEnabled() {
  return process.env.SHOPIFY_WEBHOOK_ENABLED === 'true';
}

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body === undefined || req.body === null) return Buffer.alloc(0);
  return Buffer.from(String(req.body), 'utf8');
}

function extractOrderGid(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload.id && String(payload.id).startsWith('gid://')) return String(payload.id);
  if (payload.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

function resolveShopId(shopDomain) {
  let shopId = getShopIdByDomain(shopDomain);
  if (!shopId && getConnectionInfo().configured) {
    shopId = ensureConnectedShop();
  }
  return shopId;
}

function parseWebhookBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

function logWebhookRequest(details) {
  console.log(
    `[webhook] route=${details.route} topic=${details.topic || 'unknown'} `
    + `shop=${details.shopDomain || 'unknown'} webhook_id=${details.webhookId || 'none'} `
    + `hmac=${details.hmacValid ? 'valid' : 'invalid'} matched_secret=${details.matchedSecret || 'none'} `
    + `body_bytes=${details.bodyBytes ?? 0} sync_scheduled=${details.syncScheduled ? 'yes' : 'no'}`,
  );
}

function handleWebhook(req, res, { routePath, defaultTopic, triggersSync, processFn }) {
  const webhookId = req.get('X-Shopify-Webhook-Id') || null;
  const shopDomain = req.get('X-Shopify-Shop-Domain') || null;
  const topic = req.get('X-Shopify-Topic') || defaultTopic;
  const rawBody = getRawBody(req);
  const shopId = resolveShopId(shopDomain);

  const baseLog = {
    route: routePath,
    topic,
    shopDomain,
    webhookId,
    bodyBytes: rawBody.length,
    hmacValid: false,
    matchedSecret: 'none',
    syncScheduled: false,
  };

  console.log(`[webhook] route hit path=${routePath}`);

  if (!isWebhookEnabled()) {
    recordWebhookEvent({
      shopId,
      webhookId,
      topic,
      shopDomain,
      route: routePath,
      status: 'skipped',
      message: 'Webhooks disabled via SHOPIFY_WEBHOOK_ENABLED',
      hmacValid: null,
      matchedSecret: null,
    });
    logWebhookRequest({ ...baseLog, matchedSecret: 'none' });
    return res.status(200).json({ ok: true, processed: false, reason: 'disabled' });
  }

  const hmacResult = verifyShopifyWebhookHmac(rawBody, req.get('X-Shopify-Hmac-Sha256'));
  baseLog.hmacValid = hmacResult.valid;
  baseLog.matchedSecret = hmacResult.matchedSecret;

  if (!hmacResult.valid) {
    recordWebhookEvent({
      shopId,
      webhookId,
      topic,
      shopDomain,
      route: routePath,
      status: 'rejected',
      message: 'Invalid HMAC — check SHOPIFY_WEBHOOK_SECRET (custom app) or SHOPIFY_MANUAL_WEBHOOK_SECRET (Admin webhooks)',
      hmacValid: false,
      matchedSecret: 'none',
    });
    logWebhookRequest(baseLog);
    return res.status(401).json({ ok: false, message: 'Invalid webhook signature.' });
  }

  const payload = parseWebhookBody(rawBody);
  if (!payload) {
    recordWebhookEvent({
      shopId,
      webhookId,
      topic,
      shopDomain,
      route: routePath,
      status: 'failed',
      message: 'Invalid JSON payload',
      hmacValid: true,
      matchedSecret: hmacResult.matchedSecret,
    });
    logWebhookRequest(baseLog);
    return res.status(400).json({ ok: false, message: 'Invalid JSON payload.' });
  }

  const recorded = recordWebhookEvent({
    shopId,
    webhookId,
    topic,
    shopDomain,
    route: routePath,
    status: 'received',
    message: `Webhook received — HMAC valid (${hmacResult.matchedSecret})`,
    hmacValid: true,
    matchedSecret: hmacResult.matchedSecret,
  });

  if (recorded.duplicate) {
    logWebhookRequest({ ...baseLog, syncScheduled: false });
    console.log(`[webhook] duplicate delivery webhook_id=${webhookId} matched_secret=${hmacResult.matchedSecret}`);
    return res.status(200).json({ ok: true, processed: false, reason: 'duplicate' });
  }

  res.status(200).json({ ok: true, processed: true });

  setImmediate(() => {
    try {
      if (triggersSync) {
        const scheduleResult = scheduleWebhookSync(recorded.id, topic);
        baseLog.syncScheduled = scheduleResult.scheduled || scheduleResult.alreadyScheduled;
        updateWebhookEvent(recorded.id, {
          syncTriggered: scheduleResult.scheduled || scheduleResult.alreadyScheduled ? 1 : 0,
          message: scheduleResult.scheduled
            ? 'Sync scheduled (same path as manual Sync button)'
            : 'Sync already scheduled — coalesced with pending run',
        });
        logWebhookRequest(baseLog);
      } else if (processFn) {
        processFn(payload, shopDomain, recorded.id);
        logWebhookRequest({ ...baseLog, syncScheduled: false });
      }
    } catch (err) {
      console.error(`[webhook] processing error topic=${topic}:`, err.message);
      updateWebhookEvent(recorded.id, {
        status: 'failed',
        message: err.message || 'Processing failed',
        syncCompleted: 0,
      });
      logWebhookRequest({ ...baseLog, syncScheduled: false });
      console.log(`[webhook] sync_completed=no sync_error=${err.message}`);
    }
  });
}

router.post('/orders-create', (req, res) => {
  handleWebhook(req, res, {
    routePath: '/webhooks/shopify/orders-create',
    defaultTopic: 'orders/create',
    triggersSync: true,
  });
});

router.post('/orders-updated', (req, res) => {
  handleWebhook(req, res, {
    routePath: '/webhooks/shopify/orders-updated',
    defaultTopic: 'orders/updated',
    triggersSync: true,
  });
});

router.post('/orders-cancelled', (req, res) => {
  handleWebhook(req, res, {
    routePath: '/webhooks/shopify/orders-cancelled',
    defaultTopic: 'orders/cancelled',
    triggersSync: false,
    processFn: (payload, shopDomain) => {
      const orderGid = extractOrderGid(payload);
      const shopId = resolveShopId(shopDomain);
      if (shopId && orderGid) {
        handleShopifyOrderCancelled(orderGid, shopId);
        broadcastOrdersChanged(shopId, 'orders/cancelled');
      }
    },
  });
});

router.post('/fulfillment-orders-updated', (req, res) => {
  handleWebhook(req, res, {
    routePath: '/webhooks/shopify/fulfillment-orders-updated',
    defaultTopic: 'fulfillment_orders/updated',
    triggersSync: true,
  });
});

module.exports = router;
