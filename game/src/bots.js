// The opponents and the allies: six bots on a waypoint graph, each with one job at a
// time — move along a route, hold a position, engage a visible enemy, plant the bomb,
// or defuse it. They see with a raycast, hear gunshots, react after a delay, and fire
// in bursts with spread that grows with distance and target speed, so stopping to aim
// pays for them too. main.js resolves every shot; this module decides where to go and
// when to pull the trigger.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './physics.js';
import { VANGUARD_SPAWN, HAVOC_SPAWN } from './world.js';

const BOT_SPEED = 3.9;
const BOT_HEALTH = 100;
const BOT_REACTION_MIN = 0.4;
const BOT_REACTION_MAX = 0.8;
const BOT_BURST_MIN = 3;
const BOT_BURST_MAX = 5;
const BOT_BURST_GAP = 0.13;
const BOT_PAUSE_MIN = 0.55;
const BOT_PAUSE_MAX = 1.0;
const BOT_VIEW_DISTANCE = 60;
const BOT_ACQUIRE_HOLD = 24; // how far a holding bot notices an enemy
const BOT_ACQUIRE_MOVE = 12; // how far a moving bot notices one (it keeps its route)
const BOT_VIEW_DOT = 0.25; // ~150 degree vision cone
const HEAR_RADIUS = 25;
const BOT_DAMAGE = 34; // rifle torso
const HEAD_CHANCE = 0.1;

const ALLY_NAMES = ['Vex', 'Nova'];
const ENEMY_NAMES = ['Rook', 'Fang', 'Ghost', 'Blitz'];

// Hold spots per team: [waypoint index, hold seconds]. Defenders hold the site and
// the lane mouths; attackers push a lane, then the site.
const DEFEND_SPOTS = [12, 8, 6, 10];
const ATTACK_LANES = [
  [5, 8, 11, 12],
  [3, 6, 9, 10, 12],
  [4, 7, 10, 12],
];

function makeNameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

function buildBotMesh(team, name) {
  const color = team === 'vanguard' ? PALETTE.vanguard : PALETTE.havoc;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skinMat);
  head.position.y = 1.55;
  head.userData.part = 'head';
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.34), bodyMat);
  band.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.2), darkMat);
  legL.position.set(-0.14, 0.25, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.2), darkMat);
  legR.position.set(0.14, 0.25, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.3, 1.05, -0.2);
  const tag = makeNameSprite(name, color);
  tag.position.y = 1.95;
  group.add(torso, head, band, legL, legR, gun, tag);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head, tag };
}

