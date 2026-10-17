// Typed-ish wrapper around chrome.storage.sync for extension settings.
export const DEFAULT_SETTINGS = {
  enabled: true,
  highlightColor: '#6366f1',
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
  return getSettings();
}

// Subscribe to settings changes. Returns an unsubscribe function.
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
