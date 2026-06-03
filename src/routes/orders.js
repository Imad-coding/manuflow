const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const {
  getOrderById,
  parseBatchPrintIds,
  getOrdersByIds,
} = require('../services/productionOrders');
const { listActivityLogsForOrder, createActivityLog } = require('../services/activityLogs');
const { STATUSES, PRIORITIES } = require('../db');
const { renderPage, renderStandalone } = require('../utils/render');

const router = express.Router();

router.get('/orders/print-batch', (req, res, next) => {
  const shopId = getCurrentShopId();
  const requestedIds = parseBatchPrintIds(req.query.ids);
  const orders = getOrdersByIds(requestedIds, shopId);
  const printedAt = new Date().toISOString();

  if (orders.length === 0) {
    const message = requestedIds.length === 0
      ? 'No valid production order IDs were provided.'
      : 'None of the selected production orders were found for your shop.';

    return renderStandalone(res, 'printBatch', {
      title: 'Batch Print',
      empty: true,
      emptyHeading: 'No orders to print',
      message,
    }, next, 404);
  }

  for (const order of orders) {
    createActivityLog({
      shopId,
      productionOrderId: order.id,
      actor: 'User',
      action: 'batch_print_sheet_opened',
      message: 'Production sheet opened in batch print',
    });
  }

  renderStandalone(res, 'printBatch', {
    title: `Batch Print (${orders.length})`,
    orders,
    printedAt,
  }, next);
});

router.get('/orders/:id/print', (req, res, next) => {
  const order = getOrderById(Number(req.params.id), getCurrentShopId());

  if (!order) {
    return renderStandalone(res, 'printOrder', {
      title: 'Not Found',
      notFound: true,
      message: 'Production order not found.',
    }, next, 404);
  }

  renderStandalone(res, 'printOrder', {
    title: `Print ${order.order_name}`,
    order,
    printedAt: new Date().toISOString(),
  }, next);
});

router.get('/orders/:id', (req, res, next) => {
  const order = getOrderById(Number(req.params.id), getCurrentShopId());

  if (!order) {
    return renderPage(res, 'error', {
      title: 'Not Found',
      activePage: '',
      message: 'Production order not found.',
      statusCode: 404,
    }, next, 404);
  }

  renderPage(res, 'orderDetail', {
    title: order.order_name,
    pageTitle: order.order_name,
    pageSubtitle: order.customer_name || 'Production order',
    activePage: 'order',
    orderId: order.id,
    order,
    activityLogs: listActivityLogsForOrder(order.id),
    statuses: STATUSES,
    priorities: PRIORITIES,
  }, next);
});

module.exports = router;
