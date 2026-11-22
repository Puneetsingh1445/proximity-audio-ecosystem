
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

// ==========================================
// AUDIO ROOM SCHEMA
// ==========================================

const audioRoomSchema = new mongoose.Schema(
  {
    // ── roomId ───────────────────────────────
    // A short unique string that clients use to
    // join or reference this room.  We generate
    // it automatically so the creator never has
    // to supply one.
    roomId: {
      type: String,
      required: [true, "Room ID is required"],
      unique: true,
      index: true,
    },

    // ── roomName ─────────────────────────────
    // Human-readable label shown in the UI.
    roomName: {
      type: String,
      required: [true, "Room name is required"],
      trim: true,
      minlength: [3,  "Room name must be at least 3 characters"],
      maxlength: [40, "Room name must not exceed 40 characters"],
    },

    // ── description ──────────────────────────
    // Optional short description for the room.
    description: {
      type: String,
      trim: true,
      maxlength: [150, "Description must not exceed 150 characters"],
      default: "",
    },

    // ── createdBy ────────────────────────────
    // References the User document of whoever
    // created this room.  Used for authorisation
    // when deleting a room.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator is required"],
      index: true,
    },

    // ── maxParticipants ───────────────────────
    // Hard cap on how many users can be inside
    // the room at the same time.
    maxParticipants: {
      type: Number,
      default: 5,
      min: [2,  "A room must allow at least 2 participants"],
      max: [20, "A room cannot have more than 20 participants"],
    },

    // ── isActive ─────────────────────────────
    // Soft-delete flag.  Rooms are marked
    // inactive instead of being physically
    // removed so we keep an audit trail.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    // ── timestamps ───────────────────────────
    // Mongoose automatically manages
    // createdAt and updatedAt fields.
    timestamps: true,
  }
);

// ==========================================
// COMPOUND INDEX
// ==========================================

// Speed up the common query: active rooms
// sorted by creation time.
audioRoomSchema.index({ isActive: 1, createdAt: -1 });

// ==========================================
// STATIC – GENERATE UNIQUE ROOM ID
// ==========================================

// Produces a short, URL-safe ID such as
// "a1b2c3d4".  The first 8 characters of a
// UUID hex are very unlikely to collide for
// the number of rooms ProxiSpeak handles.
audioRoomSchema.statics.generateRoomId =
  function () {
    return randomUUID().replace(/-/g, "").slice(0, 8);
  };

// ==========================================
// EXPORT MODEL
// ==========================================

const AudioRoom = mongoose.model(
  "AudioRoom",
  audioRoomSchema
);

module.exports = AudioRoom;
