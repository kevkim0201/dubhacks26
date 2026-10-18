import { checkAuth, signInWithGoogle } from "../lib/auth.js";
import { setPopupIntent } from "../lib/checkout.js";
import { equipCosmetic, loadCosmeticsState, purchaseCosmetic, unequipCosmetic } from "../lib/cosmetics-api.js";
import { renderItem, renderScene, SCENE_CSS } from "../../assets/squirrel-assets.js";
import { icons } from "../ui/art.js";
import { acornChip, escape, logo } from "../ui/components.js";

const app = document.getElementById("app");
const TIERS = [
  { name: "Baby", minXp: 0 },
  { name: "Scout", minXp: 250 },
  { name: "Forager", minXp: 1000 },
  { name: "Hoarder", minXp: 3000 },
  { name: "Golden", minXp: 7500 },
];

const CATEGORIES = ["Backgrounds", "Hats", "Neck & body", "Held items", "Effects", "Pets"];
const ITEMS = [
  { id: "meadow", name: "Meadow", category: "Backgrounds", icon: "🌼", cost: 0, tier: "Baby", scene: "meadow" },
  { id: "forest", name: "Forest", category: "Backgrounds", icon: "🌲", cost: 200, tier: "Scout", scene: "forest" },
  { id: "cozy-room", name: "Cozy Room", category: "Backgrounds", icon: "🪴", cost: 250, tier: "Scout", scene: "room" },
  { id: "beach", name: "Beach", category: "Backgrounds", icon: "🏖️", cost: 450, tier: "Forager", scene: "beach" },
  { id: "mountains", name: "Mountains", category: "Backgrounds", icon: "🏔️", cost: 600, tier: "Forager", scene: "mountains" },
  { id: "city", name: "City", category: "Backgrounds", icon: "🌆", cost: 1200, tier: "Hoarder", scene: "city" },
  { id: "campus", name: "Campus", category: "Backgrounds", icon: "🏛️", cost: 2500, tier: "Golden", scene: "campus" },

  { id: "beanie", name: "Beanie", category: "Hats", icon: "🧢", cost: 25, tier: "Baby" },
  { id: "leaf-hat", name: "Leaf", category: "Hats", icon: "🍃", cost: 25, tier: "Baby" },
  { id: "cap", name: "Cap", category: "Hats", icon: "🧢", cost: 30, tier: "Baby" },
  { id: "flower", name: "Flower", category: "Hats", icon: "🌸", cost: 30, tier: "Baby" },
  { id: "bucket-hat", name: "Bucket Hat", category: "Hats", icon: "👒", cost: 50, tier: "Baby" },
  { id: "sun-hat", name: "Sun Hat", category: "Hats", icon: "👒", cost: 80, tier: "Scout" },
  { id: "chef-hat", name: "Chef Hat", category: "Hats", icon: "👨‍🍳", cost: 90, tier: "Scout" },
  { id: "party-hat", name: "Party Hat", category: "Hats", icon: "🥳", cost: 90, tier: "Scout" },
  { id: "glasses", name: "Glasses", category: "Hats", icon: "🤓", cost: 100, tier: "Scout" },
  { id: "headphones", name: "Headphones", category: "Hats", icon: "🎧", cost: 120, tier: "Scout" },
  { id: "animal-hood", name: "Animal Hood", category: "Hats", icon: "🐻", cost: 200, tier: "Forager" },
  { id: "sunglasses", name: "Sunglasses", category: "Hats", icon: "🕶️", cost: 220, tier: "Forager" },
  { id: "goggles", name: "Goggles", category: "Hats", icon: "🥽", cost: 280, tier: "Forager" },
  { id: "wizard-hat", name: "Wizard Hat", category: "Hats", icon: "🧙", cost: 350, tier: "Forager" },
  { id: "devil-horns", name: "Devil Horns", category: "Hats", icon: "😈", cost: 650, tier: "Hoarder" },
  { id: "halo", name: "Halo", category: "Hats", icon: "😇", cost: 750, tier: "Hoarder" },

  { id: "scarf", name: "Scarf", category: "Neck & body", icon: "🧣", cost: 40, tier: "Baby" },
  { id: "backpack", name: "Backpack", category: "Neck & body", icon: "🎒", cost: 0, tier: "Scout", gift: true },
  { id: "bow-tie", name: "Bow Tie", category: "Neck & body", icon: "🎀", cost: 90, tier: "Scout" },
  { id: "bell-collar", name: "Bell Collar", category: "Neck & body", icon: "🔔", cost: 100, tier: "Scout" },
  { id: "bandana", name: "Bandana", category: "Neck & body", icon: "🟩", cost: 0, tier: "Forager", gift: true },
  { id: "neck-headphones", name: "Headphones", category: "Neck & body", icon: "🎧", cost: 250, tier: "Forager" },
  { id: "camera-neck", name: "Camera", category: "Neck & body", icon: "📷", cost: 300, tier: "Forager" },
  { id: "satchel", name: "Satchel", category: "Neck & body", icon: "👜", cost: 0, tier: "Hoarder", gift: true },
  { id: "sweater", name: "Sweater", category: "Neck & body", icon: "🧥", cost: 650, tier: "Hoarder" },
  { id: "crown", name: "Crown", category: "Hats", icon: "👑", cost: 0, tier: "Golden", gift: true },

  { id: "acorn", name: "Acorn", category: "Held items", icon: "🌰", cost: 0, tier: "Baby" },
  { id: "coffee", name: "Coffee", category: "Held items", icon: "☕", cost: 15, tier: "Baby" },
  { id: "book", name: "Book", category: "Held items", icon: "📗", cost: 20, tier: "Baby" },
  { id: "phone", name: "Phone", category: "Held items", icon: "📱", cost: 75, tier: "Scout" },
  { id: "baseball", name: "Baseball", category: "Held items", icon: "⚾", cost: 75, tier: "Scout" },
  { id: "bubble-tea", name: "Bubble Tea", category: "Held items", icon: "🧋", cost: 85, tier: "Scout" },
  { id: "fish", name: "Fish", category: "Held items", icon: "🐟", cost: 85, tier: "Scout" },
  { id: "laptop", name: "Laptop", category: "Held items", icon: "💻", cost: 110, tier: "Scout" },
  { id: "plant", name: "Plant", category: "Held items", icon: "🪴", cost: 200, tier: "Forager" },
  { id: "map", name: "Map", category: "Held items", icon: "🗺️", cost: 220, tier: "Forager" },
  { id: "camera", name: "Camera", category: "Held items", icon: "📷", cost: 280, tier: "Forager" },
  { id: "gift", name: "Gift", category: "Held items", icon: "🎁", cost: 600, tier: "Hoarder" },
  { id: "heart", name: "Heart", category: "Held items", icon: "💛", cost: 600, tier: "Hoarder" },
  { id: "sparkles", name: "Sparkles", category: "Held items", icon: "✨", cost: 750, tier: "Hoarder" },

  { id: "zzz", name: "Zzz", category: "Effects", icon: "💤", cost: 75, tier: "Scout" },
  { id: "exclamation", name: "!", category: "Effects", icon: "❕", cost: 75, tier: "Scout" },
  { id: "question", name: "?", category: "Effects", icon: "❔", cost: 75, tier: "Scout" },
  { id: "music-notes", name: "Music Notes", category: "Effects", icon: "🎵", cost: 100, tier: "Scout" },
  { id: "leaves", name: "Leaves", category: "Effects", icon: "🍃", cost: 200, tier: "Forager" },
  { id: "hearts", name: "Hearts", category: "Effects", icon: "💕", cost: 250, tier: "Forager" },
  { id: "stars", name: "Stars", category: "Effects", icon: "⭐", cost: 300, tier: "Forager" },
  { id: "snowflakes", name: "Snowflakes", category: "Effects", icon: "❄️", cost: 600, tier: "Hoarder" },
  { id: "fireflies", name: "Fireflies", category: "Effects", icon: "✨", cost: 750, tier: "Hoarder" },
  { id: "cherry-blossoms", name: "Cherry Blossoms", category: "Effects", icon: "🌸", cost: 900, tier: "Hoarder" },

  { id: "pet-bunny", name: "Bunny", category: "Pets", icon: "🐰", cost: 35, tier: "Baby" },
  { id: "pet-chick", name: "Chick", category: "Pets", icon: "🐥", cost: 50, tier: "Baby" },
  { id: "pet-turtle", name: "Turtle", category: "Pets", icon: "🐢", cost: 150, tier: "Scout" },
  { id: "pet-fox", name: "Fox", category: "Pets", icon: "🦊", cost: 300, tier: "Forager" },
  { id: "pet-otter", name: "Otter", category: "Pets", icon: "🦦", cost: 600, tier: "Hoarder" },
];

