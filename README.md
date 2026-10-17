# DubHacks 26 — Chrome Extension

Manifest V3 Chrome extension. No build step: the files you edit are the files Chrome loads, so iterating is edit → reload.

## Load it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Pin the extension from the puzzle-piece menu

## Iterate

| You changed | What to do |
| --- | --- |
| Popup / options HTML, CSS, JS | Just reopen the popup |
| Content script or its CSS | Reload the **web page** |
| `service-worker.js` or `manifest.json` | Hit **Reload** on the card in `chrome://extensions` |

Debug: right-click the popup → Inspect. For the service worker, click the **service worker** link on the extension card. Content script logs show up in the page's own console.

## Layout

```
manifest.json              permissions, entry points, keyboard shortcut
src/
  background/
    service-worker.js      message router, command handler, settings fan-out
  content/
    content.js             injected into every page (not an ES module)
    content.css            namespaced under #dubhacks26-panel
  popup/
    popup.html/.css/.js    toolbar popup
  options/
    options.html/.js       settings page (reuses popup.css)
  lib/
    messages.js            message type constants + send helpers
    storage.js             chrome.storage.sync wrapper, defaults
icons/                     generated placeholders — see scripts/make-icons.mjs
scripts/
  check.mjs                verifies manifest references resolve
  make-icons.mjs           regenerates icons/*.png, no dependencies
```

## Scripts

```bash
npm run check    # validate manifest.json before loading or shipping
npm run icons    # regenerate the placeholder icons
npm run zip      # check + package dist/dubhacks26.zip for the Web Store
```

## What's wired up

- **Popup** reads the active tab, toggles the in-page panel, opens settings.
- **Options** persists to `chrome.storage.sync`; the service worker broadcasts changes to every open tab.
- **Alt+Shift+D** toggles the in-page panel (rebind at `chrome://extensions/shortcuts`).

## Things that will bite you

- **Content scripts aren't ES modules.** `src/content/content.js` can't `import`, which is why its constants are duplicated at the top. To share code, use `await import(chrome.runtime.getURL('src/lib/messages.js'))` and add the file to `web_accessible_resources`.
- **`manifest.json` has no comments.** JSON only — a stray `//` breaks the load silently.
- **`<all_urls>` is broad.** Narrow `content_scripts.matches` to the sites you actually need before submitting to the Web Store; broad host permissions trigger extra review.
- **Message listeners must `return true`** to reply asynchronously, or the sender gets `undefined`.
- **No content script on `chrome://` pages, the Web Store, or other extensions' pages.** `sendToTab` returns `null` there instead of throwing.

## Next steps

Rename the extension in `manifest.json` (`name`, `description`) and replace the icons once you know what you're building.
