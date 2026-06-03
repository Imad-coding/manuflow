/* FulfillForge client helpers — live updates + SSE */

const STATUS_STYLES = {
  New: 'badge-tone-info',
  'In Production': 'badge-tone-warning',
  'Waiting Material': 'badge-tone-caution',
  Done: 'badge-tone-success',
  Packed: 'badge-tone-neutral',
};

const PRIORITY_STYLES = {
  Low: 'badge-tone-neutral',
  Normal: 'badge-tone-neutral',
  High: 'badge-tone-warning',
  Urgent: 'badge-tone-critical',
};

const BOARD_STATUSES = ['New', 'In Production', 'Waiting Material', 'Done', 'Packed'];

function getPageContext() {
  const body = document.body;
  return {
    page: body.dataset.page || '',
    orderId: body.dataset.orderId ? Number(body.dataset.orderId) : null,
  };
}

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

function renderStatusBadgeHtml(status) {
  const cls = STATUS_STYLES[status] || 'badge-tone-neutral';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function renderPriorityBadgeHtml(priority) {
  const cls = PRIORITY_STYLES[priority] || 'badge-tone-neutral';
  return `<span class="badge ${cls}">${escapeHtml(priority)}</span>`;
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
      </dl>`;
  }

  resultEl.className = `mt-3 text-sm rounded-lg border px-3 py-3 sync-result ${tone}`;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = html;
}

function showLiveUpdatesBanner(message) {
  const banner = document.getElementById('live-updates-banner');
  if (!banner) return;
  const text = banner.querySelector('.live-updates-banner__text');
  if (text && message) text.textContent = message;
  banner.classList.remove('hidden');
}

function hideLiveUpdatesBanner() {
  const banner = document.getElementById('live-updates-banner');
  if (banner) banner.classList.add('hidden');
}

const LIVE_RELOAD_REASONS = new Set(['shopify_webhook', 'sync_completed']);
const liveReloadGuard = {
  debounceTimer: null,
  lastReloadAt: 0,
};

function shouldAutoReloadFromSse(payload) {
  return Boolean(payload?.reason && LIVE_RELOAD_REASONS.has(payload.reason));
}

function scheduleLiveViewUpdate(payload) {
  if (!shouldAutoReloadFromSse(payload)) return;

  const ctx = getPageContext();
  if (ctx.page !== 'dashboard' && ctx.page !== 'board' && ctx.page !== 'workstation' && ctx.page !== 'reports') return;

  if (liveReloadGuard.debounceTimer) {
    clearTimeout(liveReloadGuard.debounceTimer);
  }

  liveReloadGuard.debounceTimer = setTimeout(async () => {
    liveReloadGuard.debounceTimer = null;

    const now = Date.now();
    if (now - liveReloadGuard.lastReloadAt < 10000) return;
    liveReloadGuard.lastReloadAt = now;

    const page = getPageContext().page;
    if (page === 'dashboard') {
      window.location.reload();
      return;
    }

    if (page === 'board') {
      try {
        await refreshProductionBoard();
      } catch {
        window.location.reload();
      }
      return;
    }

    if (page === 'workstation') {
      try {
        await refreshWorkstationOrders();
      } catch {
        window.location.reload();
      }
      return;
    }

    if (page === 'reports') {
      try {
        await refreshReports();
      } catch {
        window.location.reload();
      }
    }
  }, 2000);
}

function getDashboardQueryString() {
  const params = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  ['status', 'location', 'search', 'priority', 'archive'].forEach((key) => {
    const value = params.get(key);
    if (value && !(key === 'archive' && value === 'active')) {
      query.set(key, value);
    }
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function getDashboardArchiveFilter() {
  return new URLSearchParams(window.location.search).get('archive') || 'active';
}

function removeDashboardRows(orderIds) {
  orderIds.forEach((id) => {
    const row = document.querySelector(`tr[data-order-row-for="${id}"]`);
    if (row) row.remove();
  });
}

function handleArchiveLiveUpdate(payload) {
  const ctx = getPageContext();
  const orderId = payload.productionOrderId;
  const archived = payload.reason === 'archived';

  if (ctx.page === 'dashboard') {
    const filter = getDashboardArchiveFilter();
    if ((archived && filter === 'active') || (!archived && filter === 'archived')) {
      removeDashboardRows([orderId]);
    } else {
      refreshDashboardRows([orderId]);
    }
    refreshDashboardOverview();
    return;
  }

  if (ctx.page === 'board') {
    if (archived) {
      const card = document.querySelector(`[data-order-card-for="${orderId}"]`);
      if (card) card.remove();
      else refreshProductionBoard().catch(() => {});
    } else {
      refreshProductionBoard().catch(() => {});
    }
    return;
  }

  if (ctx.page === 'order' && ctx.orderId === orderId) {
    refreshOrderDetail(orderId);
  }
}

function applyOrderToDashboardRow(order) {
  if (!order?.id) return;

  const statusCell = document.querySelector(`[data-status-cell-for="${order.id}"]`);
  if (statusCell) statusCell.innerHTML = renderStatusBadgeHtml(order.status);

  const priorityCell = document.querySelector(`[data-priority-cell-for="${order.id}"]`);
  if (priorityCell) priorityCell.innerHTML = renderPriorityBadgeHtml(order.priority);

  const dueInput = document.querySelector(`.due-date-input-inline[data-order-id="${order.id}"]`);
  const savedDue = order.due_date ? order.due_date.slice(0, 10) : '';
  if (dueInput) {
    dueInput.value = savedDue;
    dueInput.dataset.currentDue = savedDue;
  }
  updateDueDateBadge(order.id, savedDue);

  const boardSelect = document.querySelector(`[data-action="board-status"][data-order-id="${order.id}"]`);
  if (boardSelect) {
    boardSelect.value = order.status;
    boardSelect.dataset.currentStatus = order.status;
  }
}

function applyOrderToDetail(order) {
  if (!order?.id) return;

  const statusBadge = document.querySelector(`[data-status-badge-for="${order.id}"]`);
  if (statusBadge) statusBadge.innerHTML = renderStatusBadgeHtml(order.status);

  const priorityBadge = document.querySelector(`[data-priority-badge-for="${order.id}"]`);
  if (priorityBadge) priorityBadge.innerHTML = renderPriorityBadgeHtml(order.priority);

  const statusSelect = document.getElementById('status-select');
  if (statusSelect) {
    statusSelect.value = order.status;
    statusSelect.dataset.currentStatus = order.status;
  }

  const prioritySelect = document.getElementById('priority-select');
  if (prioritySelect) {
    prioritySelect.value = order.priority;
    prioritySelect.dataset.currentPriority = order.priority;
  }

  const dueInput = document.getElementById('due-date-input');
  const savedDue = order.due_date ? order.due_date.slice(0, 10) : '';
  if (dueInput) {
    dueInput.value = savedDue;
    dueInput.dataset.currentDue = savedDue;
  }

  const dueHeader = document.querySelector(`[data-due-header-badge-for="${order.id}"]`);
  if (dueHeader) {
    if (savedDue) {
      dueHeader.classList.remove('hidden');
      dueHeader.innerHTML = renderDueDateBadgeHtml(savedDue, true);
    } else {
      dueHeader.classList.add('hidden');
      dueHeader.innerHTML = '';
    }
  }

  const notes = document.getElementById('order-notes');
  if (notes && typeof order.internal_notes === 'string') {
    notes.value = order.internal_notes;
  }

  const archivedBadge = document.querySelector(`[data-archived-badge-for="${order.id}"]`);
  if (archivedBadge) {
    archivedBadge.classList.toggle('hidden', !order.archived);
  }

  updateArchiveControls(order);
}

function updateArchiveControls(order) {
  const container = document.getElementById('archive-controls');
  if (!container || !order) return;

  container.dataset.orderArchived = order.archived ? '1' : '0';
  container.dataset.orderStatus = order.status;

  const btn = container.querySelector('[data-action="toggle-archive"]');
  if (!btn) return;

  btn.dataset.archived = order.archived ? '1' : '0';
  btn.textContent = order.archived ? 'Unarchive order' : 'Archive order';
}

function renderActivityLogs(logs) {
  if (!logs?.length) {
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

async function refreshOrderDetail(orderId) {
  const data = await apiRequest(`/api/production-orders/${orderId}`);
  if (!data.ok || !data.data?.order) return;
  applyOrderToDetail(data.data.order);
  const logEl = document.getElementById('activity-log-list');
  if (logEl && data.data.activityLogs) {
    logEl.innerHTML = renderActivityLogs(data.data.activityLogs);
  }
}

async function refreshDashboardRows(orderIds) {
  const qs = getDashboardQueryString();
  const data = await apiRequest(`/api/production-orders${qs}`);
  if (!data.ok || !Array.isArray(data.data)) return;

  const byId = new Map(data.data.map((order) => [order.id, order]));
  const ids = orderIds?.length ? orderIds : [...byId.keys()];

  ids.forEach((id) => {
    const order = byId.get(Number(id));
    if (order) applyOrderToDashboardRow(order);
  });
}

async function refreshDashboardOverview() {
  const data = await apiRequest('/api/dashboard/overview');
  if (!data.ok || !data.data) return;

  const mapping = {
    newOrders: 'New',
    inProduction: 'In production',
    waitingMaterial: 'Waiting material',
    done: 'Done',
    urgent: 'Urgent',
  };

  document.querySelectorAll('.metric-card').forEach((card) => {
    const label = card.querySelector('.metric-card__label')?.textContent?.trim();
    const valueEl = card.querySelector('.metric-card__value');
    if (!label || !valueEl) return;

    if (label === mapping.newOrders) valueEl.textContent = data.data.newOrders;
    if (label === mapping.inProduction) valueEl.textContent = data.data.inProduction;
    if (label === mapping.waitingMaterial) valueEl.textContent = data.data.waitingMaterial;
    if (label === mapping.done) valueEl.textContent = data.data.done;
    if (label === mapping.urgent) valueEl.textContent = data.data.urgent;
  });
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

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderKanbanCard(card) {
  const dueHtml = renderDueDateBadgeHtml(card.due_date, true);
  const statusOptions = BOARD_STATUSES.map((s) => (
    `<option value="${escapeHtml(s)}"${card.status === s ? ' selected' : ''}>${escapeHtml(s)}</option>`
  )).join('');

  return `
    <article class="kanban-card" data-order-card-for="${card.id}">
      <a href="/orders/${card.id}" class="kanban-card-link">
        <div class="kanban-card-header">
          <span class="order-link">${escapeHtml(card.order_name)}</span>
          <div class="flex flex-col items-end gap-1 shrink-0">
            ${renderPriorityBadgeHtml(card.priority)}
          </div>
        </div>
        <p class="kanban-card-title" title="${escapeHtml(card.primary_title)}">${escapeHtml(card.primary_title)}</p>
        ${card.item_count > 1 ? `<p class="kanban-card-more">+${card.item_count - 1} more item${card.item_count - 1 === 1 ? '' : 's'}</p>` : ''}
        <dl class="kanban-meta">
          <div class="kanban-meta-row"><dt>SKU</dt><dd class="cell-sku">${escapeHtml(card.primary_sku || '—')}</dd></div>
          <div class="kanban-meta-row"><dt>Qty</dt><dd>${card.primary_quantity}</dd></div>
          <div class="kanban-meta-row"><dt>Loc</dt><dd title="${escapeHtml(card.location_name || 'Unassigned')}">${escapeHtml(card.location_name || 'Unassigned')}</dd></div>
          <div class="kanban-meta-row"><dt>Due</dt><dd>${dueHtml}</dd></div>
        </dl>
      </a>
      <div class="kanban-card-action">
        <label class="form-label">Move to</label>
        <select data-action="board-status"
                data-order-id="${card.id}"
                data-current-status="${escapeHtml(card.status)}"
                class="form-select form-select-compact kanban-status-select">
          ${statusOptions}
        </select>
      </div>
    </article>`;
}

function renderProductionBoard(board) {
  return BOARD_STATUSES.map((status) => {
    const cards = board[status] || [];
    const cardsHtml = cards.length
      ? cards.map(renderKanbanCard).join('')
      : '<div class="kanban-empty"><p>No orders</p></div>';

    return `
      <div class="board-column">
        <div class="kanban-column">
          <div class="kanban-column-header">
            ${renderStatusBadgeHtml(status)}
            <span class="kanban-count">${cards.length}</span>
          </div>
          <div class="kanban-column-body">${cardsHtml}</div>
        </div>
      </div>`;
  }).join('');
}

const WORKSTATION_QUICK_STATUSES = ['In Production', 'Done', 'Packed'];

function getWorkstationQueryString() {
  const params = new URLSearchParams(window.location.search);
  const query = new URLSearchParams();
  ['status', 'location', 'search', 'priority'].forEach((key) => {
    const value = params.get(key);
    if (value) query.set(key, value);
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function formatWorkstationNotesPreview(notes) {
  const text = notes ? String(notes).trim() : '';
  if (!text) return '';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function renderWorkstationProductItem(item) {
  const variantLabel = item.variant_label
    || (item.options?.length ? item.options.map((o) => o.value).join(' / ') : '')
    || item.variant_title
    || '';

  const thumb = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy">`
    : '<span class="workstation-product__thumb-empty" aria-hidden="true">—</span>';

  const variantHtml = variantLabel
    ? `<p class="workstation-product__variant">${escapeHtml(variantLabel)}</p>`
    : '';

  const optionsHtml = item.options?.length
    ? `<p class="workstation-product__options">${item.options.map((opt) => `${escapeHtml(opt.name)}: ${escapeHtml(opt.value)}`).join(' · ')}</p>`
    : '';

  return `
    <li class="workstation-product">
      <div class="workstation-product__thumb">${thumb}</div>
      <div class="workstation-product__body">
        <p class="workstation-product__title">${escapeHtml(item.title)}</p>
        <p class="workstation-product__sku"><span>SKU</span> ${escapeHtml(item.sku || '—')}</p>
        ${variantHtml}
        ${optionsHtml}
      </div>
      <div class="workstation-product__qty">×${item.quantity}</div>
    </li>`;
}

function renderWorkstationCard(order) {
  const orderId = order.id || order.production_order_id;
  const items = Array.isArray(order.items) ? order.items : [];
  const notesPreview = formatWorkstationNotesPreview(order.internal_notes);
  const orderDate = order.order_date ? String(order.order_date).slice(0, 10) : '—';

  const statusButtons = WORKSTATION_QUICK_STATUSES.map((status) => {
    const isCurrent = order.status === status;
    return `
      <button type="button"
              class="workstation-status-btn${isCurrent ? ' is-current' : ''}"
              data-action="workstation-status"
              data-order-id="${orderId}"
              data-status="${escapeHtml(status)}"
              ${isCurrent ? 'disabled aria-current="true"' : ''}>
        Mark ${escapeHtml(status)}
      </button>`;
  }).join('');

  const productsHtml = items.length
    ? `<ul class="workstation-card__products">${items.map(renderWorkstationProductItem).join('')}</ul>`
    : '';

  const notesHtml = notesPreview
    ? `<div class="workstation-card__notes">
        <p class="workstation-card__notes-label">Internal notes</p>
        <p class="workstation-card__notes-text">${escapeHtml(notesPreview)}</p>
      </div>`
    : '';

  return `
    <article class="workstation-card" role="listitem" data-workstation-card-for="${orderId}" data-order-status="${escapeHtml(order.status)}">
      <header class="workstation-card__header">
        <div class="workstation-card__title-block">
          <h2 class="workstation-card__order">${escapeHtml(order.order_name)}</h2>
          ${order.customer_name ? `<p class="workstation-card__customer">${escapeHtml(order.customer_name)}</p>` : ''}
        </div>
        <div class="workstation-card__badges">
          <span class="workstation-card__status-badge" data-status-cell-for="${orderId}">${renderStatusBadgeHtml(order.status)}</span>
          <span class="workstation-card__priority-badge" data-priority-cell-for="${orderId}">${renderPriorityBadgeHtml(order.priority)}</span>
          <span class="workstation-card__due-badge" data-due-badge-for="${orderId}">${renderDueDateBadgeHtml(order.due_date, false)}</span>
        </div>
      </header>
      <dl class="workstation-card__meta">
        <div><dt>Location</dt><dd>${escapeHtml(order.location_name || 'Unassigned')}</dd></div>
        <div><dt>Order date</dt><dd>${escapeHtml(orderDate)}</dd></div>
        <div><dt>Items</dt><dd>${items.length}</dd></div>
      </dl>
      ${productsHtml}
      ${notesHtml}
      <div class="workstation-card__actions">
        <a href="/orders/${orderId}" class="btn-secondary workstation-action-btn">View details</a>
        <a href="/orders/${orderId}/print" target="_blank" rel="noopener noreferrer" class="btn-secondary workstation-action-btn">Print sheet</a>
      </div>
      <div class="workstation-card__status-actions">${statusButtons}</div>
    </article>`;
}

function renderWorkstationEmpty(hasFilters) {
  return `
    <div class="workstation-empty" id="workstation-empty">
      <h2>${hasFilters ? 'No orders match your filters' : 'No active production orders'}</h2>
      <p>${hasFilters ? 'Try clearing filters or broadening your search.' : 'Sync orders from Shopify or check the dashboard.'}</p>
      ${hasFilters
        ? '<a href="/workstation" class="btn-secondary workstation-btn">Reset filters</a>'
        : '<a href="/dashboard" class="btn-secondary workstation-btn">Go to dashboard</a>'}
    </div>`;
}

function applyWorkstationCard(order) {
  if (!order?.id) return;
  const existing = document.querySelector(`[data-workstation-card-for="${order.id}"]`);
  if (!existing) return;
  existing.outerHTML = renderWorkstationCard({
    ...order,
    items: order.items || [],
    location_name: order.location_name,
    internal_notes: order.internal_notes,
  });
}

function updateWorkstationCount(count) {
  const el = document.getElementById('workstation-count');
  if (el) el.textContent = count;
}

async function refreshWorkstationOrders() {
  const grid = document.getElementById('workstation-grid');
  if (!grid) return;

  const qs = getWorkstationQueryString();
  const data = await apiRequest(`/api/workstation/orders${qs}`);
  if (!data.ok || !Array.isArray(data.data)) return;

  updateWorkstationCount(data.data.length);

  if (data.data.length === 0) {
    const params = new URLSearchParams(window.location.search);
    const hasFilters = Boolean(params.get('status') || params.get('location') || params.get('search') || params.get('priority'));
    grid.innerHTML = renderWorkstationEmpty(hasFilters);
    return;
  }

  grid.innerHTML = data.data.map((order) => renderWorkstationCard(order)).join('');
}

async function updateWorkstationStatus(orderId, status, triggerEl) {
  if (triggerEl) setButtonLoading(triggerEl, true);

  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, actor: 'Workstation' }),
    });
    if (!data.ok) throw new Error(data.message);

    applyWorkstationCard(data.data);
    applyOrderToDashboardRow(data.data);
    showToast(`Status updated to ${status}`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (triggerEl) setButtonLoading(triggerEl, false);
  }
}

