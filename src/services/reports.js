const { getDb, STATUSES } = require('../db');
const { getCurrentShopId } = require('./shops');
const { formatProductsForCsv } = require('./productionOrders');

const REPORT_RANGES = ['today', '7d', '30d'];

function getTodayDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeReportRange(range) {
  if (range === '7d' || range === '30d') return range;
  return 'today';
}

function getRangeLabel(range) {
  if (range === '7d') return 'Last 7 days';
  if (range === '30d') return 'Last 30 days';
  return 'Today';
}

function getCompletedPeriodFilter(range, today) {
  if (range === '7d') {
    return {
      sql: ` AND date(po.production_status_updated_at) >= date(?, '-6 days')`,
      params: [today],
    };
  }
  if (range === '30d') {
    return {
      sql: ` AND date(po.production_status_updated_at) >= date(?, '-29 days')`,
      params: [today],
    };
  }
  return {
    sql: ` AND date(po.production_status_updated_at) = date(?)`,
    params: [today],
  };
}

function emptyReportsSummary(range = 'today') {
  const statusCounts = {};
  for (const status of STATUSES) statusCounts[status] = 0;

  return {
    range,
    rangeLabel: getRangeLabel(range),
    activeOrders: 0,
    overdueOrders: 0,
    dueToday: 0,
    urgentOrders: 0,
    waitingMaterial: 0,
    completedToday: 0,
    packedThisWeek: 0,
    statusCounts,
    locationCounts: [],
    overdueOrdersList: [],
    dueTodayList: [],
    completedTodayList: [],
  };
}

function listReportOrdersWithItems(db, shopId, whereSql, params, orderBySql) {
  const rows = db.prepare(`
    SELECT
      po.id,
      po.order_name,
      po.customer_name,
      po.due_date,
      po.priority,
      po.status,
      po.production_status_updated_at,
      l.name AS location_name,
      pi.id AS item_id,
      pi.title AS item_title,
      pi.sku AS item_sku,
      pi.variant_title AS item_variant_title,
      pi.quantity AS item_quantity,
      pi.options_json AS item_options_json
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    LEFT JOIN production_items pi ON pi.production_order_id = po.id
    WHERE po.shop_id = ? ${whereSql}
    ORDER BY ${orderBySql}, pi.id ASC
  `).all(shopId, ...params);

  const orderMap = new Map();

  for (const row of rows) {
    if (!orderMap.has(row.id)) {
      orderMap.set(row.id, {
        id: row.id,
        order_name: row.order_name,
        customer_name: row.customer_name || '',
        due_date: row.due_date,
        priority: row.priority,
        status: row.status,
        production_status_updated_at: row.production_status_updated_at,
        location_name: row.location_name || 'Unassigned / Unknown',
        items: [],
      });
    }

    if (row.item_id != null) {
      let options = [];
      try {
        options = row.item_options_json ? JSON.parse(row.item_options_json) : [];
      } catch {
        options = [];
      }

      const variantLabel = options.length
        ? options.map((o) => o.value).join(' / ')
        : (row.item_variant_title || '');

      orderMap.get(row.id).items.push({
        title: row.item_title,
        sku: row.item_sku || '',
        variant_label: variantLabel,
        quantity: row.item_quantity,
        options,
      });
    }
  }

  return Array.from(orderMap.values()).map((order) => ({
    ...order,
    products_summary: formatProductsForCsv(order.items),
  }));
}

function getReportsSummary(shopId, range = 'today') {
  const id = shopId ?? getCurrentShopId();
  const normalizedRange = normalizeReportRange(range);
  const today = getTodayDateString();

  if (!id) return emptyReportsSummary(normalizedRange);

  const db = getDb();
  const activeWhere = 'shop_id = ? AND archived = 0';

  const activeOrders = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders WHERE ${activeWhere}
  `).get(id).count;

  const overdueOrders = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders
    WHERE ${activeWhere}
      AND due_date IS NOT NULL
      AND date(due_date) < date(?)
      AND status NOT IN ('Done', 'Packed')
  `).get(id, today).count;

  const dueToday = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders
    WHERE ${activeWhere}
      AND due_date IS NOT NULL
      AND date(due_date) = date(?)
  `).get(id, today).count;

  const urgentOrders = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders
    WHERE ${activeWhere} AND priority = 'Urgent'
  `).get(id).count;

  const waitingMaterial = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders
    WHERE ${activeWhere} AND status = 'Waiting Material'
  `).get(id).count;

  const completedFilter = getCompletedPeriodFilter(normalizedRange, today);
  const completedToday = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders po
    WHERE po.shop_id = ? AND po.archived = 0
      AND po.status IN ('Done', 'Packed')
      ${completedFilter.sql}
  `).get(id, ...completedFilter.params).count;

  const packedThisWeek = db.prepare(`
    SELECT COUNT(*) AS count FROM production_orders
    WHERE ${activeWhere}
      AND status = 'Packed'
      AND production_status_updated_at IS NOT NULL
      AND date(production_status_updated_at) >= date(?, '-6 days')
  `).get(id, today).count;

  const statusCounts = {};
  for (const status of STATUSES) statusCounts[status] = 0;

  const statusRows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM production_orders
    WHERE ${activeWhere}
    GROUP BY status
  `).all(id);

  for (const row of statusRows) {
    if (Object.prototype.hasOwnProperty.call(statusCounts, row.status)) {
      statusCounts[row.status] = row.count;
    }
  }

  const locationCounts = db.prepare(`
    SELECT
      po.assigned_location_id AS location_id,
      COALESCE(l.name, 'Unassigned / Unknown') AS location_name,
      COUNT(*) AS count
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    WHERE po.shop_id = ? AND po.archived = 0
    GROUP BY po.assigned_location_id, l.name
    ORDER BY count DESC, location_name ASC
  `).all(id).map((row) => ({
    location_id: row.location_id,
    location_name: row.location_name,
    count: row.count,
  }));

  const overdueOrdersList = listReportOrdersWithItems(
    db,
    id,
    `AND po.archived = 0
      AND po.due_date IS NOT NULL
      AND date(po.due_date) < date(?)
      AND po.status NOT IN ('Done', 'Packed')`,
    [today],
    `date(po.due_date) ASC,
      CASE po.priority
        WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 WHEN 'Low' THEN 4 ELSE 5
      END,
      po.order_name ASC`
  );

  const dueTodayList = listReportOrdersWithItems(
    db,
    id,
    `AND po.archived = 0
      AND po.due_date IS NOT NULL
      AND date(po.due_date) = date(?)`,
    [today],
    `CASE po.priority
        WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 WHEN 'Low' THEN 4 ELSE 5
      END,
      po.order_name ASC`
  );

  const completedTodayList = listReportOrdersWithItems(
    db,
    id,
    `AND po.archived = 0
      AND po.status IN ('Done', 'Packed')
      ${completedFilter.sql.replace(/po\./g, 'po.')}`,
    completedFilter.params,
    `po.production_status_updated_at DESC, po.order_name ASC`
  );

  return {
    range: normalizedRange,
    rangeLabel: getRangeLabel(normalizedRange),
    activeOrders,
    overdueOrders,
    dueToday,
    urgentOrders,
    waitingMaterial,
    completedToday,
    packedThisWeek,
    statusCounts,
    locationCounts,
    overdueOrdersList,
    dueTodayList,
    completedTodayList,
  };
}

module.exports = {
  REPORT_RANGES,
  normalizeReportRange,
  getRangeLabel,
  getReportsSummary,
};
