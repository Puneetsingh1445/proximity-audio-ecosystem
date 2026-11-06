
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const authenticate = require("../middleware/authenticate");

const {
  loginLimiter,
  registerLimiter,
} = require("../middleware/rateLimiters");

const router = express.Router();

// ==========================================
// USER REGISTRATION
// POST /api/users/register
// ==========================================

router.post("/register", registerLimiter, async (req, res) => {
  try {
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

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "MongoDB is not connected",
      });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
    });

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
    console.error("REGISTER ERROR:", error.stack || error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "User validation failed",
        details: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

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

// ==========================================
// USER LOGIN
// POST /api/users/login
// ==========================================

router.post("/login", loginLimiter, async (req, res) => {
  try {
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

    const normalizedEmail = email.trim().toLowerCase();

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not available. Please try again later.",
      });
    }

    const user = await User.findOne({
      email: normalizedEmail,
    }).select("+passwordHash");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("LOGIN ERROR: JWT_SECRET is not configured");

      return res.status(500).json({
        success: false,
        message: "Authentication service is misconfigured",
      });
    }

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
    console.error("LOGIN ERROR:", error.stack || error);

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

// ==========================================
// GET MY PROFILE
// GET /api/users/me
// ==========================================

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
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

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
});

// ==========================================
// UPDATE MY PROFILE
// PATCH /api/users/me
// ==========================================

router.patch("/me", authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const allowedUpdates = {};

    // Validate name
    if (body.name !== undefined) {
      if (
        typeof body.name !== "string" ||
        !body.name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Name must be a non-empty string.",
        });
      }

      allowedUpdates.name = body.name.trim();
    }

    // Validate position
    if (body.position !== undefined) {
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

      const [x, y] = body.position;

      // Validate office canvas boundaries (1200 x 650)
      if (x < 0 || x > 1200 || y < 0 || y > 650) {
        return res.status(400).json({
          success: false,
          message: "Position is out of bounds. x must be 0–1200 and y must be 0–650.",
        });
      }

      allowedUpdates.position = [x, y];
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update. Provide name and/or position.",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: allowedUpdates },
      {
        returnDocument: "after",
        runValidators: true,
      }
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
    console.error("PATCH /me ERROR:", error.stack || error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        details: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

// ==========================================
// UPDATE MY POSITION
// PUT /api/users/me/position
// ==========================================

router.put("/me/position", authenticate, async (req, res) => {
  try {
    const { position } = req.body || {};

    // Validate coordinates
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

    // Canvas boundary validation (1200 x 650)
    if (x < 0 || x > 1200 || y < 0 || y > 650) {
      return res.status(400).json({
        success: false,
        message: "Position is out of bounds. x must be 0–1200 and y must be 0–650.",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { position: [x, y] } },
      {
        returnDocument: "after",
        runValidators: true,
      }
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
        details: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update position",
    });
  }
});

// ==========================================
// GET NEARBY USERS
// GET /api/users/nearby?radius=100
// ==========================================

router.get("/nearby", authenticate, async (req, res) => {
  try {
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

    const MAX_RADIUS = 1166;

    if (radius > MAX_RADIUS) {
      return res.status(400).json({
        success: false,
        message: `radius must not exceed ${MAX_RADIUS} px (the canvas diagonal).`,
      });
    }

    const me = await User.findById(req.user.id).select("position");

    if (!me) {
      return res.status(404).json({
        success: false,
        message: "Authenticated user not found.",
      });
    }

    const [myX, myY] = me.position;

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
      users: nearbyUsers.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        position: user.position,
        updatedAt: user.updatedAt,
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

// ==========================================
// EXPORT ROUTER
// ==========================================

module.exports = router;
