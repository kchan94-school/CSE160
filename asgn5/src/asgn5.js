import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// -------------------- Config --------------------
const ASSETS = {
  textures: {
    floor: "./assets/textures/floor.jpg",
    wall: "./assets/textures/wall.jpg",
  },
  skybox: "./assets/skybox/", // expects px nx py ny pz nz with .jpg
  model: "./assets/models/trophy.glb",
};

const GAME = {
  orbCount: 10,
  arenaHalfSize: 22,
  wallHeight: 5,
};

// Mouse Sensititvity
const PLAYER = {
  mouseSensitivity: 0.85, // 1.0 = default-ish feel, lower = less sensitive
};

const PICKUP_RANGE = 6.0;
const hudOrbs = document.getElementById("orbs");
const hudOrbsTotal = document.getElementById("orbsTotal");
const hudTime = document.getElementById("time");
const hudHealth = document.getElementById("health");
const healthFill = document.getElementById("healthFill");
const MAX_HEALTH = 3;
const centerMessage = document.getElementById("centerMessage");

hudOrbsTotal.textContent = String(GAME.orbCount);

// -------------------- Loading manager --------------------
const manager = new THREE.LoadingManager();
manager.onStart = () => console.log("Loading assets...");
manager.onLoad = () => console.log("All assets loaded.");
manager.onError = (url) => console.warn("Missing asset:", url);

// -------------------- Scene / camera / renderer --------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const crosshair = document.getElementById("crosshair");
const hurtFlash = document.getElementById("hurtFlash");
const radarArrow = document.getElementById("radarArrow");
const radarState = document.getElementById("radarState");
const radarRing = document.getElementById("radarRing");
const chaseFlash = document.getElementById("chaseFlash");
const radarDistanceRing = document.getElementById("radarDistanceRing");
const orbFill = document.getElementById("orbFill");
const pushPrompt = document.getElementById("pushPrompt");
const helpPanel = document.getElementById("helpPanel");

// -------------------- Custom pointer-lock FPS look --------------------
const player = new THREE.Object3D();
const pitchObject = new THREE.Object3D();

player.position.set(0, 1.8, 14);
scene.add(player);

player.add(pitchObject);
pitchObject.add(camera);

const controls = {
  isLocked: false,
  getObject: () => player,
};

let yaw = 0;
let pitch = 0;

function tryLockPointer() {
  if (gameOver) return;
  if (!controls.isLocked) {
    renderer.domElement.requestPointerLock();
  }
}

renderer.domElement.addEventListener("click", tryLockPointer);
centerMessage.addEventListener("click", tryLockPointer);

document.addEventListener("pointerlockchange", () => {
  controls.isLocked = (document.pointerLockElement === renderer.domElement);

  if (controls.isLocked) {
    centerMessage.classList.add("hidden");
    if (helpPanel) helpPanel.classList.add("hidden");
  } else if (!gameOver) {
    centerMessage.classList.remove("hidden");
  }
});

document.addEventListener("mousemove", (e) => {
  if (!controls.isLocked || gameOver) return;

  // Clamp wild spikes from pointer lock.
  const maxDelta = 80;
  const dx = THREE.MathUtils.clamp(e.movementX, -maxDelta, maxDelta);
  const dy = THREE.MathUtils.clamp(e.movementY, -maxDelta, maxDelta);

  const lookSpeed = 0.0022 * PLAYER.mouseSensitivity;

  yaw -= dx * lookSpeed;
  pitch -= dy * lookSpeed;

  const pitchLimit = Math.PI / 2 - 0.05;
  pitch = THREE.MathUtils.clamp(pitch, -pitchLimit, pitchLimit);

  player.rotation.y = yaw;
  pitchObject.rotation.x = pitch;
});

// -------------------- Lights --------------------
// 1) Ambient
scene.add(new THREE.AmbientLight(0xffffff, 0.22));

// 2) Hemisphere
const hemi = new THREE.HemisphereLight(0x88aaff, 0x2d2012, 0.8);
scene.add(hemi);

// 3) Directional
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(12, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -35;
dirLight.shadow.camera.right = 35;
dirLight.shadow.camera.top = 35;
dirLight.shadow.camera.bottom = -35;
scene.add(dirLight);

// 4) Central point light
const altarLight = new THREE.PointLight(0xffd27a, 1.8, 60);
altarLight.position.set(0, 5.5, 0);
altarLight.castShadow = true;
scene.add(altarLight);

// 5) Flashlight spot light
const flashlight = new THREE.SpotLight(
  0xffffff,
  0.0,
  42,
  Math.PI / 8,
  0.35,
  1.0
);
flashlight.castShadow = true;
camera.add(flashlight);
camera.add(flashlight.target);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -1);

let flashlightOn = false;

// -------------------- Skybox --------------------
(function setupSkybox() {
  const loader = new THREE.CubeTextureLoader(manager);
  loader.setPath(ASSETS.skybox);

  loader.load(
    // ["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"],
    (cubeTex) => {
      scene.background = cubeTex;
    },
    undefined,
    () => {
      scene.background = new THREE.Color(0x0b1022);
      console.warn("Skybox not found. Using fallback background.");
    }
  );
  loader.load(
    // ["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"],
    ["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"],
    (cubeTex) => {
      scene.background = cubeTex;
    },
    undefined,
    () => {
      scene.background = new THREE.Color(0x0b1022);
      console.warn("Skybox not found. Using fallback background.");
    }
  );
})();

// -------------------- Textures --------------------

const textureLoader = new THREE.TextureLoader(manager);

// Start with fallback-color materials.
// If textures load successfully, we assign the maps later.
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x39495c,
  roughness: 0.9,
});

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x666666,
  roughness: 0.85,
});

textureLoader.load(
  ASSETS.textures.floor,
  (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    floorMaterial.map = t;
    floorMaterial.needsUpdate = true;
  },
  undefined,
  () => console.warn("Floor texture missing; using color fallback.")
);

textureLoader.load(
  ASSETS.textures.wall,
  (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    wallMaterial.map = t;
    wallMaterial.needsUpdate = true;
  },
  undefined,
  () => console.warn("Wall texture missing; using color fallback.")
);

// -------------------- Helpers --------------------

function computeDroneAvoidance(desiredDir) {
  const avoidance = new THREE.Vector3();

  if (desiredDir.lengthSq() < 0.0001) return avoidance;

  const dir = desiredDir.clone().normalize();
  const left = new THREE.Vector3(-dir.z, 0, dir.x);
  const right = new THREE.Vector3(dir.z, 0, -dir.x);

  const origin = drone.position.clone();
  origin.y = drone.position.y;

  const feelerLen = 2.6;

  const rayForward = new THREE.Raycaster(origin, dir, 0, feelerLen);
  const rayLeft = new THREE.Raycaster(
    origin,
    dir.clone().addScaledVector(left, 0.55).normalize(),
    0,
    feelerLen
  );
  const rayRight = new THREE.Raycaster(
    origin,
    dir.clone().addScaledVector(right, 0.55).normalize(),
    0,
    feelerLen
  );

  const blockerMeshes = droneBlockerBoxes.map((c) => c.mesh);

  const hitForward = rayForward.intersectObjects(blockerMeshes, false);
  const hitLeft = rayLeft.intersectObjects(blockerMeshes, false);
  const hitRight = rayRight.intersectObjects(blockerMeshes, false);

  const forwardBlocked = hitForward.length > 0;
  const leftBlocked = hitLeft.length > 0;
  const rightBlocked = hitRight.length > 0;

  if (!forwardBlocked && !leftBlocked && !rightBlocked) {
    return avoidance;
  }

  if (forwardBlocked) {
    const leftDist = leftBlocked ? hitLeft[0].distance : feelerLen + 1;
    const rightDist = rightBlocked ? hitRight[0].distance : feelerLen + 1;

    if (leftDist > rightDist) {
      avoidance.add(left.multiplyScalar(1.9));
    } else {
      avoidance.add(right.multiplyScalar(1.9));
    }

    avoidance.addScaledVector(dir, -1.25);
  } else {
    if (leftBlocked) avoidance.add(right.multiplyScalar(1.2));
    if (rightBlocked) avoidance.add(left.multiplyScalar(1.2));
  }

  return avoidance;
}

