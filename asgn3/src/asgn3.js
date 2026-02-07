/* global initShaders, Matrix4, Vector3 */

"use strict";

// =================== Shaders ===================
const VSHADER_SOURCE = `
  attribute vec3 a_Position;
  attribute vec2 a_UV;

  uniform mat4 u_ModelMatrix;
  uniform mat4 u_ViewMatrix;
  uniform mat4 u_ProjectionMatrix;

  varying vec2 v_UV;

  void main() {
    gl_Position = u_ProjectionMatrix * u_ViewMatrix * u_ModelMatrix * vec4(a_Position, 1.0);
    v_UV = a_UV;
  }
`;

const FSHADER_SOURCE = `
  precision mediump float;

  uniform vec4 u_BaseColor;
  uniform float u_TexWeight;     // 0 = base color, 1 = texture
  uniform sampler2D u_Sampler0;  // texture unit 0
  uniform sampler2D u_Sampler1;  // texture unit 1
  uniform sampler2D u_Sampler2;  // texture unit 2
  uniform sampler2D u_Sampler3;  // texture unit 3
  uniform int u_WhichTex;        // 0 .. 3

  varying vec2 v_UV;

  void main() {
    vec4 texColor =
      (u_WhichTex == 0) ? texture2D(u_Sampler0, v_UV) :
      (u_WhichTex == 1) ? texture2D(u_Sampler1, v_UV) :
      (u_WhichTex == 2) ? texture2D(u_Sampler2, v_UV) :
                          texture2D(u_Sampler3, v_UV);


    float t = clamp(u_TexWeight, 0.0, 1.0);
    gl_FragColor = (1.0 - t) * u_BaseColor + t * texColor;
  }
`;

// =================== Globals ===================
let canvas, gl;

let a_Position, a_UV;
let u_ModelMatrix, u_ViewMatrix, u_ProjectionMatrix;
let u_BaseColor, u_TexWeight, u_WhichTex;
let u_Sampler0, u_Sampler1, u_Sampler2, u_Sampler3;

let camera;

let invertMouseX = false;
let invertMouseY = true; // typical FPS: mouse up looks up

let lastMouseT = 0;

let gSelectedBlock = 0; // 0=wall, 1=grass, 2=stone (matches u_WhichTex)
let blockType = null;   // blockType[z][x][y] = 0..2

// ===== Hotbar / block selection =====
const BLOCKS = [
  { name: "Wall",  tex: 0 },
  { name: "Grass", tex: 1 },
  { name: "Stone", tex: 2 },
  { name: "Dirt",  tex: 3 },
];

let hotbarEl = null;


// world constants
const WORLD_W = 32;
const WORLD_D = 32;
const MAX_H = 4;

// textures
const textures = {
  ready0: false,
  ready1: false,
  ready2: false,
  ready3: false
};

// input
const keys = Object.create(null);
let pointerLocked = false;

// =================== Animal (ported from asgn2) ===================
let g_seconds = 0;
let g_startTime = performance.now();
let gAnimateAnimal = true;

// (same variables you used)
let gThighAngle = 20;
let gCalfAngle  = -20;
let gFootAngle  = 10;
let gNeckAngle = 15;
let gWingAngle = 10;
let gTailSpread = 180;
let gFeatherCount = 10;

// poke animation
let gPokeUntil = 0;
let gPokeStart = 0;
let gPokeDuration = 1.25;

// extras used in poke
let gBodyPitch = 0;
let gBodyDrop  = 0;
let gWinkL = 0;
let gWinkR = 0;

function triggerPoke() {
  gPokeStart = g_seconds;
  gPokeDuration = 1.25;
  gPokeUntil = gPokeStart + gPokeDuration;
}


// =================== Player physics ===================
let lastFrameT = performance.now();
const REF_DT = 16.67; // ms (60 FPS baseline)

const EYE_HEIGHT = 1.7;       // camera height above ground
const GRAVITY = -0.01;       // per frame (tune)
const JUMP_V = 0.26;          // initial jump velocity (tune)
const MAX_FALL = -0.6;
const PLAYER_HEIGHT = 1.8;  // total height of player (meters-ish)
const STEP_HEIGHT = 1.0;    // can step up 1 block
const EPS = 1e-4;


let velY = 0.0;
let onGround = false;

function updateVerticalPhysics(dtScale) {
  const ex = camera.eye.elements[0];
  const ez = camera.eye.elements[2];

  const cx = Math.floor(ex);
  const cz = Math.floor(ez);

  if (!inBoundsXZ(cx, cz)) {
    // If you ever allow leaving bounds, handle it here.
    return;
  }

  // Save old span for swept collision
  const oldEyeY  = camera.eye.elements[1];
  const oldFeetY = oldEyeY - EYE_HEIGHT;
  const oldHeadY = oldFeetY + PLAYER_HEIGHT;

  // gravity (scaled)
  velY += GRAVITY * dtScale;
  if (velY < MAX_FALL) velY = MAX_FALL;

  // integrate (scaled)
  camera.eye.elements[1] += velY * dtScale;

  const newEyeY  = camera.eye.elements[1];
  const newFeetY = newEyeY - EYE_HEIGHT;
  const newHeadY = newFeetY + PLAYER_HEIGHT;

  // ---- Swept ceiling collision (prevents "leaping through" from below) ----
  if (velY > 0) {
    // Check any voxel we crossed into in [oldHeadY, newHeadY]
    const yStart = Math.max(0, Math.floor(oldHeadY + 1e-4));
    const yEnd   = Math.min(MAX_H - 1, Math.floor(newHeadY - 1e-4));

    for (let y = yStart; y <= yEnd; y++) {
      if (hasBlock(cx, y, cz)) {
        // Ceiling bottom is at y, so clamp head to y
        const clampedHeadY = y;
        const clampedFeetY = clampedHeadY - PLAYER_HEIGHT;
        const clampedEyeY  = clampedFeetY + EYE_HEIGHT;

        camera.eye.elements[1] = clampedEyeY;
        velY = 0.0;
        break;
      }
    }
  }

  // Recompute after potential ceiling clamp
  const eyeY  = camera.eye.elements[1];
  const feetY = eyeY - EYE_HEIGHT;

  // ---- Swept floor collision (prevents falling through platforms) ----
  // Find the highest floor surface we crossed downward onto.
  // We only need sweep when falling / moving down.
  onGround = false;

  if (velY <= 0) {
    // We want blocks whose top (y+1) is between newFeetY and oldFeetY.
    // Iterate candidate blocks from near oldFeet downward.
    const yMax = Math.min(MAX_H - 1, Math.floor(oldFeetY - 1e-4));
    const yMin = Math.max(0, Math.floor(feetY - 1e-4));

    let landedSurface = null;

    for (let y = yMax; y >= yMin; y--) {
      if (!hasBlock(cx, y, cz)) continue;
      const top = y + 1;

      // Did feet cross below this top this frame?
      if (top <= oldFeetY + EPS && top >= feetY - EPS) {
        landedSurface = top;
        break; // highest such surface
      }
    }

    // If we didn't cross any, still allow resting on the best floor under current feet
    if (landedSurface === null) {
      landedSurface = floorSurfaceAt(cx, cz, feetY + EPS);
    }

    // Clamp to floor if below it
    if (feetY < landedSurface) {
      camera.eye.elements[1] = landedSurface + EYE_HEIGHT;
      velY = 0.0;
      onGround = true;
    } else {
      // On ground if very close and not moving vertically
      if (Math.abs(feetY - landedSurface) < 1e-3 && Math.abs(velY) < 1e-6) {
        onGround = true;
      }
    }
  }

  camera.recomputeAt();
  camera.updateView();
}




