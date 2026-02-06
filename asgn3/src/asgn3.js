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

// world constants
const WORLD_W = 32;
const WORLD_D = 32;
const MAX_H = 4;

// textures
const textures = {
  ready0: false,
  ready1: false
};

// input
const keys = Object.create(null);
let pointerLocked = false;

// =================== Camera ===================
class Camera {
  constructor() {
    this.fov = 60;

    this.eye = new Vector3([16, 2, 28]);   // start position
    this.at  = new Vector3([16, 2, 27]);   // looking slightly forward (-z)
    this.up  = new Vector3([0, 1, 0]);

    this.viewMatrix = new Matrix4();
    this.projectionMatrix = new Matrix4();

    this.updateView();
    this.updateProjection();
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

  // helper: forward direction (normalized)
  forwardDir() {
    const f = new Vector3();
    f.set(this.at);
    f.sub(this.eye);
    f.normalize();
    return f;
  }

  moveForward(speed = 0.15) {
    const f = this.forwardDir();
    f.mul(speed);
    this.eye.add(f);
    this.at.add(f);
    this.updateView();
  }

  moveBackward(speed = 0.15) {
    const b = this.forwardDir();
    b.mul(-speed);
    this.eye.add(b);
    this.at.add(b);
    this.updateView();
  }

  moveLeft(speed = 0.15) {
    // left = up x forward
    const f = this.forwardDir();
    const s = Vector3.cross(this.up, f);
    s.normalize();
    s.mul(speed);
    this.eye.add(s);
    this.at.add(s);
    this.updateView();
  }

  moveRight(speed = 0.15) {
    // right = forward x up
    const f = this.forwardDir();
    const s = Vector3.cross(f, this.up);
    s.normalize();
    s.mul(speed);
    this.eye.add(s);
    this.at.add(s);
    this.updateView();
  }

  panYaw(deg) {
    // rotate forward vector around up axis
    const f = this.forwardDir();
    const rot = new Matrix4();
    const u = this.up.elements;
    rot.setRotate(deg, u[0], u[1], u[2]);
    const f2 = rot.multiplyVector3(f);

    // at = eye + f2
    const newAt = new Vector3();
    newAt.set(this.eye);
    newAt.add(f2);

    this.at = newAt;
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

// =================== World Map ===================
// Each cell is height 0..4 (walls). Ground + sky are separate.
const worldMap = buildMap32();

// Example generator: border walls + a few structures.
// You can replace this with a literal 32x32 hardcoded array later if you want.
function buildMap32() {
  const map = [];
  for (let z = 0; z < WORLD_D; z++) {
    const row = [];
    for (let x = 0; x < WORLD_W; x++) {
      let h = 0;

      // border
      if (x === 0 || z === 0 || x === WORLD_W - 1 || z === WORLD_D - 1) h = 3;

      // a couple obstacles
      if (x === 10 && z >= 8 && z <= 20) h = 2;
      if (z === 14 && x >= 14 && x <= 26) h = 1;

      // a "tower"
      if (x === 6 && z === 6) h = 4;

      row.push(h);
    }
    map.push(row);
  }
  return map;
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

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = (document.pointerLockElement === canvas);
  });

  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked) return;
    // horizontal mouse movement -> yaw
    const sensitivity = 0.12;
    camera.panYaw(e.movementX * sensitivity);
  });
}

function handleKeys() {
  if (keys["w"]) camera.moveForward();
  if (keys["s"]) camera.moveBackward();
  if (keys["a"]) camera.moveLeft();
  if (keys["d"]) camera.moveRight();
  if (keys["q"]) camera.panYaw(2.0);
  if (keys["e"]) camera.panYaw(-2.0);
}

// =================== Rendering ===================
function drawScene() {
  // update view/proj uniforms
  gl.uniformMatrix4fv(u_ViewMatrix, false, camera.viewMatrix.elements);
  gl.uniformMatrix4fv(u_ProjectionMatrix, false, camera.projectionMatrix.elements);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // --- SKYBOX ---
  // Big cube centered around world; use base color only (TexWeight=0)
  {
    const m = new Matrix4();
    // put sky roughly centered near map center
    m.translate(WORLD_W / 2, 10, WORLD_D / 2);
    m.scale(200, 200, 200);
    // NOTE: This draws a cube; to be a proper skybox you usually want inside faces.
    // For class projects, base-color sky cube is usually acceptable.
    cubeMesh.draw(m, {
      baseColor: [0.25, 0.55, 0.95, 1.0],
      texWeight: 0.0,
      whichTex: 0
    });
  }

  // --- GROUND ---
  // Flattened cube as a plane; optionally textured
  {
    const m = new Matrix4();
    m.translate(0, -0.5, 0);
    m.scale(WORLD_W, 1, WORLD_D);

    // Use texture 1 if loaded, else base color
    const useTex = textures.ready1 ? 1.0 : 0.0;
    cubeMesh.draw(m, {
      baseColor: [0.25, 0.8, 0.25, 1.0],
      texWeight: useTex,
      whichTex: 1
    });
  }

  // --- WALLS from map ---
  // Each cell spawns height cubes at y=0..h-1, translated by (x, y, z)
  const wallTexReady = textures.ready0;
  for (let z = 0; z < WORLD_D; z++) {
    for (let x = 0; x < WORLD_W; x++) {
      const h = worldMap[z][x] | 0;
      if (h <= 0) continue;

      for (let y = 0; y < Math.min(h, MAX_H); y++) {
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
function tick() {
  handleKeys();
  drawScene();
  requestAnimationFrame(tick);
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
    camera.updateProjection();
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
  initTexture(gl.TEXTURE0, u_Sampler0, "wall.jpg", "ready0");
  initTexture(gl.TEXTURE1, u_Sampler1, "grass.jpg", "ready1");

  tick();
}

main();