const droneRadius = 0.65;
const droneHalfHeight = 0.55;

function resolveDroneCollisions(nextPos) {
  const droneMinY = nextPos.y - droneHalfHeight;
  const droneMaxY = nextPos.y + droneHalfHeight;

  for (const { box: cBox } of droneBlockerBoxes) {
    const overlapY = droneMaxY > cBox.min.y && droneMinY < cBox.max.y;
    if (!overlapY) continue;

    const closestX = THREE.MathUtils.clamp(nextPos.x, cBox.min.x, cBox.max.x);
    const closestZ = THREE.MathUtils.clamp(nextPos.z, cBox.min.z, cBox.max.z);

    const dx = nextPos.x - closestX;
    const dz = nextPos.z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq >= droneRadius * droneRadius) continue;

    if (distSq < 0.000001) {
      const left = Math.abs(nextPos.x - cBox.min.x);
      const right = Math.abs(cBox.max.x - nextPos.x);
      const front = Math.abs(nextPos.z - cBox.min.z);
      const back = Math.abs(cBox.max.z - nextPos.z);

      const minPen = Math.min(left, right, front, back);

      if (minPen === left) nextPos.x = cBox.min.x - droneRadius;
      else if (minPen === right) nextPos.x = cBox.max.x + droneRadius;
      else if (minPen === front) nextPos.z = cBox.min.z - droneRadius;
      else nextPos.z = cBox.max.z + droneRadius;
    } else {
      const dist = Math.sqrt(distSq);
      const pushX = dx / dist;
      const pushZ = dz / dist;
      const correction = droneRadius - dist;

      nextPos.x += pushX * correction;
      nextPos.z += pushZ * correction;
    }
  }
}

function getProgress01() {
  if (GAME.orbCount <= 0) return 0;
  return THREE.MathUtils.clamp(collected / GAME.orbCount, 0, 1);
}

function computeWinScore() {
  const score = Math.floor(1000 - elapsed * 12 + health * 150);
  return Math.max(0, score);
}

const colliderBoxes = [];
const droneBlockerBoxes = [];
const floorY = 0;

function addCollider(mesh, options = {}) {
  const { blocksDrone = true } = options;

  const entry = {
    mesh,
    box: new THREE.Box3().setFromObject(mesh),
  };

  colliderBoxes.push(entry);

  if (blocksDrone) {
    droneBlockerBoxes.push(entry);
  }
}

function refreshCollider(entry) {
  entry.box.setFromObject(entry.mesh);
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function isDronePushable(playerPos) {
  if (droneState.pushCooldown > 0 || gameOver || !controls.isLocked) return false;

  const toDrone = new THREE.Vector3().subVectors(drone.position, playerPos);
  const distance = toDrone.length();
  if (distance > 3.6) return false;

  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  viewDir.y = 0;

  if (viewDir.lengthSq() < 0.0001) return false;
  viewDir.normalize();

  const flatToDrone = toDrone.clone();
  flatToDrone.y = 0;
  if (flatToDrone.lengthSq() < 0.0001) return true;

  flatToDrone.normalize();

  const facing = viewDir.dot(flatToDrone);
  return facing >= 0.70;
}

function droneHasLineOfSight(playerPos) {
  const origin = drone.position.clone();
  const target = playerPos.clone();
  target.y -= 0.9; // aim near player's center

  const dir = new THREE.Vector3().subVectors(target, origin);
  const dist = dir.length();
  if (dist < 0.001) return true;

  dir.normalize();

  const ray = new THREE.Raycaster(origin, dir, 0, dist);
  const hits = ray.intersectObjects(colliderBoxes.map((c) => c.mesh), false);

  return hits.length === 0;
}

// -------------------- Floor tiles --------------------
(function buildFloorTiles() {
  const tileSize = 4;
  const arenaSize = GAME.arenaHalfSize * 2;   // full width of arena
  const tilesPerSide = Math.ceil(arenaSize / tileSize) + 1; // enough to fully cover edges
  const geo = new THREE.BoxGeometry(tileSize, 0.5, tileSize);

  const mat = floorMaterial;

  const start = -Math.floor(tilesPerSide / 2);

  for (let ix = 0; ix < tilesPerSide; ix++) {
    for (let iz = 0; iz < tilesPerSide; iz++) {
      const x = (start + ix) * tileSize;
      const z = (start + iz) * tileSize;

      const tile = new THREE.Mesh(geo, mat);
      tile.position.set(x, floorY - 0.25, z);
      tile.receiveShadow = true;
      scene.add(tile);
    }
  }
})();

// -------------------- Arena walls --------------------
(function buildWalls() {
  const h = GAME.wallHeight;
  const s = GAME.arenaHalfSize;
  const thick = 1.2;

  const wallMat = wallMaterial;

  const longGeo = new THREE.BoxGeometry(2 * s + thick, h, thick);
  const wallN = new THREE.Mesh(longGeo, wallMat);
  wallN.position.set(0, h / 2, -s);
  wallN.castShadow = true;
  wallN.receiveShadow = true;
  scene.add(wallN);
  addCollider(wallN);

  const wallS = wallN.clone();
  wallS.position.set(0, h / 2, s);
  scene.add(wallS);
  addCollider(wallS);

  const sideGeo = new THREE.BoxGeometry(thick, h, 2 * s + thick);
  const wallE = new THREE.Mesh(sideGeo, wallMat);
  wallE.position.set(s, h / 2, 0);
  wallE.castShadow = true;
  wallE.receiveShadow = true;
  scene.add(wallE);
  addCollider(wallE);

  const wallW = wallE.clone();
  wallW.position.set(-s, h / 2, 0);
  scene.add(wallW);
  addCollider(wallW);
})();

// -------------------- Decorative pillars (cylinders) --------------------
(function buildPillars() {
  const geo = new THREE.CylinderGeometry(0.7, 0.95, 4.0, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a94a5,
    roughness: 0.72,
  });

  const positions = [
    [-10, 2.0, -10],
    [10, 2.0, -10],
    [-10, 2.0, 10],
    [10, 2.0, 10],
    [0, 2.0, -15],
    [0, 2.0, 15],
  ];

  for (const [x, y, z] of positions) {
    const p = new THREE.Mesh(geo, mat);
    p.position.set(x, y, z);
    p.castShadow = true;
    p.receiveShadow = true;
    scene.add(p);
    addCollider(p);
  }
})();