// =================== Camera ===================
class Camera {
  constructor() {
    this.fov = 60;

    // this.eye = new Vector3([16, groundLevelAt(16, 28) + EYE_HEIGHT, 28]);
    this.eye = new Vector3([16, 2, 28]);
    this.up  = new Vector3([0, 1, 0]);

    // --- Look angles (source of truth) ---
    this.yawDeg = -90;
    this.pitchDeg = 0;

    this.at  = new Vector3([16, 2, 27]);

    this.viewMatrix = new Matrix4();
    this.projectionMatrix = new Matrix4();

    this.recomputeAt();
    this.updateView();
    this.updateProjection();
  }

  // Convert yaw/pitch into forward, then at = eye + forward
  recomputeAt() {
    const yaw = (this.yawDeg * Math.PI) / 180;
    const pitch = (this.pitchDeg * Math.PI) / 180;

    const fx = Math.cos(pitch) * Math.cos(yaw);
    const fy = Math.sin(pitch);
    const fz = Math.cos(pitch) * Math.sin(yaw);

    const forward = new Vector3([fx, fy, fz]);
    forward.normalize();

    const newAt = new Vector3();
    newAt.set(this.eye);
    newAt.add(forward);
    this.at = newAt;
  }

  updateProjection() {
    const aspect = canvas.width / canvas.height;
    this.projectionMatrix.setPerspective(this.fov, aspect, 0.1, 1500);
  }

  updateView() {
    const e = this.eye.elements;
    const a = this.at.elements;
    const u = this.up.elements;
    this.viewMatrix.setLookAt(e[0], e[1], e[2], a[0], a[1], a[2], u[0], u[1], u[2]);
  }

  forwardDir() {
    // full forward from yaw/pitch (same math as recomputeAt)
    const yaw = (this.yawDeg * Math.PI) / 180;
    const pitch = (this.pitchDeg * Math.PI) / 180;

    const fx = Math.cos(pitch) * Math.cos(yaw);
    const fy = Math.sin(pitch);
    const fz = Math.cos(pitch) * Math.sin(yaw);

    const f = new Vector3([fx, fy, fz]);
    f.normalize();
    return f;
  }


  // --- Movement (use yaw only, stay on XZ plane) ---
  forwardDirXZ() {
    const yaw = (this.yawDeg * Math.PI) / 180;
    const fx = Math.cos(yaw);
    const fz = Math.sin(yaw);
    const f = new Vector3([fx, 0, fz]);
    f.normalize();
    return f;
  }

  tryMove(deltaVec) {
    const ex = this.eye.elements[0];
    const ey = this.eye.elements[1];
    const ez = this.eye.elements[2];

    const dx = deltaVec.elements[0];
    const dz = deltaVec.elements[2];

    const attemptMoveTo = (tx, tz) => {
      const curCX = Math.floor(this.eye.elements[0]);
      const curCZ = Math.floor(this.eye.elements[2]);

      const tgtCX = Math.floor(tx);
      const tgtCZ = Math.floor(tz);

      if (tgtCX < 0 || tgtCX >= WORLD_W || tgtCZ < 0 || tgtCZ >= WORLD_D) return false;

      const curFeet = this.eye.elements[1] - EYE_HEIGHT;

      // What floor are we currently standing on (below our feet)?
      const curFloor = floorSurfaceAt(curCX, curCZ, curFeet + EPS);

      // When stepping, only consider floors up to STEP_HEIGHT above our current feet.
      const tgtFloor = floorSurfaceAtWithinStep(tgtCX, tgtCZ, curFeet, STEP_HEIGHT);

      // too tall to step up
      if (onGround && (tgtFloor - curFloor > STEP_HEIGHT)) return false;

      // choose eyeY
      let newEyeY = this.eye.elements[1];

      if (onGround) {
        // Snap UP only (stepping)
        if (tgtFloor > curFloor + EPS) {
          newEyeY = tgtFloor + EYE_HEIGHT;
        } else {
          // If floor is lower, do NOT snap down.
          // We keep eyeY and start falling naturally next frames.
          newEyeY = this.eye.elements[1];
        }
      }



      // height-aware occupancy test (your canOccupyAt)
      if (!canOccupyAt(tgtCX, tgtCZ, newEyeY)) return false;

      // commit
      this.eye = new Vector3([tx, newEyeY, tz]);

      // If we moved onto a column whose floor is lower than where we were standing,
      // we should start falling (don't stay "onGround")
      if (onGround && tgtFloor < curFloor - EPS) {
        onGround = false;
      }

      this.recomputeAt();
      this.updateView();
      return true;

    };

    // Try move along X first (keeping Z)
    attemptMoveTo(ex + dx, ez);

    // Then along Z (using possibly updated X)
    attemptMoveTo(this.eye.elements[0], ez + dz);
  }



  moveForward(speed = 0.15) {
    const f = this.forwardDirXZ();
    f.mul(speed);
    this.tryMove(f);
  }

  moveBackward(speed = 0.15) {
    const f = this.forwardDirXZ();
    f.mul(-speed);
    this.tryMove(f);
  }

