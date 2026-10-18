// Inline SVG art: Pip the squirrel and the small UI icons.
import { renderScene, SCENE_CSS } from "../../assets/squirrel-assets.js";

let accountCosmetics = null;

const C = {
  blob: "#e4e9d8",
  shadow: "#d6dcc6",
  furDark: "#7f4a24",
  fur: "#b0703c",
  furLight: "#d9a467",
  cream: "#f5e3c3",
  eye: "#2b2118",
  nose: "#5a3418",
  cheek: "#e59a73",
  leaf: "#2f4a3a",
  scarf: "#2f5a43",
  scarfDark: "#244735",
  sparkle: "#e5b65c",
};

function sparkle(x, y, s) {
  return `<path transform="translate(${x} ${y}) scale(${s})" fill="${C.sparkle}"
    d="M0 -10 C1 -3 3 -1 10 0 C3 1 1 3 0 10 C-1 3 -3 1 -10 0 C-3 -1 -1 -3 0 -10Z"/>`;
}

export function setSquirrelCosmetics(cosmetics) {
  accountCosmetics = cosmetics;
}

export function squirrel({ scarf = false, sparkles = false } = {}) {
  if (accountCosmetics?.cosmetics && accountCosmetics?.equipped) {
    const asset = (slot) => {
      const id = accountCosmetics.equipped[slot];
      return accountCosmetics.cosmetics.find((item) => item.id === id)?.asset_key ?? "none";
    };
    const tier = accountCosmetics.profile?.tier;
    const level = { Baby: 1, Scout: 2, Forager: 3, Hoarder: 4, Golden: 5 }[tier] ?? 1;
    return renderScene({
      level,
      background: asset("background") === "none" ? "meadow" : asset("background"),
      head: asset("head"),
      neck: asset("neck"),
      held: asset("held"),
      effect: asset("effect"),
      label: `${tier ?? "Baby"} squirrel`,
    }).replace("</svg>", `<style>${SCENE_CSS}</style></svg>`);
  }
  return `
<svg class="pip" viewBox="0 0 220 180" role="img" aria-label="Pip the squirrel">
  <ellipse cx="118" cy="92" rx="88" ry="78" fill="${C.blob}"/>
  <ellipse cx="112" cy="166" rx="62" ry="7" fill="${C.shadow}"/>

  <!-- sprout -->
  <path d="M30 168 C30 156 31 148 34 140" stroke="${C.leaf}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M33 146 C22 146 16 138 16 130 C26 130 33 136 33 146Z" fill="${C.leaf}"/>
  <path d="M34 142 C36 132 44 126 52 127 C51 137 44 142 34 142Z" fill="${C.leaf}"/>

  ${sparkles ? sparkle(52, 52, 0.9) + sparkle(186, 40, 0.8) + sparkle(196, 120, 0.6) + sparkle(46, 104, 0.55) : ""}

  <!-- tail -->
  <path d="M128 152 C168 160 196 134 194 98 C192 66 168 52 150 60 C134 68 138 92 156 90"
        fill="none" stroke="${C.furDark}" stroke-width="38" stroke-linecap="round"/>
  <path d="M128 152 C168 160 196 134 194 98 C192 66 168 52 150 60 C134 68 138 92 156 90"
        fill="none" stroke="${C.furLight}" stroke-width="18" stroke-linecap="round" opacity="0.85"/>

  <!-- body -->
  <ellipse cx="106" cy="128" rx="38" ry="35" fill="${C.fur}"/>
  <ellipse cx="106" cy="136" rx="24" ry="25" fill="${C.cream}"/>
  <ellipse cx="85" cy="161" rx="15" ry="7" fill="${C.furDark}"/>
  <ellipse cx="127" cy="161" rx="15" ry="7" fill="${C.furDark}"/>

  ${scarf ? `
  <path d="M74 100 C90 112 122 112 138 100 L140 110 C122 122 90 122 72 110Z" fill="${C.scarf}"/>
  <path d="M120 112 L128 140 L116 142 L110 114Z" fill="${C.scarfDark}"/>
  <path d="M112 113 L118 138 L108 139 L104 114Z" fill="${C.scarf}"/>` : ""}

  <!-- acorn + paws -->
  <path d="M95 121 C95 113 117 113 117 121Z" fill="${C.furDark}"/>
  <rect x="105" y="111" width="2.5" height="5" rx="1" fill="${C.furDark}"/>
  <path d="M96 121 L116 121 C116 132 111 138 106 138 C101 138 96 132 96 121Z" fill="${C.furLight}"/>
  <ellipse cx="93" cy="126" rx="7" ry="6" fill="${C.fur}"/>
  <ellipse cx="119" cy="126" rx="7" ry="6" fill="${C.fur}"/>

  <!-- ears -->
  <path d="M80 70 L72 34 Q76 30 80 34 L98 60Z" fill="${C.fur}" stroke="${C.fur}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M82 64 L77 42 L91 58Z" fill="${C.cream}"/>
  <path d="M132 70 L140 34 Q136 30 132 34 L114 60Z" fill="${C.fur}" stroke="${C.fur}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M130 64 L135 42 L121 58Z" fill="${C.cream}"/>

  <!-- head -->
  <ellipse cx="106" cy="80" rx="34" ry="29" fill="${C.fur}"/>
  <ellipse cx="106" cy="91" rx="18" ry="12" fill="${C.cream}"/>
  <circle cx="92" cy="79" r="5" fill="${C.eye}"/>
  <circle cx="120" cy="79" r="5" fill="${C.eye}"/>
  <circle cx="93.6" cy="77.4" r="1.6" fill="#fff"/>
  <circle cx="121.6" cy="77.4" r="1.6" fill="#fff"/>
  <ellipse cx="106" cy="87" rx="4" ry="2.8" fill="${C.nose}"/>
  <path d="M102 92 Q106 95 110 92" stroke="${C.nose}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <ellipse cx="82" cy="91" rx="5.5" ry="3.5" fill="${C.cheek}" opacity="0.45"/>
  <ellipse cx="130" cy="91" rx="5.5" ry="3.5" fill="${C.cheek}" opacity="0.45"/>
</svg>`;
}

