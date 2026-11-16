// Bot soldiers: navigation, vision, cover choice, engagements and objective play. The game
// owns the actors and shooting; a bot only decides where to look, where to stand and when to
// pull the trigger.
import * as THREE from 'three';
import { PALETTE, TEAM_COLOR } from './palette.js';
import { currentAmmo, currentWeapon } from './weapon.js';

const BOT_RADIUS = 0.36;
const BOT_EYE = 1.56;

function eyeOf(actor, target = new THREE.Vector3()) {
  return target.set(actor.position.x, actor.position.y + (actor.eyeHeight ?? BOT_EYE), actor.position.z);
}

function aimPointOf(actor, target = new THREE.Vector3()) {
  const crouch = actor.crouching ? 0.35 : 0;
  return target.set(actor.position.x, actor.position.y + 1.34 - crouch, actor.position.z);
}

function angleDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function approach(current, target, maxStep) {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function createAvatar(actor, scene) {
  const color = TEAM_COLOR[actor.team];
  const teamMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.12,
    roughness: 0.72, metalness: 0.12,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#252b32', roughness: 0.9, metalness: 0.08 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: '#b7a48d', roughness: 0.85 });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: '#1c2025', roughness: 0.5, metalness: 0.55 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.6 });

  const group = new THREE.Group();
  group.position.set(actor.position.x, 0, actor.position.z);
  group.rotation.y = actor.yaw;
  scene.add(group);

  const hitMeshes = [];
  function part(geometry, material, x, y, z, partName) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.actor = actor;
    mesh.userData.part = partName;
    group.add(mesh);
    if (partName) hitMeshes.push(mesh);
    return mesh;
  }

  part(new THREE.BoxGeometry(0.17, 0.78, 0.2), darkMaterial, -0.14, 0.42, 0, 'legs');
  part(new THREE.BoxGeometry(0.17, 0.78, 0.2), darkMaterial, 0.14, 0.42, 0, 'legs');
  part(new THREE.BoxGeometry(0.54, 0.18, 0.3), darkMaterial, 0, 0.92, 0, 'torso');
  part(new THREE.BoxGeometry(0.56, 0.58, 0.32), teamMaterial, 0, 1.22, 0, 'torso');
  part(new THREE.BoxGeometry(0.14, 0.55, 0.16), teamMaterial, -0.36, 1.24, -0.02, 'torso');
  part(new THREE.BoxGeometry(0.14, 0.55, 0.16), teamMaterial, 0.36, 1.24, -0.02, 'torso');
  part(new THREE.SphereGeometry(0.165, 14, 10), skinMaterial, 0, 1.62, 0, 'head');
  const helmet = part(new THREE.SphereGeometry(0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), darkMaterial, 0, 1.65, 0, null);
  helmet.scale.y = 0.8;

  const gun = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.46), gunMaterial);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.28), gunMaterial);
  barrel.position.z = -0.34;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.09), gunMaterial);
  mag.position.set(0, -0.12, 0.02);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.07), accentMaterial);
  sight.position.set(0, 0.075, -0.04);
  gun.add(receiver, barrel, mag, sight);
  gun.position.set(0.24, 1.24, -0.3);
  gun.rotation.x = -0.03;
  group.add(gun);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.18), darkMaterial);
  backpack.position.set(0, 1.24, 0.23);
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.2), accentMaterial);
  packStripe.position.set(0, 1.31, 0.23);
  group.add(backpack, packStripe);
  backpack.visible = false;
  packStripe.visible = false;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.43, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  ring.raycast = () => {};
  group.add(ring);

  const muzzleMaterial = new THREE.SpriteMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const muzzle = new THREE.Sprite(muzzleMaterial);
  muzzle.position.set(0.24, 1.24, -0.62);
  muzzle.scale.setScalar(0.34);
  muzzle.visible = false;
  group.add(muzzle);
  const muzzleLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 3.5, 2);
  muzzleLight.position.copy(muzzle.position);
  group.add(muzzleLight);

  return { group, hitMeshes, muzzle, muzzleLight, backpack, packStripe, ring };
}

function pickCover(world, center, minDistance, maxDistance, rng) {
  const candidates = [];
  for (const point of world.coverPoints) {
    const dx = point.x - center.x;
    const dz = point.z - center.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= minDistance && distance <= maxDistance) candidates.push(point);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(rng() * candidates.length)].clone();
}