  moveRight(speed = 0.15) {
    const f = this.forwardDirXZ();
    const s = Vector3.cross(f, this.up);
    s.normalize();
    s.mul(speed);
    this.tryMove(s);
  }

  moveLeft(speed = 0.15) {
    const f = this.forwardDirXZ();
    const s = Vector3.cross(this.up, f);
    s.normalize();
    s.mul(speed);
    this.tryMove(s);
  }

  addLookDeltaInstant(deltaYawDeg, deltaPitchDeg) {
    this.yawDeg += deltaYawDeg;
    this.pitchDeg += deltaPitchDeg;

    const limit = 89.0;
    if (this.pitchDeg > limit) this.pitchDeg = limit;
    if (this.pitchDeg < -limit) this.pitchDeg = -limit;

    this.recomputeAt();
    this.updateView();
  }


}


// =================== Cube Geometry (pos + uv) ===================
// Unit cube centered at origin? Easiest is a cube from (0,0,0) to (1,1,1) then you translate via modelMatrix.
// Here: cube in [0,1]^3 with UVs per face.
class CubeMesh {
  constructor() {
    this.vbo = gl.createBuffer();
    this.vertexCount = 36;

    // Each vertex: x,y,z,u,v
    const data = new Float32Array([
      // FRONT (z=1)
      0,0,1, 0,0,   1,0,1, 1,0,   1,1,1, 1,1,
      0,0,1, 0,0,   1,1,1, 1,1,   0,1,1, 0,1,

      // BACK (z=0)
      1,0,0, 0,0,   0,0,0, 1,0,   0,1,0, 1,1,
      1,0,0, 0,0,   0,1,0, 1,1,   1,1,0, 0,1,

      // LEFT (x=0)
      0,0,0, 0,0,   0,0,1, 1,0,   0,1,1, 1,1,
      0,0,0, 0,0,   0,1,1, 1,1,   0,1,0, 0,1,

      // RIGHT (x=1)
      1,0,1, 0,0,   1,0,0, 1,0,   1,1,0, 1,1,
      1,0,1, 0,0,   1,1,0, 1,1,   1,1,1, 0,1,

      // TOP (y=1)
      0,1,1, 0,0,   1,1,1, 1,0,   1,1,0, 1,1,
      0,1,1, 0,0,   1,1,0, 1,1,   0,1,0, 0,1,

      // BOTTOM (y=0)
      0,0,0, 0,0,   1,0,0, 1,0,   1,0,1, 1,1,
      0,0,0, 0,0,   1,0,1, 1,1,   0,0,1, 0,1,
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  draw(modelMatrix, opts) {
    // opts: { baseColor:[r,g,b,a], texWeight:0/1, whichTex:0/1 }
    gl.uniformMatrix4fv(u_ModelMatrix, false, modelMatrix.elements);

    const c = (opts && opts.baseColor) ? opts.baseColor : [1,1,1,1];
    gl.uniform4f(u_BaseColor, c[0], c[1], c[2], c[3]);

    gl.uniform1f(u_TexWeight, (opts && typeof opts.texWeight === "number") ? opts.texWeight : 0);
    gl.uniform1i(u_WhichTex, (opts && typeof opts.whichTex === "number") ? opts.whichTex : 0);

    // gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    // const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    // gl.vertexAttribPointer(a_Position, 3, gl.FLOAT, false, 5 * FSIZE, 0);
    // gl.enableVertexAttribArray(a_Position);

    // gl.vertexAttribPointer(a_UV, 2, gl.FLOAT, false, 5 * FSIZE, 3 * FSIZE);
    // gl.enableVertexAttribArray(a_UV);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }
}

function drawColoredCube(M, rgba) {
  cubeMesh.draw(M, {
    baseColor: rgba,
    texWeight: 0.0,   // IMPORTANT: color-only
    whichTex: 0
  });
}

function drawColoredCubeCentered(M, rgba) {
  // Convert asgn2-style centered-cube transforms to work with a [0,1] cube mesh.
  const Mc = new Matrix4(M);
  Mc.translate(-0.5, -0.5, -0.5); // shift cube so its center is at origin
  cubeMesh.draw(Mc, {
    baseColor: rgba,
    texWeight: 0.0,
    whichTex: 0
  });
}


let cubeMesh;

// =================== World Map (HARD-CODED) ===================
// 32 lines, each 32 chars, using 0..4 for heights.
const WORLD_LAYOUT = `
33333333333333333333333333333333
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000040000000000000000000000003
30000000000000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000001111111111100003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000002000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
30000000000000000000000000000003
33333333333333333333333333333333
`.trim();

function parseWorld32(layoutStr) {
  const lines = layoutStr.split("\n");
  if (lines.length !== WORLD_D) throw new Error("WORLD_LAYOUT must have 32 lines");
  const map = [];
  for (let z = 0; z < WORLD_D; z++) {
    const line = lines[z].trim();
    if (line.length !== WORLD_W) throw new Error(`Line ${z} must have 32 chars`);
    const row = [];
    for (let x = 0; x < WORLD_W; x++) {
      const c = line[x];
      const h = (c.charCodeAt(0) - 48); // '0'..'4'
      row.push(Math.max(0, Math.min(MAX_H, h | 0)));
    }
    map.push(row);
  }
  return map;
}

const worldMap = parseWorld32(WORLD_LAYOUT);

// =================== Voxels: 32x32x4 (bitmask per column) ===================
// columnMask[z][x] is a 4-bit mask. bit y=1 means block exists at that (x,y,z).
let columnMask = null;

function initVoxelsFromHeights() {
  columnMask = Array.from({ length: WORLD_D }, () => new Uint8Array(WORLD_W));
  blockType  = Array.from({ length: WORLD_D }, () =>
               Array.from({ length: WORLD_W }, () => new Uint8Array(MAX_H)));

  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const h = clamp(worldMap[z][x] | 0, 0, MAX_H);
      columnMask[z][x] = (h === 0) ? 0 : ((1 << h) - 1);

      // default wall type for initial world blocks
      for (let y = 0; y < h; y++) {
        blockType[z][x][y] = 0; // wall
      }
    }
  }
}


function hasBlock(x, y, z) {
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D || y < 0 || y >= MAX_H) return false;
  return (columnMask[z][x] & (1 << y)) !== 0;
}

function setBlock(x, y, z, on, slotIdx = gSelectedBlock) {
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D || y < 0 || y >= MAX_H) return false;

