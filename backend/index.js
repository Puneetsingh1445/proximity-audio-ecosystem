require("dotenv").config();

const connectDB = require("./db");
const app = require("./app");

const startServer = async () => {
  try {
    await connectDB();

    const PORT = process.env.PORT || 8000;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("my backend conect successfully")
    });
  } catch (error) {
    console.error("Backend startup failed:", error.message);
    process.exit(1);
  }
};

startServer();