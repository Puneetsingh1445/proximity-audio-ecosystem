
const http = require("http");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

jest.mock("../models/User", () => ({
  findById: jest.fn(),
}));

const User = require("../models/User");
const app = require("../app");
const setupOfficeSocket = require("../realtime/officeSocket");

process.env.JWT_SECRET = "proxispeak-webrtc-test-secret";

let server;
let socketServer;
let serverUrl;
let clients = [];

const USER_A = {
  id: "webrtc-user-a",
  email: "usera@example.com",
  name: "User A",
};

const USER_B = {
  id: "webrtc-user-b",
  email: "userb@example.com",
  name: "User B",
};

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

function expectNoEvent(socket, eventName, durationMs = 200) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${eventName} should not have been forwarded: ${JSON.stringify(data)}`
        )
      );
    };

    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, durationMs);

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

      const address = server.address();
      serverUrl = `http://127.0.0.1:${address.port}`;

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

  clients = [];

  if (socketServer) {
    await new Promise((resolve) => {
      socketServer.close(resolve);
    });
  }
});

describe("ProxiSpeak WebRTC Signaling Security Tests", () => {

  test("Should block signaling from a user outside the voice room", async () => {
    const socketA = await connectUser(USER_A);
    const socketB = await connectUser(USER_B);

    // User A joins the office but does not join the voice room.
    await joinOffice(socketA, 100, 100);

    const offerCheck = expectNoEvent(socketB, "voice:offer");
    const answerCheck = expectNoEvent(socketB, "voice:answer");
    const iceCheck = expectNoEvent(socketB, "voice:ice-candidate");

    socketA.emit("voice:offer", {
      targetUserId: USER_B.id,
      sdp: {
        type: "offer",
        sdp: "test-offer",
      },
    });

    socketA.emit("voice:answer", {
      targetUserId: USER_B.id,
      sdp: {
        type: "answer",
        sdp: "test-answer",
      },
    });

    socketA.emit("voice:ice-candidate", {
      targetUserId: USER_B.id,
      candidate: {
        candidate: "test-candidate",
      },
    });

    await Promise.all([
      offerCheck,
      answerCheck,
      iceCheck,
    ]);
  });

  test("Should block signaling to a target outside the voice room", async () => {
    const socketA = await connectUser(USER_A);
    const socketB = await connectUser(USER_B);

    await joinOffice(socketA, 100, 100);
    await joinOffice(socketB, 200, 200);

    // Only User A joins the voice room.
    await joinVoice(socketA);

    const offerCheck = expectNoEvent(socketB, "voice:offer");
    const answerCheck = expectNoEvent(socketB, "voice:answer");
    const iceCheck = expectNoEvent(socketB, "voice:ice-candidate");

    socketA.emit("voice:offer", {
      targetUserId: USER_B.id,
      sdp: {
        type: "offer",
        sdp: "test-offer",
      },
    });

    socketA.emit("voice:answer", {
      targetUserId: USER_B.id,
      sdp: {
        type: "answer",
        sdp: "test-answer",
      },
    });

    socketA.emit("voice:ice-candidate", {
      targetUserId: USER_B.id,
      candidate: {
        candidate: "test-candidate",
      },
    });

    await Promise.all([
      offerCheck,
      answerCheck,
      iceCheck,
    ]);
  });

  test("Should forward WebRTC signaling between authorized voice participants", async () => {
    const socketA = await connectUser(USER_A);
    const socketB = await connectUser(USER_B);

    await joinOffice(socketA, 100, 100);
    await joinOffice(socketB, 200, 200);

    // Both users join the voice room.
    const firstJoin = joinVoice(socketA);
    await firstJoin;

    const joinedNotification = waitForEvent(
      socketA,
      "voice:user-joined"
    );

    await joinVoice(socketB);
    await joinedNotification;

    // Test offer: User A -> User B.
    const offerPromise = waitForEvent(socketB, "voice:offer");

    socketA.emit("voice:offer", {
      targetUserId: USER_B.id,
      sdp: {
        type: "offer",
        sdp: "test-offer",
      },
    });

    const offer = await offerPromise;

    expect(offer.fromUserId).toBe(USER_A.id);
    expect(offer.sdp.type).toBe("offer");

    // Test answer: User B -> User A.
    const answerPromise = waitForEvent(socketA, "voice:answer");

    socketB.emit("voice:answer", {
      targetUserId: USER_A.id,
      sdp: {
        type: "answer",
        sdp: "test-answer",
      },
    });

    const answer = await answerPromise;

    expect(answer.fromUserId).toBe(USER_B.id);
    expect(answer.sdp.type).toBe("answer");

    // Test ICE candidate: User A -> User B.
    const icePromise = waitForEvent(
      socketB,
      "voice:ice-candidate"
    );

    socketA.emit("voice:ice-candidate", {
      targetUserId: USER_B.id,
      candidate: {
        candidate: "test-candidate",
      },
    });

    const ice = await icePromise;

    expect(ice.fromUserId).toBe(USER_A.id);
    expect(ice.candidate.candidate).toBe("test-candidate");
  });

});