  const bit = (1 << y);
  const m = columnMask[z][x];

  if (on) {
    columnMask[z][x] = (m | bit);

    const tex = BLOCKS[clamp(slotIdx | 0, 0, BLOCKS.length - 1)].tex;
    blockType[z][x][y] = clamp(tex | 0, 0, 3); // <-- allow 0..3
  } else {
    columnMask[z][x] = (m & ~bit);
    blockType[z][x][y] = 0;
  }
  return true;
}


function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function raycastVoxel(maxDist = 7.0) {
  const o = camera.eye.elements;
  const d = camera.forwardDir().elements;

  let ox = o[0], oy = o[1], oz = o[2];
  let dx = d[0], dy = d[1], dz = d[2];

  // Start cell
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  // Direction steps
  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  const INF = 1e30;

  const tDeltaX = stepX === 0 ? INF : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? INF : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? INF : Math.abs(1 / dz);

  // distance to first boundary
  const nextBoundaryX = stepX > 0 ? (x + 1) : x;
  const nextBoundaryY = stepY > 0 ? (y + 1) : y;
  const nextBoundaryZ = stepZ > 0 ? (z + 1) : z;

  let tMaxX = stepX === 0 ? INF : (nextBoundaryX - ox) / dx;
  let tMaxY = stepY === 0 ? INF : (nextBoundaryY - oy) / dy;
  let tMaxZ = stepZ === 0 ? INF : (nextBoundaryZ - oz) / dz;

  // Ensure positive tMax even with negative dirs
  if (tMaxX < 0) tMaxX = 0;
  if (tMaxY < 0) tMaxY = 0;
  if (tMaxZ < 0) tMaxZ = 0;

  let t = 0.0;

  // Face normal of the boundary we crossed to enter the current cell
  let nx = 0, ny = 0, nz = 0;

  for (let iter = 0; iter < 2048 && t <= maxDist; iter++) {
    // If inside bounds and occupied, we hit
    if (x >= 0 && x < WORLD_W && z >= 0 && z < WORLD_D && y >= 0 && y < MAX_H) {
      if (hasBlock(x, y, z)) {
        return { x, y, z, nx, ny, nz, t };
      }
    }

    // Step to next cell
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      x += stepX;
      nx = -stepX; ny = 0; nz = 0; // we crossed an X plane
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
      nx = 0; ny = -stepY; nz = 0; // crossed a Y plane
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
      nx = 0; ny = 0; nz = -stepZ; // crossed a Z plane
    }

    // If we’ve gone too far outside horizontally, still allow returning null
    if (x < -2 || x > WORLD_W + 2 || z < -2 || z > WORLD_D + 2 || y < -8 || y > MAX_H + 8) {
      // keep going a little; usually exits quickly anyway
    }
  }

  return null;
}

function isAtLeastOneBlockAwayFromVoxel(x, y, z) {
  const ex = camera.eye.elements[0];
  const ey = camera.eye.elements[1];
  const ez = camera.eye.elements[2];

  // distance from eye to voxel center
  const cx = x + 0.5;
  const cy = y + 0.5;
  const cz = z + 0.5;

  const dx = ex - cx;
  const dy = ey - cy;
  const dz = ez - cz;

  return (dx*dx + dy*dy + dz*dz) >= (1.0 * 1.0);
}

function highestSolidYInColumn(x, z) {
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D) return -1;
  const mask = columnMask[z][x] | 0;
  for (let y = MAX_H - 1; y >= 0; y--) {
    if (mask & (1 << y)) return y;
  }
  return -1;
}

function groundLevelAt(x, z) {
  // top surface y (where you stand) = highestSolidY + 1, or 0 if empty
  const top = highestSolidYInColumn(x, z);
  return (top >= 0) ? (top + 1) : 0;
}

function columnHasAnyBlockInYRange(x, z, yMin, yMax) {
  // checks integer voxel y in [yMin, yMax] inclusive
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D) return true;

  const lo = Math.max(0, Math.floor(yMin));
  const hi = Math.min(MAX_H - 1, Math.floor(yMax));

  for (let y = lo; y <= hi; y++) {
    if (hasBlock(x, y, z)) return true;
  }
  return false;
}

function canOccupyAt(x, z, eyeY) {
  // player occupies [feetY, headY)
  const feetY = eyeY - EYE_HEIGHT;
  const headY = feetY + PLAYER_HEIGHT;

  // out of bounds blocks movement
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D) return false;

  // if any voxel intersects our body span, we collide
  return !columnHasAnyBlockInYRange(x, z, feetY + EPS, headY - EPS);
}

function resolveCeilingCollision() {
  const ex = camera.eye.elements[0];
  const ez = camera.eye.elements[2];

  const cx = Math.floor(ex);
  const cz = Math.floor(ez);

  if (!inBoundsXZ(cx, cz)) return;

  const eyeY = camera.eye.elements[1];

  // Player span
  const feetY = eyeY - EYE_HEIGHT;
  const headY = feetY + PLAYER_HEIGHT;

  // If head is inside a solid voxel, push down and kill upward velocity
  const headVoxelY = Math.floor(headY - 1e-4); // slightly below head plane
  if (headVoxelY >= 0 && headVoxelY < MAX_H) {
    if (hasBlock(cx, headVoxelY, cz)) {
      // ceiling is at (headVoxelY) .. (headVoxelY+1). We want headY <= headVoxelY
      const newHeadY = headVoxelY; // just below voxel bottom
      const newEyeY = (newHeadY - PLAYER_HEIGHT) + EYE_HEIGHT;

      camera.eye.elements[1] = newEyeY;

      if (velY > 0) velY = 0; // stop rising
      onGround = false;

      camera.recomputeAt();
      camera.updateView();
    }
  }
}

function raycastGroundPlane(yPlane = 0.0, maxDist = 7.0) {
  const o = camera.eye.elements;
  const d = camera.forwardDir().elements;

  const oy = o[1], dy = d[1];
  if (Math.abs(dy) < 1e-6) return null; // parallel

  const t = (yPlane - oy) / dy;
  if (t < 0 || t > maxDist) return null;

  const px = o[0] + d[0] * t;
  const pz = o[2] + d[2] * t;

  const x = Math.floor(px);
  const z = Math.floor(pz);

  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D) return null;

  return { x, y: yPlane, z, t, px, pz };
}

// ===== Helpers ====

