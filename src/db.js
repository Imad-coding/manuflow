const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { getConnectionInfo } = require('./shopify/client');

const STATUSES = ['New', 'In Production', 'Waiting Material', 'Done', 'Packed'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

let db;

function getDbPath() {
  return process.env.SQLITE_DATABASE_PATH || './data/manuflow.sqlite3';
}

function createDatabase(dbPath) {
  const database = new DatabaseSync(dbPath);

  database.pragma = (setting) => {
    database.exec(`PRAGMA ${setting}`);
  };

  database.transaction = (fn) => (...args) => {
    database.exec('BEGIN');
    try {
      fn(...args);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  };

  return database;
}

function initSchema(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL UNIQUE,
      access_token TEXT,
      installed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      shopify_location_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(shop_id, shopify_location_id)
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      shopify_order_id TEXT NOT NULL,
      order_name TEXT NOT NULL,
      order_date TEXT NOT NULL,
      customer_name TEXT,
      assigned_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'New',
      priority TEXT NOT NULL DEFAULT 'Normal',
      due_date TEXT,
      internal_notes TEXT,
      production_status_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(shop_id, shopify_order_id, assigned_location_id)
    );

    CREATE TABLE IF NOT EXISTS production_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
      shopify_line_item_id TEXT NOT NULL,
      shopify_fulfillment_order_id TEXT,
      title TEXT NOT NULL,
      sku TEXT,
      variant_title TEXT,
      image_url TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      options_json TEXT,
      metafields_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(production_order_id, shopify_line_item_id, shopify_fulfillment_order_id)
    );

    CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
    CREATE INDEX IF NOT EXISTS idx_production_orders_assigned_location_id ON production_orders(assigned_location_id);
    CREATE INDEX IF NOT EXISTS idx_production_orders_order_date ON production_orders(order_date);
    CREATE INDEX IF NOT EXISTS idx_production_items_sku ON production_items(sku);

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      message TEXT NOT NULL,
      orders_found INTEGER NOT NULL DEFAULT 0,
      production_orders_created INTEGER NOT NULL DEFAULT 0,
      production_orders_updated INTEGER NOT NULL DEFAULT 0,
      items_synced INTEGER NOT NULL DEFAULT 0,
      locations_synced INTEGER NOT NULL DEFAULT 0,
      discovered_locations_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sync_logs_shop_id ON sync_logs(shop_id);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);
  `);

  migrateSchema(database);
}

function migrateSchema(database) {
  const columns = database.prepare('PRAGMA table_info(locations)').all();
  const columnNames = new Set(columns.map((col) => col.name));

  if (!columnNames.has('source')) {
    database.exec(`
      ALTER TABLE locations ADD COLUMN source TEXT NOT NULL DEFAULT 'shopify_location_query'
    `);
  }
  if (!columnNames.has('is_third_party')) {
    database.exec(`
      ALTER TABLE locations ADD COLUMN is_third_party INTEGER NOT NULL DEFAULT 0
    `);
  }
  if (!columnNames.has('raw_json')) {
    database.exec(`
      ALTER TABLE locations ADD COLUMN raw_json TEXT
    `);
  }

  const syncLogColumns = database.prepare('PRAGMA table_info(sync_logs)').all();
  const syncLogColumnNames = new Set(syncLogColumns.map((col) => col.name));

  if (!syncLogColumnNames.has('discovered_locations_synced')) {
    database.exec(`
      ALTER TABLE sync_logs ADD COLUMN discovered_locations_synced INTEGER NOT NULL DEFAULT 0
    `);
  }
}

function seedDemoData(database) {
  const now = new Date().toISOString();
  const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const daysAgo = (n) => daysFromNow(-n);

  const insertShop = database.prepare(`
    INSERT INTO shops (shop_domain, access_token, installed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const shopResult = insertShop.run(
    'demo-store.myshopify.com',
    null,
    now,
    now,
    now
  );
  const shopId = shopResult.lastInsertRowid;

  const insertLocation = database.prepare(`
    INSERT INTO locations (shop_id, shopify_location_id, name, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const locMain = insertLocation.run(shopId, 'gid://shopify/Location/1001', 'Main Workshop', 1, now, now).lastInsertRowid;
  const locAssembly = insertLocation.run(shopId, 'gid://shopify/Location/1002', 'Assembly Bay', 1, now, now).lastInsertRowid;
  const locStorage = insertLocation.run(shopId, 'gid://shopify/Location/1003', 'Storage', 0, now, now).lastInsertRowid;

  const insertOrder = database.prepare(`
    INSERT INTO production_orders (
      shop_id, shopify_order_id, order_name, order_date, customer_name,
      assigned_location_id, status, priority, due_date, internal_notes,
      production_status_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = database.prepare(`
    INSERT INTO production_items (
      production_order_id, shopify_line_item_id, shopify_fulfillment_order_id,
      title, sku, variant_title, image_url, quantity, options_json, metafields_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoOrders = [
    {
      shopifyOrderId: 'gid://shopify/Order/5001',
      orderName: '#1042',
      orderDate: daysAgo(2),
      customer: 'Sarah Mitchell',
      locationId: locMain,
      status: 'In Production',
      priority: 'High',
      dueDate: daysFromNow(3),
      notes: 'Rush order — customer requested expedited shipping.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9001', foId: 'gid://shopify/FulfillmentOrder/7001', title: 'Handcrafted Oak Dining Table', sku: 'OAK-TBL-001', variant: 'Natural / 72"', qty: 1, options: [{ name: 'Finish', value: 'Natural' }, { name: 'Size', value: '72"' }] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5001',
      orderName: '#1042',
      orderDate: daysAgo(2),
      customer: 'Sarah Mitchell',
      locationId: locAssembly,
      status: 'Waiting Material',
      priority: 'High',
      dueDate: daysFromNow(3),
      notes: 'Chair components waiting on fabric delivery.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9002', foId: 'gid://shopify/FulfillmentOrder/7002', title: 'Upholstered Dining Chair', sku: 'CHR-UPH-002', variant: 'Charcoal / Set of 4', qty: 4, options: [{ name: 'Color', value: 'Charcoal' }] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5002',
      orderName: '#1043',
      orderDate: daysAgo(1),
      customer: 'James Chen',
      locationId: locMain,
      status: 'New',
      priority: 'Normal',
      dueDate: daysFromNow(7),
      notes: '',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9003', foId: 'gid://shopify/FulfillmentOrder/7003', title: 'Walnut Bookshelf', sku: 'WLN-BKS-003', variant: '5-Tier', qty: 1, options: [] },
        { lineItemId: 'gid://shopify/LineItem/9004', foId: 'gid://shopify/FulfillmentOrder/7003', title: 'Desk Lamp — Brass', sku: 'LMP-BRS-004', variant: 'Standard', qty: 2, options: [] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5003',
      orderName: '#1044',
      orderDate: daysAgo(5),
      customer: 'Emily Rodriguez',
      locationId: locAssembly,
      status: 'Done',
      priority: 'Normal',
      dueDate: daysAgo(1),
      notes: 'Quality check passed.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9005', foId: 'gid://shopify/FulfillmentOrder/7004', title: 'Custom Kitchen Island', sku: 'KIT-ISL-005', variant: 'White Quartz Top', qty: 1, options: [{ name: 'Top', value: 'White Quartz' }] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5004',
      orderName: '#1045',
      orderDate: daysAgo(3),
      customer: 'Michael Torres',
      locationId: locMain,
      status: 'Packed',
      priority: 'Low',
      dueDate: daysAgo(2),
      notes: 'Ready for pickup.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9006', foId: 'gid://shopify/FulfillmentOrder/7005', title: 'Floating Wall Shelf Set', sku: 'SHL-FLT-006', variant: 'Set of 3', qty: 1, options: [] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5005',
      orderName: '#1046',
      orderDate: daysAgo(0),
      customer: 'Anna Kowalski',
      locationId: locAssembly,
      status: 'New',
      priority: 'Urgent',
      dueDate: daysFromNow(1),
      notes: 'VIP customer — prioritize.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9007', foId: 'gid://shopify/FulfillmentOrder/7006', title: 'Executive Standing Desk', sku: 'DSK-EXE-007', variant: 'Mahogany / Electric', qty: 1, options: [{ name: 'Wood', value: 'Mahogany' }, { name: 'Lift', value: 'Electric' }] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5006',
      orderName: '#1047',
      orderDate: daysAgo(4),
      customer: 'David Park',
      locationId: locMain,
      status: 'In Production',
      priority: 'Normal',
      dueDate: daysFromNow(5),
      notes: '',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9008', foId: 'gid://shopify/FulfillmentOrder/7007', title: 'Bed Frame — Queen', sku: 'BED-QN-008', variant: 'Rustic Pine', qty: 1, options: [] },
        { lineItemId: 'gid://shopify/LineItem/9009', foId: 'gid://shopify/FulfillmentOrder/7007', title: 'Nightstand Pair', sku: 'NSD-PR-009', variant: 'Matching Pine', qty: 1, options: [] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5007',
      orderName: '#1048',
      orderDate: daysAgo(6),
      customer: 'Lisa Nguyen',
      locationId: locAssembly,
      status: 'Waiting Material',
      priority: 'High',
      dueDate: daysFromNow(2),
      notes: 'Waiting on hardware shipment.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9010', foId: 'gid://shopify/FulfillmentOrder/7008', title: 'Modular Closet System', sku: 'CLS-MOD-010', variant: '8ft Wall', qty: 1, options: [] },
      ],
    },
    {
      shopifyOrderId: 'gid://shopify/Order/5008',
      orderName: '#1049',
      orderDate: daysAgo(7),
      customer: 'Robert Walsh',
      locationId: locStorage,
      status: 'New',
      priority: 'Low',
      dueDate: daysFromNow(14),
      notes: 'Storage location — disabled by default.',
      items: [
        { lineItemId: 'gid://shopify/LineItem/9011', foId: 'gid://shopify/FulfillmentOrder/7009', title: 'Garage Workbench', sku: 'WB-GAR-011', variant: 'Heavy Duty', qty: 1, options: [] },
      ],
    },
  ];

  const seedTransaction = database.transaction(() => {
    for (const order of demoOrders) {
      const orderId = insertOrder.run(
        shopId,
        order.shopifyOrderId,
        order.orderName,
        order.orderDate,
        order.customer,
        order.locationId,
        order.status,
        order.priority,
        order.dueDate,
        order.notes,
        now,
        now,
        now
      ).lastInsertRowid;

      for (const item of order.items) {
        insertItem.run(
          orderId,
          item.lineItemId,
          item.foId,
          item.title,
          item.sku,
          item.variant,
          `https://picsum.photos/seed/${encodeURIComponent(item.sku)}/80/80`,
          item.qty,
          JSON.stringify(item.options),
          null,
          now,
          now
        );
      }
    }
  });

  seedTransaction();
}

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
    db = createDatabase(dbPath);
    initSchema(db);

    const orderCount = db.prepare('SELECT COUNT(*) AS count FROM production_orders').get().count;
    if (orderCount === 0 && !getConnectionInfo().configured) {
      seedDemoData(db);
    }
  }
  return db;
}

function getDefaultShopId() {
  const { getCurrentShopId } = require('./services/shops');
  return getCurrentShopId();
}

module.exports = {
  getDb,
  getDefaultShopId,
  STATUSES,
  PRIORITIES,
};
