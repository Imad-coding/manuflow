const { getDb, STATUSES, PRIORITIES } = require('../db');
const { getCurrentShopId } = require('./shops');
const { parseDueDateInput } = require('../utils/dueDate');
const { createActivityLog } = require('./activityLogs');
const { resolveAutoDueDate } = require('./dueDateSettings');
const { applyProductionRulesToOrder } = require('./productionRules');

const ARCHIVE_FILTERS = ['active', 'archived', 'all'];

function normalizeArchiveFilter(archive) {
  if (!archive || archive === 'active') return 'active';
  if (archive === 'archived' || archive === 'all') return archive;
  return 'active';
}

function buildArchiveFilterSql(archive) {
  const mode = normalizeArchiveFilter(archive);
  if (mode === 'active') return { sql: ' AND po.archived = 0', params: [] };
  if (mode === 'archived') return { sql: ' AND po.archived = 1', params: [] };
  return { sql: '', params: [] };
}

function buildDashboardOrderFilters({ status, locationId, search, priority, archive } = {}) {
  let sql = '';
  const params = [];

  const archiveFilter = buildArchiveFilterSql(archive);
  sql += archiveFilter.sql;
  params.push(...archiveFilter.params);

  if (status) {
    sql += ' AND po.status = ?';
    params.push(status);
  }

  if (locationId) {
    sql += ' AND po.assigned_location_id = ?';
    params.push(locationId);
  }

  if (priority) {
    sql += ' AND po.priority = ?';
    params.push(priority);
  }

  if (search) {
    sql += ` AND (
      po.order_name LIKE ? OR po.customer_name LIKE ? OR
      EXISTS (
        SELECT 1 FROM production_items pi
        WHERE pi.production_order_id = po.id
          AND (pi.sku LIKE ? OR pi.title LIKE ?)
      )
    )`;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  return { sql, params };
}

function normalizeId(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listOrdersForDashboard({ shopId, status, locationId, search, priority, archive } = {}) {
  const db = getDb();
  const id = shopId ?? getCurrentShopId();
  if (!id) return [];

  const filters = buildDashboardOrderFilters({ status, locationId, search, priority, archive });

  const rows = db.prepare(`
    SELECT
      po.id,
      po.shop_id,
      po.shopify_order_id,
      po.order_name,
      po.order_date,
      po.customer_name,
      po.assigned_location_id,
      po.status,
      po.priority,
      po.due_date,
      po.internal_notes,
      po.production_status_updated_at,
      po.archived,
      po.archived_at,
      po.created_at,
      po.updated_at,
      l.name AS location_name,
      l.id AS location_id,
      pi.id AS item_id,
      pi.title AS item_title,
      pi.sku AS item_sku,
      pi.variant_title AS item_variant_title,
      pi.image_url AS item_image_url,
      pi.quantity AS item_quantity,
      pi.options_json AS item_options_json,
      pi.metafields_json AS item_metafields_json
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    LEFT JOIN production_items pi ON pi.production_order_id = po.id
    WHERE po.shop_id = ?
    ${filters.sql}
    ORDER BY po.order_date DESC, po.id DESC, pi.id ASC
  `).all(id, ...filters.params);

  const orderMap = new Map();

  for (const row of rows) {
    const orderId = normalizeId(row.id);
    if (orderId === null) continue;

    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, formatDashboardOrder(row, []));
    }

    if (row.item_id != null) {
      orderMap.get(orderId).items.push(formatDashboardItemFromJoin(row));
    }
  }

  return Array.from(orderMap.values());
}

/** @deprecated Use listOrdersForDashboard — one row per production order */
function listItemsForDashboard(filters) {
  return listOrdersForDashboard(filters);
}