function highestSolidYBelowFeet(x, z, feetY) {
  if (!inBoundsXZ(x, z)) return -1;

  // We want blocks whose TOP (y+1) is <= feetY
  // i.e. y <= feetY - 1
  const yMax = Math.min(MAX_H - 1, Math.floor(feetY - 1e-4));
  for (let y = yMax; y >= 0; y--) {
    if (hasBlock(x, y, z)) return y;
  }
  return -1;
}

function floorSurfaceAt(x, z, feetY) {
  // Returns the Y value of the floor surface the feet should rest on (0 if none)
  const y = highestSolidYBelowFeet(x, z, feetY);
  return (y >= 0) ? (y + 1) : 0;
}

// Used for stepping: find the best floor we can "snap" to that is within reach
function floorSurfaceAtWithinStep(x, z, feetY, stepHeight) {
  return floorSurfaceAt(x, z, feetY + stepHeight + EPS);
}


function inBoundsXZ(x, z) {
  return x >= 0 && x < WORLD_W && z >= 0 && z < WORLD_D;
}

function removeBlockOnFace() {
  const hit = raycastVoxel(7.0);
  if (!hit) return;

  // optional: don’t let player remove a block basically inside themselves
  if (!isAtLeastOneBlockAwayFromVoxel(hit.x, hit.y, hit.z)) return;

  setBlock(hit.x, hit.y, hit.z, false);
}

function addBlockOnFace() {
  const maxDist = 7.0;

  const hitV = raycastVoxel(maxDist);
  const hitG = raycastGroundPlane(0.0, maxDist);

  // choose closer hit (if both exist)
  const useGround = hitG && (!hitV || hitG.t < hitV.t);

  if (useGround) {
    const px = hitG.x;
    const pz = hitG.z;

    const topY = highestSolidYInColumn(px, pz);      // -1..3
    const py = clamp(topY + 1, 0, MAX_H - 1);        // next free slot

    if (hasBlock(px, py, pz)) return;
    if (!isAtLeastOneBlockAwayFromVoxel(px, py, pz)) return;

    setBlock(px, py, pz, true);
    return;
  }


  // otherwise place adjacent to voxel face (your existing logic)
  if (!hitV) return;

  const px = hitV.x + hitV.nx;
  const py = hitV.y + hitV.ny;
  const pz = hitV.z + hitV.nz;

  if (px < 0 || px >= WORLD_W || pz < 0 || pz >= WORLD_D || py < 0 || py >= MAX_H) return;
  if (hasBlock(px, py, pz)) return;

  if (!isAtLeastOneBlockAwayFromVoxel(px, py, pz)) return;

  setBlock(px, py, pz, true);
}

function setSelectedBlockByTex(texIdx) {
  texIdx |= 0;
  const slot = BLOCKS.findIndex(b => b.tex === texIdx);
  if (slot >= 0) setSelectedBlock(slot);
}

function pickBlockFromLook() {
  const hit = raycastVoxel(7.0);
  if (!hit) return;
  if (!hasBlock(hit.x, hit.y, hit.z)) return;

  const tex = blockType[hit.z][hit.x][hit.y] | 0; // 0..3
  setSelectedBlockByTex(tex);
}





// =================== Texture Loading ===================
function isPowerOf2(v) { return (v & (v - 1)) === 0; }

function initTexture(texUnit, samplerUniform, url, onReadyFlagName) {
  const texture = gl.createTexture();
  const image = new Image();

  image.onload = () => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    gl.activeTexture(texUnit);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const pot = isPowerOf2(image.width) && isPowerOf2(image.height);

    if (pot) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      // WebGL1 rule for NPOT: no mipmaps, wrap must be CLAMP_TO_EDGE
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    const unitIndex = texUnit - gl.TEXTURE0; // 0..3
    gl.useProgram(gl.program);               // ensure program is active
    gl.uniform1i(samplerUniform, unitIndex);

    textures[onReadyFlagName] = true;

    console.log(`Loaded ${url} (${image.width}x${image.height}) -> unit ${unitIndex}, POT=${pot}`);
  };

  image.onerror = () => {
    console.error("FAILED to load texture:", url);
  };

  image.src = url;
}

// =================== Input ===================
function setSelectedBlock(idx) {
  const n = BLOCKS.length;
  gSelectedBlock = ((idx % n) + n) % n;
  updateHotbarUI();
}

function cycleSelectedBlock(delta) {
  setSelectedBlock(gSelectedBlock + delta);
}

function createHotbarUI() {
  hotbarEl = document.getElementById("hotbar");
  if (!hotbarEl) return;

  const ICONS = ["./wall.png", "./grass.jpg", "./stone.png", "./dirt.png"];

  hotbarEl.innerHTML = "";

  for (let i = 0; i < BLOCKS.length; i++) {
    const slot = document.createElement("div");
    slot.className = "hotbar-slot";
    slot.dataset.idx = String(i);

    // icon background
    const icon = document.createElement("div");
    icon.className = "hotbar-icon";
    icon.style.backgroundImage = `url("${ICONS[i]}")`;

    // label + key on top
    const label = document.createElement("div");
    label.className = "hotbar-label";
    label.textContent = BLOCKS[i].name;

    const key = document.createElement("div");
    key.className = "hotbar-key";
    key.textContent = String(i + 1);

    slot.appendChild(icon);
    slot.appendChild(label);
    slot.appendChild(key);

    hotbarEl.appendChild(slot);
  }

  updateHotbarUI();
}


function updateHotbarUI() {
  if (!hotbarEl) return;
  const slots = hotbarEl.querySelectorAll(".hotbar-slot");
  slots.forEach((s) => s.classList.remove("selected"));
  const sel = hotbarEl.querySelector(`.hotbar-slot[data-idx="${gSelectedBlock}"]`);
  if (sel) sel.classList.add("selected");
}


