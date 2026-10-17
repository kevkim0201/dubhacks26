// savings-view.js — renders the lifetime-savings dashboard into a container.
// Uses createElement/textContent only (product names are untrusted page text).
import { formatCurrency } from "../lib/savings.js";
import { getSavingsSummary } from "../lib/savings-summary.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(label, value) {
  const box = el("div", "savings-stat");
  box.append(el("span", "savings-stat-label", label), el("span", "savings-stat-value", value));
  return box;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function renderSavingsDashboard(container, summary) {
  container.replaceChildren();
  container.classList.add("savings-dashboard");

  container.append(el("h2", "savings-title", "Your savings"));

  if (summary.purchaseCount === 0) {
    const empty = el("div", "savings-empty");
    empty.append(
      el("p", "savings-empty-title", "No purchases tracked yet"),
      el("p", "savings-empty-hint", "Confirm a purchase after checkout and your savings will show up here.")
    );
    container.append(empty);
    return;
  }

  const hero = el("div", "savings-hero");
  hero.append(
    el("span", "savings-hero-label", "Lifetime savings"),
    el("span", "savings-hero-amount", formatCurrency(summary.totalSaved)),
    el("span", "savings-hero-sub",
      `Across ${summary.purchaseCount} ${summary.purchaseCount === 1 ? "purchase" : "purchases"} you confirmed`)
  );

  const stats = el("div", "savings-stats");
  stats.append(
    stat("Average saved", formatCurrency(summary.averageSaved)),
    stat("Last purchase", formatCurrency(summary.mostRecentSaved))
  );

  const list = el("ul", "savings-activity-list");
  for (const p of summary.recentPurchases) {
    const li = el("li", "savings-activity-item");
    const left = el("div", "savings-activity-main");
    left.append(el("span", "savings-activity-name", p.title || "Purchase"),
                el("span", "savings-activity-date", formatDate(p.purchaseDate)));
    li.append(left, el("span", "savings-activity-amount", `+${formatCurrency(p.savings)}`));
    list.append(li);
  }

  container.append(hero, stats, el("h3", "savings-subtitle", "Recent activity"), list);
}

export function updateSavingsDashboard(container, purchases) {
  renderSavingsDashboard(container, getSavingsSummary(purchases));
}