// -------------------- Altar pedestal --------------------
(function buildAltar() {
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x6d7380,
    roughness: 0.75,
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xc9a96a,
    emissive: 0x7a5b1f,
    emissiveIntensity: 0.5,
    roughness: 0.5,
    metalness: 0.2,
  });

  const base1 = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 8), baseMat);
  base1.position.set(0, 0.5, 0);
  base1.castShadow = true;
  base1.receiveShadow = true;
  scene.add(base1);
  addCollider(base1);

  const base2 = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1, 5.5), baseMat);
  base2.position.set(0, 1.5, 0);
  base2.castShadow = true;
  base2.receiveShadow = true;
  scene.add(base2);
  addCollider(base2);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.5, 2.2, 24), glowMat);
  pedestal.position.set(0, 2.6, 0);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  scene.add(pedestal);
  addCollider(pedestal);
})();

// -------------------- Stairs / platforms --------------------
(function buildStairsAndPlatforms() {
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x7c848f,
    roughness: 0.8,
  });

  function makeStep(x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), stoneMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    addCollider(m, { blocksDrone: false });
    return m;
  }

  // Front stairs to altar
  makeStep(0, 0.25, 6.6, 4.2, 0.5, 1.5);
  makeStep(0, 0.65, 5.2, 3.6, 0.8, 1.3);
  makeStep(0, 1.15, 3.95, 3.0, 1.0, 1.2);

  // Side platforms
  makeStep(-13, 1.0, 0, 4, 2, 4);
  makeStep(13, 1.0, 0, 4, 2, 4);
  makeStep(-13, 2.2, 0, 2.8, 0.4, 2.8);
  makeStep(13, 2.2, 0, 2.8, 0.4, 2.8);

  // Back platforms
  makeStep(-8, 0.8, -13, 4.5, 1.6, 4.5);
  makeStep(8, 0.8, -13, 4.5, 1.6, 4.5);
})();

// -------------------- Archway decoration --------------------
(function buildArchways() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9299a6,
    roughness: 0.7,
  });

  function post(x, y, z) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.4, 0.9), mat);
    p.position.set(x, y, z);
    p.castShadow = true;
    p.receiveShadow = true;
    scene.add(p);
    addCollider(p);
  }

  function beam(x, y, z, sx, sy, sz) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    addCollider(b);
  }

  post(-4.5, 2.2, 9);
  post(4.5, 2.2, 9);
  beam(0, 4.6, 9, 10, 0.7, 1.1);

  post(-4.5, 2.2, -9);
  post(4.5, 2.2, -9);
  beam(0, 4.6, -9, 10, 0.7, 1.1);
})();

// -------------------- Torch pedestals with point lights --------------------
(function buildTorchLights() {
  const torchGeo = new THREE.CylinderGeometry(0.2, 0.25, 2.2, 12);
  const torchMat = new THREE.MeshStandardMaterial({
    color: 0x5d5145,
    roughness: 0.9,
  });

  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffbb55,
    emissive: 0xcc6a11,
    emissiveIntensity: 1.2,
    roughness: 0.4,
  });

  const positions = [
    [-8, 1.1, 6],
    [8, 1.1, 6],
    [-8, 1.1, -6],
    [8, 1.1, -6],
  ];

  for (const [x, y, z] of positions) {
    const torch = new THREE.Mesh(torchGeo, torchMat);
    torch.position.set(x, y, z);
    torch.castShadow = true;
    torch.receiveShadow = true;
    scene.add(torch);
    addCollider(torch, { blocksDrone: false });

    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), flameMat);
    flame.position.set(x, y + 1.35, z);
    scene.add(flame);

    const light = new THREE.PointLight(0xffb45c, 1.1, 18);
    light.position.set(x, y + 1.35, z);
    light.castShadow = true;
    scene.add(light);
  }
})();

// -------------------- GLB model --------------------
let trophy = null;

(function loadModel() {
  const loader = new GLTFLoader(manager);
  loader.load(
    ASSETS.model,
    (gltf) => {
      trophy = gltf.scene;
      trophy.position.set(0, 4.40, 0);
      trophy.scale.setScalar(2.2);

      trophy.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      scene.add(trophy);
    },
    undefined,
    () => console.warn("GLB model not found yet. Add one at:", ASSETS.model)
  );
})();

// -------------------- Orbs --------------------
const orbs = [];
const orbGeo = new THREE.SphereGeometry(0.38, 18, 18);
const orbMat = new THREE.MeshStandardMaterial({
  color: 0x71ffd8,
  emissive: 0x35c79e,
  emissiveIntensity: 1.0,
  roughness: 0.3,
  metalness: 0.12,
});

(function spawnOrbs() {
  const positions = [
    [-14, 1.4, 12],
    [14, 1.4, 12],
    [-14, 1.4, -12],
    [14, 1.4, -12],
    [-13, 3, 0],
    [13, 3, 0],
    [-8, 2.5, -13],
    [8, 2.7, -13],
    [0, 5.7, 0],
    [0, 1.5, 14],
  ];

  for (let i = 0; i < GAME.orbCount; i++) {
    const o = new THREE.Mesh(orbGeo, orbMat.clone());
    const [x, y, z] = positions[i];
    o.position.set(x, y, z);
    o.userData.baseY = y;
    o.castShadow = true;
    o.receiveShadow = false;
    scene.add(o);
    orbs.push(o);
  }
})();

let collected = 0;
hudOrbs.textContent = String(collected);
updateOrbUI()

// -------------------- Hazard drone --------------------
const drone = new THREE.Mesh(
  new THREE.SphereGeometry(0.65, 20, 20),
  new THREE.MeshStandardMaterial({
    color: 0xff6666,
    emissive: 0x4a0000,
    emissiveIntensity: 0.7,
    roughness: 0.35,
  })
);
drone.position.set(0, 2.2, -6);
drone.castShadow = true;
scene.add(drone);

const droneLight = new THREE.PointLight(0xff4444, 0.8, 12);
drone.add(droneLight);

const droneState = {
  mode: "patrol",          // "patrol" | "chase" | "retreat" | "search"
  modeTimer: 0,
  graceTimer: 0,
  hurtFlashTimer: 0,
  pushCooldown: 0,
  velocity: new THREE.Vector3(),
  desiredHeight: 2.1,
  verticalVel: 0,

  anticipationTimer: 0,
  chaseFlashTimer: 0,
  lungeCooldown: 0,
  lungeTimer: 0,
  screenShakeTimer: 0,
  screenShakeStrength: 0,

  playerSeenTimer: 0,
  lastSeenPlayerPos: new THREE.Vector3(),
  hasLastSeenPos: false,
  searchTargetPos: new THREE.Vector3(),
  hasSearchTarget: false,
  searchTimer: 0,

  lastFlatDistToPlayer: Infinity,
  stuckTimer: 0,
  bypassSign: 1,
};

let playerInvulnTimer = 0;

// -------------------- Movement --------------------
const keys = new Set();
let health = 3;
hudHealth.textContent = String(health);
updateHealthUI();

const velocity = new THREE.Vector3();
let onGround = false;

