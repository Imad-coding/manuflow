const clientsByShop = new Map();

function normalizeShopId(shopId) {
  if (shopId === null || shopId === undefined) return 0;
  const n = Number(shopId);
  return Number.isFinite(n) ? n : 0;
}

function getClientSet(shopId) {
  const key = normalizeShopId(shopId);
  if (!clientsByShop.has(key)) {
    clientsByShop.set(key, new Set());
  }
  return clientsByShop.get(key);
}

function getConnectedClientCount(shopId) {
  const set = clientsByShop.get(normalizeShopId(shopId));
  return set ? set.size : 0;
}

function removeClient(res, shopId) {
  const key = normalizeShopId(shopId ?? res.__sseShopId);
  const set = clientsByShop.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    clientsByShop.delete(key);
  }
}

function addClient(res, shopId) {
  const key = normalizeShopId(shopId);
  res.__sseShopId = key;

  const set = getClientSet(key);
  set.add(res);

  console.log(`[SSE] client connected shop_id=${key}`);

  res.on('close', () => {
    removeClient(res, key);
    console.log(`[SSE] client disconnected shop_id=${key}`);
  });
}

function writeEvent(res, eventName, payload) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    removeClient(res, res.__sseShopId);
  }
}

function buildLiveSyncPayload(reason, extra = {}) {
  return {
    reason,
    timestamp: new Date().toISOString(),
    orderCountChanged: true,
    ...extra,
  };
}

function broadcastToShop(shopId, eventName, payload) {
  const key = normalizeShopId(shopId);
  const set = clientsByShop.get(key);
  const count = set?.size || 0;

  console.log(`[SSE] broadcast event=${eventName} shop_id=${key} clients=${count}`);

  if (!set || count === 0) return;

  for (const res of set) {
    writeEvent(res, eventName, payload);
  }
}

function broadcastOrderUpdated(shopId, productionOrderId, reason) {
  broadcastToShop(shopId, 'order_updated', {
    productionOrderId,
    reason: reason || 'updated',
    timestamp: new Date().toISOString(),
  });
}

function broadcastOrdersChanged(shopId, reason, extra = {}) {
  broadcastToShop(shopId, 'orders_changed', buildLiveSyncPayload(reason || 'orders_changed', extra));
}

function broadcastSyncCompleted(shopId, summary) {
  const payload = typeof summary === 'object' && summary !== null
    ? buildLiveSyncPayload(summary.reason || 'shopify_webhook', summary)
    : buildLiveSyncPayload('shopify_webhook', { message: summary || 'Sync completed.' });

  broadcastToShop(shopId, 'sync_completed', payload);
}

function broadcastSyncFailed(shopId, message) {
  broadcastToShop(shopId, 'sync_failed', {
    message: message || 'Sync failed.',
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  addClient,
  removeClient,
  getConnectedClientCount,
  normalizeShopId,
  buildLiveSyncPayload,
  broadcastToShop,
  broadcastOrderUpdated,
  broadcastOrdersChanged,
  broadcastSyncCompleted,
  broadcastSyncFailed,
};
