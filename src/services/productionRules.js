const { getDb, STATUSES, PRIORITIES } = require('../db');
const { getCurrentShopId } = require('./shops');
const { createActivityLog } = require('./activityLogs');
const { computeDueDateFromOrderDate } = require('../utils/dueDate');

const CONDITION_TYPES = ['sku', 'product_title', 'location_name', 'customer_name', 'order_name'];
const OPERATORS = ['contains', 'starts_with', 'equals'];
const ACTION_TYPES = ['set_priority', 'set_due_days', 'add_internal_note', 'set_status'];

function formatRule(row) {
  if (!row) return null;

  return {
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    condition_type: row.condition_type,
    condition_operator: row.condition_operator,
    condition_value: row.condition_value,
    action_type: row.action_type,
    action_value: row.action_value,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateRuleInput(input, { partial = false } = {}) {
  const errors = [];

  if (!partial || input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) errors.push('Rule name is required.');
  }

  if (!partial || input.condition_type !== undefined) {
    if (!CONDITION_TYPES.includes(input.condition_type)) {
      errors.push(`Condition type must be one of: ${CONDITION_TYPES.join(', ')}`);
    }
  }

  if (!partial || input.condition_operator !== undefined) {
    if (!OPERATORS.includes(input.condition_operator)) {
      errors.push(`Operator must be one of: ${OPERATORS.join(', ')}`);
    }
  }

  if (!partial || input.condition_value !== undefined) {
    if (!String(input.condition_value || '').trim()) {
      errors.push('Condition value is required.');
    }
  }

  if (!partial || input.action_type !== undefined) {
    if (!ACTION_TYPES.includes(input.action_type)) {
      errors.push(`Action type must be one of: ${ACTION_TYPES.join(', ')}`);
    }
  }

  if (!partial || input.action_value !== undefined) {
    if (!String(input.action_value || '').trim()) {
      errors.push('Action value is required.');
    }
  }

  if (input.action_type === 'set_priority' && input.action_value !== undefined) {
    if (!PRIORITIES.includes(input.action_value)) {
      errors.push(`Priority must be one of: ${PRIORITIES.join(', ')}`);
    }
  }

  if (input.action_type === 'set_status' && input.action_value !== undefined) {
    if (!STATUSES.includes(input.action_value)) {
      errors.push(`Status must be one of: ${STATUSES.join(', ')}`);
    }
  }

  if (input.action_type === 'set_due_days' && input.action_value !== undefined) {
    const days = Number(input.action_value);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      errors.push('Due days must be a whole number between 0 and 365.');
    }
  }

  if (errors.length) {
    throw new Error(errors.join(' '));
  }
}

function listProductionRules(shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) return [];

  const rows = getDb().prepare(`
    SELECT * FROM production_rules
    WHERE shop_id = ?
    ORDER BY enabled DESC, name ASC, id ASC
  `).all(id);

  return rows.map(formatRule);
}

function getProductionRule(ruleId, shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) return null;

  const row = getDb().prepare(`
    SELECT * FROM production_rules WHERE id = ? AND shop_id = ?
  `).get(ruleId, id);

  return formatRule(row);
}