function listProductionOrdersJson({ shopId, status, locationId, search, priority, archive } = {}) {
  const db = getDb();
  const id = shopId ?? getCurrentShopId();
  if (!id) return [];

  let sql = `
    SELECT po.*, l.name AS location_name
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    WHERE po.shop_id = ?
  `;
  const params = [id];

  const archiveFilter = buildArchiveFilterSql(archive);
  sql += archiveFilter.sql;
  params.push(...archiveFilter.params);

  if (status) {
    sql += ' AND po.status = ?';
    params.push(status);
  }
  if (locationId) {
    sql += ' AND po.assigned_location_id = ?';
    params.push(locationId);
  }
  if (priority) {
    sql += ' AND po.priority = ?';
    params.push(priority);
  }
  if (search) {
    sql += ` AND (
      po.order_name LIKE ? OR po.customer_name LIKE ? OR
      EXISTS (SELECT 1 FROM production_items pi WHERE pi.production_order_id = po.id AND (pi.sku LIKE ? OR pi.title LIKE ?))
    )`;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  sql += ' ORDER BY po.order_date DESC, po.id DESC';

  const orders = db.prepare(sql).all(...params);
  const itemsStmt = db.prepare('SELECT * FROM production_items WHERE production_order_id = ?');

  return orders.map((order) => ({
    ...formatOrder(order),
    location_name: order.location_name,
    items: itemsStmt.all(order.id).map(formatItem),
  }));
}

function getOrderById(orderId, shopId) {
  const db = getDb();
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const order = db.prepare(`
    SELECT po.*, l.name AS location_name
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    WHERE po.id = ? AND po.shop_id = ?
  `).get(orderId, currentShopId);

  if (!order) return null;

  const items = db.prepare(`
    SELECT * FROM production_items WHERE production_order_id = ? ORDER BY id ASC
  `).all(orderId);

  return {
    ...formatOrder(order),
    location_name: order.location_name,
    items: items.map(formatItem),
  };
}

function parseBatchPrintIds(raw) {
  if (!raw || typeof raw !== 'string') return [];

  return [...new Set(
    raw.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number(part))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
}

function getOrdersByIds(orderIds, shopId) {
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(orderIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const orders = [];

  for (const id of uniqueIds) {
    const order = getOrderById(id, currentShopId);
    if (order) orders.push(order);
  }

  return orders;
}

function updateStatus(id, status, shopId, options = {}) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const db = getDb();
  const existing = db.prepare(`
    SELECT status FROM production_orders WHERE id = ? AND shop_id = ?
  `).get(id, currentShopId);

  if (!existing) return null;

  const result = db.prepare(`
    UPDATE production_orders
    SET status = ?, production_status_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(status, id, currentShopId);

  if (result.changes === 0) return null;

  if (existing.status !== status) {
    createActivityLog({
      shopId: currentShopId,
      productionOrderId: id,
      actor: options.actor || 'User',
      action: 'status_changed',
      message: `Status changed from ${existing.status} to ${status}`,
    });
  }

  return getOrderById(id, currentShopId);
}

function updatePriority(id, priority, shopId) {
  if (!PRIORITIES.includes(priority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }

  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const db = getDb();
  const result = db.prepare(`
    UPDATE production_orders SET priority = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(priority, id, currentShopId);

  if (result.changes === 0) return null;
  return getOrderById(id, currentShopId);
}

function updateNotes(id, notes, shopId) {
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const db = getDb();
  const result = db.prepare(`
    UPDATE production_orders SET internal_notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(notes || '', id, currentShopId);

  if (result.changes === 0) return null;
  return getOrderById(id, currentShopId);
}

function updateDueDate(id, dueDateRaw, shopId) {
  const parsed = parseDueDateInput(dueDateRaw);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const db = getDb();
  const result = db.prepare(`
    UPDATE production_orders SET due_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(parsed.value, id, currentShopId);

  if (result.changes === 0) return null;
  return getOrderById(id, currentShopId);
}

function updateArchived(id, archived, shopId) {
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) return null;

  const archivedFlag = archived ? 1 : 0;
  const archivedAt = archived ? new Date().toISOString() : null;

  const db = getDb();
  const result = db.prepare(`
    UPDATE production_orders
    SET archived = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_id = ?
  `).run(archivedFlag, archivedAt, id, currentShopId);

  if (result.changes === 0) return null;

  createActivityLog({
    shopId: currentShopId,
    productionOrderId: id,
    actor: 'User',
    action: archived ? 'order_archived' : 'order_unarchived',
    message: archived ? 'Order archived' : 'Order unarchived',
  });

  return getOrderById(id, currentShopId);
}

function bulkUpdateProductionOrders(ids, action, value, shopId) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('ids must be a non-empty array of production order IDs.');
  }

  const numericIds = ids.map((id) => Number(id));
  if (numericIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('ids must contain only valid numeric production order IDs.');
  }

  const uniqueIds = [...new Set(numericIds)];

  if (action !== 'status' && action !== 'priority' && action !== 'archive') {
    throw new Error('action must be "status", "priority", or "archive".');
  }

  if (action === 'archive' && typeof value !== 'boolean') {
    throw new Error('value must be true or false when action is "archive".');
  }

  if (action === 'status' && !STATUSES.includes(value)) {
    throw new Error(`Invalid status. Allowed: ${STATUSES.join(', ')}`);
  }

  if (action === 'priority' && !PRIORITIES.includes(value)) {
    throw new Error(`Invalid priority. Allowed: ${PRIORITIES.join(', ')}`);
  }

  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId) {
    throw new Error('No active shop context.');
  }

  const db = getDb();
  const placeholders = uniqueIds.map(() => '?').join(', ');

  if (action === 'archive') {
    const archivedFlag = value ? 1 : 0;
    const archivedAt = value ? new Date().toISOString() : null;
    const result = db.prepare(`
      UPDATE production_orders
      SET archived = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ? AND id IN (${placeholders})
    `).run(archivedFlag, archivedAt, currentShopId, ...uniqueIds);

    for (const orderId of uniqueIds) {
      createActivityLog({
        shopId: currentShopId,
        productionOrderId: orderId,
        actor: 'User',
        action: value ? 'bulk_archived' : 'bulk_unarchived',
        message: value ? 'Bulk archived' : 'Bulk unarchived',
      });
    }

    return {
      updated: result.changes,
      requested: uniqueIds.length,
      action,
      value,
    };
  }

  if (action === 'status') {
    const result = db.prepare(`
      UPDATE production_orders
      SET status = ?, production_status_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ? AND id IN (${placeholders})
    `).run(value, currentShopId, ...uniqueIds);

    return {
      updated: result.changes,
      requested: uniqueIds.length,
      action,
      value,
    };
  }

  const result = db.prepare(`
    UPDATE production_orders
    SET priority = ?, updated_at = CURRENT_TIMESTAMP
    WHERE shop_id = ? AND id IN (${placeholders})
  `).run(value, currentShopId, ...uniqueIds);

  return {
    updated: result.changes,
    requested: uniqueIds.length,
    action,
    value,
  };
}

