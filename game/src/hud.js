// DOM HUD: scores, clock, economy, vitals, ammo, kill feed, buy menu, scoreboard,
// minimap, bomb state and the start/pause/end overlay. It draws from snapshots the
// game hands it and never reads simulation state directly.
import { PALETTE } from './palette.js';

const MAP_SIZE = 220;
const MAP_PAD = 11;
const FEED_LIMIT = 5;
const FEED_LIFETIME = 6200;

const $ = (id) => document.getElementById(id);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBombClock(seconds) {
  const total = Math.max(0, seconds);
  if (total < 10) return `${total.toFixed(1)}s`;
  return formatClock(total);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createHud() {
  const root = $('hud');
  const scoreCt = $('score-ct');
  const scoreT = $('score-t');
  const roundLabel = $('round-label');
  const timer = $('timer');
  const phaseLabel = $('phase-label');
  const aliveCt = $('alive-ct');
  const aliveT = $('alive-t');
  const moneyValue = $('money-value');
  const killfeed = $('killfeed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vitals = $('vitals');
  const healthVital = $('health-vital');
  const healthValue = $('health-value');
  const healthFill = $('health-fill');
  const armorVital = $('armor-vital');
  const armorValue = $('armor-value');
  const armorFill = $('armor-fill');
  const kitBadge = $('kit-badge');
  const ammoPanel = $('ammo-panel');
  const weaponName = $('weapon-name');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const reloadLine = $('reload-line');
  const bombStatus = $('bomb-status');
  const bombTitle = $('bomb-title');
  const bombTimer = $('bomb-timer');
  const bombDefuseFill = $('bomb-defuse-fill');
  const interact = $('interact');
  const interactLabel = $('interact-label');
  const interactFill = $('interact-fill');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const damageVignette = $('damage-vignette');
  const scope = $('scope');
  const spectate = $('spectate');
  const buy = $('buy');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  const scoreboard = $('scoreboard');
  const overlay = $('overlay');
  const overlayKicker = $('overlay-kicker');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const minimap = $('minimap');
  const minimapCtx = minimap.getContext('2d');

  let mapData = null;
  let mapBackground = null;
  let bannerTimer = 0;
  let hitTimer = 0;
  let damageTimer = 0;
  let boardSignature = '';
  let buyItems = [];
  let buyHandler = null;
  let playHandler = null;
  const feedTimers = new WeakMap();

  function project(x, z) {
    if (!mapData) return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
    const { minX, maxX, minZ, maxZ } = mapData.bounds;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    return {
      x: MAP_PAD + ((x - minX) / spanX) * (MAP_SIZE - MAP_PAD * 2),
      y: MAP_PAD + ((z - minZ) / spanZ) * (MAP_SIZE - MAP_PAD * 2),
    };
  }

  function buildMapBackground() {
    if (!mapData) return;
    const canvas = document.createElement('canvas');
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx = canvas.getContext('2d');
    const bounds = mapData.bounds;

    ctx.fillStyle = '#101317';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const topLeft = project(bounds.minX, bounds.minZ);
    const bottomRight = project(bounds.maxX, bounds.maxZ);
    ctx.fillStyle = '#1b2026';
    ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

    ctx.strokeStyle = 'rgba(152, 160, 168, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i += 1) {
      const x = MAP_PAD + (i / 8) * (MAP_SIZE - MAP_PAD * 2);
      const y = MAP_PAD + (i / 8) * (MAP_SIZE - MAP_PAD * 2);
      ctx.beginPath();
      ctx.moveTo(x, MAP_PAD);
      ctx.lineTo(x, MAP_SIZE - MAP_PAD);
      ctx.moveTo(MAP_PAD, y);
      ctx.lineTo(MAP_SIZE - MAP_PAD, y);
      ctx.stroke();
    }

    for (const zone of Object.values(mapData.buyZones ?? {})) {
      const p = project(zone.x, zone.z);
      const radius = (zone.radius / (bounds.maxX - bounds.minX)) * (MAP_SIZE - MAP_PAD * 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(95, 179, 161, 0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(95, 179, 161, 0.18)';
      ctx.stroke();
    }

    for (const site of mapData.sites ?? []) {
      const p = project(site.x, site.z);
      const radius = (site.radius / (bounds.maxX - bounds.minX)) * (MAP_SIZE - MAP_PAD * 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240, 168, 48, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 168, 48, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = PALETTE.accent;
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site.id, p.x, p.y);
    }

    for (const wall of mapData.walls ?? []) {
      if (wall.kind !== 'wall' && wall.kind !== 'cover') continue;
      const p = project(wall.x - wall.w / 2, wall.z - wall.d / 2);
      const q = project(wall.x + wall.w / 2, wall.z + wall.d / 2);
      ctx.fillStyle = wall.kind === 'cover' ? '#3a424c' : '#2a3038';
      ctx.fillRect(p.x, p.y, Math.max(1, q.x - p.x), Math.max(1, q.y - p.y));
    }

    ctx.strokeStyle = 'rgba(233, 230, 223, 0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(MAP_PAD, MAP_PAD, MAP_SIZE - MAP_PAD * 2, MAP_SIZE - MAP_PAD * 2);
    mapBackground = canvas;
  }

  function drawMinimap(snapshot) {
    if (!mapBackground) buildMapBackground();
    minimapCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    if (mapBackground) minimapCtx.drawImage(mapBackground, 0, 0);
    if (!snapshot) return;

    for (const ally of snapshot.allies ?? []) {
      const p = project(ally.x, ally.z);
      minimapCtx.beginPath();
      minimapCtx.arc(p.x, p.y, 2.7, 0, Math.PI * 2);
      minimapCtx.fillStyle = PALETTE.ally;
      minimapCtx.fill();
      minimapCtx.strokeStyle = 'rgba(16, 19, 23, 0.8)';
      minimapCtx.stroke();
    }

    for (const enemy of snapshot.enemies ?? []) {
      const p = project(enemy.x, enemy.z);
      minimapCtx.beginPath();
      minimapCtx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
      minimapCtx.fillStyle = PALETTE.hostile;
      minimapCtx.fill();
      minimapCtx.strokeStyle = 'rgba(16, 19, 23, 0.8)';
      minimapCtx.stroke();
    }

    if (snapshot.bomb) {
      const p = project(snapshot.bomb.x, snapshot.bomb.z);
      minimapCtx.save();
      minimapCtx.translate(p.x, p.y);
      minimapCtx.rotate(Math.PI / 4);
      minimapCtx.fillStyle = snapshot.bomb.planted ? PALETTE.danger : PALETTE.accent;
      minimapCtx.fillRect(-3.3, -3.3, 6.6, 6.6);
      minimapCtx.strokeStyle = '#101317';
      minimapCtx.strokeRect(-3.3, -3.3, 6.6, 6.6);
      minimapCtx.restore();
      if (snapshot.bomb.planted) {
        minimapCtx.beginPath();
        minimapCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        minimapCtx.strokeStyle = 'rgba(214, 73, 63, 0.6)';
        minimapCtx.stroke();
      }
    }

    if (snapshot.player) {
      const p = project(snapshot.player.x, snapshot.player.z);
      minimapCtx.save();
      minimapCtx.translate(p.x, p.y);
      minimapCtx.rotate(-snapshot.player.yaw);
      minimapCtx.beginPath();
      minimapCtx.moveTo(0, -6);
      minimapCtx.lineTo(4.4, 4.6);
      minimapCtx.lineTo(0, 2.6);
      minimapCtx.lineTo(-4.4, 4.6);
      minimapCtx.closePath();
      minimapCtx.fillStyle = PALETTE.accent;
      minimapCtx.fill();
      minimapCtx.strokeStyle = '#101317';
      minimapCtx.lineWidth = 1;
      minimapCtx.stroke();
      minimapCtx.restore();
    }
  }

  function setMap(data) {
    mapData = data;
    mapBackground = null;
    buildMapBackground();
    drawMinimap(null);
  }

  function setScores(ct, t) {
    scoreCt.textContent = String(ct);
    scoreT.textContent = String(t);
  }

  function setRound(round) {
    roundLabel.textContent = `ROUND ${round}`;
  }

  function setPhase(label) {
    phaseLabel.textContent = String(label).toUpperCase();
  }

  function setTimer(seconds, planted = false) {
    if (seconds == null) {
      timer.textContent = '--:--';
      timer.classList.remove('urgent');
      return;
    }
    timer.textContent = planted ? formatBombClock(seconds) : formatClock(seconds);
    timer.classList.toggle('urgent', seconds <= 10);
  }

  function setMoney(money) {
    moneyValue.textContent = String(Math.max(0, Math.round(money)));
  }

  function setVitals(health, armor, hasKit) {
    const hp = clamp(health, 0, 100);
    const ap = clamp(armor, 0, 100);
    healthValue.textContent = String(Math.round(hp));
    armorValue.textContent = String(Math.round(ap));
    healthFill.style.width = `${hp}%`;
    armorFill.style.width = `${ap}%`;
    healthVital.classList.toggle('low', hp <= 30);
    armorVital.classList.toggle('low', ap <= 15);
    kitBadge.classList.toggle('on', Boolean(hasKit));
    vitals.dataset.health = String(Math.round(hp));
  }

  function setAmmo(mag, reserve, name, reloadLeft) {
    ammoMag.textContent = String(Math.max(0, Math.round(mag)));
    ammoReserve.textContent = `/ ${Math.max(0, Math.round(reserve))}`;
    weaponName.textContent = name ?? '';
    ammoPanel.classList.toggle('empty', mag <= 0);
    reloadLine.classList.toggle('on', reloadLeft > 0);
  }

  function setAlive(ct, t) {
    aliveCt.textContent = String(ct);
    aliveT.textContent = String(t);
  }

  function setBomb(info) {
    const visible = Boolean(info && (info.planted || info.dropped));
    bombStatus.classList.toggle('hidden', !visible);
    if (!visible) {
      bombStatus.classList.remove('urgent', 'planted');
      return;
    }
    bombStatus.classList.add('planted');
    const site = info.site ? ` — SITE ${info.site}` : '';
    bombTitle.textContent = info.dropped ? 'CHARGE DROPPED' : `CHARGE PLANTED${site}`;
    bombTimer.textContent = formatBombClock(info.timer ?? 0);
    const defuse = clamp(info.defuse ?? 0, 0, 1);
    bombDefuseFill.style.width = `${defuse * 100}%`;
    bombStatus.classList.toggle('urgent', Boolean(info.planted && info.timer <= 10));
  }

  function setCrosshairSpread(px) {
    crosshair.style.setProperty('--gap', `${clamp(px, 3, 32).toFixed(1)}px`);
  }

  function setInteract(label, progress = 0) {
    const visible = Boolean(label);
    interact.classList.toggle('hidden', !visible);
    if (!visible) return;
    interactLabel.textContent = label;
    interactFill.style.width = `${clamp(progress, 0, 1) * 100}%`;
  }

  function setScope(on) {
    scope.classList.toggle('on', Boolean(on));
    document.body.classList.toggle('scoped', Boolean(on));
  }

  function setSpectate(text) {
    const visible = Boolean(text);
    spectate.classList.toggle('hidden', !visible);
    if (visible) spectate.textContent = text;
  }

  function hitMarker(killed, headshot) {
    window.clearTimeout(hitTimer);
    hitmarker.className = '';
    if (killed) hitmarker.classList.add('kill');
    if (headshot) hitmarker.classList.add('head');
    hitmarker.classList.add('on');
    hitTimer = window.setTimeout(() => hitmarker.classList.remove('on'), 110);
  }

  function damageFlash(strength) {
    window.clearTimeout(damageTimer);
    damageVignette.style.opacity = String(clamp(strength, 0.15, 1));
    damageTimer = window.setTimeout(() => { damageVignette.style.opacity = '0'; }, 90);
  }

  function removeFeedEntry(entry) {
    const timerId = feedTimers.get(entry);
    if (timerId) window.clearTimeout(timerId);
    feedTimers.delete(entry);
    entry.remove();
  }

  function killFeed(entry) {
    const row = element('div', 'feed-entry');
    row.append(element('span', `k team-${entry.killerTeam ?? 'ct'}`, entry.killer ?? 'World'));
    if (entry.headshot) row.append(element('span', 'hs', 'HS'));
    row.append(element('span', 'w', entry.weapon ?? ''));
    row.append(element('span', `v team-${entry.victimTeam ?? 't'}`, entry.victim ?? ''));
    killfeed.append(row);
    while (killfeed.children.length > FEED_LIMIT) removeFeedEntry(killfeed.firstElementChild);
    feedTimers.set(row, window.setTimeout(() => removeFeedEntry(row), FEED_LIFETIME));
  }

  function clearKillFeed() {
    while (killfeed.firstElementChild) removeFeedEntry(killfeed.firstElementChild);
  }

  function showBanner(title, sub, duration = 2200) {
    window.clearTimeout(bannerTimer);
    if (!title) {
      banner.classList.remove('on');
      return;
    }
    bannerTitle.textContent = title;
    bannerSub.textContent = sub ?? '';
    banner.classList.add('on');
    if (duration > 0) {
      bannerTimer = window.setTimeout(() => banner.classList.remove('on'), duration);
    }
  }

  function buildBuyItem(item) {
    const button = element('button', 'buy-item');
    button.type = 'button';
    button.dataset.id = item.id;
    button.dataset.price = String(item.price ?? 0);
    button.append(element('span', 'num', item.key ?? ''));
    button.append(element('span', 'nm', item.name ?? item.id));
    button.append(element('span', 'pr', `$${item.price ?? 0}`));
    const note = item.note ?? item.role ?? '';
    button.append(element('span', 'nt', note));
    button.addEventListener('click', () => {
      if (button.classList.contains('locked')) return;
      buyHandler?.(item.id);
    });
    return button;
  }

  function showBuy(open, items, money, onBuy) {
    buy.classList.toggle('hidden', !open);
    if (!open) {
      buyList.replaceChildren();
      buyItems = [];
      buyHandler = null;
      return;
    }
    buyHandler = onBuy;
    if (Array.isArray(items)) {
      buyItems = items;
      buyList.replaceChildren(...items.map(buildBuyItem));
    }
    buyMoney.textContent = `$${Math.max(0, Math.round(money ?? 0))}`;
  }

  function refreshBuy(money, ownedSet, armor, hasKit) {
    buyMoney.textContent = `$${Math.max(0, Math.round(money ?? 0))}`;
    for (const button of buyList.querySelectorAll('.buy-item')) {
      const id = button.dataset.id;
      const price = Number(button.dataset.price) || 0;
      const owned = Boolean(
        ownedSet?.has?.(id)
        || (id === 'armor' && armor >= 100)
        || (id === 'kit' && hasKit),
      );
      const locked = !owned && price > money;
      button.classList.toggle('owned', owned);
      button.classList.toggle('locked', locked);
      button.disabled = locked;
      const priceNode = button.querySelector('.pr');
      if (priceNode) priceNode.textContent = owned ? 'OWNED' : `$${price}`;
    }
  }

  function buildBoardTeam(team, rows) {
    const label = team === 'ct' ? 'WARDENS' : 'CINDERS';
    const section = element('div', `board-team ${team}`);
    section.append(element('h3', '', label));

    const table = element('table');
    const head = element('tr');
    for (const [text, align] of [['OPERATOR', 'left'], ['K', 'right'], ['D', 'right'], ['$', 'right'], ['LOADOUT', 'right']]) {
      const th = element('th', '', text);
      if (align === 'left') th.style.textAlign = 'left';
      head.append(th);
    }
    const thead = element('thead');
    thead.append(head);
    table.append(thead);

    const tbody = element('tbody');
    const sorted = [...rows].sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));
    for (const row of sorted) {
      const tr = element('tr');
      if (row.player) tr.classList.add('me');
      if (!row.alive) tr.classList.add('dead');
      const name = element('td');
      name.append(element('span', '', row.name));
      if (!row.alive) name.append(element('span', 'state', '  DEAD'));
      tr.append(name);
      tr.append(element('td', '', String(row.kills)));
      tr.append(element('td', '', String(row.deaths)));
      tr.append(element('td', '', `$${row.money}`));
      tr.append(element('td', '', row.weapon ?? ''));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  function showScoreboard(open, data) {
    scoreboard.classList.toggle('hidden', !open || !data);
    if (!open || !data) return;
    const signature = JSON.stringify(data);
    if (signature === boardSignature) return;
    boardSignature = signature;

    scoreboard.replaceChildren();
    const head = element('div', 'board-head');
    head.append(element('h2', '', `ROUND ${data.round ?? '—'}`));
    const score = element('div', 'board-score');
    score.append(element('span', 'ct', String(data.scores?.ct ?? 0)));
    score.append(document.createTextNode(' — '));
    score.append(element('span', 't', String(data.scores?.t ?? 0)));
    head.append(score);
    scoreboard.append(head);
    scoreboard.append(buildBoardTeam('ct', data.ct ?? []));
    scoreboard.append(buildBoardTeam('t', data.t ?? []));
  }

  function showOverlay(mode, data = {}) {
    if (mode === 'start' || mode === 'menu') {
      overlayKicker.textContent = 'A ROUND-BASED TACTICAL FPS';
      overlayTitle.textContent = 'Tidebreak';
      overlayCopy.textContent = 'Five Wardens hold the foundry. Five Cinders want to plant a charge in one of two sites. First squad to seven rounds takes the match.';
      playButton.textContent = 'Enter the foundry';
    } else if (mode === 'paused') {
      overlayKicker.textContent = 'ROUND PAUSED';
      overlayTitle.textContent = 'Hold position';
      overlayCopy.textContent = 'Pointer lock was released. Click below to resume — the round clock is frozen while you are away.';
      playButton.textContent = 'Resume round';
    } else if (mode === 'end') {
      const victory = Boolean(data.victory);
      overlayKicker.textContent = 'MATCH COMPLETE';
      overlayTitle.textContent = victory ? 'Victory' : 'Defeat';
      const ct = data.scores?.ct ?? 0;
      const t = data.scores?.t ?? 0;
      const kills = data.player?.kills ?? 0;
      const deaths = data.player?.deaths ?? 0;
      overlayCopy.textContent = `${victory ? 'Wardens' : 'Cinders'} take the match ${victory ? ct : t}–${victory ? t : ct}. You finished with ${kills} kills and ${deaths} deaths.`;
      playButton.textContent = 'Play again';
    } else {
      overlayKicker.textContent = 'TIDEBREAK';
      overlayTitle.textContent = 'Tidebreak';
      overlayCopy.textContent = '';
      playButton.textContent = 'Continue';
    }
    overlay.dataset.mode = mode;
    root?.classList.add('overlay-open');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => playButton.focus({ preventScroll: true }));
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    root?.classList.remove('overlay-open');
    if (document.activeElement === playButton) playButton.blur();
  }

  function onPlay(handler) {
    playHandler = handler;
  }

  playButton.addEventListener('click', () => {
    playHandler?.();
  });

  setBomb(null);
  setInteract(null, 0);
  setScope(false);
  setCrosshairSpread(6);

  return {
    setMap,
    setScores,
    setRound,
    setPhase,
    setTimer,
    setMoney,
    setVitals,
    setAmmo,
    setAlive,
    setBomb,
    setCrosshairSpread,
    setInteract,
    setScope,
    setSpectate,
    hitMarker,
    damageFlash,
    killFeed,
    clearKillFeed,
    banner: showBanner,
    showBuy,
    refreshBuy,
    showScoreboard,
    showOverlay,
    hideOverlay,
    drawMinimap,
    onPlay,
  };
}
