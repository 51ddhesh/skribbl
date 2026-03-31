// public/js/canvas.js

const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');

// State
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#000000';
let previousColor = '#000000';
let brushSize = 8;
let isMyTurn = false;
let currentTool = 'draw'; // 'draw' | 'erase' | 'fill'

// ── Canvas Sizing ──
function resizeCanvas() {
  const container = canvas.parentElement;
  const toolbar = document.getElementById('toolbar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 0;

  // Store current image
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight - toolbarH;

  // Fill white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Restore image if there was one
  if (tempCanvas.width > 0 && tempCanvas.height > 0) {
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
  }
}

window.addEventListener('resize', resizeCanvas);

// Initial resize after a short delay to ensure layout is ready
setTimeout(resizeCanvas, 100);

// ── Coordinate Helpers ──
function getNormalizedCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height
  };
}

// ── Drawing Events ──
canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('mouseleave', onPointerUp);

canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onPointerDown(e); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onPointerMove(e); }, { passive: false });
canvas.addEventListener('touchend', onPointerUp);

function onPointerDown(e) {
  if (!isMyTurn) return;

  if (currentTool === 'fill') {
    const coords = getNormalizedCoords(e);
    const px = Math.floor(coords.x * canvas.width);
    const py = Math.floor(coords.y * canvas.height);
    floodFill(px, py, currentColor);

    if (typeof socket !== 'undefined') {
      socket.emit('draw', {
        type: 'fill',
        x0: coords.x,
        y0: coords.y,
        x1: 0, y1: 0,
        color: currentColor,
        size: 0
      });
    }
    return;
  }

  isDrawing = true;
  const coords = getNormalizedCoords(e);
  lastX = coords.x;
  lastY = coords.y;

  // Draw a dot on click
  const strokeData = {
    type: currentTool === 'erase' ? 'erase' : 'draw',
    x0: coords.x,
    y0: coords.y,
    x1: coords.x,
    y1: coords.y,
    color: currentTool === 'erase' ? '#FFFFFF' : currentColor,
    size: currentTool === 'erase' ? brushSize * 3 : brushSize
  };
  drawStroke(strokeData);
  if (typeof socket !== 'undefined') {
    socket.emit('draw', strokeData);
  }
}

function onPointerMove(e) {
  if (!isDrawing || !isMyTurn) return;

  const coords = getNormalizedCoords(e);

  const strokeData = {
    type: currentTool === 'erase' ? 'erase' : 'draw',
    x0: lastX,
    y0: lastY,
    x1: coords.x,
    y1: coords.y,
    color: currentTool === 'erase' ? '#FFFFFF' : currentColor,
    size: currentTool === 'erase' ? brushSize * 3 : brushSize
  };

  drawStroke(strokeData);
  if (typeof socket !== 'undefined') {
    socket.emit('draw', strokeData);
  }

  lastX = coords.x;
  lastY = coords.y;
}

function onPointerUp() {
  isDrawing = false;
}

// ── Render Functions ──
function drawStroke(data) {
  if (data.type === 'fill') {
    const px = Math.floor(data.x0 * canvas.width);
    const py = Math.floor(data.y0 * canvas.height);
    floodFill(px, py, data.color);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(data.x0 * canvas.width, data.y0 * canvas.height);
  ctx.lineTo(data.x1 * canvas.width, data.y1 * canvas.height);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.closePath();
}

function clearCanvas() {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function replayStrokes(strokes) {
  clearCanvas();
  strokes.forEach(s => drawStroke(s));
}

// ── Flood Fill ──
function floodFill(startX, startY, fillColor) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const targetColor = getPixel(data, startX, startY, w);
  const fill = hexToRgb(fillColor);

  if (targetColor[0] === fill.r && targetColor[1] === fill.g && targetColor[2] === fill.b) return;

  const stack = [[startX, startY]];
  const visited = new Set();

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const key = y * w + x;

    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    if (visited.has(key)) continue;

    const px = getPixel(data, x, y, w);
    if (!colorMatch(px, targetColor, 30)) continue;

    visited.add(key);
    setPixel(data, x, y, w, fill);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);

    // Safety limit
    if (visited.size > w * h * 0.8) break;
  }

  ctx.putImageData(imageData, 0, 0);
}

function getPixel(data, x, y, w) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function setPixel(data, x, y, w, color) {
  const i = (y * w + x) * 4;
  data[i] = color.r;
  data[i + 1] = color.g;
  data[i + 2] = color.b;
  data[i + 3] = 255;
}

function colorMatch(c1, c2, tolerance) {
  return Math.abs(c1[0] - c2[0]) <= tolerance &&
         Math.abs(c1[1] - c2[1]) <= tolerance &&
         Math.abs(c1[2] - c2[2]) <= tolerance;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

// ── Toolbar Handlers ──
document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    currentColor = swatch.dataset.color;
    previousColor = currentColor;

    // Switch back to draw tool when picking color
    if (currentTool === 'erase') {
      currentTool = 'draw';
      document.getElementById('eraserBtn').classList.remove('active');
    }
    updateCursor();
  });
});

document.querySelectorAll('[data-size]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-size]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushSize = parseInt(btn.dataset.size);
  });
});

document.getElementById('eraserBtn').addEventListener('click', () => {
  const btn = document.getElementById('eraserBtn');
  if (currentTool === 'erase') {
    currentTool = 'draw';
    btn.classList.remove('active');
  } else {
    currentTool = 'erase';
    btn.classList.add('active');
    document.getElementById('fillBtn').classList.remove('active');
  }
  updateCursor();
});

document.getElementById('fillBtn').addEventListener('click', () => {
  const btn = document.getElementById('fillBtn');
  if (currentTool === 'fill') {
    currentTool = 'draw';
    btn.classList.remove('active');
  } else {
    currentTool = 'fill';
    btn.classList.add('active');
    document.getElementById('eraserBtn').classList.remove('active');
  }
  updateCursor();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!isMyTurn) return;
  clearCanvas();
  if (typeof socket !== 'undefined') {
    socket.emit('clear-canvas');
  }
});

function updateCursor() {
  if (!isMyTurn) {
    canvas.style.cursor = 'default';
    return;
  }
  if (currentTool === 'fill') {
    canvas.style.cursor = 'cell';
  } else if (currentTool === 'erase') {
    canvas.style.cursor = 'grab';
  } else {
    canvas.style.cursor = 'crosshair';
  }
}

function setDrawingEnabled(enabled) {
  isMyTurn = enabled;
  const toolbar = document.getElementById('toolbar');
  const canvasArea = document.getElementById('canvasArea');

  if (enabled) {
    toolbar.classList.remove('disabled');
    canvasArea.classList.add('my-turn');
  } else {
    toolbar.classList.add('disabled');
    canvasArea.classList.remove('my-turn');
  }
  updateCursor();
}