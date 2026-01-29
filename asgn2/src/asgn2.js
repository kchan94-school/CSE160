// =================== Shaders ===================
const VSHADER_SOURCE = `
  attribute vec4 a_Position;
  uniform mat4 u_GlobalRotation;
  uniform mat4 u_ModelMatrix;

  void main() {
    gl_Position = u_GlobalRotation * u_ModelMatrix * a_Position;
  }
`;

const FSHADER_SOURCE = `
  precision mediump float;
  uniform vec4 u_FragColor;

  void main() {
    gl_FragColor = u_FragColor;
  }
`;

// =================== Globals ===================
let canvas, gl;
let a_Position, u_ModelMatrix, u_GlobalRotation, u_FragColor;

// UI / animation globals
let gAnimalGlobalRotation = 0;
let gElevationDeg = 0;
let gThighAngle = 20;
let gCalfAngle  = -20;
let gFootAngle  = 10;
let gNeckAngle = 15;
let gWingAngle = 10;
let gTailSpread = 180;
let gFeatherCount = 10;

// poke animation
let gPokeUntil = 0;

// poke animation timeline
let gPokeStart = 0;
let gPokeDuration = 1.25;

// extra body controls used only for poke
let gBodyPitch = 0;  // degrees
let gBodyDrop  = 0;  // world-ish units (translate down)
let gWinkL = 0;      // 0..1 (1 = fully closed)
let gWinkR = 0;      // 0..1


// mouse rotation
let g_isDragging = false;
let g_lastMouseX = 0;
let g_lastMouseY = 0;


let gAnimate = false;
let g_seconds = 0;
let g_startTime = 0;

// performance
let g_lastFpsTime = 0;
let g_frames = 0;

// cube buffer (created once)
let g_cubeVBO = null;
let g_cubeVertexCount = 0;

// matrix stack
const g_matrixStack = [];
function pushMatrix(m) { g_matrixStack.push(new Matrix4(m)); }
function popMatrix() { return g_matrixStack.pop(); }

// helper function
function triggerPoke() {
  gPokeStart = g_seconds;
  gPokeDuration = 1.25;
  gPokeUntil = gPokeStart + gPokeDuration;
}

// =================== Main ===================
function main() {
  canvas = document.getElementById("webgl");
  // gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  gl = canvas.getContext("webgl", { preserveDrawingBuffer: false });
  if (!gl) {
    console.log("Failed to get WebGL context.");
    return;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  console.log("DEPTH_BITS =", gl.getParameter(gl.DEPTH_BITS));

  if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
    console.log("Failed to init shaders.");
    return;
  }

  // Get locations
  a_Position      = gl.getAttribLocation(gl.program, "a_Position");
  u_ModelMatrix   = gl.getUniformLocation(gl.program, "u_ModelMatrix");
  u_GlobalRotation= gl.getUniformLocation(gl.program, "u_GlobalRotation");
  u_FragColor     = gl.getUniformLocation(gl.program, "u_FragColor");

  if (a_Position < 0 || !u_ModelMatrix || !u_GlobalRotation || !u_FragColor) {
    console.log("Failed to get shader variable locations.");
    return;
  }

  // Depth test per rubric
  gl.enable(gl.DEPTH_TEST);
  gl.clearDepth(1.0);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  // Build cube buffer ONCE
  initCubeBuffer();

  // UI
  setupUI();

  // Initial render + start tick loop
  g_startTime = performance.now();
  g_lastFpsTime = performance.now();
  renderScene();
  requestAnimationFrame(tick);
}

