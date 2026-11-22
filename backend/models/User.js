
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // User's basic information
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Store only a securely hashed password
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false,
    },

    // Virtual office coordinates: [x, y]
    // Canvas dimensions: 1200 x 650 pixels
    position: {
      type: [Number],
      required: true,
      default: [0, 0],
      validate: {
        validator: function (coordinates) {
          return (
            Array.isArray(coordinates) &&
            coordinates.length === 2 &&
            Number.isFinite(coordinates[0]) &&
            Number.isFinite(coordinates[1]) &&
            coordinates[0] >= 0 &&
            coordinates[0] <= 1200 &&
            coordinates[1] >= 0 &&
            coordinates[1] <= 650
          );
        },
        message:
          "Position must be [x, y] within the office boundaries (1200 x 650).",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Enable planar geospatial queries for virtual-office positions.
// Index bounds match the maximum canvas dimension (1200 pixels).
userSchema.index({ position: "2d" }, { min: 0, max: 1200 });

module.exports = mongoose.model("User", userSchema);