const ASSETS = {
  meadow: ["backgrounds", "meadow"],
  forest: ["backgrounds", "forest"],
  "cozy-room": ["backgrounds", "room"],
  beach: ["backgrounds", "beach"],
  mountains: ["backgrounds", "mountains"],
  city: ["backgrounds", "city"],
  campus: ["backgrounds", "campus"],
  beanie: ["head", "beanie"],
  "leaf-hat": ["head", "leaf"],
  cap: ["head", "cap"],
  flower: ["head", "flower"],
  "bucket-hat": ["head", "bucket"],
  "sun-hat": ["head", "sunhat"],
  "chef-hat": ["head", "chef"],
  "party-hat": ["head", "party"],
  glasses: ["head", "glasses"],
  headphones: ["head", "headphones"],
  "animal-hood": ["head", "hood"],
  sunglasses: ["head", "sunglasses"],
  goggles: ["head", "goggles"],
  "wizard-hat": ["head", "wizard"],
  "devil-horns": ["head", "horns"],
  halo: ["head", "halo"],
  scarf: ["neck", "scarf"],
  backpack: ["neck", "backpack"],
  "bow-tie": ["neck", "bowtie"],
  "bell-collar": ["neck", "collar"],
  bandana: ["neck", "bandana"],
  "neck-headphones": ["neck", "neckphones"],
  "camera-neck": ["neck", "camera"],
  satchel: ["neck", "satchel"],
  sweater: ["neck", "sweater"],
  crown: ["head", "crown"],
  acorn: ["held", "acorn"],
  coffee: ["held", "coffee"],
  book: ["held", "book"],
  phone: ["held", "phone"],
  baseball: ["held", "baseball"],
  "bubble-tea": ["held", "boba"],
  fish: ["held", "fish"],
  laptop: ["held", "laptop"],
  plant: ["held", "plant"],
  map: ["held", "map"],
  camera: ["held", "photocam"],
  gift: ["held", "gift"],
  heart: ["held", "heart"],
  sparkles: ["held", "sparkles"],
  zzz: ["effects", "sleep"],
  exclamation: ["effects", "exclaim"],
  question: ["effects", "question"],
  "music-notes": ["effects", "music"],
  leaves: ["effects", "leaves"],
  hearts: ["effects", "hearts"],
  stars: ["effects", "stars"],
  snowflakes: ["effects", "snow"],
  fireflies: ["effects", "fireflies"],
  "cherry-blossoms": ["effects", "blossoms"],
  "pet-bunny": ["pets", "bunny"],
  "pet-chick": ["pets", "chick"],
  "pet-turtle": ["pets", "turtle"],
  "pet-fox": ["pets", "fox"],
  "pet-otter": ["pets", "otter"],
};

