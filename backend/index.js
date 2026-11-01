
require("dotenv").config();

const http = require("http");
const connectDB = require("./db");
const app = require("./app");
const setupOfficeSocket = require("./realtime/officeSocket");

const PORT = Number(process.env.PORT) || 5055;

async function startServer() {
  try {
    await connectDB();

    // Create HTTP server using Express
    const server = http.createServer(app);

    // Attach Socket.IO to the HTTP server
    setupOfficeSocket(server);

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