const playerRadius = 0.5;
const playerHeight = 1.8;
const STEP_EPS = 0.18;
const LANDING_SNAP = 0.35;

window.addEventListener("keydown", (e) => {
  if (e.code === "Tab") {
    e.preventDefault();
    if (helpPanel) {
      helpPanel.classList.toggle("hidden");
    }
    return;
  }

  keys.add(e.code);

  if (e.code === "KeyF") {
    flashlightOn = !flashlightOn;
    flashlight.intensity = flashlightOn ? 2.7 : 0.0;
  }

  if (e.code === "KeyE" && !gameOver && controls.isLocked) {
    tryPushDrone(getPlayerPosition());
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

function getPlayerPosition() {
  return controls.getObject().position;
}

function getPlayerBox(pos) {
  return new THREE.Box3(
    new THREE.Vector3(
      pos.x - playerRadius,
      pos.y - playerHeight,
      pos.z - playerRadius
    ),
    new THREE.Vector3(
      pos.x + playerRadius,
      pos.y,
      pos.z + playerRadius
    )
  );
}

function resolveHorizontalCollisions(nextPos) {
  const s = GAME.arenaHalfSize - 1.2;
  nextPos.x = THREE.MathUtils.clamp(nextPos.x, -s, s);
  nextPos.z = THREE.MathUtils.clamp(nextPos.z, -s, s);

  let playerBox = getPlayerBox(nextPos);

  for (const { box: cBox } of colliderBoxes) {
    if (!playerBox.intersectsBox(cBox)) continue;

    const playerFeet = playerBox.min.y;
    const playerHead = playerBox.max.y;

    // If the player is clearly standing above the object, do not side-push.
    if (playerFeet >= cBox.max.y - STEP_EPS) {
      continue;
    }

    // If the player is clearly below the object, also ignore side collision.
    if (playerHead <= cBox.min.y + STEP_EPS) {
      continue;
    }

    const dx1 = cBox.max.x - playerBox.min.x;
    const dx2 = playerBox.max.x - cBox.min.x;
    const dz1 = cBox.max.z - playerBox.min.z;
    const dz2 = playerBox.max.z - cBox.min.z;

    const minPen = Math.min(dx1, dx2, dz1, dz2);

    if (minPen === dx1) nextPos.x = cBox.max.x + playerRadius;
    else if (minPen === dx2) nextPos.x = cBox.min.x - playerRadius;
    else if (minPen === dz1) nextPos.z = cBox.max.z + playerRadius;
    else nextPos.z = cBox.min.z - playerRadius;

    playerBox = getPlayerBox(nextPos);
  }
}

function resolveVerticalCollisions(prevPos, nextPos, velocity) {
  let grounded = false;
  let bestGroundY = 0; // world-space feet height
  let foundGround = false;

  const feetXMin = nextPos.x - playerRadius;
  const feetXMax = nextPos.x + playerRadius;
  const feetZMin = nextPos.z - playerRadius;
  const feetZMax = nextPos.z + playerRadius;

  const prevFeetY = prevPos.y - playerHeight;
  const nextFeetY = nextPos.y - playerHeight;
  const nextHeadY = nextPos.y;

  for (const { box: cBox } of colliderBoxes) {
    const overlapX = feetXMax > cBox.min.x && feetXMin < cBox.max.x;
    const overlapZ = feetZMax > cBox.min.z && feetZMin < cBox.max.z;

    if (!overlapX || !overlapZ) continue;

    // Landing on top of object while falling
    const topY = cBox.max.y;
    const wasAboveTop = prevFeetY >= topY - STEP_EPS;
    const fellToTop = nextFeetY <= topY + LANDING_SNAP;

    if (velocity.y <= 0 && wasAboveTop && fellToTop) {
      if (!foundGround || topY > bestGroundY) {
        bestGroundY = topY;
        foundGround = true;
      }
    }

    // Head bump from below
    const bottomY = cBox.min.y;
    const prevHeadY = prevPos.y;
    const movedIntoBottom = prevHeadY <= bottomY + STEP_EPS && nextHeadY >= bottomY;

    if (velocity.y > 0 && movedIntoBottom) {
      nextPos.y = bottomY;
      velocity.y = 0;
    }
  }

  // Ground plane
  if (nextFeetY <= 0) {
    bestGroundY = foundGround ? Math.max(bestGroundY, 0) : 0;
    foundGround = true;
  }

  if (foundGround) {
    if (nextPos.y - playerHeight <= bestGroundY + LANDING_SNAP && velocity.y <= 0) {
      nextPos.y = bestGroundY + playerHeight;
      velocity.y = 0;
      grounded = true;
    }
  }

  return grounded;
}

// -------------------- Raycast pickup --------------------
const raycaster = new THREE.Raycaster();
let currentTargetOrb = null;
const orbBaseEmissive = new THREE.Color(0x35c79e);
const orbHighlightEmissive = new THREE.Color(0xb8fff0);

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!controls.isLocked || gameOver) return;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(orbs.filter((o) => o.visible), false);

  if (hits.length > 0 && hits[0].distance <= PICKUP_RANGE) {
    collectOrb(hits[0].object);
  }
});

function collectOrb(orb) {
  if (!orb.visible) return;

  if (currentTargetOrb === orb) {
    clearOrbHighlight();
  }

  orb.visible = false;
  collected++;
  updateOrbUI();

  if (collected >= GAME.orbCount) {
    endGame(true);
  }
}

function clearOrbHighlight() {
  if (!currentTargetOrb) return;

  if (currentTargetOrb.material && currentTargetOrb.material.emissive) {
    currentTargetOrb.material.emissive.copy(orbBaseEmissive);
    currentTargetOrb.material.emissiveIntensity = 1.0;
  }

  currentTargetOrb.scale.set(1, 1, 1);
  currentTargetOrb = null;
}

function setOrbHighlight(orb) {
  if (currentTargetOrb === orb) return;

  clearOrbHighlight();
  currentTargetOrb = orb;

  if (currentTargetOrb.material && currentTargetOrb.material.emissive) {
    currentTargetOrb.material.emissive.copy(orbHighlightEmissive);
    currentTargetOrb.material.emissiveIntensity = 1.8;
  }
}


// -------------------- End game --------------------
let gameOver = false;

function endGame(win) {
  gameOver = true;
  const finalScore = win ? computeWinScore() : 0;

  crosshair.classList.remove("pushable");
  if (pushPrompt) pushPrompt.classList.remove("show");  

  droneState.screenShakeTimer = 0;
  droneState.screenShakeStrength = 0;
  droneState.chaseFlashTimer = 0;
  droneState.hurtFlashTimer = 0;

  camera.position.set(0, 0, 0);

  if (hurtFlash) hurtFlash.style.opacity = "0";
  if (chaseFlash) chaseFlash.style.opacity = "0";

  document.body.classList.remove("game-over-win", "game-over-death");
  document.body.classList.add(win ? "game-over-win" : "game-over-death");

  document.exitPointerLock();
  centerMessage.classList.remove("hidden");

  renderer.domElement.removeEventListener("click", tryLockPointer);
  centerMessage.removeEventListener("click", tryLockPointer);

  centerMessage.innerHTML = `
    <div id="centerCard">
      <div class="big">${win ? "RELICS RECOVERED ✨" : "YOU WERE HUNTED 💀"}</div>
      <div class="mid">
        ${win
          ? "The temple’s relics are safe. The altar recognizes your triumph."
          : "The drone overwhelmed you before the temple could be cleared."}
      </div>

      <div class="centerStatLine">Final Time: ${hudTime.textContent}s</div>
      <div class="centerStatLine">Orbs Collected: ${collected}/${GAME.orbCount}</div>
      ${win ? `<div class="centerStatLine">Score: ${finalScore}</div>` : ``}

      <div class="centerHint">
        ${win
          ? "You survived the patrol, recovered every orb, and earned a score based on speed and remaining health."
          : "Try using the radar, the push timing, and the drone’s retreat window to survive longer."}
      </div>

      <div class="small">Refresh the page to play again.</div>
    </div>
  `;
}
// helper

