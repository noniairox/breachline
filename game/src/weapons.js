// The armoury: three hitscan guns and a frag grenade. Each definition owns its
// numbers (damage, fire rate, spread, magazine, price); the view model is built from
// boxes in the palette. main.js owns the ray and the damage; this module owns the
// feel: kick, muzzle flash, reload dip, and the spread that punishes firing on the move.
// Headshots deal 4x torso damage. Kevlar halves incoming damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const HEADSHOT_MULTIPLIER = 4;
export const ARMOR_REDUCTION = 0.5;

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'P9 Sidearm',
    price: 0,
    damage: 26,
    magSize: 12,
    reserve: 36,
    fireGap: 0.16,
    reloadTime: 1.3,
    spreadStill: 0.003,
    spreadMoving: 0.02,
    auto: false,
    kick: 0.035,
    range: 60,
    blurb: 'Reliable sidearm. Free, fast, honest.',
  },
  rifle: {
    id: 'rifle',
    name: 'VK-47 Vandal',
    price: 2700,
    damage: 34,
    magSize: 30,
    reserve: 90,
    fireGap: 0.096,
    reloadTime: 1.9,
    spreadStill: 0.0022,
    spreadMoving: 0.028,
    auto: true,
    kick: 0.055,
    range: 80,
    blurb: 'Workhorse rifle. Full-auto, stops to aim.',
  },
  marksman: {
    id: 'marksman',
    name: 'LM-90 Longshot',
    price: 4750,
    damage: 88,
    magSize: 5,
    reserve: 15,
    fireGap: 0.9,
    reloadTime: 2.6,
    spreadStill: 0.0006,
    spreadMoving: 0.05,
    auto: false,
    kick: 0.12,
    range: 120,
    blurb: 'One shot, one down. Scope with right-click.',
  },
};

export const GRENADE = {
  id: 'grenade',
  name: 'Spark Frag',
  price: 300,
  fuse: 1.6,
  radius: 6.5,
  damageCenter: 100,
  damageEdge: 20,
  blurb: 'Cooks 1.6 s, then clears a corner.',
};

export const ARMOR = { id: 'armor', name: 'Kevlar Vest', price: 650, blurb: 'Halves damage taken this round.' };

const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.2;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.26), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.07), grip);
    handle.position.set(0, -0.08, 0.08);
    model.add(slide, handle);
  } else if (def.id === 'marksman') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.5), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.55), grip);
    barrel.position.set(0, 0.03, -0.5);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.18), accent);
    scope.position.set(0, 0.09, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.26), grip);
    stock.position.set(0, -0.02, 0.34);
    model.add(receiver, barrel, scope, stock);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
    sight.position.set(0, 0.07, -0.1);
    model.add(receiver, barrel, stock, sight);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeapon(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let def = WEAPONS.pistol;
  let model = buildViewModel(def);
  camera.add(model);
  const state = {
    weaponId: 'pistol',
    mag: def.magSize,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
    scoped: false,
  };

  function equip(id) {
    if (!WEAPONS[id] || id === state.weaponId) return false;
    camera.remove(model);
    def = WEAPONS[id];
    model = buildViewModel(def);
    camera.add(model);
    state.weaponId = id;
    state.mag = def.magSize;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.scoped = false;
    return true;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    model.visible = !state.scoped || def.id !== 'marksman';
  }

  return {
    state,
    get def() {
      return def;
    },
    step,
    equip,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = def.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
    },
    spread(speed) {
      const still = state.scoped ? def.spreadStill * 0.4 : def.spreadStill;
      return still + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMoving;
    },
    refill() {
      state.mag = def.magSize;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    addGrenade() {
      state.grenades += 1;
    },
  };
}
