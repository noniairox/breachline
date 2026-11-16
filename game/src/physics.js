// Shared movement: one axis-separated AABB mover for every body in the game (the
// player and every bot), so a wall never swallows anyone and standing on the floor is
// never read as walking into a wall. Bodies are boxes of fixed radius and height.
import * as THREE from 'three';

export const GRAVITY = 20;

export function createBody(colliders, x, z, radius = 0.34, height = 1.72) {
  const position = new THREE.Vector3(x, 0, z);
  const velocity = new THREE.Vector3();
  const probe = new THREE.Box3();
  let onGround = true;

  // lift keeps the feet and the crown out of the horizontal tests.
  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + h - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  return {
    position,
    velocity,
    radius,
    height,
    get onGround() {
      return onGround;
    },
    // Move by a wish direction (unit XZ vector, or zero) at a speed for dt seconds.
    // Returns true when the body is blocked horizontally (it hit a wall).
    move(dt, wishX, wishZ, speed) {
      const nextX = position.x + wishX * speed * dt;
      if (!overlaps(nextX, position.y, position.z, height, 0.04)) position.x = nextX;
      const nextZ = position.z + wishZ * speed * dt;
      if (!overlaps(position.x, position.y, nextZ, height, 0.04)) position.z = nextZ;
      return true;
    },
    // Full step with velocity, gravity and jumping (player use). wish is a unit XZ
    // vector; accel/friction shape the feel; jumpSpeed > 0 lets the body jump.
    step(dt, wishX, wishZ, speed, accel, friction, jumpSpeed) {
      velocity.x += (wishX * speed - velocity.x) * Math.min(1, (accel * dt) / speed);
      velocity.z += (wishZ * speed - velocity.z) * Math.min(1, (accel * dt) / speed);
      if (onGround && wishX === 0 && wishZ === 0) {
        const damp = Math.max(0, 1 - friction * dt);
        velocity.x *= damp;
        velocity.z *= damp;
      }
      if (jumpSpeed > 0 && onGround) {
        velocity.y = jumpSpeed;
        onGround = false;
      }
      velocity.y -= GRAVITY * dt;
      const nextX = position.x + velocity.x * dt;
      if (!overlaps(nextX, position.y, position.z, height, 0.04)) position.x = nextX;
      else velocity.x = 0;
      const nextZ = position.z + velocity.z * dt;
      if (!overlaps(position.x, position.y, nextZ, height, 0.04)) position.z = nextZ;
      else velocity.z = 0;
      position.y += velocity.y * dt;
      onGround = false;
      const hit = overlaps(position.x, position.y, position.z, height, 0);
      if (hit && velocity.y <= 0) {
        position.y = hit.max.y;
        velocity.y = 0;
        onGround = true;
      } else if (hit) {
        position.y = hit.min.y - height;
        velocity.y = 0;
      }
      if (position.y < 0) {
        position.y = 0;
        velocity.y = 0;
        onGround = true;
      }
      velocity.y = Math.max(-30, velocity.y);
    },
    // Teleport without collision (spawns, round resets).
    place(x, z) {
      position.set(x, 0, z);
      velocity.set(0, 0, 0);
      onGround = true;
    },
    overlapsAt(x, z, h = height, lift = 0.04) {
      return overlaps(x, position.y, z, h, lift);
    },
  };
}
