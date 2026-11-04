
const http = require("http");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

const app = require("../app");
const setupOfficeSocket = require("../realtime/officeSocket");

process.env.JWT_SECRET = "proxispeak-test-secret";

let server;
let socketServer;
let serverUrl;

beforeAll(async () => {
  server = http.createServer(app);

  socketServer = setupOfficeSocket(server);

  await new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (socketServer) {
    await new Promise((resolve) => {
      socketServer.close(resolve);
    });
  }
});

describe("ProxiSpeak Socket.IO Authentication Tests", () => {

  test("Should reject connection without JWT token", async () => {
    const socket = createClient(serverUrl, {
      reconnection: false,
      timeout: 3000,
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        socket.disconnect();
        reject(new Error("Connection should have been rejected"));
      });

      socket.on("connect_error", (error) => {
        expect(error.message).toBe("Authentication required");
        socket.disconnect();
        resolve();
      });
    });
  });

  test("Should reject connection with invalid JWT token", async () => {
    const socket = createClient(serverUrl, {
      auth: {
        token: "invalid.jwt.token",
      },
      reconnection: false,
      timeout: 3000,
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        socket.disconnect();
        reject(new Error("Invalid token should be rejected"));
      });

      socket.on("connect_error", (error) => {
        expect(error.message).toBe("Invalid or expired token");
        socket.disconnect();
        resolve();
      });
    });
  });

  test("Should accept connection with valid JWT token", async () => {
    const token = jwt.sign(
      {
        id: "test-user-123",
        email: "test@example.com",
        name: "Test User",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "5m",
      }
    );

    const socket = createClient(serverUrl, {
      auth: {
        token,
      },
      reconnection: false,
      timeout: 3000,
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        expect(socket.connected).toBe(true);
        socket.disconnect();
        resolve();
      });

      socket.on("connect_error", (error) => {
        socket.disconnect();
        reject(error);
      });
    });
  });

});