function pickSearchTarget(playerPos) {
  droneState.lastSeenPlayerPos.copy(playerPos);
  droneState.hasLastSeenPos = true;

  const toPlayer = new THREE.Vector3().subVectors(playerPos, drone.position);
  toPlayer.y = 0;

  if (toPlayer.lengthSq() < 0.0001) {
    droneState.searchTargetPos.copy(playerPos);
    droneState.hasSearchTarget = true;
    return;
  }

  toPlayer.normalize();
  const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);

  const sign = Math.random() < 0.5 ? -1 : 1;

  droneState.searchTargetPos.copy(playerPos);
  droneState.searchTargetPos.addScaledVector(side, sign * 2.4);
  droneState.searchTargetPos.x = THREE.MathUtils.clamp(droneState.searchTargetPos.x, -16, 16);
  droneState.searchTargetPos.z = THREE.MathUtils.clamp(droneState.searchTargetPos.z, -16, 16);
  droneState.hasSearchTarget = true;
}

function updateDroneVerticalTarget(playerPos, dt) {
  const progress = getProgress01();

  let targetHeight = 2.1;

  if (droneState.mode === "chase" || droneState.mode === "search") {
    const desiredPlayerTrack = playerPos.y - 0.15;
    const stuckLift = droneState.stuckTimer > 0.3 ? 0.8 : 0.0;

    targetHeight = THREE.MathUtils.clamp(
      desiredPlayerTrack + stuckLift,
      1.4,
      THREE.MathUtils.lerp(3.6, 5.2, progress)
    );
  } else if (droneState.mode === "retreat") {
    targetHeight = Math.max(2.0, drone.position.y);
  }

  droneState.desiredHeight = THREE.MathUtils.lerp(
    droneState.desiredHeight,
    targetHeight,
    1 - Math.pow(0.08, dt)
  );
}

function updateOrbUI() {
  hudOrbs.textContent = String(collected);
  if (orbFill) {
    const pct = GAME.orbCount > 0 ? collected / GAME.orbCount : 0;
    orbFill.style.width = `${pct * 100}%`;
  }
}

function updateHealthUI() {
  hudHealth.textContent = String(health);

  if (!healthFill) return;

  const pct = THREE.MathUtils.clamp(health / MAX_HEALTH, 0, 1);
  healthFill.style.width = `${pct * 100}%`;

  const healthCard = document.querySelector(".healthCard");
  if (healthCard) {
    healthCard.classList.toggle("danger", health <= 1);
  }

  if (pct > 0.66) {
    healthFill.style.filter = "brightness(1)";
  } else if (pct > 0.33) {
    healthFill.style.filter = "brightness(0.95)";
  } else {
    healthFill.style.filter = "brightness(1.15)";
  }
}

function triggerPlayerHit(playerPos) {
  if (playerInvulnTimer > 0 || gameOver) return;

  playerInvulnTimer = 1.25;
  droneState.graceTimer = 1.0;
  droneState.hurtFlashTimer = 0.5;
  droneState.chaseFlashTimer = Math.max(droneState.chaseFlashTimer, 0.35);

  health--;
  updateHealthUI();

  if (health <= 0) {
    droneState.screenShakeTimer = 0;
    droneState.screenShakeStrength = 0;
    endGame(false);
    return;
  }

  droneState.screenShakeTimer = 0.22;
  droneState.screenShakeStrength = 0.16;

  // Knock player away from drone, but resolve collisions safely.
  const awayPlayer = new THREE.Vector3().subVectors(playerPos, drone.position);
  awayPlayer.y = 0;
  if (awayPlayer.lengthSq() < 0.0001) awayPlayer.set(1, 0, 0);
  awayPlayer.normalize();

  const prevPos = playerPos.clone();
  const knockPos = playerPos.clone();
  knockPos.addScaledVector(awayPlayer, 1.15);

  // Resolve horizontal collisions so the player doesn't get shoved into walls/props.
  resolveHorizontalCollisions(knockPos);

  // Resolve vertical collisions too in case the knockback pushes onto stairs/platform edges.
  onGround = resolveVerticalCollisions(prevPos, knockPos, velocity);

  // Commit safe knockback position.
  playerPos.copy(knockPos);

  // Knock drone away too so it doesn't stick to the player
  const awayDrone = new THREE.Vector3().subVectors(drone.position, playerPos);
  awayDrone.y = 0;
  if (awayDrone.lengthSq() < 0.0001) awayDrone.set(-1, 0, 0);
  awayDrone.normalize();

  const droneKnockPos = drone.position.clone();
  droneKnockPos.addScaledVector(awayDrone, 0.9);
  resolveDroneCollisions(droneKnockPos);
  drone.position.copy(droneKnockPos);

  droneState.velocity.addScaledVector(awayDrone, 7.5);
  droneState.mode = "retreat";
  droneState.modeTimer = 1.0;
}

function tryPushDrone(playerPos) {
  if (droneState.pushCooldown > 0 || !controls.isLocked || gameOver) return;

  const toDrone = new THREE.Vector3().subVectors(drone.position, playerPos);
  const distance = toDrone.length();

  if (distance > 3.6) return;

  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  viewDir.y = 0;
  viewDir.normalize();

  const flatToDrone = toDrone.clone();
  flatToDrone.y = 0;
  if (flatToDrone.lengthSq() < 0.0001) return;
  flatToDrone.normalize();

  const facing = viewDir.dot(flatToDrone);
  if (facing < 0.70) return;

  drone.position.addScaledVector(flatToDrone, 0.35);
  droneState.velocity.addScaledVector(flatToDrone, 15.5);
  droneState.mode = "retreat";
  droneState.modeTimer = 1.1;
  droneState.graceTimer = Math.max(droneState.graceTimer, 0.6);
  droneState.pushCooldown = 0.5;
  droneState.lungeTimer = 0;
}

function enterChaseMode(duration = randBetween(1.8, 2.9)) {
  droneState.mode = "chase";
  droneState.modeTimer = duration;
  droneState.anticipationTimer = 0.45;
  droneState.chaseFlashTimer = 0.9;

  // visual/audio-style spike in intensity
  if (drone.material && drone.material.emissive) {
    drone.material.emissive.setHex(0xaa0000);
  }
  droneLight.intensity = 1.6;
}

// radar helper

