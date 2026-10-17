// The squirrel + acorn character, as a Three.js scene -- an alternative
// to Pip (src/lib/character.js's procedural SVG) for showing savings
// progress. Currently only mounted in the popup's main view; the
// dashboard and every other small character icon (pending cards, the
// coupons-view footer, the chapters gallery) still use Pip -- ask before
// changing those too, since that's a product decision (two mascots in
// one app) rather than a code one.
//
// Adapted from squirrel-prototype/ (see that folder's README for the
// placeholder-vs-real breakdown and how this was built/tested). The
// differences from the prototype:
//   - Three.js is vendored locally (src/lib/vendor/three.module.min.js)
//     instead of imported from a CDN -- Manifest V3's extension CSP
//     blocks remotely-hosted scripts, so it has to ship in the bundle.
//   - No localStorage / simulated purchases. syncToXP(xp) is driven by
//     the same `character.xp` the rest of the popup already reads from
//     chrome.storage (src/lib/purchases.js + character.js) -- this
//     module has no persistence or XP math of its own, just rendering.
import * as THREE from './vendor/three.module.min.js';

// 1 acorn per $5 saved, expressed in XP so the rule lines up with the
// rest of the app ($1 saved = 10 XP -- see character.js's XP_PER_DOLLAR).
const XP_PER_ACORN = 50;
const MAX_ACORNS = 200;
const PILE_CENTER = new THREE.Vector3(0.85, 0, 0.3);
const PILE_RADIUS = 0.32;

function buildSquirrel() {
  const squirrel = new THREE.Group();

  const furMat = new THREE.MeshStandardMaterial({ color: 0xc97b3b, roughness: 0.8 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xf2e1c8, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b1f16, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), furMat);
  body.scale.set(1, 0.95, 1.2);
  body.position.y = 0.55;
  squirrel.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), bellyMat);
  belly.scale.set(0.8, 0.9, 0.6);
  belly.position.set(0, 0.45, 0.35);
  squirrel.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), furMat);
  head.position.set(0, 1.05, 0.55);
  squirrel.add(head);

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), bellyMat);
  snout.position.set(0, 0.98, 0.82);
  squirrel.add(snout);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), darkMat);
  nose.position.set(0, 1.0, 0.95);
  squirrel.add(nose);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), darkMat);
    eye.position.set(side * 0.14, 1.1, 0.8);
    squirrel.add(eye);

    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 10), furMat);
    ear.position.set(side * 0.2, 1.32, 0.45);
    squirrel.add(ear);

    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), furMat);
    leg.position.set(side * 0.3, 0.12, 0.25);
    squirrel.add(leg);
  }

  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 0.6, -0.5);
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const radius = 0.26 * (1 - t * 0.55);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), furMat);
    const curveAngle = t * 1.6;
    seg.position.set(0, Math.sin(curveAngle) * 0.9 * t, -Math.cos(curveAngle) * 0.55 * t - t * 0.1);
    seg.userData.baseX = seg.position.x;
    seg.userData.segmentIndex = i;
    tailGroup.add(seg);
  }
  squirrel.add(tailGroup);

  squirrel.userData.tail = tailGroup;
  return squirrel;
}

function buildAcornMeshes() {
  const bodyGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const capGeo = new THREE.SphereGeometry(0.105, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  capGeo.translate(0, 0.07, 0);

  const bodyMesh = new THREE.InstancedMesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 }),
    MAX_ACORNS,
  );
  const capMesh = new THREE.InstancedMesh(
    capGeo,
    new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 }),
    MAX_ACORNS,
  );
  bodyMesh.count = 0;
  capMesh.count = 0;
  return { bodyMesh, capMesh };
}

function acornTargetPosition(index) {
  const angle = (index * 2.4) % (Math.PI * 2);
  const radius = PILE_RADIUS * Math.sqrt((index * 0.61) % 1);
  const stackHeight = 0.1 + (index % 5) * 0.035;
  return new THREE.Vector3(
    PILE_CENTER.x + Math.cos(angle) * radius,
    stackHeight,
    PILE_CENTER.z + Math.sin(angle) * radius,
  );
}

