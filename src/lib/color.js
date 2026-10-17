// Minimal hex color math -- shades a base color without needing a CSS
// color-mixing library. Used to derive Pip's limb/blush/shadow tones from
// a single user-picked skin color, and leaf highlight from one leaf color.
function clamp(n) { return Math.max(0, Math.min(255, n)); }

function toRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => clamp(Math.round(c)).toString(16).padStart(2, '0')).join('');
}

// amount: -1..1, negative darkens toward black, positive lightens toward white.
export function shade(hex, amount) {
  const [r, g, b] = toRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
}
