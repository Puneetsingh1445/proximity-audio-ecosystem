const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    // Virtual office avatar position (pixels)
    position: {
      x: {
        type: Number,
        default: 0,
        min: 0,
        max: 1000,
      },
      y: {
        type: Number,
        default: 0,
        min: 0,
        max: 600,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);