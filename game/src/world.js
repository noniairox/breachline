// The map: FOUNDRY YARD, a 40 x 30 m industrial yard built from boxes. Every box is a
// collider for bodies and a surface a bullet stops on. Plain geometry only, no models
// and no textures; the palette and the lighting carry the look.
//
// Layout (x east, z south; VANGUARD spawns south, HAVOC north):
//   Lane A  east,  x  8..16, a long sightline down to Site A in the north-east corner.
//   Lane B  west,  x -16..-8, short hops between crates.
//   Mid     x -4..4, a container stack blocks the straight view; a cross corridor at
//           z = 0 links the lanes.
//   Site A  north-east, centre (14, -10), a hazard-painted floor zone.
// Waypoints form the graph bots navigate: BFS over neighbours, no allocation per step.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes: [x, z]. Neighbours are listed by index.
const WAYPOINTS = [
  [0, 12.5], // 0  vanguard spawn
  [-6, 11], // 1  vanguard west
  [6, 11], // 2  vanguard east
  [-12, 6], // 3  lane B south
  [0, 6], // 4  mid south
  [12, 6], // 5  lane A south
  [-12, 0], // 6  lane B mid
  [0, 0], // 7  mid cross
  [12, 0], // 8  lane A mid
  [-12, -6], // 9  lane B north
  [0, -6], // 10 mid north
  [12, -6], // 11 lane A north
  [14, -10], // 12 site A
  [0, -12.5], // 13 havoc spawn
  [-6, -11], // 14 havoc west
  [6, -11], // 15 havoc east
];
const EDGES = [
  [1, 2, 3, 4, 5],
  [0, 3, 4],
  [0, 4, 5],
  [1, 6, 4],
  [0, 1, 2, 3, 5, 7],
  [2, 4, 8],
  [3, 7, 9],
  [4, 6, 8, 10],
  [5, 7, 11],
  [6, 10, 14],
  [7, 9, 11, 13],
  [8, 10, 12],
  [11, 15],
  [10, 14, 15],
  [9, 13],
  [11, 12, 13],
];

