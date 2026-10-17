import { MSG, sendToBackground } from '../lib/messages.js';
import { renderCharacterSVG } from '../lib/character.js';
import { mountSquirrelScene } from '../lib/squirrelScene.js';
import { searchCoupons, rankCoupons, humanizeStoreName } from '../lib/coupons.js';
import { renderPurchaseHistory } from './purchase-history.js';
import { mountDealSavingsView } from '../../savings-storage/deal-savings-view.js';
import { seedMockDealIfDemo } from '../../savings-storage/mock-deal.js';

const $ = (id) => document.getElementById(id);

const els = {
  viewMain: $('view-main'),
  viewCoupons: $('view-coupons'),

  openDashboard: $('open-dashboard'),
  pendingSection: $('pending-section'),
  pendingList: $('pending-list'),
  historySection: $('purchase-history-section'),
  statSaved: $('stat-saved'),
  statMonth: $('stat-month'),
  tierPill: $('tier-pill'),
  tierLabel: $('tier-label'),
  art: $('character-art'),
  caption: $('character-caption'),
  nextTierLabel: $('next-tier-label'),
  xpCount: $('xp-count'),
  xpFill: $('xp-fill'),
  progressNote: $('progress-note'),
  dueSection: $('due-soon-section'),
  dueList: $('due-list'),
  dealSavings: $('deal-savings'),
  openCoupons: $('open-coupons'),
  toggleManual: $('toggle-manual'),
  form: $('manual-form'),
  title: $('f-title'),
  store: $('f-store'),
  price: $('f-price'),
  savings: $('f-savings'),
  deadline: $('f-deadline'),
  scanPage: $('scan-page'),
  status: $('status'),

  openDashboard2: $('open-dashboard-2'),
  couponsBack: $('coupons-back'),
  couponsContext: $('coupons-context'),
  saveCard: $('save-card'),
  saveStatus: $('save-status'),
  saveAmount: $('save-amount'),
  saveDesc: $('save-desc'),
  checkoutWas: $('checkout-was'),
  checkoutNow: $('checkout-now'),
  couponsCount: $('coupons-count'),
  couponOptions: $('coupon-options'),
  couponsLoading: $('coupons-loading'),
  couponsNone: $('coupons-none'),
  couponsFootnote: $('coupons-footnote'),
  couponsInsight: $('coupons-insight'),
  couponsInsightText: $('coupons-insight-text'),
  applyBtn: $('apply-coupon'),
  applyBtnLabel: $('apply-btn-label'),
  applyCaption: $('apply-caption'),
  pipFooterArt: $('pip-footer-art'),
  couponsStatus: $('coupons-status'),
};

let currentState = null;
// Scratch state for the coupons view -- rebuilt each time it's opened.
let couponsCtx = { tabId: null, store: null, cartTotal: null, shipping: null, ranked: [], selectedId: null };

// Undo banner state for purchase deletion
let lastDeletedPurchase = null;
let undoBannerTimer = null;

// The popup's main character display -- mounted once (it has its own
// render loop; re-creating it on every render() would be wasteful and
// would replay the fall-in animation every time the popup refreshes).
// Pip (renderCharacterSVG) is still used for every *other* character
// icon in this file (the coupons-view footer) -- only the big main-view
// display is the 3D squirrel.
const squirrelScene = mountSquirrelScene(els.art, { size: 150 });

// When the background opens this as its own floating window (see
// service-worker.js's openCouponsPopup(), triggered by content.js
// passively noticing a coupon field), the URL carries which *original*
// tab this is about -- there's no real "active tab in this window" to
// query, since this window only ever contains the popup page itself.
const launchParams = new URLSearchParams(location.search);
const launchTabId = launchParams.get('tabId') ? Number(launchParams.get('tabId')) : null;
const launchView = launchParams.get('view');

init();

