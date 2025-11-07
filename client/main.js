// client/main.js

// Connect to server (same origin)
const socket = io();

// Basic config
const ROOM_ID = 'room1';

// DOM elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const usernameInput = document.getElementById('username');
const colorInput = document.getElementById('color');
const sizeInput = document.getElementById('size');
const brushBtn = document.getElementById('brushBtn');
const eraserBtn = document.getElementById('eraserBtn');
const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const presenceList = document.getElementById('presenceList');

// Application state
const app = {
  clientId: null,
  peers: {},           // clientId -> { username, color }
  ops: [],             // ordered op log (stamped ops from server)
  layerCache: new Map(), // opID -> offscreen canvas element for efficient redraw
  tool: 'brush',
  color: colorInput.value,
  size: Number(sizeInput.value),
  drawing: false,
  currentPoints: [],   // points buffer for current stroke
  tempCounter: 0,
  lastSendTime: 0,
  sendThrottleMs: 40,  // batching time for strokes
  pendingLocalTempMap: new Map(), // tempClientId -> op mapping (helps map local stroke to server op)
};

// Cursor drawing: ephemeral overlay
const peerCursors = new Map();

// Helpers: set canvas size to match CSS (high-DPI safe)
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing operations for device pixel ratio
  redrawAll();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Join the room
function joinRoom() {
  const name = usernameInput.value.trim() || `User-${Math.floor(Math.random()*1000)}`;
  const color = colorInput.value;
  socket.emit('join_room', { roomId: ROOM_ID, username: name, color });
}
usernameInput.addEventListener('change', joinRoom);
colorInput.addEventListener('change', () => app.color = colorInput.value);

// When server confirms join
socket.on('joined', (data) => {
  app.clientId = data.clientId;
  // populate peers list
  app.peers = {};
  (data.peers || []).forEach(p => app.peers[p.clientId] = p);
  updatePresenceUI();
});

// When server sends presence updates
socket.on('presence', ({ clients }) => {
  app.peers = {};
  (clients || []).forEach(p => app.peers[p.clientId] = p);
  updatePresenceUI();
});

// On initial history: get ops to replay
socket.on('history', ({ ops }) => {
  // Replace local ops with server ops snapshot (trust server)
  syncOpsFromServer(ops || []);
});

// Generic op handler from server
socket.on('op', (op) => {
  // Append op and apply it
  applyStampedOp(op);
});

// Peer cursor updates
socket.on('peer_cursor', ({ clientId, x, y }) => {
  // draw small cursor indicator for peer - here we keep it simple and ephemeral
  // For a production UI you'd keep a map of peer cursors and show names.
  drawPeerCursor(clientId, x, y);
});


function drawPeerCursor(clientId, x, y) {
  peerCursors.set(clientId, { x, y, ts: Date.now() });
  // Schedule clean & redraw
  requestAnimationFrame(redrawAll);
  // Remove after 3s of inactivity
  setTimeout(() => {
    const entry = peerCursors.get(clientId);
    if (entry && Date.now() - entry.ts > 3000) {
      peerCursors.delete(clientId);
      redrawAll();
    }
  }, 3500);
}

// UI presence list
function updatePresenceUI() {
  presenceList.innerHTML = '';
  for (const [id, info] of Object.entries(app.peers)) {
    const li = document.createElement('li');
    li.textContent = info.username || id.slice(0,6);
    li.style.borderLeft = `8px solid ${info.color || '#ccc'}`;
    presenceList.appendChild(li);
  }
}

// Drawing helpers
function point(x, y) { return { x, y, t: Date.now() }; }

// Simple quadratic smoothing between triplets of points -> return array of curve segments
// We'll use a common smoothing approach: for i from 0..n-2 create quadratic curve from p[i] to p[i+1] using midpoints.
function drawSmoothPathOnCtx(ctx, points, { color, width, tool }) {
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();

  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }

  if (points.length === 1) {
    const p = points[0];
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Move to first point
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    const midX = (points[i - 1].x + points[i].x) / 2;
    const midY = (points[i - 1].y + points[i].y) / 2;
    ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, midX, midY);
  }
  // Last segment to final point
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

// Offscreen layer manager: create an offscreen canvas per opID (helps undo)
function createLayerForOp(op) {
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  layer.style.display = 'none';
  layer.getContext('2d').setTransform(ctx.getTransform());
  return layer;
}

function renderStrokeToLayer(layer, op) {
  const lctx = layer.getContext('2d');
  const p = op.payload;
  drawSmoothPathOnCtx(lctx, p.points, { color: p.color, width: p.width, tool: p.tool });
}

// Redraw all active ops by compositing layers
function redrawAll() {
  // clear main canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // composite each op layer in order
  for (const op of app.ops) {
    if (op.type === 'stroke' && op.active !== false) {
      // ensure we have a layer for this op
      if (!app.layerCache.has(op.opID)) {
        const layer = createLayerForOp(op);
        renderStrokeToLayer(layer, op);
        app.layerCache.set(op.opID, layer);
      }
      const layer = app.layerCache.get(op.opID);
      ctx.drawImage(layer, 0, 0);
    }
    // ignore undo/redo ops visually; they modify op.active flags which change composition
  }

  // draw in-progress stroke on top (client-side prediction)
  if (app.drawing && app.currentPoints.length > 0) {
    drawSmoothPathOnCtx(ctx, app.currentPoints, { color: app.color, width: app.size, tool: app.tool });
  }

  // draw peer cursors
  for (const [clientId, c] of peerCursors) {
    const info = app.peers[clientId] || {};
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = info.color || '#f00';
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // draw label
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText((info.username || clientId.slice(0,6)), c.x + 8, c.y + 4);
    ctx.restore();
  }
}

