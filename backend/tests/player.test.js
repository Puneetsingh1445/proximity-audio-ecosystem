
const http = require("http");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

jest.mock("../models/User", () => ({
  findById: jest.fn(),
}));

const User = require("../models/User");
const app = require("../app");
const setupOfficeSocket = require("../realtime/officeSocket");

process.env.JWT_SECRET = "proxispeak-player-test-secret";

let server;
let socketServer;
let serverUrl;
let clients = [];

const OFFICE_WIDTH = 1200;
const OFFICE_HEIGHT = 650;

let counter = 0;

function createUser() {
  counter++;

  return {
    id: `player-test-${Date.now()}-${counter}`,
    email: `player${counter}@example.com`,
    name: `Player ${counter}`,
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

async function joinOffice(socket, x = 100, y = 100) {
  const updatePromise = waitForEvent(socket, "players:update");

  socket.emit("player:join", { x, y });

  return updatePromise;
}

beforeEach(async () => {
  clients = [];

  User.findById.mockImplementation(() => ({
    select: jest.fn().mockResolvedValue({
      name: "Test Player",
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

describe("ProxiSpeak Player Movement Tests", () => {

  test("Should accept valid office coordinates", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    const updatePromise = joinOffice(
      socket,
      OFFICE_WIDTH,
      OFFICE_HEIGHT
    );

    const players = await updatePromise;

    const player = players.find(
      (item) => item.userId === user.id
    );

    expect(player).toBeDefined();
    expect(player.x).toBe(OFFICE_WIDTH);
    expect(player.y).toBe(OFFICE_HEIGHT);
  });

  test("Should reject negative coordinates", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    const errorPromise = waitForEvent(
      socket,
      "player:error"
    );

    socket.emit("player:join", {
      x: -10,
      y: 100,
    });

    const error = await errorPromise;

    expect(error).toBe("Invalid position");
  });

  test("Should reject coordinates outside office boundaries", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    const errorPromise = waitForEvent(
      socket,
      "player:error"
    );

    socket.emit("player:join", {
      x: 1201,
      y: 300,
    });

    const error = await errorPromise;

    expect(error).toBe("Invalid position");
  });

  test("Should update player position with valid movement", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    await joinOffice(socket, 100, 100);

    // Wait beyond the server's 80ms movement interval.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updatePromise = waitForEvent(
      socket,
      "players:update"
    );

    socket.emit("player:move", {
      x: 300,
      y: 250,
    });

    const players = await updatePromise;

    const player = players.find(
      (item) => item.userId === user.id
    );

    expect(player.x).toBe(300);
    expect(player.y).toBe(250);
  });

  test("Should ignore movement outside office boundaries", async () => {
    const user = createUser();
    const socket = await connectUser(user);

    await joinOffice(socket, 100, 100);

    const updates = [];

    socket.on("players:update", (players) => {
      updates.push(players);
    });

    socket.emit("player:move", {
      x: 1500,
      y: 300,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const latestUpdate = updates[updates.length - 1];

    expect(latestUpdate).toBeUndefined();
  });

});