async function init() {
  const state = await sendToBackground(MSG.GET_STATE);
  if (state?.ok) render(state);
  else setStatus("Couldn't load data.");

  els.openDashboard.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.openDashboard2.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.toggleManual.addEventListener('click', () => {
    els.form.hidden = !els.form.hidden;
    els.toggleManual.textContent = els.form.hidden ? '+ Add a purchase manually' : '− Hide form';
    if (!els.form.hidden) els.title.focus();
  });

  els.form.addEventListener('submit', onManualSubmit);
  els.scanPage.addEventListener('click', onScanPage);

  els.openCoupons.addEventListener('click', () => onOpenCoupons());
  els.couponsBack.addEventListener('click', () => showView('main'));
  els.applyBtn.addEventListener('click', onApplyCoupon);

  const tab = launchTabId != null
    ? await chrome.tabs.get(launchTabId).catch(() => null)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  await seedMockDealIfDemo(tab?.url).catch(() => {});
  mountDealSavingsView(els.dealSavings, { tabUrl: tab?.url });

  if (launchView === 'coupons' && launchTabId != null) onOpenCoupons(launchTabId);
}

function showView(view) {
  els.viewMain.hidden = view !== 'main';
  els.viewCoupons.hidden = view !== 'coupons';
}

function render(state) {
  currentState = state;
  const { settings, character, stats, pending, purchases } = state;

  renderPending(pending);
  renderHistory(purchases || []);

  els.statSaved.textContent = formatMoney(stats.totalSaved);
  els.statMonth.textContent = `+${formatMoney(stats.savedThisMonth)}`;

  els.tierLabel.textContent = `Tier ${character.level} · ${character.stage.label}`;

  squirrelScene.syncToXP(character.xp);

  els.caption.textContent = character.stageIndex === 0
    ? `${settings.characterName} is waiting for your first saved purchase.`
    : `${settings.characterName}'s growing, thanks to your savings.`;

  if (character.next) {
    els.nextTierLabel.textContent = `Next up: ${character.next.label}`;
    els.xpCount.textContent = `${Math.round(character.xp).toLocaleString()} / ${character.next.minXp.toLocaleString()} XP`;
    els.xpFill.style.width = `${Math.round(character.progress * 100)}%`;
    els.progressNote.innerHTML = `<strong>${formatMoney(character.dollarsToNext)}</strong> to go &middot; ${character.next.label} unlocks at ${formatMoney(character.next.minSaved, 0)} saved`;
  } else {
    els.nextTierLabel.textContent = 'Max tier reached';
    els.xpCount.textContent = `${Math.round(character.xp).toLocaleString()} XP`;
    els.xpFill.style.width = '100%';
    els.progressNote.textContent = `${settings.characterName} has fully grown. Keep saving to keep the streak alive.`;
  }

  renderDueSoon(stats.dueSoon);
}

function renderPending(pending) {
  els.pendingSection.hidden = !pending || pending.length === 0;
  els.pendingList.innerHTML = '';
  if (!pending) return;

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
      const state = await sendToBackground(MSG.CONFIRM_PENDING, { id: p.id, patch });
      if (state?.ok) { render(state); setStatus(`Added "${patch.title}".`); }
    });

    card.querySelector('.p-dismiss').addEventListener('click', async () => {
      const state = await sendToBackground(MSG.DISMISS_PENDING, { id: p.id });
      if (state?.ok) { render(state); setStatus('Dismissed.'); }
    });

    els.pendingList.appendChild(card);
  }
}

function renderDueSoon(dueSoon) {
  els.dueSection.hidden = dueSoon.length === 0;
  els.dueList.innerHTML = '';

  for (const p of dueSoon.slice(0, 3)) {
    const li = document.createElement('li');
    li.className = 'due-item';

    const title = document.createElement('span');
    title.className = 'due-item__title';
    title.textContent = p.title;

    const badge = document.createElement('span');
    badge.className = 'due-item__badge' + (p.daysLeft <= 1 ? ' due-item__badge--urgent' : '');
    badge.textContent = p.daysLeft === 0 ? 'Today' : `${p.daysLeft}d`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Returned';
    btn.addEventListener('click', async () => {
      const state = await sendToBackground(MSG.MARK_RETURNED, { id: p.id, returned: true });
      if (state?.ok) { render(state); setStatus(`Marked "${p.title}" as returned.`); }
    });

    li.append(title, badge, btn);
    els.dueList.appendChild(li);
  }
}