function setupInput() {
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;

    if (k === "f") triggerPoke();

    // hotbar keys 1..3
    if (k === "1") setSelectedBlock(0);
    if (k === "2") setSelectedBlock(1);
    if (k === "3") setSelectedBlock(2);
    if (k === "4") setSelectedBlock(3);
  });

  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  
  canvas.addEventListener("wheel", (e) => {
    if (!pointerLocked) return;

    e.preventDefault(); // stop page scroll
    const dir = (e.deltaY > 0) ? 1 : -1; // down = next, up = prev
    cycleSelectedBlock(dir);
  }, { passive: false });


  // Pointer lock for mouse look
  canvas.addEventListener("click", () => {
    if (!pointerLocked) {
      canvas.requestPointerLock?.();
    }
  });


  let ignoreMouseUntil = 0;

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = (document.pointerLockElement === canvas);

    const now = performance.now();
    // ignore deltas briefly after lock/unlock to skip the "bad first event"
    ignoreMouseUntil = now + 120;

    lastMouseT = now;
  });

  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked) return;

    const now = performance.now();
    if (now < ignoreMouseUntil) return;

    const dt = now - lastMouseT;
    lastMouseT = now;

    let dx = e.movementX || 0;
    let dy = e.movementY || 0;

    // If the browser hitches, dump the event
    if (dt > 80) return;

    // Clamp mouse deltas
    const MAX_DELTA = 60; // a bit tighter than 80 tends to feel nicer
    dx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dx));
    dy = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dy));

    const sensitivity = 0.18;
    const sx = (invertMouseX ? -1 : 1) * sensitivity;
    const sy = (invertMouseY ? -1 : 1) * sensitivity;


    camera.addLookDeltaInstant(dx * sx, dy * sy);

  });

  // Prevent right-click menu (so RMB can place blocks)
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Click to add/remove blocks (only when locked, feels like Minecraft)
  canvas.addEventListener("mousedown", (e) => {
    if (!pointerLocked) return;

    e.preventDefault();
    e.stopPropagation();

    // Left = remove
    if (e.button === 0) {
      removeBlockOnFace();
    }
    // Right = add
    else if (e.button === 2) {
      addBlockOnFace();
    }
    // Middle = pick block
    else if (e.button === 1) {
      pickBlockFromLook();
    }
  });
  canvas.addEventListener("mouseup", (e) => {
    if (!pointerLocked) return;
    e.preventDefault();
    e.stopPropagation();
  });



}

function handleKeys(dtScale) {
  const moveSpeed = 0.15 * dtScale;

  if (keys["w"]) camera.moveForward(moveSpeed);
  if (keys["s"]) camera.moveBackward(moveSpeed);
  if (keys["a"]) camera.moveLeft(moveSpeed);
  if (keys["d"]) camera.moveRight(moveSpeed);

  if (keys[" "]) {
    if (onGround) {
      velY = JUMP_V; // impulse is fine as-is (one-time)
      onGround = false;
    }
  }

  // turn keys should also scale
  const turnSpeed = 3.0 * dtScale;
  if (keys["q"]) camera.addLookDeltaInstant(-turnSpeed, 0.0);
  if (keys["e"]) camera.addLookDeltaInstant( turnSpeed, 0.0);

}


// =================== Rendering ===================
function drawScene() {
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeMesh.vbo);
  const FSIZE = Float32Array.BYTES_PER_ELEMENT;

  gl.vertexAttribPointer(a_Position, 3, gl.FLOAT, false, 5 * FSIZE, 0);
  gl.enableVertexAttribArray(a_Position);

  gl.vertexAttribPointer(a_UV, 2, gl.FLOAT, false, 5 * FSIZE, 3 * FSIZE);
  gl.enableVertexAttribArray(a_UV);

  // update view/proj uniforms
  gl.uniformMatrix4fv(u_ViewMatrix, false, camera.viewMatrix.elements);
  gl.uniformMatrix4fv(u_ProjectionMatrix, false, camera.projectionMatrix.elements);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // --- SKYBOX ---
  {
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    const m = new Matrix4();
    const S = Math.max(WORLD_W, WORLD_D) * 40;

    // world center
    const cx = WORLD_W * 0.5;
    const cz = WORLD_D * 0.5;
    const cy = 2.0; // middle-ish of your 0..4 height range

    m.translate(cx - S/2, cy - S/2, cz - S/2);
    m.scale(S, S, S);

    cubeMesh.draw(m, { baseColor:[0.25,0.55,0.95,1], texWeight:0.0, whichTex:0 });

    gl.depthMask(true);
  }



  // --- GROUND ---
  // Flattened cube as a plane; optionally textured
  {
    const m = new Matrix4();
    m.translate(0, -1.0, 0);
    m.scale(WORLD_W, 1, WORLD_D);

    cubeMesh.draw(m, {
      baseColor: [0.25, 0.8, 0.25, 1.0],
      texWeight: textures.ready1 ? 1.0 : 0.0, 
      whichTex: 1
    });
  }


  // --- WALLS from voxel masks ---
  const wallTexReady = textures.ready0 || textures.ready1 || textures.ready2 || textures.ready3;

  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const mask = columnMask[z][x];
      if (!mask) continue;

      for (let y = 0; y < MAX_H; y++) {
        if ((mask & (1 << y)) === 0) continue;

        const m = new Matrix4();
        m.translate(x, y, z);

        const t = blockType[z][x][y]; // 0..2

        // only use texture if that sampler is ready
        const texReady =
          (t === 0 && textures.ready0) ||
          (t === 1 && textures.ready1) ||
          (t === 2 && textures.ready2) ||
          (t === 3 && textures.ready3);

        cubeMesh.draw(m, {
          baseColor: [0.75, 0.75, 0.75, 1.0],
          texWeight: texReady ? 1.0 : 0.0,
          whichTex: t
        });
      }
    }
  }



  // --- ANIMAL in the world ---
  {
    // choose a spot
    const ax = 16;
    const az = 16;
    const ay = groundLevelAt(ax, az)+1; // stand on terrain height

    const M = new Matrix4();
    M.translate(ax + 0.5, ay, az + 0.5);

    // scale from “animal space” to world block space
    // tweak this value until it looks right
    M.scale(1.2, 1.2, 1.2);

    // face some direction (optional)
    M.rotate(180, 0, 1, 0);

    drawAnimalInWorld(M);
  }


}

// =================== Main Loop ===================
function tick(now = performance.now()) {
  let dtMs = now - lastFrameT;
  lastFrameT = now;

  // clamp dt to avoid giant steps (tab switch, hitch)
  dtMs = Math.max(1, Math.min(50, dtMs));

  const dtScale = dtMs / REF_DT; // 1.0 at 60fps

  handleKeys(dtScale);
  updateVerticalPhysics(dtScale);

  g_seconds = (now - g_startTime) / 1000.0;
  if (gAnimateAnimal || g_seconds < gPokeUntil) {
    updateAnimalAngles();
  }

  drawScene();
  requestAnimationFrame(tick);
}

