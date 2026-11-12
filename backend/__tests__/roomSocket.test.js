/**
 * roomSocket.test.js
 *
 * Jest integration tests for ProxiSpeak Task 4.3 – room socket events.
 *
 * Strategy
 * --------
 * • We spin up a real in-process HTTP + Socket.IO server on a random
 *   OS-assigned port so tests never conflict with each other or with a
 *   running dev server.
 * • Both setupOfficeSocket and setupRoomSocket are called, exactly as
 *   index.js does, so the full middleware + handler chain is active.
 * • AudioRoom and User are jest-mocked so no MongoDB connection is needed.
 * • JWT tokens are minted in-process with a test-only secret.
 * • The module registry is reset between test-suites (jest.isolateModules
 *   inside beforeEach) so the module-level Maps in roomSocket.js start
 *   empty for every test.
 *
 * Run with:
 *   npx jest --runInBand __tests__/roomSocket.test.js
 */

"use strict";

// ─── Pin the JWT secret before any module that reads it loads ────────────────
process.env.JWT_SECRET = "proxispeak-room-socket-test-secret";

const http = require("http");
const jwt  = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

// ─── Mock both Mongoose models ───────────────────────────────────────────────
// These mocks are hoisted by Jest before any require() runs.

jest.mock("../models/AudioRoom", () => ({
  findOne: jest.fn(),
}));

jest.mock("../models/User", () => ({
  findById: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
}));

// Bring in the mocked references so individual tests can configure them.
const AudioRoom = require("../models/AudioRoom");
const User      = require("../models/User");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_ROOM = {
  roomId:          "testroom",
  roomName:        "Test Room",
  description:     "A test room",
  maxParticipants: 5,
  isActive:        true,
  createdBy:       { _id: "creator-id", name: "Creator" },
};

const USER_A = { id: "room-user-a", email: "a@test.com", name: "Alice" };
const USER_B = { id: "room-user-b", email: "b@test.com", name: "Bob"   };

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
}

/**
 * Wait for a single named event on a socket, with a timeout.
 */
function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }

    socket.once(eventName, handler);
  });
}

/**
 * Assert that a named event is NOT received within a short window.
 */
function expectNoEvent(socket, eventName, durationMs = 250) {
  return new Promise((resolve, reject) => {
    function handler(data) {
      clearTimeout(timer);
      socket.off(eventName, handler);
      reject(new Error(
        `"${eventName}" should NOT have been received but got: ${JSON.stringify(data)}`
      ));
    }

    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, durationMs);

    socket.once(eventName, handler);
  });
}

/**
 * Emit a room:join and await the acknowledgement callback.
 */
function joinRoom(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit("room:join", { roomId }, resolve);
  });
}

/**
 * Emit a room:leave and await the acknowledgement callback.
 */
function leaveRoom(socket) {
  return new Promise((resolve) => {
    socket.emit("room:leave", {}, resolve);
  });
}

/**
 * Connect a socket.io-client, wait until connected.
 */
