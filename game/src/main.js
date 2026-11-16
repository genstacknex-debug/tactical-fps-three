// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|buy|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createViewModel } from './weapon.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotParam = params.get('shot');
const shot = ['start', 'buy', 'play', 'end'].includes(shotParam) ? shotParam : null;
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const viewmodel = createViewModel(camera);
const input = createInput(renderer.domElement, onLockChange);
const game = createGame({ scene, camera, world, input, hud, audio, viewmodel, rng: random });

let accumulator = 0;
let lastTime = performance.now();
let shotFrames = 0;
let frozen = false;

hud.onPlay(() => {
  audio.resume();
  if (shot) return;
  if (game.needsStart()) game.startMatch();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  game.setLocked(locked);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) return;

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (shot) {
    game.syncCamera(FIXED_STEP);
    renderer.render(scene, camera);
    shotFrames += 1;
    if (shotFrames >= 2) {
      frozen = true;
      window.__shotReady = true;
    }
    return;
  }

  const look = input.takeLook();
  game.look(look.x, look.y);

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    game.step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;

  game.syncCamera(dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = game;

game.syncCamera(FIXED_STEP);
if (shot) {
  game.setupShot(shot);
  game.syncCamera(FIXED_STEP);
  camera.updateProjectionMatrix();
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
