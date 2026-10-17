import { MSG, sendToBackground } from '../lib/messages.js';
import { renderCharacterSVG } from '../lib/character.js';
import { purchaseStatus, daysUntilDeadline } from '../lib/purchases.js';
import { onSettingsChanged } from '../lib/storage.js';
import { updateSavingsDashboard } from '../popup/savings-view.js';

const $ = (id) => document.getElementById(id);

const els = {
  pendingPanel: $('pending-panel'),
  pendingList: $('pending-list'),

  art: $('character-art'),
  name: $('character-name'),
  stage: $('character-stage'),
  xpFill: $('xp-fill'),
  xpLabel: $('xp-label'),
  statSaved: $('stat-saved'),
  statMonth: $('stat-month'),
  statItems: $('stat-items'),
  statReturns: $('stat-returns'),
  statMissed: $('stat-missed'),

  addForm: $('add-form'),
  title: $('f-title'),
  store: $('f-store'),
  date: $('f-date'),
  price: $('f-price'),
  savings: $('f-savings'),
  deadline: $('f-deadline'),
  useDefaultWindow: $('use-default-window'),

  settingsForm: $('settings-form'),
  autoDetect: $('s-auto-detect'),
  skin: $('s-skin'),
  leaf: $('s-leaf'),
  flower: $('s-flower'),
  notify: $('s-notify'),
  window: $('s-window'),
  settingsStatus: $('settings-status'),

  filterTabs: $('filter-tabs'),
  body: $('purchases-body'),
  empty: $('empty-state'),
  savingsDashboard: $('savings-dashboard'),
};

let state = null;
let filter = 'all';

init();

async function init() {
  const res = await sendToBackground(MSG.GET_STATE);
  if (res?.ok) {
    state = res;
    renderAll();
  }

  els.name.addEventListener('change', async () => {
    const res = await sendToBackground(MSG.UPDATE_SETTINGS, { characterName: els.name.value || 'Pip' });
    if (res?.ok) { state = res; renderHero(); }
  });

  const settingFields = [
    [els.autoDetect, 'autoDetect'],
    [els.skin, 'skinColor'],
    [els.leaf, 'leafColor'],
    [els.flower, 'flowerColor'],
    [els.notify, 'notifyDaysBefore'],
    [els.window, 'defaultReturnWindowDays'],
  ];

  for (const [el, key] of settingFields) {
    el.addEventListener('change', async () => {
      const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      const res = await sendToBackground(MSG.UPDATE_SETTINGS, { [key]: value });
      if (res?.ok) {
        state = res;
        renderAll();
        flash(els.settingsStatus, 'Saved.');
      }
    });
  }

  els.useDefaultWindow.addEventListener('click', () => {
    const base = els.date.value ? new Date(els.date.value) : new Date();
    base.setDate(base.getDate() + (state?.settings.defaultReturnWindowDays ?? 30));
    els.deadline.value = base.toISOString().slice(0, 10);
  });

  els.addForm.addEventListener('submit', onAddPurchase);

  els.filterTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    filter = btn.dataset.filter;
    for (const t of els.filterTabs.querySelectorAll('.filter-tab')) t.classList.toggle('active', t === btn);
    renderTable();
  });

  // Keep in sync if the popup changes settings while this page is open.
  onSettingsChanged(async () => {
    const res = await sendToBackground(MSG.GET_STATE);
    if (res?.ok) { state = res; renderAll(); }
  });
}

function renderAll() {
  renderPending();
  renderHero();
  renderStats();
  updateSavingsDashboard(els.savingsDashboard, state.purchases || []);
  renderSettingsForm();
  renderTable();
}

function renderPending() {
  const pending = state.pending || [];
  els.pendingPanel.hidden = pending.length === 0;
  els.pendingList.innerHTML = '';

  for (const p of pending) {
    const card = document.createElement('div');
    card.className = 'pending-card';
    card.innerHTML = `
      <p class="pending-card__source">Detected on ${escapeHtml(p.store || 'this site')}</p>
      <div class="pending-card__row"><input type="text" class="p-title" value="${escapeAttr(p.title)}" /></div>
      <div class="pending-card__row">
        <input type="number" class="p-price" min="0" step="0.01" value="${p.pricePaid}" placeholder="Paid" />
        <input type="number" class="p-savings" min="0" step="0.01" value="${p.savings}" placeholder="Saved" />
      </div>
      <div class="pending-card__actions">
        <button type="button" class="p-confirm primary">Confirm</button>
        <button type="button" class="p-dismiss">Not a purchase</button>
      </div>
    `;

    card.querySelector('.p-confirm').addEventListener('click', async () => {
      const patch = {
        title: card.querySelector('.p-title').value,
        pricePaid: card.querySelector('.p-price').value,
        savings: card.querySelector('.p-savings').value,
      };
      const res = await sendToBackground(MSG.CONFIRM_PENDING, { id: p.id, patch });
      if (res?.ok) { state = res; renderAll(); }
    });

    card.querySelector('.p-dismiss').addEventListener('click', async () => {
      const res = await sendToBackground(MSG.DISMISS_PENDING, { id: p.id });
      if (res?.ok) { state = res; renderAll(); }
    });

    els.pendingList.appendChild(card);
  }
}

