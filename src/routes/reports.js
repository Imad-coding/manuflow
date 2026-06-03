const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { getReportsSummary, normalizeReportRange } = require('../services/reports');
const { STATUSES } = require('../db');
const { renderPage } = require('../utils/render');

const router = express.Router();

router.get('/reports', (req, res, next) => {
  const range = normalizeReportRange(req.query.range);
  const shopId = getCurrentShopId();
  const summary = getReportsSummary(shopId, range);

  renderPage(res, 'reports', {
    title: 'Reports',
    pageTitle: 'Reports',
    pageSubtitle: 'Production analytics and performance overview.',
    activePage: 'reports',
    summary,
    statuses: STATUSES,
    range,
  }, next);
});

module.exports = router;