function updateAnimalAngles() {
  const w = 2 * Math.PI * 1.2;
  const inPoke = (g_seconds < gPokeUntil);

  if (!inPoke) {
    gBodyPitch = 0;
    gBodyDrop  = 0;
    gWinkL = 0;
    gWinkR = 0;

    gThighAngle = 25 * Math.sin(w * g_seconds);
    gCalfAngle  = 20 * Math.sin(w * g_seconds + 1.1);
    gFootAngle  = 12 * Math.sin(w * g_seconds + 2.0);

    gNeckAngle  = 10 + 8 * Math.sin(w * g_seconds + 0.6);
    gWingAngle  = 8 * Math.sin(w * g_seconds + 0.2);

    const s = 0.5 + 0.5 * Math.sin(0.7 * w * g_seconds);
    gTailSpread = 90 + 60 * s;
  } else {
    const dur = gPokeDuration;
    const u = Math.min(1, Math.max(0, (g_seconds - gPokeStart) / dur));

    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const smooth = (x) => x * x * (3 - 2 * x);

    const p0 = smooth(clamp01(u / 0.18));
    const p1 = smooth(clamp01((u - 0.18) / 0.42));
    const p2 = smooth(clamp01((u - 0.60) / 0.40));

    const jitter = Math.sin(2 * Math.PI * 18 * g_seconds);

    gWingAngle = 65 * p0 + 12 * jitter * p0 * (1 - p1);
    gFeatherCount = 18 + 12 * Math.sin(Math.PI * p2);

    gTailSpread = 30 + 15 * (1 - p0);
    gNeckAngle = 25 * p0 - 10 * p1;

    gBodyPitch = 55 * p1 * (1 - p2);
    gBodyDrop  = 0.18 * p1 * (1 - p2);

    gThighAngle = -35 * p1;
    gCalfAngle  =  25 * p1;
    gFootAngle  =  15 * p1;

    const winkMid =
      smooth(clamp01((u - 0.28) / 0.18)) *
      (1 - smooth(clamp01((u - 0.62) / 0.18)));
    gWinkL = 0.0;
    gWinkR = winkMid;

    gTailSpread = (1 - p2) * gTailSpread + p2 * (160 - 20 * Math.sin(2 * Math.PI * 3 * (u - 0.60)));
    gWingAngle  = (1 - p2) * gWingAngle  + p2 * (10 * Math.sin(2 * Math.PI * 2.5 * (u - 0.60)));

    gBodyPitch *= (1 - p2);
    gBodyDrop  *= (1 - p2);
  }
}

function drawAnimalInWorld(worldM) {
  // Colors
  const bodyColor  = [0.10, 0.35, 0.55, 1.0];
  const neckColor  = [0.08, 0.30, 0.50, 1.0];
  const headColor  = [0.12, 0.40, 0.65, 1.0];
  const beakColor  = [0.90, 0.70, 0.15, 1.0];
  const legColor   = [0.65, 0.55, 0.30, 1.0];
  const wingColor  = [0.08, 0.30, 0.45, 1.0];
  const tailColorA = [0.05, 0.45, 0.35, 1.0];
  const tailColorB = [0.10, 0.55, 0.20, 1.0];
  const crestColor = [0.20, 0.70, 0.95, 1.0];

  const EPS = 0.002;

  // Root/base
  const root = new Matrix4(worldM);
  root.translate(0, -gBodyDrop, 0);
  root.rotate(gBodyPitch, 1, 0, 0);

  // BODY
  const bodyBase = new Matrix4(root);
  const body = new Matrix4(bodyBase);
  body.scale(0.85, 0.40, 0.55);
  drawColoredCubeCentered(body, bodyColor);

  // NECK
  const neckBase = new Matrix4(bodyBase);
  neckBase.translate(0.0, 0.18, 0.20);
  neckBase.rotate(gNeckAngle, 1, 0, 0);

  const NECK_LEN = 0.48;
  const NECK_CENTER_Y = 0.24;

  const neck = new Matrix4(neckBase);
  neck.translate(0.0, NECK_CENTER_Y, 0.0);
  neck.scale(0.14, NECK_LEN, 0.14);
  drawColoredCubeCentered(neck, neckColor);

  // HEAD
  const headBase = new Matrix4(neckBase);
  headBase.translate(0.0, NECK_LEN + 0.02, 0.00);

  const head = new Matrix4(headBase);
  head.scale(0.26, 0.20, 0.22);
  drawColoredCubeCentered(head, headColor);

  // EYES
  function drawEye(x, winkAmount) {
    const eye = new Matrix4(headBase);
    eye.translate(x, 0.03, 0.115);
    const openY = 0.045;
    const y = openY * (1.0 - 0.92 * winkAmount);
    eye.scale(0.04, y, 0.04);
    drawColoredCubeCentered(eye, [0.05, 0.05, 0.05, 1.0]);
  }
  drawEye( 0.075, gWinkL);
  drawEye(-0.075, gWinkR);

  // BEAK
  const beak = new Matrix4(headBase);
  beak.translate(0.0, 0.00, 0.20);
  beak.scale(0.10, 0.06, 0.22);
  drawColoredCubeCentered(beak, beakColor);

  // CREST
  for (let i = -1; i <= 1; i++) {
    const crest = new Matrix4(headBase);
    crest.translate(0.05 * i, 0.18, 0.02);
    crest.rotate(-25 + 10 * i, 0, 0, 1);
    crest.scale(0.04, 0.18, 0.04);
    drawColoredCubeCentered(crest, crestColor);
  }

  // WINGS
  const leftWingBase = new Matrix4(bodyBase);
  leftWingBase.translate(0.42, 0.05, 0.05);
  leftWingBase.rotate(-gWingAngle, 0, 0, 1);

  const leftWing = new Matrix4(leftWingBase);
  leftWing.translate(0.22, 0.0, 0.0);
  leftWing.scale(0.55, 0.10, 0.35);
  drawColoredCubeCentered(leftWing, wingColor);

  const rightWingBase = new Matrix4(bodyBase);
  rightWingBase.translate(-0.42, 0.05, 0.05);
  rightWingBase.rotate(gWingAngle, 0, 0, 1);

  const rightWing = new Matrix4(rightWingBase);
  rightWing.translate(-0.22, 0.0, 0.0);
  rightWing.scale(0.55, 0.10, 0.35);
  drawColoredCubeCentered(rightWing, wingColor);

  // LEGS
  function drawLeg(anchorX, anchorZ, thighAng, calfAng, footAng) {
    let L = new Matrix4(bodyBase);
    L.translate(anchorX, -0.05, anchorZ);

    L.rotate(thighAng, 1, 0, 0);
    {
      const thigh = new Matrix4(L);
      thigh.translate(0, -0.18, 0);
      thigh.scale(0.10, 0.35, 0.10);
      drawColoredCubeCentered(thigh, legColor);
    }

    L.translate(0, -0.35 - EPS, 0);

    L.rotate(calfAng, 1, 0, 0);
    {
      const calf = new Matrix4(L);
      calf.translate(0, -0.16, 0);
      calf.scale(0.09, 0.32, 0.09);
      drawColoredCubeCentered(calf, legColor);
    }

    L.translate(0, -0.32 - EPS, 0);

    L.rotate(footAng, 1, 0, 0);
    {
      const foot = new Matrix4(L);
      foot.translate(0, -0.05, 0.06);
      foot.scale(0.14, 0.08, 0.24);
      drawColoredCubeCentered(foot, legColor);
    }
  }

  drawLeg(0.18, 0.10, gThighAngle, gCalfAngle, gFootAngle);

  const thighR = gAnimateAnimal ? -gThighAngle : gThighAngle;
  const calfR  = gAnimateAnimal ? -gCalfAngle  : gCalfAngle;
  const footR  = gAnimateAnimal ? -gFootAngle  : gFootAngle;
  drawLeg(-0.18, 0.10, thighR, calfR, footR);

  // TAIL
  const tailBase = new Matrix4(bodyBase);
  tailBase.translate(0.0, 0.0, -0.30);
  tailBase.rotate(-10, 1, 0, 0);

  const tailChunk = new Matrix4(tailBase);
  tailChunk.translate(0.0, 0.05, -0.06);
  tailChunk.scale(0.20, 0.18, 0.18);
  drawColoredCubeCentered(tailChunk, tailColorA);

  const N = Math.max(3, Math.floor(gFeatherCount));
  const spread = gTailSpread;

  const featherLen = 0.95;
  const featherThkX = 0.06;
  const featherThkZ = 0.03;

  const attachY = 0.10;
  const attachZ = -0.02;

  for (let i = 0; i < N; i++) {
    const a = -spread * 0.5 + (spread * i) / (N - 1);

    const featherPivot = new Matrix4(tailBase);
    featherPivot.translate(0.0, attachY, attachZ);
    featherPivot.rotate(a, 0, 0, 1);
    featherPivot.rotate(-35, 1, 0, 0);

    const feather = new Matrix4(featherPivot);
    feather.translate(0.0, featherLen * 0.5, 0.0);
    feather.scale(featherThkX, featherLen, featherThkZ);

    const c = (i % 2 === 0) ? tailColorA : tailColorB;
    drawColoredCubeCentered(feather, c);

    const tip = new Matrix4(featherPivot);
    tip.translate(0.0, featherLen, 0.0);

    const eyeOuter = new Matrix4(tip);
    eyeOuter.translate(0.0, 0.04, 0.0);
    eyeOuter.scale(0.18, 0.12, 0.06);
    drawColoredCubeCentered(eyeOuter, [0.90, 0.85, 0.15, 1.0]);

    const eyeMid = new Matrix4(tip);
    eyeMid.translate(0.0, 0.04, 0.006);
    eyeMid.scale(0.13, 0.09, 0.05);
    drawColoredCubeCentered(eyeMid, [0.05, 0.60, 0.55, 1.0]);

    const eyeCore = new Matrix4(tip);
    eyeCore.translate(0.0, 0.04, 0.012);
    eyeCore.scale(0.07, 0.05, 0.04);
    drawColoredCube(eyeCore, [0.05, 0.10, 0.12, 1.0]);
  }
}


