// Content scripts are not ES modules, so they can't `import` from src/lib.
// Either keep the handful of constants duplicated here (simplest), or load a
// module at runtime with `await import(chrome.runtime.getURL('...'))`.
(() => {
  const MSG = {
    TOGGLE_PANEL: 'toggle-panel',
    SETTINGS_CHANGED: 'settings-changed',
  };

  const PANEL_ID = 'dubhacks26-panel';
  let settings = { enabled: true, highlightColor: '#6366f1' };

  chrome.storage.sync.get(settings).then((stored) => {
    settings = { ...settings, ...stored };
    applySettings();
  });

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message.type) {
      case MSG.TOGGLE_PANEL:
        togglePanel();
        respond({ ok: true });
        break;
      case MSG.SETTINGS_CHANGED:
        settings = { ...settings, ...message.payload };
        applySettings();
        respond({ ok: true });
        break;
      default:
        respond({ ok: false, error: `unknown message type: ${message.type}` });
    }
    return true;
  });

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="dh-panel__bar">
        <span class="dh-panel__title">DubHacks 26</span>
        <button class="dh-panel__close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="dh-panel__body">
        <p class="dh-panel__url"></p>
      </div>
    `;
    panel.querySelector('.dh-panel__url').textContent = document.title;
    panel.querySelector('.dh-panel__close').addEventListener('click', () => panel.remove());
    document.documentElement.appendChild(panel);
    applySettings();
  }

  function applySettings() {
    document.documentElement.style.setProperty('--dh-accent', settings.highlightColor);
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = !settings.enabled;
  }
})();
