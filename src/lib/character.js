// Pip -- the character that grows as you save. Procedurally drawn (no image
// assets), so it themes instantly from the user's skin/leaf/flower colors.
// renderCharacterSVG() returns the full scene: backdrop circle, Pip, and a
// few decorative sparkles that increase with tier.
import { shade } from './color.js';

// Tier thresholds are defined in dollars saved -- the rule shown to the
// user is literal: "$1 saved after checkout = 10 XP." XP is derived from
// the dollar thresholds, never the other way around, so the two numbers
// never drift apart.
export const STAGES = [
  { key: 'seed', label: 'Seed', minSaved: 0 },
  { key: 'sprout', label: 'Sprout', minSaved: 25 },
  { key: 'bloom', label: 'Bloom', minSaved: 250 },
  { key: 'grove', label: 'Grove', minSaved: 750 },
  { key: 'orchard', label: 'Orchard', minSaved: 2000 },
  { key: 'evergreen', label: 'Evergreen', minSaved: 5000 },
].map((s) => ({ ...s, minXp: s.minSaved * 10 }));

export const XP_PER_DOLLAR = 10;

export function xpFromStats({ totalSaved = 0 } = {}) {
  return Math.round(totalSaved * XP_PER_DOLLAR);
}

export function computeLevel(xp) {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (xp >= STAGES[i].minXp) index = i;
  }
  const stage = STAGES[index];
  const next = STAGES[index + 1] ?? null;
  const xpIntoStage = xp - stage.minXp;
  const xpForNextStage = next ? next.minXp - stage.minXp : null;
  const progress = next ? Math.min(1, xpIntoStage / xpForNextStage) : 1;
  const dollarsToNext = next ? Math.max(0, next.minSaved - xp / XP_PER_DOLLAR) : 0;

  return {
    level: index + 1,
    xp,
    stage,
    stageIndex: index,
    next,
    xpIntoStage,
    xpForNextStage,
    progress, // 0..1, always 1 once maxed out
    dollarsToNext,
  };
}

// Geometry per stage, index-aligned with STAGES. bodyScale 1.0 is the
// calibration size (the "Sprout" reference look); everything else is
// relative to it via an SVG transform, so only these few numbers change
// per tier.
const VISUALS = [
  { bodyScale: 0.5, limbs: false, asleep: true, leaves: false, flowers: 0, sparkles: 0 },  // seed
  { bodyScale: 0.78, limbs: true, asleep: false, leaves: true, leafScale: 0.85, flowers: 0, sparkles: 0 }, // sprout
  { bodyScale: 0.88, limbs: true, asleep: false, leaves: true, leafScale: 1.0, flowers: 1, sparkles: 1 },  // bloom
  { bodyScale: 0.97, limbs: true, asleep: false, leaves: true, leafScale: 1.08, flowers: 2, sparkles: 2 }, // grove
  { bodyScale: 1.05, limbs: true, asleep: false, leaves: true, leafScale: 1.15, flowers: 3, sparkles: 2 }, // orchard
  { bodyScale: 1.15, limbs: true, asleep: false, leaves: true, leafScale: 1.25, flowers: 4, sparkles: 3 }, // evergreen
];

function leafPath(side, scale, color) {
  // A simple pointed-almond leaf, drawn upright then rotated/mirrored into place.
  const x = side === 'left' ? -1 : 1;
  const rotate = side === 'left' ? -24 : 24;
  const tx = x * 6 * scale;
  return `<path d="M 0 0 Q ${x * 11 * scale} ${-16 * scale} 0 ${-32 * scale} Q ${-x * 11 * scale} ${-16 * scale} 0 0 Z"
                fill="${color}" transform="translate(${tx} ${-40}) rotate(${rotate})" />`;
}

function sparkle(cx, cy, r, color, opacity = 1) {
  return `<path d="M ${cx} ${cy - r} L ${cx + r * 0.26} ${cy - r * 0.26} L ${cx + r} ${cy} L ${cx + r * 0.26} ${cy + r * 0.26}
                L ${cx} ${cy + r} L ${cx - r * 0.26} ${cy + r * 0.26} L ${cx - r} ${cy} L ${cx - r * 0.26} ${cy - r * 0.26} Z"
                fill="${color}" opacity="${opacity}" />`;
}