function createProductionRule(shopId, input) {
  const id = shopId ?? getCurrentShopId();
  if (!id) throw new Error('No active shop context.');

  validateRuleInput(input);

  const now = new Date().toISOString();
  const result = getDb().prepare(`
    INSERT INTO production_rules (
      shop_id, name, enabled, condition_type, condition_operator, condition_value,
      action_type, action_value, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(input.name).trim(),
    input.enabled === false ? 0 : 1,
    input.condition_type,
    input.condition_operator,
    String(input.condition_value).trim(),
    input.action_type,
    String(input.action_value).trim(),
    now,
    now,
  );

  return getProductionRule(result.lastInsertRowid, id);
}

function updateProductionRule(ruleId, shopId, input) {
  const id = shopId ?? getCurrentShopId();
  if (!id) throw new Error('No active shop context.');

  const existing = getProductionRule(ruleId, id);
  if (!existing) return null;

  validateRuleInput({ ...existing, ...input }, { partial: true });

  const next = {
    name: input.name !== undefined ? String(input.name).trim() : existing.name,
    enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    condition_type: input.condition_type ?? existing.condition_type,
    condition_operator: input.condition_operator ?? existing.condition_operator,
    condition_value: input.condition_value !== undefined
      ? String(input.condition_value).trim()
      : existing.condition_value,
    action_type: input.action_type ?? existing.action_type,
    action_value: input.action_value !== undefined
      ? String(input.action_value).trim()
      : existing.action_value,
  };

  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE production_rules
    SET name = ?, enabled = ?, condition_type = ?, condition_operator = ?, condition_value = ?,
        action_type = ?, action_value = ?, updated_at = ?
    WHERE id = ? AND shop_id = ?
  `).run(
    next.name,
    next.enabled,
    next.condition_type,
    next.condition_operator,
    next.condition_value,
    next.action_type,
    next.action_value,
    now,
    ruleId,
    id,
  );

  return getProductionRule(ruleId, id);
}

function deleteProductionRule(ruleId, shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) return false;

  const result = getDb().prepare(`
    DELETE FROM production_rules WHERE id = ? AND shop_id = ?
  `).run(ruleId, id);

  return result.changes > 0;
}

function matchOperator(fieldValue, operator, conditionValue) {
  const field = String(fieldValue || '').toLowerCase();
  const cond = String(conditionValue || '').toLowerCase();

  if (operator === 'equals') return field === cond;
  if (operator === 'starts_with') return field.startsWith(cond);
  if (operator === 'contains') return field.includes(cond);
  return false;
}

function ruleMatches(rule, context) {
  const { order, items } = context;

  switch (rule.condition_type) {
    case 'sku':
      return items.some((item) => matchOperator(item.sku, rule.condition_operator, rule.condition_value));
    case 'product_title':
      return items.some((item) => matchOperator(item.title, rule.condition_operator, rule.condition_value));
    case 'location_name':
      return matchOperator(order.location_name, rule.condition_operator, rule.condition_value);
    case 'customer_name':
      return matchOperator(order.customer_name, rule.condition_operator, rule.condition_value);
    case 'order_name':
      return matchOperator(order.order_name, rule.condition_operator, rule.condition_value);
    default:
      return false;
  }
}

function getOrderContextForRules(orderId, shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) return null;

  const order = getDb().prepare(`
    SELECT po.*, l.name AS location_name
    FROM production_orders po
    LEFT JOIN locations l ON l.id = po.assigned_location_id
    WHERE po.id = ? AND po.shop_id = ?
  `).get(orderId, id);

  if (!order) return null;

  const items = getDb().prepare(`
    SELECT title, sku FROM production_items WHERE production_order_id = ? ORDER BY id ASC
  `).all(orderId);

  return { order, items };
}

function canApplyAction(actionType, order, { manualApply = false } = {}) {
  if (!manualApply) return true;

  switch (actionType) {
    case 'set_due_days':
      return !order.due_date;
    case 'set_priority':
      return order.priority === 'Normal';
    case 'set_status':
      return order.status === 'New';
    case 'add_internal_note':
      return true;
    default:
      return true;
  }
}

