// Small hand-rolled SVG charts for the impact dashboard, each with a hover layer.
// Colors come from CSS custom properties on .nook so they stay on-theme.

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function niceMax(value) {
  if (value <= 0) return 100;
  const step = 10 ** Math.floor(Math.log10(value));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((n) => n >= value);
  return nice;
}

function tooltip(wrapper) {
  let tip = wrapper.querySelector(".chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    wrapper.appendChild(tip);
  }
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const maxLeft = wrapper.clientWidth - tip.offsetWidth - 4;
      tip.style.left = `${Math.max(4, Math.min(maxLeft, x - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// With many weeks, label every Nth week (always the latest) so labels don't collide.
const showLabel = (i, n) => n <= 6 || (n - 1 - i) % Math.ceil(n / 5) === 0;

const weekLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

// Cumulative estimated savings: area + 2px line, end-point label, crosshair tooltip.
export function savingsChart(wrapper, weekly, money) {
  const width = wrapper.clientWidth;
  const height = 170;
  const pad = { top: 22, right: 18, bottom: 26, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...weekly.map((w) => w.cumulative_saved)));
  const x = (i) => pad.left + (weekly.length === 1 ? innerW / 2 : (i / (weekly.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  wrapper.querySelector("svg")?.remove();
  const svg = el("svg", { width, height, role: "img", "aria-label": "Cumulative estimated savings by week" });
  wrapper.prepend(svg);

  for (const v of [0, max / 2, max]) {
    el("line", { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: "grid" }, svg);
    el("text", { x: pad.left - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" }, svg).textContent = money(v);
  }
  weekly.forEach((w, i) => {
    if (!showLabel(i, weekly.length)) return;
    el("text", { x: x(i), y: height - 6, "text-anchor": "middle", class: "axis" }, svg).textContent = weekLabel(w.week_start);
  });

  const pts = weekly.map((w, i) => [x(i), y(w.cumulative_saved)]);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  el("path", { d: `${line} L${pts.at(-1)[0]},${y(0)} L${pts[0][0]},${y(0)} Z`, class: "area" }, svg);
  el("path", { d: line, class: "line" }, svg);

  const [lx, ly] = pts.at(-1);
  el("circle", { cx: lx, cy: ly, r: 4, class: "dot" }, svg);
  const label = el("g", { class: "end-label" }, svg);
  const text = el("text", { x: lx, y: ly - 13, "text-anchor": "middle" }, label);
  text.textContent = money(weekly.at(-1).cumulative_saved);
  const box = text.getBBox();
  label.insertBefore(el("rect", { x: box.x - 7, y: box.y - 3, width: box.width + 14, height: box.height + 6, rx: 9 }), text);

  // Hover: crosshair + tooltip on the nearest week.
  const cross = el("line", { y1: pad.top, y2: pad.top + innerH, class: "crosshair", visibility: "hidden" }, svg);
  const hoverDot = el("circle", { r: 5, class: "dot hover-dot", visibility: "hidden" }, svg);
  const tip = tooltip(wrapper);
  const hit = el("rect", { x: pad.left - 10, y: 0, width: innerW + 20, height, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = pts.reduce((best, p, j) => (Math.abs(p[0] - mx) < Math.abs(pts[best][0] - mx) ? j : best), 0);
    const [px, py] = pts[i];
    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", px);
    hoverDot.setAttribute("cy", py);
    hoverDot.setAttribute("visibility", "visible");
    tip.show(
      `<strong>Week of ${weekLabel(weekly[i].week_start)}</strong><span>${money(weekly[i].cumulative_saved)} saved so far</span><span>+${money(weekly[i].saved)} this week</span>`,
      px,
      py
    );
  });
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tip.hide();
  });
}

const SEGMENTS = [
  ["avoided", "Avoided"],
  ["postponed", "Postponed"],
  ["proceeded", "Proceeded"],
];

// Decisions per week: stacked columns, 2px gaps between segments, total above.
export function decisionsChart(wrapper, weekly) {
  const width = wrapper.clientWidth;
  const height = 170;
  const pad = { top: 22, bottom: 26, side: 8 };
  const innerH = height - pad.top - pad.bottom;
  const totals = weekly.map((w) => w.avoided + w.postponed + w.proceeded);
  const max = Math.max(4, ...totals);
  const slot = (width - pad.side * 2) / weekly.length;
  const barW = Math.min(26, slot * 0.5);
  const unit = innerH / max;
  const GAP = 2;

  wrapper.querySelector("svg")?.remove();
  const svg = el("svg", { width, height, role: "img", "aria-label": "Decisions each week by outcome" });
  wrapper.prepend(svg);
  el("line", { x1: pad.side, x2: width - pad.side, y1: pad.top + innerH, y2: pad.top + innerH, class: "grid" }, svg);

  const tip = tooltip(wrapper);
  weekly.forEach((w, i) => {
    const cx = pad.side + slot * i + slot / 2;
    const x = cx - barW / 2;
    let top = pad.top + innerH;
    const parts = SEGMENTS.filter(([key]) => w[key] > 0);
    parts.forEach(([key], j) => {
      const h = w[key] * unit - (j < parts.length - 1 ? GAP : 0);
      top -= w[key] * unit;
      const isTop = j === parts.length - 1;
      const yTop = top + (isTop ? 0 : GAP);
      // Round only the data end (top of the stack), square at the baseline.
      const r = isTop ? Math.min(4, h / 2) : 0;
      el(
        "path",
        {
          d: `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`,
          class: `seg seg-${key}`,
        },
        svg
      );
    });
    if (totals[i]) {
      el("text", { x: cx, y: top - 7, "text-anchor": "middle", class: "bar-total" }, svg).textContent = totals[i];
    }
    if (showLabel(i, weekly.length)) {
      el("text", { x: cx, y: height - 6, "text-anchor": "middle", class: "axis" }, svg).textContent = weekLabel(w.week_start);
    }

    const hit = el("rect", { x: cx - slot / 2, y: 0, width: slot, height, fill: "transparent" }, svg);
    hit.addEventListener("pointerenter", () => {
      tip.show(
        `<strong>Week of ${weekLabel(w.week_start)}</strong>` +
          SEGMENTS.map(([key, label]) => `<span><i class="swatch swatch-${key}"></i>${label}: ${w[key]}</span>`).join(""),
        cx,
        top
      );
    });
    hit.addEventListener("pointerleave", () => tip.hide());
  });
}
