// Squirrel asset library — pure SVG, no dependencies.
// Usage:
//   import { renderScene, renderItem, CATALOG, LEVELS, SCENE_CSS } from './squirrel-assets.js';
//   el.innerHTML = renderScene({ level: 3, background: 'forest', head: 'beanie', neck: 'scarf', held: 'coffee', effect: 'hearts' });
//   Inject SCENE_CSS once (a <style> tag) to get the idle + effect animations.
//
// Coordinate system: the squirrel is drawn in a 200x200 "local" frame (ground at y=182).
// Accessories use that same frame, so they fit every level automatically.
// Scenes are 240x200; the squirrel sits centred on the ground.

/* ---------------------------------------------------------------- levels */

export const LEVELS = [
  { level: 1, name: 'Sprout',  min: 0,    max: 100,  scale: 0.70,
    c: { fur: '#C07A45', dark: '#9A5A2C', tail: '#D99E66', cream: '#F8E0C2' } },
  { level: 2, name: 'Scout',   min: 100,  max: 500,  scale: 0.82,
    c: { fur: '#B8733E', dark: '#925227', tail: '#D5965C', cream: '#F7DDBD' } },
  { level: 3, name: 'Forager', min: 500,  max: 1500, scale: 0.92,
    c: { fur: '#AE6936', dark: '#874A20', tail: '#CF8D55', cream: '#F5D9B7' } },
  { level: 4, name: 'Hoarder', min: 1500, max: 5000, scale: 1.00,
    c: { fur: '#9C5A2C', dark: '#77411B', tail: '#C78449', cream: '#F2D3AF' } },
  { level: 5, name: 'Golden',  min: 5000, max: null, scale: 1.04,
    c: { fur: '#E2AC3B', dark: '#BF861C', tail: '#F3CC6A', cream: '#FFF1CC' } },
];

export const levelForXP = xp => LEVELS.reduce((l, L) => (xp >= L.min ? L.level : l), 1);

/* --------------------------------------------------------------- helpers */

const acorn = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k}) translate(-10 -12)">
  <rect x="9" y="0.5" width="2" height="4" rx="1" fill="#5B3A1E"/>
  <ellipse cx="10" cy="15" rx="7" ry="8" fill="#C0803F"/>
  <ellipse cx="7.6" cy="13" rx="1.8" ry="3" fill="#E2AB6C" opacity=".75"/>
  <path d="M1.5 10.5 Q10 1.5 18.5 10.5 Q10 13.5 1.5 10.5Z" fill="#6B4423"/>
</g>`;

const star4 = (x, y, r, fill, cls = '') => `<path class="${cls}" d="M${x} ${y - r} Q${x + r * .18} ${y - r * .18} ${x + r} ${y} Q${x + r * .18} ${y + r * .18} ${x} ${y + r} Q${x - r * .18} ${y + r * .18} ${x - r} ${y} Q${x - r * .18} ${y - r * .18} ${x} ${y - r}Z" fill="${fill}"/>`;

const heart = (x, y, s, fill, cls = '', style = '') => `<path class="${cls}" style="${style}" transform="translate(${x} ${y}) scale(${s})" d="M0 4 C-2 -2 -10 -2 -10 4 C-10 9 -4 12 0 16 C4 12 10 9 10 4 C10 -2 2 -2 0 4Z" fill="${fill}"/>`;

const leafShape = (x, y, s, rot, fill, vein = '#3F6E36', cls = '', style = '') => `<g class="${cls}" style="${style}" transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  <path d="M0 0 Q10 -12 24 -4 Q14 8 0 0Z" fill="${fill}"/>
  <path d="M1 -0.5 Q12 -4 22 -4" stroke="${vein}" stroke-width="1" fill="none" opacity=".5"/>
