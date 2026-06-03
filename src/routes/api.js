const express = require('express');
const { syncOrders } = require('../shopify/syncOrders');
const { getDbSummary, clearDemoData, getCurrentShopId } = require('../services/shops');
const {
  listProductionOrdersJson,
  listOrdersForBoard,
  getOrderById,
  updateStatus,
  updatePriority,
  updateNotes,
  updateDueDate,
  updateArchived,
  bulkUpdateProductionOrders,
  getDashboardOverviewCounts,
  listWorkstationOrders,
} = require('../services/productionOrders');
const { listActivityLogsForOrder } = require('../services/activityLogs');
const { toggleLocation } = require('../services/locations');
const {
  getWebhookSubscriptions,
  registerCustomAppWebhooks,
  validateWebhookRegistrationConfig,
} = require('../shopify/webhooks');
const { getReportsSummary, normalizeReportRange } = require('../services/reports');
const { getDueDateSettings, updateDueDateSettings } = require('../services/dueDateSettings');
const {
  listProductionRules,
  createProductionRule,
  updateProductionRule,
  deleteProductionRule,
  applyProductionRulesToExistingOrders,
  CONDITION_TYPES,
  OPERATORS,
  ACTION_TYPES,
} = require('../services/productionRules');
const { runWebhookPipelineSelfTest } = require('../services/webhookSync');
const {
  broadcastOrderUpdated,
  broadcastOrdersChanged,
  broadcastSyncCompleted,
  broadcastSyncFailed,
  normalizeShopId,
  getConnectedClientCount,
} = require('../services/liveEvents');

const router = express.Router();

function shopId() {
  return getCurrentShopId();
}

router.get('/debug/db-summary', (req, res) => {
  res.json({ ok: true, data: getDbSummary() });
});

router.post('/demo-data/clear', (req, res) => {
  const result = clearDemoData();
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/sync/orders', async (req, res) => {
  const result = await syncOrders();
  const id = shopId();

  if (result.ok) {
    broadcastSyncCompleted(id, {
      reason: 'manual_sync',
      message: result.message,
      summary: result.summary || null,
    });
    broadcastOrdersChanged(id, 'manual_sync', { orderCountChanged: true });
  } else {
    broadcastSyncFailed(id, result.message);
  }

  res.json(result);
});

router.get('/workstation/orders', (req, res) => {
  const { status, location, search, priority } = req.query;

  const data = listWorkstationOrders({
    shopId: shopId(),
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
    priority: priority || undefined,
  });

  res.json({ ok: true, data, count: data.length });
});

router.get('/production-orders', (req, res) => {
  const { status, location, search, priority, archive } = req.query;

  const data = listProductionOrdersJson({
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
    priority: priority || undefined,
    archive: archive || undefined,
  });

  res.json({ ok: true, data });
});

router.get('/production-orders/:id', (req, res) => {
  const order = getOrderById(Number(req.params.id), shopId());
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Production order not found.' });
  }

  const activityLogs = listActivityLogsForOrder(order.id);

  res.json({ ok: true, data: { order, activityLogs } });
});

router.get('/production-board', (req, res) => {
  const { location } = req.query;
  const board = listOrdersForBoard({
    locationId: location ? Number(location) : undefined,
  });

  res.json({ ok: true, data: board });
});

router.get('/dashboard/overview', (req, res) => {
  res.json({ ok: true, data: getDashboardOverviewCounts(shopId()) });
});

router.get('/reports/summary', (req, res) => {
  const range = normalizeReportRange(req.query.range);
  const summary = getReportsSummary(shopId(), range);
  res.json({ ok: true, data: summary });
});

router.get('/due-date-settings', (req, res) => {
  res.json({ ok: true, data: getDueDateSettings(shopId()) });
});