function listOrdersForBoard({ shopId, locationId } = {}) {
  const db = getDb();
  const id = shopId ?? getCurrentShopId();
  if (!id) return {};

  let sql = `
    SELECT po.*, l.name AS location_name
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    WHERE po.shop_id = ?
  `;
  const params = [id];

  if (locationId) {
    sql += ' AND po.assigned_location_id = ?';
    params.push(locationId);
  } else {
    sql += ' AND (l.enabled = 1 OR po.assigned_location_id IS NULL)';
  }

  sql += ' AND po.archived = 0';

  sql += ` ORDER BY CASE po.priority
    WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 WHEN 'Low' THEN 4 ELSE 5
  END, po.order_date ASC`;

  const orders = db.prepare(sql).all(...params);
  const itemsStmt = db.prepare('SELECT * FROM production_items WHERE production_order_id = ? ORDER BY id ASC');

  const board = {};
  for (const status of STATUSES) {
    board[status] = [];
  }

  for (const order of orders) {
    const items = itemsStmt.all(order.id);
    const primary = items[0] || {};
    board[order.status]?.push({
      ...formatOrder(order),
      location_name: order.location_name,
      primary_title: primary.title || 'No items',
      primary_sku: primary.sku || '—',
      primary_quantity: primary.quantity || 0,
      item_count: items.length,
      items: items.map(formatItem),
    });
  }

  return board;
}