</g>`;

/* ------------------------------------------------------------- squirrel */

// Built-in level extras show only when the matching slot is empty,
// so an equipped item always replaces the default look.
function squirrelBody(level, eq) {
  const L = LEVELS[level - 1], c = L.c;
  const golden = level === 5;
  const fur = golden ? 'url(#sq-gold)' : c.fur;
  const head = eq.head && eq.head !== 'none' ? eq.head : null;
  const neck = eq.neck && eq.neck !== 'none' ? eq.neck : null;
  const held = eq.held && eq.held !== 'none' ? eq.held : null;

  const builtInNeck = !neck && level === 3 ? NECK.bandana.draw() : '';
  const builtInSatchel = !neck && level === 4 ? NECK.satchel.draw() : '';
  const builtInHead = !head && level === 5 ? HEAD.crown.draw() : '';
  const heldItem = held ? HELD[held].draw() : acorn(90, 122, level === 4 || level === 5 ? 1.45 : 1.05);
  const back = neck && NECK[neck].back ? NECK[neck].back() : (builtInSatchel ? '' : '');

  return `
  <g class="sq-bob">
    <g class="sq-tail">
      <path d="M104 164 C126 184 188 172 188 114 C188 70 160 50 132 56 C104 62 98 92 112 104 C102 122 98 146 104 164Z" fill="${fur}"/>
      <path d="M118 158 C150 166 178 140 176 108 C174 80 152 66 134 72 C118 77 116 96 128 102 C138 107 148 99 144 90" stroke="${c.tail}" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M126 150 C152 154 168 132 166 108" stroke="${c.cream}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".45"/>
    </g>
    ${back}
    <ellipse cx="92" cy="140" rx="36" ry="40" fill="${fur}"/>
    <ellipse cx="92" cy="148" rx="23" ry="28" fill="${c.cream}"/>
    <ellipse cx="76" cy="177" rx="12" ry="6" fill="${c.dark}"/>
    <ellipse cx="108" cy="177" rx="12" ry="6" fill="${c.dark}"/>
    ${builtInSatchel}
    <g>
      <path d="M64 64 L58 30 Q72 34 82 54 Z" fill="${fur}"/>
      <path d="M58 30 Q56 22 61 18 Q62 26 64 31Z" fill="${c.dark}"/>
      <path d="M66 59 L62 40 Q71 44 77 54 Z" fill="${c.cream}"/>
    </g>
    <g class="sq-ear">
      <path d="M100 52 L114 22 Q124 38 118 62 Z" fill="${fur}"/>
      <path d="M114 22 Q117 14 122 12 Q120 20 117 26Z" fill="${c.dark}"/>
      <path d="M104 52 L113 33 Q119 44 116 57 Z" fill="${c.cream}"/>
    </g>
    <circle cx="90" cy="84" r="34" fill="${fur}"/>
    ${level >= 4 ? `<ellipse cx="78" cy="66" rx="10" ry="5" fill="#FFF" opacity=".2" transform="rotate(-20 78 66)"/>` : ''}
    <ellipse cx="90" cy="98" rx="16" ry="11" fill="${c.cream}"/>
    <g class="sq-eye"><circle cx="77" cy="86" r="5.6" fill="#2A1D14"/><circle cx="78.9" cy="84.2" r="1.9" fill="#FFF"/></g>
    <g class="sq-eye"><circle cx="103" cy="86" r="5.6" fill="#2A1D14"/><circle cx="104.9" cy="84.2" r="1.9" fill="#FFF"/></g>
    <ellipse cx="68" cy="97" rx="5.5" ry="3.3" fill="#F28C8C" opacity=".55"/>
    <ellipse cx="112" cy="97" rx="5.5" ry="3.3" fill="#F28C8C" opacity=".55"/>
    <ellipse cx="90" cy="94" rx="3.4" ry="2.5" fill="#5A3420"/>
    <path d="M85.5 99.5 Q90 103.5 94.5 99.5" stroke="#5A3420" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    ${neck ? NECK[neck].draw() : builtInNeck}
    <ellipse cx="78" cy="138" rx="7.5" ry="6.5" fill="${c.dark}"/>
    <ellipse cx="102" cy="138" rx="7.5" ry="6.5" fill="${c.dark}"/>
    ${neck === 'sweater' ? NECK.sweater.cuffs() : ''}
    <g transform="translate(0 10)">${heldItem}</g>
    ${head ? HEAD[head].draw() : builtInHead}
  </g>`;
}

// Level extras that live on the ground beside the squirrel (scene frame).
function levelProps(level) {
  const plant = (x) => `<path d="M${x} 186 L${x} 170" stroke="#3F6E36" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M${x} 172 Q${x - 8} 160 ${x - 16} 163 Q${x - 9} 172 ${x} 172Z" fill="#4F8A45"/>
    <path d="M${x} 172 Q${x + 8} 159 ${x + 15} 162 Q${x + 9} 172 ${x} 172Z" fill="#63A355"/>`;
  const bigLeaf = (x) => `<path d="M${x} 188 Q${x - 2} 178 ${x + 2} 170" stroke="#3F6E36" stroke-width="2" fill="none"/>
    <path d="M${x + 2} 170 Q${x - 14} 150 ${x - 2} 134 Q${x + 14} 152 ${x + 2} 170Z" fill="#4F8A45"/>
    <path d="M${x + 1} 166 Q${x - 2} 152 ${x - 1} 140" stroke="#3F6E36" stroke-width="1" fill="none" opacity=".5"/>`;
  const sparkles = (pts) => pts.map(([x, y, r, d]) => `<g class="fx-twinkle" style="animation-delay:${d}s">${star4(x, y, r, '#F4C842')}</g>`).join('');
  switch (level) {
    case 1: return plant(56);
    case 2: return bigLeaf(52);
    case 3: return bigLeaf(50);
    case 4: return `<path d="M44 186 Q46 178 52 176 Q50 184 44 186Z" fill="#8E5A2E"/>` + sparkles([[50, 70, 7, 0], [196, 46, 5, .7]]);
    case 5: return sparkles([[44, 74, 8, 0], [52, 128, 6, .5], [200, 40, 6, .9], [206, 110, 5, 1.3], [188, 158, 7, .3]]);
  }
  return '';
}

/* ----------------------------------------------------------- head items */

export const HEAD = {
  none: { name: 'None', draw: () => '' },
  beanie: { name: 'Beanie', draw: () => `
    <path d="M56 72 Q55 36 90 34 Q125 36 124 72 Z" fill="#3B6FD1"/>
    <path d="M72 40 Q70 56 72 66 M90 36 V66 M108 40 Q110 56 108 66" stroke="#2F5BB0" stroke-width="2" fill="none"/>
    <rect x="53" y="62" width="74" height="13" rx="6.5" fill="#2F5BB0"/>
    <circle cx="90" cy="31" r="7.5" fill="#E8EEFF"/>` },
  cap: { name: 'Cap', draw: () => `
    <path d="M58 66 Q58 36 90 35 Q122 36 122 66 Z" fill="#5B3FA8"/>
    <path d="M60 64 Q42 64 34 72 Q56 75 84 66 Z" fill="#4A3290"/>
    <circle cx="90" cy="36" r="3" fill="#4A3290"/>
    <text x="94" y="58" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="17" fill="#FFF" text-anchor="middle">W</text>` },
  bucket: { name: 'Bucket Hat', draw: () => `
    <path d="M62 62 Q64 37 90 37 Q116 37 118 62 Z" fill="#E6D8B4"/>
    <ellipse cx="90" cy="63" rx="41" ry="9" fill="#D5C399"/>
    <path d="M63 58 Q90 62 117 58" stroke="#C7B489" stroke-width="2" fill="none"/>
    ${leafShape(86, 50, .55, -20, '#5E9B4F')}` },
  headphones: { name: 'Headphones', draw: () => `
    <path d="M57 84 Q55 40 90 38 Q125 40 123 84" stroke="#34343A" stroke-width="7" fill="none" stroke-linecap="round"/>
    <rect x="47" y="72" width="16" height="28" rx="7" fill="#2A2A2E"/><rect x="51" y="77" width="8" height="18" rx="4" fill="#4A4A52"/>
    <rect x="117" y="72" width="16" height="28" rx="7" fill="#2A2A2E"/><rect x="121" y="77" width="8" height="18" rx="4" fill="#4A4A52"/>` },
  crown: { name: 'Crown', draw: () => `
    <path d="M70 56 L73 34 L82 46 L90 29 L98 46 L107 34 L110 56 Z" fill="#F4C842" stroke="#C99319" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="90" cy="45" r="3" fill="#D9473E"/><circle cx="78" cy="49" r="2.2" fill="#3E8EC9"/><circle cx="102" cy="49" r="2.2" fill="#3E8EC9"/>` },
  flower: { name: 'Flower', draw: () => `
    <g transform="translate(114 58)">
      ${[0, 72, 144, 216, 288].map(a => `<ellipse cx="0" cy="-7" rx="5" ry="7" fill="#F48FA8" transform="rotate(${a})"/>`).join('')}
      <circle r="4.5" fill="#F7C948"/>
    </g>` },
  leaf: { name: 'Leaf', draw: () => `
    <path d="M90 52 Q88 44 92 38" stroke="#3F6E36" stroke-width="2" fill="none"/>
    <path d="M92 40 Q78 22 92 6 Q106 24 92 40Z" fill="#5E9B4F"/>
    <path d="M92 37 Q90 24 92 12" stroke="#3F6E36" stroke-width="1.2" fill="none" opacity=".55"/>` },
  goggles: { name: 'Goggles', draw: () => `
    <path d="M56 66 Q90 58 124 66" stroke="#6B4A2E" stroke-width="6" fill="none"/>
    <circle cx="77" cy="64" r="11" fill="#7A5434"/><circle cx="77" cy="64" r="7.5" fill="#A9CBDA"/>
    <circle cx="103" cy="64" r="11" fill="#7A5434"/><circle cx="103" cy="64" r="7.5" fill="#A9CBDA"/>
    <path d="M73 60 L76 58 M99 60 L102 58" stroke="#FFF" stroke-width="2" stroke-linecap="round"/>` },
  chef: { name: 'Chef Hat', draw: () => `
    <circle cx="74" cy="34" r="13" fill="#FFF" stroke="#DDD8D0" stroke-width="1.5"/>
    <circle cx="106" cy="34" r="13" fill="#FFF" stroke="#DDD8D0" stroke-width="1.5"/>
    <circle cx="90" cy="26" r="15" fill="#FFF" stroke="#DDD8D0" stroke-width="1.5"/>
    <rect x="64" y="34" width="52" height="24" rx="4" fill="#FFF" stroke="#DDD8D0" stroke-width="1.5"/>` },
  sunhat: { name: 'Sun Hat', draw: () => `
    <ellipse cx="90" cy="60" rx="54" ry="11" fill="#E8C77C"/>
    <path d="M65 60 Q67 38 90 38 Q113 38 115 60 Z" fill="#F0D58F"/>
    <path d="M66 54 Q90 58 114 54 L114.6 59 Q90 63 65.4 59Z" fill="#D9473E"/>` },
  wizard: { name: 'Wizard Hat', draw: () => `
    <path d="M60 62 Q84 40 96 4 Q104 30 122 62 Z" fill="#4B3A9A"/>
    <ellipse cx="90" cy="62" rx="40" ry="7.5" fill="#3D2E83"/>
    ${star4(84, 44, 5, '#F4C842')}${star4(100, 28, 3.5, '#F4C842')}${star4(106, 52, 3, '#F4C842')}` },
  party: { name: 'Party Hat', draw: () => `
    <path d="M76 58 L93 14 L108 56 Z" fill="#E9473F"/>
    <path d="M80 48 L101 39 L103 45 L82 53Z M86 33 L97 28 L98.6 33 L87.6 37Z" fill="#FFF"/>
    <circle cx="93" cy="13" r="5" fill="#F7C948"/>` },
  halo: { name: 'Halo', draw: () => `
    <ellipse cx="90" cy="32" rx="26" ry="6.5" fill="none" stroke="#F7D86A" stroke-width="9" opacity=".35"/>
    <ellipse cx="90" cy="32" rx="26" ry="6.5" fill="none" stroke="#F2C744" stroke-width="4.5"/>` },
  horns: { name: 'Devil Horns', draw: () => `
    <path d="M70 58 Q58 44 64 28 Q70 44 82 52 Z" fill="#D63A3A"/>
    <path d="M110 56 Q122 44 118 28 Q110 42 100 51 Z" fill="#D63A3A"/>` },
  hood: { name: 'Animal Hood', draw: () => `
    <circle cx="62" cy="50" r="11" fill="#EFE5D4"/><circle cx="62" cy="50" r="5.5" fill="#F2B8B0"/>
    <circle cx="118" cy="50" r="11" fill="#EFE5D4"/><circle cx="118" cy="50" r="5.5" fill="#F2B8B0"/>
    <path d="M52 104 Q44 46 90 42 Q136 46 128 104 Q126 78 112 66 Q90 58 68 66 Q54 78 52 104Z" fill="#EFE5D4"/>
    <path d="M56 98 Q56 74 70 66" stroke="#DCCDB4" stroke-width="2" fill="none"/>` },
  glasses: { name: 'Glasses', draw: () => `
    <circle cx="77" cy="86" r="10" fill="#FFF" fill-opacity=".15" stroke="#222" stroke-width="3"/>
    <circle cx="103" cy="86" r="10" fill="#FFF" fill-opacity=".15" stroke="#222" stroke-width="3"/>
    <path d="M87 85 Q90 82 93 85 M67 84 L57 80 M113 84 L123 80" stroke="#222" stroke-width="2.5" fill="none" stroke-linecap="round"/>` },
  sunglasses: { name: 'Sunglasses', draw: () => `
    <path d="M64 80 H88 V88 Q88 96 78 96 H74 Q64 96 64 88Z" fill="#1E1E22"/>
    <path d="M92 80 H116 V88 Q116 96 106 96 H102 Q92 96 92 88Z" fill="#1E1E22"/>
    <path d="M88 82 H92 M64 81 L56 78 M116 81 L124 78" stroke="#1E1E22" stroke-width="3" stroke-linecap="round"/>
    <path d="M68 84 L73 82 M96 84 L101 82" stroke="#FFF" stroke-width="2" stroke-linecap="round" opacity=".7"/>` },
};

/* ------------------------------------------------------ neck/body items */

export const NECK = {
  none: { name: 'None', draw: () => '' },
  scarf: { name: 'Scarf', draw: () => `
    <path d="M58 110 Q90 124 122 108 L124 119 Q90 136 56 121 Z" fill="#D9473E"/>
    <path d="M102 120 L111 146 L100 145 L94 123 Z" fill="#B8382F"/>
    <path d="M100 141 L111 144 M98 137 L109 140" stroke="#F3A39C" stroke-width="1.5"/>
    <path d="M62 114 Q90 126 120 112" stroke="#FFF" stroke-width="1.5" stroke-dasharray="3 4" fill="none" opacity=".45"/>` },
  bandana: { name: 'Bandana', draw: () => `
    <path d="M60 110 Q90 122 120 110 L92 140 Q90 142 88 140 Z" fill="#4F8A4B"/>
    <path d="M60 110 Q90 122 120 110 L119 116 Q90 128 61 116Z" fill="#3E733B"/>
    <circle cx="80" cy="122" r="1.6" fill="#E8F3E2"/><circle cx="96" cy="126" r="1.6" fill="#E8F3E2"/><circle cx="90" cy="134" r="1.4" fill="#E8F3E2"/>` },
  bowtie: { name: 'Bow Tie', draw: () => `
    <path d="M90 116 L74 107 L74 125 Z" fill="#2B2B30"/><path d="M90 116 L106 107 L106 125 Z" fill="#2B2B30"/>
    <rect x="86" y="111" width="8" height="10" rx="3" fill="#18181C"/>` },
  collar: { name: 'Bell Collar', draw: () => `
    <path d="M58 110 Q90 124 122 110 L122 117 Q90 131 58 117Z" fill="#D33B3B"/>
    <circle cx="90" cy="128" r="6.5" fill="#F2C744" stroke="#C99319" stroke-width="1.5"/>
    <path d="M86 129 H94" stroke="#A87A12" stroke-width="1.5"/><circle cx="90" cy="132" r="1.4" fill="#A87A12"/>` },
  backpack: { name: 'Backpack', back: () => `
    <rect x="40" y="106" width="30" height="44" rx="9" fill="#C99A5B"/>
    <rect x="40" y="106" width="30" height="15" rx="7" fill="#B0844A"/>
    <rect x="45" y="128" width="20" height="14" rx="4" fill="#B0844A"/>`, draw: () => `
    <path d="M70 108 Q76 130 72 156" stroke="#9C7140" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M112 106 Q109 130 113 156" stroke="#9C7140" stroke-width="5" fill="none" stroke-linecap="round"/>` },
  satchel: { name: 'Satchel', draw: () => `
    <path d="M114 106 L66 150" stroke="#6E4422" stroke-width="5" stroke-linecap="round"/>
    <rect x="50" y="142" width="34" height="26" rx="6" fill="#8B5A2B"/>
    <path d="M50 148 Q50 140 58 140 H76 Q84 140 84 148 V156 H50Z" fill="#76491F"/>
    <rect x="64" y="152" width="6" height="6" rx="1.5" fill="#E2B04A"/>` },
  camera: { name: 'Camera', draw: () => `
    <path d="M66 112 L80 146 M114 112 L100 146" stroke="#2D2D30" stroke-width="2.5" fill="none"/>
    <rect x="76" y="140" width="30" height="21" rx="4" fill="#2D2D30"/>
    <rect x="80" y="137" width="9" height="5" rx="1.5" fill="#2D2D30"/>
    <circle cx="91" cy="150.5" r="7" fill="#55555C"/><circle cx="91" cy="150.5" r="4" fill="#8FB3D9"/>
    <circle cx="101" cy="144" r="1.5" fill="#F2C744"/>` },
  neckphones: { name: 'Headphones (neck)', draw: () => `
    <path d="M62 118 Q90 138 118 118" stroke="#D9CFBE" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="52" y="106" width="15" height="22" rx="7" fill="#EDE3D3" stroke="#CFC2AC" stroke-width="1.5"/>
    <rect x="113" y="106" width="15" height="22" rx="7" fill="#EDE3D3" stroke="#CFC2AC" stroke-width="1.5"/>` },
  sweater: { name: 'Sweater', draw: () => `
    <path d="M58 118 Q60 104 90 104 Q120 104 122 118 Q130 140 124 166 Q90 184 60 166 Q54 140 58 118Z" fill="#3E44A8"/>
    <path d="M70 110 Q90 122 110 110" stroke="#30368F" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M62 164 Q90 180 122 164" stroke="#30368F" stroke-width="5" fill="none"/>
    <text x="90" y="160" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="22" fill="#F2C744" text-anchor="middle">W</text>`,
    cuffs: () => `<ellipse cx="78" cy="144" rx="8" ry="3" fill="#30368F"/><ellipse cx="102" cy="144" rx="8" ry="3" fill="#30368F"/>` },
};