function renderHero() {
  const { settings, character } = state;
  els.art.innerHTML = renderCharacterSVG(character.stage.key, {
    skinColor: settings.skinColor,
    leafColor: settings.leafColor,
    flowerColor: settings.flowerColor,
    size: 96,
  });
  els.name.value = settings.characterName;
  els.stage.textContent = `Tier ${character.level} · ${character.stage.label}`;
  els.xpFill.style.width = `${Math.round(character.progress * 100)}%`;
  els.xpLabel.textContent = character.next
    ? `${Math.round(character.xp).toLocaleString()} / ${character.next.minXp.toLocaleString()} XP to ${character.next.label}`
    : `${Math.round(character.xp).toLocaleString()} XP · Max tier reached`;
}

function renderStats() {
  const { stats } = state;
  els.statSaved.textContent = formatMoney(stats.totalSaved);
  els.statMonth.textContent = formatMoney(stats.savedThisMonth);
  els.statItems.textContent = String(stats.totalItems);
  els.statReturns.textContent = String(stats.completedReturns);
  els.statMissed.textContent = String(stats.missedReturns);
}

function renderSettingsForm() {
  const s = state.settings;
  els.autoDetect.checked = s.autoDetect;
  els.skin.value = s.skinColor;
  els.leaf.value = s.leafColor;
  els.flower.value = s.flowerColor;
  els.notify.value = s.notifyDaysBefore;
  els.window.value = s.defaultReturnWindowDays;
}

function renderTable() {
  const purchases = state.purchases.filter((p) => filter === 'all' || purchaseStatus(p) === filter);
  els.body.innerHTML = '';
  els.empty.hidden = purchases.length > 0;

  for (const p of purchases) {
    els.body.appendChild(buildRow(p));
  }
}

function buildRow(p) {
  const tr = document.createElement('tr');
  const status = purchaseStatus(p);
  const days = daysUntilDeadline(p);

  const deadlineText = !p.returnDeadline
    ? '—'
    : new Date(p.returnDeadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      (status === 'tracked' && days !== null ? ` (${days}d)` : '');

  tr.innerHTML = `
    <td>${escapeHtml(p.title)}</td>
    <td>${escapeHtml(p.store) || '—'}</td>
    <td>${formatMoney(p.pricePaid)}</td>
    <td>${p.savings ? formatMoney(p.savings) : '—'}</td>
    <td>${deadlineText}</td>
    <td><span class="pill pill--${p.source === 'auto' ? 'auto' : 'manual'}">${p.source === 'auto' ? 'auto' : 'manual'}</span></td>
    <td><span class="pill pill--${status}">${status}</span></td>
  `;

  const actionsTd = document.createElement('td');
  actionsTd.className = 'row-actions';

  if (!p.returned) {
    const returnBtn = document.createElement('button');
    returnBtn.type = 'button';
    returnBtn.textContent = 'Mark returned';
    returnBtn.addEventListener('click', () => markReturned(p.id, true));
    actionsTd.appendChild(returnBtn);
  } else {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => markReturned(p.id, false));
    actionsTd.appendChild(undoBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => deletePurchase(p.id, p.title));
  actionsTd.appendChild(delBtn);

  tr.appendChild(actionsTd);
  return tr;
}

async function markReturned(id, returned) {
  const res = await sendToBackground(MSG.MARK_RETURNED, { id, returned });
  if (res?.ok) { state = res; renderAll(); }
}

async function deletePurchase(id, title) {
  if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
  const res = await sendToBackground(MSG.DELETE_PURCHASE, { id });
  if (res?.ok) { state = res; renderAll(); }
}

async function onAddPurchase(e) {
  e.preventDefault();
  if (!els.title.value.trim() || !els.price.value) return;

  const payload = {
    title: els.title.value,
    store: els.store.value,
    pricePaid: els.price.value,
    savings: els.savings.value || 0,
    purchaseDate: els.date.value ? new Date(els.date.value).toISOString() : undefined,
    returnDeadline: els.deadline.value ? new Date(els.deadline.value).toISOString() : null,
  };

  const res = await sendToBackground(MSG.ADD_PURCHASE, payload);
  if (res?.ok) {
    state = res;
    renderAll();
    els.addForm.reset();
  }
}

function formatMoney(n) {
  return `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

let flashTimer;
function flash(el, text) {
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}
