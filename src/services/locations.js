const { getDb } = require('../db');
const { getCurrentShopId } = require('./shops');
const {
  buildLocationKey,
  getDisplayName,
  isNameFallbackKey,
  mergeSource,
} = require('./locationKeys');

const SOURCE_SHOPIFY_QUERY = 'shopify_location_query';
const SOURCE_FULFILLMENT_ORDER = 'fulfillment_order_assigned_location';

function listLocations(shopId, { enabledOnly = false } = {}) {
  const db = getDb();
  const id = shopId ?? getCurrentShopId();
  if (!id) return [];

  let sql = 'SELECT * FROM locations WHERE shop_id = ?';
  if (enabledOnly) sql += ' AND enabled = 1';
  sql += ' ORDER BY name ASC';

  return db.prepare(sql).all(id).map(formatLocation);
}

function getLocationById(id) {
  const row = getDb().prepare('SELECT * FROM locations WHERE id = ?').get(id);
  return row ? formatLocation(row) : null;
}

function toggleLocation(id, enabled, shopId) {
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const db = getDb();
  const result = db.prepare(`
    UPDATE locations SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(enabled ? 1 : 0, id, currentShopId);

  if (result.changes === 0) return null;
  return getLocationById(id);
}

function findLocationByShopifyId(shopId, shopifyLocationId) {
  return getDb().prepare(`
    SELECT * FROM locations WHERE shop_id = ? AND shopify_location_id = ?
  `).get(shopId, shopifyLocationId);
}

function findLocationByName(shopId, name) {
  return getDb().prepare(`
    SELECT * FROM locations WHERE shop_id = ? AND name = ?
  `).get(shopId, name);
}

function upsertLocationRecord(shopId, {
  shopifyLocationId,
  name,
  source,
  isThirdParty = false,
  rawJson = null,
  knownQueryLocationIds = null,
}) {
  const db = getDb();
  let existing = findLocationByShopifyId(shopId, shopifyLocationId);

  if (!existing && !isNameFallbackKey(shopifyLocationId)) {
    const byName = findLocationByName(shopId, name);
    if (byName && isNameFallbackKey(byName.shopify_location_id)) {
      existing = byName;
    }
  }

  const inQuery = knownQueryLocationIds?.has(shopifyLocationId) ?? false;
  const thirdParty = isThirdParty || (!inQuery && source === SOURCE_FULFILLMENT_ORDER);

  if (existing) {
    const mergedSource = mergeSource(existing.source, source);
    const mergedThirdParty = mergedSource === SOURCE_SHOPIFY_QUERY && inQuery
      ? 0
      : (existing.is_third_party || thirdParty ? 1 : 0);

    const nextShopifyId = isNameFallbackKey(existing.shopify_location_id) && !isNameFallbackKey(shopifyLocationId)
      ? shopifyLocationId
      : existing.shopify_location_id;

    db.prepare(`
      UPDATE locations
      SET shopify_location_id = ?, name = ?, source = ?, is_third_party = ?,
          raw_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextShopifyId,
      name,
      mergedSource,
      mergedThirdParty,
      rawJson ?? existing.raw_json,
      existing.id,
    );

    return { id: existing.id, created: false, merged: nextShopifyId !== existing.shopify_location_id };
  }

  const result = db.prepare(`
    INSERT INTO locations (
      shop_id, shopify_location_id, name, enabled, source, is_third_party, raw_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    shopId,
    shopifyLocationId,
    name,
    source,
    thirdParty ? 1 : 0,
    rawJson,
  );

  return { id: result.lastInsertRowid, created: true, merged: false };
}

function upsertLocationFromShopifyQuery(shopId, shopifyLocation, knownQueryLocationIds) {
  knownQueryLocationIds?.add(shopifyLocation.id);
  return upsertLocationRecord(shopId, {
    shopifyLocationId: shopifyLocation.id,
    name: shopifyLocation.name,
    source: SOURCE_SHOPIFY_QUERY,
    isThirdParty: false,
    rawJson: JSON.stringify(shopifyLocation),
    knownQueryLocationIds,
  });
}

function upsertLocationFromAssignedLocation(shopId, assignedLocation, knownQueryLocationIds) {
  const shopifyLocationId = buildLocationKey(assignedLocation);
  const name = getDisplayName(assignedLocation);

  if (!shopifyLocationId || !name) {
    return null;
  }

  const locationId = assignedLocation.location?.id || null;
  const inQuery = locationId ? knownQueryLocationIds?.has(locationId) : false;
  const isThirdParty = !locationId || !inQuery;

  return upsertLocationRecord(shopId, {
    shopifyLocationId,
    name,
    source: SOURCE_FULFILLMENT_ORDER,
    isThirdParty,
    rawJson: JSON.stringify(assignedLocation),
    knownQueryLocationIds,
  });
}

function upsertLocationFromShopify(shopId, shopifyLocation) {
  return upsertLocationFromShopifyQuery(shopId, shopifyLocation, new Set());
}

function collectAssignedLocationsFromOrders(orders) {
  const collected = new Map();

  for (const order of orders) {
    for (const foEdge of order.fulfillmentOrders?.edges || []) {
      const assignedLocation = foEdge.node?.assignedLocation;
      const key = buildLocationKey(assignedLocation);
      const name = getDisplayName(assignedLocation);

      if (!key || !name) continue;
      if (!collected.has(key)) {
        collected.set(key, {
          key,
          name,
          location_id: assignedLocation.location?.id || null,
          assignedLocation,
        });
      }
    }
  }

  return collected;
}

function getLocationMap(shopId) {
  const rows = listLocations(shopId);
  const map = new Map();
  for (const loc of rows) {
    map.set(loc.shopify_location_id, loc.id);
  }
  return map;
}

function resolveLocalLocationId(assignedLocation, locationMap) {
  if (!assignedLocation) {
    return { localId: null, label: 'Unassigned / Unknown' };
  }

  const key = buildLocationKey(assignedLocation);
  const name = getDisplayName(assignedLocation);

  if (key && locationMap.has(key)) {
    return { localId: locationMap.get(key), label: name || 'Unknown location' };
  }

  if (assignedLocation.location?.id && locationMap.has(assignedLocation.location.id)) {
    return {
      localId: locationMap.get(assignedLocation.location.id),
      label: name || assignedLocation.location.name || 'Unknown location',
    };
  }

  return { localId: null, label: 'Unassigned / Unknown' };
}

function countLocationsForShop(shopId) {
  if (!shopId) return 0;
  return getDb().prepare('SELECT COUNT(*) AS count FROM locations WHERE shop_id = ?').get(shopId).count;
}

function listLocationsForDebug(shopId) {
  if (!shopId) return [];
  return listLocations(shopId).map((loc) => ({
    id: loc.id,
    name: loc.name,
    shopify_location_id: loc.shopify_location_id,
    source: loc.source,
    is_third_party: loc.is_third_party,
    enabled: loc.enabled,
    badge: getLocationBadge(loc).label,
  }));
}

function getLocationBadge(loc) {
  if (
    loc.source === SOURCE_SHOPIFY_QUERY &&
    !loc.is_third_party &&
    !isNameFallbackKey(loc.shopify_location_id)
  ) {
    return {
      label: 'Shopify',
      className: 'bg-slate-100 text-slate-700 ring-slate-200/80',
    };
  }
  if (isNameFallbackKey(loc.shopify_location_id)) {
    return {
      label: 'Discovered from order',
      className: 'bg-sky-50 text-sky-700 ring-sky-200/80',
    };
  }
  if (loc.is_third_party) {
    return {
      label: 'Fulfillment app',
      className: 'bg-violet-50 text-violet-700 ring-violet-200/80',
    };
  }
  if (loc.source === SOURCE_FULFILLMENT_ORDER) {
    return {
      label: 'Discovered from order',
      className: 'bg-sky-50 text-sky-700 ring-sky-200/80',
    };
  }
  return {
    label: 'Shopify',
    className: 'bg-slate-100 text-slate-700 ring-slate-200/80',
  };
}

function formatLocation(row) {
  const loc = {
    id: row.id,
    shop_id: row.shop_id,
    shopify_location_id: row.shopify_location_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    source: row.source || SOURCE_SHOPIFY_QUERY,
    is_third_party: Boolean(row.is_third_party),
    raw_json: row.raw_json ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  loc.badge = getLocationBadge(loc);
  return loc;
}

module.exports = {
  SOURCE_SHOPIFY_QUERY,
  SOURCE_FULFILLMENT_ORDER,
  listLocations,
  getLocationById,
  toggleLocation,
  upsertLocationFromShopify,
  upsertLocationFromShopifyQuery,
  upsertLocationFromAssignedLocation,
  collectAssignedLocationsFromOrders,
  getLocationMap,
  resolveLocalLocationId,
  countLocationsForShop,
  listLocationsForDebug,
  getLocationBadge,
};