/* ----------------------------------------------------------- held items */
// Drawn around (90, 124) and shifted 10px down into the paws; the item sits in front of the paws.

export const HELD = {
  none: { name: 'None', draw: () => '' },
  acorn: { name: 'Acorn', draw: () => acorn(90, 120, 1.35) },
  coffee: { name: 'Coffee', draw: () => `
    <path d="M80 110 L100 110 L97 138 L83 138 Z" fill="#FFF" stroke="#E5DCCF" stroke-width="1"/>
    <path d="M81.5 118 L98.5 118 L97.5 128 L82.5 128Z" fill="#B7834C"/>
    ${leafShape(87, 124, .3, -25, '#4F8A45')}
    <rect x="78" y="106" width="24" height="6" rx="2.5" fill="#6B4423"/>
    <path class="fx-steam" d="M86 103 Q83 99 86 95 M94 103 Q91 99 94 95" stroke="#FFF" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>` },
  book: { name: 'Book', draw: () => `
    <rect x="76" y="106" width="28" height="34" rx="2.5" fill="#3F7A45"/>
    <rect x="76" y="106" width="5" height="34" fill="#2F5E35"/>
    <rect x="85" y="113" width="14" height="3" rx="1" fill="#D8E9C8"/>
    <path d="M104 108 V138" stroke="#F4EBDA" stroke-width="2"/>` },
  laptop: { name: 'Laptop', draw: () => `
    <rect x="72" y="102" width="36" height="25" rx="3" fill="#B9BDC4"/>
    <rect x="75" y="105" width="30" height="19" rx="1.5" fill="#DDE6F0"/>
    <circle cx="90" cy="114.5" r="2.6" fill="#C9CED6"/>
    <path d="M66 128 H114 L110 134 H70Z" fill="#A6ABB3"/>` },
  phone: { name: 'Phone', draw: () => `
    <rect x="80" y="104" width="20" height="34" rx="4" fill="#26262B"/>
    <rect x="82.5" y="108" width="15" height="25" rx="2" fill="#8EC5E8"/>
    <rect x="87" y="105.5" width="6" height="1.5" rx=".75" fill="#55555C"/>` },
  baseball: { name: 'Baseball', draw: () => `
    <circle cx="90" cy="120" r="13" fill="#FBFAF6" stroke="#E2DED3" stroke-width="1"/>
    <path d="M80 110 Q86 120 80 130 M100 110 Q94 120 100 130" stroke="#D33B3B" stroke-width="1.6" fill="none" stroke-dasharray="2 2"/>` },
  fish: { name: 'Fish', draw: () => `
    <path d="M70 120 Q84 106 100 116 L110 108 L108 120 L110 132 L100 124 Q84 134 70 120Z" fill="#4A8FD0"/>
    <path d="M80 112 Q84 120 80 128" stroke="#3A75AE" stroke-width="1.5" fill="none"/>
    <circle cx="76" cy="118" r="1.8" fill="#16243A"/>
    <path d="M86 112 Q90 109 94 112" stroke="#8FC3EA" stroke-width="1.5" fill="none"/>` },
  boba: { name: 'Bubble Tea', draw: () => `
    <path d="M100 112 L108 88" stroke="#3E8EC9" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M79 108 L101 108 L98 140 L82 140 Z" fill="#F1E4D4" fill-opacity=".9" stroke="#E2D2BE" stroke-width="1"/>
    <path d="M80.5 118 L99.5 118 L98 140 L82 140Z" fill="#C79A6B"/>
    <circle cx="85" cy="135" r="2.2" fill="#3A2416"/><circle cx="90" cy="137" r="2.2" fill="#3A2416"/><circle cx="95" cy="134" r="2.2" fill="#3A2416"/><circle cx="88" cy="131" r="2.2" fill="#3A2416"/>
    <ellipse cx="90" cy="108" rx="12" ry="3" fill="#E9DCCB"/>` },
  plant: { name: 'Plant', draw: () => `
    ${leafShape(90, 112, .7, -140, '#5E9B4F')}${leafShape(90, 112, .7, -40, '#4F8A45')}
    <path d="M90 116 L90 104" stroke="#3F6E36" stroke-width="2"/>
    <path d="M90 104 Q84 96 90 88 Q96 96 90 104Z" fill="#63A355"/>
    <path d="M78 114 H102 L99 138 H81Z" fill="#D2763F"/>
    <rect x="76" y="112" width="28" height="6" rx="2" fill="#B9622F"/>` },
  photocam: { name: 'Camera', draw: () => `
    <rect x="73" y="110" width="34" height="24" rx="4" fill="#2D2D30"/>
    <rect x="77" y="106" width="10" height="6" rx="1.5" fill="#2D2D30"/>
    <circle cx="90" cy="122" r="8.5" fill="#55555C"/><circle cx="90" cy="122" r="5" fill="#8FB3D9"/>
    <circle cx="102" cy="115" r="1.6" fill="#F2C744"/>` },
  map: { name: 'Map', draw: () => `
    <path d="M72 108 L84 112 L96 108 L108 112 L108 138 L96 134 L84 138 L72 134Z" fill="#9FD3A0"/>
    <path d="M84 112 V138 M96 108 V134" stroke="#7DBB7F" stroke-width="1"/>
    <path d="M76 128 Q86 118 92 124 T104 118" stroke="#D9473E" stroke-width="1.5" stroke-dasharray="2 2" fill="none"/>
    <path d="M102 116 l2 2 m0 -2 l-2 2" stroke="#D9473E" stroke-width="1.5"/>
    <path d="M76 112 Q80 116 78 120" fill="#7EC2E6"/>` },
  gift: { name: 'Gift', draw: () => `
    <rect x="76" y="114" width="28" height="24" rx="2.5" fill="#E9473F"/>
    <rect x="74" y="108" width="32" height="8" rx="2" fill="#F05B53"/>
    <rect x="87" y="108" width="6" height="30" fill="#F2C744"/>
    <path d="M90 108 Q82 98 78 104 Q78 108 90 108 Q98 98 102 104 Q102 108 90 108" fill="#F2C744"/>` },
  heart: { name: 'Heart', draw: () => heart(90, 108, 1.25, '#F27A8C') },
  sparkles: { name: 'Sparkles', draw: () => `
    ${star4(90, 118, 11, '#F4C842', 'fx-twinkle')}${star4(104, 104, 5, '#F7D86A', 'fx-twinkle')}${star4(76, 106, 4, '#F7D86A', 'fx-twinkle')}` },
};

