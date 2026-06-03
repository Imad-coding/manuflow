const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDueDateInput(value) {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, message: 'Due date must be a string in YYYY-MM-DD format.' };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!DATE_PATTERN.test(trimmed)) {
    return { ok: false, message: 'Invalid due date. Use YYYY-MM-DD format.' };
  }

  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { ok: false, message: 'Invalid due date. That calendar date does not exist.' };
  }

  return { ok: true, value: trimmed };
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDueDateState(dueDate) {
  if (!dueDate) return 'none';

  const normalized = String(dueDate).slice(0, 10);
  if (!DATE_PATTERN.test(normalized)) return 'future';

  const today = todayDateString();
  if (normalized === today) return 'today';
  if (normalized < today) return 'overdue';
  return 'future';
}

function parseOrderDateToLocalDate(orderDate) {
  const str = String(orderDate || '').slice(0, 10);
  if (!DATE_PATTERN.test(str)) {
    return new Date();
  }

  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addCalendarDays(startDate, days) {
  const result = new Date(startDate);
  result.setDate(result.getDate() + days);
  return result;
}

function bumpOffWeekend(date) {
  const result = new Date(date);
  while (isWeekend(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

function addBusinessDays(startDate, businessDays) {
  const result = new Date(startDate);
  let added = 0;
  const target = Math.max(0, Number(businessDays) || 0);

  while (added < target) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result)) {
      added += 1;
    }
  }

  return result;
}

function computeDueDateFromOrderDate(orderDate, settings = {}) {
  const leadDays = Math.max(0, Math.min(365, Number(settings.default_lead_time_days) || 0));
  const start = parseOrderDateToLocalDate(orderDate);
  let due;

  if (settings.use_business_days) {
    due = addBusinessDays(start, leadDays);
    if (settings.skip_weekends && isWeekend(due)) {
      due = bumpOffWeekend(due);
    }
  } else {
    due = addCalendarDays(start, leadDays);
    if (settings.skip_weekends) {
      due = bumpOffWeekend(due);
    }
  }

  return formatDateString(due);
}

module.exports = {
  parseDueDateInput,
  getDueDateState,
  todayDateString,
  parseOrderDateToLocalDate,
  formatDateString,
  computeDueDateFromOrderDate,
};
