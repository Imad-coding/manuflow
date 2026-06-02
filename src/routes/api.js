const express = require('express');
const { syncOrders } = require('../shopify/syncOrders');
const { getDbSummary, clearDemoData } = require('../services/shops');
const {
  listProductionOrdersJson,
  updateStatus,
  updatePriority,
  updateNotes,
  updateDueDate,
  bulkUpdateProductionOrders,
} = require('../services/productionOrders');
const { toggleLocation } = require('../services/locations');

const router = express.Router();

router.get('/debug/db-summary', (req, res) => {
  res.json({ ok: true, data: getDbSummary() });
});
router.post('/demo-data/clear', (req, res) => {
  const result = clearDemoData();
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/sync/orders', async (req, res) => {
  const result = await syncOrders();
  res.json(result);
});

router.get('/production-orders', (req, res) => {
  const { status, location, search } = req.query;

  const data = listProductionOrdersJson({
    status: status || undefined,
    locationId: location ? Number(location) : undefined,
    search: search || undefined,
  });

  res.json({ ok: true, data });
});

router.patch('/production-orders/bulk', (req, res) => {
  try {
    const { ids, action, value } = req.body;
    const result = bulkUpdateProductionOrders(ids, action, value);
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
    const order = updateStatus(Number(req.params.id), req.body.status);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }
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
  res.json({ ok: true, data: order });
});

router.patch('/production-orders/:id/due-date', (req, res) => {
  try {
    const order = updateDueDate(Number(req.params.id), req.body.due_date);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Production order not found.' });
    }
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
  res.json({ ok: true, data: location });
});

module.exports = router;
