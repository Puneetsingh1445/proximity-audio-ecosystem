
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");

const { generalApiLimiter } = require("./middleware/rateLimiters");

const app = express();

const CONFIGURED_ORIGIN =
  process.env.FRONTEND_URL || "http://localhost:5174";

function buildAllowedOrigins(base) {
  try {
    const url = new URL(base);
    const port = parseInt(url.port, 10);
    const origins = new Set([base]);

    if (port === 5173) {
      origins.add(`${url.protocol}//${url.hostname}:5174`);
    }

    if (port === 5174) {
      origins.add(`${url.protocol}//${url.hostname}:5173`);
    }

    return origins;
  } catch {
    return new Set([base]);
  }
}

const ALLOWED_ORIGINS =
  buildAllowedOrigins(CONFIGURED_ORIGIN);

console.log(
  "HTTP CORS allowed origins:",
  [...ALLOWED_ORIGINS].join(", ")
);

// CORS middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// JSON body parser
app.use(express.json());

// Health check API
app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "ProxiSpeak backend is running",
  });
});

// General API rate limiting
app.use("/api", generalApiLimiter);

// User-related routes
app.use("/api/users", userRoutes);

// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("API ERROR:", err.message);

  if (err.message === "CORS origin not allowed") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;