function choosePost(bot, game, area) {
  const center = area === 'mid'
    ? new THREE.Vector3(0, 0, 0)
    : game.sites.find((site) => site.id === area)?.center ?? game.tSite.center;
  const point = pickCover(game.world, center, 2.5, area === 'mid' ? 7 : 9, bot.rng);
  bot.post = point ?? center.clone();
  bot.postArea = area;
}

export function createBot({ actor, scene, world, rng, index }) {
  const avatar = createAvatar(actor, scene);
  const bot = {
    actor,
    rng,
    index,
    group: avatar.group,
    hitMeshes: avatar.hitMeshes,
    muzzle: avatar.muzzle,
    muzzleLight: avatar.muzzleLight,
    backpack: avatar.backpack,
    packStripe: avatar.packStripe,
    ring: avatar.ring,
    skill: 0.48 + rng() * 0.34,
    aggression: 0.4 + rng() * 0.45,
    state: 'advance',
    target: null,
    targetSeenAt: -99,
    reactionAt: 0,
    thinkAt: 0,
    aimJitterYaw: 0,
    aimJitterPitch: 0,
    path: [],
    pathIndex: 0,
    goal: null,
    repathAt: 0,
    post: null,
    postArea: null,
    bombPost: null,
    cover: null,
    coverUntil: 0,
    strafeDir: 1,
    strafeUntil: 0,
    pauseUntil: 0,
    burstLeft: 3,
    reloadAt: 0,
    flash: 0,
    hitFlash: 0,
    walkPhase: rng() * 10,
    death: 0,
    stuck: 0,
    detourUntil: 0,
    detour: new THREE.Vector3(),
    lastSeenPos: new THREE.Vector3(),
    role: 'hold',
  };
  actor.bot = bot;
  assignPost(bot, world);
  return bot;
}

export function assignPost(bot, world, areaOverride) {
  const area = areaOverride ?? (bot.actor.team === 'ct'
    ? (bot.index % 3 === 0 ? 'A' : bot.index % 3 === 1 ? 'B' : 'mid')
    : (bot.index % 2 === 0 ? 'A' : 'B'));
  bot.postArea = area;
  bot.role = bot.actor.team === 'ct' && bot.index === 3 ? 'roam' : 'hold';
  const site = world.sites.find((s) => s.id === area);
  const center = site ? site.center : new THREE.Vector3(0, 0, 0);
  bot.post = pickCover(world, center, 2.5, area === 'mid' ? 7 : 9, bot.rng) ?? center.clone();
}

export function resetBot(bot, game) {
  bot.target = null;
  bot.targetSeenAt = -99;
  bot.path = [];
  bot.pathIndex = 0;
  bot.goal = null;
  bot.cover = null;
  bot.coverUntil = 0;
  bot.strafeUntil = 0;
  bot.pauseUntil = 0;
  bot.burstLeft = 3;
  bot.death = 0;
  bot.stuck = 0;
  bot.detourUntil = 0;
  bot.flash = 0;
  bot.hitFlash = 0;
  bot.group.rotation.x = 0;
  bot.group.position.y = 0;
  bot.group.visible = true;
  bot.muzzle.visible = false;
  bot.muzzleLight.intensity = 0;
  assignPost(bot, game.world);
  if (bot.actor.team === 't' && bot.actor.hasBomb) {
    bot.bombPost = null;
  } else {
    bot.bombPost = null;
  }
}

function reportMovement(bot, moved, dt) {
  if (moved < 0.4 * dt && bot.path.length) bot.stuck += dt;
  else bot.stuck = Math.max(0, bot.stuck - dt * 2);
}

function moveToward(bot, point, speed, dt, game) {
  const actor = bot.actor;
  const now = game.time;
  let dx = point.x - actor.position.x;
  let dz = point.z - actor.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.08) return distance;
  dx /= distance;
  dz /= distance;

  if (now < bot.detourUntil) {
    dx = bot.detour.x;
    dz = bot.detour.z;
  } else if (bot.stuck > 0.45) {
    const sign = bot.rng() < 0.5 ? -1 : 1;
    bot.detour.set(-dz * sign, 0, dx * sign).normalize();
    bot.detourUntil = now + 0.6;
    bot.stuck = 0;
    bot.repathAt = 0;
    dx = bot.detour.x;
    dz = bot.detour.z;
  }

  const step = speed * dt;
  const beforeX = actor.position.x;
  const beforeZ = actor.position.z;
  let moved = game.world.moveCircle(actor.position, dx * step, dz * step, BOT_RADIUS);
  if (!moved && now >= bot.detourUntil) {
    const sign = bot.rng() < 0.5 ? -1 : 1;
    const side = new THREE.Vector3(-dz * sign, 0, dx * sign);
    moved = game.world.moveCircle(actor.position, side.x * step, side.z * step, BOT_RADIUS);
    if (moved) {
      bot.detour.copy(side);
      bot.detourUntil = now + 0.45;
    }
  }
  const actual = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ);
  reportMovement(bot, actual, dt);
  if (actual > 0.0005) actor.yaw = Math.atan2(-dx, -dz);
  return distance;
}