const state = {
  session: null,
  category: "Backgrounds",
  selected: "forest",
  xp: 420,
  acorns: 320,
  owned: new Set(),
  equipped: { Backgrounds: "meadow", "Held items": "acorn", "Neck & body": "backpack" },
  loading: true,
  loadError: "",
  saving: false,
  toast: "",
  previewDefault: false,
};

const tierIndex = (tier) => TIERS.findIndex((item) => item.name === tier);
const currentTier = () => [...TIERS].reverse().find((tier) => state.xp >= tier.minXp);
const currentCategoryItems = () => ITEMS.filter((item) => item.category === state.category);
const selectedItem = () => ITEMS.find((item) => item.id === state.selected);
const fmt = (n) => new Intl.NumberFormat().format(n);
const assetFor = (item) => (item ? ASSETS[item.id] : undefined);
const slotForCategory = {
  Backgrounds: "background",
  Hats: "head",
  "Neck & body": "neck",
  "Held items": "held",
  Effects: "effect",
  Pets: "pet",
};

function sceneOptions() {
  const chosen = state.previewDefault ? null : selectedItem();
  const equipped = (category) =>
    chosen?.category === category ? chosen : ITEMS.find((item) => item.id === state.equipped[category]);
  const [backgroundCategory, background] = assetFor(equipped("Backgrounds")) ?? ["backgrounds", "meadow"];
  const [headCategory, head] = assetFor(equipped("Hats")) ?? ["head", "none"];
  const [neckCategory, neck] = assetFor(equipped("Neck & body")) ?? ["neck", "none"];
  const [heldCategory, held] = assetFor(equipped("Held items")) ?? ["held", "none"];
  const [effectCategory, effect] = assetFor(equipped("Effects")) ?? ["effects", "none"];
  const [petCategory, pet] = assetFor(equipped("Pets")) ?? ["pets", "none"];
  return {
    level: tierIndex(currentTier().name) + 1,
    background: backgroundCategory === "backgrounds" ? background : "meadow",
    head: headCategory === "head" ? head : "none",
    neck: neckCategory === "neck" ? neck : "none",
    held: heldCategory === "held" ? held : "none",
    effect: effectCategory === "effects" ? effect : "none",
    pet: petCategory === "pets" ? pet : "none",
    label: `${currentTier().name} squirrel`,
  };
}

