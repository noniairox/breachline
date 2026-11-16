// BREACHLINE: boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate. This module owns the shooting (one raycast path for the player and
// every bot), grenades, the bomb channels, the buy menu, round transitions and the
// deterministic ?shot= captures. The bots, the rounds and the bomb each own their own
// state; this module only wires them together.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, VANGUARD_SPAWN } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE, ARMOR, HEADSHOT_MULTIPLIER, ARMOR_REDUCTION } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, FUSE_SECONDS } from './bomb.js';
import { createRounds, BUY_SECONDS, ROUND_END_SECONDS, KILL_REWARD, PLANT_REWARD } from './rounds.js';
import { createSound } from './sound.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 80);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const sound = createSound();
const rounds = createRounds();
const bomb = createBomb(scene);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// The player's hitbox: an invisible box the bots' raycasts can hit. It is not in
// world.shootables, so it never blocks the player's own shots.
const playerHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(0.68, 1.72, 0.68),
  new THREE.MeshBasicMaterial({ visible: false }),
);
playerHitbox.userData.player = true;
scene.add(playerHitbox);

// Tracer pool: 8 reusable lines, each shown for 60 ms after a shot.
const tracers = [];
for (let i = 0; i < 8; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.7 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, until: 0 });
}
let tracerIndex = 0;
function showTracer(from, to, time) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const positions = tracer.line.geometry.attributes.position.array;
  positions[0] = from.x;
  positions[1] = from.y;
  positions[2] = from.z;
  positions[3] = to.x;
  positions[4] = to.y;
  positions[5] = to.z;
  tracer.line.geometry.attributes.position.needsUpdate = true;
  tracer.line.visible = true;
  tracer.until = time + 0.06;
}

// Grenades in flight: small spheres with velocity, gravity, one bounce, a 1.6 s fuse.
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.4, metalness: 0.4 });

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let spectateBot = null;
let playerChannel = null; // { kind: 'plant' | 'defuse', until, total }
let buyOpen = false;
const hearShots = []; // { pos: Vector3, team, time } — bots consume these to investigate

const bots = createBots(scene, world, {
  time: () => elapsed,
  shoot(shooter, origin, direction, damage) {
    resolveShot(origin, direction, shooter, damage);
    hearShots.push({ pos: origin.clone(), team: shooter.team, time: elapsed });
    const dist = origin.distanceTo(body.position);
    if (dist < 30) sound.distantShot();
  },
  onDeath(bot, killer, isHead) {
    const killerName = killer && killer.name ? killer.name : killer === 'player' ? 'You' : '???';
    hud.addKill(killerName, bot.name, killer === 'player' ? weapon.def.name : 'VK-47 Vandal', isHead);
    if (bot.hasBomb) {
      // The bomb passes to the nearest living ally, or drops where the carrier fell.
      bot.hasBomb = false;
      const next = bots.allies.find((b) => b.alive);
      if (next) {
        next.hasBomb = true;
        bomb.state.carrier = next;
        hud.setBomb('Bomb carried by ' + next.name, false);
      } else {
        bomb.dropAt(bot.body.position);
        hud.setBomb('Bomb dropped — pick it up', true);
      }
    }
  },
  onPlantStart(bot) {
    hud.setBomb(bot.name + ' is planting…', true);
  },
  onPlanted(bot) {
    bomb.plantAt(bot.body.position, elapsed);
    rounds.state.plants += 1;
    hud.setBomb('BOMB PLANTED — defuse it or run', true);
    sound.plantBeep();
  },
  onDefuseStart(bot) {
    hud.setBomb(bot.name + ' is defusing…', true);
  },
  onDefused(bot) {
    bomb.state.mode = 'defused';
    endRound('havoc', 'Bomb defused by ' + bot.name);
  },
});

const shootTargets = world.shootables.concat(bots.hitMeshes, [playerHitbox]);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

