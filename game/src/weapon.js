// Weapon data, ammunition bookkeeping and the first-person view model. The simulation reads
// the stats from here; the view model only reacts to events the game sends it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', slot: 2, price: 0, role: 'Sidearm',
    damage: 27, headshot: 2.15, armorPen: 0.55,
    mag: 20, reserve: 80, rpm: 430, reload: 1.45,
    spread: 0.0042, moveSpread: 0.034, airSpread: 0.075,
    recoil: 0.0095, recoilYaw: 0.0026, range: 60, auto: false, zoom: false,
  },
  smg: {
    id: 'smg', name: 'Viper SMG', slot: 1, price: 1250, role: 'SMG',
    damage: 23, headshot: 1.9, armorPen: 0.5,
    mag: 30, reserve: 120, rpm: 810, reload: 1.65,
    spread: 0.0085, moveSpread: 0.042, airSpread: 0.1,
    recoil: 0.0072, recoilYaw: 0.0038, range: 44, auto: true, zoom: false,
  },
  rifle: {
    id: 'rifle', name: 'Longbow AR', slot: 1, price: 2700, role: 'Rifle',
    damage: 34, headshot: 3.0, armorPen: 0.72,
    mag: 30, reserve: 90, rpm: 600, reload: 2.0,
    spread: 0.0026, moveSpread: 0.048, airSpread: 0.11,
    recoil: 0.0125, recoilYaw: 0.0029, range: 90, auto: true, zoom: false,
  },
  sniper: {
    id: 'sniper', name: 'Mantis .50', slot: 1, price: 4750, role: 'Sniper',
    damage: 118, headshot: 1.8, armorPen: 0.95,
    mag: 5, reserve: 20, rpm: 52, reload: 2.9,
    spread: 0.0007, moveSpread: 0.085, airSpread: 0.16,
    recoil: 0.055, recoilYaw: 0.006, range: 130, auto: false, zoom: true,
  },
};

export const SHOP = [
  { id: 'pistol', price: 0, note: 'Standard sidearm' },
  { id: 'smg', price: WEAPONS.smg.price, note: 'Fast, forgiving' },
  { id: 'rifle', price: WEAPONS.rifle.price, note: 'Reliable all-rounder' },
  { id: 'sniper', price: WEAPONS.sniper.price, note: 'One shot, scoped' },
];

export const ARMOR_PRICE = 650;
export const KIT_PRICE = 400;

export function newAmmo(id) {
  const weapon = WEAPONS[id];
  return { mag: weapon.mag, reserve: weapon.reserve, cooldown: 0, reloadLeft: 0, shots: 0 };
}

export function createArsenal() {
  return {
    primary: null,
    slot: 'pistol',
    ammo: { pistol: newAmmo('pistol') },
  };
}

export function currentId(arsenal) {
  return arsenal.slot === 'primary' && arsenal.primary ? arsenal.primary : 'pistol';
}

export function currentWeapon(arsenal) {
  return WEAPONS[currentId(arsenal)];
}

export function currentAmmo(arsenal) {
  const id = currentId(arsenal);
  return arsenal.ammo[id];
}

export function givePrimary(arsenal, id) {
  arsenal.primary = id;
  arsenal.slot = 'primary';
  arsenal.ammo[id] = newAmmo(id);
}

export function refillAmmo(arsenal) {
  for (const [id, state] of Object.entries(arsenal.ammo)) {
    const weapon = WEAPONS[id];
    state.mag = weapon.mag;
    state.reserve = weapon.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.shots = 0;
  }
}

export function stripPrimary(arsenal) {
  if (arsenal.primary) {
    delete arsenal.ammo[arsenal.primary];
    arsenal.primary = null;
  }
  arsenal.slot = 'pistol';
}

