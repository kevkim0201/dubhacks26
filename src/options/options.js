import { MSG, sendToBackground } from '../lib/messages.js';
import { renderCharacterSVG, STAGES } from '../lib/character.js';
import { purchaseStatus, daysUntilDeadline } from '../lib/purchases.js';
import { onSettingsChanged } from '../lib/storage.js';
import { getCurrentDealSavings } from '../../savings-storage/savings-storage.js';
import { signInWithGoogle, signOut, getUser } from '../lib/supabase.js';
import { mountSquirrelScene } from '../lib/squirrelScene.js';

const $ = (id) => document.getElementById(id);

const els = {
  appTabs: $('app-tabs'),
  avatarLetter: $('avatar-letter'),
  avatarBtn: $('avatar-btn'),
  accountMenu: $('account-menu'),
  accountSignedOut: $('account-signed-out'),
  accountSignedIn: $('account-signed-in'),
  accountEmail: $('account-email'),
  accountError: $('account-error'),
  googleSigninBtn: $('google-signin-btn'),
  signOutBtn: $('sign-out-btn'),

  // --- overview ---
  dashSubtitle: $('dash-subtitle'),
  dashDate: $('dash-date'),
  companionTierLabel: $('companion-tier-label'),
  xpToast: $('xp-toast'),
  xpToastAmount: $('xp-toast-amount'),
  xpToastDesc: $('xp-toast-desc'),
  xpToastMeta: $('xp-toast-meta'),
  companionArt: $('companion-art'),
  nextEvolution: $('next-evolution'),
  nextEvolutionArt: $('next-evolution-art'),
  nextEvolutionName: $('next-evolution-name'),
  nextEvolutionReq: $('next-evolution-req'),
  companionCaption: $('companion-caption'),
  progressNextLabel: $('progress-next-label'),
  progressXp: $('progress-xp'),
  xpFill: $('xp-fill'),
  progressNote: $('progress-note'),
  progressFraction: $('progress-fraction'),
  sideTotalSaved: $('side-total-saved'),
  sideThisMonth: $('side-this-month'),
  recentList: $('recent-list'),
  recentEmpty: $('recent-empty'),
  couponTeaser: $('coupon-teaser'),
  couponTeaserStore: $('coupon-teaser-store'),
  couponTeaserAmount: $('coupon-teaser-amount'),
  chaptersGrid: $('chapters-grid'),
  chaptersCount: $('chapters-count'),
  viewAllLink: $('view-all-link'),
  howItWorksLink: $('how-it-works-link'),
  howTiers: $('how-tiers'),

  // --- activity tab ---
  pendingPanel: $('pending-panel'),
  pendingList: $('pending-list'),

  addForm: $('add-form'),
  title: $('f-title'),
  store: $('f-store'),
  date: $('f-date'),
  price: $('f-price'),
  savings: $('f-savings'),
  deadline: $('f-deadline'),
  useDefaultWindow: $('use-default-window'),

  settingsForm: $('settings-form'),
  userName: $('s-name'),
  characterName: $('s-character-name'),
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
};

let state = null;
let filter = 'all';
let currentUser = null; // Supabase auth user, or null when signed out

const squirrelScene = mountSquirrelScene(els.companionArt, { size: 340 });

init();