function damagePlayer(amount, isHead, killer) {
  if (!body.alive) return;
  let dmg = amount;
  if (body.armor) dmg *= ARMOR_REDUCTION;
  body.health -= dmg;
  sound.hurt();
  hud.setHealth(body.health, body.armor);
  if (body.health > 0) return;
  body.alive = false;
  rounds.state.deaths += 1;
  if (document.pointerLockElement) document.exitPointerLock();
  // The bomb passes to an ally, or drops.
  if (bomb.state.carrier === 'player') {
    const next = bots.allies.find((b) => b.alive);
    if (next) {
      next.hasBomb = true;
      bomb.state.carrier = next;
      hud.setBomb('Bomb carried by ' + next.name, false);
    } else {
      bomb.dropAt(body.position);
    }
  }
  const killerName = killer && killer.name ? killer.name : 'HAVOC';
  hud.addKill(killerName, 'You', 'VK-47 Vandal', isHead);
  hud.showBanner('YOU ARE DOWN', 'Spectating your team — the round plays on', 4000);
  spectateBot = bots.allies.find((b) => b.alive) || bots.enemies.find((b) => b.alive) || null;
}

// One raycast path for every shot in the game. Returns the hit kind, or null.
function resolveShot(origin, dir, shooter, damage) {
  scene.updateMatrixWorld(true);
  raycaster.set(origin, dir);
  const hit = raycaster.intersectObjects(shootTargets, false)[0];
  if (!hit) {
    showTracer(origin, origin.clone().addScaledVector(dir, 60), elapsed);
    return null;
  }
  showTracer(origin, hit.point, elapsed);
  const obj = hit.object;
  if (obj.userData.bot) {
    const bot = obj.userData.bot;
    const isHead = obj.userData.part === 'head';
    const killed = bots.damage(bot, damage * (isHead ? HEADSHOT_MULTIPLIER : 1), isHead, shooter === 'player' ? 'player' : shooter);
    if (shooter === 'player') {
      hud.hitMarker(killed, markerHoldMs);
      if (killed) {
        rounds.state.kills += 1;
        rounds.state.money += KILL_REWARD;
        hud.setMoney(rounds.state.money);
        sound.kill();
      } else sound.hit();
    }
    return 'bot';
  }
  if (obj.userData.player && shooter !== 'player') {
    const isHead = hit.point.y > body.position.y + 1.45;
    damagePlayer(damage * (isHead ? HEADSHOT_MULTIPLIER : 1), isHead, shooter);
    return 'player';
  }
  return 'world';
}

