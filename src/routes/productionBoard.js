const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { listOrdersForBoard } = require('../services/productionOrders');
const { listLocations } = require('../services/locations');
const { STATUSES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/production-board', (req, res, next) => {
  const { location } = req.query;
  const shopId = getCurrentShopId();

  const board = listOrdersForBoard({
    shopId,
    locationId: location ? Number(location) : undefined,
  });

  const locations = listLocations(shopId, { enabledOnly: true });

  let totalOrders = 0;
  let urgentCount = 0;
  let waitingMaterialCount = (board['Waiting Material'] || []).length;
  let doneCount = (board.Done || []).length;

  for (const status of STATUSES) {
    const cards = board[status] || [];
    totalOrders += cards.length;
    for (const card of cards) {
      if (card.priority === 'Urgent') urgentCount++;
    }
  }

  renderPage(res, 'productionBoard', {
    title: 'Production board',
    pageTitle: 'Production board',
    pageSubtitle: 'Manage production status across workflow columns.',
    activePage: 'board',
    board,
    locations,
    statuses: STATUSES,
    boardSummary: {
      totalOrders,
      urgent: urgentCount,
      waitingMaterial: waitingMaterialCount,
      done: doneCount,
    },
    filters: { location: location || '' },
  }, next);
});

module.exports = router;