/* -------------------------------------------------------------- effects */
// Drawn in the 240x200 scene frame, around the squirrel's head.

const fallers = (n, draw, cls = 'fx-fall') => Array.from({ length: n }, (_, i) => {
  const x = 18 + ((i * 53) % 210), d = (i * 0.9) % 6, dur = 5 + (i % 3);
  return `<g class="${cls}" style="animation-delay:-${d}s;animation-duration:${dur}s">${draw(x, -10, i)}</g>`;
}).join('');

export const EFFECTS = {
  none: { name: 'None', draw: () => '' },
  sleep: { name: 'Sleep (Zzz)', draw: () => `
    <g font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#5B7FD6">
      <text class="fx-float" x="150" y="62" font-size="14">z</text>
      <text class="fx-float" style="animation-delay:.7s" x="162" y="48" font-size="18">Z</text>
      <text class="fx-float" style="animation-delay:1.4s" x="176" y="32" font-size="22">Z</text>
    </g>` },
  music: { name: 'Music Notes', draw: () => `
    <g class="fx-float" fill="#8A5BD6"><ellipse cx="156" cy="62" rx="5" ry="3.8"/><path d="M160 62 V40 L168 37" stroke="#8A5BD6" stroke-width="2.4" fill="none"/></g>
    <g class="fx-float" style="animation-delay:1s" fill="#5B7FD6"><ellipse cx="62" cy="54" rx="4.5" ry="3.4"/><ellipse cx="76" cy="50" rx="4.5" ry="3.4"/><path d="M66 54 V34 L80 30 V50" stroke="#5B7FD6" stroke-width="2.4" fill="none"/></g>` },
  exclaim: { name: 'Exclamation', draw: () => `
    <g class="fx-bounce"><path d="M150 18 L160 18 L157 48 L153 48Z" fill="#F29B38"/><circle cx="155" cy="56" r="4.5" fill="#F29B38"/>
    <path d="M168 26 L175 27 L169 48 L165 47Z" fill="#E9473F"/><circle cx="166" cy="54" r="3.4" fill="#E9473F"/></g>` },
  question: { name: 'Question', draw: () => `
    <g class="fx-bounce"><path d="M146 32 Q146 16 160 16 Q174 16 174 30 Q174 40 162 44 L162 52" stroke="#3E8EC9" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="162" cy="63" r="5" fill="#3E8EC9"/></g>` },
  stars: { name: 'Stars', draw: () => [[60, 46, 9, 0], [176, 38, 11, .5], [192, 84, 7, 1], [48, 96, 6, 1.3], [160, 16, 6, .8]]
    .map(([x, y, r, d]) => `<g class="fx-twinkle" style="animation-delay:${d}s">${star4(x, y, r, '#F4C842')}</g>`).join('') },
  leaves: { name: 'Leaves', draw: () => fallers(7, (x, y, i) => leafShape(x, y, .6, i * 40, i % 2 ? '#6FAA5E' : '#4F8A45')) },
  hearts: { name: 'Hearts', draw: () => [[150, 60, .9, 0], [168, 44, .7, .8], [62, 58, .8, 1.5], [180, 70, .55, 2.1]]
    .map(([x, y, s, d]) => heart(x, y, s, '#F27A8C', 'fx-float', `animation-delay:${d}s`)).join('') },
  snow: { name: 'Snowflakes', draw: () => fallers(9, (x, y) => `<g transform="translate(${x} ${y})" stroke="#8EC9F0" stroke-width="2" stroke-linecap="round">
      <path d="M0 -7 V7 M-6 -3.5 L6 3.5 M-6 3.5 L6 -3.5"/></g>`) },
  blossoms: { name: 'Cherry Blossoms', draw: () => fallers(9, (x, y, i) => `<g transform="translate(${x} ${y}) rotate(${i * 50})">
      <ellipse rx="4.5" ry="3" fill="#F6A8BE"/><ellipse cx="3" cy="1" rx="3" ry="2" fill="#F9C4D3"/></g>`) },
  fireflies: { name: 'Fireflies', draw: () => [[50, 60], [70, 120], [180, 50], [200, 110], [160, 140], [36, 150], [120, 30]]
    .map(([x, y], i) => `<g class="fx-glow" style="animation-delay:${i * .45}s"><circle cx="${x}" cy="${y}" r="7" fill="#F7E36A" opacity=".35"/><circle cx="${x}" cy="${y}" r="2.6" fill="#FFF6B0"/></g>`).join('') },
};

