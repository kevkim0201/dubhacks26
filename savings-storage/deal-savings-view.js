// Current-product savings card: original price, discounted price, coupon
// savings and potential savings for the product on the active tab.
// Owned by: Deetya.
//
// Reads from savings-storage.js and re-renders whenever another view (or
// the background) saves a new deal, so the card never needs a manual
// refresh. The card hides itself when there's no deal, or when the stored
// deal belongs to a different page than the one the popup was opened on.
import {
  getCurrentDealSavings,
  onCurrentDealSavingsChanged,
} from './savings-storage.js';
import { formatCurrency } from '../src/lib/savings.js';

/**
 * Render the card into `container` and keep it in sync with storage.
 * @param {HTMLElement} container  empty element the card renders into
 * @param {{ tabUrl?: string }} [opts]  active tab's URL; when given, a deal
 *   saved for a different page is treated as stale and not shown
 * @returns {Promise<() => void>} unmount function (stops listening)
 */
export async function mountDealSavingsView(container, { tabUrl } = {}) {
  const card = buildCard();
  container.replaceChildren(card.root);

  const update = (deal) => renderDeal(card, isForPage(deal, tabUrl) ? deal : null);

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