function updateRadar(playerPos) {
  if (!radarArrow || !radarState || !radarRing) return;

  const toDrone = new THREE.Vector3().subVectors(drone.position, playerPos);
  toDrone.y = 0;

  const flatDist = toDrone.length();
  const distAlpha = THREE.MathUtils.clamp(1.0 - (flatDist / 14.0), 0.12, 1.0);
  const ringScale = THREE.MathUtils.lerp(1.5, 0.65, distAlpha);

  if (toDrone.lengthSq() < 0.0001) {
    radarArrow.style.opacity = "0.2";
    if (radarDistanceRing) radarDistanceRing.style.opacity = "0.15";
    return;
  }

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const targetDir = toDrone.clone().normalize();

  const forward2 = new THREE.Vector2(forward.x, forward.z);
  const target2 = new THREE.Vector2(targetDir.x, targetDir.z);

  const angle =
    Math.atan2(target2.y, target2.x) - Math.atan2(forward2.y, forward2.x);

  radarArrow.style.opacity = "1";
  radarArrow.style.transform = `rotate(${angle}rad)`;

  if (radarDistanceRing) {
    radarDistanceRing.style.opacity = String(0.35 + 0.65 * distAlpha);
    radarDistanceRing.style.transform = `scale(${ringScale})`;
  }

  if (droneState.mode === "chase") {
    radarArrow.style.borderBottomColor = "#ff6a6a";
    radarArrow.style.filter = "drop-shadow(0 0 8px rgba(255,80,80,0.95))";
    radarState.textContent = "CHASE";
    radarState.style.color = "#ff9a9a";
    radarRing.style.borderColor = "rgba(255,110,110,0.95)";
    radarRing.style.boxShadow = "0 0 16px rgba(140,0,0,0.35) inset";
    if (radarDistanceRing) {
      radarDistanceRing.style.borderColor = `rgba(255, 95, 95, ${0.25 + 0.65 * distAlpha})`;
      radarDistanceRing.style.boxShadow = `0 0 ${8 + 14 * distAlpha}px rgba(255, 60, 60, 0.45)`;
    }
  } else if (droneState.mode === "retreat") {
    radarArrow.style.borderBottomColor = "#ffd36a";
    radarArrow.style.filter = "drop-shadow(0 0 8px rgba(255,210,100,0.85))";
    radarState.textContent = "RETREAT";
    radarState.style.color = "#ffe39c";
    radarRing.style.borderColor = "rgba(255,220,130,0.95)";
    radarRing.style.boxShadow = "0 0 16px rgba(120,90,0,0.28) inset";
    if (radarDistanceRing) {
      radarDistanceRing.style.borderColor = `rgba(255, 220, 120, ${0.22 + 0.55 * distAlpha})`;
      radarDistanceRing.style.boxShadow = `0 0 ${6 + 10 * distAlpha}px rgba(255, 200, 80, 0.28)`;
    }
  } else if (droneState.mode === "search") {
  radarArrow.style.borderBottomColor = "#8ec5ff";
  radarArrow.style.filter = "drop-shadow(0 0 8px rgba(120,180,255,0.9))";
  radarState.textContent = "SEARCH";
  radarState.style.color = "#b9dbff";
  radarRing.style.borderColor = "rgba(150,200,255,0.95)";
  radarRing.style.boxShadow = "0 0 16px rgba(40,70,120,0.25) inset";
  if (radarDistanceRing) {
    radarDistanceRing.style.borderColor = `rgba(140, 200, 255, ${0.22 + 0.55 * distAlpha})`;
    radarDistanceRing.style.boxShadow = `0 0 ${6 + 10 * distAlpha}px rgba(120, 180, 255, 0.25)`;
  }
  } else {
    radarArrow.style.borderBottomColor = "#7cffd2";
    radarArrow.style.filter = "drop-shadow(0 0 8px rgba(124,255,210,0.8))";
    radarState.textContent = "PATROL";
    radarState.style.color = "#b8ffea";
    radarRing.style.borderColor = "rgba(180,255,235,0.85)";
    radarRing.style.boxShadow = "0 0 14px rgba(0,0,0,0.25) inset";
    if (radarDistanceRing) {
      radarDistanceRing.style.borderColor = `rgba(124, 255, 210, ${0.20 + 0.45 * distAlpha})`;
      radarDistanceRing.style.boxShadow = `0 0 ${5 + 8 * distAlpha}px rgba(124, 255, 210, 0.22)`;
    }
  }
}

// -------------------- Animation --------------------
const clock = new THREE.Clock();
let elapsed = 0;