export function createBots(scene, world, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = BOT_VIEW_DISTANCE;
  const losOrigin = new THREE.Vector3();
  const losDir = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const bots = [];
  const hitMeshes = [];

  function spawnBot(team, name, spawn, index) {
    const body = createBody(world.colliders, spawn[0], spawn[1], 0.34, 1.72);
    const mesh = buildBotMesh(team, name);
    scene.add(mesh.group);
    const bot = {
      team,
      name,
      index,
      body,
      mesh,
      health: BOT_HEALTH,
      armor: false,
      alive: true,
      state: 'move', // move | hold | engage | plant | defuse
      path: [],
      pathIndex: 0,
      holdUntil: 0,
      holdSpot: -1,
      target: null, // { kind: 'player' | 'bot', ref, pos: Vector3 }
      targetLostAt: 0,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      pauseUntil: 0,
      channel: null, // { kind: 'plant' | 'defuse', until, total }
      lastHearTime: 0,
      yaw: team === 'vanguard' ? 0 : Math.PI, // vanguard faces north (-z), havoc south (+z)
      strafePhase: Math.random() * 6.28,
      deadAt: 0,
      kills: 0,
      lane: ATTACK_LANES[index % ATTACK_LANES.length],
      hasBomb: false,
    };
    mesh.torso.userData.bot = bot;
    mesh.head.userData.bot = bot;
    hitMeshes.push(mesh.torso, mesh.head);
    bots.push(bot);
    return bot;
  }

  // One shared eye position helper (no allocation).
  const eye = new THREE.Vector3();
  function eyeOf(bot) {
    eye.set(bot.body.position.x, bot.body.position.y + 1.55, bot.body.position.z);
    return eye;
  }

  function hasLineOfSight(fromBot, targetPos) {
    losOrigin.copy(eyeOf(fromBot));
    losDir.copy(targetPos).sub(losOrigin);
    const distance = losDir.length();
    if (distance > BOT_VIEW_DISTANCE) return false;
    losDir.normalize();
    raycaster.set(losOrigin, losDir);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  function scanForTarget(bot, ctx) {
    // Nearest visible enemy: the player, then enemy bots. A bot on the move only
    // notices close enemies (it keeps its route); a holding bot scans further.
    const acquireRange = bot.state === 'move' ? BOT_ACQUIRE_MOVE : BOT_ACQUIRE_HOLD;
    let best = null;
    let bestDist = Infinity;
    if (ctx.player.alive && ctx.player.team !== bot.team) {
      aimPoint.set(ctx.player.pos.x, ctx.player.pos.y + 1.2, ctx.player.pos.z);
      const d = aimPoint.distanceTo(eyeOf(bot));
      if (d < bestDist && d < acquireRange) {
        tmpDir.copy(aimPoint).sub(eyeOf(bot)).normalize();
        const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
        if (tmpDir.dot(forward) > BOT_VIEW_DOT && hasLineOfSight(bot, aimPoint)) {
          best = { kind: 'player', ref: ctx.player, pos: aimPoint.clone() };
          bestDist = d;
        }
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      aimPoint.set(other.body.position.x, other.body.position.y + 1.2, other.body.position.z);
      const d = aimPoint.distanceTo(eyeOf(bot));
      if (d >= bestDist || d >= acquireRange) continue;
      tmpDir.copy(aimPoint).sub(eyeOf(bot)).normalize();
      const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (tmpDir.dot(forward) > BOT_VIEW_DOT && hasLineOfSight(bot, aimPoint)) {
        best = { kind: 'bot', ref: other, pos: aimPoint.clone() };
        bestDist = d;
      }
    }
    return best;
  }

  function setPath(bot, destinationWp) {
    const from = world.nearestWaypoint(bot.body.position.x, bot.body.position.z);
    bot.path = world.findPath(from, destinationWp);
    bot.pathIndex = 0;
  }

  function followPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const wp = world.waypoints[bot.path[bot.pathIndex]];
    const dx = wp.x - bot.body.position.x;
    const dz = wp.z - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const speed = BOT_SPEED;
    bot.body.move(dt, dx / dist, dz / dist, speed);
    bot.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  function startEngage(bot, target, ctx) {
    bot.state = 'engage';
    bot.target = target;
    bot.reactAt = ctx.time + BOT_REACTION_MIN + ctx.rng() * (BOT_REACTION_MAX - BOT_REACTION_MIN);
    bot.burstLeft = 0;
    bot.pauseUntil = 0;
  }

  function damage(bot, amount, isHead, killer) {
    if (!bot.alive) return false;
    let dmg = amount;
    if (bot.armor) dmg *= 0.5;
    bot.health -= dmg;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.deadAt = hooks.time();
    bot.state = 'move';
    bot.channel = null;
    bot.mesh.group.rotation.x = -Math.PI / 2;
    bot.mesh.group.position.y = -0.1;
    if (killer && typeof killer === 'object') killer.kills += 1;
    hooks.onDeath(bot, killer, isHead);
    return true;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) return;
    const now = ctx.time;

    // Hearing: enemy gunshots nearby pull a holding bot to investigate.
    for (const shot of ctx.shots) {
      if (shot.time <= bot.lastHearTime || shot.team === bot.team) continue;
      bot.lastHearTime = shot.time;
      const dx = shot.pos.x - bot.body.position.x;
      const dz = shot.pos.z - bot.body.position.z;
      if (dx * dx + dz * dz > HEAR_RADIUS * HEAR_RADIUS) continue;
      if (bot.state === 'hold' || bot.state === 'move') {
        setPath(bot, world.nearestWaypoint(shot.pos.x, shot.pos.z));
        bot.state = 'move';
        bot.holdUntil = now + 3;
      }
    }

    // Bomb duties override combat when the carrier is safe.
    if (bot.hasBomb && bot.team === 'vanguard') {
      const siteDist = Math.hypot(world.site.x - bot.body.position.x, world.site.z - bot.body.position.z);
      if (bot.state !== 'plant' && siteDist < world.site.radius) {
        const visible = scanForTarget(bot, ctx);
        if (!visible) {
          bot.state = 'plant';
          bot.channel = { kind: 'plant', until: now + 3, total: 3 };
          hooks.onPlantStart(bot);
        }
      }
    }
    if (ctx.bomb.state === 'planted' && bot.team === 'havoc' && bot.state !== 'defuse') {
      const bombDist = Math.hypot(ctx.bomb.pos.x - bot.body.position.x, ctx.bomb.pos.z - bot.body.position.z);
      if (bombDist < 1.6) {
        const visible = scanForTarget(bot, ctx);
        if (!visible) {
          bot.state = 'defuse';
          bot.channel = { kind: 'defuse', until: now + 5, total: 5 };
          hooks.onDefuseStart(bot);
        }
      }
    }

    // Channel progress (plant / defuse): standing still, interrupted by damage.
    if (bot.channel) {
      if (now >= bot.channel.until) {
        const kind = bot.channel.kind;
        bot.channel = null;
        if (kind === 'plant') hooks.onPlanted(bot);
        else hooks.onDefused(bot);
        bot.state = 'hold';
        bot.holdUntil = now + 2;
      } else {
        // Face the bomb/site while channelling.
        return;
      }
    }

    // Acquire or keep a target — only while the round is live.
    let target = bot.target;
    if (ctx.phase !== 'live') {
      bot.target = null;
      target = null;
    }
    if (target) {
      const alive = target.kind === 'player' ? ctx.player.alive : target.ref.alive;
      if (!alive) target = null;
      else {
        aimPoint.set(
          target.kind === 'player' ? ctx.player.pos.x : target.ref.body.position.x,
          (target.kind === 'player' ? ctx.player.pos.y : target.ref.body.position.y) + 1.2,
          target.kind === 'player' ? ctx.player.pos.z : target.ref.body.position.z,
        );
        if (!hasLineOfSight(bot, aimPoint)) {
          if (bot.targetLostAt === 0) bot.targetLostAt = now;
          if (now - bot.targetLostAt > 1.0) target = null;
        } else {
          bot.targetLostAt = 0;
          target.pos.copy(aimPoint);
        }
      }
    }
    if (!target && ctx.phase === 'live' && bot.state !== 'plant' && bot.state !== 'defuse') {
      target = scanForTarget(bot, ctx);
      if (target) startEngage(bot, target, ctx);
    }
    bot.target = target;

    if (bot.state === 'engage' && target) {
      // Face the target. Far away, close the distance; close in, strafe and shoot.
      const tx = target.pos.x - bot.body.position.x;
      const tz = target.pos.z - bot.body.position.z;
      const targetDist = Math.hypot(tx, tz);
      bot.yaw = Math.atan2(-tx, -tz);
      if (targetDist > 14) {
        bot.body.move(dt, tx / targetDist, tz / targetDist, BOT_SPEED * 0.7);
      } else {
        bot.strafePhase += dt * 2.2;
        const strafe = Math.sin(bot.strafePhase) * 0.5;
        const px = Math.cos(bot.yaw);
        const pz = -Math.sin(bot.yaw);
        bot.body.move(dt, px * strafe, pz * strafe, BOT_SPEED * 0.35);
      }
      if (now >= bot.reactAt) {
        if (bot.burstLeft <= 0 && now >= bot.pauseUntil) {
          bot.burstLeft = BOT_BURST_MIN + Math.floor(ctx.rng() * (BOT_BURST_MAX - BOT_BURST_MIN + 1));
          bot.nextShotAt = now;
        }
        if (bot.burstLeft > 0 && now >= bot.nextShotAt) {
          bot.burstLeft -= 1;
          bot.nextShotAt = now + BOT_BURST_GAP;
          if (bot.burstLeft === 0) bot.pauseUntil = now + BOT_PAUSE_MIN + ctx.rng() * (BOT_PAUSE_MAX - BOT_PAUSE_MIN);
          // Aim at the chest with spread that grows with distance and target speed.
          const dist = Math.hypot(tx, tz);
          const targetSpeed = target.kind === 'player' ? ctx.player.speed : BOT_SPEED;
          const spread = 0.012 + dist * 0.0009 + targetSpeed * 0.002;
          const dir = new THREE.Vector3(tx, target.pos.y - (bot.body.position.y + 1.55), tz).normalize();
          dir.x += (ctx.rng() * 2 - 1) * spread;
          dir.y += (ctx.rng() * 2 - 1) * spread;
          dir.z += (ctx.rng() * 2 - 1) * spread;
          dir.normalize();
          hooks.shoot(bot, eyeOf(bot).clone(), dir, BOT_DAMAGE);
        }
      }
      return;
    }

    // Not engaging: follow the route, then hold and scan.
    if (bot.state === 'move') {
      const arrived = followPath(bot, dt);
      if (arrived) {
        bot.state = 'hold';
        bot.holdUntil = now + (bot.team === 'havoc' ? 6 : 1.5);
        // Attackers that reach the site without the bomb wait for the carrier.
        if (bot.team === 'vanguard' && !bot.hasBomb) {
          const carrier = bots.find((b) => b.alive && b.hasBomb);
          if (carrier && carrier !== bot) {
            setPath(bot, world.nearestWaypoint(carrier.body.position.x, carrier.body.position.z));
            bot.state = 'move';
          }
        }
      }
      return;
    }
    if (bot.state === 'hold') {
      // Slow scan: sweep the yaw so the bot looks alive and covers angles.
      bot.yaw += Math.sin(now * 0.7 + bot.index * 2.1) * dt * 0.35;
      if (now >= bot.holdUntil) {
        if (bot.team === 'havoc') {
          if (ctx.bomb.state === 'planted') {
            setPath(bot, world.nearestWaypoint(ctx.bomb.pos.x, ctx.bomb.pos.z));
            bot.state = 'move';
          } else {
            // Rotate between hold spots.
            bot.holdSpot = (bot.holdSpot + 1) % DEFEND_SPOTS.length;
            setPath(bot, DEFEND_SPOTS[bot.holdSpot]);
            bot.state = 'move';
          }
        } else if (bot.hasBomb) {
          setPath(bot, 12);
          bot.state = 'move';
        } else {
          // Attackers regroup toward the site via their lane.
          const next = bot.lane[bot.lane.length - 1];
          setPath(bot, next);
          bot.state = 'move';
        }
      }
    }
  }

  function resetRound(roundNumber, bombCarrier) {
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard' ? VANGUARD_SPAWN[bot.index % VANGUARD_SPAWN.length] : HAVOC_SPAWN[bot.index % HAVOC_SPAWN.length];
      bot.body.place(spawn[0], spawn[1]);
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.state = 'move';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.channel = null;
      bot.hasBomb = bot === bombCarrier;
      bot.armor = roundNumber >= 2;
      bot.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
      bot.mesh.group.rotation.set(0, 0, 0);
      bot.mesh.group.position.y = 0;
      bot.mesh.group.visible = true;
      bot.holdSpot = -1;
      if (bot.team === 'havoc') {
        bot.holdSpot = bot.index % DEFEND_SPOTS.length;
        setPath(bot, DEFEND_SPOTS[bot.holdSpot]);
      } else {
        const lane = bot.lane;
        setPath(bot, lane[0]);
      }
    }
  }

  function step(dt, ctx) {
    for (const bot of bots) stepBot(bot, dt, ctx);
    // Sync meshes to bodies.
    for (const bot of bots) {
      bot.mesh.group.position.x = bot.body.position.x;
      bot.mesh.group.position.z = bot.body.position.z;
      if (bot.alive) {
        bot.mesh.group.position.y = bot.body.position.y;
        bot.mesh.group.rotation.y = bot.yaw;
      }
    }
  }

  // Spawn: 2 allies (VANGUARD) + 4 enemies (HAVOC).
  const allies = ALLY_NAMES.map((name, i) => spawnBot('vanguard', name, VANGUARD_SPAWN[i + 1], i));
  const enemies = ENEMY_NAMES.map((name, i) => spawnBot('havoc', name, HAVOC_SPAWN[i], i));

  return {
    bots,
    allies,
    enemies,
    hitMeshes,
    step,
    resetRound,
    damage,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
