# Squirrel prototype

Standalone page proving the Three.js scene works before touching the
extension at all -- per the plan: get the hard part (a real model) and the
rendering pipeline right in a plain page first, since debugging Three.js
inside an extension (CSP, reload cycles) is slow.

## Run it

```bash
cd squirrel-prototype
python3 -m http.server 8080
```

Open `http://localhost:8080`. Acorns drop **automatically** -- "Auto
every 5s" is on by default and simulates a purchase on its own timer, no
clicking required. Click **Simulate a purchase** to fire one on demand
(useful for a live demo instead of waiting on the timer). Acorn tokens
persist across reloads (see below), so refreshing the page shows the
same pile instead of resetting it; **Reset** clears it back to zero.

## What's real vs. placeholder

- **The squirrel is placeholder geometry** (spheres + cones assembled in
  `buildSquirrel()`), not a sourced model. No real squirrel `.glb` has
  been found/downloaded yet -- that's still the next, hardest step
  (Sketchfab / Poly Pizza / Meshy, animated if possible).
- **The acorns, pile logic, falling-in animation, hop reaction, XP math,
  and persistent token count are all real** -- not placeholder.
  `InstancedMesh` keeps the pile cheap regardless of count; 1 acorn per
  $5 saved (50 XP, matching `src/lib/character.js`'s $1 = 10 XP) and the
  deterministic scatter (same acorn always lands in the same spot) are
  both final.
- **The purchase trigger is simulated, not real.** `simulatePurchase()`
  invents a store name + a random savings amount and calls
  `handlePurchaseEvent({ store, savings })` -- the same function a real
  purchase would call. Swapping the trigger for real data later (see
  "Next steps") doesn't touch any of the acorn/token logic, only what
  calls into it.
- **Acorn tokens persist via `localStorage`**, standing in for
  `chrome.storage.local` until this moves into the extension (a
  standalone page has no `chrome.storage` to use). Known limitation:
  if two tabs on this same page are open at once, each runs its own
  timer and independently reads-then-writes the same `localStorage`
  key, so the last one to save can clobber the other's progress -- not
  a concern for the real extension, where only one popup instance ever
  runs at a time, so it wasn't worth engineering around here.
- **The render loop, lighting, and camera framing are real** and should
  carry over mostly as-is once the placeholder is swapped for a loaded
  model.

## Swapping in a real model

`squirrel.js` has the `GLTFLoader` path commented out at the bottom,
ready to uncomment once a `.glb` exists:

```js
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
new GLTFLoader().load('squirrel.glb', (gltf) => {
  scene.remove(squirrel);
  scene.add(gltf.scene);
  // ...AnimationMixer if the model has animations
});
```

Drop the `.glb` file in this folder and point the loader at it.

## Next steps (not done here)

1. **Source a real model** and swap it in per above.
2. **Move into the extension.** This page imports Three.js from a CDN,
   which only works because it's a normal web page -- Manifest V3's CSP
   blocks remotely-hosted scripts in the extension's own pages. Moving
   this into the popup means adding a bundler (Vite + `@crxjs/vite-plugin`
   is the plan's suggestion) and `npm install three` so Three.js ships
   inside the extension bundle instead of being fetched from a CDN.
3. **Wire real purchase events in.** Replace `simulatePurchase()`'s
   random generator with a `chrome.storage.onChanged` listener on the
   `purchases` key (`../src/lib/purchases.js`) that calls
   `handlePurchaseEvent({ store, savings })` for each newly-confirmed
   purchase, and swap `localStorage` for `chrome.storage.local` so the
   token count is the real persisted one shared with the rest of the
   extension instead of this page's own copy.
4. **Decide how this relates to Pip.** This is a second character
   concept (squirrel + acorns) alongside the existing one (Pip, the
   procedurally-drawn SVG blob in `../src/lib/character.js`) -- worth
   deciding as a team whether this replaces Pip, becomes an alternate
   theme, or stays an experiment, before investing further in either.
