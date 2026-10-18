// Pip's growth, derived from the backend profile (profiles.total_xp / acorn_balance / tier).
// The database is the source of truth: XP and acorns are awarded by
// record_checkout_decision, and tiers are a generated column in schema.sql.

// Must match the `tier` expression in supabase/schema.sql.
export const LEVELS = [
  { level: 1, name: "Baby", min: 0 },
  { level: 2, name: "Scout", min: 250, unlock: { label: "Backpack" } },
  { level: 3, name: "Forager", min: 1000, unlock: { label: "Bandana" } },
  { level: 4, name: "Hoarder", min: 3000, unlock: { label: "Satchel" } },
  { level: 5, name: "Golden", min: 7500, unlock: { label: "Crown" } },
];

export function levelInfo(level) {
  return LEVELS.find((l) => l.level === level) ?? LEVELS.at(-1);
}

/**
 * Turns a profile row ({ total_xp, acorn_balance, tier }) into what the UI shows:
 * { level, name, xp (within this tier), needed (XP span of this tier), totalXp, acorns, maxed }.
 * A missing profile reads as a brand-new user.
 */
export function progressFromProfile(profile) {
  const totalXp = Number(profile?.total_xp ?? 0);
  const current = [...LEVELS].reverse().find((l) => totalXp >= l.min) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.level === current.level + 1);
  const maxed = !next;
  const span = maxed ? 1 : next.min - current.min;
  return {
    level: current.level,
    name: current.name,
    xp: maxed ? span : totalXp - current.min,
    needed: span,
    totalXp,
    acorns: Number(profile?.acorn_balance ?? 0),
    maxed,
    unlocked: [], // looks come from the cosmetics state now
  };
}

// XP span of a level (kept for callers that only know the level number).
export function xpToNext(level) {
  const next = LEVELS.find((l) => l.level === level + 1);
  return next ? next.min - levelInfo(level).min : 1;
}

/**
 * Awards +10 acorns and +10 XP for exploring a Pip's Swap alternative.
 * Updates local cache and notifies the background service worker.
 */
export async function applySwapBonus(userId, swapId, details = {}) {
  // If chrome messaging is available, delegate to background service worker
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      const res = await chrome.runtime.sendMessage({
        type: "RECORD_SWAP_CLICK",
        userId,
        swapId,
        details,
      });
      if (res?.progress) return res.progress;
    }
  } catch (err) {
    console.warn("Could not dispatch RECORD_SWAP_CLICK to background:", err);
  }

  // Fallback to direct local storage update
  if (userId && typeof chrome !== "undefined" && chrome.storage?.local) {
    const key = `cosmetics:${userId}`;
    const stored = await chrome.storage.local.get(key);
    const state = stored[key];
    if (state?.profile) {
      const updated = {
        ...state,
        profile: {
          ...state.profile,
          acorn_balance: Number(state.profile.acorn_balance ?? 0) + 10,
          total_xp: Number(state.profile.total_xp ?? 0) + 10,
        },
      };
      await chrome.storage.local.set({ [key]: updated });
      return progressFromProfile(updated.profile);
    }
  }
  return null;
}
