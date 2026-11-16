// Short-lived visual effects: tracers, impact sparks, blood puffs, the planted charge and
// the explosion. Everything is geometry generated at boot, so there are no asset requests.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function sparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.28, 'rgba(255,236,180,0.95)');
  gradient.addColorStop(0.62, 'rgba(240,168,48,0.35)');
  gradient.addColorStop(1, 'rgba(240,168,48,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEffects(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const texture = sparkTexture();
  const tracers = [];
  const puffs = [];
  const explosions = [];
  const disposables = new Set();

  function sprite(color, scale = 0.14, opacity = 0.9) {
    const material = new THREE.SpriteMaterial({
      map: texture, color: new THREE.Color(color), transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const item = new THREE.Sprite(material);
    item.scale.setScalar(scale);
    group.add(item);
    return item;
  }

  function tracer(from, to, color = PALETTE.accent) {
    if (tracers.length > 70) {
      const old = tracers.shift();
      group.remove(old.line);
      old.line.geometry.dispose();
      old.line.material.dispose();
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    group.add(line);
    tracers.push({ line, life: 0.07, max: 0.07 });
  }

  function impact(point, normal, color = PALETTE.accent, strong = false) {
    const count = strong ? 7 : 4;
    for (let i = 0; i < count; i += 1) {
      const item = sprite(color, 0.06 + Math.random() * 0.1, 0.85);
      item.position.copy(point).addScaledVector(normal, 0.02 + Math.random() * 0.04);
      const velocity = normal.clone().multiplyScalar(0.8 + Math.random() * 2.2);
      velocity.x += (Math.random() - 0.5) * 1.6;
      velocity.y += (Math.random() - 0.2) * 1.8;
      velocity.z += (Math.random() - 0.5) * 1.6;
      puffs.push({ item, velocity, life: 0.22 + Math.random() * 0.18, max: 0.5, grow: 0.5 });
    }
    if (strong) {
      const light = new THREE.PointLight(new THREE.Color(color), 4, 4, 2);
      light.position.copy(point);
      group.add(light);
      explosions.push({ type: 'impact', light, life: 0.12, max: 0.12 });
    }
  }

  function blood(point, color, direction) {
    for (let i = 0; i < 6; i += 1) {
      const item = sprite(color, 0.07 + Math.random() * 0.08, 0.75);
      item.position.copy(point);
      const velocity = direction.clone().multiplyScalar(1.2 + Math.random() * 2.4);
      velocity.x += (Math.random() - 0.5) * 1.7;
      velocity.y += Math.random() * 1.4;
      velocity.z += (Math.random() - 0.5) * 1.7;
      puffs.push({ item, velocity, life: 0.25 + Math.random() * 0.25, max: 0.55, grow: 0.3, blood: true });
    }
  }

  function explosion(position) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    shell.position.copy(position);
    group.add(shell);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 24, 2);
    light.position.copy(position).y += 1.2;
    group.add(light);
    explosions.push({ type: 'shell', shell, light, life: 0.85, max: 0.85 });
    for (let i = 0; i < 36; i += 1) {
      const item = sprite(i % 3 === 0 ? PALETTE.ink : PALETTE.accent, 0.14 + Math.random() * 0.24, 0.95);
      item.position.copy(position);
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 9);
      puffs.push({ item, velocity, life: 0.55 + Math.random() * 0.7, max: 1.2, grow: 0.9 });
    }
    for (let i = 0; i < 16; i += 1) {
      const item = sprite(PALETTE.ink, 0.4 + Math.random() * 0.7, 0.45);
      item.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.4, (Math.random() - 0.5) * 3));
      puffs.push({ item, velocity: new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.7), life: 1.1 + Math.random(), max: 2.1, grow: 1.4, smoke: true });
    }
  }

  // --- Bomb prop ------------------------------------------------------------------------
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.26), new THREE.MeshStandardMaterial({ color: '#222830', roughness: 0.7, metalness: 0.35 }));
  const bombStrip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.055, 0.28), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.1 }));
  bombStrip.position.y = 0.055;
  const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 5, 2);
  bombLight.position.y = 0.35;
  const bombLamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }));
  bombLamp.position.set(0.12, 0.13, 0.11);
  bomb.add(bombBody, bombStrip, bombLight, bombLamp);
  bomb.visible = false;
  group.add(bomb);

  let bombPulse = 0;
  let bombActive = false;

  function setBomb(visible, position, planted = false, urgent = false) {
    bomb.visible = visible;
    bombActive = visible;
    if (position) bomb.position.set(position.x, planted ? 0.11 : 0.12, position.z);
    bombStrip.material.emissiveIntensity = planted ? 1.6 : 0.8;
    bombPulse = urgent ? 1 : 0;
  }

  function step(dt, time) {
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      const item = tracers[i];
      item.life -= dt;
      item.line.material.opacity = Math.max(0, item.life / item.max) * 0.7;
      if (item.life <= 0) {
        group.remove(item.line);
        item.line.geometry.dispose();
        item.line.material.dispose();
        tracers.splice(i, 1);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      const puff = puffs[i];
      puff.life -= dt;
      puff.velocity.y -= (puff.smoke ? -0.2 : 5.5) * dt;
      puff.item.position.addScaledVector(puff.velocity, dt);
      const ratio = Math.max(0, puff.life / puff.max);
      puff.item.material.opacity = ratio * (puff.smoke ? 0.42 : 0.9);
      puff.item.scale.multiplyScalar(1 + puff.grow * dt);
      if (puff.life <= 0) {
        group.remove(puff.item);
        puff.item.material.dispose();
        puffs.splice(i, 1);
      }
    }
    for (let i = explosions.length - 1; i >= 0; i -= 1) {
      const item = explosions[i];
      item.life -= dt;
      const ratio = Math.max(0, item.life / item.max);
      if (item.type === 'shell') {
        item.shell.scale.setScalar(1 + (1 - ratio) * 11);
        item.shell.material.opacity = ratio * 0.85;
        item.light.intensity = ratio * 60;
        if (item.life <= 0) {
          group.remove(item.shell, item.light);
          item.shell.geometry.dispose();
          item.shell.material.dispose();
          explosions.splice(i, 1);
        }
      } else {
        item.light.intensity = ratio * 4;
        if (item.life <= 0) {
          group.remove(item.light);
          explosions.splice(i, 1);
        }
      }
    }
    if (bombActive) {
      const pulse = (Math.sin(time * (bombPulse ? 18 : 5)) + 1) * 0.5;
      bombLight.intensity = (bombPulse ? 5 : 2) * pulse;
      bombLamp.material.color.set(pulse > 0.55 ? PALETTE.danger : PALETTE.hairline);
    }
  }

  return {
    group,
    tracer,
    impact,
    blood,
    explosion,
    step,
    setBomb,
    dispose() {
      for (const item of disposables) item.dispose();
      disposables.clear();
    },
  };
}