async function onManualSubmit(e) {
  e.preventDefault();
  if (!els.title.value.trim() || !els.price.value) {
    setStatus('Title and price paid are required.');
    return;
  }

  const payload = {
    title: els.title.value,
    store: els.store.value,
    pricePaid: els.price.value,
    savings: els.savings.value || 0,
    returnDeadline: els.deadline.value ? new Date(els.deadline.value).toISOString() : null,
  };

  const state = await sendToBackground(MSG.ADD_PURCHASE, payload);
  if (state?.ok) {
    render(state);
    els.form.reset();
    els.form.hidden = true;
    els.toggleManual.textContent = '+ Add a purchase manually';
    setStatus(`Added "${payload.title}".`);
  } else {
    setStatus("Couldn't save that purchase.");
  }
}

// Reads obvious price/title signals from the active tab's page -- a manual
// assist for the "add manually" fallback, same idea as auto-detection but
// triggered by the user's click.
async function onScanPage() {
  setStatus('Scanning page…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no active tab');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPageForProduct,
    });

    if (result?.title) els.title.value = result.title;
    if (result?.price != null) els.price.value = result.price;
    setStatus(result?.title || result?.price != null ? 'Filled from page.' : 'Nothing obvious found on this page.');
  } catch {
    setStatus("Can't scan this page.");
  }
}

// Injected into the page -- must be self-contained (no closures over
// outer-scope variables, no imports).
function scanPageForProduct() {
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim();

  const priceRaw =
    meta('product:price:amount') ||
    meta('og:price:amount') ||
    document.querySelector('[itemprop="price"]')?.getAttribute('content') ||
    document.querySelector('[itemprop="price"]')?.textContent;

  const price = priceRaw ? parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) : null;
  const title = meta('og:title') || document.title || null;

  return {
    title: title ? title.slice(0, 140) : null,
    price: Number.isFinite(price) ? price : null,
  };
}

// ======================== Coupons & savings view ========================
// Owned by: <you> + Rohit.

// `explicitTabId` is set when this popup was opened as its own floating
// window targeting a specific tab (see the launchTabId handling in
// init() above) -- otherwise this is a normal toolbar-popup open, and
// the active tab of *this* window is the right one to check.
async function onOpenCoupons(explicitTabId) {
  showView('coupons');
  resetCouponsView();

  try {
    const tab = explicitTabId != null
      ? await chrome.tabs.get(explicitTabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id || !tab.url) throw new Error('no active tab');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/coupon-finder.js'],
    });

    const store = result?.store || safeHostname(tab.url);
    let cartTotal = result?.cartTotal ?? null;
    let shipping = result?.shipping ?? null;

    // Demo fallback: example.com (the designated test store -- see
    // coupons.js's MOCK_COUPONS) has no real cart to scrape, so this
    // keeps the whole flow screenshot-demoable without a live checkout.
    // Any other store shows the honest "couldn't find your cart" state.
    if (cartTotal == null && store === 'example.com') {
      cartTotal = 120;
      shipping = 6;
    }

    couponsCtx = { tabId: tab.id, store, cartTotal, shipping, ranked: [], selectedId: null };

    els.couponsContext.textContent = cartTotal != null
      ? `At ${humanizeStoreName(store)} · ${formatMoney(cartTotal)} cart + ${formatMoney(shipping || 0)} shipping`
      : `At ${humanizeStoreName(store)} · couldn't find your cart total on this page`;

    const coupons = await searchCoupons({ store, url: tab.url });
    renderCouponOptions(coupons);
  } catch {
    els.couponsLoading.hidden = true;
    els.couponsNone.hidden = false;
    els.couponsNone.textContent = "Can't check this page for coupons.";
  }
}

function resetCouponsView() {
  els.couponsContext.textContent = 'Checking this page…';
  els.couponOptions.innerHTML = '';
  els.couponsLoading.hidden = false;
  els.couponsNone.hidden = true;
  els.saveCard.hidden = true;
  els.couponsFootnote.hidden = true;
  els.couponsInsight.hidden = true;
  els.applyBtn.disabled = true;
  els.applyBtnLabel.textContent = 'Select a coupon';
  couponsCtx = { tabId: null, store: null, cartTotal: null, shipping: null, ranked: [], selectedId: null };

  if (currentState) {
    els.pipFooterArt.innerHTML = renderCharacterSVG(currentState.character.stage.key, {
      skinColor: currentState.settings.skinColor,
      leafColor: currentState.settings.leafColor,
      flowerColor: currentState.settings.flowerColor,
      size: 44,
    });
  }
}

