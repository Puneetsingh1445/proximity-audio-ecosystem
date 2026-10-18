const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

// POST /api/users/register
router.post("/register", async (req, res) => {
  try {
    // 1. Validate request body
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    // 2. Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    // 3. Normalize input
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // 5. Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "MongoDB is not connected",
      });
    }

    // 6. Check for an existing email
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    // 7. Hash password before saving
    const passwordHash = await bcrypt.hash(password, 12);

    // 8. Save the new user
    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
    });

    // 9. Return user data without the password hash
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        position: user.position,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    // Log the real error in the backend terminal
    console.error("REGISTER ERROR:", error.stack || error);

    // Handle duplicate email errors
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    // Handle Mongoose validation errors
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "User validation failed",
        details: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

    // Show diagnostic information only in development
    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to register user",
        debugError: error.message,
        errorName: error.name,
        errorCode: error.code || null,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to register user",
    });
  }
});

// POST /api/users/login
router.post("/login", async (req, res) => {
  try {
    // 1. Validate request body
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 2. Normalize email — must match the normalization used during registration
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Check MongoDB connection before querying
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not available. Please try again later.",
      });
    }

    // 4. Look up the user and explicitly fetch the passwordHash field.
    //    The User schema marks passwordHash as { select: false }, which means
    //    Mongoose will NEVER return it in a normal query.
    //    Adding .select("+passwordHash") overrides that for this one query only,
    //    so bcrypt.compare() receives the actual hash instead of undefined.
    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordHash"
    );

    // 5. If no user found, respond with a generic error.
    //    We do NOT say "email not found" — that would let attackers enumerate
    //    which emails are registered.
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 6. Compare the plain-text password against the stored hash.
    //    bcrypt.compare() is constant-time, preventing timing attacks.
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 7. Confirm JWT_SECRET is configured — fail loudly in dev, silently in prod
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("LOGIN ERROR: JWT_SECRET is not set in environment");
      return res.status(500).json({
        success: false,
        message: "Authentication service is misconfigured",
      });
    }

    // 8. Sign the JWT. The payload contains only safe, non-sensitive data.
    //    Never put passwordHash, raw password, or other secrets in the payload.
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      jwtSecret,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    // 9. Return the token and safe user data — never return passwordHash
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        position: user.position,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    // Log the full error server-side for debugging
    console.error("LOGIN ERROR:", error.stack || error);

    // In development, return extra context to help with debugging.
    // In production, never reveal internal error details.
    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Login failed",
        debugError: error.message,
        errorName: error.name,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

// ─── Profile routes (require a valid JWT) ────────────────────────────────────

// GET /api/users/me
// Returns the authenticated user's own profile.
// The authenticate middleware must run first — it populates req.user.id from
// the token so we know exactly which document to fetch.
router.get("/me", authenticate, async (req, res) => {
  try {
    // req.user.id comes from the verified JWT payload (set in authenticate.js).
    // passwordHash is excluded automatically because the schema sets select:false.
    const user = await User.findById(req.user.id);

    if (!user) {
      // Covers the edge case where a user was deleted after their token was issued
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        position: user.position,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("GET /me ERROR:", error.stack || error);

    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch profile",
        debugError: error.message,
        errorName: error.name,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
});

// PATCH /api/users/me
// Allows the authenticated user to update only their name and/or position.
// Any other field sent in the body (email, passwordHash, _id, etc.) is silently
// ignored — we never touch it — because we build the update object manually
// from an explicit allowlist rather than spreading req.body directly.
router.patch("/me", authenticate, async (req, res) => {
  try {
    const body = req.body || {};

    // ── Build an allowlisted update object ───────────────────────────────────
    // Only fields in this list can ever be changed through this endpoint.
    // Email, passwordHash, _id, createdAt, and __v are never touched.
    const allowedUpdates = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name must be a non-empty string.",
        });
      }
      allowedUpdates.name = body.name.trim();
    }

    if (body.position !== undefined) {
      // Pre-validate shape before handing off to Mongoose so we can return a
      // clear 400 instead of a cryptic Mongoose CastError.
      if (
        !Array.isArray(body.position) ||
        body.position.length !== 2 ||
        !Number.isFinite(body.position[0]) ||
        !Number.isFinite(body.position[1])
      ) {
        return res.status(400).json({
          success: false,
          message: "Position must be an array of two finite numbers: [x, y].",
        });
      }
      allowedUpdates.position = body.position;
    }

    // Reject requests that contain no recognised updatable fields
    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update. Provide 'name' and/or 'position'.",
      });
    }

    // ── Apply the update ──────────────────────────────────────────────────────
    // { new: true }          → return the document after the update, not before
    // { runValidators: true } → re-run schema validators (e.g. position bounds)
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: allowedUpdates },
      { returnDocument: "after", runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        position: updatedUser.position,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (error) {
    // Log the full error server-side (safe — only visible in your terminal)
    console.error("PATCH /me ERROR:", error.stack || error);

    // Mongoose schema validation failed (e.g. position out of canvas bounds)
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        details: Object.values(error.errors).map((e) => e.message),
      });
    }

    // MongoServerError (e.g. geospatial index range violation).
    // IMPORTANT: error.message for MongoServerError can contain the raw
    // document string, which includes passwordHash. Never expose it to clients.
    if (error.name === "MongoServerError" && process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
        debugHint: `MongoServerError code ${error.code}: ${error.codeName || "see server log"}`,
      });
    }

    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
        debugError: error.message,
        errorName: error.name,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

