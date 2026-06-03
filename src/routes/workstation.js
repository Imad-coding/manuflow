const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { listWorkstationOrders } = require('../services/productionOrders');
const { listLocations } = require('../services/locations');
const { STATUSES, PRIORITIES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/workstation', (req, res, next) => {
  const { status, location, search, priority } = req.query;
  const shopId = getCurrentShopId();

  const orders = listWorkstationOrders({
    shopId,
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
    priority: priority || undefined,
  });

  const locations = listLocations(shopId, { enabledOnly: true });
  const hasFilters = Boolean(status || location || search || priority);

  renderPage(res, 'workstation', {
    title: 'Workstation',
    pageTitle: 'Workstation',
    pageSubtitle: 'Focused view for production teams.',
    activePage: 'workstation',
    orders,
    locations,
    statuses: STATUSES,
    priorities: PRIORITIES,
    filters: {
      status: status || '',
      location: location || '',
      search: search || '',
      priority: priority || '',
    },
    hasFilters,
  }, next);
});

module.exports = router;
