
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const OFFICE_WIDTH = 1200;
const OFFICE_HEIGHT = 650;
const MOVE_INTERVAL = 80;
const POSITION_SAVE_INTERVAL = 1000;

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

// Save the latest position to MongoDB.
async function persistPosition(player) {
  if (!player || !isValidPosition(player.x, player.y)) {
    return;
  }

  try {
    await User.updateOne(
      { _id: player.userId },
      {
        $set: {
          position: [player.x, player.y],
        },
      },
      { runValidators: true }
    );
  } catch (error) {
    console.error(
      "POSITION PERSISTENCE ERROR:",
      error.message
    );
  }
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

  const allowedOrigins = new Set();

  try {
    const u = new URL(configured);

    // Support the Vite development ports used by this project.
    [5173, 5174, 5175].forEach((port) => {
      allowedOrigins.add(
        `${u.protocol}//${u.hostname}:${port}`
      );
    });

    // Also retain the exact configured origin (including a custom port).
    allowedOrigins.add(u.origin);
  } catch (error) {
    console.error(
      "Invalid Socket.IO FRONTEND_URL:",
      error.message
    );
  }

  console.log(
    "Socket.IO allowed origins:",
    [...allowedOrigins].join(", ")
  );

  const io = new Server(server, {
    cors: {
      origin: [...allowedOrigins],
      methods: ["GET", "POST"],
      credentials: true,
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

    const eventLimits = new Map();

    function allowSocketEvent(eventName, maxEvents, windowMs) {
      const now = Date.now();
      const current = eventLimits.get(eventName);

      if (!current || now - current.startTime >= windowMs) {
        eventLimits.set(eventName, {
          startTime: now,
          count: 1,
        });

        return true;
      }

      if (current.count >= maxEvents) {
        return false;
      }

      current.count++;

      return true;
    }

    function isInVoiceRoom(checkUserId) {
      return voiceRoom.get(checkUserId) === socket.id;
    }

    // ==========================================
    // PLAYER PRESENCE
    // ==========================================

    socket.on("player:join", async (data = {}) => {
      try {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return socket.emit("player:error", "Invalid join data");
        }

        const { x, y } = data;

        if (!isValidPosition(x, y)) {
          return socket.emit("player:error", "Invalid position");
        }

        // Load the user's saved position from MongoDB.
        const user = await User.findById(userId).select(
          "name position"
        );

        if (!user) {
          return socket.emit("player:error", "User not found");
        }

        // Prevent an older join request from replacing a newer socket.
        const currentPlayer = players.get(userId);

        if (
          currentPlayer &&
          currentPlayer.socketId !== socket.id &&
          currentPlayer.joinStartedAt > socket.data.joinStartedAt
        ) {
          return;
        }

        // Clean up an older active socket.
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

        const savedPosition = user.position;

        const hasValidSavedPosition =
          Array.isArray(savedPosition) &&
          savedPosition.length === 2 &&
          isValidPosition(savedPosition[0], savedPosition[1]);

        const initialX = hasValidSavedPosition
          ? savedPosition[0]
          : x;

        const initialY = hasValidSavedPosition
          ? savedPosition[1]
          : y;

        const player = {
          userId,
          socketId: socket.id,
          name: user.name,
          x: initialX,
          y: initialY,
          color: "#8B7CF6",
          lastMoveAt: 0,
          lastPersistAt: 0,
          persistTimer: null,
          joinStartedAt: socket.data.joinStartedAt || Date.now(),
        };

        players.set(userId, player);

        // Save the fallback position if no valid saved position existed.
        if (!hasValidSavedPosition) {
          await persistPosition(player);
        }

        // Do not broadcast if this socket was replaced during the await.
        if (players.get(userId)?.socketId !== socket.id) {
          return;
        }

        socket.emit("player:position-restored", {
          x: player.x,
          y: player.y,
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

    // Record when this socket began its join request.
    socket.data.joinStartedAt = Date.now();

    // ==========================================
    // PLAYER MOVEMENT
    // ==========================================

    socket.on("player:move", (data = {}) => {
      const player = players.get(userId);

      if (!player || player.socketId !== socket.id) {
        return;
      }

      const now = Date.now();

      if (now - player.lastMoveAt < MOVE_INTERVAL) {
        return;
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
      }

      const { x, y } = data;

      if (!isValidPosition(x, y)) {
        return;
      }

      player.x = x;
      player.y = y;
      player.lastMoveAt = now;

      // Schedule a MongoDB save at most once per interval.
      // Repeated movement events update the latest coordinates.
      if (!player.persistTimer) {
        player.persistTimer = setTimeout(async () => {
          player.persistTimer = null;

          // Only the currently active socket can persist movement.
          const activePlayer = players.get(userId);

          if (
            !activePlayer ||
            activePlayer.socketId !== socket.id
          ) {
            return;
          }

          await persistPosition(activePlayer);
          activePlayer.lastPersistAt = Date.now();
        }, POSITION_SAVE_INTERVAL);
      }

      broadcastPlayers(io);
    });

    // ==========================================
    // VOICE ROOM
    // ==========================================

    socket.on("voice:join", () => {
      const player = players.get(userId);

      if (!player || player.socketId !== socket.id) {
        return;
      }

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

      targetSocket.emit("voice:offer", {
        fromUserId,
        sdp,
      });
    });

    // ==========================================
    // WEBRTC ANSWER
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

    async function removePlayer() {
      const player = players.get(userId);

      // An old socket must never remove a newer socket's player.
      if (!player || player.socketId !== socket.id) {
        return;
      }

      if (player.persistTimer) {
        clearTimeout(player.persistTimer);
        player.persistTimer = null;
      }

      // Save the final position before removing the player.
      await persistPosition(player);

      // Check again in case a newer socket has replaced this one.
      const currentPlayer = players.get(userId);

      if (currentPlayer?.socketId === socket.id) {
        players.delete(userId);
        broadcastPlayers(io);
      }
    }

    socket.on("player:leave", async () => {
      removeFromVoice();
      await removePlayer();
    });

    // ==========================================
    // DISCONNECT CLEANUP
    // ==========================================

    socket.on("disconnect", async () => {
      removeFromVoice();
      await removePlayer();

      console.log("Socket disconnected:", userId);
    });
  });

  return io;
}

module.exports = setupOfficeSocket;
