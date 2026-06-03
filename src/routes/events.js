const express = require('express');
const { getCurrentShopId } = require('../services/shops');
const { addClient, normalizeShopId } = require('../services/liveEvents');

const router = express.Router();

router.get('/events', (req, res) => {
  const shopId = normalizeShopId(getCurrentShopId());

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(': connected\n\n');
  res.write(`event: connected\ndata: ${JSON.stringify({ shopId, timestamp: new Date().toISOString() })}\n\n`);

  addClient(res, shopId);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

module.exports = router;
