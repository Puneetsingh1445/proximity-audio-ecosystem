
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const OFFICE_WIDTH = 1200;
const OFFICE_HEIGHT = 650;
const MOVE_INTERVAL = 80;

const players = new Map();

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

function setupOfficeSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
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

    function removePlayer() {
      const player = players.get(socket.data.userId);

      if (player && player.socketId === socket.id) {
        players.delete(socket.data.userId);
        broadcastPlayers(io);
      }
    }

    socket.on("player:leave", removePlayer);
    socket.on("disconnect", removePlayer);
  });

  return io;
}

module.exports = setupOfficeSocket;