function preview() {
  const options = sceneOptions();
  const background = ITEMS.find((item) => assetFor(item)?.[1] === options.background && item.category === "Backgrounds");
  return `
    <div class="preview-scene">
      ${renderScene(options)}
      <span class="scene-label">${background?.name ?? "Meadow"}${background && state.equipped.Backgrounds !== background.id ? " · preview" : ""}</span>
    </div>`;
}

function header() {
  return `
    <header class="avatar-topbar">
      <a class="brand" href="${chrome.runtime.getURL("dashboard/index.html")}" aria-label="Nook home">${logo()}</a>
      <nav class="page-nav" aria-label="Nook pages">
        <a href="${chrome.runtime.getURL("dashboard/index.html")}">${icons.chart(16)}<span>Your impact</span></a>
        <a class="active" href="${chrome.runtime.getURL("avatar/index.html")}">${icons.sparkle(16)}<span>Avatar</span></a>
        <a href="${chrome.runtime.getURL("quests/index.html")}">${icons.leaf(16)}<span>Quests</span></a>
        <button data-action="open-talk">${icons.wave(16)}<span>Talk to Pip</span></button>
      </nav>
      <div class="top-balance">${acornChip(state.acorns)}<span class="tier-pill">${currentTier().name}</span></div>
    </header>`;
}

function itemCard(item) {
  const locked = tierIndex(item.tier) > tierIndex(currentTier().name);
  const owned = state.owned.has(item.id);
  const active = state.equipped[item.category] === item.id;
  const meta = active
    ? "Wearing"
    : owned
      ? "Owned"
      : item.gift
        ? locked
          ? `Gift at ${item.tier}`
          : "Tier-up gift"
        : locked
          ? `${item.tier} tier`
          : `<span class="price">${item.cost === 0 ? "Free" : `${icons.acorn(13)} ${item.cost}`}</span>`;
  return `
    <button class="item-card ${state.selected === item.id ? "selected" : ""} ${locked ? "locked" : ""}" data-item="${item.id}" aria-pressed="${state.selected === item.id}">
      <span class="item-art">${renderItem(...assetFor(item))}</span>
      <span class="item-name">${item.name}</span>
      <span class="item-meta">${meta}</span>
      ${locked ? `<span class="item-lock">${icons.lock(12)}</span>` : ""}
    </button>`;
}

function catalog() {
  return `
    <section class="catalog">
      <div class="catalog-heading">
        <div><p class="eyebrow">The Nook shop</p><h2>Find your next favorite</h2></div>
        <span class="gift-note">${icons.sparkle(15)} Tier-up gifts are on us</span>
      </div>
      <div class="category-tabs" role="tablist" aria-label="Shop categories">
        ${CATEGORIES.map((category) => `<button role="tab" aria-selected="${state.category === category}" class="${state.category === category ? "active" : ""}" data-category="${category}">${category}</button>`).join("")}
      </div>
      <div class="item-grid">${currentCategoryItems().map(itemCard).join("")}</div>
    </section>`;
}

