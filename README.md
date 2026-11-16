# BREACHLINE — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/noniairox/breachline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/noniairox/breachline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the style Counter-Strike made famous — built on three.js, running offline from static files. VANGUARD attacks Site A; HAVOC defends it. First to 5 rounds takes the match.

## The game

- **Two teams, rounds, bots.** You plus two VANGUARD bots against four HAVOC bots. Rounds end by elimination, by the bomb exploding, by a defuse, or by the clock.
- **Objective.** Carry the bomb to Site A and hold E to plant (3 s). The 35 s fuse ticks down; defenders hold E to defuse (5 s).
- **Money and a buy menu.** Kills pay $300, plants $300, round wins $3250. Between rounds press B: VK-47 rifle ($2700), LM-90 marksman ($4750, right-click scope), Spark frag grenade ($300), Kevlar vest ($650).
- **Gunplay where accuracy counts.** Hitscan against bodies, headshots deal 4x damage, recoil and spread punish firing on the move — stopping to aim pays. Crouch, jump, and collide with the map.
- **Bots that play.** They follow routes through the lanes, hold positions, react to what they see and hear, fire in bursts after a reaction delay, plant when they carry the bomb, and defuse when it is planted.
- **The map.** Foundry Yard, 40 x 30 m: Lane A with a long sightline to Site A, crate-covered Lane B, a container-blocked Mid, and a cross corridor linking them.
- **Sound.** Every effect is synthesized with WebAudio — no audio files.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

WASD move, mouse look, click fire, R reload, B buy menu, 1–4 buy, G grenade, E plant/defuse (hold), Ctrl crouch, Space jump, M mute.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `game/` — the playable game as static ES modules (`index.html` + `src/`, three.js 0.187.0 under `game/vendor/three/`).
- `game/src/` — one module per job: `world` (map + waypoints), `physics` (shared mover), `player`, `weapons`, `bots`, `bomb`, `rounds`, `sound`, `hud`, `input`, `main` (boot + loop).
- `screenshots/` — four real renders of the game's own code.

Built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty. Referral: https://make.fun/r/pgd6qh00
