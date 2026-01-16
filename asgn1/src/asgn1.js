// =================== Shaders ===================
const VERTEX_SHADER = `
  precision mediump float;
  attribute vec2 a_Position;
  uniform float u_PointSize;
  void main() {
    gl_Position = vec4(a_Position, 0.0, 1.0);
    gl_PointSize = u_PointSize;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec4 u_FragColor;
  void main() {
    gl_FragColor = u_FragColor;
  }
`;

// =================== Globals ===================
let canvas;
let gl;

let a_Position;
let u_FragColor;
let u_PointSize;
let g_selectedAngleDeg = 0; // degrees

let g_showGrid = true;

const shapesList = []; // required: single list holding everything

// UI state
const g_selectedColor = [1, 1, 1, 1];
let g_selectedSize = 10;      // in pixels-ish
let g_selectedType = "square"; // "square" | "triangle" | "circle"
let g_selectedSegments = 12;

// A single buffer we reuse for drawing
let g_vertexBuffer;

const undoStack = [];     // each entry: { type: 'add', count: N } or { type:'clear', prev:[...] }
const redoStack = [];
let g_isDragging = false;
let g_strokeCount = 0;

// brush mode: "drag" or "click"
let g_brushMode = "drag";


// =================== Shape Classes ===================
class Triangle {
  constructor(position, color, size, angleDeg) {
    this.position = position;
    this.color = color;
    this.size = size;
    this.angleDeg = angleDeg;
  }

  render() {
    gl.uniform4f(u_FragColor, ...this.color);
    gl.uniform1f(u_PointSize, 1.0);

    const [cx, cy] = this.position;
    const d = sizeToClip(this.size);
    const rad = (this.angleDeg * Math.PI) / 180;

    // Base upright triangle around center
    const p1 = [cx,     cy + d];
    const p2 = [cx - d, cy - d];
    const p3 = [cx + d, cy - d];

    // Rotate each vertex about (cx,cy)
    const r1 = rotateAbout(p1[0], p1[1], cx, cy, rad);
    const r2 = rotateAbout(p2[0], p2[1], cx, cy, rad);
    const r3 = rotateAbout(p3[0], p3[1], cx, cy, rad);

    const verts = new Float32Array([
      r1[0], r1[1],
      r2[0], r2[1],
      r3[0], r3[1],
    ]);

    drawTriangles(verts);
  }
}

class Square {
  constructor(position, color, size, angleDeg) {
    this.position = position; // [cx, cy]
    this.color = color;       // [r,g,b,a]
    this.size = size;         // slider size
    this.angleDeg = angleDeg; // degrees
  }

  render() {
    gl.uniform4f(u_FragColor, ...this.color);
    gl.uniform1f(u_PointSize, 1.0);

    const [cx, cy] = this.position;
    const d = sizeToClip(this.size);
    const rad = (this.angleDeg * Math.PI) / 180;

    // Unrotated corners (axis-aligned square centered at (cx,cy))
    const pTL = [cx - d, cy + d];
    const pTR = [cx + d, cy + d];
    const pBR = [cx + d, cy - d];
    const pBL = [cx - d, cy - d];

    // Rotate each corner about center
    const rTL = rotateAbout(pTL[0], pTL[1], cx, cy, rad);
    const rTR = rotateAbout(pTR[0], pTR[1], cx, cy, rad);
    const rBR = rotateAbout(pBR[0], pBR[1], cx, cy, rad);
    const rBL = rotateAbout(pBL[0], pBL[1], cx, cy, rad);

    // Two triangles: (TL, TR, BR) and (TL, BR, BL)
    const verts = new Float32Array([
      rTL[0], rTL[1],
      rTR[0], rTR[1],
      rBR[0], rBR[1],

      rTL[0], rTL[1],
      rBR[0], rBR[1],
      rBL[0], rBL[1],
    ]);

    drawTriangles(verts);
  }
}