/* ---------------------------------------------------------- backgrounds */
// 240 x 200, ground line around y=184.

const tree = (x, y, s, c1 = '#4F8A45', c2 = '#3F7238') => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-4" y="-6" width="8" height="34" fill="#7A5232"/>
  <circle cx="0" cy="-22" r="20" fill="${c1}"/><circle cx="-14" cy="-10" r="14" fill="${c2}"/><circle cx="14" cy="-12" r="15" fill="${c2}"/></g>`;
const pine = (x, y, s, c = '#2F6B4A') => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-2.5" y="0" width="5" height="10" fill="#5E4026"/><path d="M0 -40 L14 -12 H8 L18 4 H-18 L-8 -12 H-14Z" fill="${c}"/></g>`;
const blossomTree = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-3 30 L-2 0 Q-10 -10 -16 -14 M-1 2 Q6 -8 14 -12" stroke="#6E4A30" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="-12" cy="-18" r="14" fill="#F6B3C6"/><circle cx="10" cy="-20" r="15" fill="#F49DB6"/><circle cx="0" cy="-30" r="13" fill="#F9C9D6"/><circle cx="-20" cy="-6" r="9" fill="#F49DB6"/><circle cx="20" cy="-6" r="9" fill="#F6B3C6"/></g>`;

