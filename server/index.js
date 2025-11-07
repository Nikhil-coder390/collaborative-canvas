// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./rooms');

const app = express();
const server = http.createServer(app);

// Configure socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (later restrict to your Vercel URL)
    methods: ["GET", "POST"]
  }
});

const rooms = new RoomManager();

// Serve client folder as static
app.use(express.static(path.join(__dirname, '..', 'client')));

// Basic health endpoint
app.get('/health', (req, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Client requests to join a room
  socket.on('join_room', ({ roomId = 'room1', username = 'Anon', color = '#000000' } = {}) => {
    socket.join(roomId);
    rooms.addClient(roomId, socket.id, username, color);

    // Inform the new client of its id and peers
    socket.emit('joined', {
      clientId: socket.id,
      roomId,
      peers: rooms.getClients(roomId),
    });

    // Broadcast presence change to room
    io.to(roomId).emit('presence', { clients: rooms.getClients(roomId) });

    // Send recent history so new client can catch up
    const history = rooms.getHistory(roomId);
    socket.emit('history', { ops: history });
  });

  // Generic operation from client: stroke, cursor, undo request, etc.
  // Clients should send operations using 'op' messages (more generic and extensible)
  socket.on('op', (op) => {
    // Validate basics
    if (!op || !op.type) return;
    const roomId = op.roomId || 'room1';
    const stamped = rooms.appendOp(roomId, op, socket.id);

    // Broadcast stamped op to all clients in the room
    io.to(roomId).emit('op', stamped);
  });

  // Cursor updates are frequent - we forward them separately (lighter weight)
  socket.on('cursor', ({ roomId = 'room1', x, y } = {}) => {
    // Broadcast cursor position of this client to others in the room
    socket.to(roomId).emit('peer_cursor', { clientId: socket.id, x, y });
  });

  // Clean up when socket disconnects
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    const leftRooms = rooms.removeClientBySocket(socket.id);
    // Notify rooms about updated presence
    for (const roomId of leftRooms) {
      io.to(roomId).emit('presence', { clients: rooms.getClients(roomId) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