function details() {
  const item = selectedItem();
  if (!item) return "";
  const locked = tierIndex(item.tier) > tierIndex(currentTier().name);
  const owned = state.owned.has(item.id);
  const active = state.equipped[item.category] === item.id;
  const canAfford = state.acorns >= item.cost;
  const buttonText = locked
    ? `Unlocks at ${item.tier}`
    : owned
        ? "Wear this"
        : item.cost === 0
          ? (item.gift ? "Claim gift" : "Get for free")
          : `Get it · ${item.cost} acorns`;
  return `
    <aside class="item-details">
      <p class="eyebrow">Selected ${item.category.toLowerCase()}</p>
      <div class="detail-icon">${renderItem(...assetFor(item))}</div>
      <h2>${item.name}</h2>
      <p class="muted">${item.gift ? `A little welcome gift when Pip reaches ${item.tier}.` : item.cost === 0 ? "A classic look for Pip, always free." : `A ${item.tier}-tier favorite, made for your next adventure.`}</p>
      <div class="detail-facts"><span>Available at</span><strong>${item.tier} · ${TIERS.find((tier) => tier.name === item.tier).minXp.toLocaleString()} XP</strong></div>
      ${active
        ? `<button class="btn btn-outline item-action" data-action="unequip">Remove from Pip</button>`
        : `<button class="btn btn-primary item-action" data-action="equip" ${locked || (!owned && !canAfford) ? "disabled" : ""}>${buttonText}</button>`}
      ${!locked && !owned && !canAfford ? `<p class="muted afford-note">You need ${fmt(item.cost - state.acorns)} more acorns.</p>` : ""}
    </aside>`;
}

function page() {
  const tier = currentTier();
  const nextTier = TIERS.find((tier) => tier.minXp > state.xp);
  const xpRemaining = nextTier ? nextTier.minXp - state.xp : 0;
  const progress = nextTier
    ? Math.round(((state.xp - tier.minXp) / (nextTier.minXp - tier.minXp)) * 100)
    : 100;
  app.innerHTML = `
    ${header()}
    <main class="avatar-page">
      <section class="page-intro">
        <div><p class="eyebrow">Your little corner of the forest</p><h1>Make Pip feel like <em>you.</em></h1><p class="muted">Pick a look, try it on, and celebrate every thoughtful choice along the way.</p></div>
        <div class="demo-pill"><span></span> Saved to your account</div>
      </section>
      ${state.loadError ? `<div class="avatar-error" role="alert">${escape(state.loadError)} <button data-action="retry">Try again</button></div>` : ""}
      <section class="closet-layout">
        <div class="preview-panel">
          <div class="preview-heading"><div><p class="eyebrow">Your companion</p><h2>Pip's look</h2></div><span class="tier-pill">${currentTier().name} · ${fmt(state.xp)} XP</span></div>
          ${preview()}
          <div class="level-progress"><div class="level-label"><strong>${nextTier ? `${fmt(xpRemaining)} XP to ${nextTier.name}` : "Top tier reached"}</strong><span>${fmt(state.xp)} XP total</span></div><div class="xp-track"><span style="width:${progress}%"></span></div></div>
          <p class="gift-reminder">${icons.sparkle(15)} Reach a new tier to receive its signature gift for free.</p>
        </div>
        ${details()}
      </section>
      ${catalog()}
      <p class="persistence-note">Your acorns and Pip's outfit are saved to your account and follow you across Nook.</p>
    </main>
    ${state.toast ? `<div class="toast" role="status">${escape(state.toast)}</div>` : ""}`;
}

function applyCosmeticsState(data) {
  state.xp = Number(data.profile.total_xp);
  state.acorns = Number(data.profile.acorn_balance);
  state.owned = new Set(data.cosmetics.filter((item) => item.owned).map((item) => item.id));
  for (const cosmetic of data.cosmetics) {
    const item = ITEMS.find((candidate) => candidate.id === cosmetic.id);
    if (item) {
      item.cost = Number(cosmetic.cost_acorns);
      item.tier = cosmetic.minimum_tier;
      item.gift = cosmetic.is_tier_gift;
    }
  }
  state.equipped = Object.fromEntries(
    Object.entries(data.equipped).flatMap(([slot, id]) => {
      const item = ITEMS.find((candidate) => candidate.id === id);
      return item ? [[item.category, id]] : [];
    })
  );
}