// =================== Resize ===================
function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (camera) camera.updateProjection();
  }
}

// =================== main ===================
function main() {
  canvas = document.getElementById("webgl");
  gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) {
    console.error("Failed to get WebGL context");
    return;
  }

  resizeCanvasToDisplaySize();
  window.addEventListener("resize", resizeCanvasToDisplaySize);

  if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
    console.error("Failed to init shaders");
    return;
  }

  // depth
  gl.enable(gl.DEPTH_TEST);

  // background
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  // locate attrib/uniforms
  a_Position = gl.getAttribLocation(gl.program, "a_Position");
  a_UV = gl.getAttribLocation(gl.program, "a_UV");

  u_ModelMatrix = gl.getUniformLocation(gl.program, "u_ModelMatrix");
  u_ViewMatrix = gl.getUniformLocation(gl.program, "u_ViewMatrix");
  u_ProjectionMatrix = gl.getUniformLocation(gl.program, "u_ProjectionMatrix");

  u_BaseColor = gl.getUniformLocation(gl.program, "u_BaseColor");
  u_TexWeight = gl.getUniformLocation(gl.program, "u_TexWeight");
  u_WhichTex = gl.getUniformLocation(gl.program, "u_WhichTex");

  u_Sampler0 = gl.getUniformLocation(gl.program, "u_Sampler0");
  u_Sampler1 = gl.getUniformLocation(gl.program, "u_Sampler1");
  u_Sampler2 = gl.getUniformLocation(gl.program, "u_Sampler2");
  u_Sampler3 = gl.getUniformLocation(gl.program, "u_Sampler3");

  // camera + geometry
  camera = new Camera();
  cubeMesh = new CubeMesh();

  createHotbarUI();
  setSelectedBlock(0); // default

  setupInput();

  // textures (put images in asgn3/src/ or asgn3/ and update paths)
  // NOTE: Must be power-of-2 square images (e.g. 256x256).
  initTexture(gl.TEXTURE0, u_Sampler0, "./wall.png",  "ready0");
  initTexture(gl.TEXTURE1, u_Sampler1, "./grass.jpg", "ready1");
  initTexture(gl.TEXTURE2, u_Sampler2, "./stone.png", "ready2");
  initTexture(gl.TEXTURE3, u_Sampler3, "./dirt.png",  "ready3");

  initVoxelsFromHeights();

  // Spawn on top of whatever column we start in
  const sx = 16;
  const sz = 28;
  camera.eye = new Vector3([sx, groundLevelAt(sx, sz) + EYE_HEIGHT, sz]);
  camera.recomputeAt();
  camera.updateView();

  tick();

}

main();
