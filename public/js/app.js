/* ManuFlow client helpers */

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `app-toast${isError ? ' is-error' : ''}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.classList.add('btn-loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
    }
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && data.ok !== false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSyncResult(resultEl, data) {
  const isError = !data.ok;
  const isWarning = data.ok && (data.code === 'NO_ORDERS' || data.code === 'NO_PRODUCTION_ORDERS');
  const tone = isError
    ? 'bg-rose-50 text-rose-900 border-rose-200'
    : isWarning
      ? 'bg-amber-50 text-amber-900 border-amber-200'
      : 'bg-emerald-50 text-emerald-900 border-emerald-200';

  let html = `<p class="font-medium leading-snug">${escapeHtml(data.message || 'Sync finished.')}</p>`;

  if (data.summary) {
    const s = data.summary;
    html += `
      <dl class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Shopify orders</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.shopifyOrders ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Production created</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.productionOrdersCreated ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Production updated</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.productionOrdersUpdated ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Items synced</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.itemsSynced ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">From Shopify query</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.locationsFromQuery ?? '—'}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Fulfillment locs</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.locationsDiscoveredFromFulfillmentOrders ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Total locations</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${s.locationsSynced ?? 0}</dd>
        </div>
      </dl>`;
  }

  if (isError && data.code) {
    html += `<p class="mt-2 text-xs opacity-75">Error: ${escapeHtml(data.code.replace(/_/g, ' ').toLowerCase())}</p>`;
  }

  if (data.code === 'NO_ORDERS') {
    html += `<p class="mt-2 text-xs text-amber-800">No open Shopify orders found. Check order status, scopes, or test store data.</p>`;
  }

  resultEl.className = `mt-3 text-sm rounded-lg border px-3 py-3 ${tone}`;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = html;
}

async function syncOrders() {
  const btn = document.getElementById('sync-btn');
  const resultEl = document.getElementById('sync-result');
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest('/api/sync/orders', { method: 'POST' });
    if (resultEl) {
      renderSyncResult(resultEl, data);
    }
    showToast(data.message, !data.ok);
    if (data.ok) {
      setTimeout(() => window.location.reload(), 2000);
    }
  } catch (err) {
    showToast(err.message, true);
    if (resultEl) {
      renderSyncResult(resultEl, { ok: false, message: err.message, code: 'NETWORK_ERROR' });
    }
  } finally {
    setButtonLoading(btn, false);
  }
}

async function clearDemoData() {
  const confirmed = window.confirm(
    'Delete demo shop data only?\n\nThis removes demo-store.myshopify.com orders and locations. Your connected Shopify data will not be affected.'
  );
  if (!confirmed) return;

  const btn = document.getElementById('clear-demo-btn');
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest('/api/demo-data/clear', { method: 'POST' });
    showToast(data.message, !data.ok);
    if (data.ok) {
      setTimeout(() => window.location.reload(), 1200);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function updateOrderStatus(orderId, status, triggerEl) {
  if (triggerEl) {
    if (triggerEl.tagName === 'SELECT') triggerEl.disabled = true;
    else setButtonLoading(triggerEl, true);
  }
  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast(`Status updated to ${status}`);
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    showToast(err.message, true);
    if (triggerEl) {
      if (triggerEl.tagName === 'SELECT') {
        triggerEl.disabled = false;
        if (triggerEl.dataset.currentStatus) triggerEl.value = triggerEl.dataset.currentStatus;
      } else {
        setButtonLoading(triggerEl, false);
      }
    }
  }
}

async function updateOrderPriority(orderId, priority, triggerEl) {
  const select = triggerEl || document.getElementById('priority-select');
  if (select) select.disabled = true;
  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast(`Priority updated to ${priority}`);
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    showToast(err.message, true);
    if (select && select.dataset.currentPriority) {
      select.value = select.dataset.currentPriority;
    }
  } finally {
    if (select) select.disabled = false;
  }
}

async function updateNotes(orderId, btn) {
  const textarea = document.getElementById('order-notes');
  const notes = textarea ? textarea.value : '';
  setButtonLoading(btn, true);
  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ internal_notes: notes }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast('Notes saved successfully');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderDueDateBadgeHtml(dueDate, compact = true) {
  const displayDate = dueDate ? String(dueDate).slice(0, 10) : null;
  const compactClass = compact ? ' due-badge-compact' : '';

  if (!displayDate) {
    return `<span class="due-badge due-badge-none${compactClass}">No due date</span>`;
  }

  const today = todayDateString();
  if (displayDate === today) {
    return `<span class="due-badge due-badge-today${compactClass}" title="${displayDate}">Due today</span>`;
  }
  if (displayDate < today) {
    return `<span class="due-badge due-badge-overdue${compactClass}" title="${displayDate}">Overdue · ${displayDate}</span>`;
  }
  return `<span class="due-date-future${compact ? ' due-date-future-compact' : ''}">${displayDate}</span>`;
}

function updateDueDateBadge(orderId, dueDate) {
  const badgeEl = document.querySelector(`[data-due-badge-for="${orderId}"]`);
  if (badgeEl) {
    badgeEl.innerHTML = renderDueDateBadgeHtml(dueDate, true);
  }
}

async function saveDueDate(orderId, dueDate, { reload = false, inputEl = null, btn = null } = {}) {
  if (btn) setButtonLoading(btn, true);
  if (inputEl) inputEl.disabled = true;

  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/due-date`, {
      method: 'PATCH',
      body: JSON.stringify({ due_date: dueDate || null }),
    });
    if (!data.ok) throw new Error(data.message);

    const saved = data.data?.due_date ? data.data.due_date.slice(0, 10) : '';
    if (inputEl) {
      inputEl.value = saved;
      inputEl.dataset.currentDue = saved;
    }

    updateDueDateBadge(orderId, saved);

    showToast(saved ? `Due date set to ${saved}` : 'Due date cleared');
    if (reload) {
      setTimeout(() => window.location.reload(), 600);
    }
  } catch (err) {
    showToast(err.message, true);
    if (inputEl && inputEl.dataset.currentDue !== undefined) {
      inputEl.value = inputEl.dataset.currentDue;
    }
  } finally {
    if (btn) setButtonLoading(btn, false);
    if (inputEl) inputEl.disabled = false;
  }
}

