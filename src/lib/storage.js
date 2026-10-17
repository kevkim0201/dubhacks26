// Settings live in chrome.storage.sync (small, syncs across the user's
// Chrome instances). Purchase data lives separately in storage.local --
// see purchases.js -- since it can grow past sync's per-item quota.
export const DEFAULT_SETTINGS = {
  userName: 'Alex',
  characterName: 'Pip',
  skinColor: '#f3bd93',
  leafColor: '#2f6b4f',
  flowerColor: '#f472b6',
  notifyDaysBefore: 3,      // "due soon" window, in days, used for alerts + badge
  defaultReturnWindowDays: 30,
  autoDetect: true,          // whether the content script watches for order confirmations
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(patch) {
  await chrome.storage.sync.set(patch);
  return getSettings();
}

// Fires `callback(patch)` whenever settings change in another view
// (popup <-> options <-> background). Returns an unsubscribe function.
export function onSettingsChanged(callback) {
  const listener = (changes, area) => {
    if (area !== 'sync') return;
    const patch = Object.fromEntries(
      Object.entries(changes).map(([key, { newValue }]) => [key, newValue]),
    );
    callback(patch);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
