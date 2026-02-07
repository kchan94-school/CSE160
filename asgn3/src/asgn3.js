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
  uniform int u_WhichTex;        // 0 -> sampler0, 1 -> sampler1

  varying vec2 v_UV;

  void main() {
    vec4 texColor = (u_WhichTex == 0)
      ? texture2D(u_Sampler0, v_UV)
      : texture2D(u_Sampler1, v_UV);

    float t = clamp(u_TexWeight, 0.0, 1.0);
    gl_FragColor = (1.0 - t) * u_BaseColor + t * texColor;
  }
`;

// =================== Globals ===================
let canvas, gl;

let a_Position, a_UV;
let u_ModelMatrix, u_ViewMatrix, u_ProjectionMatrix;
let u_BaseColor, u_TexWeight, u_WhichTex;
let u_Sampler0, u_Sampler1;

let camera;

let invertMouseX = false;
let invertMouseY = true; // typical FPS: mouse up looks up

let lastMouseT = 0;


// world constants
const WORLD_W = 32;
const WORLD_D = 32;
const MAX_H = 12;

// textures
const textures = {
  ready0: false,
  ready1: false
};

// input
const keys = Object.create(null);
let pointerLocked = false;

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

  const groundY = groundLevelAt(cx, cz) + EYE_HEIGHT;

  // gravity (scaled)
  velY += GRAVITY * dtScale;
  if (velY < MAX_FALL) velY = MAX_FALL;

  // integrate (scaled)
  camera.eye.elements[1] += velY * dtScale;

  // (If you added ceiling collision earlier, call it here too)

  // ground collision
  if (camera.eye.elements[1] <= groundY) {
    camera.eye.elements[1] = groundY;
    velY = 0.0;
    onGround = true;
  } else {
    onGround = false;
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

    // --- Smoothing targets ---
    this.yawTarget = this.yawDeg;
    this.pitchTarget = this.pitchDeg;

    // smoothing factor (0..1). higher = snappier, lower = smoother
    this.lookSmoothing = 0.22;

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
    this.projectionMatrix.setPerspective(this.fov, aspect, 0.1, 1000);
  }

  updateView() {
    const e = this.eye.elements;
    const a = this.at.elements;
    const u = this.up.elements;
    this.viewMatrix.setLookAt(e[0], e[1], e[2], a[0], a[1], a[2], u[0], u[1], u[2]);
  }

  // --- Look controls ---
  addLookDelta(deltaYawDeg, deltaPitchDeg) {
    this.yawTarget += deltaYawDeg;
    this.pitchTarget += deltaPitchDeg;

    const limit = 89.0;
    if (this.pitchTarget > limit) this.pitchTarget = limit;
    if (this.pitchTarget < -limit) this.pitchTarget = -limit;
  }

  // Small helper: wrap an angle difference to [-180, 180)
  static shortestAngleDelta(targetDeg, currentDeg) {
    let d = targetDeg - currentDeg;
    d = ((d + 180) % 360 + 360) % 360 - 180;
    return d;
  }

  // Call once per frame for smoothing
  updateLook(dtScale) {
    // Convert “per-frame smoothing” to dt-based:
    // if lookSmoothing = 0.22 at 60fps, then per-dt alpha is:
    const a = 1 - Math.pow(1 - this.lookSmoothing, dtScale);

    const dyaw = Camera.shortestAngleDelta(this.yawTarget, this.yawDeg);
    this.yawDeg += dyaw * a;

    this.pitchDeg = this.pitchDeg + (this.pitchTarget - this.pitchDeg) * a;

    this.recomputeAt();
    this.updateView();
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

      const curGround = groundLevelAt(curCX, curCZ);
      const tgtGround = groundLevelAt(tgtCX, tgtCZ);

      // too tall to step up
      if (onGround && (tgtGround - curGround > STEP_HEIGHT)) return false;

      // choose eyeY
      let newEyeY = this.eye.elements[1];
      if (onGround) newEyeY = tgtGround + EYE_HEIGHT;

      // height-aware occupancy test (your canOccupyAt)
      if (!canOccupyAt(tgtCX, tgtCZ, newEyeY)) return false;

      // commit
      this.eye = new Vector3([tx, newEyeY, tz]);
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

    // keep targets in sync so smoothing doesn't "pull" you back
    this.yawTarget = this.yawDeg;
    this.pitchTarget = this.pitchDeg;

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

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    gl.vertexAttribPointer(a_Position, 3, gl.FLOAT, false, 5 * FSIZE, 0);
    gl.enableVertexAttribArray(a_Position);

    gl.vertexAttribPointer(a_UV, 2, gl.FLOAT, false, 5 * FSIZE, 3 * FSIZE);
    gl.enableVertexAttribArray(a_UV);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }
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
  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const h = clamp(worldMap[z][x] | 0, 0, MAX_H);
      // mask with lowest h bits set: h=0 -> 0, h=4 -> 0b1111
      columnMask[z][x] = (h === 0) ? 0 : ((1 << h) - 1);
    }
  }
}

function hasBlock(x, y, z) {
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D || y < 0 || y >= MAX_H) return false;
  return (columnMask[z][x] & (1 << y)) !== 0;
}

function setBlock(x, y, z, on) {
  if (x < 0 || x >= WORLD_W || z < 0 || z >= WORLD_D || y < 0 || y >= MAX_H) return false;
  const bit = (1 << y);
  const m = columnMask[z][x];
  columnMask[z][x] = on ? (m | bit) : (m & ~bit);
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

function inBoundsXZ(x, z) {
  return x >= 0 && x < WORLD_W && z >= 0 && z < WORLD_D;
}


function removeBlockOnFace() {
  const hit = raycastVoxel(7.0);
  if (!hit) return;
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
    const py = 0;      // place on ground level
    const pz = hitG.z;

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





// =================== Texture Loading ===================
function initTexture(texUnit, samplerUniform, url, onReadyFlagName) {
  const texture = gl.createTexture();
  const image = new Image();
  image.onload = () => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    gl.activeTexture(texUnit);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);

    // connect sampler to unit index
    const unitIndex = (texUnit === gl.TEXTURE0) ? 0 : 1;
    gl.uniform1i(samplerUniform, unitIndex);

    textures[onReadyFlagName] = true;
  };
  image.crossOrigin = "anonymous";
  image.src = url;
}

// =================== Input ===================
function setupInput() {
  window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  // Pointer lock for mouse look
  canvas.addEventListener("click", () => {
    canvas.requestPointerLock?.();
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

    if (e.button === 0) {        // left
      removeBlockOnFace();
    } else if (e.button === 2) { // right
      addBlockOnFace();
    }
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
  if (keys["q"]) camera.addLookDelta(-turnSpeed, 0.0);
  if (keys["e"]) camera.addLookDelta( turnSpeed, 0.0);
}



// =================== Rendering ===================
function drawScene() {
  // update view/proj uniforms
  gl.uniformMatrix4fv(u_ViewMatrix, false, camera.viewMatrix.elements);
  gl.uniformMatrix4fv(u_ProjectionMatrix, false, camera.projectionMatrix.elements);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // --- SKYBOX ---
  {
    // Disable depth writes so sky never "cuts out" other geometry
    gl.depthMask(false);

    const m = new Matrix4();

    // Center on the middle of the world footprint, and center vertically around player height
    const cx = WORLD_W * 0.5;
    const cz = WORLD_D * 0.5;
    const cy = 2.0;

    // Size: big enough to cover the whole world + far plane comfort
    const S = Math.max(WORLD_W, WORLD_D) * 40; // e.g., 32*40 = 1280

    m.translate(cx, cy, cz);
    m.scale(S, S, S);

    cubeMesh.draw(m, {
      baseColor: [0.25, 0.55, 0.95, 1.0],
      texWeight: 0.0,
      whichTex: 0
    });

    gl.depthMask(true);
  }


  // --- GROUND ---
  // Flattened cube as a plane; optionally textured
  {
    const m = new Matrix4();
    m.translate(0, -1.0, 0);
    m.scale(WORLD_W, 1, WORLD_D);

    // Use texture 1 if loaded, else base color
    const useTex = textures.ready1 ? 1.0 : 0.0;
    cubeMesh.draw(m, {
      baseColor: [0.25, 0.8, 0.25, 1.0],
      texWeight: useTex,
      whichTex: 1
    });
  }

  // --- WALLS from voxel masks ---
  const wallTexReady = textures.ready0;

  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const mask = columnMask[z][x];
      if (!mask) continue;

      for (let y = 0; y < MAX_H; y++) {
        if ((mask & (1 << y)) === 0) continue;

        const m = new Matrix4();
        m.translate(x, y, z);

        cubeMesh.draw(m, {
          baseColor: [0.75, 0.75, 0.75, 1.0],
          texWeight: wallTexReady ? 1.0 : 0.0,
          whichTex: 0
        });
      }
    }
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
  camera.updateLook(dtScale);

  drawScene();
  requestAnimationFrame(tick);
}


// =================== Resize ===================
function resizeCanvasToDisplaySize() {
  if (pointerLocked) return; // don't resize mid-lock
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

  // camera + geometry
  camera = new Camera();
  cubeMesh = new CubeMesh();

  setupInput();

  // textures (put images in asgn3/src/ or asgn3/ and update paths)
  // NOTE: Must be power-of-2 square images (e.g. 256x256).
  initTexture(gl.TEXTURE0, u_Sampler0, "./wall.png", "ready0");
  initTexture(gl.TEXTURE1, u_Sampler1, "./grass.png", "ready1");
  // initTexture(gl.TEXTURE1, u_Sampler1, "./grass.jpg", "ready1");

  initVoxelsFromHeights();

  tick();
}

main();