function initWorkstation() {
  const grid = document.getElementById('workstation-grid');
  if (!grid) return;

  grid.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="workstation-status"]');
    if (!btn || btn.disabled) return;
    updateWorkstationStatus(btn.dataset.orderId, btn.dataset.status, btn);
  });
}

const reportsRefreshGuard = {
  debounceTimer: null,
  lastRefreshAt: 0,
};

function scheduleReportsRefresh() {
  if (getPageContext().page !== 'reports') return;

  if (reportsRefreshGuard.debounceTimer) {
    clearTimeout(reportsRefreshGuard.debounceTimer);
  }

  reportsRefreshGuard.debounceTimer = setTimeout(async () => {
    reportsRefreshGuard.debounceTimer = null;

    const now = Date.now();
    if (now - reportsRefreshGuard.lastRefreshAt < 5000) return;
    reportsRefreshGuard.lastRefreshAt = now;

    try {
      await refreshReports();
    } catch {
      window.location.reload();
    }
  }, 2000);
}

function getReportsQueryString() {
  const range = new URLSearchParams(window.location.search).get('range') || 'today';
  if (range === '7d' || range === '30d') {
    return `?range=${encodeURIComponent(range)}`;
  }
  return '';
}

function renderReportsOrderTable(rows, options = {}) {
  if (!rows?.length) {
    return `
      <div class="empty-state">
        <h3 class="empty-state__heading">${escapeHtml(options.emptyHeading || 'No orders')}</h3>
        <p class="empty-state__message">${escapeHtml(options.emptyMessage || 'Nothing to show for this report.')}</p>
      </div>`;
  }

  const completedHeader = options.showCompletedAt ? '<th>Completed</th>' : '';
  const body = rows.map((row) => {
    const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : '—';
    const completedAt = row.production_status_updated_at
      ? String(row.production_status_updated_at).slice(0, 16).replace('T', ' ')
      : '—';
    const completedCell = options.showCompletedAt ? `<td class="cell-date">${escapeHtml(completedAt)}</td>` : '';

    return `
      <tr>
        <td class="cell-order"><a href="/orders/${row.id}" class="order-link">${escapeHtml(row.order_name)}</a></td>
        <td>${escapeHtml(row.customer_name || '—')}</td>
        <td class="cell-date">${escapeHtml(dueDate)}</td>
        <td class="cell-badge">${renderPriorityBadgeHtml(row.priority)}</td>
        <td class="cell-badge">${renderStatusBadgeHtml(row.status)}</td>
        <td>${escapeHtml(row.location_name || '—')}</td>
        <td class="cell-products text-xs" title="${escapeHtml(row.products_summary || '')}">${escapeHtml(row.products_summary || '—')}</td>
        ${completedCell}
        <td class="cell-action"><a href="/orders/${row.id}" class="btn-plain btn-compact">View</a></td>
      </tr>`;
  }).join('');

  return `
    <div class="polaris-card__body polaris-card__body--flush overflow-x-auto">
      <table class="data-table data-table-compact min-w-[880px]">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Due date</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Location</th>
            <th class="cell-products">Products</th>
            ${completedHeader}
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function applyReportsSummary(summary) {
  document.querySelectorAll('[data-report-metric]').forEach((el) => {
    const key = el.dataset.reportMetric;
    if (summary[key] != null) el.textContent = summary[key];
  });

  document.querySelectorAll('[data-report-count]').forEach((el) => {
    const key = el.dataset.reportCount;
    if (summary[key] != null) el.textContent = summary[key];
  });

  document.querySelectorAll('[data-report-status]').forEach((el) => {
    const status = el.dataset.reportStatus;
    if (summary.statusCounts?.[status] != null) {
      el.textContent = summary.statusCounts[status];
    }
  });

  const completedTitle = document.querySelector('[data-report-completed-title]');
  if (completedTitle) {
    completedTitle.textContent = summary.range === 'today'
      ? 'Completed today'
      : `Completed — ${summary.rangeLabel}`;
  }

  const overdueEl = document.getElementById('reports-overdue-table');
  if (overdueEl) {
    overdueEl.innerHTML = renderReportsOrderTable(summary.overdueOrdersList, {
      emptyHeading: 'No overdue orders',
      emptyMessage: 'All active orders are on schedule or completed.',
    });
  }

  const dueTodayEl = document.getElementById('reports-due-today-table');
  if (dueTodayEl) {
    dueTodayEl.innerHTML = renderReportsOrderTable(summary.dueTodayList, {
      emptyHeading: 'Nothing due today',
      emptyMessage: 'No active production orders are due today.',
    });
  }

  const completedEl = document.getElementById('reports-completed-table');
  if (completedEl) {
    completedEl.innerHTML = renderReportsOrderTable(summary.completedTodayList, {
      showCompletedAt: true,
      emptyHeading: 'No completed orders',
      emptyMessage: 'No orders were marked Done or Packed in this period.',
    });
  }

  const locationEl = document.getElementById('reports-location-breakdown');
  if (locationEl) {
    if (!summary.locationCounts?.length) {
      locationEl.innerHTML = '<p class="reports-empty-inline">No active production orders by location.</p>';
    } else {
      locationEl.innerHTML = `
        <div class="reports-location-list">
          ${summary.locationCounts.map((loc) => `
            <div class="reports-location-row">
              <span class="reports-location-row__name">${escapeHtml(loc.location_name)}</span>
              <span class="reports-location-row__count">${loc.count}</span>
            </div>`).join('')}
        </div>`;
    }
  }
}

async function refreshReports() {
  if (getPageContext().page !== 'reports') return;
  const qs = getReportsQueryString();
  const data = await apiRequest(`/api/reports/summary${qs}`);
  if (!data.ok || !data.data) return;
  applyReportsSummary(data.data);
}

function initReports() {
  if (getPageContext().page !== 'reports') return;
  const rangeSelect = document.getElementById('reports-range');
  if (rangeSelect) {
    rangeSelect.addEventListener('change', () => {
      const form = document.getElementById('reports-range-form');
      if (form) form.requestSubmit();
    });
  }
}

async function refreshProductionBoard() {
  const params = new URLSearchParams(window.location.search);
  const location = params.get('location');
  const qs = location ? `?location=${encodeURIComponent(location)}` : '';
  const data = await apiRequest(`/api/production-board${qs}`);
  if (!data.ok || !data.data) return;

  const track = document.querySelector('.board-scroll-track');
  if (track) {
    track.innerHTML = renderProductionBoard(data.data);
    bindBoardStatusSelects();
  }
  hideLiveUpdatesBanner();
}

async function refreshCurrentView(options = {}) {
  const ctx = getPageContext();

  if (ctx.page === 'dashboard') {
    await refreshDashboardOverview();
    await refreshDashboardRows(options.orderIds);
    hideLiveUpdatesBanner();
    return;
  }

  if (ctx.page === 'board') {
    await refreshProductionBoard();
    return;
  }

  if (ctx.page === 'workstation') {
    await refreshWorkstationOrders();
    return;
  }

  if (ctx.page === 'reports') {
    await refreshReports();
    return;
  }

  if (ctx.page === 'order' && ctx.orderId) {
    await refreshOrderDetail(ctx.orderId);
    hideLiveUpdatesBanner();
  }
}

async function syncOrders() {
  const btn = document.getElementById('sync-btn');
  const resultEl = document.getElementById('sync-result');
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest('/api/sync/orders', { method: 'POST' });
    if (resultEl) renderSyncResult(resultEl, data);
    showToast(data.message, !data.ok);
    if (data.ok) {
      await refreshCurrentView();
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
    if (data.ok) await refreshCurrentView();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function updateOrderArchived(orderId, archived, triggerEl) {
  if (triggerEl) setButtonLoading(triggerEl, true);

  try {
    const data = await apiRequest(`/api/production-orders/${orderId}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    });
    if (!data.ok) throw new Error(data.message);

    showToast(archived ? 'Order archived' : 'Order unarchived');

    if (getPageContext().page === 'order') {
      applyOrderToDetail(data.data);
      const logEl = document.getElementById('activity-log-list');
      if (logEl) {
        const detail = await apiRequest(`/api/production-orders/${orderId}`);
        if (detail.ok && detail.data?.activityLogs) {
          logEl.innerHTML = renderActivityLogs(detail.data.activityLogs);
        }
      }
    }

    handleArchiveLiveUpdate({
      productionOrderId: Number(orderId),
      reason: archived ? 'archived' : 'unarchived',
    });
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (triggerEl) setButtonLoading(triggerEl, false);
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

    if (triggerEl?.tagName === 'SELECT') {
      triggerEl.dataset.currentStatus = status;
    }

    applyOrderToDashboardRow(data.data);
    applyOrderToDetail(data.data);
    applyWorkstationCard(data.data);
    showToast(`Status updated to ${status}`);

    if (getPageContext().page === 'board') {
      showLiveUpdatesBanner('Status changed — refresh board to see column move');
    }
  } catch (err) {
    showToast(err.message, true);
    if (triggerEl?.tagName === 'SELECT' && triggerEl.dataset.currentStatus) {
      triggerEl.value = triggerEl.dataset.currentStatus;
    }
  } finally {
    if (triggerEl) {
      if (triggerEl.tagName === 'SELECT') triggerEl.disabled = false;
      else setButtonLoading(triggerEl, false);
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

    if (select) select.dataset.currentPriority = priority;
    applyOrderToDashboardRow(data.data);
    applyOrderToDetail(data.data);
    showToast(`Priority updated to ${priority}`);
  } catch (err) {
    showToast(err.message, true);
    if (select?.dataset.currentPriority) {
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

async function saveDueDate(orderId, dueDate, { inputEl = null, btn = null } = {}) {
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

    applyOrderToDashboardRow(data.data);
    applyOrderToDetail(data.data);
    showToast(saved ? `Due date set to ${saved}` : 'Due date cleared');
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

async function saveDueDateSettings(btn) {
  const resultEl = document.getElementById('due-date-settings-result');
  setButtonLoading(btn, true);

  try {
    const autoAssign = document.getElementById('due-auto-assign');
    const leadTime = document.getElementById('due-lead-time');
    const leadType = document.getElementById('due-lead-type');
    const skipWeekends = document.getElementById('due-skip-weekends');

    const payload = {
      auto_assign_enabled: Boolean(autoAssign?.checked),
      default_lead_time_days: Number(leadTime?.value ?? 3),
      use_business_days: leadType?.value !== 'calendar',
      skip_weekends: Boolean(skipWeekends?.checked),
    };

    const data = await apiRequest('/api/due-date-settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!data.ok) throw new Error(data.message);

    if (resultEl) renderSyncResult(resultEl, data);
    showToast(data.message || 'Due date settings saved.');
  } catch (err) {
    showToast(err.message, true);
    if (resultEl) {
      renderSyncResult(resultEl, { ok: false, message: err.message, code: 'SAVE_ERROR' });
    }
  } finally {
    setButtonLoading(btn, false);
  }
}

function getProductionRuleActionValue() {
  const actionType = document.getElementById('rule-action-type')?.value;
  if (actionType === 'set_priority') {
    return document.getElementById('rule-action-value-priority')?.value || '';
  }
  if (actionType === 'set_status') {
    return document.getElementById('rule-action-value-status')?.value || '';
  }
  if (actionType === 'set_due_days') {
    return String(document.getElementById('rule-action-value-days')?.value ?? '');
  }
  return document.getElementById('rule-action-value-text')?.value || '';
}

function setProductionRuleActionValue(actionType, value) {
  if (actionType === 'set_priority') {
    const el = document.getElementById('rule-action-value-priority');
    if (el && value) el.value = value;
    return;
  }
  if (actionType === 'set_status') {
    const el = document.getElementById('rule-action-value-status');
    if (el && value) el.value = value;
    return;
  }
  if (actionType === 'set_due_days') {
    const el = document.getElementById('rule-action-value-days');
    if (el) el.value = value || '5';
    return;
  }
  const el = document.getElementById('rule-action-value-text');
  if (el) el.value = value || '';
}

function updateProductionRuleActionValueField() {
  const actionType = document.getElementById('rule-action-type')?.value || 'set_priority';
  const label = document.getElementById('rule-action-value-label');
  const inputs = document.querySelectorAll('.rule-action-value-input');

  inputs.forEach((input) => input.classList.add('hidden'));

  if (actionType === 'set_priority') {
    document.getElementById('rule-action-value-priority')?.classList.remove('hidden');
    if (label) label.textContent = 'Priority';
  } else if (actionType === 'set_status') {
    document.getElementById('rule-action-value-status')?.classList.remove('hidden');
    if (label) label.textContent = 'Status';
  } else if (actionType === 'set_due_days') {
    document.getElementById('rule-action-value-days')?.classList.remove('hidden');
    if (label) label.textContent = 'Business days';
  } else {
    document.getElementById('rule-action-value-text')?.classList.remove('hidden');
    if (label) label.textContent = 'Note text';
  }
}

function resetProductionRuleForm() {
  const idInput = document.getElementById('production-rule-id');
  const saveBtn = document.getElementById('save-production-rule-btn');
  const cancelBtn = document.getElementById('cancel-production-rule-btn');
  const form = document.getElementById('production-rule-form');

  if (idInput) idInput.value = '';
  form?.reset();
  const enabled = document.getElementById('rule-enabled');
  if (enabled) enabled.checked = true;
  if (saveBtn) saveBtn.textContent = 'Create rule';
  cancelBtn?.classList.add('hidden');
  updateProductionRuleActionValueField();
}

function renderProductionRulesApplyResult(resultEl, data) {
  const isError = !data.ok;
  const tone = isError
    ? 'bg-rose-50 text-rose-900 border-rose-200'
    : 'bg-emerald-50 text-emerald-900 border-emerald-200';

  let html = `<p class="font-medium leading-snug">${escapeHtml(data.message || 'Finished.')}</p>`;
  if (data.ok) {
    html += `
      <dl class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Orders checked</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${data.ordersChecked ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Rules applied</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${data.rulesApplied ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Skipped</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${data.skipped ?? 0}</dd>
        </div>
        <div class="rounded-md bg-white/60 px-2.5 py-2 border border-black/5">
          <dt class="text-slate-500">Errors</dt>
          <dd class="text-base font-semibold tabular-nums mt-0.5">${data.errors ?? 0}</dd>
        </div>
      </dl>`;
  }

  resultEl.className = `mt-3 text-sm rounded-lg border px-3 py-3 sync-result ${tone}`;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = html;
}

async function saveProductionRule(btn) {
  setButtonLoading(btn, true);

  try {
    const ruleId = document.getElementById('production-rule-id')?.value;
    const payload = {
      name: document.getElementById('rule-name')?.value?.trim(),
      condition_type: document.getElementById('rule-condition-type')?.value,
      condition_operator: document.getElementById('rule-condition-operator')?.value,
      condition_value: document.getElementById('rule-condition-value')?.value?.trim(),
      action_type: document.getElementById('rule-action-type')?.value,
      action_value: getProductionRuleActionValue().trim(),
      enabled: Boolean(document.getElementById('rule-enabled')?.checked),
    };

    const data = ruleId
      ? await apiRequest(`/api/production-rules/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      : await apiRequest('/api/production-rules', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

    if (!data.ok) throw new Error(data.message);

    showToast(data.message || 'Production rule saved.');
    window.location.reload();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

function editProductionRule(btn) {
  const ruleId = btn.dataset.ruleId;
  document.getElementById('production-rule-id').value = ruleId;
  document.getElementById('rule-name').value = btn.dataset.ruleName || '';
  document.getElementById('rule-condition-type').value = btn.dataset.ruleConditionType || 'sku';
  document.getElementById('rule-condition-operator').value = btn.dataset.ruleConditionOperator || 'contains';
  document.getElementById('rule-condition-value').value = btn.dataset.ruleConditionValue || '';
  document.getElementById('rule-action-type').value = btn.dataset.ruleActionType || 'set_priority';
  document.getElementById('rule-enabled').checked = btn.dataset.ruleEnabled === '1';

  updateProductionRuleActionValueField();
  setProductionRuleActionValue(btn.dataset.ruleActionType, btn.dataset.ruleActionValue);

  const saveBtn = document.getElementById('save-production-rule-btn');
  const cancelBtn = document.getElementById('cancel-production-rule-btn');
  if (saveBtn) saveBtn.textContent = 'Update rule';
  cancelBtn?.classList.remove('hidden');

  document.getElementById('production-rule-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function toggleProductionRule(btn) {
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest(`/api/production-rules/${btn.dataset.ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: btn.dataset.ruleEnabled === '1' }),
    });
    if (!data.ok) throw new Error(data.message);
    showToast(data.message || 'Production rule updated.');
    window.location.reload();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function deleteProductionRule(btn) {
  const name = btn.dataset.ruleName || 'this rule';
  const confirmed = window.confirm(`Delete production rule "${name}"?\n\nThis cannot be undone.`);
  if (!confirmed) return;

  setButtonLoading(btn, true);

  try {
    const data = await apiRequest(`/api/production-rules/${btn.dataset.ruleId}`, {
      method: 'DELETE',
    });
    if (!data.ok) throw new Error(data.message);
    showToast(data.message || 'Production rule deleted.');
    window.location.reload();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function applyProductionRulesExisting(btn) {
  const confirmed = window.confirm(
    'Apply production rules to all active (non-archived) orders?\n\n'
    + 'Manual priority and status edits will be preserved.\n'
    + 'Existing due dates will only be set when empty.'
  );
  if (!confirmed) return;

  const resultEl = document.getElementById('production-rules-apply-result');
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest('/api/production-rules/apply-existing', { method: 'POST' });
    if (!data.ok) throw new Error(data.message);
    if (resultEl) renderProductionRulesApplyResult(resultEl, data);
    showToast(data.message || 'Production rules applied.');
    await refreshCurrentView();
  } catch (err) {
    showToast(err.message, true);
    if (resultEl) {
      renderProductionRulesApplyResult(resultEl, { ok: false, message: err.message });
    }
  } finally {
    setButtonLoading(btn, false);
  }
}

function initProductionRules() {
  const actionTypeSelect = document.getElementById('rule-action-type');
  if (actionTypeSelect) {
    updateProductionRuleActionValueField();
    actionTypeSelect.addEventListener('change', updateProductionRuleActionValueField);
  }

  document.querySelectorAll('[data-action="save-production-rule"]').forEach((el) => {
    el.addEventListener('click', () => saveProductionRule(el));
  });

  document.querySelectorAll('[data-action="cancel-production-rule"]').forEach((el) => {
    el.addEventListener('click', () => resetProductionRuleForm());
  });

  document.querySelectorAll('[data-action="edit-production-rule"]').forEach((el) => {
    el.addEventListener('click', () => editProductionRule(el));
  });

  document.querySelectorAll('[data-action="toggle-production-rule"]').forEach((el) => {
    el.addEventListener('click', () => toggleProductionRule(el));
  });

  document.querySelectorAll('[data-action="delete-production-rule"]').forEach((el) => {
    el.addEventListener('click', () => deleteProductionRule(el));
  });

  document.querySelectorAll('[data-action="apply-production-rules-existing"]').forEach((el) => {
    el.addEventListener('click', () => applyProductionRulesExisting(el));
  });
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

    if (btn) {
      btn.dataset.enabled = enabled ? 'false' : 'true';
      btn.textContent = enabled ? 'Disable' : 'Enable';
      btn.classList.toggle('btn-critical-outline', enabled);
      btn.classList.toggle('btn-success-outline', !enabled);
    }

    const row = btn?.closest('tr');
    const statusCell = row?.querySelector('.cell-badge span.badge');
    if (statusCell) {
      statusCell.textContent = enabled ? 'Enabled' : 'Disabled';
      statusCell.className = `badge ${enabled ? 'badge-tone-success' : 'badge-tone-neutral'}`;
    }

    showToast(`Location ${enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
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
    if (checked) visibleIds.forEach((id) => this.selected.add(id));
    else visibleIds.forEach((id) => this.selected.delete(id));
    this.syncCheckboxes();
  },
};

function printSelectedSheets() {
  const ids = [...bulkSelection.selected].map(Number).filter((id) => id > 0);
  if (!ids.length) {
    showToast('Select at least one order to print.', true);
    return;
  }

  const url = `/orders/print-batch?ids=${ids.join(',')}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

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

    if (action === 'archive') {
      const archiveFilter = getDashboardArchiveFilter();
      const isArchiving = value === true;
      if ((isArchiving && archiveFilter === 'active') || (!isArchiving && archiveFilter === 'archived')) {
        removeDashboardRows(ids);
      } else {
        await refreshDashboardRows(ids);
      }
    } else {
      await refreshDashboardRows(ids);
    }

    await refreshDashboardOverview();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    document.querySelectorAll('.bulk-action-btn').forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function bindBoardStatusSelects() {
  document.querySelectorAll('[data-action="board-status"]').forEach((el) => {
    el.addEventListener('change', () => {
      const current = el.dataset.currentStatus || el.value;
      if (el.value !== current) {
        updateOrderStatus(el.dataset.orderId, el.value, el);
      }
    });
  });
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
  if (clearBtn) clearBtn.addEventListener('click', () => bulkSelection.clear());

  document.querySelectorAll('[data-bulk-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      let value = btn.dataset.bulkValue;
      if (btn.dataset.bulkAction === 'archive') {
        value = value === 'true';
      }
      runBulkAction(btn.dataset.bulkAction, value);
    });
  });

  document.querySelectorAll('[data-action="print-selected-sheets"]').forEach((btn) => {
    btn.addEventListener('click', printSelectedSheets);
  });
}

function initLiveEvents() {
  if (!window.EventSource) return;

  const source = new EventSource('/events');

  source.addEventListener('connected', () => {
    console.log('[SSE] connected');
  });

  source.addEventListener('order_updated', (event) => {
    try {
      const payload = JSON.parse(event.data);
      const ctx = getPageContext();

      if (payload.reason === 'archived' || payload.reason === 'unarchived') {
        showToast(payload.reason === 'archived' ? 'Order archived' : 'Order unarchived');
        handleArchiveLiveUpdate(payload);
        scheduleReportsRefresh();
        return;
      }

      if (ctx.page === 'reports') {
        scheduleReportsRefresh();
        return;
      }

      showToast('Production order updated', false);

      if (ctx.page === 'dashboard') {
        refreshDashboardRows([payload.productionOrderId]);
      } else if (ctx.page === 'board') {
        refreshProductionBoard().catch(() => {});
      } else if (ctx.page === 'workstation') {
        if (payload.reason === 'archived') {
          document.querySelector(`[data-workstation-card-for="${payload.productionOrderId}"]`)?.remove();
          const grid = document.getElementById('workstation-grid');
          const remaining = grid?.querySelectorAll('[data-workstation-card-for]').length || 0;
          updateWorkstationCount(remaining);
        } else {
          refreshWorkstationOrders().catch(() => {});
        }
      } else if (ctx.page === 'order' && ctx.orderId === payload.productionOrderId) {
        refreshOrderDetail(payload.productionOrderId);
      }
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('orders_changed', (event) => {
    try {
      const payload = JSON.parse(event.data);
      console.log('[SSE] orders_changed received', payload);

      if (payload.reason === 'archived' || payload.reason === 'unarchived') {
        const ctx = getPageContext();
        if (ctx.page === 'board') {
          refreshProductionBoard().catch(() => {});
        } else if (ctx.page === 'dashboard') {
          refreshDashboardOverview();
        } else if (ctx.page === 'workstation') {
          refreshWorkstationOrders().catch(() => {});
        } else if (ctx.page === 'reports') {
          scheduleReportsRefresh();
        }
        return;
      }

      scheduleLiveViewUpdate(payload);
    } catch {
      /* ignore malformed events */
    }
  });

  source.addEventListener('sync_completed', (event) => {
    try {
      const payload = JSON.parse(event.data);
      console.log('[SSE] sync_completed received', payload);
      if (payload.message) showToast(payload.message);
      scheduleLiveViewUpdate(payload);
    } catch {
      console.log('[SSE] sync_completed received');
    }
  });

  source.addEventListener('sync_failed', (event) => {
    try {
      const payload = JSON.parse(event.data);
      showToast(payload.message || 'Sync failed', true);
    } catch {
      showToast('Sync failed', true);
    }
  });

  source.onerror = () => {
    /* EventSource reconnects automatically */
  };
}

function renderWebhookSubscriptionsTable(subscriptions) {
  const tbody = document.getElementById('shopify-webhooks-body');
  if (!tbody) return;

  if (!subscriptions?.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-xs" style="color:var(--p-text-subdued)">No webhook subscriptions found in Shopify.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = subscriptions.map((sub) => {
    const created = sub.createdAt ? sub.createdAt.slice(0, 16).replace('T', ' ') : '—';
    return `
      <tr>
        <td class="text-xs font-medium">${escapeHtml(sub.topic || '—')}</td>
        <td class="text-xs code-inline settings-webhook-url">${escapeHtml(sub.callbackUrl || '—')}</td>
        <td class="cell-date text-xs">${escapeHtml(created)}</td>
      </tr>`;
  }).join('');
}

function renderWebhookRegisterResult(resultEl, data) {
  const isError = !data.ok;
  const tone = isError
    ? 'bg-rose-50 text-rose-900 border-rose-200'
    : 'bg-emerald-50 text-emerald-900 border-emerald-200';

  let html = `<p class="font-medium leading-snug">${escapeHtml(data.message || (data.ok ? 'Webhooks registered.' : 'Registration failed.'))}</p>`;

  if (data.created?.length) {
    html += `<p class="mt-2 text-xs">Created: ${data.created.map((item) => escapeHtml(item.topic)).join(', ')}</p>`;
  }
  if (data.existing?.length) {
    html += `<p class="mt-1 text-xs">Already registered: ${data.existing.map((item) => escapeHtml(item.topic)).join(', ')}</p>`;
  }
  if (data.failed?.length) {
    html += `<ul class="mt-2 text-xs list-disc pl-4">${data.failed.map((item) => (
      `<li>${escapeHtml(item.topic)}${item.optional ? ' (optional)' : ''}: ${escapeHtml(item.error || 'failed')}</li>`
    )).join('')}</ul>`;
  }

  resultEl.className = `mt-3 text-sm rounded-lg border px-3 py-3 sync-result ${tone}`;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = html;
}

async function refreshShopifyWebhooks(btn) {
  setButtonLoading(btn, true);
  try {
    const data = await apiRequest('/api/shopify/webhooks');
    if (!data.ok) throw new Error(data.message);
    renderWebhookSubscriptionsTable(data.data);
    showToast(`Loaded ${data.data.length} webhook subscription(s).`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function registerShopifyWebhooks(btn) {
  const resultEl = document.getElementById('webhook-register-result');
  setButtonLoading(btn, true);

  try {
    const data = await apiRequest('/api/shopify/webhooks/register', { method: 'POST' });
    if (resultEl) renderWebhookRegisterResult(resultEl, data);
    showToast(data.message, !data.ok);
    if (data.ok) {
      await refreshShopifyWebhooks(document.getElementById('refresh-webhooks-btn'));
    }
  } catch (err) {
    showToast(err.message, true);
    if (resultEl) {
      renderWebhookRegisterResult(resultEl, { ok: false, message: err.message, created: [], existing: [], failed: [] });
    }
  } finally {
    setButtonLoading(btn, false);
  }
}

async function runWebhookPipelineSelfTest(btn) {
  setButtonLoading(btn, true);
  try {
    const data = await apiRequest('/api/shopify/webhooks/self-test', { method: 'POST' });
    showToast(data.message, !data.ok);
    if (data.ok) {
      setTimeout(() => window.location.reload(), 3500);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function runBroadcastTest(btn) {
  setButtonLoading(btn, true);
  try {
    const data = await apiRequest('/api/dev/broadcast-test', { method: 'POST' });
    showToast(data.message || 'Broadcast sent', !data.ok);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    setButtonLoading(btn, false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-action="sync-orders"]').forEach((el) => {
    el.addEventListener('click', syncOrders);
  });

  document.querySelectorAll('[data-action="clear-demo-data"]').forEach((el) => {
    el.addEventListener('click', clearDemoData);
  });

  document.querySelectorAll('[data-action="register-webhooks"]').forEach((el) => {
    el.addEventListener('click', () => registerShopifyWebhooks(el));
  });

  document.querySelectorAll('[data-action="refresh-webhooks"]').forEach((el) => {
    el.addEventListener('click', () => refreshShopifyWebhooks(el));
  });

  document.querySelectorAll('[data-action="webhook-self-test"]').forEach((el) => {
    el.addEventListener('click', () => runWebhookPipelineSelfTest(el));
  });

  document.querySelectorAll('[data-action="broadcast-test"]').forEach((el) => {
    el.addEventListener('click', () => runBroadcastTest(el));
  });

  const statusSelect = document.getElementById('status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      if (statusSelect.value !== statusSelect.dataset.currentStatus) {
        updateOrderStatus(statusSelect.dataset.orderId, statusSelect.value, statusSelect);
      }
    });
  }

  const prioritySelect = document.getElementById('priority-select');
  if (prioritySelect) {
    prioritySelect.addEventListener('change', () => {
      if (prioritySelect.value !== prioritySelect.dataset.currentPriority) {
        updateOrderPriority(prioritySelect.dataset.orderId, prioritySelect.value, prioritySelect);
      }
    });
  }

  document.querySelectorAll('[data-action="save-notes"]').forEach((el) => {
    el.addEventListener('click', () => updateNotes(el.dataset.orderId, el));
  });

  document.querySelectorAll('[data-action="toggle-archive"]').forEach((el) => {
    el.addEventListener('click', () => {
      const archived = el.dataset.archived !== '1';
      updateOrderArchived(el.dataset.orderId, archived, el);
    });
  });

  document.querySelectorAll('[data-action="save-due-date"]').forEach((el) => {
    el.addEventListener('click', () => {
      const input = document.getElementById('due-date-input');
      saveDueDate(el.dataset.orderId, input ? input.value : '', { inputEl: input, btn: el });
    });
  });

  document.querySelectorAll('[data-action="clear-due-date"]').forEach((el) => {
    el.addEventListener('click', () => {
      const input = document.getElementById('due-date-input');
      if (input) input.value = '';
      saveDueDate(el.dataset.orderId, '', { inputEl: input, btn: el });
    });
  });

  document.querySelectorAll('.due-date-input-inline').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const current = input.dataset.currentDue || '';
      if (input.value === current) return;
      saveDueDate(input.dataset.orderId, input.value, { inputEl: input });
    });
  });

  document.querySelectorAll('[data-action="toggle-location"]').forEach((el) => {
    el.addEventListener('click', () => {
      toggleLocation(el.dataset.locationId, el.dataset.enabled === 'true');
    });
  });

  document.querySelectorAll('[data-action="save-due-date-settings"]').forEach((el) => {
    el.addEventListener('click', () => saveDueDateSettings(el));
  });

  initProductionRules();

  bindBoardStatusSelects();

  const refreshBtn = document.getElementById('live-updates-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshCurrentView());
  }

  initBulkActions();
  initWorkstation();
  initReports();
  initLiveEvents();
});
