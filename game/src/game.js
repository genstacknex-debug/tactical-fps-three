// Round state, economy, combat resolution, the bomb objective and the HUD feed. This is the
// single authority for the simulation; main.js only advances it and renders the result.
import * as THREE from 'three';
import { PALETTE, TEAM_COLOR, TEAM_LABEL } from './palette.js';
import { createPlayer } from './player.js';
import {
  WEAPONS, SHOP, ARMOR_PRICE, KIT_PRICE, createArsenal, currentId, currentWeapon, currentAmmo,
  givePrimary, refillAmmo, stripPrimary, updateAmmo, beginReload, shotSpread, damageFor,
} from './weapon.js';
import { createBot, updateBot, resetBot, assignPost, botEye } from './bots.js';
import { createEffects } from './effects.js';

const BUY_TIME = 13;
const LIVE_TIME = 105;
const BOMB_TIME = 40;
const ROUND_END_TIME = 5.2;
const MATCH_TARGET = 7;
const KILL_REWARD = 300;
const WIN_REWARD = 3000;
const LOSS_REWARD = 1500;

const CT_NAMES = ['Vex', 'Marrow', 'Juno', 'Kilo'];
const T_NAMES = ['Rook', 'Sable', 'Torque', 'Wren', 'Hex'];

function actorEye(actor, player) {
  if (actor.isPlayer) {
    const p = player.state;
    return new THREE.Vector3(p.position.x, p.position.y + p.eye + p.bob, p.position.z);
  }
  return new THREE.Vector3(actor.position.x, actor.position.y + (actor.eyeHeight ?? 1.56), actor.position.z);
}

