
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const OFFICE_WIDTH = 1200;
const OFFICE_HEIGHT = 650;
const MOVE_INTERVAL = 80;

const players = new Map();

// Track which userIds are currently in the voice room.
// Map<userId, socketId>
const voiceRoom = new Map();

function isValidPosition(x, y) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= OFFICE_WIDTH &&
    y >= 0 &&
    y <= OFFICE_HEIGHT
  );
}

function getPlayers() {
  return Array.from(players.values()).map((player) => ({
    userId: player.userId,
    name: player.name,
    x: player.x,
    y: player.y,
    color: player.color,
  }));
}

function broadcastPlayers(io) {
  io.emit("players:update", getPlayers());
}

/**
 * Look up the live socket for a target userId.
 * Returns null if the target is not a valid, currently-connected office player.
 * Never trusts a client-supplied userId as proof of identity — identity is
 * always taken from socket.data.userId (set by the JWT middleware).
 */
function resolveTarget(io, senderUserId, targetUserId) {
  if (
    !targetUserId ||
    typeof targetUserId !== "string" ||
    targetUserId === senderUserId
  ) {
    return null;
  }

  // Target must be an authenticated player currently in the office.
  const targetPlayer = players.get(targetUserId);
  if (!targetPlayer) return null;

  // Look up the target's live socket by the stored socket ID.
  const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
  return targetSocket || null;
}