function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.033);

  if (!gameOver && controls.isLocked) {
    elapsed += dt;
    hudTime.textContent = elapsed.toFixed(1);

    const speed = keys.has("ShiftLeft") ? 8.4 : 4.8;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();

    const move = new THREE.Vector3();
    if (keys.has("KeyW")) move.add(forward);
    if (keys.has("KeyS")) move.sub(forward);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);

    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

    velocity.y += -16 * dt;

    const pos = getPlayerPosition();

    // allow jump only if grounded
    if (keys.has("Space") && onGround) {
      velocity.y = 6.3;
      onGround = false;
    }

    const prevPos = pos.clone();
    const nextPos = pos.clone();

    // horizontal move first
    nextPos.add(move);
    resolveHorizontalCollisions(nextPos);

    // then vertical move
    nextPos.y += velocity.y * dt;
    onGround = resolveVerticalCollisions(prevPos, nextPos, velocity);

    pos.copy(nextPos);

    // Update targetable orb under crosshair
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const visibleOrbs = orbs.filter((o) => o.visible);
    const orbHits = raycaster.intersectObjects(visibleOrbs, false);

    const orbTargeted = (orbHits.length > 0 && orbHits[0].distance <= PICKUP_RANGE);

    if (orbTargeted) {
      setOrbHighlight(orbHits[0].object);
      crosshair.classList.add("active");
    } else {
      clearOrbHighlight();
      crosshair.classList.remove("active");
    }

    const pushable = isDronePushable(pos);

    if (pushable && !orbTargeted) {
      crosshair.classList.add("pushable");
      if (pushPrompt) pushPrompt.classList.add("show");
    } else {
      crosshair.classList.remove("pushable");
      if (pushPrompt) pushPrompt.classList.remove("show");
    }

    // Orb animation
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      if (!o.visible) continue;

      o.rotation.y += dt * 1.8;
      o.position.y = o.userData.baseY + Math.sin(elapsed * 2.4 + i * 1.3) * 0.18;

      const isHighlighted = (o === currentTargetOrb);
      const baseScale = isHighlighted ? 1.12 : 1.0;
      const pulse = 1.0 + 0.1 * Math.sin(elapsed * 3.2 + i * 0.9);

      o.scale.setScalar(baseScale * pulse);

      if (o.position.distanceTo(pos) < 1.0) {
        collectOrb(o);
      }
    }

    // Trophy animation
    if (trophy) {
      trophy.rotation.y += dt * 0.55;
      trophy.position.y = 4.40 + Math.sin(elapsed * 1.7) * 0.08;
    }

    // ---------------- Drone AI / combat ----------------
    droneState.modeTimer -= dt;
    droneState.graceTimer = Math.max(0, droneState.graceTimer - dt);
    droneState.hurtFlashTimer = Math.max(0, droneState.hurtFlashTimer - dt);
    droneState.pushCooldown = Math.max(0, droneState.pushCooldown - dt);
    droneState.anticipationTimer = Math.max(0, droneState.anticipationTimer - dt);
    droneState.chaseFlashTimer = Math.max(0, droneState.chaseFlashTimer - dt);
    droneState.lungeCooldown = Math.max(0, droneState.lungeCooldown - dt);
    droneState.lungeTimer = Math.max(0, droneState.lungeTimer - dt);
    droneState.screenShakeTimer = Math.max(0, droneState.screenShakeTimer - dt);
    playerInvulnTimer = Math.max(0, playerInvulnTimer - dt);
    
    droneState.playerSeenTimer = Math.max(0, droneState.playerSeenTimer - dt);
    droneState.searchTimer = Math.max(0, droneState.searchTimer - dt);

    hurtFlash.style.opacity =
      droneState.hurtFlashTimer > 0
        ? String(0.7 * (droneState.hurtFlashTimer / 0.5))
        : "0";

    if (chaseFlash) {
      let chaseOpacity = 0;

      if (droneState.chaseFlashTimer > 0) {
        const pulse = 0.55 + 0.45 * Math.sin(elapsed * 34.0);
        chaseOpacity = 0.82 * pulse * Math.min(droneState.chaseFlashTimer / 0.7, 1);
      } else if (droneState.mode === "chase") {
        chaseOpacity = 0.18 + 0.10 * Math.sin(elapsed * 10.0);
      }

      chaseFlash.style.opacity = String(Math.max(0, chaseOpacity));
    }

    const droneToPlayer = new THREE.Vector3().subVectors(pos, drone.position);
    const flatDroneToPlayer = droneToPlayer.clone();
    flatDroneToPlayer.y = 0;

    const distToPlayer = flatDroneToPlayer.length();
    updateDroneVerticalTarget(pos, dt);
        const closingDelta = droneState.lastFlatDistToPlayer - distToPlayer;

    if (droneState.mode === "chase" && distToPlayer < 3.2) {
      if (closingDelta < 0.035) {
        droneState.stuckTimer += dt;
      } else {
        droneState.stuckTimer = Math.max(0, droneState.stuckTimer - dt * 2.5);
      }
    } else {
      droneState.stuckTimer = Math.max(0, droneState.stuckTimer - dt * 2.0);
    }

    droneState.lastFlatDistToPlayer = distToPlayer;
    
    const progress = getProgress01();

    const chaseRange = THREE.MathUtils.lerp(13.5, 18.0, progress);
    const preferredDistance = THREE.MathUtils.lerp(0.85, 0.60, progress);
    const commitDistance = THREE.MathUtils.lerp(1.9, 2.4, progress);

    const hasLOS = droneHasLineOfSight(pos);

    if (hasLOS && distToPlayer < chaseRange) {
      droneState.playerSeenTimer = THREE.MathUtils.lerp(1.8, 3.4, progress);
      pickSearchTarget(pos);
      droneState.searchTimer = THREE.MathUtils.lerp(2.4, 4.6, progress);
    }

    // Decide state
    if (droneState.graceTimer > 0) {
      droneState.mode = "retreat";
    } else if (droneState.modeTimer <= 0) {
      let chaseProb = THREE.MathUtils.lerp(0.14, 0.34, progress);

      if (hasLOS && distToPlayer < chaseRange) chaseProb += THREE.MathUtils.lerp(0.34, 0.52, progress);
      if (droneState.playerSeenTimer > 0) chaseProb += THREE.MathUtils.lerp(0.16, 0.28, progress);

      if (distToPlayer < 10.0) chaseProb += THREE.MathUtils.lerp(0.06, 0.10, progress);
      if (distToPlayer < 7.0) chaseProb += THREE.MathUtils.lerp(0.10, 0.18, progress);
      if (distToPlayer < 4.0) chaseProb += THREE.MathUtils.lerp(0.16, 0.28, progress);

      chaseProb = Math.min(chaseProb, THREE.MathUtils.lerp(0.88, 0.98, progress));

      if (distToPlayer < chaseRange && Math.random() < chaseProb) {
        enterChaseMode(
          randBetween(
            THREE.MathUtils.lerp(2.0, 3.2, progress),
            THREE.MathUtils.lerp(3.2, 5.0, progress)
          )
        );
      } else if (droneState.hasLastSeenPos && droneState.searchTimer > 0) {
        droneState.mode = "search";
        droneState.modeTimer = randBetween(1.2, 2.0);
      } else {
        droneState.mode = "patrol";
        droneState.modeTimer = randBetween(0.7, 1.5);
      }
    }

    const lungeRange = THREE.MathUtils.lerp(2.6, 3.4, progress);

    if (
      droneState.mode === "chase" &&
      droneState.anticipationTimer <= 0 &&
      droneState.lungeCooldown <= 0 &&
      distToPlayer < lungeRange
    ) {
      const lungeDir = flatDroneToPlayer.clone();
      if (lungeDir.lengthSq() > 0.0001) {
        lungeDir.normalize();
        droneState.velocity.addScaledVector(
          lungeDir,
          THREE.MathUtils.lerp(13.0, 17.5, progress)
        );
        droneState.lungeCooldown = THREE.MathUtils.lerp(1.0, 0.5, progress);
        droneState.lungeTimer = THREE.MathUtils.lerp(0.16, 0.24, progress);
        droneState.chaseFlashTimer = Math.max(droneState.chaseFlashTimer, 0.2);
      }
    }    

    let desiredVel = new THREE.Vector3();

    if (droneState.mode === "chase") {
      if (droneState.anticipationTimer > 0) {
        const dir = flatDroneToPlayer.clone();
        if (dir.lengthSq() > 0.0001) {
          dir.normalize();

          const side = new THREE.Vector3(-dir.z, 0, dir.x);
          desiredVel.copy(side).multiplyScalar(1.6);
          desiredVel.addScaledVector(dir, -1.1);

          const pulse = 1.2 + 0.8 * Math.sin(elapsed * 24.0);
          if (drone.material && drone.material.emissive) {
            drone.material.emissive.setRGB(0.25 * pulse, 0.02, 0.02);
          }
          droneLight.intensity = 1.2 + 0.55 * Math.sin(elapsed * 20.0);
        }
      } else {
        const dir = flatDroneToPlayer.clone();

        if (dir.lengthSq() > 0.0001) {
          dir.normalize();

          const chaseSpeed =
            (hasLOS || distToPlayer < 4.8)
              ? THREE.MathUtils.lerp(7.4, 10.8, progress)
              : THREE.MathUtils.lerp(5.8, 8.0, progress);

          // If close enough, stop orbiting and fully commit to pressure / contact.
          const isStuckChasing = droneState.stuckTimer > 0.35;
          if (distToPlayer > commitDistance) {
            if (isStuckChasing) {
              // Force a bypass arc instead of letting avoidance trap us.
              const side = new THREE.Vector3(-dir.z, 0, dir.x)
                .multiplyScalar(droneState.bypassSign);

              const forced = dir.clone()
                .multiplyScalar(1.35)
                .addScaledVector(side, 0.9);

              if (forced.lengthSq() > 0.0001) {
                forced.normalize();
                desiredVel.copy(forced).multiplyScalar(chaseSpeed * 1.18);
              }
            } else {
              const avoid = computeDroneAvoidance(dir);
              dir.addScaledVector(avoid, 0.55);

              if (dir.lengthSq() > 0.0001) {
                dir.normalize();
                desiredVel.copy(dir).multiplyScalar(chaseSpeed);
              }
            }
          } else if (distToPlayer > preferredDistance) {
            // When close, commit hard.
            desiredVel.copy(dir).multiplyScalar(
              chaseSpeed * (isStuckChasing ? 1.28 : 1.12)
            );
          } else if (distToPlayer < preferredDistance - 0.08) {
            // Back off only a little so it doesn't hover forever.
            const away = new THREE.Vector3().subVectors(drone.position, pos);
            away.y = 0;
            if (away.lengthSq() > 0.0001) {
              away.normalize();
              desiredVel.copy(away).multiplyScalar(1.15);
            }
          } else {
            // Small lateral pressure, but keep some inward pull.
            const side = new THREE.Vector3(-dir.z, 0, dir.x)
              .multiplyScalar(droneState.bypassSign);

            desiredVel
              .copy(side)
              .multiplyScalar(2.4)
              .addScaledVector(dir, 1.4);
          }
        }
      }
    } else if (droneState.mode === "retreat") {
      const away = new THREE.Vector3().subVectors(drone.position, pos);
      away.y = 0;
      if (away.lengthSq() < 0.0001) away.set(1, 0, 0);
      away.normalize();
      desiredVel.copy(away).multiplyScalar(6.8);
    } else if (droneState.mode === "search") {
      if (droneState.hasSearchTarget || droneState.hasLastSeenPos) {
        const target = droneState.hasSearchTarget
          ? droneState.searchTargetPos
          : droneState.lastSeenPlayerPos;

        const toTarget = new THREE.Vector3().subVectors(target, drone.position);
        toTarget.y = 0;

        if (toTarget.lengthSq() > 0.08) {
          toTarget.normalize();

          const avoid = computeDroneAvoidance(toTarget);
          toTarget.addScaledVector(avoid, 0.95);

          if (toTarget.lengthSq() > 0.0001) {
            toTarget.normalize();
            desiredVel.copy(toTarget).multiplyScalar(6.2);
          }
        } else if (droneState.hasSearchTarget) {
          droneState.hasSearchTarget = false;
        } else {
          droneState.hasLastSeenPos = false;
          droneState.mode = "patrol";
          droneState.modeTimer = randBetween(0.8, 1.4);
        }
      } else {
        droneState.mode = "patrol";
        droneState.modeTimer = randBetween(0.8, 1.4);
      }
    } else {
      // Patrol
      const t = elapsed;
      const patrolTarget = new THREE.Vector3(
        Math.sin(t * 0.95) * 11 + Math.sin(t * 2.4) * 2.8,
        2.1,
        Math.cos(t * 0.72) * 9 + Math.cos(t * 1.9) * 2.6
      );

      desiredVel.subVectors(patrolTarget, drone.position);
      desiredVel.y = 0;
      if (desiredVel.lengthSq() > 0.001) {
        desiredVel.normalize();

        const avoid = computeDroneAvoidance(desiredVel);
        desiredVel.addScaledVector(avoid, 0.7);

        if (desiredVel.lengthSq() > 0.0001) {
          desiredVel.normalize().multiplyScalar(
            THREE.MathUtils.lerp(3.8, 5.6, progress)
          );
        }
      }
    }

    if (droneState.mode !== "chase" || droneState.anticipationTimer <= 0) {
      if (drone.material && drone.material.emissive) {
        if (droneState.mode === "chase") {
          drone.material.emissive.setRGB(
            THREE.MathUtils.lerp(0.42, 0.75, progress),
            0.0,
            0.0
          );
          droneLight.intensity = Math.max(
            droneLight.intensity,
            THREE.MathUtils.lerp(1.0, 1.8, progress)
          );
        } else if (droneState.mode === "retreat") {
          drone.material.emissive.setHex(0x6a3a00);
          droneLight.intensity = 0.95;
        } else {
          drone.material.emissive.setHex(0x4a0000);
          droneLight.intensity = 0.8;
        }
      }
    }

    // Smooth velocity
    if (droneState.lungeTimer > 0) {
      droneState.velocity.lerp(desiredVel, 0.06);
    } else {
      droneState.velocity.lerp(desiredVel, 0.18);
    }

    // Soft repel if very close, so it does not glue to player
    if (distToPlayer < 0.7 && droneState.graceTimer > 0) {
      const repel = new THREE.Vector3().subVectors(drone.position, pos);
      repel.y = 0;
      if (repel.lengthSq() > 0.0001) {
        repel.normalize().multiplyScalar((0.7 - distToPlayer) * 12.0);
        droneState.velocity.add(repel);
      }
    }

    // Move drone
    const prevDronePos = drone.position.clone();
    const nextDronePos = drone.position.clone();
    nextDronePos.addScaledVector(droneState.velocity, dt);

    const droneArenaLimit = GAME.arenaHalfSize - 1.2 - droneRadius;
    nextDronePos.x = THREE.MathUtils.clamp(nextDronePos.x, -droneArenaLimit, droneArenaLimit);
    nextDronePos.z = THREE.MathUtils.clamp(nextDronePos.z, -droneArenaLimit, droneArenaLimit);
    nextDronePos.y = droneState.desiredHeight + Math.sin(elapsed * 3.2) * 0.18;

    resolveDroneCollisions(nextDronePos);

    const moveDelta = new THREE.Vector3().subVectors(nextDronePos, prevDronePos);

    const blockedHorizontally =
      moveDelta.lengthSq() < 0.0004 && droneState.velocity.lengthSq() > 1.0;

    if (blockedHorizontally) {
      droneState.velocity.multiplyScalar(0.90);

      if (droneState.mode === "chase") {
        droneState.stuckTimer += dt * 1.5;

        // Occasionally swap which side the drone tries to pass on.
        if (droneState.stuckTimer > 0.22) {
          droneState.bypassSign *= -1;
        }
      }
    }

    drone.position.copy(nextDronePos);

    // Damage check after movement
    const hitCheck = new THREE.Vector3().subVectors(pos, drone.position);
    hitCheck.y = 0;
    const hitDist = hitCheck.length();

    if (hitDist < 1.5 && playerInvulnTimer <= 0 && droneState.graceTimer <= 0) {
      triggerPlayerHit(pos);
    }
    updateRadar(pos);
  } else {
    // Idle animation when unlocked
    if (trophy) trophy.rotation.y += dt * 0.2;
    updateRadar(getPlayerPosition());

    hurtFlash.style.opacity = "0";
    if (chaseFlash) chaseFlash.style.opacity = "0";
    crosshair.classList.remove("pushable");
    if (pushPrompt) pushPrompt.classList.remove("show");
  }

  camera.position.set(0, 0, 0);

  if (droneState.screenShakeTimer > 0) {
    const t = droneState.screenShakeTimer / 0.22;
    const amp = droneState.screenShakeStrength * t;

    camera.position.x += (Math.random() * 2 - 1) * amp;
    camera.position.y += (Math.random() * 2 - 1) * amp;
  }

  renderer.render(scene, camera);
}

animate();

// -------------------- Resize --------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});