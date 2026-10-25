
const express = require("express");
const cors = require("cors");
const User = require("./models/User");
const userRoutes = require("./routes/userRoutes");
const audioRoutes = require("./routes/audioRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check API
app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "ProxiSpeak backend is running",
  });
});

// Get all users from MongoDB
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().select("-passwordHash");

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

// User registration, login, profile, and geolocation APIs
app.use("/api/users", userRoutes);

// Audio upload and playback APIs
app.use("/api/audio", audioRoutes);

module.exports = app;