const stroke = (d, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  acorn: (size = 16) => `
<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 10 C4 5 20 5 20 10Z" fill="#7f4a24"/>
  <rect x="11" y="2.5" width="2" height="4" rx="1" fill="#7f4a24"/>
  <path d="M5.5 10 H18.5 C18.5 17 15 21 12 21 C9 21 5.5 17 5.5 10Z" fill="#c98a4b"/>
</svg>`,
  logo: () => `
<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 10 C3 4 21 4 21 10Z" fill="currentColor"/>
  <rect x="11" y="1.5" width="2" height="4" rx="1" fill="currentColor"/>
  <path d="M4.8 11.5 H19.2 C19.2 18 15.5 22 12 22 C8.5 22 4.8 18 4.8 11.5Z" fill="currentColor"/>
</svg>`,
  google: () => `
<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/>
  <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/>
  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/>
</svg>`,
  mic: (s) => stroke('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', s),
  wave: (s) => stroke('<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4"/>', s),
  sprout: (s) => stroke('<path d="M12 21v-9M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 14c0-4 3-6 7-6 0 4-3 6-7 6z"/>', s),
  lock: (s) => stroke('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s),
  headphones: (s) => stroke('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>', s),
  stop: (s) => stroke('<rect x="6" y="6" width="12" height="12" rx="2"/>', s),
  arrow: (s) => stroke('<path d="M5 12h14M13 6l6 6-6 6"/>', s),
  check: (s) => stroke('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>', s),
  clock: (s) => stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  close: (s) => stroke('<path d="M6 6l12 12M18 6L6 18"/>', s),
  bag: (s) => stroke('<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', s),
  chart: (s) => stroke('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', s),
  wallet: (s) => stroke('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 2 3"/>', s),
  leaf: (s) => stroke('<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19c3-4 6-6 10-8"/>', s),
  calendar: (s) => stroke('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', s),
  info: (s) => stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', s),
  chevron: (s) => stroke('<path d="M6 9l6 6 6-6"/>', s),
  sparkle: (s) => stroke('<path d="M12 3c.8 4.4 2.6 6.2 7 7-4.4.8-6.2 2.6-7 7-.8-4.4-2.6-6.2-7-7 4.4-.8 6.2-2.6 7-7z"/>', s),
};