export function updateAmmo(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const id = state.weaponId;
      const weapon = WEAPONS[id];
      const need = weapon.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function beginReload(arsenal) {
  const id = currentId(arsenal);
  const state = arsenal.ammo[id];
  const weapon = WEAPONS[id];
  if (!state || state.reloadLeft > 0 || state.mag >= weapon.mag || state.reserve <= 0) return false;
  state.reloadLeft = weapon.reload;
  state.weaponId = id;
  return true;
}

export function shotSpread(weapon, options) {
  let spread = weapon.spread;
  spread += weapon.moveSpread * Math.min(1.6, options.speed / 5.7);
  if (!options.grounded) spread += weapon.airSpread;
  if (options.crouching) spread *= 0.72;
  if (options.aiming && weapon.zoom) spread *= 0.42;
  if (options.shots > 0) spread *= 1 + Math.min(0.55, options.shots * 0.055);
  return spread;
}

export function damageFor(weapon, part, distance) {
  let damage = weapon.damage;
  if (part === 'head') damage *= weapon.headshot;
  if (part === 'legs') damage *= 0.76;
  const falloff = Math.max(0.62, 1 - Math.max(0, distance - 16) / weapon.range * 0.5);
  return damage * falloff;
}

function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,235,1)');
  gradient.addColorStop(0.25, 'rgba(240,168,48,0.95)');
  gradient.addColorStop(0.62, 'rgba(240,120,30,0.35)');
  gradient.addColorStop(1, 'rgba(240,80,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createViewModel(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.38, metalness: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: '#22262c', roughness: 0.72, metalness: 0.25 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.48, metalness: 0.42 });
  const glove = new THREE.MeshStandardMaterial({ color: '#31383f', roughness: 0.94, metalness: 0.02 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), emissive: new THREE.Color(PALETTE.ally), emissiveIntensity: 0.5, roughness: 0.45 });

  const group = new THREE.Group();
  group.position.set(0.26, -0.22, -0.46);
  camera.add(group);

  const flashMaterial = new THREE.MeshBasicMaterial({
    map: flashTexture(), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMaterial);
  flash.visible = false;
  group.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 4, 2);
  group.add(flashLight);

  const model = new THREE.Group();
  group.add(model);

  let weaponId = 'pistol';
  let base = { x: 0.26, y: -0.22, z: -0.46 };
  const state = { kick: 0, flash: 0, reload: 0, bob: 0, hide: false };

  function box(w, h, d, x, y, z, material, rotationX = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotationX;
    model.add(mesh);
    return mesh;
  }

  function build(id) {
    while (model.children.length) model.remove(model.children[0]);
    const weapon = WEAPONS[id];
    flash.position.set(0, 0.02, -0.62);
    flashLight.position.set(0, 0.02, -0.58);
    if (id === 'pistol') {
      base = { x: 0.245, y: -0.205, z: -0.42 };
      box(0.07, 0.085, 0.28, 0, 0.01, 0, body);
      box(0.055, 0.055, 0.17, 0, 0.045, -0.2, metal);
      box(0.06, 0.16, 0.085, 0, -0.1, 0.06, dark, -0.18);
      box(0.075, 0.075, 0.11, 0.005, -0.13, 0.085, glove);
      box(0.026, 0.024, 0.03, 0, 0.095, -0.13, accent);
      flash.position.set(0, 0.05, -0.3);
      flashLight.position.set(0, 0.05, -0.3);
    } else if (id === 'smg') {
      base = { x: 0.25, y: -0.235, z: -0.5 };
      box(0.09, 0.1, 0.42, 0, 0.005, -0.04, body);
      box(0.045, 0.045, 0.24, 0, 0.035, -0.34, metal);
      box(0.065, 0.14, 0.075, 0, -0.1, -0.02, dark);
      box(0.055, 0.17, 0.09, 0, -0.11, 0.12, dark, -0.12);
      box(0.065, 0.09, 0.12, 0.005, -0.11, 0.17, glove);
      box(0.035, 0.06, 0.16, 0, 0.05, 0.13, dark);
      box(0.03, 0.03, 0.045, 0, 0.075, -0.2, accent);
      flash.position.set(0, 0.035, -0.49);
      flashLight.position.set(0, 0.035, -0.45);
    } else if (id === 'rifle') {
      base = { x: 0.255, y: -0.245, z: -0.55 };
      box(0.095, 0.105, 0.52, 0, 0.005, -0.05, body);
      box(0.05, 0.05, 0.34, 0, 0.035, -0.44, metal);
      box(0.07, 0.19, 0.085, 0, -0.13, -0.04, dark, -0.16);
      box(0.06, 0.16, 0.1, 0, -0.1, 0.17, dark, -0.2);
      box(0.065, 0.08, 0.09, 0.005, -0.11, 0.21, glove);
      box(0.07, 0.075, 0.18, 0, 0.055, 0.24, dark);
      box(0.035, 0.035, 0.1, 0, 0.09, -0.2, accent);
      flash.position.set(0, 0.035, -0.62);
      flashLight.position.set(0, 0.035, -0.58);
    } else {
      base = { x: 0.26, y: -0.25, z: -0.58 };
      box(0.1, 0.11, 0.6, 0, 0.005, -0.04, body);
      box(0.045, 0.045, 0.52, 0, 0.035, -0.58, metal);
      box(0.085, 0.09, 0.2, 0, 0.105, -0.06, dark);
      box(0.055, 0.055, 0.22, 0, 0.15, -0.06, dark);
      box(0.07, 0.2, 0.09, 0, -0.14, -0.03, dark, -0.15);
      box(0.065, 0.09, 0.11, 0.005, -0.11, 0.2, glove);
      box(0.07, 0.085, 0.22, 0, 0.055, 0.28, dark);
      box(0.03, 0.03, 0.04, 0, 0.185, -0.15, accent);
      flash.position.set(0, 0.035, -0.86);
      flashLight.position.set(0, 0.035, -0.82);
    }
    model.position.set(base.x, base.y, base.z);
    void weapon;
  }

  build('pistol');

  return {
    state,
    setWeapon(id) {
      if (id === weaponId) return;
      weaponId = id;
      state.kick = 0;
      state.reload = 0;
      build(id);
    },
    trigger() {
      state.kick = 0.05;
      state.flash = 0.055;
      flash.rotation.z = Math.random() * Math.PI;
    },
    step(dt, options) {
      state.kick += (0 - state.kick) * Math.min(1, dt * 12);
      state.flash = Math.max(0, state.flash - dt);
      const reloading = options.reloading;
      state.reload += ((reloading ? 1 : 0) - state.reload) * Math.min(1, dt * 8);
      const speed = options.speed ?? 0;
      state.bob += dt * (5.5 + speed * 1.2);
      const bobAmount = Math.min(1, speed / 5.7) * 0.012;
      const bobX = Math.sin(state.bob * 0.5) * bobAmount * 0.6;
      const bobY = Math.abs(Math.cos(state.bob * 0.5)) * bobAmount;
      model.position.set(
        base.x + bobX,
        base.y + bobY - state.reload * 0.16,
        base.z + state.kick * 0.9 + state.reload * 0.06,
      );
      model.rotation.x = state.kick * 2.1 - state.reload * 0.65;
      model.rotation.z = state.reload * 0.16;
      model.rotation.y = state.reload * 0.24;
      flash.visible = state.flash > 0;
      flash.material.opacity = state.flash > 0 ? 0.95 : 0;
      flash.scale.setScalar(0.8 + Math.random() * 0.5);
      flashLight.intensity = state.flash > 0 ? 10 : 0;
      model.visible = !state.hide;
      flash.visible = flash.visible && !state.hide;
    },
    setHidden(hidden) {
      state.hide = hidden;
    },
  };
}
