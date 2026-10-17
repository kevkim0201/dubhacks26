// src/popup/purchase-history.js
import { formatCurrency } from '../lib/savings.js';

/**
 * Renders the confirmed purchase history list
 * @param {HTMLElement} container
 * @param {Object} options
 * @param {Array} options.purchases
 * @param {Function} options.onDelete - Called with (purchaseId, purchaseRecord)
 */
export function renderPurchaseHistory(container, { purchases = [], onDelete = () => {} }) {
  container.replaceChildren();

  const section = document.createElement('section');
  section.className = 'purchase-history-section';

  const heading = document.createElement('h3');
  heading.className = 'history-heading';
  heading.textContent = 'Purchase History';
  section.appendChild(heading);

  if (!purchases || purchases.length === 0) {
    const emptyText = document.createElement('p');
    emptyText.className = 'history-empty-text';
    emptyText.textContent = 'No confirmed purchases yet.';
    section.appendChild(emptyText);
    container.appendChild(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'purchase-list';

  purchases.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'purchase-item';
    li.dataset.id = item.id;

    // Item details
    const info = document.createElement('div');
    info.className = 'purchase-info';

    const title = document.createElement('span');
    title.className = 'purchase-title';
    title.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'purchase-meta';
    const dateStr = item.purchaseDate ? new Date(item.purchaseDate).toLocaleDateString() : '';
    meta.textContent = `${item.store || 'Store'}${dateStr ? ` • ${dateStr}` : ''}`;

    info.append(title, meta);

    // Financial tags
    const stats = document.createElement('div');
    stats.className = 'purchase-stats';

    const paid = document.createElement('span');
    paid.className = 'purchase-price';
    paid.textContent = `Paid: ${formatCurrency(item.pricePaid)}`;

    const saved = document.createElement('span');
    saved.className = 'purchase-savings';
    saved.textContent = `Saved: ${formatCurrency(item.savings)}`;

    stats.append(paid, saved);

    // Delete trigger
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-purchase';
    deleteBtn.textContent = 'Delete';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', `Delete ${item.title}`);
    deleteBtn.addEventListener('click', () => onDelete(item.id, item));

    li.append(info, stats, deleteBtn);
    list.appendChild(li);
  });

  section.appendChild(list);
  container.appendChild(section);
}