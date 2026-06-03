const { syncOrders } = require('../shopify/syncOrders');
const { getCurrentShopId } = require('./shops');
const { createActivityLog } = require('./activityLogs');
const {
  markWebhookEventsSyncTriggered,
  markWebhookEventsSyncCompleted,
} = require('./webhookEvents');
const {
  broadcastOrdersChanged,
  broadcastSyncCompleted,
  broadcastSyncFailed,
  normalizeShopId,
  getConnectedClientCount,
} = require('./liveEvents');

const DEBOUNCE_MS = 3000;

let debounceTimer = null;
let syncRunning = false;
let pendingReason = 'webhook';
let pendingWebhookEventIds = new Set();

function logWebhookSync(message, extra = {}) {
  const parts = Object.entries(extra)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[webhook sync] ${message}${parts ? ` ${parts}` : ''}`);
}

function scheduleWebhookSync(webhookEventId, reason = 'webhook') {
  if (webhookEventId) {
    pendingWebhookEventIds.add(webhookEventId);
  }
  pendingReason = reason;

  if (debounceTimer) {
    logWebhookSync('sync already scheduled — queued event id', { eventId: webhookEventId || 'none' });
    return { scheduled: false, alreadyScheduled: true };
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runDebouncedWebhookSync().catch((err) => {
      logWebhookSync('unhandled error', { error: err.message });
    });
  }, DEBOUNCE_MS);

  logWebhookSync('sync scheduled', { delayMs: DEBOUNCE_MS, reason, eventIds: pendingWebhookEventIds.size });
  return { scheduled: true, alreadyScheduled: false };
}

async function runDebouncedWebhookSync() {
  if (syncRunning) {
    logWebhookSync('sync already running — will retry after current run');
    return;
  }

  syncRunning = true;
  const shopId = normalizeShopId(getCurrentShopId());
  const eventIds = [...pendingWebhookEventIds];
  pendingWebhookEventIds.clear();
  const reason = pendingReason;

  markWebhookEventsSyncTriggered(eventIds);
  logWebhookSync('sync started (manual sync path)', { shopId, eventCount: eventIds.length, reason });

  try {
    const result = await syncOrders({ source: 'webhook' });

    if (shopId) {
      createActivityLog({
        shopId,
        productionOrderId: null,
        actor: 'Shopify Webhook',
        action: 'webhook_sync_triggered',
        message: 'Shopify webhook triggered order sync',
      });
    }

    if (result.ok) {
      markWebhookEventsSyncCompleted(eventIds, { ok: true, message: result.message });
      const livePayload = {
        reason: 'shopify_webhook',
        message: result.message,
        summary: result.summary || null,
      };
      broadcastSyncCompleted(shopId, livePayload);
      broadcastOrdersChanged(shopId, 'shopify_webhook');
      logWebhookSync('sync completed', { ok: true, code: result.code || 'SYNC_OK', shopId, sseClients: getConnectedClientCount(shopId) });
    } else {
      markWebhookEventsSyncCompleted(eventIds, { ok: false, message: result.message });
      broadcastSyncFailed(shopId, result.message);
      logWebhookSync('sync failed', { ok: false, error: result.message, code: result.code || 'unknown' });
    }
  } catch (err) {
    markWebhookEventsSyncCompleted(eventIds, { ok: false, message: err.message || 'Webhook sync failed.' });
    broadcastSyncFailed(shopId, err.message || 'Webhook sync failed.');
    logWebhookSync('sync error', { error: err.message });
  } finally {
    syncRunning = false;
    if (pendingWebhookEventIds.size > 0) {
      scheduleWebhookSync(null, pendingReason);
    }
  }
}

async function runWebhookPipelineSelfTest() {
  const shopId = getCurrentShopId();
  const { recordWebhookEvent } = require('./webhookEvents');

  const recorded = recordWebhookEvent({
    shopId,
    webhookId: `self-test-${Date.now()}`,
    topic: 'self_test/pipeline',
    shopDomain: null,
    status: 'self_test',
    message: 'Webhook pipeline self-test started',
    hmacValid: true,
    syncTriggered: 0,
    syncCompleted: 0,
  });

  scheduleWebhookSync(recorded.id, 'self_test');
  logWebhookSync('self-test scheduled', { eventId: recorded.id });

  return {
    ok: true,
    message: 'Webhook pipeline self-test scheduled. Sync will run in ~3 seconds.',
    eventId: recorded.id,
  };
}

function isSyncRunning() {
  return syncRunning;
}

module.exports = {
  scheduleWebhookSync,
  runDebouncedWebhookSync,
  runWebhookPipelineSelfTest,
  isSyncRunning,
};
