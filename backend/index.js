require("dotenv").config();

const connectDB = require("./db");
const app = require("./app");

const PORT = Number(process.env.PORT) || 5055;

async function startServer() {
  try {
    await connectDB();

    const server = app.listen(PORT, "127.0.0.1", () => {
      console.log(`Backend running at http://127.0.0.1:${PORT}`);
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