async function init() {
  const res = await sendToBackground(MSG.GET_STATE);
  if (res?.ok) {
    state = res;
    await renderAll();
  }

  refreshAuthUI(); // fire-and-forget: hits the network, shouldn't block first paint

  els.avatarBtn.addEventListener('click', () => {
    const willOpen = els.accountMenu.hidden;
    els.accountMenu.hidden = !willOpen;
    els.avatarBtn.setAttribute('aria-expanded', String(willOpen));
  });

  document.addEventListener('click', (e) => {
    if (!els.accountMenu.hidden && !e.target.closest('.account')) {
      els.accountMenu.hidden = true;
      els.avatarBtn.setAttribute('aria-expanded', 'false');
    }
  });

  els.googleSigninBtn.addEventListener('click', async () => {
    els.accountError.hidden = true;
    els.googleSigninBtn.disabled = true;
    try {
      await signInWithGoogle();
      await refreshAuthUI();
    } catch (err) {
      els.accountError.hidden = false;
      els.accountError.textContent = err.message || 'Sign-in failed.';
    } finally {
      els.googleSigninBtn.disabled = false;
    }
  });

  els.signOutBtn.addEventListener('click', async () => {
    await signOut();
    await refreshAuthUI();
  });

  els.appTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.app-tab');
    if (btn) switchTab(btn.dataset.tab);
  });
  els.viewAllLink.addEventListener('click', () => switchTab('activity'));
  els.howItWorksLink.addEventListener('click', () => switchTab('how'));

  const settingFields = [
    [els.userName, 'userName'],
    [els.characterName, 'characterName'],
    [els.autoDetect, 'autoDetect'],
    [els.skin, 'skinColor'],
    [els.leaf, 'leafColor'],
    [els.flower, 'flowerColor'],
    [els.notify, 'notifyDaysBefore'],
    [els.window, 'defaultReturnWindowDays'],
  ];

  for (const [el, key] of settingFields) {
    el.addEventListener('change', async () => {
      const raw = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      const value = (key === 'userName' || key === 'characterName') && !raw
        ? (key === 'userName' ? 'Alex' : 'Pip')
        : raw;
      const res = await sendToBackground(MSG.UPDATE_SETTINGS, { [key]: value });
      if (res?.ok) {
        state = res;
        await renderAll();
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
    if (res?.ok) { state = res; await renderAll(); }
  });
}

function switchTab(tab) {
  for (const btn of els.appTabs.querySelectorAll('.app-tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== `tab-${tab}`;
}

async function renderAll() {
  renderDashHead();
  renderCompanion();
  await renderSideCol();
  renderChapters();
  renderHowTiers();

  renderPending();
  renderSettingsForm();
  renderTable();
}

// ======================== Overview ========================

function renderDashHead() {
  const { settings } = state;
  els.avatarLetter.textContent = avatarLetterFor(settings);
  els.dashSubtitle.textContent = `Welcome back, ${settings.userName}. Here's what you and ${settings.characterName} have been growing.`;
  els.dashDate.textContent = `Your journey · ${new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })}`;
}

function avatarLetterFor(settings) {
  const label = currentUser ? (currentUser.user_metadata?.full_name || currentUser.email) : settings?.userName;
  return (label || 'A').charAt(0).toUpperCase();
}

// Asks Supabase who's signed in (validates the stored session rather
// than trusting a possibly-stale local copy) and updates both the
// dropdown panel and the avatar initial. Safe to call with no Supabase
// project configured yet -- getUser() just resolves to null.
async function refreshAuthUI() {
  currentUser = await getUser().catch(() => null);

  els.accountSignedOut.hidden = !!currentUser;
  els.accountSignedIn.hidden = !currentUser;

  if (currentUser) {
    els.accountEmail.textContent = currentUser.user_metadata?.full_name || currentUser.email || 'Signed in';
  }

  if (state) els.avatarLetter.textContent = avatarLetterFor(state.settings);
}

function renderCompanion() {
  const { settings, character, purchases } = state;

  els.companionTierLabel.textContent = `Tier ${character.level} · ${character.stage.label}`;

  renderXpToast(purchases, settings);

  squirrelScene.syncToXP(character.xp);

  if (character.next) {
    els.nextEvolution.hidden = false;
    els.nextEvolutionArt.innerHTML = renderCharacterSVG(character.next.key, {
      skinColor: settings.skinColor,
      leafColor: settings.leafColor,
      flowerColor: settings.flowerColor,
      size: 56,
    });
    els.nextEvolutionName.textContent = `\u{1F512} ${character.next.label}`;
    els.nextEvolutionReq.textContent = `At ${formatMoney(character.next.minSaved, 0)} saved`;
  } else {
    els.nextEvolution.hidden = true;
  }

  els.companionCaption.textContent = character.stageIndex === 0
    ? `${settings.characterName} is waiting for your first saved purchase.`
    : `${settings.characterName}'s growing, thanks to your savings.`;

  if (character.next) {
    els.progressNextLabel.textContent = `Next up: ${character.next.label}`;
    els.progressXp.textContent = `${Math.round(character.xp).toLocaleString()} / ${character.next.minXp.toLocaleString()} XP · ${character.progressPct}%`;
    els.xpFill.style.width = `${character.progressPct}%`;
    els.progressNote.textContent = `${formatMoney(character.dollarsToNext)} to go · ${character.next.label} unlocks at ${formatMoney(character.next.minSaved, 0)} saved`;
    els.progressFraction.textContent = `${formatMoney(character.xp / 10)} / ${formatMoney(character.next.minSaved, 0)}`;
  } else {
    els.progressNextLabel.textContent = `${settings.characterName} is fully grown`;
    els.progressXp.textContent = `${Math.round(character.xp).toLocaleString()} XP`;
    els.xpFill.style.width = '100%';
    els.progressNote.textContent = 'Max tier reached -- keep saving to keep the streak alive.';
    els.progressFraction.textContent = '';
  }
}

function renderXpToast(purchases, settings) {
  const last = [...purchases]
    .filter((p) => p.savings > 0)
    .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))[0];

  if (!last) {
    els.xpToast.hidden = true;
    return;
  }

  els.xpToast.hidden = false;
  els.xpToastAmount.textContent = `+${Math.round(last.savings * 10)} XP`;
  els.xpToastDesc.textContent = `Your last ${formatMoney(last.savings)} saved gave ${settings.characterName} a little boost.`;
  els.xpToastMeta.textContent = `Purchase completed · ${formatDateShort(last.purchaseDate)}`;
}

async function renderSideCol() {
  const { stats, purchases } = state;
  els.sideTotalSaved.textContent = formatMoney(stats.totalSaved);
  els.sideThisMonth.textContent = `+${formatMoney(stats.savedThisMonth)}`;

  const recent = [...purchases]
    .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate))
    .slice(0, 3);

  els.recentList.innerHTML = '';
  els.recentEmpty.hidden = recent.length > 0;

  for (const p of recent) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    const label = p.store || p.title || '?';
    li.innerHTML = `
      <span class="recent-item__avatar">${escapeHtml(label.charAt(0).toUpperCase())}</span>
      <span class="recent-item__main">
        <p class="recent-item__title">${escapeHtml(p.store || p.title)}</p>
        <p class="recent-item__meta">${formatDateShort(p.purchaseDate)} · Completed</p>
      </span>
      <span class="recent-item__right">
        <span class="recent-item__amount">${formatMoney(p.savings || p.pricePaid)}</span>
        ${p.savings ? `<span class="recent-item__xp">+${Math.round(p.savings * 10)} XP</span>` : ''}
      </span>
    `;
    els.recentList.appendChild(li);
  }

  // Ties into Rohit's coupon feature: a detected-but-not-yet-applied deal,
  // written by the coupons flow via savings-storage.js. Shown purely as a
  // teaser -- it never contributes to totals/XP until a purchase completes.
  const deal = await getCurrentDealSavings().catch(() => null);
  if (deal && deal.potentialSavings > 0) {
    els.couponTeaser.hidden = false;
    els.couponTeaserStore.textContent = deal.store || deal.title || 'This site';
    els.couponTeaserAmount.textContent = formatMoney(deal.potentialSavings);
  } else {
    els.couponTeaser.hidden = true;
  }
}