function applyRuleAction(db, order, rule, { manualApply = false } = {}) {
  if (!canApplyAction(rule.action_type, order, { manualApply })) {
    return { applied: false, skipped: true, message: null };
  }

  switch (rule.action_type) {
    case 'set_priority': {
      if (!PRIORITIES.includes(rule.action_value)) {
        return { applied: false, skipped: false, message: 'Invalid priority value.' };
      }
      db.prepare(`
        UPDATE production_orders
        SET priority = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rule.action_value, order.id);
      return { applied: true, skipped: false, message: `set priority to ${rule.action_value}` };
    }
    case 'set_status': {
      if (!STATUSES.includes(rule.action_value)) {
        return { applied: false, skipped: false, message: 'Invalid status value.' };
      }
      db.prepare(`
        UPDATE production_orders
        SET status = ?, production_status_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rule.action_value, order.id);
      return { applied: true, skipped: false, message: `set status to ${rule.action_value}` };
    }
    case 'set_due_days': {
      const days = Number(rule.action_value);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        return { applied: false, skipped: false, message: 'Invalid due days value.' };
      }
      const dueDate = computeDueDateFromOrderDate(order.order_date, {
        default_lead_time_days: days,
        use_business_days: true,
        skip_weekends: true,
      });
      db.prepare(`
        UPDATE production_orders
        SET due_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(dueDate, order.id);
      return { applied: true, skipped: false, message: `set due date to ${dueDate}` };
    }
    case 'add_internal_note': {
      const note = String(rule.action_value || '').trim();
      if (!note) {
        return { applied: false, skipped: false, message: 'Empty note value.' };
      }
      const current = order.internal_notes || '';
      if (current.includes(note)) {
        return { applied: false, skipped: true, message: null };
      }
      const updated = current ? `${current}\n${note}` : note;
      db.prepare(`
        UPDATE production_orders
        SET internal_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updated, order.id);
      order.internal_notes = updated;
      return { applied: true, skipped: false, message: 'added internal note' };
    }
    default:
      return { applied: false, skipped: false, message: 'Unknown action type.' };
  }
}

function applyProductionRulesToOrder(orderId, shopId, options = {}) {
  const id = shopId ?? getCurrentShopId();
  const context = getOrderContextForRules(orderId, id);
  if (!context) {
    return { applied: 0, skipped: 0, errors: 1, details: [] };
  }

  const rules = listProductionRules(id).filter((rule) => rule.enabled);
  const db = getDb();
  let applied = 0;
  let skipped = 0;
  let errors = 0;
  const details = [];

  for (const rule of rules) {
    if (!ruleMatches(rule, context)) {
      continue;
    }

    const result = applyRuleAction(db, context.order, rule, options);
    if (result.applied) {
      applied += 1;
      createActivityLog({
        shopId: id,
        productionOrderId: orderId,
        actor: 'System',
        action: 'production_rule_applied',
        message: `Rule '${rule.name}' applied: ${result.message}`,
      });
      details.push({ ruleId: rule.id, ruleName: rule.name, result: result.message });
      context.order = getOrderContextForRules(orderId, id).order;
    } else if (result.skipped) {
      skipped += 1;
    } else if (result.message) {
      errors += 1;
      details.push({ ruleId: rule.id, ruleName: rule.name, error: result.message });
    }
  }

  return { applied, skipped, errors, details };
}

function applyProductionRulesToExistingOrders(shopId) {
  const id = shopId ?? getCurrentShopId();
  if (!id) {
    throw new Error('No active shop context.');
  }

  const orderIds = getDb().prepare(`
    SELECT id FROM production_orders
    WHERE shop_id = ? AND archived = 0
    ORDER BY id ASC
  `).all(id).map((row) => row.id);

  let rulesApplied = 0;
  let skipped = 0;
  let errors = 0;

  for (const orderId of orderIds) {
    const result = applyProductionRulesToOrder(orderId, id, { manualApply: true });
    rulesApplied += result.applied;
    skipped += result.skipped;
    errors += result.errors;
  }

  return {
    ok: true,
    ordersChecked: orderIds.length,
    rulesApplied,
    skipped,
    errors,
    message: `Checked ${orderIds.length} order(s). Applied ${rulesApplied} rule action(s).`,
  };
}

module.exports = {
  CONDITION_TYPES,
  OPERATORS,
  ACTION_TYPES,
  listProductionRules,
  getProductionRule,
  createProductionRule,
  updateProductionRule,
  deleteProductionRule,
  applyProductionRulesToOrder,
  applyProductionRulesToExistingOrders,
  ruleMatches,
  matchOperator,
};
