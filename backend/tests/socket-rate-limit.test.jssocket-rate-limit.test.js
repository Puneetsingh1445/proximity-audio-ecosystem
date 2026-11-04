
const http = require("http");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

jest.mock("../models/User", () => ({
  findById: jest.fn(),
}));

const User = require("../models/User");
const app = require("../app");
const setupOfficeSocket = require("../realtime/officeSocket");

process.env.JWT_SECRET = "proxispeak-rate-limit-test-secret";

let server;
let socketServer;
let serverUrl;
let clients = [];

let counter = 0;

function createUser() {
  counter++;

  return {
    id: `rate-user-${Date.now()}-${counter}`,
    email: `rate${counter}@example.com`,
    name: `Rate User ${counter}`,
  };
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
}

function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }

    socket.once(eventName, handler);
  });
}

async function connectUser(user) {
  const socket = createClient(serverUrl, {
    auth: { token: createToken(user) },
    reconnection: false,
    timeout: 3000,
    transports: ["websocket"],
  });

  clients.push(socket);

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

  return socket;
}

async function joinOffice(socket, x, y) {
  const updatePromise = waitForEvent(socket, "players:update");

  socket.emit("player:join", { x, y });

  await updatePromise;
}

async function joinVoice(socket) {
  const peersPromise = waitForEvent(socket, "voice:peers");

  socket.emit("voice:join");

  return peersPromise;
}

beforeEach(async () => {
  clients = [];

  User.findById.mockImplementation(() => ({
    select: jest.fn().mockResolvedValue({
      name: "Rate Limit Tester",
    }),
  }));

  server = http.createServer(app);
  socketServer = setupOfficeSocket(server);

  await new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      serverUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  clients.forEach((socket) => {
    if (socket.connected) socket.disconnect();
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  if (socketServer) {
    await new Promise((resolve) => {
      socketServer.close(resolve);
    });
  }
});

describe("ProxiSpeak Socket Event Rate Limiting", () => {

  test("Should ignore movement events sent too quickly", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    await joinOffice(socket, 100, 100);

    // Ensure the initial movement interval has passed.
    await new Promise((resolve) => setTimeout(resolve, 100));

    let updateCount = 0;

    socket.on("players:update", () => {
      updateCount++;
    });

    // First movement should be accepted.
    socket.emit("player:move", {
      x: 200,
      y: 200,
    });

    // Second movement arrives before 80ms.
    socket.emit("player:move", {
      x: 300,
      y: 300,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(updateCount).toBe(1);
  });

  test("Should ignore voice offers exceeding 10 events per 10 seconds", async () => {
    const userA = createUser();
    const userB = createUser();

    const socketA = await connectUser(userA);
    const socketB = await connectUser(userB);

    await joinOffice(socketA, 100, 100);
    await joinOffice(socketB, 200, 200);

    await joinVoice(socketA);

    const joinedPromise = waitForEvent(
      socketA,
      "voice:user-joined"
    );

    await joinVoice(socketB);
    await joinedPromise;

    let receivedOffers = 0;

    socketB.on("voice:offer", () => {
      receivedOffers++;
    });

    // Send 11 offers quickly.
    for (let i = 0; i < 11; i++) {
      socketA.emit("voice:offer", {
        targetUserId: userB.id,
        sdp: {
          type: "offer",
          sdp: `test-offer-${i}`,
        },
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    // The server allows 10 and ignores the 11th.
    expect(receivedOffers).toBe(10);
  });

});