export function createGame({ scene, camera, world, input, hud, audio, viewmodel, rng }) {
  const effects = createEffects(scene);
  const player = createPlayer(world.colliders, world.spawns.ct[0]);

  const actors = [];
  const bots = [];

  function makeActor({ id, name, team, isPlayer, index }) {
    return {
      id, name, team, isPlayer, index,
      position: new THREE.Vector3(),
      yaw: 0, pitch: 0, eyeHeight: 1.56, crouching: false,
      alive: true, health: 100, armor: 0, hasKit: false,
      money: 800, kills: 0, deaths: 0,
      arsenal: createArsenal(),
      hasBomb: false, survived: false,
      lastAttacker: null, alertUntil: 0,
      botMoving: false, plantIntent: false, defuseIntent: false,
      buyAt: Infinity,
    };
  }

  const hero = makeActor({ id: 'player', name: 'Ace', team: 'ct', isPlayer: true, index: 0 });
  hero.position = player.state.position;
  hero.yaw = player.state.yaw;
  actors.push(hero);

  for (let i = 0; i < CT_NAMES.length; i += 1) {
    const actor = makeActor({ id: `ct-${i}`, name: CT_NAMES[i], team: 'ct', isPlayer: false, index: i });
    actors.push(actor);
  }
  for (let i = 0; i < T_NAMES.length; i += 1) {
    const actor = makeActor({ id: `t-${i}`, name: T_NAMES[i], team: 't', isPlayer: false, index: i });
    actors.push(actor);
  }

  for (const actor of actors) {
    if (actor.isPlayer) continue;
    const bot = createBot({ actor, scene, world, rng, index: actor.index + (actor.team === 't' ? 10 : 0) });
    bots.push(bot);
  }
  const ctBots = bots.filter((bot) => bot.actor.team === 'ct');
  const tBots = bots.filter((bot) => bot.actor.team === 't');

  // Invisible, raycastable player body.
  const playerRig = new THREE.Group();
  const invisible = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const bodyGeometry = new THREE.BoxGeometry(0.54, 0.66, 0.32);
  const headGeometry = new THREE.SphereGeometry(0.18, 12, 8);
  const legGeometry = new THREE.BoxGeometry(0.5, 0.68, 0.28);
  const playerHitMeshes = [];
  function hitPart(geometry, x, y, z, part) {
    const mesh = new THREE.Mesh(geometry, invisible);
    mesh.position.set(x, y, z);
    mesh.userData.actor = hero;
    mesh.userData.part = part;
    playerRig.add(mesh);
    playerHitMeshes.push(mesh);
  }
  hitPart(legGeometry, 0, 0.36, 0, 'legs');
  hitPart(bodyGeometry, 0, 1.18, 0, 'torso');
  hitPart(headGeometry, 0, 1.62, 0, 'head');
  scene.add(playerRig);

  const targetMeshes = playerHitMeshes.concat(bots.flatMap((bot) => bot.hitMeshes));
  const raycaster = new THREE.Raycaster();
  raycaster.far = 180;

  const state = {
    phase: 'menu',
    time: 0,
    phaseTime: 0,
    round: 1,
    scores: { ct: 0, t: 0 },
    lossStreak: { ct: 0, t: 0 },
    paused: false,
    matchOver: false,
    buyOpen: false,
    roundWinner: null,
    roundReason: '',
    tSite: world.sites[0],
    scoped: false,
    wasFiring: false,
    spectateId: null,
    hudTimer: 0,
    bannerUntil: 0,
    timeScale: 1,
  };

  const bomb = {
    state: 'carried',
    carrier: null,
    position: new THREE.Vector3(),
    timer: BOMB_TIME,
    siteId: null,
    plantProgress: 0,
    defuseProgress: 0,
    defuserId: null,
    beepTimer: 0,
    defuseBeep: 0,
    urgent: false,
  };

  const intel = { ct: new Map(), t: new Map() };
  const killFeed = [];

  function livePhase() {
    return state.phase === 'live' || state.phase === 'planted';
  }

  function living(team) {
    return actors.filter((actor) => actor.team === team && actor.alive);
  }

  function reportContact(team, actor, enemy) {
    const map = intel[team];
    map.set(enemy.id, { position: enemy.position.clone(), time: state.time, by: actor.id });
    if (map.size > 24) {
      for (const [key, value] of map) if (state.time - value.time > 9) map.delete(key);
    }
  }

  function freshIntel(actor, maxAge, maxDistance) {
    const map = intel[actor.team];
    let best = null;
    let bestDistance = Infinity;
    for (const entry of map.values()) {
      if (state.time - entry.time > maxAge) continue;
      const distance = Math.hypot(entry.position.x - actor.position.x, entry.position.z - actor.position.z);
      if (distance > maxDistance) continue;
      if (distance < bestDistance) { bestDistance = distance; best = entry.position.clone(); }
    }
    return best;
  }

  function placeAtSpawn(actor, index) {
    const list = actor.team === 'ct' ? world.spawns.ct : world.spawns.t;
    const spawn = list[index % list.length];
    actor.position.set(spawn.x, 0, spawn.z);
    actor.yaw = spawn.yaw;
    actor.pitch = 0;
    actor.eyeHeight = 1.56;
  }

  function prepareRound() {
    intel.ct.clear();
    intel.t.clear();
    state.tSite = world.sites[Math.floor(rng() * world.sites.length)];
    let ctIndex = 0;
    let tIndex = 0;
    for (const actor of actors) {
      if (actor.isPlayer) {
        player.respawn(world.spawns.ct[0]);
        actor.position = player.state.position;
      } else {
        const list = actor.team === 'ct' ? world.spawns.ct : world.spawns.t;
        const spawn = list[(actor.team === 'ct' ? ctIndex++ : tIndex++) + 1] ?? list[0];
        actor.position.set(spawn.x, 0, spawn.z);
        actor.yaw = spawn.yaw;
        actor.pitch = 0;
      }
      actor.alive = true;
      actor.health = 100;
      actor.hasBomb = false;
      actor.lastAttacker = null;
      actor.alertUntil = 0;
      actor.botMoving = false;
      actor.plantIntent = false;
      actor.defuseIntent = false;
      if (!actor.survived) {
        stripPrimary(actor.arsenal);
        actor.armor = 0;
        actor.hasKit = false;
      }
      actor.arsenal.slot = actor.arsenal.primary ? 'primary' : 'pistol';
      refillAmmo(actor.arsenal);
    }
    for (const bot of bots) resetBot(bot, api);
    for (const bot of tBots) assignPost(bot, world, state.tSite.id);
    resetBomb();
    const carrier = living('t')[Math.floor(rng() * living('t').length)];
    if (carrier) {
      carrier.hasBomb = true;
      bomb.state = 'carried';
      bomb.carrier = carrier;
      bomb.position.copy(carrier.position);
      effects.setBomb(false);
    }
    state.buyOpen = true;
    state.spectateId = null;
    state.scoped = false;
    state.wasFiring = false;
    killFeed.length = 0;
    hud.clearKillFeed();
    hud.setSpectate(null);
    for (const actor of actors) {
      actor.buyAt = actor.isPlayer ? Infinity : state.time + 0.35 + rng() * 1.5;
    }
  }

  function resetBomb() {
    bomb.state = 'carried';
    bomb.carrier = null;
    bomb.timer = BOMB_TIME;
    bomb.siteId = null;
    bomb.plantProgress = 0;
    bomb.defuseProgress = 0;
    bomb.defuserId = null;
    bomb.beepTimer = 0;
    bomb.defuseBeep = 0;
    bomb.urgent = false;
    effects.setBomb(false);
  }

  function startMatch() {
    state.round = 1;
    state.scores.ct = 0;
    state.scores.t = 0;
    state.lossStreak.ct = 0;
    state.lossStreak.t = 0;
    state.matchOver = false;
    state.roundWinner = null;
    state.roundReason = '';
    state.time = 0;
    state.paused = false;
    intel.ct.clear();
    intel.t.clear();
    for (const actor of actors) {
      actor.money = 800;
      actor.kills = 0;
      actor.deaths = 0;
      actor.survived = false;
      stripPrimary(actor.arsenal);
      actor.armor = 0;
      actor.hasKit = false;
    }
    beginBuyPhase();
    hud.hideOverlay();
  }

  function beginBuyPhase() {
    prepareRound();
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.buyOpen = true;
    hud.showScoreboard(false, null);
    hud.setPhase('BUY PHASE');
    hud.setTimer(BUY_TIME);
    hud.setBomb({ planted: false, timer: BOMB_TIME, site: null, defuse: 0, dropped: false });
    hud.banner(`ROUND ${state.round}`, 'Buy phase — B opens the shop', 2400);
    openBuy();
    refreshHud(true);
  }

  function startLive() {
    if (state.phase !== 'buy') return;
    for (const actor of actors) {
      if (!actor.isPlayer && actor.buyAt !== Infinity) {
        autoBuy(actor);
        actor.buyAt = Infinity;
      }
    }
    state.phase = 'live';
    state.phaseTime = LIVE_TIME;
    state.buyOpen = false;
    hud.showBuy(false, null, 0, null);
    hud.setPhase('ROUND');
    hud.setTimer(LIVE_TIME);
    hud.banner('ROUND LIVE', state.tSite.id === 'A' ? 'Cinders are moving toward Site A' : 'Cinders are moving toward Site B', 2600);
    audio.roundStart();
    refreshHud(true);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    const wasPlanted = bomb.state === 'planted';
    state.phase = 'roundEnd';
    state.phaseTime = ROUND_END_TIME;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.buyOpen = false;
    state.scoped = false;
    hud.showBuy(false, null, 0, null);
    hud.setScope(false);
    hud.setPhase('ROUND OVER');
    hud.setTimer(null);
    for (const actor of actors) actor.survived = actor.alive && actor.health > 0;
    state.scores[winner] += 1;
    const loser = winner === 'ct' ? 't' : 'ct';
    const lossBonus = Math.min(4, state.lossStreak[loser]);
    for (const actor of actors) {
      if (actor.team === winner) {
        actor.money = Math.min(16000, actor.money + WIN_REWARD);
      } else {
        actor.money = Math.min(16000, actor.money + LOSS_REWARD + lossBonus * 500);
      }
    }
    state.lossStreak[winner] = 0;
    state.lossStreak[loser] = Math.min(4, state.lossStreak[loser] + 1);
    if (wasPlanted) {
      for (const actor of actors) if (actor.team === 't') actor.money = Math.min(16000, actor.money + 400);
    }
    const title = winner === 'ct' ? 'WARDENS WIN' : 'CINDERS WIN';
    hud.banner(title, reason, 4200);
    hud.setScores(state.scores.ct, state.scores.t);
    hud.showScoreboard(true, scoreboardData());
    hud.setSpectate(null);
    if (winner === 'ct') audio.win(); else audio.lose();
    refreshHud(true);
  }

  function finishRoundEnd() {
    hud.showScoreboard(false, null);
    if (state.scores.ct >= MATCH_TARGET || state.scores.t >= MATCH_TARGET) {
      finishMatch();
      return;
    }
    state.round += 1;
    beginBuyPhase();
  }

  function finishMatch() {
    state.phase = 'matchEnd';
    state.matchOver = true;
    state.buyOpen = false;
    state.paused = false;
    hud.showBuy(false, null, 0, null);
    hud.setScope(false);
    const playerWon = state.scores.ct >= MATCH_TARGET;
    hud.showOverlay('end', {
      victory: playerWon,
      scores: { ...state.scores },
      player: { kills: hero.kills, deaths: hero.deaths, money: hero.money },
    });
    hud.showScoreboard(false, null);
    input.exitLock();
    refreshHud(true);
  }

  function scoreboardData() {
    const row = (actor) => ({
      name: actor.name,
      player: actor.isPlayer,
      alive: actor.alive,
      kills: actor.kills,
      deaths: actor.deaths,
      money: actor.money,
      weapon: actor.arsenal.primary ? WEAPONS[actor.arsenal.primary].name : WEAPONS.pistol.name,
    });
    return {
      ct: actors.filter((a) => a.team === 'ct').map(row),
      t: actors.filter((a) => a.team === 't').map(row),
      scores: { ...state.scores },
      round: state.round,
    };
  }

  function openBuy() {
    const items = shopItems();
    hud.showBuy(true, items, hero.money, (id) => playerBuy(id));
    hud.refreshBuy(hero.money, ownedSet(), hero.armor, hero.hasKit);
  }

  function shopItems() {
    return SHOP.map((item, i) => {
      const weapon = WEAPONS[item.id];
      return {
        id: item.id,
        key: String(i + 1),
        name: weapon.name,
        price: item.price,
        note: item.note,
        role: weapon.role,
        owned: hero.arsenal.primary === item.id,
      };
    }).concat([
      { id: 'armor', key: '5', name: 'Plate Vest', price: ARMOR_PRICE, note: '100 armour points', role: 'Armour', owned: hero.armor >= 100 },
      { id: 'kit', key: '6', name: 'Defuse Kit', price: KIT_PRICE, note: 'Defuse in 4 seconds', role: 'Utility', owned: hero.hasKit },
    ]);
  }

  function ownedSet() {
    return new Set([hero.arsenal.primary, hero.armor >= 100 ? 'armor' : null, hero.hasKit ? 'kit' : null].filter(Boolean));
  }

  function inBuyZone(actor) {
    const zone = world.buyZones[actor.team];
    if (!zone) return true;
    return Math.hypot(actor.position.x - zone.x, actor.position.z - zone.z) <= zone.radius;
  }

  function buyFor(actor, id) {
    if (state.phase !== 'buy' || !actor.alive) return false;
    if (actor.isPlayer && !inBuyZone(actor)) return false;
    if (id === 'armor') {
      if (actor.armor >= 100 || actor.money < ARMOR_PRICE) return false;
      actor.money -= ARMOR_PRICE;
      actor.armor = 100;
      return true;
    }
    if (id === 'kit') {
      if (actor.team !== 'ct' || actor.hasKit || actor.money < KIT_PRICE) return false;
      actor.money -= KIT_PRICE;
      actor.hasKit = true;
      return true;
    }
    const weapon = WEAPONS[id];
    if (!weapon) return false;
    if (id === 'pistol') {
      refillAmmo(actor.arsenal);
      actor.arsenal.slot = 'pistol';
      return true;
    }
    if (actor.money < weapon.price) return false;
    if (actor.arsenal.primary === id) {
      actor.arsenal.slot = 'primary';
      return true;
    }
    actor.money -= weapon.price;
    givePrimary(actor.arsenal, id);
    return true;
  }

  function playerBuy(id) {
    if (!state.buyOpen) return;
    const ok = buyFor(hero, id);
    if (ok) {
      audio.buy();
      hud.refreshBuy(hero.money, ownedSet(), hero.armor, hero.hasKit);
      hud.setMoney(hero.money);
      if (hero.arsenal.primary) viewmodel.setWeapon(currentId(hero.arsenal));
    } else {
      audio.deny();
    }
    refreshHud(true);
  }

  function autoBuy(actor) {
    if (actor.isPlayer || state.phase !== 'buy' || !actor.alive) return;
    const primary = actor.arsenal.primary;
    if (!primary) {
      if (actor.money >= WEAPONS.sniper.price && rng() < 0.1) buyFor(actor, 'sniper');
      else if (actor.money >= WEAPONS.rifle.price) buyFor(actor, 'rifle');
      else if (actor.money >= WEAPONS.smg.price) buyFor(actor, 'smg');
    } else {
      actor.arsenal.slot = 'primary';
    }
    if (actor.armor < 70 && actor.money >= ARMOR_PRICE) buyFor(actor, 'armor');
    if (actor.team === 'ct' && !actor.hasKit && actor.money >= KIT_PRICE + 400 && rng() < 0.55) buyFor(actor, 'kit');
  }

  function switchPlayerSlot(slot) {
    if (slot === 'primary' && !hero.arsenal.primary) {
      audio.deny();
      return;
    }
    if (hero.arsenal.slot === slot) return;
    const previous = currentAmmo(hero.arsenal);
    if (previous) previous.reloadLeft = 0;
    hero.arsenal.slot = slot;
    audio.ui();
    viewmodel.setWeapon(currentId(hero.arsenal));
    refreshHud(true);
  }

  function reloadHero() {
    if (beginReload(hero.arsenal)) {
      audio.reload();
      refreshHud(true);
    }
  }

  function damageActor(victim, attacker, weapon, part, point, direction, distance) {
    if (!victim.alive) return false;
    let damage = damageFor(weapon, part, distance);
    if (victim.armor > 0 && part !== 'head') {
      const absorbRatio = 0.5 * (1 - weapon.armorPen * 0.5);
      const absorbed = damage * absorbRatio;
      victim.armor = Math.max(0, victim.armor - absorbed * 0.85);
      damage -= absorbed;
    }
    victim.health = Math.max(0, victim.health - damage);
    victim.lastAttacker = attacker;
    victim.alertUntil = state.time + 1.6;
    effects.blood(point, TEAM_COLOR[victim.team], direction.clone().multiplyScalar(-1));
    if (victim.isPlayer) {
      hud.damageFlash(Math.min(1, damage / 55));
      hud.setVitals(victim.health, victim.armor, victim.hasKit);
    }
    if (attacker.isPlayer) {
      const killed = victim.health <= 0;
      hud.hitMarker(Boolean(killed), part === 'head');
      audio.hit(part === 'head');
    }
    if (victim.health <= 0) killActor(victim, attacker, weapon, part);
    return victim.health <= 0;
  }

  function killActor(victim, killer, weapon, part) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.health = 0;
    victim.deaths += 1;
    victim.survived = false;
    victim.lastAttacker = killer;
    if (victim.isPlayer) {
      player.state.alive = false;
      player.state.velocity.set(0, 0, 0);
      state.spectateId = null;
      hud.banner('ELIMINATED', 'Your squad is still in the round', 2200);
      hud.setSpectate('Spectating');
      audio.kill();
    } else if (victim.bot && victim.bot.target === killer) {
      victim.bot.target = null;
    }
    if (killer && killer !== victim) {
      killer.kills += 1;
      killer.money = Math.min(16000, killer.money + KILL_REWARD);
      if (killer.isPlayer) {
        hud.setMoney(killer.money);
        audio.kill();
      }
    }
    hud.killFeed({
      killer: killer?.name ?? 'World',
      victim: victim.name,
      weapon: weapon.name,
      headshot: part === 'head',
      killerTeam: killer?.team ?? victim.team,
      victimTeam: victim.team,
    });
    killFeed.push({ killer: killer?.name, victim: victim.name, headshot: part === 'head', time: state.time });
    refreshHud(true);
  }

  function currentSpread(actor) {
    const weapon = currentWeapon(actor.arsenal);
    const ammo = currentAmmo(actor.arsenal);
    if (!weapon || !ammo) return 0;
    return shotSpread(weapon, {
      speed: actor.isPlayer ? player.groundSpeed() : actor.botMoving ? 4.4 : 0,
      grounded: actor.isPlayer ? player.state.onGround : true,
      crouching: actor.isPlayer ? player.state.crouching : false,
      aiming: actor.isPlayer && state.scoped,
      shots: ammo.shots ?? 0,
    });
  }

  function shootActor(actor, direction, spread) {
    if (!actor.alive || !livePhase()) return { fired: false };
    const weapon = currentWeapon(actor.arsenal);
    const ammo = currentAmmo(actor.arsenal);
    if (!weapon || !ammo) return { fired: false };
    if (ammo.cooldown > 0 || ammo.reloadLeft > 0) return { fired: false };
    if (ammo.mag <= 0) {
      if (ammo.reserve > 0 && beginReload(actor.arsenal)) {
        if (actor.isPlayer) { audio.reload(); refreshHud(true); }
      } else if (actor.isPlayer) {
        audio.empty();
      }
      return { fired: false };
    }
    ammo.mag -= 1;
    ammo.cooldown = 60 / weapon.rpm;
    ammo.shots = (ammo.shots ?? 0) + 1;

    const origin = actorEye(actor, player);
    const dir = direction.clone().normalize();
    const worldUp = Math.abs(dir.y) > 0.96 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    if (spread > 0) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * spread;
      dir.addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).normalize();
    }

    scene.updateMatrixWorld(true);
    raycaster.set(origin, dir);
    raycaster.far = weapon.range * 2.2;
    const objects = world.shootables.concat(targetMeshes.filter((mesh) => mesh.userData.actor?.alive));
    const hits = raycaster.intersectObjects(objects, false);
    const color = TEAM_COLOR[actor.team];
    const end = origin.clone().addScaledVector(dir, weapon.range * 1.6);
    let hitPoint = end;
    let hitPart = null;
    let hitActor = null;
    let killed = false;
    for (const hit of hits) {
      const target = hit.object.userData.actor;
      if (target === actor) continue;
      hitPoint = hit.point.clone();
      if (target) {
        if (target.team === actor.team) break;
        hitActor = target;
        hitPart = hit.object.userData.part ?? 'torso';
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
        effects.impact(hitPoint, normal, color, false);
        killed = damageActor(target, actor, weapon, hitPart, hitPoint, dir, hit.distance);
        break;
      }
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      effects.impact(hitPoint, normal, color, false);
      break;
    }
    effects.tracer(origin, hitPoint, color);
    if (actor.isPlayer) {
      audio.shot(weapon.id, 0);
      viewmodel.trigger();
    } else {
      const distanceToPlayer = origin.distanceTo(actorEye(hero, player));
      audio.shot(weapon.id, distanceToPlayer);
    }
    refreshHud(true);
    return { fired: true, hitActor, hitPart, killed, point: hitPoint };
  }

  function dropBomb() {
    if (bomb.state !== 'carried') return;
    const carrier = bomb.carrier;
    if (carrier) carrier.hasBomb = false;
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.position.set(carrier?.position.x ?? 0, 0, carrier?.position.z ?? 0);
    effects.setBomb(true, bomb.position, false, false);
    hud.banner('CHARGE DROPPED', 'Cinders can recover it', 2000);
  }

  function plantBomb(carrier, site) {
    bomb.state = 'planted';
    bomb.carrier = null;
    bomb.position.set(carrier.position.x, 0, carrier.position.z);
    bomb.timer = BOMB_TIME;
    bomb.siteId = site.id;
    bomb.plantProgress = 0;
    bomb.defuseProgress = 0;
    bomb.defuserId = null;
    bomb.beepTimer = 0.15;
    bomb.urgent = false;
    carrier.hasBomb = false;
    carrier.money = Math.min(16000, carrier.money + 300);
    state.phase = 'planted';
    state.phaseTime = BOMB_TIME;
    state.buyOpen = false;
    hud.showBuy(false, null, 0, null);
    hud.setPhase('CHARGE DOWN');
    hud.setTimer(BOMB_TIME);
    hud.banner('CHARGE PLANTED', `Site ${site.id} — ${BOMB_TIME} seconds`, 2800);
    hud.setBomb({ planted: true, timer: BOMB_TIME, site: site.id, defuse: 0, dropped: false });
    effects.setBomb(true, bomb.position, true, false);
    audio.plantTick();
    audio.beep(true);
    refreshHud(true);
  }

  function updateBomb(dt) {
    if (state.phase === 'live') {
      if (bomb.state === 'carried' && bomb.carrier) {
        const carrier = bomb.carrier;
        bomb.position.copy(carrier.position);
        if (!carrier.alive) {
          dropBomb();
        } else {
          const site = world.sites.find((s) => Math.hypot(carrier.position.x - s.center.x, carrier.position.z - s.center.z) <= s.radius);
          const speed = carrier.isPlayer ? player.groundSpeed() : (carrier.botMoving ? 4.4 : 0);
          if (site && speed < 0.65) {
            bomb.plantProgress = Math.min(3.1, bomb.plantProgress + dt);
            if (bomb.plantProgress >= 3.1) plantBomb(carrier, site);
          } else {
            bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
          }
        }
      } else if (bomb.state === 'dropped') {
        let nearest = null;
        let best = 1.8;
        for (const actor of living('t')) {
          const distance = Math.hypot(actor.position.x - bomb.position.x, actor.position.z - bomb.position.z);
          if (distance < best) { best = distance; nearest = actor; }
        }
        if (nearest) {
          nearest.hasBomb = true;
          bomb.carrier = nearest;
          bomb.state = 'carried';
          bomb.plantProgress = 0;
          effects.setBomb(false);
          hud.banner('CHARGE RECOVERED', `${nearest.name} has the charge`, 1600);
        }
      }
    }

    if (state.phase === 'planted') {
      bomb.timer = Math.max(0, bomb.timer - dt);
      bomb.beepTimer -= dt;
      const urgent = bomb.timer < 12;
      if (urgent && !bomb.urgent) {
        bomb.urgent = true;
        effects.setBomb(true, bomb.position, true, true);
      }
      if (bomb.beepTimer <= 0) {
        bomb.beepTimer = bomb.timer > 20 ? 1.15 : bomb.timer > 10 ? 0.72 : bomb.timer > 5 ? 0.4 : 0.22;
        audio.beep(urgent);
      }

      const defusers = [];
      for (const actor of living('ct')) {
        const distance = Math.hypot(actor.position.x - bomb.position.x, actor.position.z - bomb.position.z);
        if (distance > 2.25) continue;
        const speed = actor.isPlayer ? player.groundSpeed() : (actor.botMoving ? 4.4 : 0);
        if (speed > 0.75) continue;
        if (actor.isPlayer && !input.state.keys.has('KeyE')) continue;
        if (!actor.isPlayer && !actor.defuseIntent) continue;
        defusers.push({ actor, distance });
      }
      defusers.sort((a, b) => a.distance - b.distance);
      if (defusers.length) {
        const active = defusers[0].actor;
        bomb.defuserId = active.id;
        const duration = active.hasKit ? 4.0 : 6.4;
        bomb.defuseProgress = Math.min(1, bomb.defuseProgress + dt / duration);
        bomb.defuseBeep -= dt;
        if (bomb.defuseBeep <= 0) {
          bomb.defuseBeep = 0.22;
          audio.defuseTick();
        }
        if (bomb.defuseProgress >= 1) {
          if (active.isPlayer) hud.banner('CHARGE DEFUSED', 'Wardens take the round', 2600);
          active.money = Math.min(16000, active.money + 300);
          effects.setBomb(false);
          bomb.state = 'defused';
          endRound('ct', `${active.name} defused the charge`);
        }
      } else {
        bomb.defuserId = null;
        bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 0.7);
      }
      if (bomb.timer <= 0 && state.phase === 'planted') {
        bomb.state = 'exploded';
        effects.explosion(new THREE.Vector3(bomb.position.x, 0.5, bomb.position.z));
        audio.explosion();
        endRound('t', 'The charge detonated');
      }
    }
  }

  function checkElimination() {
    if (!livePhase()) return;
    const ctAlive = living('ct').length;
    const tAlive = living('t').length;
    if (ctAlive === 0) {
      endRound('t', 'Wardens eliminated');
      return;
    }
    if (tAlive === 0 && state.phase !== 'planted') {
      endRound('ct', 'Cinders eliminated');
    }
  }

  function updatePlayer(dt) {
    hero.eyeHeight = player.state.eye;
    hero.crouching = player.state.crouching;
    hero.yaw = player.state.yaw;
    hero.pitch = player.state.pitch;
    const canMove = hero.alive && livePhase() && !state.paused;
    if (hero.alive) player.step(dt, canMove ? input.state.keys : new Set(), canMove);
    else player.step(dt, new Set(), false);
    playerRig.position.set(hero.position.x, hero.position.y, hero.position.z);
    playerRig.scale.y = player.state.crouching ? 0.72 : 1;
  }

  function handlePlayerInput() {
    if (state.phase === 'menu' || state.phase === 'matchEnd' || state.paused) return;
    if (input.consume('KeyB')) {
      if (state.phase === 'buy') {
        state.buyOpen = !state.buyOpen;
        if (state.buyOpen) openBuy();
        else hud.showBuy(false, null, 0, null);
        audio.ui();
      } else {
        audio.deny();
      }
    }
    if (state.buyOpen && state.phase === 'buy') {
      for (let i = 1; i <= 6; i += 1) {
        if (input.consume(`Digit${i}`)) {
          const items = shopItems();
          playerBuy(items[i - 1]?.id);
          break;
        }
      }
      state.wasFiring = input.state.firing;
      return;
    }
    if (input.consume('Digit1')) switchPlayerSlot('primary');
    if (input.consume('Digit2')) switchPlayerSlot('pistol');
    const wheel = input.takeWheel();
    if (wheel !== 0) switchPlayerSlot(hero.arsenal.slot === 'primary' ? 'pistol' : 'primary');
    if (input.consume('KeyR')) reloadHero();

    const weapon = currentWeapon(hero.arsenal);
    state.scoped = Boolean(weapon.zoom && input.state.aiming && hero.alive && livePhase());
    hud.setScope(state.scoped);

    if (!hero.alive || !livePhase()) {
      state.wasFiring = input.state.firing;
      return;
    }
    const ammo = currentAmmo(hero.arsenal);
    const wantsFire = weapon.auto ? input.state.firing : (input.state.firing && !state.wasFiring);
    if (wantsFire && !state.buyOpen) {
      if (ammo.mag <= 0) {
        if (ammo.reserve > 0) reloadHero();
        else audio.empty();
      } else if (ammo.cooldown === 0 && ammo.reloadLeft === 0) {
        const spread = currentSpread(hero);
        const yaw = player.state.yaw + player.state.recoilYaw;
        const pitch = Math.max(-1.5, Math.min(1.5, player.state.pitch + player.state.recoilPitch));
        const direction = new THREE.Vector3(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
        shootActor(hero, direction, spread);
        player.recoil(weapon.recoil * (player.state.crouching ? 0.78 : 1), (rng() * 2 - 1) * weapon.recoilYaw);
      }
    }
    state.wasFiring = input.state.firing;
  }

  function step(dt) {
    if (state.phase === 'menu' || state.paused) {
      effects.step(dt, state.time);
      return;
    }
    state.time += dt;
    state.hudTimer -= dt;

    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      for (const actor of actors) {
        if (!actor.isPlayer && actor.alive && state.time >= actor.buyAt) {
          autoBuy(actor);
          actor.buyAt = Infinity;
        }
      }
      if (state.phaseTime <= 0) startLive();
    } else if (state.phase === 'live') {
      state.phaseTime = Math.max(0, state.phaseTime - dt);
      if (state.phaseTime <= 0) endRound('ct', 'Time expired');
    } else if (state.phase === 'planted') {
      // The bomb timer owns the clock in this phase.
    } else if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) finishRoundEnd();
    }

    updatePlayer(dt);
    handlePlayerInput();

    for (const actor of actors) {
      const ammo = currentAmmo(actor.arsenal);
      if (ammo) updateAmmo(ammo, dt);
    }

    if (livePhase()) {
      for (const bot of bots) updateBot(bot, dt, api);
    } else {
      for (const bot of bots) if (!bot.actor.alive) updateBot(bot, dt, api);
    }

    if (state.phase === 'live' || state.phase === 'planted') {
      updateBomb(dt);
      checkElimination();
    }
    effects.step(dt, state.time);
    refreshHud(false);
    if (bomb.state === 'planted' && bomb.defuserId === hero.id) {
      hud.setInteract('Defusing charge', bomb.defuseProgress);
    } else if (bomb.state === 'planted' && hero.alive && Math.hypot(hero.position.x - bomb.position.x, hero.position.z - bomb.position.z) < 2.3) {
      hud.setInteract(input.state.keys.has('KeyE') ? 'Defusing charge' : 'Hold [E] to defuse', bomb.defuseProgress);
    } else {
      hud.setInteract(null, 0);
    }
  }

  function syncCamera(dt) {
    const weapon = currentWeapon(hero.arsenal);
    state.scoped = Boolean(weapon.zoom && input.state.aiming && hero.alive && livePhase() && !state.paused);
    hud.setScope(state.scoped);
    const targetFov = state.scoped ? 30 : 74;
    const nextFov = camera.fov + (targetFov - camera.fov) * Math.min(1, dt * 14);
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }

    if (hero.alive) {
      camera.position.set(hero.position.x, hero.position.y + player.state.eye + player.state.bob, hero.position.z);
      const pitch = Math.max(-1.5, Math.min(1.5, player.state.pitch + player.state.recoilPitch));
      const yaw = player.state.yaw + player.state.recoilYaw;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } else {
      let target = actors.find((actor) => actor.id === state.spectateId && actor.alive && actor.team === 'ct' && !actor.isPlayer);
      if (!target) {
        target = living('ct').find((actor) => !actor.isPlayer);
        state.spectateId = target ? target.id : null;
      }
      if (target) {
        const eye = actorEye(target, player);
        camera.position.copy(eye);
        camera.rotation.set(target.pitch ?? 0, target.yaw ?? 0, 0, 'YXZ');
        hud.setSpectate(`Spectating ${target.name}`);
      } else {
        camera.position.set(bomb.position.x, 9, bomb.position.z + 6);
        camera.rotation.set(-1.1, 0, 0, 'YXZ');
      }
    }

    viewmodel.setWeapon(currentId(hero.arsenal));
    viewmodel.setHidden(!hero.alive || state.scoped || state.phase === 'menu' || state.phase === 'matchEnd');
    const ammo = currentAmmo(hero.arsenal);
    viewmodel.step(dt, {
      reloading: ammo ? ammo.reloadLeft > 0 : false,
      speed: hero.alive ? player.groundSpeed() : 0,
    });
  }

  function look(dx, dy) {
    if (!hero.alive || state.paused || state.phase === 'menu' || state.phase === 'matchEnd') return;
    const sensitivity = state.scoped ? 0.00095 : 0.00215;
    player.look(dx, dy, sensitivity);
  }

  function refreshHud(force) {
    if (!force && state.hudTimer > 0) return;
    state.hudTimer = 0.075;
    const weapon = currentWeapon(hero.arsenal);
    const ammo = currentAmmo(hero.arsenal);
    hud.setScores(state.scores.ct, state.scores.t);
    hud.setRound(state.round);
    hud.setMoney(hero.money);
    hud.setVitals(hero.health, hero.armor, hero.hasKit);
    hud.setAmmo(ammo?.mag ?? 0, ammo?.reserve ?? 0, weapon.name, ammo ? ammo.reloadLeft : 0);
    hud.setAlive(living('ct').length, living('t').length);
    hud.setVitals(hero.health, hero.armor, hero.hasKit);
    const planted = state.phase === 'planted' || bomb.state === 'planted';
    hud.setBomb({
      planted,
      timer: planted ? bomb.timer : 0,
      site: bomb.siteId,
      defuse: bomb.defuseProgress,
      dropped: bomb.state === 'dropped',
      carrier: bomb.carrier?.name ?? null,
    });
    if (state.phase === 'buy') hud.setTimer(Math.ceil(state.phaseTime));
    else if (state.phase === 'live') hud.setTimer(Math.ceil(state.phaseTime));
    else if (state.phase === 'planted') hud.setTimer(bomb.timer, true);
    else hud.setTimer(null);
    const spread = currentSpread(hero);
    hud.setCrosshairSpread(4 + Math.min(28, spread * 1500));
    if (state.buyOpen && state.phase === 'buy') {
      hud.refreshBuy(hero.money, ownedSet(), hero.armor, hero.hasKit);
    }

    const allies = living('ct').filter((actor) => actor !== hero);
    const enemies = [];
    if (hero.alive) {
      const eye = actorEye(hero, player);
      for (const enemy of living('t')) {
        const enemyEye = actorEye(enemy, player);
        if (eye.distanceTo(enemyEye) > 46) continue;
        if (world.los(eye, enemyEye)) enemies.push(enemy);
      }
      for (const [id, entry] of intel.ct) {
        if (state.time - entry.time > 2.2) continue;
        const enemy = actors.find((actor) => actor.id === id && actor.alive);
        if (enemy && !enemies.includes(enemy)) enemies.push(enemy);
      }
    }
    hud.drawMinimap({
      player: hero.alive ? { x: hero.position.x, z: hero.position.z, yaw: player.state.yaw + player.state.recoilYaw } : null,
      allies: allies.map((actor) => ({ x: actor.position.x, z: actor.position.z })),
      enemies: enemies.map((actor) => ({ x: actor.position.x, z: actor.position.z })),
      bomb: (bomb.state === 'planted' || bomb.state === 'dropped') ? { x: bomb.position.x, z: bomb.position.z, planted } : null,
    });

    const showBoard = (input.state.keys.has('Tab') || state.phase === 'roundEnd') && state.phase !== 'menu';
    hud.showScoreboard(showBoard, showBoard ? scoreboardData() : null);
  }

  function setLocked(locked) {
    if (locked) {
      state.paused = false;
      if (state.phase !== 'menu' && state.phase !== 'matchEnd') hud.hideOverlay();
    } else if (state.phase !== 'menu' && state.phase !== 'matchEnd') {
      state.paused = true;
      hud.showOverlay('paused');
    }
  }

  function setupShot(name) {
    state.paused = false;
    state.time = 64;
    state.scores.ct = 3;
    state.scores.t = 2;
    state.round = 6;
    for (const actor of actors) {
      actor.alive = true;
      actor.health = 100;
      actor.armor = 0;
      actor.hasBomb = false;
      actor.kills = 3;
      actor.deaths = 2;
      actor.money = 3200;
      stripPrimary(actor.arsenal);
      refillAmmo(actor.arsenal);
    }
    hud.setMap(world.mapData);
    if (name === 'start' || name === 'menu') {
      state.phase = 'menu';
      state.round = 1;
      state.scores.ct = 0;
      state.scores.t = 0;
      state.matchOver = false;
      player.respawn(world.spawns.ct[0]);
      player.state.yaw = 0;
      player.state.pitch = -0.03;
      positionTeams(true);
      hud.clearKillFeed();
      hud.showBuy(false, null, 0, null);
      hud.showScoreboard(false, null);
      hud.showOverlay('start');
      hud.setScores(0, 0);
      hud.setRound(1);
      hud.setTimer(null);
      hud.setSpectate(null);
      effects.setBomb(false);
    } else if (name === 'buy') {
      state.phase = 'buy';
      state.phaseTime = 9;
      state.buyOpen = true;
      hero.money = 3450;
      state.scores.ct = 2;
      state.scores.t = 1;
      state.round = 4;
      player.respawn(world.spawns.ct[0]);
      player.state.yaw = 0.05;
      player.state.pitch = -0.02;
      positionTeams(true);
      hud.hideOverlay();
      hud.showScoreboard(false, null);
      hud.setScores(2, 1);
      hud.setRound(4);
      hud.setPhase('BUY PHASE');
      hud.setTimer(9);
      openBuy();
      hud.banner('ROUND 4', 'Buy phase — choose your loadout', 4000);
      effects.setBomb(false);
    } else if (name === 'play') {
      state.phase = 'planted';
      state.phaseTime = BOMB_TIME;
      state.bombPatched = true;
      state.scores.ct = 4;
      state.scores.t = 2;
      state.round = 7;
      bomb.state = 'planted';
      bomb.timer = 23.4;
      bomb.siteId = 'A';
      bomb.defuseProgress = 0.34;
      bomb.defuserId = null;
      bomb.urgent = false;
      bomb.position.set(14.2, 0, 1.1);
      hero.money = 4250;
      hero.health = 82;
      hero.armor = 71;
      hero.kills = 8;
      hero.deaths = 3;
      hero.arsenal = createArsenal();
      givePrimary(hero.arsenal, 'rifle');
      hero.arsenal.slot = 'primary';
      hero.arsenal.ammo.rifle.mag = 21;
      hero.arsenal.ammo.rifle.reserve = 60;
      player.respawn({ x: 8.6, z: 1.15, yaw: Math.atan2(-(14.2 - 8.6), -(1.1 - 1.15)) });
      player.state.pitch = -0.02;
      state.scoped = false;
      const allies = ctBots;
      placeBot(allies[0], 7.4, -1.0, -0.3, true, 88);
      placeBot(allies[1], 9.4, 4.1, 0.6, true, 64);
      placeBot(allies[2], 5.6, 4.8, 1.1, true, 100);
      placeBot(allies[3], 13.4, -3.1, 0.2, false, 0);
      const enemies = tBots;
      placeBot(enemies[0], 14.1, 0.2, Math.atan2(-(8.6 - 14.1), -(1.15 - 0.2)), true, 100);
      placeBot(enemies[1], 17.2, 3.2, Math.PI, true, 55);
      placeBot(enemies[2], 12.0, 4.1, 2.4, true, 100);
      placeBot(enemies[3], 16.5, -4.6, 1.2, false, 0);
      placeBot(enemies[4], 12.4, -6.0, 0.1, false, 0);
      hero.botMoving = false;
      hud.hideOverlay();
      hud.showScoreboard(false, null);
      hud.setScores(4, 2);
      hud.setRound(7);
      hud.setPhase('CHARGE DOWN');
      hud.setTimer(23.4, true);
      hud.setBomb({ planted: true, timer: 23.4, site: 'A', defuse: 0.34, dropped: false });
      hud.setSpectate(null);
      hud.clearKillFeed();
      hud.killFeed({ killer: 'Vex', victim: 'Rook', weapon: 'Longbow AR', headshot: true, killerTeam: 'ct', victimTeam: 't' });
      hud.killFeed({ killer: 'Sable', victim: 'Juno', weapon: 'Viper SMG', headshot: false, killerTeam: 't', victimTeam: 'ct' });
      hud.killFeed({ killer: 'Ace', victim: 'Wren', weapon: 'Longbow AR', headshot: false, killerTeam: 'ct', victimTeam: 't' });
      hud.banner('CHARGE PLANTED', 'Site A — hold the site or defuse', 60000);
      effects.setBomb(true, bomb.position, true, false);
      effects.tracer(new THREE.Vector3(14.2, 1.35, 0.2), new THREE.Vector3(11.5, 1.1, 1.0), PALETTE.hostile);
      effects.impact(new THREE.Vector3(11.5, 1.1, 1.0), new THREE.Vector3(0, 0.2, 1), PALETTE.hostile, true);
      enemies[0].flash = 0.06;
    } else {
      state.phase = 'matchEnd';
      state.matchOver = true;
      state.scores.ct = 7;
      state.scores.t = 4;
      state.round = 11;
      hero.kills = 24;
      hero.deaths = 9;
      hero.money = 6100;
      player.respawn({ x: 13.5, z: 0.5, yaw: -0.4 });
      player.state.pitch = -0.08;
      positionTeams(false);
      const site = world.sites[0];
      bomb.state = 'defused';
      bomb.position.copy(site.center);
      effects.setBomb(false);
      hud.hideOverlay();
      hud.showBuy(false, null, 0, null);
      hud.setScores(7, 4);
      hud.setRound(11);
      hud.setPhase('MATCH OVER');
      hud.setTimer(null);
      hud.setSpectate(null);
      hud.showOverlay('end', {
        victory: true,
        scores: { ct: 7, t: 4 },
        player: { kills: 24, deaths: 9, money: 6100 },
      });
    }
    refreshHud(true);
    if (state.phase === 'buy') hud.showBuy(true, shopItems(), hero.money, (id) => playerBuy(id));
  }

  function placeBot(bot, x, z, yaw, alive, health) {
    const actor = bot.actor;
    actor.position.set(x, 0, z);
    actor.yaw = yaw;
    actor.pitch = 0;
    actor.alive = alive;
    actor.health = health;
    bot.death = alive ? 0 : 1;
    bot.group.position.set(x, alive ? 0 : -0.12, z);
    bot.group.rotation.y = yaw;
    bot.group.rotation.x = alive ? 0 : -Math.PI * 0.5;
    bot.muzzle.visible = false;
    bot.backpack.visible = Boolean(actor.hasBomb) && alive;
    bot.packStripe.visible = Boolean(actor.hasBomb) && alive;
  }

  function positionTeams(useSpawns) {
    let ctIndex = 0;
    let tIndex = 0;
    for (const actor of actors) {
      if (actor.isPlayer) continue;
      const spawn = (actor.team === 'ct' ? world.spawns.ct : world.spawns.t)[(actor.team === 'ct' ? ctIndex++ : tIndex++) + 1] ?? world.spawns.ct[0];
      actor.position.set(spawn.x, 0, spawn.z);
      actor.yaw = spawn.yaw;
      if (actor.bot) {
        actor.bot.group.position.set(spawn.x, 0, spawn.z);
        actor.bot.group.rotation.set(0, spawn.yaw, 0);
        actor.bot.death = 0;
      }
      void useSpawns;
    }
  }

  const api = {
    state,
    actors,
    hero,
    bomb,
    world,
    sites: world.sites,
    player,
    effects,
    startMatch,
    setupShot,
    step,
    look,
    syncCamera,
    setLocked,
    needsStart() {
      return state.phase === 'menu' || state.phase === 'matchEnd';
    },
    reportContact(team, actor, enemy) {
      reportContact(team, actor, enemy);
    },
    freshIntel(actor, maxAge, maxDistance) {
      return freshIntel(actor, maxAge, maxDistance);
    },
    shootActor,
    reloadActor(actor) {
      if (beginReload(actor.arsenal)) {
        if (actor.isPlayer) { audio.reload(); refreshHud(true); }
        return true;
      }
      return false;
    },
    currentWeapon(actor) {
      return currentWeapon(actor.arsenal);
    },
    currentAmmo(actor) {
      return currentAmmo(actor.arsenal);
    },
    refreshHud,
    setTimeScale(scale) {
      state.timeScale = scale;
    },
  };

  // Keep the public snapshots that bots read in sync.
  Object.defineProperty(api, 'phase', {
    get() { return state.phase; },
  });
  Object.defineProperty(api, 'time', {
    get() { return state.time; },
  });
  Object.defineProperty(api, 'tSite', {
    get() { return state.tSite; },
  });

  placeAtSpawn(hero, 0);
  for (const actor of actors) if (!actor.isPlayer) placeAtSpawn(actor, actor.index + (actor.team === 'ct' ? 1 : 0));
  for (const bot of bots) {
    bot.group.position.set(bot.actor.position.x, 0, bot.actor.position.z);
    bot.group.rotation.y = bot.actor.yaw;
  }
  hud.setMap(world.mapData);
  hud.setPhase('BUY PHASE');
  hud.setScores(0, 0);
  hud.setRound(1);
  hud.setTimer(null);
  hud.setMoney(hero.money);
  hud.setVitals(hero.health, hero.armor, hero.hasKit);
  hud.setAlive(5, 5);
  hud.setAmmo(WEAPONS.pistol.mag, WEAPONS.pistol.reserve, WEAPONS.pistol.name, 0);
  hud.setBomb({ planted: false, timer: BOMB_TIME, site: null, defuse: 0, dropped: false });
  hud.setInteract(null, 0);
  hud.setSpectate(null);
  hud.showBuy(false, null, 0, null);
  hud.showScoreboard(false, null);
  syncCamera(0.016);
  refreshHud(true);
  return api;
}
