
const http = require("http");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

jest.mock("../models/User", () => ({
  findById: jest.fn(),
}));

const User = require("../models/User");
const app = require("../app");
const setupOfficeSocket = require("../realtime/officeSocket");

process.env.JWT_SECRET = "proxispeak-lifecycle-test-secret";

let server;
let socketServer;
let serverUrl;
let clients = [];

let testCounter = 0;

function createUser(label) {
  testCounter++;

  return {
    id: `lifecycle-${label}-${Date.now()}-${testCounter}`,
    email: `${label}-${testCounter}@example.com`,
    name: label,
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

function waitForEvent(socket, eventName, timeoutMs = 4000) {
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
    auth: {
      token: createToken(user),
    },
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
      name: "Test User",
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
    if (socket.connected) {
      socket.disconnect();
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  if (socketServer) {
    await new Promise((resolve) => {
      socketServer.close(resolve);
    });
  }
});

describe("ProxiSpeak WebRTC Connection Reliability", () => {

  test("Should notify other participants when a user leaves voice", async () => {
    const userA = createUser("leave-a");
    const userB = createUser("leave-b");

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

    const leftPromise = waitForEvent(
      socketB,
      "voice:user-left"
    );

    socketA.emit("voice:leave");

    const result = await leftPromise;

    expect(result.userId).toBe(userA.id);
  });

  test("Should notify other participants after unexpected disconnection", async () => {
    const userA = createUser("disconnect-a");
    const userB = createUser("disconnect-b");

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

    const leftPromise = waitForEvent(
      socketB,
      "voice:user-left"
    );

    // Simulate the user closing their connection unexpectedly.
    socketA.disconnect();

    const result = await leftPromise;

    expect(result.userId).toBe(userA.id);
  });

  test("Should clean up old socket when the same user reconnects", async () => {
    const userA = createUser("reconnect-a");
    const userB = createUser("reconnect-b");

    const oldSocketA = await connectUser(userA);
    const socketB = await connectUser(userB);

    await joinOffice(oldSocketA, 100, 100);
    await joinOffice(socketB, 200, 200);

    await joinVoice(oldSocketA);

    const joinedPromise = waitForEvent(
      oldSocketA,
      "voice:user-joined"
    );

    await joinVoice(socketB);
    await joinedPromise;

    // Connect again using the same authenticated user.
    const newSocketA = await connectUser(userA);

    const leftPromise = waitForEvent(
      socketB,
      "voice:user-left"
    );

    // Joining the office with the new socket disconnects the old one.
    await joinOffice(newSocketA, 300, 300);

    const leftResult = await leftPromise;

    expect(leftResult.userId).toBe(userA.id);

    // The replacement socket can join the voice room again.
    const joinedAgainPromise = waitForEvent(
      socketB,
      "voice:user-joined"
    );

    const peers = await joinVoice(newSocketA);

    expect(peers.peers).toContain(userB.id);

    const joinedAgain = await joinedAgainPromise;

    expect(joinedAgain.userId).toBe(userA.id);
  });

});