function setupOfficeSocket(server) {
  // Accept the configured origin AND the adjacent Vite port (5173 ↔ 5174)
  // so a port shift never breaks Socket.IO connections.
  const configured = process.env.FRONTEND_URL || "http://localhost:5174";
  const allowedOrigins = [configured];
  try {
    const u = new URL(configured);
    const p = parseInt(u.port, 10);
    if (p === 5173) allowedOrigins.push(`${u.protocol}//${u.hostname}:5174`);
    if (p === 5174) allowedOrigins.push(`${u.protocol}//${u.hostname}:5173`);
  } catch { /* keep only configured */ }

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
    },
  });

  // Authenticate socket connections using JWT.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (!decoded.id) {
        return next(new Error("Invalid user token"));
      }

      socket.data.userId = String(decoded.id);
      next();
    } catch (error) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.data.userId);

    // ── Player presence ────────────────────────────────────────────────────

    socket.on("player:join", async (data = {}) => {
      try {
        const userId = socket.data.userId;
        const { x, y } = data;

        if (!isValidPosition(x, y)) {
          return socket.emit("player:error", "Invalid position");
        }

        const user = await User.findById(userId).select("name");

        if (!user) {
          return socket.emit("player:error", "User not found");
        }

        players.set(userId, {
          userId,
          socketId: socket.id,
          name: user.name,
          x,
          y,
          color: "#8B7CF6",
          lastMoveAt: 0,
        });

        broadcastPlayers(io);
      } catch (error) {
        console.error("Player join error:", error.message);
        socket.emit("player:error", "Could not join office");
      }
    });

    socket.on("player:move", (data = {}) => {
      const player = players.get(socket.data.userId);

      if (!player || player.socketId !== socket.id) return;

      const now = Date.now();

      if (now - player.lastMoveAt < MOVE_INTERVAL) return;

      const { x, y } = data;

      if (!isValidPosition(x, y)) return;

      player.x = x;
      player.y = y;
      player.lastMoveAt = now;

      broadcastPlayers(io);
    });

    // ── Voice signaling ────────────────────────────────────────────────────
    // All identity comes from socket.data.userId — never from client payloads.
    // Both parties must be authenticated office players.

    /**
     * voice:join
     * Client enters the voice room. Server returns current peer list and
     * notifies existing voice peers that a new participant joined.
     */
    socket.on("voice:join", () => {
      const userId = socket.data.userId;

      // Must be an active office player.
      if (!players.has(userId)) return;

      // Idempotent — already in voice room.
      if (voiceRoom.has(userId)) return;

      voiceRoom.set(userId, socket.id);

      // Send the joiner the list of existing voice peers so they can initiate
      // RTCPeerConnections to each one.
      const existingPeers = [...voiceRoom.keys()].filter((id) => id !== userId);
      socket.emit("voice:peers", { peers: existingPeers });

      // Notify existing voice peers that this user arrived.
      for (const [peerId, peerSocketId] of voiceRoom) {
        if (peerId === userId) continue;
        const peerSocket = io.sockets.sockets.get(peerSocketId);
        if (peerSocket) {
          peerSocket.emit("voice:user-joined", { userId });
        }
      }

      console.log(`[Voice] ${userId} joined. Room size: ${voiceRoom.size}`);
    });

    /**
     * voice:offer
     * Forward an SDP offer from the caller to the callee.
     * Payload: { targetUserId: string, sdp: RTCSessionDescriptionInit }
     */
    socket.on("voice:offer", (data = {}) => {
      const fromUserId = socket.data.userId;
      const { targetUserId, sdp } = data;

      if (!sdp || typeof sdp !== "object") return;

      // Validate that the target is a connected office player in the voice room.
      if (!voiceRoom.has(targetUserId)) return;
      const targetSocket = resolveTarget(io, fromUserId, targetUserId);
      if (!targetSocket) return;

      targetSocket.emit("voice:offer", { fromUserId, sdp });
    });

    /**
     * voice:answer
     * Forward an SDP answer from the callee back to the caller.
     * Payload: { targetUserId: string, sdp: RTCSessionDescriptionInit }
     */
    socket.on("voice:answer", (data = {}) => {
      const fromUserId = socket.data.userId;
      const { targetUserId, sdp } = data;

      if (!sdp || typeof sdp !== "object") return;

      if (!voiceRoom.has(targetUserId)) return;
      const targetSocket = resolveTarget(io, fromUserId, targetUserId);
      if (!targetSocket) return;

      targetSocket.emit("voice:answer", { fromUserId, sdp });
    });

    /**
     * voice:ice-candidate
     * Forward an ICE candidate from one peer to the other.
     * Payload: { targetUserId: string, candidate: RTCIceCandidateInit }
     */
    socket.on("voice:ice-candidate", (data = {}) => {
      const fromUserId = socket.data.userId;
      const { targetUserId, candidate } = data;

      if (!candidate || typeof candidate !== "object") return;

      const targetSocket = resolveTarget(io, fromUserId, targetUserId);
      if (!targetSocket) return;

      targetSocket.emit("voice:ice-candidate", { fromUserId, candidate });
    });

    /**
     * voice:leave
     * Client voluntarily leaves the voice room.
     */
    socket.on("voice:leave", () => {
      removeFromVoice();
    });

    // ── Cleanup helpers ────────────────────────────────────────────────────

    function removeFromVoice() {
      const userId = socket.data.userId;

      if (!voiceRoom.has(userId)) return;

      voiceRoom.delete(userId);

      // Notify remaining voice peers so they can tear down RTCPeerConnections.
      for (const [peerId, peerSocketId] of voiceRoom) {
        const peerSocket = io.sockets.sockets.get(peerSocketId);
        if (peerSocket) {
          peerSocket.emit("voice:user-left", { userId });
        }
      }

      console.log(`[Voice] ${userId} left. Room size: ${voiceRoom.size}`);
    }

    function removePlayer() {
      const player = players.get(socket.data.userId);

      if (player && player.socketId === socket.id) {
        players.delete(socket.data.userId);
        broadcastPlayers(io);
      }
    }

    socket.on("player:leave", () => {
      removeFromVoice();
      removePlayer();
    });

    socket.on("disconnect", () => {
      removeFromVoice();
      removePlayer();
    });
  });

  return io;
}

module.exports = setupOfficeSocket;