// =================== UI ===================
function setupUI() {
  function bindSlider(sliderId, valId, setter) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    s.addEventListener("input", () => {
      const x = Number(s.value);
      v.textContent = String(x);
      setter(x);
      renderScene();
    });
    v.textContent = s.value;
    setter(Number(s.value));
  }

  bindSlider("globalRotSlider", "globalRotVal", (x) => gAnimalGlobalRotation = x);
  bindSlider("elevationSlider", "elevationVal", (x) => gElevationDeg = x);
  bindSlider("thighSlider",     "thighVal",     (x) => gThighAngle = x);
  bindSlider("calfSlider",      "calfVal",      (x) => gCalfAngle  = x);
  bindSlider("footSlider",      "footVal",      (x) => gFootAngle  = x);

  // Peacock-specific joints
  bindSlider("neckSlider",      "neckVal",      (x) => gNeckAngle  = x);
  bindSlider("wingSlider",      "wingVal",      (x) => gWingAngle  = x);
  bindSlider("featherSlider", "featherVal", (x) => gFeatherCount = x);
  bindSlider("tailSlider",      "tailVal",      (x) => gTailSpread = x);

  document.getElementById("animOn").onclick  = () => { gAnimate = true; };
  document.getElementById("animOff").onclick = () => { gAnimate = false; };

  // ---- Mouse drag rotates animal ----
  let downX = 0, downY = 0;
  canvas.onmousedown = (e) => {
    g_isDragging = true;
    g_lastMouseX = e.clientX;
    g_lastMouseY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
  };

  canvas.onmouseup = (e) => {
    g_isDragging = false;

    // treat as a click only if mouse didn't move much
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);

    if (e.shiftKey && dist < 6) {
      triggerPoke();
    }
  };

  canvas.onmouseleave = () => { g_isDragging = false; };

  canvas.onmousemove = (e) => {
    if (!g_isDragging) return;
    const dx = e.clientX - g_lastMouseX;
    const dy = e.clientY - g_lastMouseY;
    g_lastMouseX = e.clientX;
    g_lastMouseY = e.clientY;

    gAnimalGlobalRotation += dx * 0.5;
    gElevationDeg += dy * 0.35;

    // clamp pitch
    if (gElevationDeg > 89) gElevationDeg = 89;
    if (gElevationDeg < -89) gElevationDeg = -89;

    // (optional) keep sliders visually synced
    const yawS = document.getElementById("globalRotSlider");
    const yawV = document.getElementById("globalRotVal");
    yawS.value = String(gAnimalGlobalRotation);
    yawV.textContent = String(Math.round(gAnimalGlobalRotation));

    const pitchS = document.getElementById("elevationSlider");
    const pitchV = document.getElementById("elevationVal");
    pitchS.value = String(gElevationDeg);
    pitchV.textContent = String(Math.round(gElevationDeg));

    renderScene();
  };

}

// =================== Cube Buffer ===================
function initCubeBuffer() {
  // 36 vertices, position only
  const v = new Float32Array([
    // Front (+z)
    -0.5,-0.5, 0.5,   0.5,-0.5, 0.5,   0.5, 0.5, 0.5,
    -0.5,-0.5, 0.5,   0.5, 0.5, 0.5,  -0.5, 0.5, 0.5,

    // Back (-z)
    -0.5,-0.5,-0.5,  -0.5, 0.5,-0.5,   0.5, 0.5,-0.5,
    -0.5,-0.5,-0.5,   0.5, 0.5,-0.5,   0.5,-0.5,-0.5,

    // Left (-x)
    -0.5,-0.5,-0.5,  -0.5,-0.5, 0.5,  -0.5, 0.5, 0.5,
    -0.5,-0.5,-0.5,  -0.5, 0.5, 0.5,  -0.5, 0.5,-0.5,

    // Right (+x)
     0.5,-0.5,-0.5,   0.5, 0.5,-0.5,   0.5, 0.5, 0.5,
     0.5,-0.5,-0.5,   0.5, 0.5, 0.5,   0.5,-0.5, 0.5,

    // Top (+y)
    -0.5, 0.5,-0.5,  -0.5, 0.5, 0.5,   0.5, 0.5, 0.5,
    -0.5, 0.5,-0.5,   0.5, 0.5, 0.5,   0.5, 0.5,-0.5,

    // Bottom (-y)
    -0.5,-0.5,-0.5,   0.5,-0.5,-0.5,   0.5,-0.5, 0.5,
    -0.5,-0.5,-0.5,   0.5,-0.5, 0.5,  -0.5,-0.5, 0.5,
  ]);

  g_cubeVertexCount = v.length / 3;

  g_cubeVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, g_cubeVBO);
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
}

// =================== Drawing ===================
function drawCube(M, colorRGBA) {
  // Set uniforms
  gl.uniformMatrix4fv(u_ModelMatrix, false, M.elements);
  gl.uniform4f(u_FragColor, colorRGBA[0], colorRGBA[1], colorRGBA[2], colorRGBA[3]);

  // Bind cube buffer once per draw
  gl.bindBuffer(gl.ARRAY_BUFFER, g_cubeVBO);
  gl.vertexAttribPointer(a_Position, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_Position);

  gl.drawArrays(gl.TRIANGLES, 0, g_cubeVertexCount);
}