// Apply a stamped op from server (append to op log, update layers if needed)
function applyStampedOp(op) {
  // Defensive: skip if we already have this op
  if (app.ops.some(o => o.opID === op.opID)) return;

  app.ops.push(op);

  if (op.type === 'stroke') {
    // Render stroke into offscreen layer for efficient future compositing
    const layer = createLayerForOp(op);
    renderStrokeToLayer(layer, op);
    app.layerCache.set(op.opID, layer);
  } else if (op.type === 'undo') {
    // server already updated the target op.active flag, but ensure local copy marks it false too
    const target = op.payload && op.payload.targetOpID;
    if (target) {
      for (const o of app.ops) {
        if (o.opID === target) {
          o.active = false;
          // optionally delete its layer to free memory
          // but keep it for redo (we could keep or drop based on memory)
          // app.layerCache.delete(target);
        }
      }
    }
  } else if (op.type === 'redo') {
    const target = op.payload && op.payload.targetOpID;
    if (target) {
      for (const o of app.ops) {
        if (o.opID === target) {
          o.active = true;
        }
      }
    }
  }

  // if this op corresponds to a local temporary id, map it
  if (op.payload && op.payload.tempClientId) {
    app.pendingLocalTempMap.set(op.payload.tempClientId, op.opID);
  }

  // Keep op log size manageable here (not doing snapshot compaction in prototype)
  redrawAll();
}

// Sync entire op list from server (used on first join)
function syncOpsFromServer(serverOps) {
  app.ops = serverOps.slice(); // copy
  // Recreate layers for active strokes
  app.layerCache.clear();
  for (const op of app.ops) {
    if (op.type === 'stroke' && op.active !== false) {
      const layer = createLayerForOp(op);
      renderStrokeToLayer(layer, op);
      app.layerCache.set(op.opID, layer);
    }
  }
  redrawAll();
}

// Pointer events (covers mouse & touch via Pointer Events API)
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  app.drawing = true;
  app.currentPoints = [ point(e.offsetX, e.offsetY) ];
  app.lastSendTime = 0;
});

canvas.addEventListener('pointermove', (e) => {
  // send cursor updates frequently
  socket.emit('cursor', { roomId: ROOM_ID, x: e.offsetX, y: e.offsetY });

  if (!app.drawing) return;
  app.currentPoints.push(point(e.offsetX, e.offsetY));
  // local immediate render (prediction)
  redrawAll();

  // Throttle/batch network sends for strokes
  const now = Date.now();
  if (now - app.lastSendTime > app.sendThrottleMs) {
    sendStrokeChunk(false); // not final
    app.lastSendTime = now;
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!app.drawing) return;
  app.drawing = false;
  // send finalize chunk
  sendStrokeChunk(true);
  app.currentPoints = [];
});

canvas.addEventListener('pointercancel', () => {
  app.drawing = false;
  app.currentPoints = [];
});

// Create a temporary ID for client predictions and map to server op later
function makeTempId() {
  app.tempCounter++;
  return `${app.clientId || 'local'}::t${app.tempCounter}`;
}

// Send stroke chunk (either intermediate or finalize). We include a tempClientId for mapping.
function sendStrokeChunk(finalize) {
  if (app.currentPoints.length === 0) return;
  const tempId = makeTempId();
  const op = {
    roomId: ROOM_ID,
    type: 'stroke',
    payload: {
      tempClientId: tempId,
      points: app.currentPoints.slice(),
      color: app.color,
      width: app.size,
      tool: app.tool,
      finalize: !!finalize
    }
  };
  // For immediate UX we already rendered prediction locally; server will stamp and broadcast back
  socket.emit('op', op);
}

// Undo: send op request to server. Server will stamp and broadcast the undo op after choosing target.
function requestUndo() {
  const op = { roomId: ROOM_ID, type: 'undo', payload: {} };
  socket.emit('op', op);
}

// Bind controls
brushBtn.addEventListener('click', () => { app.tool = 'brush'; brushBtn.classList.add('active'); eraserBtn.classList.remove('active'); });
eraserBtn.addEventListener('click', () => { app.tool = 'eraser'; eraserBtn.classList.add('active'); brushBtn.classList.remove('active'); });
sizeInput.addEventListener('input', () => { app.size = Number(sizeInput.value); });
undoBtn.addEventListener('click', () => requestUndo());
clearBtn.addEventListener('click', () => {
  // Clear locally - does not clear room history (server persistence would be required)
  // We issue undo operations for all active strokes as a convenience in demo (not ideal in real app)
  // But for the assignment we keep this as a local clear to show the feature. Comment out if you want real global clear.
  // WARNING: doing this produces many undo ops in log — ok for demo.
  const activeStrokes = app.ops.filter(o => o.type === 'stroke' && o.active);
  // If you want to clear globally, send undo repeatedly to server (demo only)
  if (confirm('Clear will undo all strokes globally. Proceed?')) {
    // We'll request undo repeatedly; server does global LIFO undos so this will clear room.
    for (let i = 0; i < activeStrokes.length; i++) {
      socket.emit('op', { roomId: ROOM_ID, type: 'undo', payload: {} });
    }
  }
});

// Join initially with current username & color
joinRoom();

// Make sure we resize canvas to fit viewport (initial)
setTimeout(resizeCanvas, 50);

// Basic keyboard shortcut: Ctrl+Z for undo
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    requestUndo();
  }
});
