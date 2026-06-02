const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { getOrderById } = require('../services/productionOrders');
const { STATUSES, PRIORITIES } = require('../db');
const { renderPage, renderStandalone } = require('../utils/render');

const router = express.Router();

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

router.get('/orders/:id', (req, res, next) => {  const order = getOrderById(Number(req.params.id), getCurrentShopId());

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
    activePage: 'dashboard',
    order,
    statuses: STATUSES,
    priorities: PRIORITIES,
  }, next);
});

module.exports = router;
