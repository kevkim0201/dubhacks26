// Pip's growth: XP, levels, acorns and unlocked looks.
// Stored per user in chrome.storage.local for now; move to the backend later.

export const LEVELS = [
  { level: 1, name: "Tiny seedling" },
  { level: 2, name: "Curious sprout" },
  { level: 3, name: "Little explorer" },
  { level: 4, name: "Thoughtful shopper", unlock: { id: "scarf", label: "Forest scarf", description: "Pip unlocked a forest-green scarf." } },
  { level: 5, name: "Mindful forager" },
  { level: 6, name: "Forest guardian" },
];

const DEFAULT_PROGRESS = { level: 1, xp: 0, acorns: 0, unlocked: [] };

// XP needed to go from `level` to `level + 1`.
export function xpToNext(level) {
  return level * 100;
}

export function levelInfo(level) {
  return LEVELS.find((l) => l.level === level) ?? { level, name: "Forest legend" };
}

const storageKey = (userId) => `progress:${userId}`;

export async function loadProgress(userId) {
  const result = await chrome.storage.local.get(storageKey(userId));
  return { ...DEFAULT_PROGRESS, ...result[storageKey(userId)] };
}

async function saveProgress(userId, progress) {
  await chrome.storage.local.set({ [storageKey(userId)]: progress });
}

// Rewards for a finished conversation: 12 XP per minute (min 10), 1 acorn per 5 XP.
export function rewardsFor(durationSeconds) {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  const xp = Math.max(10, minutes * 12);
  return { minutes, xp, acorns: Math.max(1, Math.round(xp / 5)) };
}

// Applies a reward and returns { progress, reward, levelUps: [{ from, to, unlock }] }.
export async function applyConversation(userId, durationSeconds) {
  const progress = await loadProgress(userId);
  const reward = rewardsFor(durationSeconds);
  const levelUps = [];

  progress.acorns += reward.acorns;
  progress.xp += reward.xp;
  while (progress.xp >= xpToNext(progress.level)) {
    progress.xp -= xpToNext(progress.level);
    const from = progress.level;
    progress.level += 1;
    const unlock = levelInfo(progress.level).unlock ?? null;
    if (unlock && !progress.unlocked.includes(unlock.id)) progress.unlocked.push(unlock.id);
    levelUps.push({ from, to: progress.level, unlock });
  }

  await saveProgress(userId, progress);
  return { progress, reward, levelUps };
}
