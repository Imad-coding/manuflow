const { getDb } = require('../db');

function formatSyncLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    status: row.status,
    message: row.message,
    orders_found: row.orders_found,
    production_orders_created: row.production_orders_created,
    production_orders_updated: row.production_orders_updated,
    items_synced: row.items_synced,
    locations_synced: row.locations_synced,
    discovered_locations_synced: row.discovered_locations_synced ?? 0,
    created_at: row.created_at,
  };
}

function createSyncLog({
  shopId,
  status,
  message,
  ordersFound = 0,
  productionOrdersCreated = 0,
  productionOrdersUpdated = 0,
  itemsSynced = 0,
  locationsSynced = 0,
  discoveredLocationsSynced = 0,
}) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sync_logs (
      shop_id, status, message,
      orders_found, production_orders_created, production_orders_updated,
      items_synced, locations_synced, discovered_locations_synced, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    shopId ?? null,
    status,
    message,
    ordersFound,
    productionOrdersCreated,
    productionOrdersUpdated,
    itemsSynced,
    locationsSynced,
    discoveredLocationsSynced,
  );

  return formatSyncLog(
    db.prepare('SELECT * FROM sync_logs WHERE id = ?').get(result.lastInsertRowid)
  );
}

function saveSyncLogFromResult(shopId, result) {
  const summary = result.summary || {};
  return createSyncLog({
    shopId,
    status: result.ok ? 'success' : 'failed',
    message: result.message || (result.ok ? 'Sync completed.' : 'Sync failed.'),
    ordersFound: summary.shopifyOrders ?? 0,
    productionOrdersCreated: summary.productionOrdersCreated ?? 0,
    productionOrdersUpdated: summary.productionOrdersUpdated ?? 0,
    itemsSynced: summary.itemsSynced ?? 0,
    locationsSynced: summary.locationsSynced ?? 0,
    discoveredLocationsSynced: summary.locationsDiscoveredFromFulfillmentOrders ?? 0,
  });
}

function listRecentSyncLogs(shopId, limit = 5) {
  if (!shopId) return [];

  const rows = getDb().prepare(`
    SELECT * FROM sync_logs
    WHERE shop_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(shopId, limit);

  return rows.map(formatSyncLog);
}

function getLatestSyncLog(shopId) {
  if (!shopId) return null;
  const row = getDb().prepare(`
    SELECT * FROM sync_logs
    WHERE shop_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(shopId);

  return formatSyncLog(row);
}

module.exports = {
  createSyncLog,
  saveSyncLogFromResult,
  listRecentSyncLogs,
  getLatestSyncLog,
};
