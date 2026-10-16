const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");

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

module.exports = router;