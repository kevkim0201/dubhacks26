import { MSG, sendToBackground } from '../lib/messages.js';
import { renderCharacterSVG } from '../lib/character.js';
import { searchCoupons } from '../lib/coupons.js';

const $ = (id) => document.getElementById(id);

const els = {
  openDashboard: $('open-dashboard'),
  pendingSection: $('pending-section'),
  pendingList: $('pending-list'),
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
  findCoupons: $('find-coupons'),
  couponList: $('coupon-list'),
  couponEmpty: $('coupon-empty'),
  detectedStore: $('detected-store'),
  toggleManual: $('toggle-manual'),
  form: $('manual-form'),
  title: $('f-title'),
  store: $('f-store'),
  price: $('f-price'),
  savings: $('f-savings'),
  deadline: $('f-deadline'),
  scanPage: $('scan-page'),
  status: $('status'),
};

init();

async function init() {
  const state = await sendToBackground(MSG.GET_STATE);
  if (state?.ok) render(state);
  else setStatus("Couldn't load data.");

  els.openDashboard.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.toggleManual.addEventListener('click', () => {
    els.form.hidden = !els.form.hidden;
    els.toggleManual.textContent = els.form.hidden ? '+ Add a purchase manually' : '− Hide form';
    if (!els.form.hidden) els.title.focus();
  });

  els.form.addEventListener('submit', onManualSubmit);
  els.scanPage.addEventListener('click', onScanPage);
  els.findCoupons.addEventListener('click', onFindCoupons);

  // Honey Lifecycle: Automatically resolve current tab store & populate coupons
  await autoDetectStore();
}

function render(state) {
  const { settings, character, stats, pending } = state;

  renderPending(pending);

  els.statSaved.textContent = formatMoney(stats.totalSaved);
  els.statMonth.textContent = `+${formatMoney(stats.savedThisMonth)}`;

  els.tierLabel.textContent = `Tier ${character.level} · ${character.stage.label}`;

  els.art.innerHTML = renderCharacterSVG(character.stage.key, {
    skinColor: settings.skinColor,
    leafColor: settings.leafColor,
    flowerColor: settings.flowerColor,
    size: 150,
  });

  els.caption.textContent = character.stageIndex === 0
    ? `${settings.characterName} is waiting to sprout.`
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

async function autoDetectStore() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

    const res = await sendToBackground(MSG.RESOLVE_STORE, { url: tab.url, tabId: tab.id });
    const store = res?.store;

    if (store) {
      els.detectedStore.textContent = store.found ? `${store.name} (${store.domain})` : store.domain;
      els.detectedStore.hidden = false;

      if (!els.store.value && store.domain) {
        els.store.value = store.domain;
      }

      // Preload available coupons for the detected store
      const coupons = await searchCoupons({ store: store.domain, url: tab.url });
      renderCoupons(coupons);
      if (coupons.length > 0) {
        setStatus(`Found ${coupons.length} coupon${coupons.length === 1 ? '' : 's'} for ${store.name || store.domain}.`);
      }
    }
  } catch {
    // Tab querying may not be available on system pages
  }
}

// Savings-maximization entry point: detect whether
// this page has a coupon field and fetch candidate codes via Honey store resolution.
async function onFindCoupons() {
  setStatus('Looking for coupons…');
  els.findCoupons.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no active tab');

    let pageResult = null;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/coupon-finder.js'],
      });
      pageResult = result;
    } catch {
      // Content script injection might fail on restricted domains (e.g. Chrome Web Store)
    }

    const res = await sendToBackground(MSG.RESOLVE_STORE, { url: tab.url, tabId: tab.id });
    const resolvedStore = res?.store;
    const storeDomain = resolvedStore?.domain || pageResult?.store || new URL(tab.url).hostname.replace(/^www\./, '');

    if (resolvedStore) {
      els.detectedStore.textContent = resolvedStore.found ? `${resolvedStore.name} (${resolvedStore.domain})` : resolvedStore.domain;
      els.detectedStore.hidden = false;
    }

    const coupons = await searchCoupons({ store: storeDomain, url: tab.url });
    renderCoupons(coupons);

    const storeTitle = resolvedStore?.name || storeDomain;
    if (pageResult?.found) {
      setStatus(`Promo field detected! ${coupons.length ? `Found ${coupons.length} coupon${coupons.length === 1 ? '' : 's'} for ${storeTitle}.` : `No coupons found for ${storeTitle}.`}`);
    } else {
      setStatus(coupons.length ? `Found ${coupons.length} coupon${coupons.length === 1 ? '' : 's'} for ${storeTitle}.` : `No coupons found for ${storeTitle}.`);
    }
  } catch {
    setStatus("Can't check this page for coupons.");
  } finally {
    els.findCoupons.disabled = false;
  }
}

function renderCoupons(coupons) {
  els.couponList.innerHTML = '';
  els.couponEmpty.hidden = coupons.length > 0;

  for (const c of coupons) {
    const li = document.createElement('li');
    li.className = 'coupon-item';

    const code = document.createElement('span');
    code.className = 'coupon-item__code';
    code.textContent = c.code;

    const desc = document.createElement('span');
    desc.className = 'coupon-item__desc';
    desc.textContent = c.description || '';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(c.code).catch(() => {});
      setStatus(`Copied "${c.code}".`);
    });

    li.append(code, desc, copyBtn);
    els.couponList.appendChild(li);
  }
}

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