function upsertFromSync(shopId, orderPayloads) {
  const db = getDb();

  const findOrder = db.prepare(`
    SELECT id, status, priority, internal_notes, due_date, archived, archived_at
    FROM production_orders
    WHERE shop_id = ? AND shopify_order_id = ? AND assigned_location_id = ?
  `);

  const insertOrder = db.prepare(`
    INSERT INTO production_orders (
      shop_id, shopify_order_id, order_name, order_date, customer_name,
      assigned_location_id, status, priority, due_date, internal_notes,
      production_status_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  const updateOrder = db.prepare(`
    UPDATE production_orders
    SET order_name = ?, order_date = ?, customer_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const assignDueDate = db.prepare(`
    UPDATE production_orders
    SET due_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const findItem = db.prepare(`
    SELECT id FROM production_items
    WHERE production_order_id = ? AND shopify_line_item_id = ? AND shopify_fulfillment_order_id = ?
  `);

  const insertItem = db.prepare(`
    INSERT INTO production_items (
      production_order_id, shopify_line_item_id, shopify_fulfillment_order_id,
      title, sku, variant_title, image_url, quantity, options_json, metafields_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  const updateItem = db.prepare(`
    UPDATE production_items
    SET title = ?, sku = ?, variant_title = ?, image_url = ?, quantity = ?,
        options_json = ?, metafields_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let productionOrdersCreated = 0;
  let productionOrdersUpdated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;

  function logAutoDueDate(orderId, dueDate) {
    createActivityLog({
      shopId,
      productionOrderId: orderId,
      actor: 'System',
      action: 'due_date_auto_assigned',
      message: `Due date automatically set to ${dueDate}`,
    });
  }

  const syncTransaction = db.transaction((payloads) => {
    for (const payload of payloads) {
      const existing = findOrder.get(
        shopId,
        payload.shopify_order_id,
        payload.assigned_location_id
      );

      let orderId;
      let isNewOrder = false;

      if (existing) {
        updateOrder.run(
          payload.order_name,
          payload.order_date,
          payload.customer_name,
          existing.id
        );
        orderId = existing.id;
        productionOrdersUpdated++;

        if (!existing.due_date) {
          const autoDueDate = resolveAutoDueDate(payload.order_date, shopId);
          if (autoDueDate) {
            assignDueDate.run(autoDueDate, existing.id);
            logAutoDueDate(existing.id, autoDueDate);
          }
        }
      } else {
        isNewOrder = true;
        const autoDueDate = resolveAutoDueDate(payload.order_date, shopId);
        const result = insertOrder.run(
          shopId,
          payload.shopify_order_id,
          payload.order_name,
          payload.order_date,
          payload.customer_name,
          payload.assigned_location_id,
          'New',
          'Normal',
          autoDueDate,
          '',
        );
        orderId = result.lastInsertRowid;
        productionOrdersCreated++;

        if (autoDueDate) {
          logAutoDueDate(orderId, autoDueDate);
        }
      }

      for (const item of payload.items) {
        const existingItem = findItem.get(
          orderId,
          item.shopify_line_item_id,
          item.shopify_fulfillment_order_id
        );

        if (existingItem) {
          updateItem.run(
            item.title,
            item.sku,
            item.variant_title,
            item.image_url,
            item.quantity,
            item.options_json,
            item.metafields_json,
            existingItem.id
          );
          itemsUpdated++;
        } else {
          insertItem.run(
            orderId,
            item.shopify_line_item_id,
            item.shopify_fulfillment_order_id,
            item.title,
            item.sku,
            item.variant_title,
            item.image_url,
            item.quantity,
            item.options_json,
            item.metafields_json
          );
          itemsCreated++;
        }
      }

      if (isNewOrder) {
        applyProductionRulesToOrder(orderId, shopId, { manualApply: false });
      }
    }
  });

  syncTransaction(orderPayloads);
  return {
    productionOrdersCreated,
    productionOrdersUpdated,
    itemsCreated,
    itemsUpdated,
    itemsSynced: itemsCreated + itemsUpdated,
  };
}

function formatVariantLabel(options, variantTitle) {
  if (options && options.length) {
    return options.map((o) => o.value).join(' / ');
  }
  return variantTitle || '';
}

function parseItemOptions(optionsJson) {
  try {
    return optionsJson ? JSON.parse(optionsJson) : [];
  } catch {
    return [];
  }
}

function formatDashboardItem(row) {
  const options = parseItemOptions(row.options_json);

  return {
    id: normalizeId(row.id),
    title: row.title,
    sku: row.sku || '',
    variant_title: row.variant_title || '',
    image_url: row.image_url || null,
    quantity: row.quantity,
    options_json: row.options_json || null,
    metafields_json: row.metafields_json || null,
    options,
    variant_label: formatVariantLabel(options, row.variant_title),
  };
}

function formatDashboardItemFromJoin(row) {
  const options = parseItemOptions(row.item_options_json);

  return {
    id: normalizeId(row.item_id),
    title: row.item_title,
    sku: row.item_sku || '',
    variant_title: row.item_variant_title || '',
    image_url: row.item_image_url || null,
    quantity: row.item_quantity,
    options_json: row.item_options_json || null,
    metafields_json: row.item_metafields_json || null,
    options,
    variant_label: formatVariantLabel(options, row.item_variant_title),
  };
}

function formatDashboardOrder(orderRow, items) {
  const orderId = normalizeId(orderRow.id);

  return {
    id: orderId,
    production_order_id: orderId,
    shop_id: orderRow.shop_id,
    shopify_order_id: orderRow.shopify_order_id,
    order_name: orderRow.order_name,
    order_date: orderRow.order_date,
    customer_name: orderRow.customer_name || '',
    assigned_location_id: orderRow.assigned_location_id,
    location_name: orderRow.location_name || 'Unassigned / Unknown',
    location_id: orderRow.location_id,
    status: orderRow.status,
    priority: orderRow.priority,
    due_date: orderRow.due_date,
    internal_notes: orderRow.internal_notes || '',
    production_status_updated_at: orderRow.production_status_updated_at,
    archived: Boolean(orderRow.archived),
    archived_at: orderRow.archived_at || null,
    item_count: items.length,
    total_quantity: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    items,
  };
}

function formatProductsForCsv(items) {
  if (!items || items.length === 0) return '';

  return items.map((item) => {
    const skuPart = item.sku ? item.sku : 'No SKU';
    const variantPart = item.variant_label ? `, ${item.variant_label}` : '';
    return `${item.title} (${skuPart}${variantPart}, Qty ${item.quantity})`;
  }).join('; ');
}

function formatOrder(row) {
  return {
    id: row.id,
    shop_id: row.shop_id,
    shopify_order_id: row.shopify_order_id,
    order_name: row.order_name,
    order_date: row.order_date,
    customer_name: row.customer_name,
    assigned_location_id: row.assigned_location_id,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    internal_notes: row.internal_notes,
    production_status_updated_at: row.production_status_updated_at,
    archived: Boolean(row.archived),
    archived_at: row.archived_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatItem(row) {
  let options = [];
  let metafields = null;
  try {
    options = row.options_json ? JSON.parse(row.options_json) : [];
  } catch {
    options = [];
  }
  try {
    metafields = row.metafields_json ? JSON.parse(row.metafields_json) : null;
  } catch {
    metafields = null;
  }

  return {
    id: row.id,
    production_order_id: row.production_order_id,
    shopify_line_item_id: row.shopify_line_item_id,
    shopify_fulfillment_order_id: row.shopify_fulfillment_order_id,
    title: row.title,
    sku: row.sku,
    variant_title: row.variant_title,
    image_url: row.image_url,
    quantity: row.quantity,
    options,
    metafields,
  };
}

function handleShopifyOrderCancelled(shopifyOrderGid, shopId) {
  const currentShopId = shopId ?? getCurrentShopId();
  if (!currentShopId || !shopifyOrderGid) return 0;

  const db = getDb();
  const orders = db.prepare(`
    SELECT id FROM production_orders
    WHERE shop_id = ? AND shopify_order_id = ?
  `).all(currentShopId, shopifyOrderGid);

  const { createActivityLog } = require('./activityLogs');

  for (const order of orders) {
    createActivityLog({
      shopId: currentShopId,
      productionOrderId: order.id,
      actor: 'Shopify Webhook',
      action: 'order_cancelled',
      message: 'Order cancelled in Shopify',
    });
  }

  return orders.length;
}

function getDashboardOverviewCounts(shopId) {
  const db = getDb();
  const id = shopId ?? getCurrentShopId();
  if (!id) {
    return { newOrders: 0, inProduction: 0, waitingMaterial: 0, done: 0, urgent: 0 };
  }

  const rows = db.prepare(`
    SELECT status, priority, COUNT(*) AS count
    FROM production_orders
    WHERE shop_id = ? AND archived = 0
    GROUP BY status, priority
  `).all(id);

  const counts = { newOrders: 0, inProduction: 0, waitingMaterial: 0, done: 0, urgent: 0 };

  for (const row of rows) {
    if (row.status === 'New') counts.newOrders += row.count;
    if (row.status === 'In Production') counts.inProduction += row.count;
    if (row.status === 'Waiting Material') counts.waitingMaterial += row.count;
    if (row.status === 'Done') counts.done += row.count;
    if (row.priority === 'Urgent') counts.urgent += row.count;
  }

  return counts;
}

function listWorkstationOrders({ shopId, status, locationId, search, priority } = {}) {
  return listOrdersForDashboard({
    shopId,
    status,
    locationId,
    search,
    priority,
    archive: 'active',
  });
}

module.exports = {
  listOrdersForDashboard,
  listItemsForDashboard,
  formatProductsForCsv,
  listProductionOrdersJson,
  getOrderById,
  parseBatchPrintIds,
  getOrdersByIds,
  updateStatus,
  updatePriority,
  updateNotes,
  updateDueDate,
  updateArchived,
  bulkUpdateProductionOrders,
  listOrdersForBoard,
  upsertFromSync,
  getDashboardOverviewCounts,
  listWorkstationOrders,
  handleShopifyOrderCancelled,
  ARCHIVE_FILTERS,
  normalizeArchiveFilter,
  STATUSES,
  PRIORITIES,
};
