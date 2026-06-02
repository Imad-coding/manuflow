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

module.exports = {
  parseDueDateInput,
  getDueDateState,
  todayDateString,
};
