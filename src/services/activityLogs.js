const { getDb } = require('../db');

function createActivityLog({ shopId, productionOrderId, actor, action, message }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO activity_logs (shop_id, production_order_id, actor, action, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    shopId ?? null,
    productionOrderId ?? null,
    actor,
    action,
    message,
  );

  return {
    id: result.lastInsertRowid,
    shop_id: shopId,
    production_order_id: productionOrderId,
    actor,
    action,
    message,
    created_at: new Date().toISOString(),
  };
}

function listActivityLogsForOrder(productionOrderId, limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT id, shop_id, production_order_id, actor, action, message, created_at
    FROM activity_logs
    WHERE production_order_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(productionOrderId, limit);
}

function renderActivityLogHtml(logs) {
  if (!logs.length) {
    return '<p class="activity-log-empty">No activity recorded yet.</p>';
  }

  return logs.map((log) => {
    const time = log.created_at ? log.created_at.slice(0, 16).replace('T', ' ') : '';
    return `
      <div class="activity-log-item">
        <div class="activity-log-item__meta">
          <span class="activity-log-item__actor">${escapeHtml(log.actor)}</span>
          <span class="activity-log-item__time">${escapeHtml(time)}</span>
        </div>
        <p class="activity-log-item__message">${escapeHtml(log.message)}</p>
      </div>`;
  }).join('');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  createActivityLog,
  listActivityLogsForOrder,
  renderActivityLogHtml,
};
