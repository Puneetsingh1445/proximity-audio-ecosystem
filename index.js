
require("dotenv").config();

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Health-check route
app.get("/", (req, res) => {
  res.json({
    project: "ProxiSpeak",
    message: "Backend server is running!",
  });
});

// Socket.io connection and virtual-office events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  let currentOffice = null;

  // Join a virtual office
  socket.on("join-office", (officeId, callback) => {
    if (
      typeof officeId !== "string" ||
      !officeId.trim()
    ) {
      if (typeof callback === "function") {
        callback({
          success: false,
          message: "A valid office ID is required.",
        });
      }
      return;
    }

    const newOffice = officeId.trim();

    // Leave the previous office, if any
    if (currentOffice) {
      socket.leave(currentOffice);

      socket.to(currentOffice).emit("user-left", {
        userId: socket.id,
      });
    }

    currentOffice = newOffice;
    socket.join(currentOffice);

    console.log(
      `User ${socket.id} joined office ${currentOffice}`
    );

    if (typeof callback === "function") {
      callback({
        success: true,
        officeId: currentOffice,
        userId: socket.id,
      });
    }
  });

  // Receive and broadcast avatar coordinates
  socket.on("move-avatar", (position) => {
    if (!currentOffice || !position) {
      return;
    }

    const { x, y } = position;

    // Validate coordinates
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > 10000 ||
      Math.abs(y) > 10000
    ) {
      return;
    }

    // Send movement to other users in the same office
    socket.to(currentOffice).emit("user-moved", {
      userId: socket.id,
      x,
      y,
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    if (currentOffice) {
      socket.to(currentOffice).emit("user-left", {
        userId: socket.id,
      });
    }

    console.log("User disconnected:", socket.id);
  });
});

// MongoDB connection
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
      console.log("MongoDB connected successfully!");
    })
    .catch((error) => {
      console.error(
        "MongoDB connection failed:",
        error.message
      );
    });
} else {
  console.log("MONGODB_URI is not configured yet.");
}

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`ProxiSpeak server running on port ${PORT}`);
});
