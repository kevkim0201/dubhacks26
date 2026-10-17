// Squirrel + acorn prototype -- a standalone page, not yet wired into the
// extension. Per the plan: prove the Three.js scene works in a plain page
// first (fast to debug, no extension reload/CSP friction), then move it
// into the popup once a real model is sourced.
//
// No bundler yet either -- this is a plain ES module importing Three.js
// straight from a CDN, which only works because this is a normal web page
// (an extension's own pages can't load remote scripts under Manifest V3's
// CSP). Moving this into the extension (step 5 of the plan) means adding
// Vite + @crxjs/vite-plugin and an `npm install three` so the bundle is
// served from the extension itself instead.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// ======================== placeholder squirrel ========================
// Stand-in geometry, not a real model. Swap this whole function for a
// GLTFLoader call once a real animated .glb is sourced (Sketchfab / Poly
// Pizza / Meshy) -- see the commented-out loader path at the bottom of
// this file for where that plugs in.
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

  // Tail: a chain of shrinking spheres, curved up and over the back. Each
  // segment is named so the animation loop can wiggle them independently.
  const tailGroup = new THREE.Group();
  tailGroup.name = 'tail';
  tailGroup.position.set(0, 0.6, -0.5);
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const radius = 0.26 * (1 - t * 0.55);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), furMat);
    const curveAngle = t * 1.6; // curls the tail up and over
    seg.position.set(0, Math.sin(curveAngle) * 0.9 * t, -Math.cos(curveAngle) * 0.55 * t - t * 0.1);
    seg.userData.baseX = seg.position.x;
    seg.userData.segmentIndex = i;
    tailGroup.add(seg);
  }
  squirrel.add(tailGroup);

  squirrel.userData.tail = tailGroup;
  return squirrel;
}

// ======================== acorns (instanced) ========================
// One acorn = a body sphere + a cap sphere, both driven by the same
// per-instance transform (the cap's geometry is pre-translated above the
// body's local origin, so one matrix positions both halves together).
// InstancedMesh keeps "dozens of acorns" cheap, per the plan. Piled
// beside the squirrel (not directly in front, where it'd sit under the
// squirrel's own chin/legs and be hard to see from this camera angle).
const MAX_ACORNS = 200;
const PILE_CENTER = new THREE.Vector3(0.85, 0, 0.3);
const PILE_RADIUS = 0.32;

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

// ======================== scene setup ========================
const stage = document.getElementById('stage');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
// A 3/4 angle so the tail (the one feature that actually reads as
// "squirrel") is visible curling up behind the body, not hidden behind
// the head the way a straight-on front view hides it -- and pulled back
// enough that the acorn pile beside the squirrel stays in frame too.
camera.position.set(2.1, 2.0, 3.6);
camera.lookAt(0.3, 0.55, 0.1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(320, 320);
stage.appendChild(renderer.domElement);

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

// ======================== acorn state ========================
// Each entry tracks its settled target plus a current (possibly still
// falling) y -- updateAcornInstances() is what actually writes these into
// the InstancedMesh's per-instance matrices every frame.
const acorns = [];
const dummy = new THREE.Object3D();

function acornTargetPosition(index) {
  // Deterministic pseudo-random scatter within the pile so a given acorn
  // always lands in the same spot (no layout shift on re-render).
  const angle = (index * 2.4) % (Math.PI * 2);
  const radius = PILE_RADIUS * Math.sqrt((index * 0.61) % 1);
  const stackHeight = 0.1 + (index % 5) * 0.035;
  return new THREE.Vector3(
    PILE_CENTER.x + Math.cos(angle) * radius,
    stackHeight,
    PILE_CENTER.z + Math.sin(angle) * radius,
  );
}

function addAcorn() {
  if (acorns.length >= MAX_ACORNS) return;
  const index = acorns.length;
  const target = acornTargetPosition(index);
  acorns.push({
    target,
    y: target.y + 1.6, // starts above the pile and falls in
    rotY: Math.random() * Math.PI * 2,
    settled: false,
  });
  bodyMesh.count = acorns.length;
  capMesh.count = acorns.length;
  triggerHop();
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

// ======================== squirrel reaction ========================
let hopStart = null;
function triggerHop() {
  hopStart = performance.now();
}

function updateIdleAndReaction(elapsed) {
  const bob = Math.sin(elapsed * 1.6) * 0.03;
  squirrel.position.y = bob;

  const tail = squirrel.userData.tail;
  tail.children.forEach((seg) => {
    seg.position.x = seg.userData.baseX + Math.sin(elapsed * 2.2 + seg.userData.segmentIndex * 0.4) * 0.05;
  });

  if (hopStart != null) {
    const t = (performance.now() - hopStart) / 450; // ~450ms hop
    if (t >= 1) {
      hopStart = null;
      squirrel.scale.set(1, 1, 1);
    } else {
      const hop = Math.sin(t * Math.PI); // 0 -> 1 -> 0
      squirrel.position.y += hop * 0.22;
      squirrel.scale.set(1 - hop * 0.08, 1 + hop * 0.14, 1 - hop * 0.08);
    }
  }
}

// ======================== render loop ========================
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const elapsed = clock.getElapsedTime();
  updateIdleAndReaction(elapsed);
  updateAcornInstances(dt);
  renderer.render(scene, camera);
});

// ======================== demo controls ========================
// Maps straight to the plan's rule: "one acorn per $5 saved."
const DOLLARS_PER_ACORN = 5;
let savedTotal = 0;
const savedLabel = document.getElementById('saved-label');

function syncAcornsToSavings() {
  const targetCount = Math.floor(savedTotal / DOLLARS_PER_ACORN);
  while (acorns.length < targetCount) addAcorn();
}

document.getElementById('add-savings').addEventListener('click', () => {
  savedTotal += 5;
  savedLabel.textContent = savedTotal;
  syncAcornsToSavings();
});

document.getElementById('reset').addEventListener('click', () => {
  savedTotal = 0;
  savedLabel.textContent = '0';
  acorns.length = 0;
  bodyMesh.count = 0;
  capMesh.count = 0;
});

// ======================== swapping in a real model later ========================
// import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
//
// let mixer;
// new GLTFLoader().load('squirrel.glb', (gltf) => {
//   scene.remove(squirrel); // drop the placeholder
//   scene.add(gltf.scene);
//   mixer = new THREE.AnimationMixer(gltf.scene);
//   if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
// });
// // then in the render loop: mixer?.update(dt);
