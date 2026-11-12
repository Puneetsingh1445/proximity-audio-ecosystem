
/**
 * roomSocket.js
 *
 * Manages real-time audio room events for ProxiSpeak.
 *
 * This module receives the shared Socket.IO server instance (io)
 * that was already created in officeSocket.js and registers all
 * "room:" prefixed events on it.
 *
 * It does NOT create a new Socket.IO server.
 * It does NOT touch any "voice:" or "player:" events.
 * Those remain untouched in officeSocket.js.
 */

const AudioRoom = require("../models/AudioRoom");
const User      = require("../models/User");

// ==========================================
// IN-MEMORY PARTICIPANT REGISTRY
// ==========================================

/**
 * audioRoomParticipants
 *
 * Tracks who is currently inside each audio room.
 *
 * Structure:
 *   Map {
 *     roomId (string) → Map {
 *       userId (string) → {
 *         userId:   string,   – the authenticated user's ID
 *         name:     string,   – display name shown in the UI
 *         socketId: string,   – the active socket.id for this user
 *         muted:    boolean,  – whether their microphone is muted
 *         joinedAt: Date,     – when they joined this room
 *       }
 *     }
 *   }
 *
 * Why in memory and not MongoDB?
 *   Participant presence is temporary — it disappears the moment
 *   the user disconnects.  Writing and deleting MongoDB documents
 *   on every join/leave/disconnect would be unnecessary overhead.
 *   An in-memory Map is fast, simple and accurate.
 *
 * Limitation:
 *   If the Node.js process restarts, this Map is wiped.
 *   That is acceptable because active WebRTC connections also die
 *   on a server restart — there is nothing useful left to track.
 */
const audioRoomParticipants = new Map();

// ==========================================
// SOCKET-TO-ROOM INDEX
// ==========================================

/**
 * socketRoomMap
 *
 * Maps each socket ID to the roomId it is currently in.
 *
 * Structure:
 *   Map {
 *     socketId (string) → roomId (string)
 *   }
 *
 * Why do we need this?
 *   When a socket disconnects unexpectedly (e.g. the browser closes),
 *   Socket.IO only gives us the socket object — it does not tell us
 *   which audio room that socket was in.  By looking up socketId here
 *   we can find the roomId and clean up the participant list properly.
 *
 *   It also makes duplicate-join detection instant and cheap:
 *   if socketRoomMap.has(socket.id) the user is already in a room.
 */
const socketRoomMap = new Map();

// ==========================================
// HELPER – BUILD SAFE PARTICIPANT LIST
// ==========================================

/**
 * getParticipantList(roomId)
 *
 * Returns a plain array of participant objects for a given room.
 * This is the shape we send to clients — no internal Mongo IDs,
 * no password hashes, no raw Map references.
 *
 * @param  {string} roomId
 * @returns {Array<{ userId, name, muted, joinedAt }>}
 */
function getParticipantList(roomId) {
  const roomParticipants = audioRoomParticipants.get(roomId);

  if (!roomParticipants) {
    return [];
  }

  // Convert the inner Map to a plain array.
  // We deliberately omit socketId — the client has no use for it
  // and exposing internal socket IDs could aid enumeration attacks.
  return Array.from(roomParticipants.values()).map((participant) => ({
    userId:   participant.userId,
    name:     participant.name,
    muted:    participant.muted,
    joinedAt: participant.joinedAt,
  }));
}

// ==========================================
// SETUP FUNCTION
// ==========================================

/**
 * setupRoomSocket(io)
 *
 * Called once from index.js after the Socket.IO server is ready.
 * Receives the same `io` instance that officeSocket.js created,
 * so all authenticated sockets automatically have access to the
 * room events registered here.
 *
 * @param {import("socket.io").Server} io – the shared Socket.IO server
 */
