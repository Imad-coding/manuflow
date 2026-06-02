const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { listOrdersForDashboard, formatProductsForCsv } = require('../services/productionOrders');
const { buildCsv } = require('../utils/csv');

const router = express.Router();

const CSV_HEADERS = [
  'Order Number',
  'Order Date',
  'Due Date',
  'Customer Name',
  'Products',
  'Item Count',
  'Total Quantity',
  'Assigned Location',
  'Production Status',
  'Priority',
  'Internal Notes',
];

function formatExportDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function rowToCsvValues(row) {
  return [
    row.order_name,
    formatExportDate(row.order_date),
    formatExportDate(row.due_date),
    row.customer_name || '',
    formatProductsForCsv(row.items),
    row.item_count ?? row.items?.length ?? 0,
    row.total_quantity ?? '',
    row.location_name || '',
    row.status || '',
    row.priority || '',
    row.internal_notes || '',
  ];
}

router.get('/export/production-orders.csv', (req, res) => {
  const { status, location, search, priority } = req.query;
  const shopId = getCurrentShopId();

  const rows = listOrdersForDashboard({
    shopId,
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
    priority: priority || undefined,
  });

  const csv = buildCsv(CSV_HEADERS, rows.map(rowToCsvValues));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="manuflow-production-orders.csv"');
  res.send(csv);
});

module.exports = router;
