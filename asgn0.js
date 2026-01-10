// asgn0.js

let canvas = null;
let ctx = null;

function clearCanvas() {
  // black background
  ctx.fillStyle = "rgba(0,0,0,1.0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawVector(v, color) {
  const scale = 20;
  const ox = canvas.width / 2;
  const oy = canvas.height / 2;

  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + v.elements[0] * scale, oy - v.elements[1] * scale);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function getNum(id) {
  const el = document.getElementById(id);
  return parseFloat(el.value);
}

function readV1() {
  return new Vector3([getNum("v1x"), getNum("v1y"), 0.0]);
}

function readV2() {
  return new Vector3([getNum("v2x"), getNum("v2y"), 0.0]);
}

function main() {
  canvas = document.getElementById("example");
  if (!canvas) {
    console.log("Failed to retrieve the <canvas> element");
    return;
  }
  ctx = canvas.getContext("2d");

  clearCanvas();
  // draw default vectors once on load
  handleDrawEvent();
}

// Step 3 + 4
function handleDrawEvent() {
  clearCanvas();

  const v1 = readV1();
  const v2 = readV2();

  drawVector(v1, "red");
  drawVector(v2, "blue");
}

// Step 5–8
function handleDrawOperationEvent() {
  clearCanvas();

  const v1 = readV1();
  const v2 = readV2();

  // always draw original vectors
  drawVector(v1, "red");
  drawVector(v2, "blue");

  const op = document.getElementById("opSelect").value;
  const s = parseFloat(document.getElementById("scalar").value);

  if (op === "add") {
    const v3 = new Vector3(v1.elements); // copy
    v3.add(v2);
    drawVector(v3, "green");
  } else if (op === "sub") {
    const v3 = new Vector3(v1.elements);
    v3.sub(v2);
    drawVector(v3, "green");
  } else if (op === "mul") {
    const v3 = new Vector3(v1.elements);
    const v4 = new Vector3(v2.elements);
    v3.mul(s);
    v4.mul(s);
    drawVector(v3, "green");
    drawVector(v4, "green");
  } else if (op === "div") {
    const v3 = new Vector3(v1.elements);
    const v4 = new Vector3(v2.elements);
    v3.div(s);
    v4.div(s);
    drawVector(v3, "green");
    drawVector(v4, "green");
  } else if (op === "magnitude") {
    console.log("||v1|| =", v1.magnitude());
    console.log("||v2|| =", v2.magnitude());

    // also visualize by drawing normalized vectors in green
    const n1 = new Vector3(v1.elements);
    const n2 = new Vector3(v2.elements);
    n1.normalize();
    n2.normalize();
    drawVector(n1, "green");
    drawVector(n2, "green");
  } else if (op === "normalize") {
    const n1 = new Vector3(v1.elements);
    const n2 = new Vector3(v2.elements);
    n1.normalize();
    n2.normalize();
    drawVector(n1, "green");
    drawVector(n2, "green");
  } else if (op === "angle") {
    const ang = angleBetween(v1, v2);
    console.log("Angle between v1 and v2 (degrees) =", ang);
  } else if (op === "area") {
    const area = areaTriangle(v1, v2);
    console.log("Area of triangle formed by v1 and v2 =", area);
  }
}

function angleBetween(v1, v2) {
  const denom = v1.magnitude() * v2.magnitude();
  if (denom === 0) return NaN;

  let cosA = Vector3.dot(v1, v2) / denom;

  // clamp for numeric safety
  cosA = Math.max(-1, Math.min(1, cosA));

  const radians = Math.acos(cosA);
  return (radians * 180) / Math.PI;
}

function areaTriangle(v1, v2) {
  const c = Vector3.cross(v1, v2);
  return c.magnitude() / 2.0;
}