router.patch('/due-date-settings', (req, res) => {
  try {
    const data = updateDueDateSettings(shopId(), req.body);
    res.json({ ok: true, data, message: 'Due date settings saved.' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.get('/production-rules', (req, res) => {
  res.json({ ok: true, data: listProductionRules(shopId()) });
});

router.post('/production-rules', (req, res) => {
  try {
    const rule = createProductionRule(shopId(), req.body);
    res.status(201).json({ ok: true, data: rule, message: 'Production rule created.' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-rules/:id', (req, res) => {
  try {
    const rule = updateProductionRule(Number(req.params.id), shopId(), req.body);
    if (!rule) {
      return res.status(404).json({ ok: false, message: 'Production rule not found.' });
    }
    res.json({ ok: true, data: rule, message: 'Production rule updated.' });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.delete('/production-rules/:id', (req, res) => {
  const deleted = deleteProductionRule(Number(req.params.id), shopId());
  if (!deleted) {
    return res.status(404).json({ ok: false, message: 'Production rule not found.' });
  }
  res.json({ ok: true, message: 'Production rule deleted.' });
});

router.post('/production-rules/apply-existing', (req, res) => {
  try {
    const result = applyProductionRulesToExistingOrders(shopId());
    const id = shopId();
    broadcastOrdersChanged(id, 'production_rules_applied');
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-orders/bulk', (req, res) => {
  try {
    const { ids, action, value } = req.body;
    const result = bulkUpdateProductionOrders(ids, action, value);
    const id = shopId();

    const broadcastReason = action === 'archive'
      ? (value ? 'archived' : 'unarchived')
      : `bulk_${action}`;

    for (const orderId of ids) {
      broadcastOrderUpdated(id, Number(orderId), broadcastReason);
    }
    broadcastOrdersChanged(id, broadcastReason);

    res.json({
      ok: true,
      updated: result.updated,
      requested: result.requested,
      action: result.action,
      value: result.value,
      message: `Updated ${result.updated} production order(s).`,
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-orders/:id/status', (req, res) => {
  try {
    const order = updateStatus(Number(req.params.id), req.body.status, shopId(), {
      actor: req.body.actor || 'User',
    });
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }

    const id = shopId();
    broadcastOrderUpdated(id, order.id, 'status');
    broadcastOrdersChanged(id, 'status');

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-orders/:id/priority', (req, res) => {
  try {
    const order = updatePriority(Number(req.params.id), req.body.priority);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }

    const sid = shopId();
    broadcastOrderUpdated(sid, order.id, 'priority');
    broadcastOrdersChanged(sid, 'priority');

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-orders/:id/notes', (req, res) => {
  const order = updateNotes(Number(req.params.id), req.body.internal_notes);
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Production order not found.' });
  }

  const id = shopId();
  broadcastOrderUpdated(id, order.id, 'notes');

  res.json({ ok: true, data: order });
});

router.patch('/production-orders/:id/due-date', (req, res) => {
  try {
    const order = updateDueDate(Number(req.params.id), req.body.due_date);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }

    const id = shopId();
    broadcastOrderUpdated(id, order.id, 'due_date');
    broadcastOrdersChanged(id, 'due_date');

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/production-orders/:id/archive', (req, res) => {
  try {
    if (typeof req.body.archived !== 'boolean') {
      return res.status(400).json({ ok: false, message: 'archived must be true or false.' });
    }

    const order = updateArchived(Number(req.params.id), req.body.archived, shopId());
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }

    const id = shopId();
    const reason = req.body.archived ? 'archived' : 'unarchived';
    broadcastOrderUpdated(id, order.id, reason);
    broadcastOrdersChanged(id, reason);

    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

router.patch('/locations/:id', (req, res) => {
  const location = toggleLocation(Number(req.params.id), Boolean(req.body.enabled));
  if (!location) {
    return res.status(404).json({ ok: false, message: 'Location not found.' });
  }

  broadcastOrdersChanged(shopId(), 'location_toggle');

  res.json({ ok: true, data: location });
});

router.get('/shopify/webhooks', async (req, res) => {
  const config = validateWebhookRegistrationConfig();
  if (!config.ok) {
    return res.status(400).json({ ok: false, message: config.message, data: [] });
  }

  try {
    const subscriptions = await getWebhookSubscriptions();
    res.json({ ok: true, data: subscriptions });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message || 'Failed to list webhooks.', data: [] });
  }
});

router.post('/shopify/webhooks/register', async (req, res) => {
  const config = validateWebhookRegistrationConfig();
  if (!config.ok) {
    return res.status(400).json({
      ok: false,
      message: config.message,
      created: [],
      existing: [],
      failed: [],
    });
  }

  try {
    const result = await registerCustomAppWebhooks();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({
      ok: false,
      message: err.message || 'Failed to register webhooks.',
      created: [],
      existing: [],
      failed: [],
    });
  }
});

router.post('/shopify/webhooks/self-test', async (req, res) => {
  try {
    const result = await runWebhookPipelineSelfTest();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Self-test failed.' });
  }
});

router.post('/dev/broadcast-test', (req, res) => {
  const id = normalizeShopId(shopId());
  const timestamp = new Date().toISOString();

  broadcastOrdersChanged(id, 'shopify_webhook', { timestamp });
  broadcastSyncCompleted(id, {
    reason: 'shopify_webhook',
    timestamp,
    message: 'Test live update broadcast sent',
  });

  res.json({
    ok: true,
    message: 'Broadcast sent',
    shopId: id,
    clients: getConnectedClientCount(id),
  });
});

module.exports = router;
