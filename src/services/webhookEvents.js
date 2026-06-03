const { getDb } = require('../db');

function recordWebhookEvent({
  shopId,
  webhookId,
  topic,
  shopDomain,
  route,
  status,
  message,
  hmacValid = null,
  matchedSecret = null,
  syncTriggered = 0,
  syncCompleted = 0,
}) {
  const db = getDb();

  if (webhookId) {
    const existing = db.prepare('SELECT id FROM webhook_events WHERE webhook_id = ?').get(webhookId);
    if (existing) {
      return { duplicate: true, id: existing.id };
    }
  }

  const result = db.prepare(`
    INSERT INTO webhook_events (
      shop_id, webhook_id, topic, shop_domain, route, status, message,
      hmac_valid, matched_secret, sync_triggered, sync_completed
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    shopId ?? null,
    webhookId || null,
    topic || null,
    shopDomain || null,
    route || null,
    status,
    message,
    hmacValid === null ? null : (hmacValid ? 1 : 0),
    matchedSecret || null,
    syncTriggered ? 1 : 0,
    syncCompleted ? 1 : 0,
  );

  return { duplicate: false, id: result.lastInsertRowid };
}

function updateWebhookEvent(eventId, fields) {
  if (!eventId) return null;

  const db = getDb();
  const sets = [];
  const params = [];

  if (fields.status !== undefined) {
    sets.push('status = ?');
    params.push(fields.status);
  }
  if (fields.message !== undefined) {
    sets.push('message = ?');
    params.push(fields.message);
  }
  if (fields.syncTriggered !== undefined) {
    sets.push('sync_triggered = ?');
    params.push(fields.syncTriggered ? 1 : 0);
  }
  if (fields.syncCompleted !== undefined) {
    sets.push('sync_completed = ?');
    params.push(fields.syncCompleted ? 1 : 0);
  }
  if (fields.hmacValid !== undefined) {
    sets.push('hmac_valid = ?');
    params.push(fields.hmacValid ? 1 : 0);
  }
  if (fields.matchedSecret !== undefined) {
    sets.push('matched_secret = ?');
    params.push(fields.matchedSecret);
  }

  if (sets.length === 0) return null;

  params.push(eventId);
  db.prepare(`UPDATE webhook_events SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(eventId);
}

function markWebhookEventsSyncTriggered(eventIds) {
  const db = getDb();
  for (const id of eventIds) {
    if (!id) continue;
    db.prepare(`
      UPDATE webhook_events
      SET sync_triggered = 1, status = 'sync_scheduled', message = 'Sync scheduled (same path as manual sync)'
      WHERE id = ?
    `).run(id);
  }
}

function markWebhookEventsSyncCompleted(eventIds, { ok, message }) {
  const db = getDb();
  for (const id of eventIds) {
    if (!id) continue;
    db.prepare(`
      UPDATE webhook_events
      SET sync_completed = ?, status = ?, message = ?
      WHERE id = ?
    `).run(
      ok ? 1 : 0,
      ok ? 'processed' : 'sync_failed',
      message || (ok ? 'Sync completed' : 'Sync failed'),
      id,
    );
  }
}

function formatWebhookEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    webhook_id: row.webhook_id,
    topic: row.topic,
    shop_domain: row.shop_domain,
    route: row.route,
    status: row.status,
    message: row.message,
    hmac_valid: row.hmac_valid === null ? null : row.hmac_valid === 1,
    matched_secret: row.matched_secret || null,
    sync_triggered: row.sync_triggered === 1,
    sync_completed: row.sync_completed === 1,
    created_at: row.created_at,
  };
}

function listRecentWebhookEvents(_shopId, limit = 20) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, shop_id, webhook_id, topic, shop_domain, route, status, message,
           hmac_valid, matched_secret, sync_triggered, sync_completed, created_at
    FROM webhook_events
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(limit);

  return rows.map(formatWebhookEvent);
}

function getLatestWebhookEvent(_shopId) {
  const rows = listRecentWebhookEvents(null, 1);
  return rows[0] || null;
}

module.exports = {
  recordWebhookEvent,
  updateWebhookEvent,
  markWebhookEventsSyncTriggered,
  markWebhookEventsSyncCompleted,
  formatWebhookEvent,
  listRecentWebhookEvents,
  getLatestWebhookEvent,
};
