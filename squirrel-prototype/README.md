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

Open `http://localhost:8080`. Click **+ $5 saved** a few times to watch
acorns drop into a pile beside the squirrel (1 acorn per $5, per the
plan) and the squirrel hop each time one lands.

## What's real vs. placeholder

- **The squirrel is placeholder geometry** (spheres + cones assembled in
  `buildSquirrel()`), not a sourced model. No real squirrel `.glb` has
  been found/downloaded yet -- that's still the next, hardest step
  (Sketchfab / Poly Pizza / Meshy, animated if possible).
- **The acorns, pile logic, falling-in animation, and hop reaction are
  real** -- not placeholder. `InstancedMesh` keeps the pile cheap
  regardless of count; the 1-acorn-per-$5 mapping and deterministic
  scatter (same acorn always lands in the same spot) are both final.
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
3. **Wire real data in.** Swap the "+ $5 saved" button for reading
   `totalSaved`/tier from `chrome.storage` (same shape Kevin/Deetya's
   backend already writes -- see `../src/lib/storage.js` and
   `../savings-storage/savings-storage.js`), and trigger the hop
   reaction off a real "deal confirmed" event instead of a button click.
4. **Decide how this relates to Pip.** This is a second character
   concept (squirrel + acorns) alongside the existing one (Pip, the
   procedurally-drawn SVG blob in `../src/lib/character.js`) -- worth
   deciding as a team whether this replaces Pip, becomes an alternate
   theme, or stays an experiment, before investing further in either.
