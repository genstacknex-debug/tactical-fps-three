// Tidebreak Foundry: a compact two-site, multi-room map built entirely from boxes and
// procedural canvas textures. It owns geometry, collision boxes, bullet surfaces, bomb
// sites, spawns, cover points and the navigation graph the bots path along.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 4.2;
const HALL_H = 3.9;
const WALL_T = 0.5;

function makeTexture(draw, repeatX, repeatY, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function noise(ctx, size, color, count, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = 1 + Math.random() * 4;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

function floorTexture() {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#191d22';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#242a31';
    ctx.lineWidth = 3;
    for (let i = 0; i <= size; i += size / 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#20252b';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i += 1) {
      const y = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (Math.random() * 8 - 4));
      ctx.stroke();
    }
    noise(ctx, size, '#2f363f', 180, 0.25);
    noise(ctx, size, '#0e1114', 120, 0.35);
  }, 10, 10);
}

function wallTexture() {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#252b33';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 64) {
      ctx.fillStyle = y % 128 === 0 ? '#282f38' : '#232930';
      ctx.fillRect(0, y + 2, size, 60);
      ctx.strokeStyle = '#343c46';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, y + 3, size - 4, 58);
    }
    ctx.strokeStyle = '#1a1f25';
    ctx.lineWidth = 2;
    for (let x = 0; x < size; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    ctx.fillStyle = '#11151a';
    for (let x = 12; x < size; x += 32) {
      for (let y = 12; y < size; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    noise(ctx, size, '#3a424d', 90, 0.16);
    noise(ctx, size, '#0c0f12', 90, 0.22);
  }, 2, 1);
}

function crateTexture() {
  return makeTexture((ctx, size) => {
    ctx.fillStyle = '#2e353e';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#363f49';
    for (let y = 8; y < size; y += 52) {
      ctx.fillRect(6, y, size - 12, 40);
      ctx.strokeStyle = '#1c2127';
      ctx.lineWidth = 3;
      ctx.strokeRect(6, y, size - 12, 40);
    }
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = PALETTE.accent;
    for (let x = -size; x < size; x += 64) ctx.fillRect(x, -size, 24, size * 2);
    ctx.restore();
    ctx.strokeStyle = '#12161b';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, size - 10, size - 10);
    noise(ctx, size, '#101419', 100, 0.3);
  }, 1, 1);
}

function siteTexture(letter, color) {
  return makeTexture((ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, size - 36, size - 36);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fillRect(18, 18, size - 36, size - 36);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = 'bold 120px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + 6);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 92, 0, Math.PI * 2);
    ctx.stroke();
  }, 1, 1);
}

