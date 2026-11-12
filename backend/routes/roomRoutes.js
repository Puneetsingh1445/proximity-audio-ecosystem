
const express = require("express");
const mongoose = require("mongoose");
const AudioRoom = require("../models/AudioRoom");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

// ==========================================
// HELPER – SAFE ROOM PROJECTION
// ==========================================

// Returns only the fields the client needs.
// Never exposes internal Mongo fields or
// unrelated data.
function safeRoom(room) {
  return {
    roomId:          room.roomId,
    roomName:        room.roomName,
    description:     room.description,
    createdBy: {
      id:   room.createdBy?._id  || room.createdBy,
      name: room.createdBy?.name || undefined,
    },
    maxParticipants: room.maxParticipants,
    isActive:        room.isActive,
    createdAt:       room.createdAt,
    updatedAt:       room.updatedAt,
  };
}

// ==========================================
// CREATE ROOM
// POST /api/rooms
// ==========================================

router.post("/", authenticate, async (req, res) => {
  try {
    const body = req.body || {};

    // ── Validate roomName ─────────────────
    if (
      typeof body.roomName !== "string" ||
      !body.roomName.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Room name is required.",
      });
    }

    const roomName = body.roomName.trim();

    if (roomName.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Room name must be at least 3 characters.",
      });
    }

    if (roomName.length > 40) {
      return res.status(400).json({
        success: false,
        message: "Room name must not exceed 40 characters.",
      });
    }

    // ── Validate description ──────────────
    let description = "";

    if (body.description !== undefined) {
      if (typeof body.description !== "string") {
        return res.status(400).json({
          success: false,
          message: "Description must be a string.",
        });
      }

      description = body.description.trim();

      if (description.length > 150) {
        return res.status(400).json({
          success: false,
          message:
            "Description must not exceed 150 characters.",
        });
      }
    }

    // ── Validate maxParticipants ──────────
    let maxParticipants = 5;

    if (body.maxParticipants !== undefined) {
      maxParticipants = Number(body.maxParticipants);

      if (
        !Number.isInteger(maxParticipants) ||
        maxParticipants < 2 ||
        maxParticipants > 20
      ) {
        return res.status(400).json({
          success: false,
          message:
            "maxParticipants must be a whole number between 2 and 20.",
        });
      }
    }

    // ── Generate a unique roomId ──────────
    // Retry up to 5 times in the extremely
    // unlikely event of a collision.
    let roomId;
    let attempts = 0;

    while (attempts < 5) {
      const candidate =
        AudioRoom.generateRoomId();

      // eslint-disable-next-line no-await-in-loop
      const exists = await AudioRoom.findOne({
        roomId: candidate,
      });

      if (!exists) {
        roomId = candidate;
        break;
      }

      attempts += 1;
    }

    if (!roomId) {
      return res.status(500).json({
        success: false,
        message:
          "Could not generate a unique room ID. Please try again.",
      });
    }

    // ── Create the room ───────────────────
    const room = await AudioRoom.create({
      roomId,
      roomName,
      description,
      createdBy:       req.user.id,
      maxParticipants,
    });

    // Populate creator name for the response.
    await room.populate("createdBy", "name");

    return res.status(201).json({
      success: true,
      message: "Room created successfully.",
      room:    safeRoom(room),
    });

  } catch (error) {
    console.error(
      "POST /api/rooms ERROR:",
      error.stack || error
    );

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        details: Object.values(error.errors).map(
          (item) => item.message
        ),
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A room with that ID already exists. Please try again.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create room.",
    });
  }
});

// ==========================================
// GET ALL ACTIVE ROOMS
// GET /api/rooms
// ==========================================

router.get("/", authenticate, async (req, res) => {
  try {
    const rooms = await AudioRoom.find({
      isActive: true,
    })
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count:   rooms.length,
      rooms:   rooms.map(safeRoom),
    });

  } catch (error) {
    console.error(
      "GET /api/rooms ERROR:",
      error.stack || error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch rooms.",
    });
  }
});

// ==========================================
// GET ROOM BY roomId
// GET /api/rooms/:roomId
// ==========================================

router.get("/:roomId", authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Basic input guard – roomId should be a
    // non-empty string.
    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Room ID is required.",
      });
    }

    const room = await AudioRoom.findOne({
      roomId,
      isActive: true,
    }).populate("createdBy", "name");

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found.",
      });
    }

    return res.status(200).json({
      success: true,
      room:    safeRoom(room),
    });

  } catch (error) {
    console.error(
      "GET /api/rooms/:roomId ERROR:",
      error.stack || error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch room.",
    });
  }
});

// ==========================================
// DELETE ROOM
// DELETE /api/rooms/:roomId
// ==========================================

router.delete(
  "/:roomId",
  authenticate,
  async (req, res) => {
    try {
      const { roomId } = req.params;

      if (!roomId || typeof roomId !== "string") {
        return res.status(400).json({
          success: false,
          message: "Room ID is required.",
        });
      }

      const room = await AudioRoom.findOne({
        roomId,
        isActive: true,
      });

      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Room not found.",
        });
      }

      // ── Authorisation check ─────────────
      // Convert both IDs to strings before
      // comparing to avoid ObjectId vs string
      // mismatches.
      const creatorId = String(room.createdBy);
      const requesterId = String(req.user.id);

      if (creatorId !== requesterId) {
        return res.status(403).json({
          success: false,
          message:
            "You are not authorised to delete this room.",
        });
      }

      // Soft-delete: mark as inactive instead
      // of removing the document permanently.
      room.isActive = false;

      await room.save();

      return res.status(200).json({
        success: true,
        message: "Room deleted successfully.",
      });

    } catch (error) {
      console.error(
        "DELETE /api/rooms/:roomId ERROR:",
        error.stack || error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to delete room.",
      });
    }
  }
);

// ==========================================
// EXPORT ROUTER
// ==========================================

module.exports = router;