export function renderCharacterSVG(stageKey, opts = {}) {
  const {
    skinColor = '#f3bd93',
    leafColor = '#2f6b4f',
    flowerColor = '#f472b6',
    size = 160,
  } = opts;

  const index = Math.max(0, STAGES.findIndex((s) => s.key === stageKey));
  const v = VISUALS[index] ?? VISUALS[0];

  const skinDark = shade(skinColor, -0.18);
  const blush = shade(skinColor, -0.28);
  const leafLight = shade(leafColor, 0.3);
  const backdrop = shade(leafColor, 0.86);
  const outline = shade(skinColor, -0.55);

  const parts = [];

  // Soft circular backdrop.
  parts.push(`<circle cx="100" cy="100" r="90" fill="${backdrop}" />`);

  // Decorative sparkles, outside Pip so they don't scale with tier -- they
  // just appear in greater number at higher tiers.
  const sparkleSpots = [
    [34, 70, 7, leafColor, 0.8],
    [168, 54, 5, '#f4c84a', 0.9],
    [156, 150, 6, flowerColor, 0.8],
  ];
  for (let i = 0; i < v.sparkles; i++) {
    const [sx, sy, sr, sc, so] = sparkleSpots[i];
    parts.push(sparkle(sx, sy, sr, sc, so));
  }

  // Ground shadow.
  parts.push(`<ellipse cx="100" cy="${148 + 20 * (1 - v.bodyScale)}" rx="${30 * v.bodyScale}" ry="${6 * v.bodyScale}" fill="#1f2d22" opacity="0.1" />`);

  // Pip, drawn in local unit coordinates then scaled/positioned as a group.
  const pip = [];

  if (v.leaves) {
    const ls = v.leafScale;
    pip.push(leafPath('left', ls, leafLight));
    pip.push(leafPath('right', ls, leafColor));
  }

  // Body: a wide bottom ellipse + narrower top circle, same fill, no
  // stroke -- they read as one seamless blob.
  pip.push(`<ellipse cx="0" cy="15" rx="34" ry="30" fill="${skinColor}" />`);
  pip.push(`<circle cx="0" cy="-14" r="26" fill="${skinColor}" />`);

  if (v.limbs) {
    pip.push(`<ellipse cx="-16" cy="40" rx="9" ry="6" fill="${skinDark}" />`);
    pip.push(`<ellipse cx="16" cy="40" rx="9" ry="6" fill="${skinDark}" />`);
    pip.push(`<ellipse cx="-33" cy="8" rx="10" ry="7" fill="${skinColor}" transform="rotate(-20 -33 8)" />`);
    pip.push(`<ellipse cx="33" cy="8" rx="10" ry="7" fill="${skinColor}" transform="rotate(20 33 8)" />`);
  }

  // Flowers tucked at the base of the leaves, count grows with tier.
  for (let i = 0; i < v.flowers; i++) {
    const a = (i / Math.max(1, v.flowers - 1 || 1)) * Math.PI * 0.8 - Math.PI * 0.4;
    const fx = Math.sin(a) * 14;
    const fy = -38 - Math.cos(a) * 4;
    pip.push(`<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="3.4" fill="${flowerColor}" />`);
  }

  // Face.
  if (v.asleep) {
    pip.push(`<path d="M -14 -16 Q -11 -13 -8 -16" stroke="${outline}" stroke-width="2" fill="none" stroke-linecap="round" />`);
    pip.push(`<path d="M 8 -16 Q 11 -13 14 -16" stroke="${outline}" stroke-width="2" fill="none" stroke-linecap="round" />`);
  } else {
    pip.push(`<ellipse cx="-20" cy="-6" rx="6" ry="3.5" fill="${blush}" opacity="0.5" />`);
    pip.push(`<ellipse cx="20" cy="-6" rx="6" ry="3.5" fill="${blush}" opacity="0.5" />`);
    pip.push(`<ellipse cx="-11" cy="-16" rx="3.2" ry="4.2" fill="${outline}" />`);
    pip.push(`<ellipse cx="11" cy="-16" rx="3.2" ry="4.2" fill="${outline}" />`);
    pip.push(`<path d="M -8 -4 Q 0 4 8 -4" stroke="${outline}" stroke-width="2.2" fill="none" stroke-linecap="round" />`);
  }

  parts.push(`<g transform="translate(100 128) scale(${v.bodyScale})">${pip.join('')}</g>`);

  return `
    <svg viewBox="0 0 200 200" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Character">
      ${parts.join('\n')}
    </svg>
  `;
}
