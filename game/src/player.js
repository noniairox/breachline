// Player movement: acceleration, friction, gravity, crouch and jump, on the shared
// physics body, so the player and the bots collide with the world the same way.
// main.js reads the wish direction from the keys; this module owns the feel.
import * as THREE from 'three';
import { createBody } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders) {
  const body = createBody(colliders, 0, 12.5, 0.34, STAND_HEIGHT);
  const player = {
    position: body.position,
    velocity: body.velocity,
    yaw: 0, // faces north (-z), toward Site A
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: false,
    alive: true,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!crouching && player.crouching && !body.overlapsAt(player.position.x, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const len = Math.hypot(-sin * forward + cos * strafe, -cos * forward - sin * strafe) || 1;
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = body.onGround ? GROUND_ACCEL : AIR_ACCEL;
    body.step(dt, wishX, wishZ, speed, accel, FRICTION, keys.has('Space') && body.onGround ? JUMP_SPEED : 0);
  }

  function place(x, z, yaw) {
    body.place(x, z);
    player.yaw = yaw;
    player.pitch = 0;
    player.eye = STAND_EYE;
    player.crouching = false;
    player.height = STAND_HEIGHT;
    player.health = 100;
    player.alive = true;
  }

  return {
    state: player,
    body,
    step,
    look,
    recoil,
    place,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    get onGround() {
      return body.onGround;
    },
  };
}
