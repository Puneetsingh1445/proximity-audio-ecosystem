
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

// Store audio files in backend/uploads/audio
const audioDirectory = path.join(__dirname, "../uploads/audio");
fs.mkdirSync(audioDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioDirectory);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}-${Date.now()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio files are allowed."));
    }

    cb(null, true);
  },
});

// POST /api/audio/upload
router.post("/upload", authenticate, (req, res) => {
  upload.single("audio")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Audio upload failed.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select an audio file.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Audio uploaded successfully.",
      audio: {
        filename: req.file.filename,
        size: req.file.size,
        url: `/api/audio/${encodeURIComponent(req.file.filename)}`,
      },
    });
  });
});

// GET /api/audio/:filename
router.get("/:filename", authenticate, (req, res) => {
  const filename = req.params.filename;

  // Validate the filename and prevent directory traversal.
  if (
    filename !== path.basename(filename) ||
    !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid audio filename.",
    });
  }

  // Users can access only their own uploaded audio.
  const expectedPrefix = `${req.user.id}-`;

  if (!filename.startsWith(expectedPrefix)) {
    return res.status(403).json({
      success: false,
      message: "You cannot access this audio file.",
    });
  }

  const filePath = path.join(audioDirectory, filename);

console.log("Requested audio filename:", filename);
console.log("Audio directory:", audioDirectory);
console.log("Full audio path:", filePath);
console.log("File exists:", fs.existsSync(filePath));

if (!fs.existsSync(filePath)) {
  return res.status(404).json({
    success: false,
    message: "Audio file not found.",
    requestedFilename: filename,
    checkedPath: filePath,
  });
}

  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) {
      console.error("Audio serving error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Failed to serve audio file.",
      });
    }
  });
});

module.exports = router;
