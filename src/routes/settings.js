const express = require('express');
const { listLocations } = require('../services/locations');
const { getConnectionInfo } = require('../shopify/client');
const { getCurrentShopContext, getDbSummary, clearDemoData, getDemoShopSummary } = require('../services/shops');
const { getLatestSyncLog, listRecentSyncLogs } = require('../services/syncLogs');
const { getLatestWebhookEvent, listRecentWebhookEvents } = require('../services/webhookEvents');
const {
  isCustomAppWebhookSecretConfigured,
  isManualWebhookSecretConfigured,
} = require('../shopify/webhookVerify');
const { getDueDateSettings } = require('../services/dueDateSettings');
const {
  listProductionRules,
  CONDITION_TYPES,
  OPERATORS,
  ACTION_TYPES,
} = require('../services/productionRules');
const { STATUSES, PRIORITIES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/settings', (req, res, next) => {
  const connection = getConnectionInfo();
  const shopContext = getCurrentShopContext();
  const locations = listLocations(shopContext.shopId);
  const latestSync = getLatestSyncLog(shopContext.shopId);
  const syncHistory = listRecentSyncLogs(shopContext.shopId, 5);
  const demoData = getDemoShopSummary();
  const webhookEnabled = process.env.SHOPIFY_WEBHOOK_ENABLED === 'true';
  const customAppWebhookSecretConfigured = isCustomAppWebhookSecretConfigured();
  const manualWebhookSecretConfigured = isManualWebhookSecretConfigured();
  const latestWebhook = getLatestWebhookEvent(shopContext.shopId);
  const webhookHistory = listRecentWebhookEvents(shopContext.shopId, 20);
  const appBaseUrl = process.env.APP_BASE_URL || 'https://fullfilforge.store';
  const dueDateSettings = getDueDateSettings(shopContext.shopId);
  const productionRules = listProductionRules(shopContext.shopId);

  renderPage(res, 'settings', {
    title: 'Settings',
    pageTitle: 'Settings',
    pageSubtitle: 'Shopify connection, sync, and fulfillment locations.',
    activePage: 'settings',
    locations,
    statuses: STATUSES,
    priorities: PRIORITIES,
    productionRules,
    ruleConditionTypes: CONDITION_TYPES,
    ruleOperators: OPERATORS,
    ruleActionTypes: ACTION_TYPES,
    shopifyConnected: connection.configured,
    connection,
    shopContext,
    latestSync,
    syncHistory,
    demoData,
    webhookEnabled,
    customAppWebhookSecretConfigured,
    manualWebhookSecretConfigured,
    latestWebhook,
    webhookHistory,
    appBaseUrl,
    dueDateSettings,
  }, next);
});
module.exports = router;
