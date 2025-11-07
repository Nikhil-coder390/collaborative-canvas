// server/rooms.js
// RoomManager: keeps in-memory rooms, clients and op log per room.
// This is intentionally simple (no DB). For production, persist to Redis or DB.

class RoomManager {
  constructor() {
    // Map: roomId -> { clients: Map(socketId -> clientInfo), ops: [], seq: number, opMap: Map(opID -> op) }
    this.rooms = new Map();
  }

  _ensure(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        clients: new Map(),
        ops: [], // ordered op log
        seq: 0, // monotonically increasing sequence
        opMap: new Map(), // opID -> op
      });
    }
  }

  addClient(roomId, socketId, username = 'Anon', color = '#000') {
    this._ensure(roomId);
    const room = this.rooms.get(roomId);
    room.clients.set(socketId, { clientId: socketId, username, color });
    return room.clients.get(socketId);
  }

  removeClientBySocket(socketId) {
    const roomsLeft = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.clients.delete(socketId)) {
        roomsLeft.push(roomId);
      }
    }
    return roomsLeft; // list of rooms where this client was removed
  }

  getClients(roomId) {
    this._ensure(roomId);
    const room = this.rooms.get(roomId);
    return Array.from(room.clients.values());
  }

  getHistory(roomId, limit = 500) {
    this._ensure(roomId);
    const room = this.rooms.get(roomId);
    // Return last `limit` ops so new clients can catch up
    return room.ops.slice(Math.max(0, room.ops.length - limit));
  }

  // Append an operation into the room's log, stamp with seq and opID, handle undo semantics.
  appendOp(roomId, opRaw = {}, socketId) {
    this._ensure(roomId);
    const room = this.rooms.get(roomId);

    // increase sequence
    const seq = ++room.seq;
    const opID = `${roomId}::${String(seq).padStart(6, '0')}`;

    // Create stamped op object
    const stamped = {
      seq,
      opID,
      clientId: socketId,
      type: opRaw.type,
      payload: opRaw.payload || opRaw.payload === null ? opRaw.payload : opRaw, // flexible
      timestamp: Date.now(),
      // active flag is meaningful for strokes; undone strokes will be marked false
      active: true,
    };

    // Handle server-side interpretations: e.g. if client asked for 'undo' without target, we find latest active stroke
    if (stamped.type === 'undo') {
      const targetOpID = stamped.payload && stamped.payload.targetOpID;
      if (targetOpID) {
        const target = room.opMap.get(targetOpID);
        if (target) target.active = false;
      } else {
        // global LIFO undo: find last stroke (type 'stroke') that is active and mark it inactive
        for (let i = room.ops.length - 1; i >= 0; i--) {
          const o = room.ops[i];
          if (o.type === 'stroke' && o.active) {
            o.active = false;
            // record that this undo targets o.opID (so clients can know)
            stamped.payload = { targetOpID: o.opID };
            break;
          }
        }
      }
      // We leave the undo op itself in the log so replaying is deterministic
    } else if (stamped.type === 'redo') {
      // redo: re-activate the referenced opID if present
      const targetOpID = stamped.payload && stamped.payload.targetOpID;
      if (targetOpID) {
        const target = room.opMap.get(targetOpID);
        if (target) target.active = true;
      }
    } else if (stamped.type === 'stroke') {
      // strokes remain active by default
    } else if (stamped.type === 'presence') {
      // presence ops don't need to alter op state
    }

    // Save in log and map
    room.ops.push(stamped);
    room.opMap.set(stamped.opID, stamped);

    // For memory: consider compaction: snapshot canvas then prune old ops (not implemented here)
    return stamped;
  }
}

module.exports = RoomManager;