class Circle {
  constructor(position, color, size, segments) {
    this.position = position;
    this.color = color;
    this.size = size;
    this.segments = segments;
  }
  render() {
    gl.uniform4f(u_FragColor, ...this.color);
    gl.uniform1f(u_PointSize, 1.0);

    const [cx, cy] = this.position;
    const r = sizeToClip(this.size);

    // Triangle fan: center + ring points
    const verts = [];
    verts.push(cx, cy);

    for (let i = 0; i <= this.segments; i++) {
      const ang = (i / this.segments) * Math.PI * 2;
      verts.push(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, g_vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

    gl.vertexAttribPointer(a_Position, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(a_Position);

    gl.drawArrays(gl.TRIANGLE_FAN, 0, verts.length / 2);
  }
}

// ============== DRAW MY PICTURE ===============

class CustomTriangle {
  constructor(verts, color) {
    // verts = [x1,y1,x2,y2,x3,y3] in clip coords
    this.verts = verts;
    this.color = color;
  }
  render() {
    gl.uniform4f(u_FragColor, ...this.color);
    gl.uniform1f(u_PointSize, 1.0);
    drawTriangles(new Float32Array(this.verts));
  }
}

function addTri(x1,y1,x2,y2,x3,y3, color) {
  shapesList.push(new CustomTriangle([x1,y1,x2,y2,x3,y3], color));
}

function drawGridOverlay(step = 0.2) {
  // Draw thin lines using triangles (two tris per line)
  const lineColor = [0.25, 0.25, 0.25, 1.0];
  const axisColor = [0.6, 0.6, 0.6, 1.0];

  const thickness = 0.003; // clip-space thickness

  // vertical grid lines
  for (let x = -1; x <= 1.0001; x += step) {
    const c = (Math.abs(x) < 1e-6) ? axisColor : lineColor;
    addRectAsTwoTris(x - thickness, -1, x + thickness, 1, c);
  }
  // horizontal grid lines
  for (let y = -1; y <= 1.0001; y += step) {
    const c = (Math.abs(y) < 1e-6) ? axisColor : lineColor;
    addRectAsTwoTris(-1, y - thickness, 1, y + thickness, c);
  }
}

function addRectAsTwoTris(xMin, yMin, xMax, yMax, color) {
  // (xMin,yMax)---(xMax,yMax)
  //     |             |
  // (xMin,yMin)---(xMax,yMin)
  addTri(xMin, yMax, xMax, yMax, xMax, yMin, color);
  addTri(xMin, yMax, xMax, yMin, xMin, yMin, color);
}

function drawMyPicture() {
  // Wipe current drawing (and make it undoable)
  undoStack.push({ type: "clear", prev: shapesList.slice() });
  redoStack.length = 0;
  shapesList.length = 0;

 
  // --------------------------
  // TEMPLATE PICTURE EXAMPLE
  // --------------------------
  // We'll draw:
  // - a background panel
  // - a "mountain" triangle
  // - a "sun" made of triangle fan pieces
  // - a big blank area where you'll later add initials with triangles

  // Background rectangle (two triangles)
  addRectAsTwoTris(-1, -1, 1, 1, [0.05, 0.07, 0.10, 1.0]);

  // Ground strip
  addRectAsTwoTris(-1, -1, 1, -0.4, [0.08, 0.12, 0.08, 1.0]);

  // Mountain (big triangle)
  addTri(-0.9, -0.4, -0.2, 0.6, 0.5, -0.4, [0.18, 0.22, 0.28, 1.0]);

  // Snow cap (smaller triangle on top)
  addTri(-0.25, 0.45, -0.08, 0.6, 0.10, 0.40, [0.85, 0.88, 0.92, 1.0]);

  // Sun as triangle-fan slices
  addCircleFan(0.7, 0.7, 0.18, 18, [0.95, 0.75, 0.15, 1.0]);

  // Placeholder panel for initials area
  addRectAsTwoTris(-0.95, -0.35, -0.34, 0.15, [0.10, 0.10, 0.13, 1.0]);

  // Placeholder "KC" (VERY rough). Replace later with nicer triangles.
  drawInitialsTemplate_KC();

  renderAllShapes();
}

function addCircleFan(cx, cy, r, segments, color) {
  // Build triangles around center
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    addTri(
      cx, cy,
      cx + r * Math.cos(a0), cy + r * Math.sin(a0),
      cx + r * Math.cos(a1), cy + r * Math.sin(a1),
      color
    );
  }
}

function drawInitialsTemplate_KC() {
  const c = [0.2, 0.8, 1.0, 1.0]; // cyan-ish

  // K: vertical bar (rectangle)
  addRectAsTwoTris(-0.90, -0.30, -0.84, 0.10, c);

  // K: upper diagonal (two triangles forming a thin quad)
  addTri(-0.84, -0.02, -0.70, 0.10, -0.78, 0.02, c);
  addTri(-0.84, -0.02, -0.70, 0.10, -0.76, -0.06, c);

  // K: lower diagonal
  addTri(-0.84, -0.02, -0.70, -0.30, -0.78, -0.10, c);
  addTri(-0.84, -0.02, -0.70, -0.30, -0.76, -0.22, c);

  // C: chunky arc made from fan slices with a "cutout" illusion
  addCircleFan(-0.52, -0.10, 0.18, 20, c);
  // inner cutout (draw with background color to hollow it)
  addCircleFan(-0.52, -0.10, 0.12, 20, [0.10, 0.10, 0.13, 1.0]);
  // remove right side chunk to make it a "C" (paint over with background)
  addRectAsTwoTris(-0.50, -0.30, -0.34, 0.10, [0.10, 0.10, 0.13, 1.0]);
}


// =================== Required Organization ===================
function setupWebGL() {
  canvas = document.getElementById("webgl");
  gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) {
    console.log("Failed to get WebGL context.");
    return false;
  }
  return true;
}

function connectVariablesToGLSL() {
  if (!initShaders(gl, VERTEX_SHADER, FRAGMENT_SHADER)) {
    console.log("Failed to init shaders");
    return false;
  }

  a_Position = gl.getAttribLocation(gl.program, "a_Position");
  u_FragColor = gl.getUniformLocation(gl.program, "u_FragColor");
  u_PointSize = gl.getUniformLocation(gl.program, "u_PointSize");

  if (a_Position < 0 || !u_FragColor || !u_PointSize) {
    console.log("Failed to get shader variable locations");
    return false;
  }

  g_vertexBuffer = gl.createBuffer();
  if (!g_vertexBuffer) {
    console.log("Failed to create buffer");
    return false;
  }

  return true;
}

function renderAllShapes() {
  gl.clear(gl.COLOR_BUFFER_BIT);

  for (const s of shapesList) {
    s.render();
  }

  // Draw grid LAST so it overlays everything
  if (g_showGrid) {
    drawGridOverlayNow(0.2);
  }
}

// Handles click OR drag paint event
function click(ev) {
  const [x, y] = convertEventToGL(ev);

  const color = [...g_selectedColor];
  const size = g_selectedSize;

  if (g_selectedType === "square") {
    addShape(new Square([x, y], color, size, g_selectedAngleDeg));
    } else if (g_selectedType === "triangle") {
    addShape(new Triangle([x, y], color, size, g_selectedAngleDeg));
    } else {
    addShape(new Circle([x, y], color, size, g_selectedSegments));
    }


  renderAllShapes();
}


// =================== Helpers ===================
function convertEventToGL(ev) {
  const rect = ev.target.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;

  // Convert to clip space [-1,1]
  const x = (mx / canvas.width) * 2 - 1;
  const y = 1 - (my / canvas.height) * 2;
  return [x, y];
}

// Convert "pixel-ish size" to clip-space radius
function sizeToClip(sizePx) {
  // roughly: pixels / canvasWidth * 2
  return (sizePx / canvas.width) * 2.0;
}

function drawTriangles(vertsFloat32) {
  gl.bindBuffer(gl.ARRAY_BUFFER, g_vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertsFloat32, gl.DYNAMIC_DRAW);

  gl.vertexAttribPointer(a_Position, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_Position);

  gl.drawArrays(gl.TRIANGLES, 0, vertsFloat32.length / 2);
}

function rotateAbout(x, y, cx, cy, rad) {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function drawRectNow(xMin, yMin, xMax, yMax, color) {
  gl.uniform4f(u_FragColor, ...color);
  gl.uniform1f(u_PointSize, 1.0);

  // two triangles forming a rectangle
  const verts = new Float32Array([
    xMin, yMax,  xMax, yMax,  xMax, yMin,
    xMin, yMax,  xMax, yMin,  xMin, yMin,
  ]);

  drawTriangles(verts);
}

function drawGridOverlayNow(step = 0.2) {
  const lineColor = [0.25, 0.25, 0.25, 1.0];
  const axisColor = [0.6, 0.6, 0.6, 1.0];
  const thickness = 0.003;

  // vertical lines
  for (let x = -1; x <= 1.0001; x += step) {
    const c = (Math.abs(x) < 1e-6) ? axisColor : lineColor;
    drawRectNow(x - thickness, -1, x + thickness, 1, c);
  }
  // horizontal lines
  for (let y = -1; y <= 1.0001; y += step) {
    const c = (Math.abs(y) < 1e-6) ? axisColor : lineColor;
    drawRectNow(-1, y - thickness, 1, y + thickness, c);
  }
}



function addActionsForHtmlUI() {
    // Brush buttons
    document.getElementById("squareBtn").onclick = () => (g_selectedType = "square");
    document.getElementById("triBtn").onclick = () => (g_selectedType = "triangle");
    document.getElementById("circBtn").onclick = () => (g_selectedType = "circle");
    document.getElementById("dragModeBtn").onclick = () => (g_brushMode = "drag");
    document.getElementById("clickModeBtn").onclick = () => (g_brushMode = "click");
    
    // Undo/Redo
    document.getElementById("undoBtn").onclick = undo;
    document.getElementById("redoBtn").onclick = redo;

    // Draw Picture
    document.getElementById("drawPicBtn").onclick = drawMyPicture;
    document.getElementById("toggleGridBtn").onclick = () => {
      g_showGrid = !g_showGrid;
      renderAllShapes();
    };


    // Clear button
    document.getElementById("clearBtn").onclick = () => {
    // store a shallow copy of old list
    undoStack.push({ type: "clear", prev: shapesList.slice() });
    shapesList.length = 0;
    redoStack.length = 0;
    renderAllShapes();
    };


    // RGB sliders (live update)
    const hookColor = (id, idx, labelId) => {
        const el = document.getElementById(id);
        const lab = document.getElementById(labelId);
        const update = () => {
        g_selectedColor[idx] = Number(el.value) / 100;
        lab.textContent = g_selectedColor[idx].toFixed(2);
        };
        el.addEventListener("input", update);
        update();
    };
    hookColor("redS", 0, "redVal");
    hookColor("greenS", 1, "greenVal");
    hookColor("blueS", 2, "blueVal");

    // Size slider
    const sizeS = document.getElementById("sizeS");
    const sizeVal = document.getElementById("sizeVal");
    const updateSize = () => {
        g_selectedSize = Number(sizeS.value);
        sizeVal.textContent = String(g_selectedSize);
    };
    sizeS.addEventListener("input", updateSize);
    updateSize();

    // Segments slider
    const segS = document.getElementById("segS");
    const segVal = document.getElementById("segVal");
    const updateSeg = () => {
        g_selectedSegments = Number(segS.value);
        segVal.textContent = String(g_selectedSegments);
    };
    segS.addEventListener("input", updateSeg);
    updateSeg();

    // Angle slider
    const angleS = document.getElementById("angleS");
    const angleVal = document.getElementById("angleVal");
    const updateAngle = () => {
    g_selectedAngleDeg = Number(angleS.value);
    angleVal.textContent = `${g_selectedAngleDeg}°`;
    };
    angleS.addEventListener("input", updateAngle);
    updateAngle();

}

function addShape(s) {
  shapesList.push(s);
  g_strokeCount += 1;   // counts shapes in current action
}


function undo() {
  const action = undoStack.pop();
  if (!action) return;

  if (action.type === "add") {
    const removed = shapesList.splice(-action.count, action.count); // capture removed
    redoStack.push({ type: "add", shapes: removed });
    renderAllShapes();
  } else if (action.type === "clear") {
    // current state is empty (after clear), restore old
    shapesList.length = 0;
    shapesList.push(...action.prev);
    redoStack.push({ type: "clear", prev: action.prev }); // redo will clear again
    renderAllShapes();
  }
}

function redo() {
  const action = redoStack.pop();
  if (!action) return;

  if (action.type === "add") {
    // re-add the exact shapes that were removed
    shapesList.push(...action.shapes);
    undoStack.push({ type: "add", count: action.shapes.length });
    renderAllShapes();
  } else if (action.type === "clear") {
    // redo the clear: store what we're about to clear so undo works
    undoStack.push({ type: "clear", prev: shapesList.slice() });
    shapesList.length = 0;
    renderAllShapes();
  }
}



function beginAction() {
  g_strokeCount = 0;
}

function endAction() {
  if (g_strokeCount > 0) {
    undoStack.push({ type: "add", count: g_strokeCount });
    redoStack.length = 0; // NEW: new action kills redo history
  }
  g_strokeCount = 0;
}


// =================== main ===================
function main() {
  if (!setupWebGL()) return;
  if (!connectVariablesToGLSL()) return;

  document.addEventListener("keydown", (e) => {
  const z = e.key.toLowerCase() === "z";
  const y = e.key.toLowerCase() === "y";
  if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) { e.preventDefault(); redo(); }
    });


  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  addActionsForHtmlUI();

  canvas.onmousedown = (ev) => {
    beginAction();
    g_isDragging = true;

    // Always draw once on mousedown
    click(ev);
    renderAllShapes();

    // If click-only mode, finalize action immediately
    if (g_brushMode === "click") {
        g_isDragging = false;
        endAction();
    }
    };

    canvas.onmousemove = (ev) => {
    if (!g_isDragging) return;
    if (g_brushMode !== "drag") return;
    if (ev.buttons !== 1) return;

    click(ev);
    };

    canvas.onmouseup = () => {
    if (!g_isDragging) return;
    g_isDragging = false;
    endAction();
    };

    canvas.onmouseleave = () => {
    // treat leaving canvas like mouseup
    if (!g_isDragging) return;
    g_isDragging = false;
    endAction();
    };
}
