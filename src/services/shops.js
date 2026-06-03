const { getDb } = require('../db');
const { getConnectionInfo, validateCredentials } = require('../shopify/client');
const { getLastFulfillmentLocations } = require('./syncDebug');

const DEMO_SHOP_DOMAIN = 'demo-store.myshopify.com';

function getDemoShopId() {
  const row = getDb().prepare('SELECT id FROM shops WHERE shop_domain = ?').get(DEMO_SHOP_DOMAIN);
  return row ? row.id : null;
}

function ensureConnectedShop({ updateCredentials = false } = {}) {
  const creds = validateCredentials();
  if (!creds.ok) return null;

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM shops WHERE shop_domain = ?').get(creds.shop);

  if (existing) {
    if (updateCredentials) {
      db.prepare(`
        UPDATE shops
        SET access_token = ?, updated_at = ?, installed_at = COALESCE(installed_at, ?)
        WHERE id = ?
      `).run(creds.token, now, now, existing.id);
    }
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO shops (shop_domain, access_token, installed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(creds.shop, creds.token, now, now, now);

  return result.lastInsertRowid;
}

function getCurrentShopId() {
  if (getConnectionInfo().configured) {
    return ensureConnectedShop();
  }
  return getDemoShopId();
}

function getCurrentShop() {
  const shopId = getCurrentShopId();
  if (!shopId) return null;

  const row = getDb().prepare('SELECT id, shop_domain FROM shops WHERE id = ?').get(shopId);
  if (!row) return null;

  return {
    id: row.id,
    shop_domain: row.shop_domain,
    mode: getConnectionInfo().configured ? 'connected' : 'demo',
  };
}

function getShopCounts(shopId) {
  if (!shopId) {
    return { productionOrders: 0, productionItems: 0, locations: 0 };
  }

  const db = getDb();
  const productionOrders = db.prepare(
    'SELECT COUNT(*) AS count FROM production_orders WHERE shop_id = ?'
  ).get(shopId).count;

  const productionItems = db.prepare(`
    SELECT COUNT(*) AS count
    FROM production_items pi
    INNER JOIN production_orders po ON po.id = pi.production_order_id
    WHERE po.shop_id = ?
  `).get(shopId).count;

  const locations = db.prepare(
    'SELECT COUNT(*) AS count FROM locations WHERE shop_id = ?'
  ).get(shopId).count;

  return { productionOrders, productionItems, locations };
}

function getCurrentShopContext() {
  const connection = getConnectionInfo();
  const shop = getCurrentShop();
  const counts = getShopCounts(shop?.id ?? null);

  return {
    mode: connection.configured ? 'connected' : 'demo',
    shopDomain: shop?.shop_domain ?? connection.shopDomain ?? null,
    shopId: shop?.id ?? null,
    productionOrders: counts.productionOrders,
    productionItems: counts.productionItems,
    locations: counts.locations,
  };
}

function getDemoShopSummary() {
  const demoId = getDemoShopId();
  if (!demoId) {
    return { exists: false, shopId: null, ...getShopCounts(null) };
  }
  return { exists: true, shopId: demoId, ...getShopCounts(demoId) };
}

function clearDemoData() {
  if (!getConnectionInfo().configured) {
    return { ok: false, message: 'Clear demo data is only available in connected mode.' };
  }

  const demoId = getDemoShopId();
  if (!demoId) {
    return { ok: false, message: 'No demo shop found.' };
  }

  const connectedId = getCurrentShopId();
  if (demoId === connectedId) {
    return { ok: false, message: 'Refusing to delete the active connected shop.' };
  }

  const db = getDb();
  const demoShop = db.prepare('SELECT id, shop_domain FROM shops WHERE id = ?').get(demoId);
  if (!demoShop || demoShop.shop_domain !== DEMO_SHOP_DOMAIN) {
    return { ok: false, message: 'Demo shop could not be verified.' };
  }

  const counts = getShopCounts(demoId);
  db.prepare('DELETE FROM shops WHERE id = ? AND shop_domain = ?').run(demoId, DEMO_SHOP_DOMAIN);

  return {
    ok: true,
    message: `Demo data cleared (${counts.productionOrders} orders, ${counts.locations} locations removed).`,
    deleted: counts,
  };
}

function getShopIdByDomain(shopDomain) {
  if (!shopDomain) return null;
  const row = getDb().prepare('SELECT id FROM shops WHERE shop_domain = ?').get(shopDomain);
  return row ? row.id : null;
}

function getDbSummary() {
  const db = getDb();
  const shops = db.prepare(`
    SELECT id, shop_domain, installed_at, created_at
    FROM shops
    ORDER BY id ASC
  `).all();

  const currentShopId = getCurrentShopId();
  const { listLocationsForDebug } = require('./locations');

  return {
    currentShopId,
    currentMode: getConnectionInfo().configured ? 'connected' : 'demo',
    fulfillmentAssignedLocationsLastSync: getLastFulfillmentLocations(),
    locations: listLocationsForDebug(currentShopId),
    shops: shops.map((shop) => ({
      id: shop.id,
      shop_domain: shop.shop_domain,
      is_current: shop.id === currentShopId,
      production_orders: db.prepare(
        'SELECT COUNT(*) AS count FROM production_orders WHERE shop_id = ?'
      ).get(shop.id).count,
      production_items: db.prepare(`
        SELECT COUNT(*) AS count
        FROM production_items pi
        INNER JOIN production_orders po ON po.id = pi.production_order_id
        WHERE po.shop_id = ?
      `).get(shop.id).count,
      locations: db.prepare(
        'SELECT COUNT(*) AS count FROM locations WHERE shop_id = ?'
      ).get(shop.id).count,
    })),
  };
}

module.exports = {
  DEMO_SHOP_DOMAIN,
  getDemoShopId,
  ensureConnectedShop,
  getCurrentShopId,
  getShopIdByDomain,
  getCurrentShop,
  getShopCounts,
  getCurrentShopContext,
  getDbSummary,
  getDemoShopSummary,
  clearDemoData,
};
