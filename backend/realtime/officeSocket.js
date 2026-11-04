
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const OFFICE_WIDTH = 1200;
const OFFICE_HEIGHT = 650;
const MOVE_INTERVAL = 80;

const players = new Map();

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
 * Resolve a target user's active socket.
 */
function resolveTarget(io, senderUserId, targetUserId) {
  if (
    !targetUserId ||
    typeof targetUserId !== "string" ||
    targetUserId === senderUserId
  ) {
    return null;
  }

  const targetPlayer = players.get(targetUserId);

  if (!targetPlayer) return null;

  const targetSocket = io.sockets.sockets.get(
    targetPlayer.socketId
  );

  return targetSocket || null;
}

function setupOfficeSocket(server) {
  // CORS configuration
  const configured =
    process.env.FRONTEND_URL || "http://localhost:5174";

  const allowedOrigins = [configured];

  try {
    const u = new URL(configured);
    const p = parseInt(u.port, 10);

    if (p === 5173) {
      allowedOrigins.push(
        `${u.protocol}//${u.hostname}:5174`
      );
    }

    if (p === 5174) {
      allowedOrigins.push(
        `${u.protocol}//${u.hostname}:5173`
      );
    }
  } catch (error) {
    console.error("Invalid Socket.IO FRONTEND_URL:", error.message);
  }

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
    },
  });

  // ==========================================
  // SOCKET JWT AUTHENTICATION
  // ==========================================

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not configured");
        return next(new Error("Server authentication unavailable"));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );

      if (!decoded.id) {
        return next(new Error("Invalid user token"));
      }

      socket.data.userId = String(decoded.id);

      next();
    } catch (error) {
      next(new Error("Invalid or expired token"));
    }
  });

  // ==========================================
  // SOCKET CONNECTION
  // ==========================================

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.data.userId);

    const userId = socket.data.userId;

    // ==========================================
    // SOCKET EVENT RATE LIMITING
    // ==========================================

    // Each connected socket has its own event counters.
    const eventLimits = new Map();

    function allowSocketEvent(eventName, maxEvents, windowMs) {
      const now = Date.now();
      const current = eventLimits.get(eventName);

      // Start a new time window.
      if (!current || now - current.startTime >= windowMs) {
        eventLimits.set(eventName, {
          startTime: now,
          count: 1,
        });

        return true;
      }

      // Block events after reaching the limit.
      if (current.count >= maxEvents) {
        return false;
      }

      current.count++;

      return true;
    }

    // Check whether this socket is the active voice-room socket.
    function isInVoiceRoom(checkUserId) {
      return voiceRoom.get(checkUserId) === socket.id;
    }

    // ==========================================
    // PLAYER PRESENCE
    // ==========================================

    socket.on("player:join", async (data = {}) => {
      try {
        const { x, y } = data;

        if (!isValidPosition(x, y)) {
          return socket.emit(
            "player:error",
            "Invalid position"
          );
        }

        const user = await User.findById(userId).select("name");

        if (!user) {
          return socket.emit(
            "player:error",
            "User not found"
          );
        }

        // If the same user reconnects, clean up the old socket.
        const existingPlayer = players.get(userId);

        if (
          existingPlayer &&
          existingPlayer.socketId !== socket.id
        ) {
          const oldSocket = io.sockets.sockets.get(
            existingPlayer.socketId
          );

          if (oldSocket) {
            oldSocket.disconnect(true);
          }

          if (voiceRoom.get(userId) === existingPlayer.socketId) {
            voiceRoom.delete(userId);
          }
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

        socket.emit(
          "player:error",
          "Could not join office"
        );
      }
    });

    socket.on("player:move", (data = {}) => {
      const player = players.get(userId);

      if (!player || player.socketId !== socket.id) {
        return;
      }

      const now = Date.now();

      if (now - player.lastMoveAt < MOVE_INTERVAL) {
        return;
      }

      const { x, y } = data;

      if (!isValidPosition(x, y)) {
        return;
      }

      player.x = x;
      player.y = y;
      player.lastMoveAt = now;

      broadcastPlayers(io);
    });

    // ==========================================
    // VOICE ROOM
    // ==========================================

    socket.on("voice:join", () => {
      // User must be an active office player.
      const player = players.get(userId);

      if (!player || player.socketId !== socket.id) {
        return;
      }

      // Already joined.
      if (voiceRoom.has(userId)) {
        return;
      }

      voiceRoom.set(userId, socket.id);

      const existingPeers = [...voiceRoom.keys()].filter(
        (id) => id !== userId
      );

      socket.emit("voice:peers", {
        peers: existingPeers,
      });

      // Notify existing voice participants.
      for (const [peerId, peerSocketId] of voiceRoom) {
        if (peerId === userId) continue;

        const peerSocket = io.sockets.sockets.get(
          peerSocketId
        );

        if (peerSocket) {
          peerSocket.emit("voice:user-joined", {
            userId,
          });
        }
      }

      console.log(
        `[Voice] ${userId} joined. Room size: ${voiceRoom.size}`
      );
    });

    // ==========================================
    // WEBRTC OFFER
    // Limit: 10 events per 10 seconds
    // ==========================================

    socket.on("voice:offer", (data = {}) => {
      if (!allowSocketEvent("voice:offer", 10, 10000)) {
        return;
      }

      const fromUserId = userId;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
      }

      const { targetUserId, sdp } = data;

      // Sender must be in voice room.
      if (!isInVoiceRoom(fromUserId)) return;

      // Validate SDP.
      if (
        !sdp ||
        typeof sdp !== "object" ||
        Array.isArray(sdp)
      ) {
        return;
      }

      // Receiver must be in voice room.
      if (
        typeof targetUserId !== "string" ||
        !voiceRoom.has(targetUserId)
      ) {
        return;
      }

      const targetSocket = resolveTarget(
        io,
        fromUserId,
        targetUserId
      );

      if (!targetSocket) return;

      targetSocket.emit("voice:offer", {
        fromUserId,
        sdp,
      });
    });

    // ==========================================
    // WEBRTC ANSWER
    // Limit: 10 events per 10 seconds
    // ==========================================

    socket.on("voice:answer", (data = {}) => {
      if (!allowSocketEvent("voice:answer", 10, 10000)) {
        return;
      }

      const fromUserId = userId;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
      }

      const { targetUserId, sdp } = data;

      if (!isInVoiceRoom(fromUserId)) return;

      if (
        !sdp ||
        typeof sdp !== "object" ||
        Array.isArray(sdp)
      ) {
        return;
      }

      if (
        typeof targetUserId !== "string" ||
        !voiceRoom.has(targetUserId)
      ) {
        return;
      }

      const targetSocket = resolveTarget(
        io,
        fromUserId,
        targetUserId
      );

      if (!targetSocket) return;

      targetSocket.emit("voice:answer", {
        fromUserId,
        sdp,
      });
    });

    // ==========================================
    // WEBRTC ICE CANDIDATE
    // Limit: 60 events per 10 seconds
    // ==========================================

    socket.on("voice:ice-candidate", (data = {}) => {
      if (
        !allowSocketEvent("voice:ice-candidate", 60, 10000)
      ) {
        return;
      }

      const fromUserId = userId;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
      }

      const { targetUserId, candidate } = data;

      if (!isInVoiceRoom(fromUserId)) return;

      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return;
      }

      if (
        typeof targetUserId !== "string" ||
        !voiceRoom.has(targetUserId)
      ) {
        return;
      }

      const targetSocket = resolveTarget(
        io,
        fromUserId,
        targetUserId
      );

      if (!targetSocket) return;

      targetSocket.emit("voice:ice-candidate", {
        fromUserId,
        candidate,
      });
    });

    // ==========================================
    // VOICE LEAVE
    // ==========================================

    function removeFromVoice() {
      if (!isInVoiceRoom(userId)) {
        return;
      }

      voiceRoom.delete(userId);

      // Notify remaining participants.
      for (const [peerId, peerSocketId] of voiceRoom) {
        const peerSocket = io.sockets.sockets.get(
          peerSocketId
        );

        if (peerSocket) {
          peerSocket.emit("voice:user-left", {
            userId,
          });
        }
      }

      console.log(
        `[Voice] ${userId} left. Room size: ${voiceRoom.size}`
      );
    }

    socket.on("voice:leave", () => {
      removeFromVoice();
    });

    // ==========================================
    // PLAYER CLEANUP
    // ==========================================

    function removePlayer() {
      const player = players.get(userId);

      if (player && player.socketId === socket.id) {
        players.delete(userId);
        broadcastPlayers(io);
      }
    }

    socket.on("player:leave", () => {
      removeFromVoice();
      removePlayer();
    });

    // ==========================================
    // DISCONNECT CLEANUP
    // ==========================================

    socket.on("disconnect", () => {
      removeFromVoice();
      removePlayer();

      console.log("Socket disconnected:", userId);
    });
  });

  return io;
}

module.exports = setupOfficeSocket;
