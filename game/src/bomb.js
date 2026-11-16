// The bomb: carried by one attacker, planted at Site A with a 3 s channel, then a
// 35 s fuse. Defenders defuse with a 5 s channel at the device. A planted bomb that
// runs out explodes and ends the round for the attackers. The device is a small box
// with a blinking light; its beeps quicken as the fuse runs down.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const FUSE_SECONDS = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.5, metalness: 0.3 }),
  );
  box.castShadow = true;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.havoc) }),
  );
  light.position.set(0, 0.14, 0);
  group.add(box, light);
  group.visible = false;
  scene.add(group);

  const state = {
    mode: 'carried', // carried | dropped | planted | exploded | defused
    carrier: null, // 'player' or a bot
    pos: new THREE.Vector3(),
    fuseLeft: FUSE_SECONDS,
    beepAt: 0,
    plantedAt: 0,
  };

  return {
    state,
    group,
    reset(carrier) {
      state.mode = 'carried';
      state.carrier = carrier;
      state.fuseLeft = FUSE_SECONDS;
      state.beepAt = 0;
      group.visible = false;
    },
    dropAt(pos) {
      state.mode = 'dropped';
      state.carrier = null;
      state.pos.copy(pos);
      group.position.copy(pos);
      group.position.y = 0.12;
      group.visible = true;
    },
    plantAt(pos, time) {
      state.mode = 'planted';
      state.carrier = null;
      state.pos.copy(pos);
      state.fuseLeft = FUSE_SECONDS;
      state.plantedAt = time;
      state.beepAt = time + 1;
      group.position.copy(pos);
      group.position.y = 0.12;
      group.visible = true;
    },
    // Returns 'exploded' once, when the fuse runs out, else null. Also returns the
    // next beep time so main.js can play the sound.
    step(dt, time) {
      if (state.mode !== 'planted') return null;
      state.fuseLeft -= dt;
      light.material.color.setHex(Math.floor(time * 2) % 2 === 0 ? 0xff3020 : 0x881505);
      if (state.fuseLeft <= 0) {
        state.mode = 'exploded';
        group.visible = false;
        return 'exploded';
      }
      if (time >= state.beepAt) {
        const interval = Math.max(0.25, state.fuseLeft / FUSE_SECONDS);
        state.beepAt = time + interval;
        return 'beep';
      }
      return null;
    },
    progress() {
      if (state.mode !== 'planted') return 0;
      return 1 - state.fuseLeft / FUSE_SECONDS;
    },
  };
}