export const SITE_A = { x: 14, z: -10, radius: 4.2 };
export const VANGUARD_SPAWN = [
  [0, 12.5],
  [-3, 12.5],
  [3, 12.5],
];
export const HAVOC_SPAWN = [
  [0, -12.5],
  [-3, -12.5],
  [3, -12.5],
  [-6, -11],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Site floor glows faintly so the objective reads at a glance.
  const siteMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.hazard),
    roughness: 0.8,
    metalness: 0.05,
    emissive: new THREE.Color(PALETTE.hazard),
    emissiveIntensity: 0.25,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and outer walls: 40 x 30 m, 4.6 m walls, open to the sky.
  box(40.4, 0.4, 30.4, 0, -0.2, 0, 'canvas');
  box(0.4, 4.6, 30.4, -20.2, 2.3, 0, 'concrete');
  box(0.4, 4.6, 30.4, 20.2, 2.3, 0, 'concrete');
  box(40.4, 4.6, 0.4, 0, 2.3, -15.2, 'concrete');
  box(40.4, 4.6, 0.4, 0, 2.3, 15.2, 'concrete');

  // Site A floor marker (no collision, just paint).
  const siteFloor = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.06, 7.4), siteMaterial);
  siteFloor.position.set(SITE_A.x, 0.03, SITE_A.z);
  siteFloor.receiveShadow = true;
  group.add(siteFloor);

  // Mid container stack: blocks the straight view down the middle.
  box(3.2, 2.4, 2.2, -1.2, 1.2, 0.5, 'container');
  box(2.2, 2.4, 2.2, 1.8, 1.2, -0.6, 'rust');
  box(2.2, 1.1, 2.2, 1.8, 2.95, -0.6, 'container');
  // Mid south / north crates (crouch cover).
  box(1.6, 1.1, 1.6, -3.4, 0.55, 6.4, 'crate');
  box(1.6, 1.1, 1.6, 3.6, 0.55, 6.2, 'crate');
  box(1.6, 1.1, 1.6, -3.2, 0.55, -6.4, 'crate');
  box(1.6, 1.1, 1.6, 3.4, 0.55, -6.2, 'crate');
  // Mid pillars flanking the cross corridor.
  box(1.0, 3.4, 1.0, -6.4, 1.7, 0, 'concrete');
  box(1.0, 3.4, 1.0, 6.4, 1.7, 0, 'concrete');

  // Lane A (east): long sightline, crates stepping down the lane, a container at the site mouth.
  box(1.6, 1.1, 1.6, 12.4, 0.55, 9.4, 'crate');
  box(1.6, 0.7, 1.6, 9.6, 0.35, 3.2, 'crate');
  box(3.2, 2.4, 1.6, 15.2, 1.2, 3.0, 'container');
  box(1.6, 1.1, 1.6, 9.8, 0.55, -3.4, 'crate');
  box(1.2, 3.2, 1.2, 16.4, 1.6, -6.4, 'concrete');
  box(2.4, 2.4, 1.6, 10.2, 1.2, -9.6, 'rust');
  box(1.6, 1.1, 1.6, 17.2, 0.55, -12.2, 'crate');

  // Lane B (west): tight crates, a container wall, a pillar at the north end.
  box(1.6, 1.1, 1.6, -12.2, 0.55, 9.6, 'crate');
  box(3.2, 2.4, 1.6, -15.4, 1.2, 3.4, 'container');
  box(1.6, 0.7, 1.6, -9.8, 0.35, 2.6, 'crate');
  box(1.6, 1.1, 1.6, -12.4, 0.55, -3.2, 'crate');
  box(1.2, 3.2, 1.2, -16.2, 1.6, -6.6, 'concrete');
  box(2.4, 1.1, 1.6, -10.4, 0.55, -9.8, 'crate');
  box(1.6, 1.1, 1.6, -17.4, 0.55, -12.4, 'crate');

  // Spawn cover: low crates in front of each spawn so rounds start behind cover.
  box(2.4, 0.9, 1.2, -4.0, 0.45, 9.6, 'crate');
  box(2.4, 0.9, 1.2, 4.0, 0.45, 9.6, 'crate');
  box(2.4, 0.9, 1.2, -4.0, 0.45, -9.6, 'crate');
  box(2.4, 0.9, 1.2, 4.0, 0.45, -9.6, 'crate');

  // Light: a warm key from the south-east, a cool fill from the north-west, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.4);
  key.position.set(12, 16, 10);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.55);
  fill.position.set(-10, 9, -12);
  scene.add(fill);

  // Waypoint graph (BFS, precomputed adjacency) + helpers.
  const waypoints = WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const dx = waypoints[i].x - x;
      const dz = waypoints[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }
  // BFS path from waypoint a to waypoint b; returns an array of waypoint indices
  // (excluding the start). Reuses a scratch queue; allocates only the result.
  const bfsPrev = new Int16Array(waypoints.length);
  const bfsQueue = new Int16Array(waypoints.length);
  function findPath(a, b) {
    if (a === b) return [];
    bfsPrev.fill(-1);
    let head = 0;
    let tail = 0;
    bfsQueue[tail] = a;
    tail += 1;
    bfsPrev[a] = a;
    while (head < tail) {
      const node = bfsQueue[head];
      head += 1;
      for (const next of EDGES[node]) {
        if (bfsPrev[next] !== -1) continue;
        bfsPrev[next] = node;
        if (next === b) {
          const path = [];
          let cursor = next;
          while (cursor !== a) {
            path.unshift(cursor);
            cursor = bfsPrev[cursor];
          }
          return path;
        }
        bfsQueue[tail] = next;
        tail += 1;
      }
    }
    return [];
  }

  return {
    colliders,
    shootables,
    group,
    waypoints,
    nearestWaypoint,
    findPath,
    site: SITE_A,
  };
}