async function toggleLocation(locationId, enabled) {
  const btn = document.querySelector(`[data-action="toggle-location"][data-location-id="${locationId}"]`);
  setButtonLoading(btn, true);
  try {
    const data = await apiRequest(`/api/locations/${locationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast(`Location ${enabled ? 'enabled' : 'disabled'}`);
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    showToast(err.message, true);
    setButtonLoading(btn, false);
  }
}

const bulkSelection = {
  selected: new Set(),

  getVisibleOrderIds() {
    const ids = new Set();
    document.querySelectorAll('.bulk-order-checkbox').forEach((cb) => {
      if (cb.dataset.orderId) ids.add(cb.dataset.orderId);
    });
    return [...ids];
  },

  syncCheckboxes() {
    document.querySelectorAll('.bulk-order-checkbox').forEach((cb) => {
      const checked = this.selected.has(cb.dataset.orderId);
      cb.checked = checked;
      const row = cb.closest('tr');
      if (row) row.classList.toggle('bulk-row-selected', checked);
    });
    this.updateToolbar();
  },

  setOrderSelected(orderId, selected) {
    if (selected) this.selected.add(String(orderId));
    else this.selected.delete(String(orderId));
    this.syncCheckboxes();
  },

  clear() {
    this.selected.clear();
    this.syncCheckboxes();
    const selectAll = document.getElementById('bulk-select-all');
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
  },

  updateToolbar() {
    const toolbar = document.getElementById('bulk-toolbar');
    const countEl = document.getElementById('bulk-selected-count');
    const count = this.selected.size;
    if (countEl) countEl.textContent = count;
    if (toolbar) toolbar.classList.toggle('hidden', count === 0);

    const visibleIds = this.getVisibleOrderIds();
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => this.selected.has(id));
    const selectAll = document.getElementById('bulk-select-all');
    if (selectAll) {
      selectAll.checked = allSelected;
      selectAll.indeterminate = count > 0 && !allSelected;
    }
  },

  toggleSelectAll(checked) {
    const visibleIds = this.getVisibleOrderIds();
    if (checked) {
      visibleIds.forEach((id) => this.selected.add(id));
    } else {
      visibleIds.forEach((id) => this.selected.delete(id));
    }
    this.syncCheckboxes();
  },
};

async function runBulkAction(action, value) {
  const ids = [...bulkSelection.selected].map(Number);
  if (!ids.length) return;

  document.querySelectorAll('.bulk-action-btn').forEach((btn) => {
    btn.disabled = true;
  });

  try {
    const data = await apiRequest('/api/production-orders/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids, action, value }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast(data.message || `Updated ${data.updated} production order(s).`);
    bulkSelection.clear();
    setTimeout(() => window.location.reload(), 700);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    document.querySelectorAll('.bulk-action-btn').forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function initBulkActions() {
  if (!document.getElementById('bulk-toolbar')) return;

  document.querySelectorAll('.bulk-order-checkbox').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      bulkSelection.setOrderSelected(cb.dataset.orderId, cb.checked);
    });
  });

  const selectAll = document.getElementById('bulk-select-all');
  if (selectAll) {
    selectAll.addEventListener('click', (e) => e.stopPropagation());
    selectAll.addEventListener('change', () => {
      bulkSelection.toggleSelectAll(selectAll.checked);
    });
  }

  const clearBtn = document.getElementById('bulk-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => bulkSelection.clear());
  }

  document.querySelectorAll('[data-bulk-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      runBulkAction(btn.dataset.bulkAction, btn.dataset.bulkValue);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-action="sync-orders"]').forEach((el) => {
    el.addEventListener('click', syncOrders);
  });

  document.querySelectorAll('[data-action="clear-demo-data"]').forEach((el) => {
    el.addEventListener('click', clearDemoData);
  });

  document.querySelectorAll('[data-action="update-status"]').forEach((el) => {
    el.addEventListener('click', () => {
      updateOrderStatus(el.dataset.orderId, el.dataset.status, el);
    });
  });

  const statusSelect = document.getElementById('status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      const current = statusSelect.dataset.currentStatus;
      if (statusSelect.value !== current) {
        updateOrderStatus(statusSelect.dataset.orderId, statusSelect.value, statusSelect);
      }
    });
  }

  const prioritySelect = document.getElementById('priority-select');
  if (prioritySelect) {
    prioritySelect.addEventListener('change', () => {
      const current = prioritySelect.dataset.currentPriority;
      if (prioritySelect.value !== current) {
        updateOrderPriority(prioritySelect.dataset.orderId, prioritySelect.value, prioritySelect);
      }
    });
  }

  document.querySelectorAll('[data-action="save-notes"]').forEach((el) => {
    el.addEventListener('click', () => updateNotes(el.dataset.orderId, el));
  });

  document.querySelectorAll('[data-action="save-due-date"]').forEach((el) => {
    el.addEventListener('click', () => {
      const input = document.getElementById('due-date-input');
      saveDueDate(el.dataset.orderId, input ? input.value : '', { reload: true, inputEl: input, btn: el });
    });
  });

  document.querySelectorAll('[data-action="clear-due-date"]').forEach((el) => {
    el.addEventListener('click', () => {
      const input = document.getElementById('due-date-input');
      if (input) input.value = '';
      saveDueDate(el.dataset.orderId, '', { reload: true, inputEl: input, btn: el });
    });
  });

  document.querySelectorAll('.due-date-input-inline').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const current = input.dataset.currentDue || '';
      if (input.value === current) return;
      saveDueDate(input.dataset.orderId, input.value, { reload: false, inputEl: input });
    });
  });

  document.querySelectorAll('[data-action="toggle-location"]').forEach((el) => {
    el.addEventListener('click', () => {
      toggleLocation(el.dataset.locationId, el.dataset.enabled === 'true');
    });
  });

  document.querySelectorAll('[data-action="board-status"]').forEach((el) => {
    el.addEventListener('change', () => {
      const current = el.dataset.currentStatus || el.value;
      if (el.value !== current) {
        updateOrderStatus(el.dataset.orderId, el.value, el);
      }
    });
  });

  initBulkActions();
});
