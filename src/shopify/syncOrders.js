const { ensureConnectedShop } = require('../services/shops');
const { saveSyncLogFromResult } = require('../services/syncLogs');
const { setLastFulfillmentLocations } = require('../services/syncDebug');
const {
  shopifyGraphQL,
  validateCredentials,
  ShopifySyncError,
} = require('./client');
const { LOCATIONS_QUERY, ORDERS_QUERY } = require('./queries');
const {
  upsertLocationFromShopifyQuery,
  upsertLocationFromAssignedLocation,
  collectAssignedLocationsFromOrders,
  getLocationMap,
  resolveLocalLocationId,
  countLocationsForShop,
} = require('../services/locations');
const { upsertFromSync } = require('../services/productionOrders');

const NO_ORDERS_WARNING =
  'No open Shopify orders found. Check order status, scopes, or test store data.';

async function fetchAllLocations() {
  const data = await shopifyGraphQL(LOCATIONS_QUERY);
  return (data.locations?.edges || []).map((edge) => edge.node);
}

async function fetchAllOrders() {
  const orders = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await shopifyGraphQL(ORDERS_QUERY, {
      first: 50,
      after: cursor,
      query: 'status:open OR status:unfulfilled OR status:partially_fulfilled',
    });

    const connection = data.orders;
    for (const edge of connection.edges || []) {
      orders.push(edge.node);
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  return orders;
}

function buildLineItemMap(order) {
  const map = new Map();
  for (const edge of order.lineItems?.edges || []) {
    map.set(edge.node.id, edge.node);
  }
  return map;
}

function buildLocationSummary(shopId, locationsFromQuery, assignedLocations, knownQueryLocationIds) {
  let locationsDiscoveredFromFulfillmentOrders = 0;
  for (const item of assignedLocations.values()) {
    const inQuery = item.location_id && knownQueryLocationIds.has(item.location_id);
    if (!inQuery) locationsDiscoveredFromFulfillmentOrders++;
  }

  return {
    locationsFromQuery,
    locationsDiscoveredFromFulfillmentOrders,
    locationsSynced: countLocationsForShop(shopId),
  };
}

function transformOrderToPayloads(order, locationMap) {
  const lineItemMap = buildLineItemMap(order);
  const groups = new Map();

  for (const foEdge of order.fulfillmentOrders?.edges || []) {
    const fo = foEdge.node;
    const resolved = resolveLocalLocationId(fo.assignedLocation, locationMap);
    const groupKey = resolved.localId ?? '__unassigned__';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        shopify_order_id: order.id,
        order_name: order.name,
        order_date: order.createdAt,
        customer_name: order.customer?.displayName || '',
        assigned_location_id: resolved.localId,
        items: [],
      });
    }

    const group = groups.get(groupKey);

    for (const liEdge of fo.lineItems?.edges || []) {
      const foLineItem = liEdge.node;
      const remaining = foLineItem.remainingQuantity || 0;
      if (remaining <= 0) continue;

      const lineItemId = foLineItem.lineItem?.id;
      const lineItem = lineItemMap.get(lineItemId);
      if (!lineItem) continue;

      const options = lineItem.variant?.selectedOptions || [];
      const customAttributes = lineItem.customAttributes || [];

      group.items.push({
        shopify_line_item_id: lineItem.id,
        shopify_fulfillment_order_id: fo.id,
        title: lineItem.title,
        sku: lineItem.sku || '',
        variant_title: lineItem.variantTitle || '',
        image_url: lineItem.image?.url || '',
        quantity: remaining,
        options_json: JSON.stringify(options),
        metafields_json: customAttributes.length ? JSON.stringify(customAttributes) : null,
      });
    }
  }

  return [...groups.values()].filter((g) => g.items.length > 0);
}