function renderCouponOptions(coupons) {
  els.couponsLoading.hidden = true;
  els.couponOptions.innerHTML = '';

  if (!coupons.length) {
    els.couponsNone.hidden = false;
    els.couponsCount.textContent = '0 offers';
    return;
  }
  els.couponsNone.hidden = true;

  const { cartTotal, shipping } = couponsCtx;
  const ranked = cartTotal != null
    ? rankCoupons(coupons, { cartTotal, shipping: shipping || 0 })
    : coupons.map((c) => ({ ...c, eligible: true, savings: null, estimatedTotal: null, best: false }));

  couponsCtx.ranked = ranked;
  couponsCtx.selectedId = ranked.find((c) => c.best)?.id ?? ranked.find((c) => c.eligible)?.id ?? ranked[0]?.id ?? null;

  els.couponsCount.textContent = `${ranked.length} offer${ranked.length === 1 ? '' : 's'}`;
  els.couponsFootnote.hidden = cartTotal == null;

  for (const c of ranked) {
    els.couponOptions.appendChild(buildCouponOption(c));
  }

  renderInsight(ranked);
  renderSaveCard();
}

function buildCouponOption(c) {
  const label = document.createElement('label');
  label.className = 'coupon-option' + (!c.eligible ? ' is-disabled' : '');
  label.classList.toggle('is-selected', c.id === couponsCtx.selectedId);
  label.dataset.id = c.id;

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'coupon-choice';
  input.className = 'coupon-option__input';
  input.value = c.id;
  input.checked = c.id === couponsCtx.selectedId;
  input.disabled = !c.eligible;
  input.addEventListener('change', () => {
    couponsCtx.selectedId = c.id;
    for (const el of els.couponOptions.querySelectorAll('.coupon-option')) {
      el.classList.toggle('is-selected', el.dataset.id === couponsCtx.selectedId);
    }
    renderSaveCard();
  });

  const radio = document.createElement('span');
  radio.className = 'coupon-option__radio';

  const main = document.createElement('span');
  main.className = 'coupon-option__main';

  const codeRow = document.createElement('span');
  codeRow.className = 'coupon-option__code-row';
  const code = document.createElement('span');
  code.className = 'coupon-option__code';
  code.textContent = c.code;
  codeRow.appendChild(code);
  if (c.best) {
    const pill = document.createElement('span');
    pill.className = 'coupon-option__best-pill';
    pill.textContent = 'Best';
    codeRow.appendChild(pill);
  }

  const desc = document.createElement('span');
  desc.className = 'coupon-option__desc';
  desc.textContent = c.description || '';

  main.append(codeRow, desc);

  const right = document.createElement('span');
  right.className = 'coupon-option__right';
  const save = document.createElement('span');
  save.className = 'coupon-option__save';
  const total = document.createElement('span');
  total.className = 'coupon-option__total';

  if (c.savings == null) {
    save.textContent = '—';
  } else if (!c.eligible) {
    save.textContent = `Needs $${c.minCart} cart`;
  } else {
    save.textContent = `Save ${formatMoney(c.savings)}`;
    total.textContent = `${formatMoney(c.estimatedTotal)} total*`;
  }
  right.append(save, total);

  label.append(input, radio, main, right);
  return label;
}

function renderSaveCard() {
  const selected = couponsCtx.ranked.find((c) => c.id === couponsCtx.selectedId);
  if (!selected || selected.savings == null) {
    els.saveCard.hidden = true;
    els.applyBtn.disabled = true;
    els.applyBtnLabel.textContent = 'Select a coupon';
    return;
  }

  els.saveCard.hidden = false;
  els.saveStatus.textContent = 'Not applied yet';
  els.saveStatus.className = 'save-card__status';
  els.saveAmount.textContent = formatMoney(selected.savings);
  els.saveDesc.textContent = selected.description || '';

  const { cartTotal, shipping } = couponsCtx;
  els.checkoutWas.textContent = formatMoney(cartTotal + (shipping || 0));
  els.checkoutNow.textContent = formatMoney(selected.estimatedTotal);

  els.applyBtn.disabled = !selected.eligible;
  els.applyBtnLabel.textContent = selected.eligible
    ? `Apply ${selected.code} · save ${formatMoney(selected.savings)}`
    : `${selected.code} not eligible yet`;
}

