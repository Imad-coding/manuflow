const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { listOrdersForDashboard, getDashboardOverviewCounts } = require('../services/productionOrders');
const { listLocations } = require('../services/locations');
const { STATUSES, PRIORITIES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/dashboard', (req, res, next) => {
  const { status, location, search, priority } = req.query;
  const shopId = getCurrentShopId();

  const rows = listOrdersForDashboard({
    shopId,
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
    priority: priority || undefined,
  });

  const totalItems = rows.reduce((sum, order) => sum + (order.items?.length || 0), 0);
  const first = rows[0];
  console.log('[dashboard] production orders:', rows.length, '| items attached:', totalItems, '| first order:', first ? `${first.id} (${first.items?.length || 0} items)` : 'none');

  const locations = listLocations(shopId, { enabledOnly: false });

  const hasFilters = Boolean(status || location || search || priority);

  const exportQuery = new URLSearchParams();
  if (status) exportQuery.set('status', status);
  if (location) exportQuery.set('location', location);
  if (search) exportQuery.set('search', search);
  if (priority) exportQuery.set('priority', priority);
  const exportUrl = `/export/production-orders.csv${exportQuery.toString() ? `?${exportQuery}` : ''}`;

  renderPage(res, 'dashboard', {
    title: 'Production orders',
    pageTitle: 'Production orders',
    pageSubtitle: 'Track Shopify orders through your production workflow.',
    activePage: 'dashboard',
    rows,
    locations,
    statuses: STATUSES,
    priorities: PRIORITIES,
    overview: getDashboardOverviewCounts(shopId),
    filters: { status: status || '', location: location || '', search: search || '', priority: priority || '' },
    hasFilters,
    exportUrl,
  }, next);
});

module.exports = router;