function renderScene() {
  
  const t0 = performance.now();
  const globalRot = new Matrix4();

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Order matters.
  // Typical "camera orbit" feel: yaw around world Y, then pitch around world X.
  globalRot.rotate(gAnimalGlobalRotation, 0, 1, 0);
  globalRot.rotate(gElevationDeg, 1, 0, 0);

  gl.uniformMatrix4fv(u_GlobalRotation, false, globalRot.elements);

  // Draw your scene (animal)
  drawAnimal();

  // FPS indicator
  g_frames++;
  const now = performance.now();
  if (now - g_lastFpsTime >= 500) {
    const fps = (g_frames * 1000) / (now - g_lastFpsTime);
    const fpsEl = document.getElementById("fps");
    if (fpsEl) fpsEl.innerText = `FPS: ${fps.toFixed(1)}`;
    g_frames = 0;
    g_lastFpsTime = now;
  }

  const t1 = performance.now();
  const msEl = document.getElementById("ms");
  if (msEl) msEl.innerText = `MS: ${(t1 - t0).toFixed(2)}`;
}

function drawAnimal() {
  // Colors (tweak freely)
  const bodyColor  = [0.10, 0.35, 0.55, 1.0]; // teal-blue
  const neckColor  = [0.08, 0.30, 0.50, 1.0];
  const headColor  = [0.12, 0.40, 0.65, 1.0];
  const beakColor  = [0.90, 0.70, 0.15, 1.0];
  const legColor   = [0.65, 0.55, 0.30, 1.0];
  const wingColor  = [0.08, 0.30, 0.45, 1.0];
  const tailColorA = [0.05, 0.45, 0.35, 1.0];
  const tailColorB = [0.10, 0.55, 0.20, 1.0];
  const crestColor = [0.20, 0.70, 0.95, 1.0];

  const EPS = 0.002;

  // Root/base (you can later translate the whole peacock if desired)
  const root = new Matrix4();
  root.translate(0, -gBodyDrop, 0);
  root.rotate(gBodyPitch, 1, 0, 0);

  // ---------------- BODY ----------------
  const bodyBase = new Matrix4(root);
  const body = new Matrix4(bodyBase);
  body.scale(0.85, 0.40, 0.55);
  drawCube(body, bodyColor);

  // ---------------- NECK (attached to body) ----------------
  const neckBase = new Matrix4(bodyBase);
  neckBase.translate(0.0, 0.18, 0.20);     // top/front of body
  neckBase.rotate(gNeckAngle, 1, 0, 0);

  const NECK_LEN = 0.48;          // was 0.60
  const NECK_CENTER_Y = 0.24;     // was 0.30

  const neck = new Matrix4(neckBase);
  neck.translate(0.0, NECK_CENTER_Y, 0.0);
  neck.scale(0.14, NECK_LEN, 0.14);
  drawCube(neck, neckColor);

  // ---------------- HEAD (attached to neck tip) ----------------
  // head should attach near the top of the neck
  const headBase = new Matrix4(neckBase);
  headBase.translate(0.0, NECK_LEN + 0.02, 0.00);  // was 0.62

  const head = new Matrix4(headBase);
  head.scale(0.26, 0.20, 0.22);
  drawCube(head, headColor);

  // ---------------- EYES (tiny cubes) ----------------
  function drawEye(x, winkAmount) {
    // winkAmount: 0..1 (1 = closed)
    const eye = new Matrix4(headBase);
    eye.translate(x, 0.03, 0.115);  // on face
    // scale Y down as it closes (wink)
    const openY = 0.045;
    const y = openY * (1.0 - 0.92 * winkAmount); // never exactly 0 -> avoids weird artifacts
    eye.scale(0.04, y, 0.04);
    drawCube(eye, [0.05, 0.05, 0.05, 1.0]);
  }

  drawEye( 0.075, gWinkL);
  drawEye(-0.075, gWinkR);

  // ---------------- BEAK (small cube) ----------------
  const beak = new Matrix4(headBase);
  beak.translate(0.0, 0.00, 0.20);
  beak.scale(0.10, 0.06, 0.22);
  drawCube(beak, beakColor);

  // ---------------- CREST (3 little sticks) ----------------
  for (let i = -1; i <= 1; i++) {
    const crest = new Matrix4(headBase);
    crest.translate(0.05 * i, 0.18, 0.02);
    crest.rotate(-25 + 10 * i, 0, 0, 1);
    crest.scale(0.04, 0.18, 0.04);
    drawCube(crest, crestColor);
  }

  // ---------------- WINGS (2 parts) ----------------
  // Left wing
  const leftWingBase = new Matrix4(bodyBase);
  leftWingBase.translate(0.42, 0.05, 0.05);
  leftWingBase.rotate(-gWingAngle, 0, 0, 1);

  const leftWing = new Matrix4(leftWingBase);
  leftWing.translate(0.22, 0.0, 0.0);
  leftWing.scale(0.55, 0.10, 0.35);
  drawCube(leftWing, wingColor);

  // Right wing
  const rightWingBase = new Matrix4(bodyBase);
  rightWingBase.translate(-0.42, 0.05, 0.05);
  rightWingBase.rotate(gWingAngle, 0, 0, 1);

  const rightWing = new Matrix4(rightWingBase);
  rightWing.translate(-0.22, 0.0, 0.0);
  rightWing.scale(0.55, 0.10, 0.35);
  drawCube(rightWing, wingColor);

  // ---------------- LEGS (2 chains: thigh->calf->foot) ----------------
  // Helper to draw a 3-link leg chain
  function drawLeg(anchorX, anchorZ, thighAng, calfAng, footAng) {
    let L = new Matrix4(bodyBase);
    L.translate(anchorX, -0.05, anchorZ);

    // THIGH
    L.rotate(thighAng, 1, 0, 0);
    {
      const thigh = new Matrix4(L);
      thigh.translate(0, -0.18, 0);
      thigh.scale(0.10, 0.35, 0.10);
      drawCube(thigh, legColor);
    }

    // Knee
    L.translate(0, -0.35 - EPS, 0);

    // CALF
    L.rotate(calfAng, 1, 0, 0);
    {
      const calf = new Matrix4(L);
      calf.translate(0, -0.16, 0);
      calf.scale(0.09, 0.32, 0.09);
      drawCube(calf, legColor);
    }

    // Ankle
    L.translate(0, -0.32 - EPS, 0);

    // FOOT
    L.rotate(footAng, 1, 0, 0);
    {
      const foot = new Matrix4(L);
      foot.translate(0, -0.05, 0.06);
      foot.scale(0.14, 0.08, 0.24);
      drawCube(foot, legColor);
    }
  }

  // Use your existing sliders as the "primary" leg, and mirror/phase the other a bit
  const phase = (gAnimate ? Math.PI : 0.0);
  const t = (gAnimate ? Math.sin(2 * Math.PI * 1.2 * g_seconds + phase) : 0);

  // Left leg (slider-driven)
  drawLeg(0.18, 0.10, gThighAngle, gCalfAngle, gFootAngle);

  // Right leg (slightly offset when animating; otherwise matches)
  const thighR = gAnimate ? -gThighAngle : gThighAngle;
  const calfR  = gAnimate ? -gCalfAngle  : gCalfAngle;
  const footR  = gAnimate ? -gFootAngle  : gFootAngle;
  drawLeg(-0.18, 0.10, thighR, calfR, footR);

  // ---------------- TAIL BASE + FAN (lots of parts) ----------------
  const tailBase = new Matrix4(bodyBase);
  tailBase.translate(0.0, 0.0, -0.30);
  tailBase.rotate(-10, 1, 0, 0);

  // Tail base chunk (counts as a part)
  const tailChunk = new Matrix4(tailBase);
  tailChunk.translate(0.0, 0.05, -0.06);
  tailChunk.scale(0.20, 0.18, 0.18);
  drawCube(tailChunk, tailColorA);

  // Fan feathers (CONNECTED CHAIN + nicer "eye" spots)
  const N = Math.max(3, Math.floor(gFeatherCount)); // safety clamp
  const spread = gTailSpread;

  const featherLen = 0.95;     // length of the feather in world-ish units
  const featherThkX = 0.06;
  const featherThkZ = 0.03;

  // Where feathers attach relative to tailBase
  const attachY = 0.10;
  const attachZ = -0.02;

  for (let i = 0; i < N; i++) {
    const a = -spread * 0.5 + (spread * i) / (N - 1);

    // 1) Pivot at tail base, then attach point
    const featherPivot = new Matrix4(tailBase);
    featherPivot.translate(0.0, attachY, attachZ);

    // 2) Fan + tilt rotations happen at the attachment point
    featherPivot.rotate(a, 0, 0, 1);
    featherPivot.rotate(-35, 1, 0, 0);

    // 3) Draw the long feather as a segment extending from the base
    // Cube is centered, so move half the length along +Y to make its bottom touch attach point.
    const feather = new Matrix4(featherPivot);
    feather.translate(0.0, featherLen * 0.5, 0.0);
    feather.scale(featherThkX, featherLen, featherThkZ);

    const c = (i % 2 === 0) ? tailColorA : tailColorB;
    drawCube(feather, c);

    // 4) Eye spot at the feather TIP:
    // Tip in pivot-space is at y = featherLen
    const tip = new Matrix4(featherPivot);
    tip.translate(0.0, featherLen, 0.0);

    // Outer "gold" ring
    const eyeOuter = new Matrix4(tip);
    eyeOuter.translate(0.0, 0.04, 0.0);     // tiny lift above tip
    eyeOuter.scale(0.18, 0.12, 0.06);
    drawCube(eyeOuter, [0.90, 0.85, 0.15, 1.0]);

    // Middle teal
    const eyeMid = new Matrix4(tip);
    eyeMid.translate(0.0, 0.04, 0.006);     // slight z offset to avoid z-fight
    eyeMid.scale(0.13, 0.09, 0.05);
    drawCube(eyeMid, [0.05, 0.60, 0.55, 1.0]);

    // Inner dark center
    const eyeCore = new Matrix4(tip);
    eyeCore.translate(0.0, 0.04, 0.012);
    eyeCore.scale(0.07, 0.05, 0.04);
    drawCube(eyeCore, [0.05, 0.10, 0.12, 1.0]);
  }

}