export const BACKGROUNDS = {
  meadow: { name: 'Default / Meadow', draw: () => `
    <rect width="240" height="200" fill="#EEF3E6"/>
    <circle cx="120" cy="92" r="70" fill="#DFEBD6"/>
    <path d="M0 160 Q60 132 120 142 T240 150 V200 H0Z" fill="#A9CF8A"/>
    <path d="M0 176 Q80 160 160 170 T240 168 V200 H0Z" fill="#94C276"/>
    ${[[30, 170], [200, 166], [180, 186], [52, 188]].map(([x, y]) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse cy="-3" rx="2" ry="3" fill="#FFF" transform="rotate(${a})"/>`).join('')}<circle r="1.6" fill="#F7C948"/></g>`).join('')}
    <path d="M18 160 V150 M18 152 Q12 146 8 148 Q12 153 18 152 M18 152 Q24 146 28 148 Q24 153 18 152" stroke="#4F8A45" stroke-width="1.6" fill="#5E9B4F"/>
    <path d="M222 156 V146 M222 148 Q216 142 212 144 Q216 149 222 148 M222 148 Q228 142 232 144 Q228 149 222 148" stroke="#4F8A45" stroke-width="1.6" fill="#5E9B4F"/>` },
  forest: { name: 'Forest', draw: () => `
    <rect width="240" height="200" fill="#CFE6CF"/>
    ${tree(20, 110, 1.6, '#6FA868', '#5C9656')}${tree(220, 104, 1.7, '#6FA868', '#5C9656')}
    ${tree(120, 96, 1.2, '#86B97E', '#76AC6E')}
    ${tree(56, 132, 1.1)}${tree(186, 130, 1.15)}
    <path d="M0 162 Q60 150 120 156 T240 154 V200 H0Z" fill="#7FB061"/>
    <path d="M0 180 Q90 170 180 178 T240 176 V200 H0Z" fill="#6E9F52"/>
    <rect x="196" y="160" width="26" height="16" rx="3" fill="#8A5E3A"/><ellipse cx="209" cy="160" rx="13" ry="4" fill="#C49A6C"/><ellipse cx="209" cy="160" rx="8" ry="2.4" fill="#A97C50"/>
    <g transform="translate(26 176)"><rect x="-2" y="-6" width="4" height="8" fill="#F4EBDA"/><path d="M-9 -6 Q0 -17 9 -6Z" fill="#D9473E"/><circle cx="-3" cy="-9" r="1.4" fill="#FFF"/><circle cx="3" cy="-8" r="1.2" fill="#FFF"/></g>
    <g transform="translate(40 180) scale(.7)"><rect x="-2" y="-6" width="4" height="8" fill="#F4EBDA"/><path d="M-9 -6 Q0 -17 9 -6Z" fill="#D9473E"/></g>` },
  campus: { name: 'Campus', draw: () => `
    <rect width="240" height="200" fill="#D9ECF5"/>
    <g fill="#B9A58A">
      <rect x="70" y="72" width="100" height="80"/>
      <path d="M70 72 L80 52 L90 72Z M150 72 L160 52 L170 72Z"/>
      <rect x="104" y="38" width="32" height="40"/><path d="M104 38 L112 20 L120 38 L128 20 L136 38Z"/>
    </g>
    <g fill="#8E7B62">
      ${[80, 96, 136, 152].map(x => `<path d="M${x} 112 V96 Q${x + 4} 88 ${x + 8} 96 V112Z"/>`).join('')}
      <path d="M110 112 V78 Q120 62 130 78 V112Z" fill="#6E8BA6"/>
      <path d="M112 152 V130 Q120 122 128 130 V152Z"/>
      ${[80, 96, 136, 152].map(x => `<rect x="${x}" y="124" width="8" height="14" rx="1"/>`).join('')}
    </g>
    <path d="M0 150 H240 V200 H0Z" fill="#8FC27A"/>
    <path d="M104 152 L92 200 H148 L136 152Z" fill="#E6DCC8"/>
    ${blossomTree(28, 136, 1.3)}${blossomTree(212, 134, 1.35)}
    ${blossomTree(62, 150, .8)}${blossomTree(180, 150, .85)}` },
  room: { name: 'Cozy Room', draw: () => `
    <rect width="240" height="200" fill="#F2D9C2"/>
    <rect width="240" height="150" fill="#F4DEC9"/>
    <rect x="30" y="34" width="56" height="62" rx="3" fill="#FFF7EE"/><rect x="34" y="38" width="48" height="54" fill="#BFE0F0"/>
    <path d="M58 38 V92 M34 65 H82" stroke="#FFF7EE" stroke-width="4"/>
    <rect x="160" y="40" width="22" height="18" fill="#C79A6B"/><rect x="163" y="43" width="16" height="12" fill="#9FD3A0"/>
    <rect x="150" y="70" width="60" height="82" rx="2" fill="#8A5A34"/>
    ${[78, 104, 130].map(y => `<rect x="154" y="${y}" width="52" height="2.5" fill="#6E4628"/>`).join('')}
    ${[[156, 82, '#D9473E'], [163, 84, '#3E8EC9'], [170, 80, '#F2C744'], [178, 83, '#4F8A45'], [156, 108, '#8A5BD6'], [164, 106, '#F29B38'], [172, 108, '#3E8EC9'], [184, 104, '#D9473E']]
      .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="6" height="${(y < 100 ? 104 : 130) - y}" fill="${c}"/>`).join('')}
    <path d="M0 150 H240 V200 H0Z" fill="#D9A877"/>
    <path d="M0 165 H240 M0 182 H240" stroke="#C99766" stroke-width="1.5"/>
    <ellipse cx="120" cy="184" rx="78" ry="12" fill="#F2A9A9"/><ellipse cx="120" cy="184" rx="56" ry="8" fill="#F7C3C0"/>
    <path d="M18 150 L22 128 H40 L44 150Z" fill="#D2763F"/>
    ${leafShape(31, 128, .9, -120, '#4F8A45')}${leafShape(31, 128, .9, -60, '#5E9B4F')}${leafShape(31, 126, .8, -90, '#63A355')}` },
  beach: { name: 'Beach', draw: () => `
    <rect width="240" height="200" fill="#BFE6F5"/>
    <circle cx="190" cy="40" r="14" fill="#FFF3B8"/>
    <path d="M30 34 Q40 26 52 32 Q62 28 68 36 H30Z M150 60 Q158 54 168 58 Q176 55 180 62 H150Z" fill="#FFF"/>
    <rect y="110" width="240" height="44" fill="#5CC3D6"/>
    <path d="M0 122 Q30 118 60 122 T120 122 T180 122 T240 122" stroke="#9FE0EA" stroke-width="2" fill="none"/>
    <path d="M0 154 Q60 140 120 148 T240 146 V200 H0Z" fill="#F3DDA6"/>
    <path d="M196 160 Q200 120 214 92" stroke="#8A5E3A" stroke-width="6" fill="none" stroke-linecap="round"/>
    ${[-160, -120, -60, -20, 20].map(r => `<path d="M214 92 Q${214 + Math.cos(r * Math.PI / 180) * 20} ${92 + Math.sin(r * Math.PI / 180) * 20 - 6} ${214 + Math.cos(r * Math.PI / 180) * 34} ${92 + Math.sin(r * Math.PI / 180) * 34 + 6}" stroke="#4F8A45" stroke-width="6" fill="none" stroke-linecap="round"/>`).join('')}
    <ellipse cx="34" cy="150" rx="18" ry="10" fill="#8E9AA3"/><ellipse cx="54" cy="156" rx="10" ry="6" fill="#A5B0B8"/>
    <path d="M150 180 l4 -3 4 3 -4 3Z" fill="#F29B38"/>` },
  mountains: { name: 'Mountains', draw: () => `
    <rect width="240" height="200" fill="#CDE6F4"/>
    <path d="M40 132 L120 36 L200 132Z" fill="#8FA3BF"/>
    <path d="M120 36 L140 60 L130 58 L124 66 L116 58 L106 62 L100 60Z" fill="#FFF"/>
    <path d="M-10 132 L40 80 L90 132Z M150 132 L200 86 L250 132Z" fill="#A7B8CE"/>
    <rect y="130" width="240" height="26" fill="#6BB3D6"/>
    <path d="M30 140 H70 M150 146 H200" stroke="#A6D6EC" stroke-width="2"/>
    ${pine(14, 140, 1.2)}${pine(34, 146, .9, '#3D7D57')}${pine(208, 140, 1.25)}${pine(228, 146, .95, '#3D7D57')}
    <path d="M0 156 Q60 148 120 152 T240 150 V200 H0Z" fill="#7FB061"/>
    <ellipse cx="200" cy="160" rx="14" ry="7" fill="#8E9AA3"/>` },
  city: { name: 'City', draw: () => `
    <defs><linearGradient id="bg-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6D5BB8"/><stop offset=".6" stop-color="#C98AB8"/><stop offset="1" stop-color="#F2B98A"/></linearGradient></defs>
    <rect width="240" height="200" fill="url(#bg-dusk)"/>
    ${[[0, 100, 30], [26, 80, 24], [150, 90, 26], [178, 70, 30], [210, 96, 30]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${160 - y}" fill="#4A3F7A"/>`).join('')}
    ${[[6, 108], [14, 120], [32, 90], [40, 104], [156, 100], [164, 116], [186, 82], [196, 96], [186, 110], [216, 106], [226, 120]].map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="5" fill="#F7D86A"/>`).join('')}
    <g fill="#3C3266">
      <path d="M116 160 L120 70 L124 160Z M106 160 L118 92 L120 92 L112 160Z M134 160 L122 92 L120 92 L128 160Z"/>
      <ellipse cx="120" cy="62" rx="20" ry="5"/><path d="M104 60 Q120 48 136 60Z"/><rect x="119" y="34" width="2" height="18"/>
    </g>
    <path d="M0 160 H240 V200 H0Z" fill="#3A315F"/>
    <path d="M0 172 H240" stroke="#54497F" stroke-width="2"/>` },
};

/* ----------------------------------------------------------- composition */

export const CATALOG = {
  backgrounds: BACKGROUNDS,
  head: HEAD,
  neck: NECK,
  held: HELD,
  effects: EFFECTS,
};

const DEFS = `<defs><linearGradient id="sq-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6CC5A"/><stop offset="1" stop-color="#D99A26"/></linearGradient></defs>`;

/**
 * Full scene: background + level props + squirrel + effect.
 * opts: { level 1-5, background, head, neck, held, effect, label }
 */
export function renderScene(opts = {}) {
  const { level = 1, background = 'meadow', effect = 'none', label } = opts;
  const L = LEVELS[level - 1];
  const s = L.scale;
  const bg = (BACKGROUNDS[background] || BACKGROUNDS.meadow).draw();
  return `<svg class="sq-scene" viewBox="0 0 240 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label || `${L.name} squirrel`}">
  ${DEFS}
  ${bg}
  ${levelProps(level)}
  <ellipse cx="120" cy="187" rx="${48 * s}" ry="${6 * s}" fill="#000" opacity=".13"/>
  <g transform="translate(120 186) scale(${s}) translate(-92 -182)">
    ${squirrelBody(level, opts)}
  </g>
  ${(EFFECTS[effect] || EFFECTS.none).draw()}
</svg>`;
}

/** Squirrel only, transparent background (for the popup or overlay). */
export function renderSquirrel(opts = {}) {
  const { level = 1 } = opts;
  const s = LEVELS[level - 1].scale;
  return `<svg class="sq-scene" viewBox="0 0 240 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${LEVELS[level - 1].name} squirrel">
  ${DEFS}
  <ellipse cx="120" cy="187" rx="${48 * s}" ry="${6 * s}" fill="#000" opacity=".13"/>
  <g transform="translate(120 186) scale(${s}) translate(-92 -182)">${squirrelBody(level, opts)}</g>
  ${opts.effect ? (EFFECTS[opts.effect] || EFFECTS.none).draw() : ''}
</svg>`;
}

/** A single catalog item on its own (for shop tiles). viewBox is a sensible default per category. */
const ITEM_VIEW = { head: '30 0 120 120', neck: '30 90 120 100', held: '58 84 64 64', effects: '20 0 200 160', backgrounds: '0 0 240 200' };
export function renderItem(category, id) {
  const item = CATALOG[category]?.[id];
  if (!item) return '';
  const inner = category === 'neck' && item.back ? item.back() + item.draw() : item.draw();
  return `<svg viewBox="${ITEM_VIEW[category]}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${item.name}">${DEFS}${inner}</svg>`;
}

/** Animations. Inject once: document.head.insertAdjacentHTML('beforeend', `<style>${SCENE_CSS}</style>`) */
export const SCENE_CSS = `
.sq-scene .sq-bob{animation:sq-bob 2.6s ease-in-out infinite;transform-box:view-box;transform-origin:92px 182px}
.sq-scene .sq-tail{animation:sq-sway 2.6s ease-in-out infinite;transform-box:view-box;transform-origin:110px 162px}
.sq-scene .sq-eye{animation:sq-blink 4.6s infinite;transform-box:fill-box;transform-origin:center}
.sq-scene .sq-ear{animation:sq-twitch 5.5s infinite;transform-box:fill-box;transform-origin:20% 100%}
.sq-scene .fx-twinkle{animation:fx-twinkle 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.sq-scene .fx-float{animation:fx-float 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.sq-scene .fx-bounce{animation:fx-bounce 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center bottom}
.sq-scene .fx-fall{animation:fx-fall 6s linear infinite}
.sq-scene .fx-glow{animation:fx-glow 2.2s ease-in-out infinite}
.sq-scene .fx-steam{animation:fx-steam 2s ease-in-out infinite}
@keyframes sq-bob{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(-4px) scaleY(1.015)}}
@keyframes sq-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(5deg)}}
@keyframes sq-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes sq-twitch{0%,80%,100%{transform:rotate(0)}84%{transform:rotate(12deg)}88%{transform:rotate(-4deg)}}
@keyframes fx-twinkle{0%,100%{transform:scale(.45);opacity:.35}50%{transform:scale(1);opacity:1}}
@keyframes fx-float{0%{transform:translateY(6px);opacity:0}25%{opacity:1}100%{transform:translateY(-14px);opacity:0}}
@keyframes fx-bounce{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-6px) scale(1.05)}}
@keyframes fx-fall{0%{transform:translate(0,0) rotate(0)}50%{transform:translate(10px,105px) rotate(120deg)}100%{transform:translate(-6px,215px) rotate(260deg)}}
@keyframes fx-glow{0%,100%{opacity:.25;transform:translate(0,0)}50%{opacity:1;transform:translate(3px,-4px)}}
@keyframes fx-steam{0%,100%{opacity:.25;transform:translateY(2px)}50%{opacity:.85;transform:translateY(-2px)}}
@media (prefers-reduced-motion:reduce){.sq-scene *{animation:none!important}}
`;