function renderInsight(ranked) {
  const eligible = ranked.filter((c) => c.eligible && c.savings != null);
  const diff = eligible.length >= 2 ? round2(eligible[0].savings - eligible[1].savings) : 0;

  if (diff <= 0) {
    els.couponsInsight.hidden = true;
    return;
  }
  els.couponsInsight.hidden = false;
  els.couponsInsightText.textContent = `${eligible[0].code} saves ${formatMoney(diff)} more than ${eligible[1].code}.`;
}

async function onApplyCoupon() {
  const selected = couponsCtx.ranked.find((c) => c.id === couponsCtx.selectedId);
  if (!selected || !couponsCtx.tabId) return;

  els.applyBtn.disabled = true;
  const prevLabel = els.applyBtnLabel.textContent;
  els.applyBtnLabel.textContent = 'Applying…';

  try {
    // Re-inject in case the page navigated since coupon-finder.js first
    // ran -- cheap, and keeps window.__pocketCoupon fresh either way.
    await chrome.scripting.executeScript({
      target: { tabId: couponsCtx.tabId },
      files: ['src/content/coupon-finder.js'],
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: couponsCtx.tabId },
      func: (code) => window.__pocketCoupon?.applyCouponOnPage(code),
      args: [selected.code],
    });

    if (result?.applied) {
      els.saveStatus.textContent = 'Applied';
      els.saveStatus.className = 'save-card__status save-card__status--applied';
      setCouponsStatus(`Applied "${selected.code}" -- check the page to confirm it took.`);
    } else {
      setCouponsStatus(result?.reason || "Couldn't apply this code automatically -- try pasting it at checkout.");
    }
  } catch {
    setCouponsStatus("Couldn't reach this page to apply the code.");
  } finally {
    els.applyBtn.disabled = !selected.eligible;
    els.applyBtnLabel.textContent = prevLabel;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'this site';
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ======================== shared helpers ========================

function formatMoney(n, decimals = 2) {
  const fixed = Number(n).toFixed(decimals);
  return `$${decimals === 2 ? fixed.replace(/\.00$/, '') : fixed}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

let statusTimer;
function setStatus(text) {
  els.status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { els.status.textContent = ''; }, 2500);
}

let couponsStatusTimer;
function setCouponsStatus(text) {
  els.couponsStatus.textContent = text;
  clearTimeout(couponsStatusTimer);
  couponsStatusTimer = setTimeout(() => { els.couponsStatus.textContent = ''; }, 3000);
}

// ======================== Purchase History & Undo ========================

function renderHistory(purchases) {
  if (!els.historySection) return;
  renderPurchaseHistory(els.historySection, {
    purchases,
    onDelete: (id, item) => handleDeletePurchase(id, item),
  });
}

async function handleDeletePurchase(id, item) {
  const state = await sendToBackground(MSG.DELETE_PURCHASE, { id });
  if (state?.ok && state.deleted) {
    lastDeletedPurchase = state.deleted;
    showUndoToast(state.deleted);
    render(state);
    setStatus(`Removed "${item.title}".`);
  } else if (state?.ok) {
    setStatus("That purchase was already removed.");
  } else {
    setStatus(state?.error || "Couldn't delete purchase.");
  }
}

function showUndoToast(item) {
  const existing = document.getElementById('undo-toast');
  if (existing) existing.remove();
  clearTimeout(undoBannerTimer);

  const toast = document.createElement('div');
  toast.id = 'undo-toast';
  toast.className = 'undo-toast';

  const label = document.createElement('span');
  label.textContent = `Removed "${item.title}". `;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'undo-btn';
  btn.textContent = 'Undo';
  btn.onclick = async () => {
    if (!lastDeletedPurchase) return;
    const restored = await sendToBackground(MSG.ADD_PURCHASE, lastDeletedPurchase);
    if (restored?.ok) {
      clearTimeout(undoBannerTimer);
      undoBannerTimer = null;
      toast.remove();
      lastDeletedPurchase = null;
      render(restored);
      setStatus(`Restored "${item.title}".`);
    } else {
      setStatus(restored?.error || "Couldn't restore purchase.");
    }
  };

  toast.append(label, btn);
  document.body.appendChild(toast);

  undoBannerTimer = setTimeout(() => {
    toast.remove();
    lastDeletedPurchase = null;
  }, 5000);
}