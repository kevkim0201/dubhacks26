// Illustrative activity for people who haven't made a decision with Pip yet.
// Shown with a "Sample activity" banner; never mixed with real data.
// Dates are placed relative to the current week so the sample always looks recent.

const SAMPLE = [
  // [weeksAgo, dayOfWeek (0 = Mon), name, store, total, outcome]
  [0, 6, "Insulated water bottle", "Outdoor Store", 128, "avoided"],
  [0, 4, "Wireless headphones", "Sound Studio", 120, "postponed"],
  [0, 2, "Amber candle set", "Sunday Home", 40, "avoided"],
  [0, 1, "Desk essentials", "Paper & Pine", 70, "proceeded"],
  [1, 6, "Everyday sneakers", "Stride", 60, "proceeded"],
  [1, 4, "Canvas backpack", "Fieldwork", 95, "avoided"],
  [1, 1, "Ceramic pour-over set", "Morning Co.", 55, "postponed"],
  [2, 4, "Wool throw blanket", "Hearth & Co.", 89, "avoided"],
  [2, 3, "Linen shirt", "Coastline", 65, "postponed"],
  [2, 1, "Phone tripod", "Framewell", 48, "avoided"],
  [3, 3, "Bluetooth speaker", "Sound Studio", 80, "avoided"],
  [3, 1, "Running socks", "Stride", 50, "proceeded"],
];

const iso = (d) => d.toISOString().slice(0, 10);

function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

// Builds the same response shape as GET /api/impact.
export function sampleImpact({ weeks = 4, outcome = "all", page = 1, pageSize = 6 } = {}) {
  const today = new Date();
  const thisMonday = mondayOf(today);
  const weekStarts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(thisMonday);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i));
    return d;
  });

  const rows = SAMPLE.filter(([ago]) => ago < weeks).map(([ago, dow, name, store, total, out], i) => {
    const d = new Date(thisMonday);
    d.setUTCHours(12);
    d.setUTCDate(d.getUTCDate() - 7 * ago + Math.min(dow, ago === 0 ? (today.getUTCDay() + 6) % 7 : dow));
    return { id: `sample-${i}`, name, store, image: null, date: d.toISOString(), cart_total: total, currency: "USD", outcome: out, saved: out === "avoided" ? total : null, week: weeks - 1 - ago };
  });

  const outcomes = Object.fromEntries(
    ["avoided", "postponed", "proceeded"].map((o) => {
      const of = rows.filter((r) => r.outcome === o);
      return [o, { count: of.length, amount: of.reduce((s, r) => s + r.cart_total, 0), share: rows.length ? of.length / rows.length : 0 }];
    })
  );

  let cumulative = 0;
  const weekly = weekStarts.map((ws, i) => {
    const inWeek = rows.filter((r) => r.week === i);
    const saved = inWeek.filter((r) => r.outcome === "avoided").reduce((s, r) => s + r.cart_total, 0);
    cumulative += saved;
    const count = (o) => inWeek.filter((r) => r.outcome === o).length;
    return { week_start: iso(ws), saved, cumulative_saved: cumulative, avoided: count("avoided"), postponed: count("postponed"), proceeded: count("proceeded") };
  });

  const filtered = rows.filter((r) => outcome === "all" || r.outcome === outcome);
  const start = (page - 1) * pageSize;

  return {
    sample: true,
    range: { start: iso(weekStarts[0]), end: iso(today), weeks },
    currency: "USD",
    conversations: rows.length,
    decisions: rows.length,
    money_saved: outcomes.avoided.amount,
    outcomes,
    weekly,
    recent: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, page_size: pageSize },
  };
}
