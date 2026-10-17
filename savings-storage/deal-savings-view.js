// Current-product savings card: original price, discounted price, coupon
// savings and potential savings for the product on the active tab.
// Owned by: Deetya.
//
// Reads from savings-storage.js and re-renders whenever another view (or
// the background) saves a new deal, so the card never needs a manual
// refresh. The card hides itself when there's no deal, or when the stored
// deal belongs to a different page than the one the popup was opened on.
import {
  clearCurrentDealSavings,
  getCurrentDealSavings,
  onCurrentDealSavingsChanged,
} from './savings-storage.js';
import { formatCurrency } from '../src/lib/savings.js';
import { MSG, sendToBackground } from '../src/lib/messages.js';
import {
  confirmDetailsFromDeal,
  openPurchaseConfirmModal,
} from '../src/popup/purchase-confirm-modal.js';

/**
 * Render the card into `container` and keep it in sync with storage.
 * @param {HTMLElement} container  empty element the card renders into
 * @param {{ tabUrl?: string, onPurchaseSaved?: (state: object) => void }} [opts]
 *   tabUrl: active tab's URL; when given, a deal saved for a different
 *   page is treated as stale and not shown. onPurchaseSaved: called with
 *   the background's new state after "I bought this" saves the purchase,
 *   so the popup can redraw its totals and history.
 * @returns {Promise<() => void>} unmount function (stops listening)
 */
export async function mountDealSavingsView(container, { tabUrl, onPurchaseSaved } = {}) {
  const card = buildCard();
  container.replaceChildren(card.root);

  let current = null;
  const update = (deal) => {
    current = isForPage(deal, tabUrl) ? deal : null;
    renderDeal(card, current);
  };

  card.bought.addEventListener('click', () => {
    if (current) confirmDealPurchase(current, onPurchaseSaved);
  });

  update(await getCurrentDealSavings());
  const unsubscribe = onCurrentDealSavingsChanged(update);

  return () => {
    unsubscribe();
    container.replaceChildren();
  };
}

function buildCard() {
  const root = document.createElement('section');
  root.className = 'deal-card';
  root.hidden = true;
  root.setAttribute('aria-label', 'Savings on this product');

  root.innerHTML = `
    <div class="deal-card__head">
      <p class="deal-card__eyebrow">This product</p>
      <span class="deal-card__store" data-ref="store"></span>
    </div>
    <p class="deal-card__title" data-ref="title"></p>

    <dl class="deal-card__lines">
      <div class="deal-card__line">
        <dt>Original price</dt>
        <dd data-ref="original"></dd>
      </div>
      <div class="deal-card__line">
        <dt>Discounted price</dt>
        <dd data-ref="discounted"></dd>
      </div>
      <div class="deal-card__line deal-card__line--coupon">
        <dt>Coupon savings <span class="deal-card__code" data-ref="code"></span></dt>
        <dd data-ref="coupon"></dd>
      </div>
    </dl>

    <hr class="deal-card__divider" />

    <div class="deal-card__total">
      <div>
        <p class="deal-card__total-label">Potential savings</p>
        <p class="deal-card__total-sub" data-ref="pct"></p>
      </div>
      <span class="deal-card__total-amount" data-ref="potential"></span>
    </div>

    <button type="button" class="deal-card__bought primary" data-ref="bought">I bought this</button>
  `;

  const refs = Object.fromEntries(
    [...root.querySelectorAll('[data-ref]')].map((el) => [el.dataset.ref, el]),
  );
  return { root, ...refs };
}

function renderDeal(card, deal) {
  if (!deal) {
    card.root.hidden = true;
    return;
  }
  card.root.hidden = false;

  // potentialSavings is always set by saveCurrentDealSavings().
  const { originalPrice, discountedPrice, couponSavings = 0, potentialSavings: potential } = deal;
  const saleSavings = originalPrice - discountedPrice;

  card.store.textContent = deal.store || '';
  card.store.hidden = !deal.store;
  card.title.textContent = deal.title || '';
  card.title.hidden = !deal.title;

  card.original.textContent = formatCurrency(originalPrice);
  // Strike through the original only when there's actually a sale price.
  card.original.classList.toggle('is-struck', saleSavings > 0);

  card.discounted.textContent = formatCurrency(discountedPrice);

  card.coupon.textContent = couponSavings > 0 ? `−${formatCurrency(couponSavings)}` : '—';
  card.code.textContent = deal.couponCode || '';
  card.code.hidden = !deal.couponCode;

  card.potential.textContent = formatCurrency(potential);
  card.pct.textContent = originalPrice > 0 && potential > 0
    ? `${Math.round((potential / originalPrice) * 100)}% off · you'd pay ${formatCurrency(originalPrice - potential)}`
    : 'No savings found yet';
}

/**
 * The purchase to record for a deal: paid the sale price minus the
 * coupon, saved the potential savings. Matches confirmDetailsFromDeal(),
 * so the modal shows exactly what gets saved.
 */
export function purchaseFromDeal(deal) {
  const { title, store, finalPrice, savings } = confirmDetailsFromDeal(deal);
  return { title, store, url: deal.url || '', pricePaid: finalPrice, savings, source: 'manual' };
}

// Confirm, then save through the background's normal add-purchase flow
// and clear the deal so its savings can't be counted twice.
function confirmDealPurchase(deal, onPurchaseSaved) {
  openPurchaseConfirmModal({
    ...confirmDetailsFromDeal(deal),
    onConfirm: async () => {
      const state = await sendToBackground(MSG.ADD_PURCHASE, purchaseFromDeal(deal));
      if (state?.ok) {
        await clearCurrentDealSavings();
        onPurchaseSaved?.(state);
      }
      return state ?? { ok: false };
    },
  });
}

// A deal without a url can't be checked, so it's assumed current.
function isForPage(deal, tabUrl) {
  if (!deal) return false;
  if (!deal.url || !tabUrl) return true;
  return pageKey(deal.url) === pageKey(tabUrl);
}

function pageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