function planPath(bot, goal, game) {
  if (!goal) return;
  if (!bot.goal || bot.goal.distanceToSquared(goal) > 3.5) {
    bot.goal = goal.clone();
    bot.path = game.world.nav.findPath(bot.actor.position, goal);
    bot.pathIndex = 0;
    bot.repathAt = game.time + 2.8;
  } else if (game.time >= bot.repathAt) {
    bot.path = game.world.nav.findPath(bot.actor.position, bot.goal);
    bot.pathIndex = 0;
    bot.repathAt = game.time + 2.8;
  }
}

function followPath(bot, game, speed, dt) {
  if (!bot.path.length) return false;
  while (bot.pathIndex < bot.path.length - 1) {
    const point = bot.path[bot.pathIndex];
    if (Math.hypot(point.x - bot.actor.position.x, point.z - bot.actor.position.z) < 1.05) bot.pathIndex += 1;
    else break;
  }
  const point = bot.path[bot.pathIndex] ?? bot.path[bot.path.length - 1];
  const remaining = moveToward(bot, point, speed, dt, game);
  if (bot.pathIndex >= bot.path.length - 1 && remaining < 0.55) return true;
  return false;
}

function visibleTargets(bot, game, now) {
  const actor = bot.actor;
  const eye = eyeOf(actor);
  const forwardX = -Math.sin(actor.yaw);
  const forwardZ = -Math.cos(actor.yaw);
  let best = null;
  let bestScore = Infinity;
  for (const other of game.actors) {
    if (!other.alive || other.team === actor.team) continue;
    const otherEye = eyeOf(other);
    const dx = otherEye.x - eye.x;
    const dz = otherEye.z - eye.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 58) continue;
    const dot = distance > 0.01 ? (dx * forwardX + dz * forwardZ) / distance : 1;
    const alerted = now < (actor.alertUntil ?? 0);
    if (dot < 0.06 && distance > 3.2 && !alerted) continue;
    if (!game.world.los(eye, otherEye)) continue;
    let score = distance;
    if (other.isPlayer) score -= 3;
    if (bot.target === other) score -= 6;
    if (actor.lastAttacker === other) score -= 12;
    if (score < bestScore) { best = other; bestScore = score; }
  }
  return best;
}

function think(bot, game, now) {
  const actor = bot.actor;
  const found = visibleTargets(bot, game, now);
  if (found) {
    if (bot.target !== found) {
      bot.reactionAt = now + 0.16 + (1 - bot.skill) * 0.34;
      bot.burstLeft = Math.max(2, Math.round(2 + bot.skill * 4));
      bot.pauseUntil = now + 0.06;
    }
    bot.target = found;
    bot.targetSeenAt = now;
    bot.lastSeenPos.copy(found.position);
    game.reportContact(actor.team, actor, found);
  } else if (bot.target && now - bot.targetSeenAt > 0.55) {
    bot.target = null;
  }

  const weapon = currentWeapon(actor.arsenal);
  const distance = found ? actor.position.distanceTo(found.position) : 22;
  const error = (0.006 + (1 - bot.skill) * 0.034 + distance * 0.00085) * (actor.botMoving ? 1.45 : 1);
  bot.aimJitterYaw = (bot.rng() * 2 - 1) * error;
  bot.aimJitterPitch = (bot.rng() * 2 - 1) * error * 0.7;
  void weapon;

  if (actor.health < 38 && found) {
    const cover = findCover(bot, found, game, 15);
    if (cover) {
      bot.cover = cover;
      bot.coverUntil = now + 4.5;
    }
  }
}

function findCover(bot, threat, game, maxDistance) {
  const eye = eyeOf(bot.actor);
  const threatEye = eyeOf(threat);
  let best = null;
  let bestDistance = Infinity;
  for (const point of game.world.coverPoints) {
    const distance = Math.hypot(point.x - bot.actor.position.x, point.z - bot.actor.position.z);
    if (distance < 1.4 || distance > maxDistance) continue;
    const threatDistance = Math.hypot(point.x - threat.position.x, point.z - threat.position.z);
    if (threatDistance < 4.5) continue;
    const coverEye = new THREE.Vector3(point.x, 0.85, point.z);
    if (game.world.los(threatEye, coverEye)) continue;
    if (!game.world.isFree(point.x, point.z, BOT_RADIUS)) continue;
    const score = distance + Math.abs(distance - 6) * 0.2 + bot.rng() * 2;
    if (score < bestDistance) { bestDistance = score; best = point; }
  }
  void eye;
  return best;
}