function renderChapters() {
  const { character } = state;
  els.chaptersCount.textContent = `${character.level} of ${STAGES.length} chapters unlocked`;
  els.chaptersGrid.innerHTML = '';

  STAGES.forEach((stage, i) => {
    const card = document.createElement('div');
    card.className = 'chapter-card' + (i === character.stageIndex ? ' is-current' : '');

    let statusHtml;
    let fill;
    if (i < character.stageIndex) {
      statusHtml = '<span class="chapter-card__status chapter-card__status--unlocked">✓ Unlocked</span>';
      fill = 1;
    } else if (i === character.stageIndex) {
      statusHtml = '<span class="chapter-card__status chapter-card__status--current">✓ You are here</span>';
      const next = STAGES[i + 1];
      fill = next ? Math.min(1, Math.max(0, (character.xp - stage.minXp) / (next.minXp - stage.minXp))) : 1;
    } else if (i === character.stageIndex + 1) {
      statusHtml = '<span class="chapter-card__status chapter-card__status--next">→ Next up</span>';
      fill = 0;
    } else {
      statusHtml = '<span class="chapter-card__status">\u{1F512} Locked</span>';
      fill = 0;
    }

    card.innerHTML = `
      <div class="chapter-card__head"><span>Tier ${i + 1}</span>${statusHtml}</div>
      <div class="chapter-card__art"></div>
      <p class="chapter-card__name">${stage.label}</p>
      <p class="chapter-card__req">${formatMoney(stage.minSaved, 0)} saved</p>
      <p class="chapter-card__tagline">${stage.tagline}</p>
      <div class="chapter-card__bar"><div class="chapter-card__bar-fill" style="width:${Math.round(fill * 100)}%"></div></div>
    `;

    card.querySelector('.chapter-card__art').innerHTML = renderCharacterSVG(stage.key, {
      skinColor: state.settings.skinColor,
      leafColor: state.settings.leafColor,
      flowerColor: state.settings.flowerColor,
      size: 48,
    });

    els.chaptersGrid.appendChild(card);
  });
}

function renderHowTiers() {
  els.howTiers.innerHTML = '';
  for (const stage of STAGES) {
    const card = document.createElement('div');
    card.className = 'how-tier';
    card.innerHTML = `
      <div class="how-tier__art"></div>
      <p class="how-tier__name">${stage.label}</p>
      <p class="how-tier__req">${formatMoney(stage.minSaved, 0)} saved</p>
    `;
    card.querySelector('.how-tier__art').innerHTML = renderCharacterSVG(stage.key, {
      skinColor: state.settings.skinColor,
      leafColor: state.settings.leafColor,
      flowerColor: state.settings.flowerColor,
      size: 40,
    });
    els.howTiers.appendChild(card);
  }
}

// ======================== Savings activity (unchanged functionality) ========================

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
      if (res?.ok) { state = res; await renderAll(); }
    });

    card.querySelector('.p-dismiss').addEventListener('click', async () => {
      const res = await sendToBackground(MSG.DISMISS_PENDING, { id: p.id });
      if (res?.ok) { state = res; await renderAll(); }
    });

    els.pendingList.appendChild(card);
  }
}

function renderSettingsForm() {
  const s = state.settings;
  els.userName.value = s.userName;
  els.characterName.value = s.characterName;
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
  if (res?.ok) { state = res; await renderAll(); }
}

async function deletePurchase(id, title) {
  if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
  const res = await sendToBackground(MSG.DELETE_PURCHASE, { id });
  if (res?.ok) { state = res; await renderAll(); }
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
    await renderAll();
    els.addForm.reset();
  }
}

// ======================== shared helpers ========================

function formatMoney(n, decimals = 2) {
  const fixed = Number(n).toFixed(decimals);
  return `$${decimals === 2 ? fixed.replace(/\.00$/, '') : fixed}`;
}

function formatDateShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