function connectSocket(serverUrl, user, extraClients) {
  const socket = createClient(serverUrl, {
    auth:          { token: makeToken(user) },
    reconnection:  false,
    timeout:       3000,
    transports:    ["websocket"],
    // The Socket.IO server's CORS policy only permits requests that carry an
    // Origin header matching one of the allowed Vite development origins.
    // When the WebSocket transport connects to http://127.0.0.1:<port> the
    // underlying `ws` library derives the Origin from the URL by default,
    // producing http://127.0.0.1:<port> which is NOT in the allow-list.
    // Setting extraHeaders overrides that so the server accepts the upgrade.
    extraHeaders:  { origin: "http://localhost:5173" },
  });

  extraClients.push(socket);

  return new Promise((resolve, reject) => {
    socket.once("connect",       () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("ProxiSpeak roomSocket.js – integration tests", () => {

  // Per-test state
  let server;
  let io;
  let serverUrl;
  let clients = [];   // all sockets created in a test, cleaned up in afterEach

  // ── Setup ─────────────────────────────────────────────────────────────────

  beforeEach(async () => {
    clients = [];

    // Default User mock – returns a display name for any userId.
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ name: "Alice" }),
    });
    User.updateOne.mockResolvedValue({});

    // Default AudioRoom mock – returns a valid active room.
    AudioRoom.findOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ ...TEST_ROOM }),
    });

    // Fresh server + fresh module instance every test.
    // Using jest.isolateModules ensures the module-level Maps in
    // roomSocket.js (audioRoomParticipants, socketRoomMap) start empty.
    await new Promise((resolve, reject) => {
      jest.isolateModules(() => {
        const app              = require("../app");
        const setupOfficeSocket = require("../realtime/officeSocket");
        const setupRoomSocket   = require("../realtime/roomSocket");

        server = http.createServer(app);
        io     = setupOfficeSocket(server);
        setupRoomSocket(io);

        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          const { port } = server.address();
          serverUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });
  });

  // ── Teardown ──────────────────────────────────────────────────────────────

  afterEach(async () => {
    // Disconnect all sockets created during the test.
    clients.forEach((s) => { if (s.connected) s.disconnect(); });
    clients = [];

    // Allow disconnect events to propagate before closing the server.
    await new Promise((r) => setTimeout(r, 100));

    // Close the Socket.IO server, then the HTTP server.
    if (io) {
      await new Promise((resolve) => io.close(resolve));
      io = null;
    }

    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }

    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. ROOM JOIN
  // ══════════════════════════════════════════════════════════════════════════

  describe("room:join", () => {

    test("acknowledges success when room exists and is active", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await joinRoom(socketA, TEST_ROOM.roomId);

      expect(ack.success).toBe(true);
      expect(ack.message).toBe("Joined room successfully.");
      expect(ack.room.roomId).toBe(TEST_ROOM.roomId);
      expect(ack.room.roomName).toBe(TEST_ROOM.roomName);
      expect(Array.isArray(ack.participants)).toBe(true);
      expect(ack.participants).toHaveLength(1);
      expect(ack.participants[0].userId).toBe(USER_A.id);
      expect(ack.participants[0].muted).toBe(false);
    });

    test("rejects when roomId is missing", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:join", {}, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/roomId is required/i);
    });

    test("rejects when roomId is not a string", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:join", { roomId: 42 }, resolve);
      });

      expect(ack.success).toBe(false);
    });

    test("rejects when room is not found in DB", async () => {
      AudioRoom.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const ack     = await joinRoom(socketA, "nonexistent");

      expect(ack.success).toBe(false);
      expect(ack.message).toBe("Room not found.");
    });

    test("rejects when user tries to join same room twice (duplicate join)", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      // First join must succeed.
      const first = await joinRoom(socketA, TEST_ROOM.roomId);
      expect(first.success).toBe(true);

      // Second join on the same socket must be rejected.
      const second = await joinRoom(socketA, TEST_ROOM.roomId);
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already in this room/i);
    });

    test("rejects when user is already in a different room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const first = await joinRoom(socketA, "room-one");
      expect(first.success).toBe(true);

      const second = await joinRoom(socketA, "room-two");
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already in another room/i);
    });

    test("rejects when room is full", async () => {
      // maxParticipants = 1 — immediately full after one join.
      AudioRoom.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          ...TEST_ROOM,
          maxParticipants: 1,
        }),
      });

      // User mock returns different names per call so both IDs are distinct.
      let callCount = 0;
      User.findById.mockImplementation(() => ({
        select: jest.fn().mockResolvedValue({
          name: callCount++ === 0 ? "Alice" : "Bob",
        }),
      }));

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      const ackA = await joinRoom(socketA, TEST_ROOM.roomId);
      expect(ackA.success).toBe(true);

      const ackB = await joinRoom(socketB, TEST_ROOM.roomId);
      expect(ackB.success).toBe(false);
      expect(ackB.message).toMatch(/full/i);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. PARTICIPANT LIST BROADCAST
  // ══════════════════════════════════════════════════════════════════════════

  describe("room:participants-updated broadcast", () => {

    test("first joiner receives updated participant list with themselves", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      // Listen BEFORE joining so we don't miss the event.
      const updatePromise = waitForEvent(socketA, "room:participants-updated");

      await joinRoom(socketA, TEST_ROOM.roomId);

      const update = await updatePromise;

      expect(update.roomId).toBe(TEST_ROOM.roomId);
      expect(Array.isArray(update.participants)).toBe(true);
      expect(update.participants).toHaveLength(1);
      expect(update.participants[0].userId).toBe(USER_A.id);
    });

    test("existing member receives updated list when second user joins", async () => {
      // Make User.findById return different names for A and B.
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);

      // Catch the NEXT participants-updated on socketA after B joins.
      const updateOnA = waitForEvent(socketA, "room:participants-updated");

      await joinRoom(socketB, TEST_ROOM.roomId);

      const update = await updateOnA;

      expect(update.roomId).toBe(TEST_ROOM.roomId);
      expect(update.participants).toHaveLength(2);

      const ids = update.participants.map((p) => p.userId);
      expect(ids).toContain(USER_A.id);
      expect(ids).toContain(USER_B.id);
    });

    test("remaining member receives updated list when other user leaves", async () => {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      await joinRoom(socketB, TEST_ROOM.roomId);

      // Listen on A for the update that fires after B leaves.
      const afterLeave = waitForEvent(socketA, "room:participants-updated");
      await leaveRoom(socketB);
      const update = await afterLeave;

      expect(update.participants).toHaveLength(1);
      expect(update.participants[0].userId).toBe(USER_A.id);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. ROOM LEAVE
  // ══════════════════════════════════════════════════════════════════════════

  describe("room:leave", () => {

    test("acknowledges success when user is in a room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);
      await joinRoom(socketA, TEST_ROOM.roomId);

      const ack = await leaveRoom(socketA);

      expect(ack.success).toBe(true);
      expect(ack.message).toBe("Left room successfully.");
    });

    test("rejects when user is not in any room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await leaveRoom(socketA);

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/not currently in any room/i);
    });

    test("user can rejoin after leaving", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      const leaveAck = await leaveRoom(socketA);
      expect(leaveAck.success).toBe(true);

      const rejoinAck = await joinRoom(socketA, TEST_ROOM.roomId);
      expect(rejoinAck.success).toBe(true);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. ROOM MUTE
  // ══════════════════════════════════════════════════════════════════════════

  describe("room:mute", () => {

    test("acknowledges mute state change", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);
      await joinRoom(socketA, TEST_ROOM.roomId);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:mute", { muted: true }, resolve);
      });

      expect(ack.success).toBe(true);
      expect(ack.muted).toBe(true);
    });

    test("broadcasts room:mute-updated to all room members", async () => {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      await joinRoom(socketB, TEST_ROOM.roomId);

      // Both sockets should receive the event.
      const muteOnA = waitForEvent(socketA, "room:mute-updated");
      const muteOnB = waitForEvent(socketB, "room:mute-updated");

      socketA.emit("room:mute", { muted: true });

      const [evA, evB] = await Promise.all([muteOnA, muteOnB]);

      expect(evA.userId).toBe(USER_A.id);
      expect(evA.muted).toBe(true);
      expect(evB.userId).toBe(USER_A.id);
      expect(evB.muted).toBe(true);
    });

    test("rejects mute when user is not in a room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:mute", { muted: true }, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/not currently in any room/i);
    });

    test("rejects mute when muted field is not a boolean", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);
      await joinRoom(socketA, TEST_ROOM.roomId);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:mute", { muted: "true" }, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/boolean/i);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DISCONNECT CLEANUP
  // ══════════════════════════════════════════════════════════════════════════

  describe("disconnect cleanup", () => {

    test("remaining member receives participants-updated after peer disconnects", async () => {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      await joinRoom(socketB, TEST_ROOM.roomId);

      // Watch for the update on A after B drops.
      const updateOnA = waitForEvent(socketA, "room:participants-updated", 4000);

      // Hard disconnect — simulates browser close / network drop.
      socketB.disconnect();

      const update = await updateOnA;

      expect(update.roomId).toBe(TEST_ROOM.roomId);
      expect(update.participants).toHaveLength(1);
      expect(update.participants[0].userId).toBe(USER_A.id);
    });

    test("no broadcast sent when last member disconnects (room becomes empty)", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);
      await joinRoom(socketA, TEST_ROOM.roomId);

      // Connect a second listener that is NOT in the room to verify silence.
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      const noUpdateOnB = expectNoEvent(socketB, "room:participants-updated", 400);

      socketA.disconnect();

      // B should not receive anything — they are not in the room.
      await noUpdateOnB;
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. ROOM-SCOPED WEBRTC SIGNALING
  // ══════════════════════════════════════════════════════════════════════════

  describe("room:offer / room:answer / room:ice-candidate", () => {

    // Helper: join both users into the same room.
    async function bothInRoom() {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      await joinRoom(socketB, TEST_ROOM.roomId);

      return { socketA, socketB };
    }

    // ── room:offer ────────────────────────────────────────────────────────

    test("forwards room:offer to target, fromUserId is set server-side", async () => {
      const { socketA, socketB } = await bothInRoom();

      const offerOnB = waitForEvent(socketB, "room:offer");

      socketA.emit("room:offer", {
        targetUserId: USER_B.id,
        sdp:          { type: "offer", sdp: "test-offer-sdp" },
      });

      const received = await offerOnB;

      expect(received.fromUserId).toBe(USER_A.id);
      expect(received.sdp.type).toBe("offer");
      expect(received.sdp.sdp).toBe("test-offer-sdp");
    });

    test("acknowledges success for a valid room:offer", async () => {
      const { socketA } = await bothInRoom();

      const ack = await new Promise((resolve) => {
        socketA.emit("room:offer", {
          targetUserId: USER_B.id,
          sdp:          { type: "offer", sdp: "test-offer" },
        }, resolve);
      });

      expect(ack.success).toBe(true);
    });

    test("rejects room:offer when sender is not in a room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:offer", {
          targetUserId: USER_B.id,
          sdp:          { type: "offer", sdp: "test" },
        }, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/join a room/i);
    });

    test("rejects room:offer when target is not in the room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);
      await joinRoom(socketA, TEST_ROOM.roomId);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:offer", {
          targetUserId: "user-not-in-room",
          sdp:          { type: "offer", sdp: "test" },
        }, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/not in your room/i);
    });

    test("does NOT deliver room:offer to a user outside the room", async () => {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      // Only A joins the room; B does not.
      await joinRoom(socketA, TEST_ROOM.roomId);

      const noOfferOnB = expectNoEvent(socketB, "room:offer", 350);

      socketA.emit("room:offer", {
        targetUserId: USER_B.id,
        sdp:          { type: "offer", sdp: "test" },
      });

      await noOfferOnB;
    });

    // ── room:answer ───────────────────────────────────────────────────────

    test("forwards room:answer to target with server-set fromUserId", async () => {
      const { socketA, socketB } = await bothInRoom();

      const answerOnA = waitForEvent(socketA, "room:answer");

      socketB.emit("room:answer", {
        targetUserId: USER_A.id,
        sdp:          { type: "answer", sdp: "test-answer-sdp" },
      });

      const received = await answerOnA;

      expect(received.fromUserId).toBe(USER_B.id);
      expect(received.sdp.type).toBe("answer");
    });

    // ── room:ice-candidate ────────────────────────────────────────────────

    test("forwards room:ice-candidate to target", async () => {
      const { socketA, socketB } = await bothInRoom();

      const iceOnB = waitForEvent(socketB, "room:ice-candidate");

      socketA.emit("room:ice-candidate", {
        targetUserId: USER_B.id,
        candidate:    { candidate: "test-candidate", sdpMLineIndex: 0, sdpMid: "0" },
      });

      const received = await iceOnB;

      expect(received.fromUserId).toBe(USER_A.id);
      expect(received.candidate.candidate).toBe("test-candidate");
    });

    test("forwards null ICE candidate (end-of-candidates signal)", async () => {
      const { socketA, socketB } = await bothInRoom();

      const iceOnB = waitForEvent(socketB, "room:ice-candidate");

      socketA.emit("room:ice-candidate", {
        targetUserId: USER_B.id,
        candidate:    null,
      });

      const received = await iceOnB;

      expect(received.fromUserId).toBe(USER_A.id);
      expect(received.candidate).toBeNull();
    });

    test("rejects room:ice-candidate when sender is not in a room", async () => {
      const socketA = await connectSocket(serverUrl, USER_A, clients);

      const ack = await new Promise((resolve) => {
        socketA.emit("room:ice-candidate", {
          targetUserId: USER_B.id,
          candidate:    { candidate: "test" },
        }, resolve);
      });

      expect(ack.success).toBe(false);
      expect(ack.message).toMatch(/join a room/i);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. SIGNALING RATE LIMITING
  // ══════════════════════════════════════════════════════════════════════════

  describe("signaling rate limiting", () => {

    // Helper: join both users and return sockets
    async function bothInRoom() {
      User.findById
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Alice" }) })
        .mockReturnValueOnce({ select: jest.fn().mockResolvedValue({ name: "Bob"   }) });

      const socketA = await connectSocket(serverUrl, USER_A, clients);
      const socketB = await connectSocket(serverUrl, USER_B, clients);

      await joinRoom(socketA, TEST_ROOM.roomId);
      await joinRoom(socketB, TEST_ROOM.roomId);

      return { socketA, socketB };
    }

    test("blocks room:offer after 10 requests in 10 seconds", async () => {
      const { socketA } = await bothInRoom();

      const acks = [];

      // Fire 11 offers synchronously (Node.js is single-threaded — all queue
      // before any response arrives, then acks resolve in order).
      await new Promise((resolve) => {
        let done = 0;

        for (let i = 0; i < 11; i++) {
          socketA.emit(
            "room:offer",
            { targetUserId: USER_B.id, sdp: { type: "offer", sdp: `offer-${i}` } },
            (ack) => {
              acks.push(ack);
              if (++done === 11) resolve();
            }
          );
        }
      });

      // Requests 1–10 should succeed; request 11 should be blocked.
      const successes = acks.filter((a) => a.success === true);
      const failures  = acks.filter((a) => a.success === false);

      expect(successes).toHaveLength(10);
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe(
        "Too many signaling requests. Please slow down."
      );
    });

    test("blocked room:offer is NOT relayed to the target", async () => {
      const { socketA, socketB } = await bothInRoom();

      const receivedOffers = [];
      socketB.on("room:offer", (data) => receivedOffers.push(data));

      // Fire 11 offers and wait for all acks.
      await new Promise((resolve) => {
        let done = 0;

        for (let i = 0; i < 11; i++) {
          socketA.emit(
            "room:offer",
            { targetUserId: USER_B.id, sdp: { type: "offer", sdp: `offer-${i}` } },
            () => { if (++done === 11) resolve(); }
          );
        }
      });

      // Give a little time for any stray delivery to arrive.
      await new Promise((r) => setTimeout(r, 150));

      // B should have received exactly 10 offers (not 11).
      expect(receivedOffers).toHaveLength(10);
    });

    test("blocks room:answer after 10 requests in 10 seconds", async () => {
      const { socketA } = await bothInRoom();

      const acks = [];

      await new Promise((resolve) => {
        let done = 0;

        for (let i = 0; i < 11; i++) {
          socketA.emit(
            "room:answer",
            { targetUserId: USER_B.id, sdp: { type: "answer", sdp: `answer-${i}` } },
            (ack) => {
              acks.push(ack);
              if (++done === 11) resolve();
            }
          );
        }
      });

      const failures = acks.filter((a) => a.success === false);
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe(
        "Too many signaling requests. Please slow down."
      );
    });

    test("blocks room:ice-candidate after 60 requests in 10 seconds", async () => {
      const { socketA } = await bothInRoom();

      const acks = [];

      await new Promise((resolve) => {
        let done = 0;

        for (let i = 0; i < 61; i++) {
          socketA.emit(
            "room:ice-candidate",
            { targetUserId: USER_B.id, candidate: { candidate: `ice-${i}` } },
            (ack) => {
              acks.push(ack);
              if (++done === 61) resolve();
            }
          );
        }
      });

      const successes = acks.filter((a) => a.success === true);
      const failures  = acks.filter((a) => a.success === false);

      expect(successes).toHaveLength(60);
      expect(failures).toHaveLength(1);
      expect(failures[0].message).toBe(
        "Too many signaling requests. Please slow down."
      );
    });

    test("rate limits are independent per socket (User B not affected by A exceeding limit)", async () => {
      const { socketA, socketB } = await bothInRoom();

      // Exhaust User A's offer limit.
      await new Promise((resolve) => {
        let done = 0;

        for (let i = 0; i < 11; i++) {
          socketA.emit(
            "room:offer",
            { targetUserId: USER_B.id, sdp: { type: "offer", sdp: `offer-${i}` } },
            () => { if (++done === 11) resolve(); }
          );
        }
      });

      // User B should still be able to send an offer successfully.
      const ackB = await new Promise((resolve) => {
        socketB.emit(
          "room:offer",
          { targetUserId: USER_A.id, sdp: { type: "offer", sdp: "b-offer" } },
          resolve
        );
      });

      expect(ackB.success).toBe(true);
    });

  });

});
