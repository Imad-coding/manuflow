const { getDb } = require('../db');
const { getCurrentShopId } = require('./shops');
const { computeDueDateFromOrderDate } = require('../utils/dueDate');

const DEFAULT_SETTINGS = {
  auto_assign_enabled: true,
  default_lead_time_days: 3,
  use_business_days: true,
  skip_weekends: true,
};

function formatSettingsRow(row) {
  if (!row) return { ...DEFAULT_SETTINGS };

  return {
    auto_assign_enabled: Boolean(row.auto_assign_enabled),
    default_lead_time_days: row.default_lead_time_days,
    use_business_days: Boolean(row.use_business_days),
    skip_weekends: Boolean(row.skip_weekends),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureDueDateSettings(shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) return { ...DEFAULT_SETTINGS };

  const db = getDb();
  const existing = db.prepare('SELECT * FROM due_date_settings WHERE shop_id = ?').get(id);
  if (existing) return formatSettingsRow(existing);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO due_date_settings (
      shop_id, auto_assign_enabled, default_lead_time_days,
      use_business_days, skip_weekends, created_at, updated_at
    ) VALUES (?, 1, 3, 1, 1, ?, ?)
  `).run(id, now, now);

  return formatSettingsRow(db.prepare('SELECT * FROM due_date_settings WHERE shop_id = ?').get(id));
}

function getDueDateSettings(shopId) {
  return ensureDueDateSettings(shopId);
}

function updateDueDateSettings(shopId, input = {}) {
  const id = shopId ?? getCurrentShopId();
  if (!id) {
    throw new Error('No active shop context.');
  }

  ensureDueDateSettings(id);
  const current = getDueDateSettings(id);

  const autoAssignEnabled = input.auto_assign_enabled !== undefined
    ? Boolean(input.auto_assign_enabled)
    : current.auto_assign_enabled;

  let leadTimeDays = input.default_lead_time_days !== undefined
    ? Number(input.default_lead_time_days)
    : current.default_lead_time_days;

  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 365) {
    throw new Error('Default lead time must be a whole number between 0 and 365.');
  }

  const useBusinessDays = input.use_business_days !== undefined
    ? Boolean(input.use_business_days)
    : current.use_business_days;

  const skipWeekends = input.skip_weekends !== undefined
    ? Boolean(input.skip_weekends)
    : current.skip_weekends;

  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(`
    UPDATE due_date_settings
    SET auto_assign_enabled = ?,
        default_lead_time_days = ?,
        use_business_days = ?,
        skip_weekends = ?,
        updated_at = ?
    WHERE shop_id = ?
  `).run(
    autoAssignEnabled ? 1 : 0,
    leadTimeDays,
    useBusinessDays ? 1 : 0,
    skipWeekends ? 1 : 0,
    now,
    id,
  );

  return getDueDateSettings(id);
}

function resolveAutoDueDate(orderDate, shopId) {
  const settings = getDueDateSettings(shopId);
  if (!settings.auto_assign_enabled) return null;
  if (!orderDate) return null;

  return computeDueDateFromOrderDate(orderDate, settings);
}

module.exports = {
  DEFAULT_SETTINGS,
  getDueDateSettings,
  updateDueDateSettings,
  resolveAutoDueDate,
  computeDueDateFromOrderDate,
};