function combat(bot, target, game, now, dt) {
  const actor = bot.actor;
  const weapon = currentWeapon(actor.arsenal);
  const state = currentAmmo(actor.arsenal);
  const eye = eyeOf(actor);
  const targetPoint = aimPointOf(target);
  const dx = targetPoint.x - eye.x;
  const dy = targetPoint.y - eye.y;
  const dz = targetPoint.z - eye.z;
  const distance = Math.hypot(dx, dy, dz);

  // Movement first, then aim, so walking never overwrites the direction the bot is firing.
  if (bot.cover && now < bot.coverUntil) {
    const remaining = moveToward(bot, bot.cover, 4.6, dt, game);
    actor.botMoving = remaining > 0.5;
    if (remaining < 0.7) { bot.cover = null; bot.coverUntil = 0; }
  } else if (weapon.zoom && distance > 10) {
    actor.botMoving = false;
  } else if (distance > 25) {
    const remaining = moveToward(bot, target.position, 4.3, dt, game);
    actor.botMoving = remaining > 0.5;
  } else {
    if (now >= bot.strafeUntil) {
      bot.strafeDir *= -1;
      bot.strafeUntil = now + 0.7 + bot.rng() * 1.2;
    }
    const length = Math.hypot(dx, dz) || 1;
    const sideX = (-dz / length) * bot.strafeDir;
    const sideZ = (dx / length) * bot.strafeDir;
    const beforeX = actor.position.x;
    const beforeZ = actor.position.z;
    const moved = game.world.moveCircle(actor.position, sideX * 2.15 * dt, sideZ * 2.15 * dt, BOT_RADIUS);
    if (!moved) bot.strafeDir *= -1;
    actor.botMoving = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ) > 0.0005;
  }

  const desiredYaw = Math.atan2(-dx, -dz) + bot.aimJitterYaw;
  const desiredPitch = clamp(Math.asin(clamp(dy / (distance || 1), -1, 1)) + bot.aimJitterPitch, -1.2, 1.2);
  const turn = (5.4 + bot.skill * 4.2) * dt;
  actor.yaw = approach(actor.yaw, desiredYaw, turn);
  actor.pitch = approach(actor.pitch, desiredPitch, turn);

  const yawError = Math.abs(angleDelta(actor.yaw, desiredYaw));
  const pitchError = Math.abs(actor.pitch - desiredPitch);

  if (state.mag <= 0 && state.reloadLeft === 0 && state.reserve > 0 && now >= bot.reloadAt) {
    if (game.reloadActor(actor)) bot.reloadAt = now + weapon.reload + 0.1;
    return;
  }

  const aimGood = yawError < 0.045 && pitchError < 0.045;
  const canFire = now >= bot.reactionAt && now >= bot.pauseUntil && state.reloadLeft === 0 && state.cooldown === 0 && aimGood;
  if (!canFire) return;
  if (!game.world.los(eye, eyeOf(target))) return;

  if (bot.burstLeft <= 0) {
    bot.pauseUntil = now + 0.18 + bot.rng() * 0.32;
    bot.burstLeft = Math.max(2, Math.round(2 + bot.skill * 5));
    return;
  }
  const spread = 0.0025 + (actor.botMoving ? 0.004 : 0) + (1 - bot.skill) * 0.004;
  const direction = new THREE.Vector3(
    -Math.sin(actor.yaw) * Math.cos(actor.pitch),
    Math.sin(actor.pitch),
    -Math.cos(actor.yaw) * Math.cos(actor.pitch),
  );
  const result = game.shootActor(actor, direction, spread);
  if (result.fired) {
    bot.flash = 0.06;
    bot.burstLeft -= 1;
    actor.pitch = clamp(actor.pitch + weapon.recoil * 0.3, -1.3, 1.3);
    if (!weapon.auto) bot.pauseUntil = now + 0.16 + bot.rng() * 0.22;
  }
}

