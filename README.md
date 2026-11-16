# tidebreak-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/genstacknex-debug/tidebreak-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/genstacknex-debug/tidebreak-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS that runs entirely in the browser. Five Wardens (CT) defend the Tidebreak Foundry from five Cinders (T), who try to plant a charge at one of two sites. First squad to seven rounds wins.

Built with three.js from the vendored `game/vendor/three` copy, plain ES modules, procedural canvas textures and synthesized WebAudio. No build step, network requests or asset downloads.

## Run

```sh
node serve.ts
```

Then open <http://localhost:8080>. Use Node 22+, which can run the TypeScript static server directly.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look / fire |
| Right mouse | Scope (Mantis .50) |
| `R` | Reload |
| `B` | Buy menu |
| `1` / `2` | Primary / sidearm |
| Mouse wheel | Cycle weapon |
| `Shift` | Walk |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| `E` (hold) | Defuse the charge |
| `Tab` (hold) | Scoreboard |
| `Esc` | Release pointer lock / pause |

Purchases during the buy phase use `1`–`6` in the armoury.

## Rules

- **Buy phase (13s):** spend money and set a loadout. Round movement is frozen.
- **Live round (105s):** eliminate the enemy squad or complete the objective.
- **Charge:** Cinders carry it. Planting takes 3.1s; the 40s fuse then runs. Defusing takes 6.4s, or 4.0s with a kit.
- **Economy:** start with $800. Kills pay $300; round wins pay $3000; losses pay $1500 plus $500 per consecutive loss. Armour costs $650, a defuse kit $400.
- **Weapons:** Kestrel P9 pistol, Viper SMG, Longbow AR, Mantis .50 scoped sniper.
- **Bots:** five per side (the player is the fifth Warden) with LOS/FOV awareness, cover, pathfinding, objective roles, burst fire, strafing, reaction time and aim error.
- **HUD:** scores, round clock, team alive counts, money, health/armour/kit, ammo, kill feed, bomb state, buy menu, scoreboard, minimap and start/pause/match-end overlays.

## Shot setup

`shots.json` drives reproducible screenshots:

- `?shot=start&seed=1` — menu over the foundry
- `?shot=buy&seed=1` — buy phase and armoury
- `?shot=play&seed=1` — planted charge, live combat HUD
- `?shot=end&seed=1` — victory overlay and final score

The page renders two frames and sets `window.__shotReady = true`.

## Structure

- `game/index.html` — DOM shell, HUD styling, import map.
- `game/src/main.js` — boot, fixed 60Hz loop, pointer lock, shot mode.
- `game/src/game.js` — round state, economy, combat, bomb objective, HUD snapshots.
- `game/src/world.js` — foundry geometry, collision, nav graph, cover, sites, LOS.
- `game/src/player.js` — first-person movement, crouch/jump, collision, recoil.
- `game/src/bots.js` — bot avatars and tactical AI.
- `game/src/weapon.js` — weapon data, ammo/reload, spread/damage, viewmodel.
- `game/src/hud.js` — DOM HUD, buy menu, scoreboard and minimap rendering.
- `game/src/effects.js` — tracers, impacts, blood, bomb prop and explosion.
- `game/src/audio.js` — procedural WebAudio effects.
- `game/src/input.js` — pointer lock, keyboard/mouse state and one-shot keys.
- `game/src/palette.js` — shared colour and team constants.

`main.ts` copies `game/` and `screenshots/` into the judge output directory and writes `dossier.json`; it is unchanged from the starter.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6ahp86hn&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