// =================== Animation Loop ===================
function tick() {
  g_seconds = (performance.now() - g_startTime) / 1000.0;

  if (gAnimate || g_seconds < gPokeUntil) {
    updateAnimationAngles();
  }

  renderScene();
  requestAnimationFrame(tick);
}

function updateAnimationAngles() {
  const w = 2 * Math.PI * 1.2;

  const inPoke = (g_seconds < gPokeUntil);

  if (!inPoke) {
    // set these to 0
    gBodyPitch = 0;
    gBodyDrop  = 0;
    gWinkL = 0;
    gWinkR = 0;

    // walk-ish legs
    gThighAngle = 25 * Math.sin(w * g_seconds);
    gCalfAngle  = 20 * Math.sin(w * g_seconds + 1.1);
    gFootAngle  = 12 * Math.sin(w * g_seconds + 2.0);

    // peacock vibes
    gNeckAngle  = 10 + 8 * Math.sin(w * g_seconds + 0.6);
    gWingAngle  = 8 * Math.sin(w * g_seconds + 0.2);
    // Big tail fan during normal animation
    const s = 0.5 + 0.5 * Math.sin(0.7 * w * g_seconds); // 0..1
    gTailSpread = 90 + 60 * s; // 90..150 degrees

  } else {
    // POKE SEQUENCE: startle -> faint -> recover + flourish
    const dur = gPokeDuration;
    const u = Math.min(1, Math.max(0, (g_seconds - gPokeStart) / dur)); // 0..1

    // helpers
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const smooth = (x) => x * x * (3 - 2 * x); // smoothstep

    // phase windows
    const p0 = smooth(clamp01(u / 0.18));                // 0..~0.18  startle up
    const p1 = smooth(clamp01((u - 0.18) / 0.42));       // ~0.18..0.60 faint
    const p2 = smooth(clamp01((u - 0.60) / 0.40));       // ~0.60..1.00 recover

    // STARTLE: wings snap up, tail clamps shut, quick neck jerk
    const jitter = Math.sin(2 * Math.PI * 18 * g_seconds);

    gWingAngle = 65 * p0 + 12 * jitter * p0 * (1 - p1);
    // during recovery, briefly over-fan the tail
    gFeatherCount = 18 + 12 * Math.sin(Math.PI * p2);

    gTailSpread = 30 + 15 * (1 - p0); // briefly closes
    gNeckAngle = 25 * p0 - 10 * p1;

    // FAINT: body pitches forward + drops, legs go limp-ish
    gBodyPitch = 55 * p1 * (1 - p2);
    gBodyDrop  = 0.18 * p1 * (1 - p2);

    gThighAngle = -35 * p1;
    gCalfAngle  =  25 * p1;
    gFootAngle  =  15 * p1;

    // WINK + RECOVER: one eye closes mid-way; tail does a flourish on recovery
    // wink mostly during the middle, then opens
    const winkMid = smooth(clamp01((u - 0.28) / 0.18)) * (1 - smooth(clamp01((u - 0.62) / 0.18)));
    gWinkL = 0.0;
    gWinkR = winkMid; // right eye winks

    // Recovery flourish: tail fans big + wings settle
    gTailSpread = (1 - p2) * gTailSpread + p2 * (160 - 20 * Math.sin(2 * Math.PI * 3 * (u - 0.60)));
    gWingAngle  = (1 - p2) * gWingAngle  + p2 * (10 * Math.sin(2 * Math.PI * 2.5 * (u - 0.60)));

    // as you recover, return body back to normal
    gBodyPitch *= (1 - p2);
    gBodyDrop  *= (1 - p2);
  }

}