function segmentClear(a, b, blockers, margin) {
  const minX = Math.min(a.x, b.x) - margin;
  const maxX = Math.max(a.x, b.x) + margin;
  const minZ = Math.min(a.z, b.z) - margin;
  const maxZ = Math.max(a.z, b.z) + margin;
  for (const blocker of blockers) {
    const bx0 = blocker.min.x - margin;
    const bx1 = blocker.max.x + margin;
    const bz0 = blocker.min.z - margin;
    const bz1 = blocker.max.z + margin;
    if (maxX < bx0 || minX > bx1 || maxZ < bz0 || minZ > bz1) continue;
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let hit = true;
    for (const [p, d, lo, hi] of [[a.x, dx, bx0, bx1], [a.z, dz, bz0, bz1]]) {
      if (Math.abs(d) < 1e-6) {
        if (p < lo || p > hi) { hit = false; break; }
        continue;
      }
      let ta = (lo - p) / d;
      let tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  const floorMap = floorTexture();
  const wallMap = wallTexture();
  const crateMap = crateTexture();
  materials.floor = new THREE.MeshStandardMaterial({ color: '#9aa1aa', map: floorMap, roughness: 0.96, metalness: 0.02 });
  materials.wall = new THREE.MeshStandardMaterial({ color: '#aeb5bd', map: wallMap, roughness: 0.88, metalness: 0.05 });
  materials.wallDark = new THREE.MeshStandardMaterial({ color: '#7b838c', map: wallMap, roughness: 0.92, metalness: 0.04 });
  materials.crate = new THREE.MeshStandardMaterial({ color: '#c2c8ce', map: crateMap, roughness: 0.82, metalness: 0.06 });
  materials.low = new THREE.MeshStandardMaterial({ color: '#7a828b', roughness: 0.9, metalness: 0.03 });
  materials.ink = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.2 });
  materials.hairline = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  materials.accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35, roughness: 0.45 });
  materials.ally = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), emissive: new THREE.Color(PALETTE.ally), emissiveIntensity: 0.28, roughness: 0.5 });
  materials.hostile = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hostile), emissive: new THREE.Color(PALETTE.hostile), emissiveIntensity: 0.24, roughness: 0.5 });

  const colliders = [];
  const losBlockers = [];
  const navBlockers = [];
  const shootables = [];
  const mapWalls = [];

  function addBox(w, h, d, x, y, z, material, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] ?? materials.wall);
    mesh.position.set(x, y, z);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (options.collide !== false) {
      const box = new THREE.Box3().setFromObject(mesh);
      colliders.push(box);
      losBlockers.push(box);
      if (options.nav !== false && h > 0.45) navBlockers.push(box);
    }
    if (options.shoot !== false) shootables.push(mesh);
    if (options.minimap) mapWalls.push({ x, z, w, d, kind: options.minimap, h });
    return mesh;
  }

  function addDecal(letter, color, x, z, size) {
    const texture = siteTexture(letter, color);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.025, z);
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  }

  function trim(w, d, x, z, y = 0.01, color = 'accent') {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[color]), transparent: true, opacity: 0.35, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  }

  // --- Floor and outer shell -------------------------------------------------------------
  addBox(43.2, 0.5, 43.2, 0, -0.25, 0, 'floor', { nav: false, minimap: 'floor' });
  addBox(43.2, WALL_H, WALL_T, 0, WALL_H / 2, -21.2, 'wall', { minimap: 'wall' });
  addBox(43.2, WALL_H, WALL_T, 0, WALL_H / 2, 21.2, 'wall', { minimap: 'wall' });
  addBox(WALL_T, WALL_H, 43.2, -21.2, WALL_H / 2, 0, 'wallDark', { minimap: 'wall' });
  addBox(WALL_T, WALL_H, 43.2, 21.2, WALL_H / 2, 0, 'wallDark', { minimap: 'wall' });

  // --- Spawn rooms -----------------------------------------------------------------------
  addBox(WALL_T, 4.0, 8.7, -8, 2, -16.25, 'wallDark', { minimap: 'wall' });
  addBox(WALL_T, 4.0, 8.7, 8, 2, -16.25, 'wallDark', { minimap: 'wall' });
  addBox(5, 4.0, WALL_T, -5.5, 2, -12, 'wall', { minimap: 'wall' });
  addBox(5, 4.0, WALL_T, 5.5, 2, -12, 'wall', { minimap: 'wall' });

  addBox(WALL_T, 4.0, 8.7, -8, 2, 16.25, 'wallDark', { minimap: 'wall' });
  addBox(WALL_T, 4.0, 8.7, 8, 2, 16.25, 'wallDark', { minimap: 'wall' });
  addBox(5, 4.0, WALL_T, -5.5, 2, 12, 'wall', { minimap: 'wall' });
  addBox(5, 4.0, WALL_T, 5.5, 2, 12, 'wall', { minimap: 'wall' });

  // --- North and south halls, with site and mid doorways ---------------------------------
  for (const side of [-1, 1]) {
    const z = side * 9.5;
    const wallZ = side * 7;
    for (const x of [-18.3, -14.0, -9.4, -4.6, 0, 4.6, 9.4, 14.0, 18.3]) {
      if (Math.abs(x) === 14 || x === 0) continue;
      trim(2.8, 0.16, x, z, 0.015, 'hairline');
    }
    // Wall segments along the site/mid boundary. The gaps are the three doorways:
    // -16..-12 (site B), -2..2 (mid) and 12..16 (site A).
    for (const seg of [-18.5, -9.5, -4.5, 4.5, 9.5, 18.5]) {
      addBox(5, HALL_H, WALL_T, seg, HALL_H / 2, wallZ, 'wall', { minimap: 'wall' });
    }
  }

  // --- Mid room side walls ---------------------------------------------------------------
  for (const side of [-1, 1]) {
    const x = side * 7;
    addBox(WALL_T, HALL_H, 5, x, HALL_H / 2, -4.5, 'wall', { minimap: 'wall' });
    addBox(WALL_T, HALL_H, 5, x, HALL_H / 2, 4.5, 'wall', { minimap: 'wall' });
  }

  // --- Cover architecture ----------------------------------------------------------------
  // Mid: two pillars make a central sightline with cover on both shoulders.
  addBox(1.7, 3.2, 1.7, -2.3, 1.6, 0, 'crate', { minimap: 'cover' });
  addBox(1.7, 3.2, 1.7, 2.3, 1.6, 0, 'crate', { minimap: 'cover' });

  // Site A and B stacks. The big stacks break the long sightline from each hall.
  for (const side of [-1, 1]) {
    const sx = side * 12.6;
    addBox(2.2, 2.5, 2.2, sx, 1.25, -4.0, 'crate', { minimap: 'cover' });
    addBox(1.8, 2.4, 1.8, sx + side * 3.6, 1.2, 4.7, 'crate', { minimap: 'cover' });
    addBox(1.1, 1.05, 2.1, sx + side * 6.2, 0.525, 1.6, 'low', { minimap: 'low' });
    addBox(2.4, 1.05, 1.1, sx + side * 1.3, 0.525, 1.0, 'low', { minimap: 'low' });
  }

  // Hall cover and spawn clutter.
  addBox(2.6, 1.1, 1.15, -8.8, 0.55, -10.8, 'low', { minimap: 'low' });
  addBox(2.6, 1.1, 1.15, 8.8, 0.55, 10.8, 'low', { minimap: 'low' });
  addBox(1.5, 1.25, 1.5, -6.9, 0.625, -15.1, 'crate', { minimap: 'cover' });
  addBox(1.5, 1.25, 1.5, 6.9, 0.625, 15.1, 'crate', { minimap: 'cover' });
  addBox(1.4, 1.1, 1.4, -17.8, 0.55, -9.8, 'low', { minimap: 'low' });
  addBox(1.4, 1.1, 1.4, 17.8, 0.55, 9.8, 'low', { minimap: 'low' });

  // Decorative wall pipes and ceiling trusses (visual only; bullets pass through).
  const pipeMat = materials.hairline;
  for (const z of [-19.0, 19.0]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 39, 8), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 3.55, z);
    pipe.raycast = () => {};
    group.add(pipe);
  }
  for (const x of [-16, -8, 0, 8, 16]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 42), materials.hairline);
    beam.position.set(x, 4.02, 0);
    beam.raycast = () => {};
    group.add(beam);
  }

  // --- Bomb site markings and lights -----------------------------------------------------
  const sites = [
    { id: 'A', name: 'Site A', center: new THREE.Vector3(14.2, 0, 1.1), radius: 4.4, color: PALETTE.accent },
    { id: 'B', name: 'Site B', center: new THREE.Vector3(-14.2, 0, 1.1), radius: 4.4, color: PALETTE.ally },
  ];
  for (const site of sites) {
    addDecal(site.id, site.color, site.center.x, site.center.z, 7.2);
    const light = new THREE.PointLight(new THREE.Color(site.color), 9, 12, 2);
    light.position.set(site.center.x, 2.7, site.center.z);
    group.add(light);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshStandardMaterial({
      color: new THREE.Color(site.color),
      emissive: new THREE.Color(site.color),
      emissiveIntensity: 2.2,
    }));
    lamp.position.set(site.center.x, 3.6, site.center.z);
    lamp.raycast = () => {};
    group.add(lamp);
  }

  // Spawn floor accents.
  trim(7.4, 0.18, 0, -12.5, 0.02, 'hostile');
  trim(7.4, 0.18, 0, 12.5, 0.02, 'ally');
  trim(0.18, 6.0, 0, -16.6, 0.02, 'hostile');
  trim(0.18, 6.0, 0, 16.6, 0.02, 'ally');

  // --- Spawns and buy zones --------------------------------------------------------------
  const spawns = {
    ct: [
      { x: 0, z: 17.0, yaw: 0 },
      { x: -3.0, z: 17.1, yaw: 0.08 },
      { x: 3.0, z: 17.1, yaw: -0.08 },
      { x: -5.1, z: 15.2, yaw: 0.12 },
      { x: 5.1, z: 15.2, yaw: -0.12 },
    ],
    t: [
      { x: 0, z: -17.0, yaw: Math.PI },
      { x: -2.8, z: -17.2, yaw: Math.PI - 0.08 },
      { x: 2.8, z: -17.2, yaw: Math.PI + 0.08 },
      { x: -5.0, z: -15.4, yaw: Math.PI - 0.12 },
      { x: 5.0, z: -15.4, yaw: Math.PI + 0.12 },
    ],
  };
  const buyZones = {
    ct: { x: 0, z: 16.6, radius: 6.4 },
    t: { x: 0, z: -16.6, radius: 6.4 },
  };

  // --- Navigation graph ------------------------------------------------------------------
  const nodes = [];
  function node(x, z, label = '') {
    nodes.push({ x, z, label, edges: [] });
    return nodes.length - 1;
  }

  const nodeAt = {};
  function grid(prefix, coords) {
    for (const [x, z] of coords) {
      const index = node(x, z, prefix);
      nodeAt[`${prefix}:${x}:${z}`] = index;
    }
  }

  grid('t', [[-5, -16], [0, -16], [5, -16], [0, -13.2]]);
  grid('ct', [[-5, 16], [0, 16], [5, 16], [0, 13.2]]);
  grid('hallN', [[-18, -9.5], [-14, -9.5], [-9.5, -9.5], [-5, -9.5], [0, -9.5], [5, -9.5], [9.5, -9.5], [14, -9.5], [18, -9.5]]);
  grid('hallS', [[-18, 9.5], [-14, 9.5], [-9.5, 9.5], [-5, 9.5], [0, 9.5], [5, 9.5], [9.5, 9.5], [14, 9.5], [18, 9.5]]);
  grid('mid', [[-4.5, -4.5], [0, -4.5], [4.5, -4.5], [-4.5, 0], [0, 0], [4.5, 0], [-4.5, 4.5], [0, 4.5], [4.5, 4.5]]);
  grid('siteA', [[10, -4.5], [14, -4.5], [18, -4.5], [10, 0], [14, 0], [18, 0], [10, 4.5], [14, 4.5], [18, 4.5]]);
  grid('siteB', [[-10, -4.5], [-14, -4.5], [-18, -4.5], [-10, 0], [-14, 0], [-18, 0], [-10, 4.5], [-14, 4.5], [-18, 4.5]]);
  // door thresholds
  grid('door', [[0, -12.2], [0, 12.2], [0, -7], [0, 7], [-14, -7], [14, -7], [-14, 7], [14, 7], [-7, 0], [7, 0]]);

  const MAX_LINK = 6.4;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance > MAX_LINK) continue;
      if (!segmentClear(a, b, navBlockers, 0.36)) continue;
      a.edges.push(j);
      b.edges.push(i);
    }
  }

  function nearestNode(position) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i].x - position.x;
      const dz = nodes[i].z - position.z;
      const d = dx * dx + dz * dz;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  function findPath(from, to) {
    const start = nearestNode(from);
    const goal = nearestNode(to);
    if (start < 0 || goal < 0) return [new THREE.Vector3(to.x, 0, to.z)];
    if (start === goal) return [new THREE.Vector3(to.x, 0, to.z)];
    const open = new Set([start]);
    const came = new Map();
    const gScore = new Map([[start, 0]]);
    const fScore = new Map([[start, Math.hypot(nodes[start].x - nodes[goal].x, nodes[start].z - nodes[goal].z)]]);
    const closed = new Set();
    while (open.size) {
      let current = -1;
      let best = Infinity;
      for (const id of open) {
        const score = fScore.get(id) ?? Infinity;
        if (score < best) { best = score; current = id; }
      }
      if (current === goal) {
        const path = [];
        let cursor = goal;
        while (cursor !== undefined) {
          const n = nodes[cursor];
          path.push(new THREE.Vector3(n.x, 0, n.z));
          cursor = came.get(cursor);
        }
        path.reverse();
        path.push(new THREE.Vector3(to.x, 0, to.z));
        return path;
      }
      open.delete(current);
      closed.add(current);
      for (const next of nodes[current].edges) {
        if (closed.has(next)) continue;
        const tentative = (gScore.get(current) ?? Infinity) + Math.hypot(nodes[current].x - nodes[next].x, nodes[current].z - nodes[next].z);
        if (tentative < (gScore.get(next) ?? Infinity)) {
          came.set(next, current);
          gScore.set(next, tentative);
          fScore.set(next, tentative + Math.hypot(nodes[next].x - nodes[goal].x, nodes[next].z - nodes[goal].z));
          open.add(next);
        }
      }
    }
    return [new THREE.Vector3(to.x, 0, to.z)];
  }

  // --- Cover points, filtered to open space ---------------------------------------------
  const coverCandidates = [];
  function cover(x, z) { coverCandidates.push(new THREE.Vector3(x, 0, z)); }
  for (const side of [-1, 1]) {
    const sx = side * 12.6;
    cover(sx + 1.8, -4.0); cover(sx - 1.8, -4.0);
    cover(sx, -2.2); cover(sx, -5.8);
    cover(sx + side * 3.6 + 1.5, 4.7); cover(sx + side * 3.6 - 1.5, 4.7);
    cover(sx + side * 3.6, 3.0); cover(sx + side * 3.6, 6.0);
    cover(side * 4.0, 0); cover(side * 2.3, -1.7); cover(side * 2.3, 1.7);
    cover(side * 15.8, -2.0); cover(side * 15.8, 3.8);
  }
  cover(0, -4.1); cover(0, 4.1);
  cover(-8.8, -9.3); cover(8.8, 9.3);
  cover(-5.0, -13.6); cover(5.0, 13.6);
  cover(-17.0, -8.2); cover(17.0, 8.2);

  const coverPoints = coverCandidates.filter((p) => isFree(p.x, p.z, 0.42));

  function isFree(x, z, radius = 0.36) {
    const probe = new THREE.Box3(
      new THREE.Vector3(x - radius, 0.18, z - radius),
      new THREE.Vector3(x + radius, 1.55, z + radius),
    );
    for (const box of colliders) if (probe.intersectsBox(box)) return false;
    return true;
  }

  function moveCircle(position, dx, dz, radius = 0.36) {
    let moved = false;
    if (dx !== 0 && isFree(position.x + dx, position.z, radius)) {
      position.x += dx;
      moved = true;
    }
    if (dz !== 0 && isFree(position.x, position.z + dz, radius)) {
      position.z += dz;
      moved = true;
    }
    return moved;
  }

  const losRay = new THREE.Ray();
  const losDir = new THREE.Vector3();
  const losHit = new THREE.Vector3();
  function los(from, to) {
    losDir.subVectors(to, from);
    const distance = losDir.length();
    if (distance < 0.05) return true;
    losDir.multiplyScalar(1 / distance);
    losRay.set(from, losDir);
    for (const box of losBlockers) {
      const hit = losRay.intersectBox(box, losHit);
      if (hit && hit.distanceTo(from) < distance - 0.08) return false;
    }
    return true;
  }

  // --- Lights ----------------------------------------------------------------------------
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.35);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.35);
  key.position.set(12, 16, 9);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.7);
  fill.position.set(-10, 10, 14);
  scene.add(fill);

  const spawnLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 5, 9, 2);
  spawnLight.position.set(0, 3.2, 0);
  group.add(spawnLight);

  const mapData = {
    bounds: { minX: -21.2, maxX: 21.2, minZ: -21.2, maxZ: 21.2 },
    walls: mapWalls.filter((w) => w.kind === 'wall' || w.kind === 'cover'),
    sites: sites.map((s) => ({ id: s.id, x: s.center.x, z: s.center.z, radius: s.radius, color: s.color })),
    spawns,
    buyZones,
  };

  return {
    group,
    colliders,
    shootables,
    sites,
    spawns,
    buyZones,
    nav: { nodes, findPath, nearestNode },
    coverPoints,
    mapData,
    isFree,
    moveCircle,
    los,
  };
}
