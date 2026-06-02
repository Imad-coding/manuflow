const express = require('express');
const { listLocations } = require('../services/locations');
const { getConnectionInfo } = require('../shopify/client');
const { getCurrentShopContext, getDbSummary, clearDemoData, getDemoShopSummary } = require('../services/shops');
const { getLatestSyncLog, listRecentSyncLogs } = require('../services/syncLogs');
const { STATUSES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/settings', (req, res, next) => {
  const connection = getConnectionInfo();
  const shopContext = getCurrentShopContext();
  const locations = listLocations(shopContext.shopId);
  const latestSync = getLatestSyncLog(shopContext.shopId);
  const syncHistory = listRecentSyncLogs(shopContext.shopId, 5);
  const demoData = getDemoShopSummary();

  renderPage(res, 'settings', {
    title: 'Settings',
    pageTitle: 'Settings',
    pageSubtitle: 'Shopify connection, sync, and fulfillment locations.',
    activePage: 'settings',
    locations,
    statuses: STATUSES,
    shopifyConnected: connection.configured,
    connection,
    shopContext,
    latestSync,
    syncHistory,
    demoData,
  }, next);
});
module.exports = router;