/**
 * Mounts the squirrel scene into `container` (its own <canvas>, sized to
 * `size`x`size`) and starts its render loop immediately.
 * @param {HTMLElement} container
 * @param {{ size?: number }} [opts]
 * @returns {{ syncToXP: (xp: number) => void, destroy: () => void }}
 */
export function mountSquirrelScene(container, { size = 150 } = {}) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(2.1, 2.0, 3.6);
  camera.lookAt(0.3, 0.55, 0.1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(size, size);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d6e63, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(2, 3, 2);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 32),
    new THREE.MeshStandardMaterial({ color: 0xcfe0cf, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const squirrel = buildSquirrel();
  scene.add(squirrel);

  const { bodyMesh, capMesh } = buildAcornMeshes();
  scene.add(bodyMesh, capMesh);

  const acorns = [];
  const dummy = new THREE.Object3D();
  let hopStart = null;
  let hasSynced = false;

  function addAcorn(instant) {
    if (acorns.length >= MAX_ACORNS) return;
    const index = acorns.length;
    const target = acornTargetPosition(index);
    acorns.push({
      target,
      y: instant ? target.y : target.y + 1.6,
      rotY: Math.random() * Math.PI * 2,
      settled: instant,
    });
    bodyMesh.count = acorns.length;
    capMesh.count = acorns.length;
    if (!instant) hopStart = performance.now();
  }

  function updateAcornInstances(dt) {
    acorns.forEach((acorn, i) => {
      if (!acorn.settled) {
        acorn.y += (acorn.target.y - acorn.y) * Math.min(1, dt * 6);
        if (Math.abs(acorn.y - acorn.target.y) < 0.002) {
          acorn.y = acorn.target.y;
          acorn.settled = true;
        }
      }
      dummy.position.set(acorn.target.x, acorn.y, acorn.target.z);
      dummy.rotation.set(0, acorn.rotY, 0);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      capMesh.setMatrixAt(i, dummy.matrix);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;
  }

  function updateIdleAndReaction(elapsed) {
    squirrel.position.y = Math.sin(elapsed * 1.6) * 0.03;

    squirrel.userData.tail.children.forEach((seg) => {
      seg.position.x = seg.userData.baseX + Math.sin(elapsed * 2.2 + seg.userData.segmentIndex * 0.4) * 0.05;
    });

    if (hopStart != null) {
      const t = (performance.now() - hopStart) / 450;
      if (t >= 1) {
        hopStart = null;
        squirrel.scale.set(1, 1, 1);
      } else {
        const hop = Math.sin(t * Math.PI);
        squirrel.position.y += hop * 0.22;
        squirrel.scale.set(1 - hop * 0.08, 1 + hop * 0.14, 1 - hop * 0.08);
      }
    }
  }

  const clock = new THREE.Clock();
  let running = true;
  renderer.setAnimationLoop(() => {
    if (!running) return;
    const dt = clock.getDelta();
    updateIdleAndReaction(clock.getElapsedTime());
    updateAcornInstances(dt);
    renderer.render(scene, camera);
  });

  /**
   * Call whenever the popup's `character.xp` changes. Adds (or, if XP
   * ever decreases -- e.g. a purchase gets deleted -- instantly trims)
   * acorns to match floor(xp / XP_PER_ACORN); only *new* acorns from an
   * increase get the fall-in + hop, matching a real "you just saved
   * money" moment rather than replaying it on every popup open.
   */
  function syncToXP(xp) {
    const instant = !hasSynced; // first call after mount: show the existing pile with no animation
    hasSynced = true;
    const targetCount = Math.min(MAX_ACORNS, Math.floor(xp / XP_PER_ACORN));

    if (targetCount < acorns.length) {
      acorns.length = targetCount;
      bodyMesh.count = targetCount;
      capMesh.count = targetCount;
      return;
    }
    while (acorns.length < targetCount) addAcorn(instant);
  }

  function destroy() {
    running = false;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    container.removeChild(renderer.domElement);
  }

  return { syncToXP, destroy };
}