async function load() {
  state.loading = true;
  state.loadError = "";
  render();
  try {
    applyCosmeticsState(await loadCosmeticsState());
  } catch (error) {
    console.error(error);
    state.loadError = error?.message ?? String(error);
  } finally {
    state.loading = false;
    render();
  }
}

function notify(message) {
  state.toast = message;
  page();
  setTimeout(() => {
    state.toast = "";
    page();
  }, 2600);
}

function render() {
  if (!state.session) {
    app.innerHTML = `
      <main class="avatar-signin">
        <div class="signin-squirrel">${renderScene({ level: 1, background: "meadow", effect: "stars" })}</div>
        <p class="eyebrow">A little personality goes a long way</p><h1>Style your squirrel</h1>
        <p class="muted">Sign in to visit the Nook closet and preview Pip's next look.</p>
        <button class="btn btn-outline" data-action="google">${icons.google()}<span>Continue with Google</span></button>
        ${state.toast ? `<p class="error">${escape(state.toast)}</p>` : ""}
      </main>`;
    return;
  }
  if (state.loading) {
    app.innerHTML = `<main class="avatar-loading"><div class="spinner" aria-label="Loading your avatar"></div><p>Loading your closet…</p></main>`;
    return;
  }
  if (state.loadError) {
    app.innerHTML = `<main class="avatar-load-error" role="alert"><p class="eyebrow">Couldn't load your closet</p><h1>Your account data is unavailable.</h1><p>${escape(state.loadError)}</p><button class="btn btn-primary" data-action="retry">Try again</button></main>`;
    return;
  }
  page();
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.category) {
    state.category = button.dataset.category;
    state.selected = currentCategoryItems()[0]?.id;
    state.previewDefault = false;
    render();
  } else if (button.dataset.item) {
    state.selected = button.dataset.item;
    state.previewDefault = false;
    render();
  } else if (button.dataset.action === "equip") {
    const item = selectedItem();
    if (!item || state.saving) return;
    state.saving = true;
    button.disabled = true;
    try {
      if (!state.owned.has(item.id)) applyCosmeticsState(await purchaseCosmetic(item.id));
      applyCosmeticsState(await equipCosmetic(item.id));
      notify(`${item.name} is ready on Pip!`);
    } catch (error) {
      console.error(error);
      state.toast = error?.message ?? String(error);
      render();
    } finally {
      state.saving = false;
    }
  } else if (button.dataset.action === "unequip") {
    const item = selectedItem();
    const slot = item && slotForCategory[item.category];
    if (!item || !slot || state.saving) return;
    state.saving = true;
    button.disabled = true;
    try {
      applyCosmeticsState(await unequipCosmetic(slot));
      state.previewDefault = true;
      notify(`${item.name} was removed. Pip's default look is back!`);
    } catch (error) {
      console.error(error);
      state.toast = error?.message ?? String(error);
      render();
    } finally {
      state.saving = false;
    }
  } else if (button.dataset.action === "retry") {
    await load();
  } else if (button.dataset.action === "google") {
    button.disabled = true;
    try {
      state.session = await signInWithGoogle();
      await load();
    } catch (error) {
      state.toast = error?.message ?? String(error);
      render();
    }
  } else if (button.dataset.action === "open-talk") {
    await setPopupIntent("talk");
    try {
      await chrome.action.openPopup();
    } catch (error) {
      console.error(error);
      notify("Click the Nook icon in your toolbar to talk with Pip.");
    }
  }
});

checkAuth()
  .then((session) => {
    state.session = session;
    if (session) return load();
    state.loading = false;
    render();
  })
  .catch((error) => {
    console.error(error);
    state.toast = error?.message ?? String(error);
    render();
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  const key = state.session?.user?.id ? `cosmetics:${state.session.user.id}` : "";
  if (areaName === "local" && key && changes[key]?.newValue) {
    applyCosmeticsState(changes[key].newValue);
    render();
  }
});

const sceneStyle = document.createElement("style");
sceneStyle.textContent = SCENE_CSS;
document.head.append(sceneStyle);
