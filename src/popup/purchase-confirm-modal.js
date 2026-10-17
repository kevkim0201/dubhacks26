// Purchase confirmation modal: shows what a purchase saves before it's
// recorded, then whether saving worked.
// Owned by: Deetya.
//
// Built on <dialog>.showModal(), which gives focus trapping, Esc-to-close
// and an inert page behind it for free. The elements are created on open
// and removed on close, so the only page setup is the stylesheet link.
// Product names come from scraped pages, so text is set with textContent.
import { formatCurrency } from '../lib/savings.js';

const SUCCESS_CLOSE_MS = 1400;
const GENERIC_ERROR = "Couldn't save this purchase. Please try again.";

let openCount = 0;

/**
 * Ask the user to confirm a purchase, then save it.
 *
 * `onConfirm` does the actual save and resolves to `{ ok: true }` or
 * `{ ok: false, error }` -- the shape the background worker replies with.
 * Throwing works too. On success the modal shows "Saved!" and closes
 * itself; on failure it shows the error and stays open to retry.
 *
 * @param {{
 *   title: string, store?: string, couponCode?: string,
 *   originalPrice: number, finalPrice: number, savings: number,
 *   onConfirm: () => Promise<{ ok: boolean, error?: string }>,
 * }} details
 * @returns {Promise<'confirmed' | 'cancelled'>}
 */
export function openPurchaseConfirmModal(details) {
  return new Promise((resolve) => {
    const ui = buildDialog(details);
    let state = 'idle'; // idle | saving | success | error
    let closed = false;
    let closeTimer = null;

    const close = () => {
      if (closed || state === 'saving') return;
      closed = true;
      clearTimeout(closeTimer);
      ui.dialog.close();
      ui.dialog.remove();
      resolve(state === 'success' ? 'confirmed' : 'cancelled');
    };

    const setState = (next, message = '') => {
      state = next;
      ui.dialog.dataset.state = next;
      ui.confirm.disabled = next === 'saving';
      ui.cancel.disabled = next === 'saving';
      ui.confirm.textContent = { saving: 'Saving…', error: 'Try again' }[next] || 'Confirm purchase';
      ui.actions.hidden = next === 'success';
      ui.error.hidden = next !== 'error';
      ui.error.textContent = next === 'error' ? message : '';
      ui.success.hidden = next !== 'success';
    };

    ui.confirm.addEventListener('click', async () => {
      if (state === 'saving') return;
      setState('saving');

      let result;
      try {
        result = await details.onConfirm();
      } catch (err) {
        result = { ok: false, error: err?.message || String(err) };
      }

      if (closed) return;
      if (result?.ok) {
        setState('success');
        closeTimer = setTimeout(close, SUCCESS_CLOSE_MS);
      } else {
        setState('error', friendlyError(result?.error));
        ui.confirm.focus();
      }
    });

    ui.cancel.addEventListener('click', close);

    // Esc fires `cancel`; handle it ourselves so it can't interrupt a save.
    ui.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });

    // A click on the dialog element itself (not its content) is the backdrop.
    ui.dialog.addEventListener('click', (e) => {
      if (e.target === ui.dialog) close();
    });

    document.body.append(ui.dialog);
    ui.dialog.showModal();
    ui.confirm.focus();
  });
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Modal numbers for a detected purchase awaiting review. The review card
 * holds what was paid and saved, so the original price is their sum.
 * Values may be strings straight from the card's inputs.
 */
export function confirmDetailsFromPending({ title, store, pricePaid, savings }) {
  const finalPrice = round2(pricePaid);
  const saved = round2(savings);
  return { title, store, originalPrice: round2(finalPrice + saved), finalPrice, savings: saved };
}

/**
 * Modal numbers for the current deal (savings-storage.js): the final
 * price is the sale price minus the coupon.
 */
export function confirmDetailsFromDeal(deal) {
  const finalPrice = round2(deal.discountedPrice - (deal.couponSavings || 0));
  return {
    title: deal.title || 'This product',
    store: deal.store || '',
    couponCode: deal.couponCode || '',
    originalPrice: round2(deal.originalPrice),
    finalPrice,
    savings: round2(deal.potentialSavings ?? deal.originalPrice - finalPrice),
  };
}

// The background worker replies with String(err), e.g.
// "Error: pricePaid must be a non-negative number" -- drop the prefix.
export function friendlyError(error) {
  const text = String(error || '')
    .replace(/^\w*Error:\s*/, '')
    .replace(/\bpricePaid\b/g, 'price paid')
    .trim();
  if (/^Duplicate purchase ID/i.test(text)) return 'This purchase is already saved.';
  return text ? `${capitalize(text)}.`.replace(/\.\.$/, '.') : GENERIC_ERROR;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function priceRow(label, value, modifier) {
  const row = el('div', `pcm-row${modifier ? ` pcm-row--${modifier}` : ''}`);
  row.append(el('dt', '', label), el('dd', '', value));
  return row;
}

function buildDialog({ title, store = '', couponCode = '', originalPrice, finalPrice, savings }) {
  const id = `pcm-${++openCount}`;

  const dialog = el('dialog', 'pcm');
  dialog.dataset.state = 'idle';
  dialog.setAttribute('aria-labelledby', `${id}-heading`);

  const body = el('div', 'pcm-body');

  const heading = el('h2', 'pcm-heading', 'Confirm this purchase?');
  heading.id = `${id}-heading`;

  const product = el('div', 'pcm-product');
  const name = el('p', 'pcm-product__name', title || 'Purchase');
  const meta = el('p', 'pcm-product__meta');
  if (store) meta.append(el('span', '', store));
  if (couponCode) meta.append(el('span', 'pcm-coupon', couponCode));
  product.append(name);
  if (meta.childElementCount) product.append(meta);

  const prices = el('dl', 'pcm-prices');
  const hasDiscount = originalPrice > finalPrice;
  prices.append(
    priceRow('Original price', formatCurrency(originalPrice), hasDiscount ? 'struck' : ''),
    priceRow('Final price', formatCurrency(finalPrice)),
  );

  const save = el('div', `pcm-savings${savings > 0 ? '' : ' pcm-savings--none'}`);
  const saveLabel = el('span', 'pcm-savings__label', 'You save');
  const saveAmount = el('span', 'pcm-savings__amount', formatCurrency(savings));
  save.append(saveLabel, saveAmount);
  if (savings > 0 && originalPrice > 0) {
    save.append(el('span', 'pcm-savings__pct', `${Math.round((savings / originalPrice) * 100)}% off`));
  }

  // Announced by screen readers when it appears.
  const error = el('p', 'pcm-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const success = el('p', 'pcm-success');
  success.setAttribute('role', 'status');
  success.append(
    el('span', 'pcm-success__check', '✓'),
    el('span', '', savings > 0 ? `Saved! +${formatCurrency(savings)} to your savings` : 'Saved!'),
  );
  success.hidden = true;

  const actions = el('div', 'pcm-actions');
  const cancel = el('button', 'pcm-cancel', 'Cancel');
  cancel.type = 'button';
  const confirm = el('button', 'pcm-confirm primary', 'Confirm purchase');
  confirm.type = 'button';
  actions.append(cancel, confirm);

  body.append(heading, product, prices, save, error, success, actions);
  dialog.append(body);

  return { dialog, confirm, cancel, actions, error, success };
}
