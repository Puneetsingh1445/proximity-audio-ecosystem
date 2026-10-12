
require("dotenv").config();

const express = require("express");
const connectDB = require("./db");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Backend startup failed.");
    process.exit(1);
  }
};

startServer();