// ─── Geolocation routes (require a valid JWT) ────────────────────────────────

// PUT /api/users/me/position
// Updates the authenticated user's virtual-office position on the 1000 × 600 px
// canvas.  A dedicated route (rather than re-using PATCH /me) keeps the intent
// explicit and lets us add position-specific middleware later without touching
// the general profile update logic.
router.put("/me/position", authenticate, async (req, res) => {
  try {
    const { position } = req.body || {};

    // ── 1. Shape validation ────────────────────────────────────────────────
    // We check this before touching the database so the client gets a clear
    // 400 rather than a Mongoose CastError or a MongoServerError.
    if (
      !Array.isArray(position) ||
      position.length !== 2 ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      return res.status(400).json({
        success: false,
        message: "position must be an array of two finite numbers: [x, y].",
      });
    }

    const [x, y] = position;

    // ── 2. Canvas-boundary validation ─────────────────────────────────────
    // Mirrors the schema validator so out-of-range values are caught here
    // (with a friendly message) before Mongoose or the 2d index rejects them.
    if (x < 0 || x > 1000 || y < 0 || y > 600) {
      return res.status(400).json({
        success: false,
        message:
          "Position is out of bounds. x must be 0–1000 and y must be 0–600.",
      });
    }

    // ── 3. Persist ────────────────────────────────────────────────────────
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { position: [x, y] } },
      { returnDocument: "after", runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Position updated successfully.",
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        position: updatedUser.position,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (error) {
    console.error("PUT /me/position ERROR:", error.stack || error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        details: Object.values(error.errors).map((e) => e.message),
      });
    }

    // MongoServerError: never echo error.message — it can contain the raw
    // document including passwordHash.
    if (
      error.name === "MongoServerError" &&
      process.env.NODE_ENV !== "production"
    ) {
      return res.status(500).json({
        success: false,
        message: "Failed to update position",
        debugHint: `MongoServerError code ${error.code}: ${error.codeName || "see server log"}`,
      });
    }

    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to update position",
        debugError: error.message,
        errorName: error.name,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update position",
    });
  }
});

// GET /api/users/nearby?radius=<pixels>
// Returns all other users whose virtual-office position is within `radius`
// pixels of the authenticated user's current position.
//
// Distance is Euclidean (straight-line, pixel space) because MongoDB's "2d"
// index operates on a flat plane — matching the virtual-canvas coordinate
// system defined in User.js.
//
// The query uses $near so MongoDB leverages the "2d" index and returns
// documents already sorted nearest-first.  $maxDistance is in the same unit
// as the coordinates (pixels), so radius=100 means 100 px.
router.get("/nearby", authenticate, async (req, res) => {
  try {
    // ── 1. Parse and validate radius ──────────────────────────────────────
    const rawRadius = req.query.radius;

    if (rawRadius === undefined || rawRadius === "") {
      return res.status(400).json({
        success: false,
        message: "Query parameter 'radius' is required.",
      });
    }

    const radius = Number(rawRadius);

    if (!Number.isFinite(radius) || radius <= 0) {
      return res.status(400).json({
        success: false,
        message: "radius must be a positive finite number (pixels).",
      });
    }

    // Cap radius to the canvas diagonal so callers can't pass Infinity-like
    // values (≈ sqrt(1000² + 600²) ≈ 1166 px).
    const MAX_RADIUS = 1166;
    if (radius > MAX_RADIUS) {
      return res.status(400).json({
        success: false,
        message: `radius must not exceed ${MAX_RADIUS} px (the canvas diagonal).`,
      });
    }

    // ── 2. Fetch the requesting user's current position ───────────────────
    const me = await User.findById(req.user.id).select("position");

    if (!me) {
      return res.status(404).json({
        success: false,
        message: "Authenticated user not found.",
      });
    }

    const [myX, myY] = me.position;

    // ── 3. Query nearby users using the "2d" index ────────────────────────
    // $near on a 2d-indexed field returns documents sorted by ascending
    // distance.  $maxDistance uses the same unit as the coordinates (pixels).
    // We exclude the requesting user with { _id: { $ne: req.user.id } }.
    // passwordHash is excluded automatically (select: false in schema).
    const nearbyUsers = await User.find({
      _id: { $ne: req.user.id },
      position: {
        $near: [myX, myY],
        $maxDistance: radius,
      },
    }).select("name email position updatedAt");

    return res.status(200).json({
      success: true,
      myPosition: [myX, myY],
      radius,
      count: nearbyUsers.length,
      users: nearbyUsers.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        position: u.position,
        updatedAt: u.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /nearby ERROR:", error.stack || error);

    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch nearby users",
        debugError: error.message,
        errorName: error.name,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to fetch nearby users",
    });
  }
});

module.exports = router;