function objectiveMove(bot, game, now, dt) {
  const actor = bot.actor;
  let goal = null;
  let speed = actor.team === 't' ? 4.7 : 4.25;
  let stopDistance = 0.75;

  if (game.phase === 'planted') {
    if (actor.team === 'ct') {
      goal = game.bomb.position;
      stopDistance = 1.15;
      speed = 5.0;
      if (Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) < 1.3) {
        actor.botMoving = false;
        actor.defuseIntent = true;
        return;
      }
    } else {
      if (!bot.bombPost || bot.bombPost.siteId !== game.bomb.siteId) {
        const cover = pickCover(game.world, game.bomb.position, 2.5, 11, bot.rng);
        bot.bombPost = cover ?? game.bomb.position.clone();
        bot.bombPost.siteId = game.bomb.siteId;
      }
      goal = bot.bombPost;
      actor.botMoving = true;
    }
  } else if (actor.team === 't') {
    if (game.bomb.state === 'dropped') {
      goal = game.bomb.position;
      stopDistance = 0.5;
    } else if (game.bomb.carrier === actor) {
      goal = game.tSite.center;
      stopDistance = 0.6;
    } else {
      const contact = game.freshIntel(actor, 4.5, 26);
      goal = contact ?? bot.post ?? game.tSite.center;
    }
  } else {
    const contact = bot.role === 'roam' ? game.freshIntel(actor, 6, 30) : null;
    if (contact) goal = contact;
    else if (bot.post) goal = bot.post;
    else goal = game.tSite.center;
  }

  if (!goal) {
    actor.botMoving = false;
    return;
  }
  actor.defuseIntent = false;

  planPath(bot, goal, game);
  const atGoal = followPath(bot, game, speed, dt);
  actor.botMoving = !atGoal;
  if (atGoal && actor.team === 't' && game.bomb.carrier === actor) {
    actor.botMoving = false;
    actor.plantIntent = true;
  }
  void stopDistance;
}

function syncAvatar(bot, dt, now) {
  const actor = bot.actor;
  if (!actor.alive) {
    if (bot.death < 1) {
      bot.death = Math.min(1, bot.death + dt / 0.5);
      bot.group.rotation.x = -bot.death * Math.PI * 0.5;
      bot.group.position.y = -bot.death * 0.12;
    }
    bot.muzzle.visible = false;
    bot.muzzleLight.intensity = 0;
    bot.backpack.visible = false;
    bot.packStripe.visible = false;
    return;
  }
  bot.group.position.set(actor.position.x, 0, actor.position.z);
  bot.group.rotation.y = actor.yaw;
  bot.group.rotation.x = 0;
  bot.group.position.y = 0;
  bot.flash = Math.max(0, bot.flash - dt);
  bot.muzzle.visible = bot.flash > 0;
  bot.muzzle.material.opacity = bot.flash > 0 ? 0.95 : 0;
  bot.muzzle.scale.setScalar(0.24 + Math.random() * 0.18);
  bot.muzzleLight.intensity = bot.flash > 0 ? 5 : 0;
  bot.backpack.visible = Boolean(actor.hasBomb);
  bot.packStripe.visible = Boolean(actor.hasBomb);
  const state = currentAmmo(actor.arsenal);
  const weapon = currentWeapon(actor.arsenal);
  void weapon;
  void state;
  bot.walkPhase += dt * (actor.botMoving ? 8 : 2);
  bot.ring.material.opacity = 0.22 + Math.sin(now * 3 + bot.index) * 0.06;
}

export function updateBot(bot, dt, game) {
  const actor = bot.actor;
  const now = game.time;
  if (!actor.alive) {
    syncAvatar(bot, dt, now);
    return;
  }
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.16 + bot.rng() * 0.14;
    think(bot, game, now);
  }
  if (bot.target && (!bot.target.alive || now - bot.targetSeenAt > 0.8)) bot.target = null;

  const state = currentAmmo(actor.arsenal);
  const weapon = currentWeapon(actor.arsenal);
  if (state.mag <= 0 && state.reloadLeft === 0 && state.reserve > 0 && now >= bot.reloadAt) {
    if (game.reloadActor(actor)) bot.reloadAt = now + weapon.reload + 0.1;
  } else if (!bot.target && state.reloadLeft === 0 && state.reserve > 0 && state.mag < weapon.mag * 0.42 && now >= bot.reloadAt) {
    if (game.reloadActor(actor)) bot.reloadAt = now + weapon.reload + 0.15;
  }

  if (bot.target) combat(bot, bot.target, game, now, dt);
  else objectiveMove(bot, game, now, dt);

  syncAvatar(bot, dt, now);
}

export function botEye(actor) {
  return eyeOf(actor);
}