function syncLocationsFromOrders(shopId, shopifyOrders, knownQueryLocationIds) {
  const assignedLocations = collectAssignedLocationsFromOrders(shopifyOrders);

  const debugEntries = [...assignedLocations.values()].map((item) => ({
    name: item.name,
    location_id: item.location_id,
    key: item.key,
  }));
  setLastFulfillmentLocations(debugEntries);
  console.log('[FulfillForge sync] Fulfillment assigned locations discovered:', debugEntries);

  for (const item of assignedLocations.values()) {
    upsertLocationFromAssignedLocation(shopId, item.assignedLocation, knownQueryLocationIds);
  }

  return assignedLocations;
}

function failSync(code, message, details = null, summary = null) {
  return { ok: false, code, message, details, summary };
}

function finishSync(shopId, result) {
  saveSyncLogFromResult(shopId, result);
  return result;
}

async function syncOrders() {
  const creds = validateCredentials();
  if (!creds.ok) {
    return finishSync(null, failSync(creds.code, creds.message));
  }

  let shopId = null;

  try {
    shopId = ensureConnectedShop({ updateCredentials: true });
    if (!shopId) {
      return finishSync(null, failSync('MISSING_CREDENTIALS', 'Shopify credentials are not configured.'));
    }

    const knownQueryLocationIds = new Set();
    const shopifyLocations = await fetchAllLocations();
    for (const loc of shopifyLocations) {
      upsertLocationFromShopifyQuery(shopId, loc, knownQueryLocationIds);
    }
    const locationsFromQuery = shopifyLocations.length;

    const shopifyOrders = await fetchAllOrders();
    const assignedLocations = syncLocationsFromOrders(shopId, shopifyOrders, knownQueryLocationIds);
    const locationSummary = buildLocationSummary(
      shopId,
      locationsFromQuery,
      assignedLocations,
      knownQueryLocationIds,
    );

    if (shopifyOrders.length === 0) {
      return finishSync(shopId, {
        ok: true,
        code: 'NO_ORDERS',
        message: NO_ORDERS_WARNING,
        summary: {
          shopifyOrders: 0,
          productionOrdersCreated: 0,
          productionOrdersUpdated: 0,
          itemsSynced: 0,
          ...locationSummary,
        },
      });
    }

    const locationMap = getLocationMap(shopId);
    const payloads = [];
    for (const order of shopifyOrders) {
      payloads.push(...transformOrderToPayloads(order, locationMap));
    }

    if (payloads.length === 0) {
      return finishSync(shopId, {
        ok: true,
        code: 'NO_PRODUCTION_ORDERS',
        message: `Found ${shopifyOrders.length} Shopify order(s), but none had fulfillable line items at known locations. Check fulfillment locations in Shopify.`,
        summary: {
          shopifyOrders: shopifyOrders.length,
          productionOrdersCreated: 0,
          productionOrdersUpdated: 0,
          itemsSynced: 0,
          ...locationSummary,
        },
      });
    }

    const stats = upsertFromSync(shopId, payloads);

    const summary = {
      shopifyOrders: shopifyOrders.length,
      productionOrdersCreated: stats.productionOrdersCreated,
      productionOrdersUpdated: stats.productionOrdersUpdated,
      itemsSynced: stats.itemsSynced,
      ...locationSummary,
    };

    return finishSync(shopId, {
      ok: true,
      code: 'SYNC_OK',
      message: `Sync complete — ${summary.shopifyOrders} Shopify order(s), ${summary.productionOrdersCreated} new and ${summary.productionOrdersUpdated} updated production order(s). ${summary.locationsSynced} location(s) total (${summary.locationsDiscoveredFromFulfillmentOrders} from fulfillment orders).`,
      summary,
    });
  } catch (err) {
    if (err instanceof ShopifySyncError) {
      return finishSync(shopId, failSync(err.code, err.message, err.details));
    }
    return finishSync(shopId, failSync('UNKNOWN_ERROR', err.message || 'Failed to sync orders from Shopify.'));
  }
}

module.exports = {
  syncOrders,
  NO_ORDERS_WARNING,
};