function playerShoot() {
  const def = weapon.def;
  if (!weapon.takeRound()) {
    sound.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  const spread = shot ? 0 : weapon.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  resolveShot(muzzle, direction, 'player', def.damage);
  hearShots.push({ pos: muzzle.clone(), team: 'vanguard', time: elapsed });
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  sound.shot(def.id);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function throwGrenade() {
  if (weapon.state.grenades <= 0) return;
  weapon.state.grenades -= 1;
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  const pos = camera.position.clone();
  const vel = new THREE.Vector3();
  camera.getWorldDirection(vel);
  vel.multiplyScalar(14);
  vel.y += 4.5;
  mesh.position.copy(pos);
  scene.add(mesh);
  grenades.push({ mesh, pos, vel, fuse: GRENADE.fuse, bounced: false });
  sound.grenadeThrow();
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  const center = g.pos;
  // Damage falls off with distance; both teams and the player take it.
  const victims = [];
  if (body.alive) victims.push({ pos: body.position, isPlayer: true });
  for (const bot of bots.bots) if (bot.alive) victims.push({ pos: bot.body.position, bot });
  for (const v of victims) {
    const d = Math.hypot(v.pos.x - center.x, v.pos.z - center.z) + Math.abs((v.pos.y + 1) - center.y) * 0.5;
    if (d > GRENADE.radius) continue;
    const dmg = GRENADE.damageCenter + ((GRENADE.damageEdge - GRENADE.damageCenter) * d) / GRENADE.radius;
    if (v.isPlayer) damagePlayer(dmg, false, null);
    else bots.damage(v.bot, dmg, false, 'player');
  }
  sound.explosion();
  // Flash light at the blast.
  const flash = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 12);
  flash.position.copy(center);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 150);
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.vel.y -= 20 * dt;
    g.pos.addScaledVector(g.vel, dt);
    g.mesh.position.copy(g.pos);
    // Bounce off the floor and the world's boxes (simple AABB probe).
    let bounced = false;
    if (g.pos.y < 0.09) {
      g.pos.y = 0.09;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      bounced = true;
    }
    if (!bounced) {
      for (const box of world.colliders) {
        if (g.pos.x > box.min.x - 0.09 && g.pos.x < box.max.x + 0.09 && g.pos.y > box.min.y - 0.09 && g.pos.y < box.max.y + 0.09 && g.pos.z > box.min.z - 0.09 && g.pos.z < box.max.z + 0.09) {
          g.vel.multiplyScalar(-0.4);
          g.vel.y = Math.abs(g.vel.y) + 1;
          break;
        }
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
}

function buy(itemId) {
  const r = rounds.state;
  if (r.phase !== 'buy') return;
  if (itemId === 'rifle' || itemId === 'marksman') {
    const def = WEAPONS[itemId];
    if (r.money < def.price) return;
    if (weapon.state.weaponId === itemId) return;
    r.money -= def.price;
    weapon.equip(itemId);
    hud.setWeapon(def.name);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setMoney(r.money);
    sound.buy();
  } else if (itemId === 'grenade') {
    if (r.money < GRENADE.price || weapon.state.grenades >= 2) return;
    r.money -= GRENADE.price;
    weapon.addGrenade();
    hud.setMoney(r.money);
    sound.buy();
  } else if (itemId === 'armor') {
    if (r.money < ARMOR.price || body.armor) return;
    r.money -= ARMOR.price;
    body.armor = true;
    hud.setHealth(body.health, true);
    hud.setMoney(r.money);
    sound.buy();
  }
}

function resetRound() {
  const r = rounds.state;
  player.place(VANGUARD_SPAWN[0][0], VANGUARD_SPAWN[0][1], 0);
  body.armor = false;
  weapon.equip('pistol');
  hud.setWeapon(weapon.def.name);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setHealth(body.health, false);
  hud.setMoney(r.money);
  hud.setScore(r.scoreVanguard, r.scoreHavoc, r.round);
  bomb.reset('player');
  bots.resetRound(r.round, null);
  spectateBot = null;
  playerChannel = null;
  hud.setBomb(r.round === 1 ? 'You carry the bomb — plant it at Site A' : 'You carry the bomb — plant it at Site A', false);
  hud.setChannel(null, 0);
  hud.setHint('');
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
}

function startMatch() {
  rounds.resetMatch();
  resetRound();
  hud.setScore(0, 0, 1);
  hud.showBanner('ROUND 1', 'Buy phase — press B to open the shop', 3000);
  buyOpen = true;
  hud.showBuy(true);
}

function endRound(winner, reason) {
  if (!rounds.endRound(winner, reason)) return;
  const r = rounds.state;
  hud.hideBanner();
  hud.showBuy(false);
  buyOpen = false;
  playerChannel = null;
  hud.setChannel(null, 0);
  hud.setScore(r.scoreVanguard, r.scoreHavoc, r.round);
  hud.setMoney(r.money);
  if (winner === 'vanguard') {
    hud.showBanner('ROUND WON', reason, ROUND_END_SECONDS * 1000);
    sound.roundWin();
  } else {
    hud.showBanner('ROUND LOST', reason, ROUND_END_SECONDS * 1000);
    sound.roundLose();
  }
}

function step(dt) {
  elapsed += dt;
  const r = rounds.state;
  rounds.step(dt);

  // Phase transitions.
  if (r.phase === 'buy' && r.timer <= 0) {
    rounds.beginLive();
    hud.showBuy(false);
    buyOpen = false;
    hud.showBanner(`ROUND ${r.round}`, 'Go — plant the bomb at Site A', 2200);
    sound.roundStart();
  } else if (r.phase === 'live') {
    if (r.timer <= 0) endRound('havoc', 'Time expired — Site A held');
  } else if (r.phase === 'end' && r.timer <= 0) {
    if (r.matchWinner) {
      r.phase = 'matchEnd';
      const detail = r.matchWinner === 'draw'
        ? `A ${r.scoreVanguard}–${r.scoreHavoc} draw. Kills ${r.kills}, deaths ${r.deaths}, plants ${r.plants}.`
        : `${r.matchWinner === 'vanguard' ? 'VANGUARD' : 'HAVOC'} takes the match ${r.scoreVanguard}–${r.scoreHavoc}. Your kills ${r.kills}, deaths ${r.deaths}, plants ${r.plants}.`;
      hud.showOverlay('matchEnd', detail);
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      rounds.nextRound();
      resetRound();
      hud.showBanner(`ROUND ${r.round}`, 'Buy phase — press B to open the shop', 3000);
      buyOpen = true;
      hud.showBuy(true);
    }
  }

  if (r.phase === 'live' || r.phase === 'buy') {
    player.step(dt, input.state.keys);
    weapon.step(dt);
    // Bomb fuse.
    const bombEvent = bomb.step(dt, elapsed);
    if (bombEvent === 'exploded') {
      endRound('vanguard', 'Site A destroyed');
    } else if (bombEvent === 'beep') {
      sound.bombBeep();
    }
    // Bots.
    bots.step(dt, {
      time: elapsed,
      rng: random,
      phase: r.phase,
      player: { alive: body.alive, team: 'vanguard', pos: body.position, speed: player.groundSpeed() },
      bomb: bomb.state,
      shots: hearShots,
    });
    // Trim old gunshot sounds.
    while (hearShots.length > 0 && hearShots[0].time < elapsed - 2) hearShots.shift();
    stepGrenades(dt);

    // Elimination checks.
    if (r.phase === 'live') {
      if (bots.aliveCount('havoc') === 0) endRound('vanguard', 'HAVOC eliminated');
      else if (bots.aliveCount('vanguard') === 0 && !body.alive) endRound('havoc', 'VANGUARD eliminated');
    }

    // Player plant/defuse channel (hold E).
    const inSite = Math.hypot(world.site.x - body.position.x, world.site.z - body.position.z) < world.site.radius;
    const nearBomb = bomb.state.mode === 'planted' && Math.hypot(bomb.state.pos.x - body.position.x, bomb.state.pos.z - body.position.z) < 1.6;
    if (body.alive && r.phase === 'live' && input.state.keys.has('KeyE')) {
      if (!playerChannel && bomb.state.carrier === 'player' && inSite) {
        playerChannel = { kind: 'plant', until: elapsed + 3, total: 3 };
        sound.plantBeep();
      } else if (!playerChannel && nearBomb) {
        playerChannel = { kind: 'defuse', until: elapsed + 5, total: 5 };
        sound.plantBeep();
      }
      if (playerChannel) {
        const progress = 1 - (playerChannel.until - elapsed) / playerChannel.total;
        hud.setChannel(playerChannel.kind === 'plant' ? 'Planting the bomb…' : 'Defusing the bomb…', Math.min(1, Math.max(0, progress)));
        if (elapsed >= playerChannel.until) {
          if (playerChannel.kind === 'plant') {
            bomb.plantAt(body.position, elapsed);
            rounds.state.plants += 1;
            rounds.state.money += PLANT_REWARD;
            hud.setMoney(rounds.state.money);
            hud.setBomb('BOMB PLANTED — defend it', true);
            sound.plantBeep();
          } else {
            bomb.state.mode = 'defused';
            endRound('vanguard', 'Bomb defused by You');
          }
          playerChannel = null;
          hud.setChannel(null, 0);
        }
      }
    } else if (playerChannel) {
      playerChannel = null;
      hud.setChannel(null, 0);
    }

    // Bomb pickup when dropped.
    if (bomb.state.mode === 'dropped' && body.alive) {
      const d = Math.hypot(bomb.state.pos.x - body.position.x, bomb.state.pos.z - body.position.z);
      if (d < 1.2) {
        bomb.state.mode = 'carried';
        bomb.state.carrier = 'player';
        bomb.group.visible = false;
        hud.setBomb('You carry the bomb — plant it at Site A', false);
      }
    }

    // Hints.
    if (r.phase === 'live' && body.alive) {
      if (bomb.state.carrier === 'player' && inSite) hud.setHint('Hold E to plant the bomb');
      else if (nearBomb) hud.setHint('Hold E to defuse the bomb');
      else if (bomb.state.mode === 'planted') hud.setHint('Bomb planted — defend Site A');
      else hud.setHint('');
    } else hud.setHint('');
  }

  // Player hitbox follows the body (bots shoot at it).
  playerHitbox.position.set(body.position.x, body.position.y + 0.86, body.position.z);
  // Tracers fade.
  for (const t of tracers) if (t.line.visible && elapsed >= t.until) t.line.visible = false;
}

function syncCamera() {
  if (!body.alive && spectateBot) {
    const b = spectateBot.body.position;
    camera.position.set(b.x, b.y + 1.55, b.z);
    camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function onLockChange(locked) {
  if (shot) return;
  sound.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (rounds.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'matchEnd') {
    startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});
hud.onBuy((itemId) => buy(itemId));

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const scopeFactor = input.state.scoped && weapon.state.weaponId === 'marksman' ? 0.35 : 1;
    player.look(look.x * scopeFactor, look.y * scopeFactor);
    weapon.state.scoped = input.state.scoped && weapon.state.weaponId === 'marksman';
    camera.fov += ((weapon.state.scoped ? 30 : 74) - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    const pressed = input.takePressed();
    if (pressed.has('KeyB') && rounds.state.phase === 'buy') {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen);
    }
    if (pressed.has('KeyM')) sound.toggleMute();
    if (pressed.has('KeyG')) throwGrenade();
    if (pressed.has('Digit1')) buy('rifle');
    if (pressed.has('Digit2')) buy('marksman');
    if (pressed.has('Digit3')) buy('grenade');
    if (pressed.has('Digit4')) buy('armor');
    if (pressed.has('KeyR')) weapon.reload();
    if (body.alive && (rounds.state.phase === 'live' || rounds.state.phase === 'buy') && input.state.firing && weapon.ready()) {
      playerShoot();
      if (!weapon.def.auto) input.state.firing = false;
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // HUD refresh (cheap setters skip unchanged values).
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setTimer(rounds.state.timer, rounds.state.phase);
    hud.setSpread(weapon.spread(player.groundSpeed()) * 900);
    hud.setRoster(
      [{ name: 'You', alive: body.alive, hp: body.health }, ...bots.allies.map((b) => ({ name: b.name, alive: b.alive, hp: b.health }))],
      bots.enemies.map((b) => ({ name: b.name, alive: b.alive, hp: b.health })),
    );
    if (bomb.state.mode === 'planted') {
      hud.setBomb(`BOMB PLANTED — ${Math.ceil(bomb.state.fuseLeft)}s`, true);
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  startMatch();
  if (name === 'start') {
    body.position.set(0, 0, 12.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(30);
    aimAt(new THREE.Vector3(2, 1.4, -10));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    body.position.set(0, 0, 12.5);
    body.yaw = 0;
    settle(30);
    aimAt(new THREE.Vector3(-2, 1.4, 0));
    hud.showBuy(true);
  } else if (name === 'play') {
    rounds.beginLive();
    hud.showBuy(false);
    buyOpen = false;
    weapon.equip('rifle');
    hud.setWeapon(weapon.def.name);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    // Stage a firefight down Lane A: two enemies visible, one already down.
    const e0 = bots.enemies[0];
    const e1 = bots.enemies[1];
    e0.body.place(12, -4);
    e0.yaw = Math.PI;
    e1.body.place(10, 2);
    e1.yaw = Math.PI;
    const e2 = bots.enemies[2];
    bots.damage(e2, 500, false, 'player');
    e2.body.place(13, -8);
    e2.mesh.group.position.set(13, -0.1, -8);
    body.position.set(11, 0, 9.5);
    settle(10);
    aimAt(new THREE.Vector3(e0.body.position.x, 1.3, e0.body.position.z));
    playerShoot();
    settle(6);
    aimAt(new THREE.Vector3(e1.body.position.x, 1.3, e1.body.position.z));
    playerShoot();
    settle(4);
    hud.setMoney(rounds.state.money);
  } else if (name === 'end') {
    rounds.state.scoreVanguard = 5;
    rounds.state.scoreHavoc = 2;
    rounds.state.kills = 14;
    rounds.state.deaths = 6;
    rounds.state.plants = 2;
    rounds.state.matchWinner = 'vanguard';
    rounds.state.phase = 'matchEnd';
    hud.showOverlay('matchEnd', 'VANGUARD takes the match 5–2. Your kills 14, deaths 6, plants 2.');
    body.position.set(14, 0, -8);
    body.yaw = -0.6;
    settle(20);
  }
  hud.setScore(rounds.state.scoreVanguard, rounds.state.scoreHavoc, rounds.state.round);
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(rounds.state.money);
  hud.setHealth(body.health, body.armor);
  hud.setRoster(
    [{ name: 'You', alive: body.alive, hp: body.health }, ...bots.allies.map((b) => ({ name: b.name, alive: b.alive, hp: b.health }))],
    bots.enemies.map((b) => ({ name: b.name, alive: b.alive, hp: b.health })),
  );
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startMatch();
syncCamera();
// Debug handle for play-testing and the finalist review: read-only game state.
window.__game = {
  player: body,
  rounds: rounds.state,
  weapon: weapon.state,
  bomb: bomb.state,
  bots: bots.bots,
  version: 'breachline-1.0',
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