function setupRoomSocket(io) {

  // ==========================================
  // HELPER – LEAVE ROOM
  // ==========================================

  /**
   * leaveRoom(socket, reason)
   *
   * Removes a participant from the audio room they are currently in.
   * This is the single source of truth for all leave scenarios:
   *   • The user clicks "Leave room"  → called by room:leave handler
   *   • The browser closes            → called by disconnect handler
   *   • The network drops             → called by disconnect handler
   *
   * It is defined INSIDE setupRoomSocket so it has automatic access
   * to `io`, `audioRoomParticipants`, and `socketRoomMap` through
   * JavaScript closure — no need to pass those as parameters.
   *
   * The function is intentionally synchronous.  All Map operations
   * are instant; there is no database work here.
   *
   * @param {import("socket.io").Socket} socket – the socket that is leaving
   * @param {string} [reason]  – optional reason string for the server log
   */
  function leaveRoom(socket, reason) {

    // ── 1. Find which room this socket is in ────────────────────────
    // We always use socket.data.userId (set by JWT middleware) —
    // never a userId the client might send in a payload.
    const userId = socket.data.userId;
    const roomId = socketRoomMap.get(socket.id);

    // ── 2. Guard: socket is not in any room ─────────────────────────
    // This is not an error — it happens when disconnect fires after
    // the user already called room:leave manually.
    if (!roomId) {
      return;
    }

    // ── 3. Remove socket from socketRoomMap ─────────────────────────
    // Do this first so that if any code runs between this point and
    // the broadcast, the socket is already marked as "not in a room".
    socketRoomMap.delete(socket.id);

    // ── 4. Remove the socket from the Socket.IO room ────────────────
    // After this call, io.to("room:" + roomId) will NOT deliver
    // events to this socket.  This is what we want — the leaving
    // user should not receive the "user left" broadcast.
    socket.leave("room:" + roomId);

    // ── 5. Remove the participant from the in-memory Map ────────────
    const roomParticipants = audioRoomParticipants.get(roomId);

    if (!roomParticipants) {
      // The room entry was already cleaned up — nothing more to do.
      return;
    }

    // Guard: only remove the entry that belongs to THIS socket's user.
    // A participant entry for this userId might have been replaced by
    // a newer socket (edge case: user reconnects very quickly).
    // We only delete if the stored socketId matches the leaving socket.
    const existing = roomParticipants.get(userId);

    if (existing && existing.socketId === socket.id) {
      roomParticipants.delete(userId);

      console.log(
        `[Room] "${existing.name}" (${userId}) left room` +
        ` "${roomId}". Reason: ${reason || "voluntary"}.` +
        ` Remaining: ${roomParticipants.size}`
      );
    }

    // ── 6. Clean up or broadcast ────────────────────────────────────
    if (roomParticipants.size === 0) {

      // The room is now empty.  Remove the Map entry entirely so
      // we do not accumulate stale keys in audioRoomParticipants.
      audioRoomParticipants.delete(roomId);

      // No broadcast needed — there is nobody left to receive it.
      console.log(
        `[Room] Room "${roomId}" is now empty. Participant Map removed.`
      );

    } else {

      // Notify every remaining participant that the list has changed.
      // Because we called socket.leave() in step 4, the leaving user
      // does NOT receive this event.
      io.to("room:" + roomId).emit("room:participants-updated", {
        roomId,
        participants: getParticipantList(roomId),
      });

    }

  } // end leaveRoom

  // ------------------------------------------
  // CONNECTION HANDLER
  // ------------------------------------------

  /**
   * Every time an authenticated client connects, Socket.IO fires
   * the "connection" event and hands us that specific socket.
   *
   * socket.data.userId is already set by the JWT middleware in
   * officeSocket.js — we do not need to verify the token again here.
   */
  io.on("connection", (socket) => {

    // socket.data.userId is guaranteed to exist here because the
    // io.use() auth middleware in officeSocket.js runs first and
    // rejects unauthenticated connections before they reach this point.

    const userId = socket.data.userId;

    // ==========================================
    // PER-SOCKET SIGNALING RATE LIMITER
    // ==========================================

    /**
     * signalingLimits
     *
     * Tracks how many times this socket has fired each signaling
     * event within the current time window.
     *
     * Structure:
     *   Map {
     *     eventName (string) → {
     *       startTime: number,  – timestamp (ms) when the window opened
     *       count:     number,  – events fired so far in this window
     *     }
     *   }
     *
     * Why a closure Map and not a module-level Map?
     *   officeSocket.js uses the same pattern.  Keeping the Map inside
     *   the connection handler means:
     *   • Each socket gets its own independent counter — one user cannot
     *     deplete another user's quota.
     *   • When the socket disconnects the closure is garbage-collected
     *     automatically, so there is no long-lived Map to clean.
     *   • No shared mutable state across sockets.
     *
     * We deliberately do NOT limit room:join, room:leave or room:mute —
     * those are low-frequency control events and restricting them could
     * prevent users from leaving a room or unmuting in an emergency.
     */
    const signalingLimits = new Map();

    /**
     * allowSignalingEvent(eventName, maxEvents, windowMs)
     *
     * Returns true if the event is within the allowed rate.
     * Returns false if the socket has exceeded the limit for this window.
     *
     * Algorithm: fixed window counter.
     *   • The window resets whenever more than `windowMs` milliseconds
     *     have passed since the window opened.
     *   • Within the same window, the counter increments on each call.
     *   • If the counter reaches `maxEvents` the call is rejected.
     *
     * This is the same algorithm used by officeSocket.js (allowSocketEvent).
     * We mirror it here so the two modules stay consistent and the
     * limits are easy to compare side-by-side.
     *
     * @param  {string} eventName  – the Socket.IO event name (for the Map key)
     * @param  {number} maxEvents  – maximum allowed calls per window
     * @param  {number} windowMs   – window length in milliseconds
     * @returns {boolean}
     */
    function allowSignalingEvent(eventName, maxEvents, windowMs) {
      const now     = Date.now();
      const current = signalingLimits.get(eventName);

      // No entry yet, or the previous window has expired → open a new window.
      if (!current || now - current.startTime >= windowMs) {
        signalingLimits.set(eventName, {
          startTime: now,
          count:     1,
        });

        return true;
      }

      // Still inside the window — check the counter.
      if (current.count >= maxEvents) {
        return false; // limit exceeded
      }

      current.count++;

      return true;
    }

    // ==========================================
    // ROOM JOIN
    // socket.on("room:join", ...)
    // ==========================================

    /**
     * room:join
     *
     * Fired when a client wants to enter a named audio room.
     *
     * Expected payload:  { roomId: string }
     * Callback response: { success, room?, participants?, message? }
     *
     * The client MUST supply a callback (acknowledgement function).
     * We always call it — even on error — so the client knows what happened.
     */
    socket.on("room:join", async (data, callback) => {

      // ── Guard: callback must be a function ───────────────────────
      // If the client forgets to pass a callback we avoid a crash.
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── 1. Validate payload ─────────────────────────────────────
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data)
        ) {
          return respond({
            success: false,
            message: "Invalid request payload.",
          });
        }

        const { roomId } = data;

        if (!roomId || typeof roomId !== "string" || !roomId.trim()) {
          return respond({
            success: false,
            message: "roomId is required and must be a non-empty string.",
          });
        }

        const cleanRoomId = roomId.trim();

        // ── 2. Duplicate-join check (same socket) ───────────────────
        // If this socket already has a roomId recorded, the user is
        // already inside a room.  They must leave first.
        if (socketRoomMap.has(socket.id)) {
          const currentRoom = socketRoomMap.get(socket.id);
          return respond({
            success: false,
            message: currentRoom === cleanRoomId
              ? "You are already in this room."
              : "You are already in another room. Leave it before joining a new one.",
          });
        }

        // ── 3. Find the room in MongoDB ─────────────────────────────
        // We look up by the short roomId string (e.g. "a1b2c3d4"),
        // not by MongoDB's internal _id.
        const room = await AudioRoom.findOne({
          roomId:   cleanRoomId,
          isActive: true,
        }).populate("createdBy", "name");

        // ── 4. Room must exist ──────────────────────────────────────
        if (!room) {
          return respond({
            success: false,
            message: "Room not found.",
          });
        }

        // ── 5. Room must be active (redundant but explicit) ─────────
        if (!room.isActive) {
          return respond({
            success: false,
            message: "This room is no longer active.",
          });
        }

        // ── 6. Get or create the participant Map for this room ──────
        // The first user to join initialises the inner Map.
        if (!audioRoomParticipants.has(cleanRoomId)) {
          audioRoomParticipants.set(cleanRoomId, new Map());
        }

        const roomParticipants = audioRoomParticipants.get(cleanRoomId);

        // ── 7. Enforce maxParticipants ──────────────────────────────
        // This check and the .set() below are synchronous, so there
        // is no race condition in Node.js's single-threaded model.
        if (roomParticipants.size >= room.maxParticipants) {
          return respond({
            success: false,
            message: `Room is full. Maximum ${room.maxParticipants} participants allowed.`,
          });
        }

        // ── 8. Duplicate userId check (different socket) ────────────
        // The same user might have two browser tabs open.  We reject
        // the second join attempt from the same user account.
        if (roomParticipants.has(userId)) {
          return respond({
            success: false,
            message: "Your account is already in this room from another session.",
          });
        }

        // ── 9. Fetch the authenticated user's display name ──────────
        // We NEVER trust a name sent by the client.
        // We fetch it from MongoDB using the verified userId.
        // passwordHash is excluded by `select: false` in the User schema,
        // so it never appears in this result.
        const userRecord = await User.findById(userId).select("name");

        const displayName = userRecord?.name || "ProxiSpeak User";

        // ── 10. Add participant to the in-memory Map ─────────────────
        roomParticipants.set(userId, {
          userId,
          socketId: socket.id,
          name:     displayName,
          muted:    false,
          joinedAt: new Date(),
        });

        // ── 11. Add socket to the Socket.IO room ─────────────────────
        // "room:" prefix avoids any name collision with socket IDs
        // (Socket.IO uses socket IDs as single-socket room names).
        socket.join("room:" + cleanRoomId);

        // ── 12. Record this socket's current room ────────────────────
        socketRoomMap.set(socket.id, cleanRoomId);

        // ── 13. Build the current participant list ───────────────────
        const participants = getParticipantList(cleanRoomId);

        // ── 14. Broadcast updated list to everyone in the room ───────
        // This includes the joiner (they are now in the Socket.IO room).
        // Every participant — including the new one — gets a fresh list.
        io.to("room:" + cleanRoomId).emit(
          "room:participants-updated",
          {
            roomId:       cleanRoomId,
            participants,
          }
        );

        console.log(
          `[Room] ${displayName} (${userId}) joined room "${cleanRoomId}".` +
          ` Participants: ${roomParticipants.size}/${room.maxParticipants}`
        );

        // ── 15. Acknowledge the join to the requesting socket ────────
        return respond({
          success: true,
          message: "Joined room successfully.",
          room: {
            roomId:          room.roomId,
            roomName:        room.roomName,
            description:     room.description,
            maxParticipants: room.maxParticipants,
            createdBy: {
              id:   room.createdBy?._id  || room.createdBy,
              name: room.createdBy?.name || undefined,
            },
          },
          participants,
        });

      } catch (error) {
        // Catch unexpected errors (e.g. MongoDB is unreachable)
        // and report them without leaking internal details.
        console.error("[Room] room:join error:", error.message);

        return respond({
          success: false,
          message: "Failed to join room. Please try again.",
        });
      }

    }); // end room:join

    // ==========================================
    // ROOM LEAVE
    // socket.on("room:leave", ...)
    // ==========================================

    /**
     * room:leave
     *
     * Fired when the client intentionally exits an audio room
     * (e.g. the user clicks the "Leave" button in the UI).
     *
     * Expected payload:  {} or no payload  (roomId is looked up from
     *                    socketRoomMap — the client cannot supply a
     *                    different roomId to remove someone else)
     * Callback response: { success, message }
     */
    socket.on("room:leave", (data, callback) => {

      // ── Guard: callback must be a function ───────────────────────
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── Check the socket is actually in a room ──────────────────
        // We read the room from socketRoomMap, never from client data.
        // This prevents a user from sending a fake roomId to remove
        // someone else from their room.
        if (!socketRoomMap.has(socket.id)) {
          return respond({
            success: false,
            message: "You are not currently in any room.",
          });
        }

        // ── Delegate all cleanup to the shared helper ───────────────
        leaveRoom(socket, "voluntary");

        return respond({
          success: true,
          message: "Left room successfully.",
        });

      } catch (error) {
        console.error("[Room] room:leave error:", error.message);

        return respond({
          success: false,
          message: "Failed to leave room. Please try again.",
        });
      }

    }); // end room:leave

    // ==========================================
    // DISCONNECT CLEANUP
    // socket.on("disconnect", ...)
    // ==========================================

    /**
     * disconnect
     *
     * Socket.IO fires this event whenever a socket loses its
     * connection — whether because:
     *   • The user closed the browser tab
     *   • The browser was refreshed (new socket will reconnect)
     *   • The network dropped
     *   • The server sent a disconnect
     *
     * We call leaveRoom() so the participant list stays accurate
     * and remaining users are notified immediately.
     *
     * NOTE: officeSocket.js also registers a "disconnect" handler on
     * the same socket.  Both handlers run independently — there is no
     * conflict.  This one handles room cleanup; that one handles
     * office-player cleanup.  They do not interfere.
     *
     * @param {string} reason  – Socket.IO disconnect reason string
     */
    socket.on("disconnect", (reason) => {

      try {

        console.log(
          `[Room] Socket disconnected: ${userId}. Reason: ${reason}.` +
          ` In room: ${socketRoomMap.get(socket.id) || "none"}`
        );

        // leaveRoom() safely does nothing if the socket was not in
        // any room (e.g. user never joined, or already called room:leave).
        leaveRoom(socket, reason);

        // Clear the per-socket rate-limit counters.
        // The closure would be garbage-collected anyway once the socket
        // is gone, but clearing the Map eagerly is good practice — it
        // releases memory immediately and makes the cleanup explicit.
        signalingLimits.clear();

      } catch (error) {
        // We catch here so an unexpected error during disconnect cleanup
        // never surfaces as an unhandled exception that could crash the
        // server process.
        console.error("[Room] disconnect cleanup error:", error.message);
      }

    }); // end disconnect

    // ==========================================
    // ROOM MUTE / UNMUTE
    // socket.on("room:mute", ...)
    // ==========================================

    /**
     * room:mute
     *
     * Fired when a participant toggles their own microphone.
     * Updates the in-memory mute state and broadcasts the change
     * to everyone in the same room so their UI stays in sync.
     *
     * Expected payload:  { muted: boolean }
     * Callback response: { success, muted?, message? }
     *
     * Security:
     *   roomId  → read from socketRoomMap   (never from client)
     *   userId  → read from socket.data     (never from client)
     *   A user can only change their OWN mute state.
     */
    socket.on("room:mute", (data, callback) => {

      // ── Guard: callback must be a function ───────────────────────
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── 1. Get roomId from server-side Map (never trust client) ─
        const roomId = socketRoomMap.get(socket.id);

        if (!roomId) {
          return respond({
            success: false,
            message: "You are not currently in any room.",
          });
        }

        // ── 2. userId from verified socket data (never trust client) ─
        // socket.data.userId was written by the JWT middleware in
        // officeSocket.js — the client cannot override it.

        // ── 3. Validate muted flag ──────────────────────────────────
        // We only accept a strict boolean — not "true", 1, or null.
        if (!data || typeof data.muted !== "boolean") {
          return respond({
            success: false,
            message: "muted must be a boolean value (true or false).",
          });
        }

        const { muted } = data;

        // ── 4. Find the participant entry for this room ─────────────
        const roomParticipants = audioRoomParticipants.get(roomId);

        if (!roomParticipants) {
          return respond({
            success: false,
            message: "Room participant data not found.",
          });
        }

        const participant = roomParticipants.get(userId);

        if (!participant) {
          return respond({
            success: false,
            message: "Your participant entry was not found in this room.",
          });
        }

        // ── 5. Confirm the socketId matches this socket ─────────────
        // If the user somehow has a stale socket reference we reject
        // the update to avoid mutating another session's state.
        if (participant.socketId !== socket.id) {
          return respond({
            success: false,
            message: "Session mismatch. Please rejoin the room.",
          });
        }

        // ── 6. Update the mute state in the in-memory Map ───────────
        participant.muted = muted;

        // ── 7. Broadcast the change to everyone in the room ─────────
        // io.to() delivers to ALL sockets in the Socket.IO room,
        // including the sender — so the sender also gets confirmation
        // through the broadcast (useful for multi-tab scenarios).
        io.to("room:" + roomId).emit("room:mute-updated", {
          roomId,
          userId,
          name:  participant.name,   // name from server — never from client
          muted,
        });

        console.log(
          `[Room] ${participant.name} (${userId})` +
          ` ${muted ? "muted" : "unmuted"} in room "${roomId}".`
        );

        // ── 8. Acknowledge the change to the requesting socket ───────
        return respond({
          success: true,
          muted,
        });

      } catch (error) {
        console.error("[Room] room:mute error:", error.message);

        return respond({
          success: false,
          message: "Failed to update mute state. Please try again.",
        });
      }

    }); // end room:mute

    // ==========================================
    // WEBRTC SIGNALING – ROOM-SCOPED OFFER
    // socket.on("room:offer", ...)
    // ==========================================

    /**
     * room:offer
     *
     * Relays a WebRTC SDP offer from one room participant to another.
     * The offer is generated by RTCPeerConnection.onnegotiationneeded
     * on the sender side and must be forwarded to exactly one target.
     *
     * Client sends:    { targetUserId: string, sdp: RTCSessionDescriptionInit }
     * Target receives: { fromUserId: string,   sdp: RTCSessionDescriptionInit }
     *
     * Payload shape is intentionally compatible with the existing
     * voice:offer convention in officeSocket.js so that the frontend
     * can reuse the same RTCSessionDescription handling code.
     *
     * Security:
     *   fromUserId → always socket.data.userId   (never from client)
     *   roomId     → always socketRoomMap lookup  (never from client)
     *   The target must be in the SAME room as the sender.
     */
    socket.on("room:offer", (data, callback) => {

      // ── Guard: callback ────────────────────────────────────────────
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── RATE LIMIT ─────────────────────────────────────────────
        // 10 offers per 10 seconds — same limit as voice:offer in
        // officeSocket.js.  An SDP negotiation rarely produces more
        // than 1–2 offers per pair, so 10/10 s is generous enough for
        // normal use while blocking runaway clients.
        if (!allowSignalingEvent("room:offer", 10, 10_000)) {
          return respond({
            success: false,
            message: "Too many signaling requests. Please slow down.",
          });
        }

        // ── A. ROOM VALIDATION ─────────────────────────────────────

        // Identify sender's room using server-side Map.
        // We NEVER read roomId from the client payload.
        const roomId = socketRoomMap.get(socket.id);

        if (!roomId) {
          return respond({
            success: false,
            message: "You must join a room before sending an offer.",
          });
        }

        // Get the room's participant Map.
        const roomParticipants = audioRoomParticipants.get(roomId);

        if (!roomParticipants) {
          return respond({
            success: false,
            message: "Room participant data not found.",
          });
        }

        // Confirm sender exists in the room and their socketId matches.
        const senderEntry = roomParticipants.get(userId);

        if (!senderEntry || senderEntry.socketId !== socket.id) {
          return respond({
            success: false,
            message: "Sender is not a valid participant in this room.",
          });
        }

        // ── B. PAYLOAD VALIDATION ──────────────────────────────────

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return respond({
            success: false,
            message: "Invalid payload.",
          });
        }

        const { targetUserId, sdp } = data;

        // targetUserId must be a non-empty string.
        if (!targetUserId || typeof targetUserId !== "string") {
          return respond({
            success: false,
            message: "targetUserId is required and must be a string.",
          });
        }

        // A user cannot send an offer to themselves.
        if (targetUserId === userId) {
          return respond({
            success: false,
            message: "Cannot send an offer to yourself.",
          });
        }

        // SDP must be an object (RTCSessionDescriptionInit has type + sdp).
        if (!sdp || typeof sdp !== "object" || Array.isArray(sdp)) {
          return respond({
            success: false,
            message: "sdp must be a valid RTCSessionDescriptionInit object.",
          });
        }

        // ── C. TARGET VALIDATION ───────────────────────────────────

        // The target must be in the SAME room.
        const targetEntry = roomParticipants.get(targetUserId);

        if (!targetEntry) {
          return respond({
            success: false,
            message: "Target user is not in your room.",
          });
        }

        // Resolve the target's live socket.
        const targetSocket = io.sockets.sockets.get(targetEntry.socketId);

        if (!targetSocket) {
          // Target disconnected between the participant list being read
          // and this lookup — nothing we can do here.
          return respond({
            success: false,
            message: "Target user is no longer connected.",
          });
        }

        // ── D. FORWARD THE OFFER ───────────────────────────────────

        // fromUserId comes from server state, not from the client payload.
        // The target cannot be spoofed into thinking this came from
        // a different sender.
        targetSocket.emit("room:offer", {
          fromUserId: userId,
          sdp,
        });

        console.log(
          `[Room] offer: ${userId} → ${targetUserId} in room "${roomId}"`
        );

        return respond({ success: true });

      } catch (error) {
        console.error("[Room] room:offer error:", error.message);

        return respond({
          success: false,
          message: "Failed to relay offer. Please try again.",
        });
      }

    }); // end room:offer

    // ==========================================
    // WEBRTC SIGNALING – ROOM-SCOPED ANSWER
    // socket.on("room:answer", ...)
    // ==========================================

    /**
     * room:answer
     *
     * Relays a WebRTC SDP answer back to the peer who sent the offer.
     * This is the second step of offer/answer negotiation.
     *
     * Client sends:    { targetUserId: string, sdp: RTCSessionDescriptionInit }
     * Target receives: { fromUserId: string,   sdp: RTCSessionDescriptionInit }
     *
     * The same room-scoped validation rules as room:offer apply.
     */
    socket.on("room:answer", (data, callback) => {

      // ── Guard: callback ────────────────────────────────────────────
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── RATE LIMIT ─────────────────────────────────────────────
        // 10 answers per 10 seconds — matches room:offer and voice:answer
        // in officeSocket.js.  Answers are 1-to-1 responses to offers,
        // so the same ceiling applies.
        if (!allowSignalingEvent("room:answer", 10, 10_000)) {
          return respond({
            success: false,
            message: "Too many signaling requests. Please slow down.",
          });
        }

        // ── A. ROOM VALIDATION ─────────────────────────────────────

        const roomId = socketRoomMap.get(socket.id);

        if (!roomId) {
          return respond({
            success: false,
            message: "You must join a room before sending an answer.",
          });
        }

        const roomParticipants = audioRoomParticipants.get(roomId);

        if (!roomParticipants) {
          return respond({
            success: false,
            message: "Room participant data not found.",
          });
        }

        const senderEntry = roomParticipants.get(userId);

        if (!senderEntry || senderEntry.socketId !== socket.id) {
          return respond({
            success: false,
            message: "Sender is not a valid participant in this room.",
          });
        }

        // ── B. PAYLOAD VALIDATION ──────────────────────────────────

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return respond({
            success: false,
            message: "Invalid payload.",
          });
        }

        const { targetUserId, sdp } = data;

        if (!targetUserId || typeof targetUserId !== "string") {
          return respond({
            success: false,
            message: "targetUserId is required and must be a string.",
          });
        }

        if (targetUserId === userId) {
          return respond({
            success: false,
            message: "Cannot send an answer to yourself.",
          });
        }

        if (!sdp || typeof sdp !== "object" || Array.isArray(sdp)) {
          return respond({
            success: false,
            message: "sdp must be a valid RTCSessionDescriptionInit object.",
          });
        }

        // ── C. TARGET VALIDATION ───────────────────────────────────

        const targetEntry = roomParticipants.get(targetUserId);

        if (!targetEntry) {
          return respond({
            success: false,
            message: "Target user is not in your room.",
          });
        }

        const targetSocket = io.sockets.sockets.get(targetEntry.socketId);

        if (!targetSocket) {
          return respond({
            success: false,
            message: "Target user is no longer connected.",
          });
        }

        // ── D. FORWARD THE ANSWER ──────────────────────────────────

        targetSocket.emit("room:answer", {
          fromUserId: userId,
          sdp,
        });

        console.log(
          `[Room] answer: ${userId} → ${targetUserId} in room "${roomId}"`
        );

        return respond({ success: true });

      } catch (error) {
        console.error("[Room] room:answer error:", error.message);

        return respond({
          success: false,
          message: "Failed to relay answer. Please try again.",
        });
      }

    }); // end room:answer

    // ==========================================
    // WEBRTC SIGNALING – ROOM-SCOPED ICE CANDIDATE
    // socket.on("room:ice-candidate", ...)
    // ==========================================

    /**
     * room:ice-candidate
     *
     * Relays an ICE (Interactive Connectivity Establishment) candidate
     * from one room participant to another.
     *
     * ICE candidates are generated continuously by the browser as it
     * discovers network paths (local, STUN-reflexive, TURN-relayed).
     * They must be forwarded to the remote peer so both sides can
     * find the best path and establish a direct audio connection.
     *
     * Client sends:    { targetUserId: string, candidate: RTCIceCandidateInit | null }
     * Target receives: { fromUserId: string,   candidate: RTCIceCandidateInit | null }
     *
     * null is allowed for the ICE end-of-candidates signal — the browser
     * sends a null candidate when it has finished gathering all candidates.
     *
     * We do NOT log every forwarded candidate — ICE trickle generates
     * dozens per negotiation, so logging would flood the server log.
     *
     * Security: same room-scope rules as room:offer.
     */
    socket.on("room:ice-candidate", (data, callback) => {

      // ── Guard: callback ────────────────────────────────────────────
      const respond = typeof callback === "function"
        ? callback
        : () => {};

      try {

        // ── RATE LIMIT ─────────────────────────────────────────────
        // 60 ICE candidates per 10 seconds — matches voice:ice-candidate
        // in officeSocket.js.  ICE trickle generates many candidates
        // rapidly (local, STUN-reflexive, TURN-relayed paths), so the
        // ceiling is higher than for offer/answer.  60/10 s comfortably
        // covers all candidates for a 5-participant room while blocking
        // runaway or malicious clients.
        if (!allowSignalingEvent("room:ice-candidate", 60, 10_000)) {
          return respond({
            success: false,
            message: "Too many signaling requests. Please slow down.",
          });
        }

        // ── A. ROOM VALIDATION ─────────────────────────────────────

        const roomId = socketRoomMap.get(socket.id);

        if (!roomId) {
          return respond({
            success: false,
            message: "You must join a room before sending ICE candidates.",
          });
        }

        const roomParticipants = audioRoomParticipants.get(roomId);

        if (!roomParticipants) {
          return respond({
            success: false,
            message: "Room participant data not found.",
          });
        }

        const senderEntry = roomParticipants.get(userId);

        if (!senderEntry || senderEntry.socketId !== socket.id) {
          return respond({
            success: false,
            message: "Sender is not a valid participant in this room.",
          });
        }

        // ── B. PAYLOAD VALIDATION ──────────────────────────────────

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return respond({
            success: false,
            message: "Invalid payload.",
          });
        }

        const { targetUserId, candidate } = data;

        if (!targetUserId || typeof targetUserId !== "string") {
          return respond({
            success: false,
            message: "targetUserId is required and must be a string.",
          });
        }

        if (targetUserId === userId) {
          return respond({
            success: false,
            message: "Cannot send ICE candidates to yourself.",
          });
        }

        // candidate must be an object or null.
        // null = ICE end-of-candidates (browser signals it has finished gathering).
        if (
          candidate !== null &&
          (typeof candidate !== "object" || Array.isArray(candidate))
        ) {
          return respond({
            success: false,
            message: "candidate must be a valid RTCIceCandidateInit object or null.",
          });
        }

        // ── C. TARGET VALIDATION ───────────────────────────────────

        const targetEntry = roomParticipants.get(targetUserId);

        if (!targetEntry) {
          return respond({
            success: false,
            message: "Target user is not in your room.",
          });
        }

        const targetSocket = io.sockets.sockets.get(targetEntry.socketId);

        if (!targetSocket) {
          return respond({
            success: false,
            message: "Target user is no longer connected.",
          });
        }

        // ── D. FORWARD THE ICE CANDIDATE ───────────────────────────

        targetSocket.emit("room:ice-candidate", {
          fromUserId: userId,
          candidate,
        });

        return respond({ success: true });

      } catch (error) {
        console.error("[Room] room:ice-candidate error:", error.message);

        return respond({
          success: false,
          message: "Failed to relay ICE candidate. Please try again.",
        });
      }

    }); // end room:ice-candidate

  }); // end io.on("connection")

} // end setupRoomSocket

// ==========================================
// EXPORT
// ==========================================

module.exports = setupRoomSocket;
