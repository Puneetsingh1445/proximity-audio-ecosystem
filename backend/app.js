const express = require("express");
const cors = require("cors");
const User = require("./models/User");
const userRoutes = require("./routes/userRoutes");

const app = express();

// Allow requests from the configured frontend origin.
// Socket.IO CORS is configured separately in realtime/officeSocket.js.
//
// Vite sometimes uses port 5174 when 5173 is already taken.
// We accept both the configured URL and the adjacent port so a port
// shift never causes a hard-to-diagnose "Failed to fetch" error.
const CONFIGURED_ORIGIN = process.env.FRONTEND_URL || "http://localhost:5174";

// Build the allowed-origins set from the configured URL.
// e.g. FRONTEND_URL=http://localhost:5174 → allow 5173 AND 5174.
function buildAllowedOrigins(base) {
  try {
    const url = new URL(base);
    const port = parseInt(url.port, 10);
    const origins = new Set([base]);
    // Also allow the neighbouring Vite port (5173 ↔ 5174).
    if (port === 5173) origins.add(`${url.protocol}//${url.hostname}:5174`);
    if (port === 5174) origins.add(`${url.protocol}//${url.hostname}:5173`);
    return origins;
  } catch {
    return new Set([base]);
  }
}

const ALLOWED_ORIGINS = buildAllowedOrigins(CONFIGURED_ORIGIN);
console.log("HTTP CORS allowed origins:", [...ALLOWED_ORIGINS].join(", "));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header) and Postman.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Health check API
app.get("/api/health", (req, res) => {
res.status(200).json({
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

// Register user-related routes, including nearby users
app.use("/api/users", userRoutes);

module.exports = app;