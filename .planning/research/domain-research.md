# Domain & Technical Research: Squirrel Savings

## 1. Chrome Extension Manifest V3 & Audio / Mic Permissions
- **Microphone Permissions:** Manifest V3 background service workers cannot access `navigator.mediaDevices.getUserMedia`. 
- **Solution:** 
  - The content script running on the page can request microphone permissions directly in the page context.
  - An offscreen document can be used if background audio capture is needed, but since our overlay is rendered directly in the active checkout tab inside a Shadow DOM, the content script / injected iframe has direct audio API access.
  - Must declare `"permissions": ["storage"]` and appropriate host permissions.

## 2. Voice Pipeline: ElevenLabs + Gemini
- **Pipeline Strategy:**
  - Fast audio response is critical. Using Gemini Flash (sub-second TTFT) paired with ElevenLabs streaming WebSocket or TTS REST API endpoint.
  - Squirrel voice persona: higher pitch, energetic, playful tone (voice settings: stability ~0.4, clarity ~0.75).
  - Backend proxy: Browser sends user audio/text -> FastAPI forwards to Gemini and ElevenLabs -> returns audio stream or URL. Keeps all API keys safe from the client.

## 3. Three.js Bundling in Vite MV3
- MV3 Content Security Policy strictly blocks `eval()` and loading scripts from external CDNs (e.g., `unpkg.com` or `cdnjs`).
- Three.js must be installed via `npm install three` inside `extension/` and imported as an ES module so Vite bundles it into the build output (`dist/`).
- Use `InstancedMesh` for rendering the acorn stash: extremely lightweight, supports rendering hundreds of acorns in a single draw call with 60 FPS in the popup window.

## 4. Shadow DOM Isolation
- Store CSS frequently contains aggressive global resets (`* { box-sizing: border-box; font-family: ...; }`) that can break external widgets.
- Content script attaches a `#squirrel-root` `<div>` to `document.body` and calls `attachShadow({ mode: 'open' })`.
- All overlay styles and elements live inside the shadow root, completely immune to host page CSS.
