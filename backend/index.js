
require("dotenv").config();

const http = require("http");
const connectDB = require("./db");
const app = require("./app");
const setupOfficeSocket = require("./realtime/officeSocket");
const setupRoomSocket   = require("./realtime/roomSocket");

const PORT = Number(process.env.PORT) || 5055;

async function startServer() {
  try {
    await connectDB();

    // Create HTTP server using Express
    const server = http.createServer(app);

    // Attach Socket.IO to the HTTP server.
    // setupOfficeSocket creates and configures the Socket.IO server,
    // applies the JWT authentication middleware, and registers all
    // voice:* and player:* event handlers.  It returns the io instance
    // so that other modules can register additional event handlers on
    // the same server without creating a second Socket.IO instance.
    const io = setupOfficeSocket(server);

    // Attach room socket handlers to the same io instance.
    // setupRoomSocket registers all room:* event handlers (join, leave,
    // mute, offer, answer, ice-candidate) on the shared io server.
    // It does NOT create a new Socket.IO server or change any CORS,
    // transport, or authentication configuration set by officeSocket.
    setupRoomSocket(io);

    server.listen(PORT, () => {
      console.log(`Backend running at http://localhost:${PORT}`);
      console.log("Socket.IO server is ready!");
    });

    server.on("error", (error) => {
      console.error("Server error:", error.message);
    });

  } catch (error) {
    console.error("Backend startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
