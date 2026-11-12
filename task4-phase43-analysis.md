# Task 4.3 – Real-time Audio Room Management: Pre-Implementation Analysis

**Date:** 2026-11-11  
**Status:** Analysis only — no files modified

---

## 1. How Socket.IO Authentication Currently Works

### Entry point: `backend/index.js`

```
index.js
  → connectDB()           ← connects MongoDB
  → http.createServer(app)  ← wraps Express in HTTP server
  → setupOfficeSocket(server)  ← attaches Socket.IO to same HTTP server
  → server.listen(5055)
```

The key insight: **one HTTP server, one Socket.IO instance**. Everything hangs off that single server.

### Socket.IO JWT middleware in `officeSocket.js` (lines 132–160)

```js
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;   // client sends token here
  if (!token) return next(new Error("Authentication required"));
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  socket.data.userId = String(decoded.id);      // saved on socket object
  next();
});
```

**What this means for Phase 4.3:**
- Every socket already has `socket.data.userId` available — no need to re-verify the JWT anywhere in the room socket code.
- The `io.use()` middleware runs **before** the `connection` event fires, so by the time any socket handler runs, authentication is already confirmed.
- The existing HTTP `authenticate` middleware (used by REST routes) is completely separate. The socket uses its own inline JWT check.

---

## 2. How Socket Connections and Disconnections Are Handled

### Connection lifecycle (inside `io.on("connection", (socket) => {...})`)

```
Socket connects
  │
  ├─ socket.data.userId is set by the auth middleware
  ├─ socket.data.joinStartedAt = Date.now()  (set on line 316)
  │
  ├─ player:join  → adds player to players Map, persists position to MongoDB
  ├─ player:move  → updates position in Map, schedules MongoDB save
  ├─ voice:join   → adds userId to voiceRoom Map
  │
  └─ Disconnect / player:leave
       ├─ removeFromVoice()  → deletes from voiceRoom, notifies peers
       └─ removePlayer()     → clears persistTimer, saves final position, deletes from players Map
```

### Key design patterns used:
1. **Guard against stale sockets** — every handler checks `player.socketId === socket.id` before acting. If the user reconnected, the old socket's handlers silently abort.
2. **Async cleanup** — `removePlayer()` awaits `persistPosition()` before deleting from the Map.
3. **Persistent position timer** — a single `setTimeout` per player avoids a MongoDB write on every move event.

---

## 3. How the Office Movement and Presence System Works

### Data structure
```js
const players = new Map();
// Key:   userId (string)
// Value: { userId, socketId, name, x, y, color, lastMoveAt, persistTimer, ... }
```

### Event flow
```
Frontend emits player:join  →  backend adds to players Map, emits players:update to ALL
Frontend emits player:move  →  backend updates x/y in Map, emits players:update to ALL
Frontend emits player:leave →  backend removes from Map, emits players:update to ALL
```

### Broadcasting
`broadcastPlayers(io)` calls `io.emit("players:update", getPlayers())` — this sends to **every connected socket**. This is intentional for office presence: everyone needs to see everyone.

**Important for Phase 4.3:** Room audio events must NOT use `io.emit()`. They must only target sockets inside the same room.

---

## 4. Whether Socket.IO Rooms Are Currently Used

**No. Socket.IO's built-in room feature is not used anywhere in the codebase.**

The existing code uses plain JavaScript `Map` objects for all grouping:
- `players` Map → who is in the office
- `voiceRoom` Map → who has joined the global voice group

Socket.IO's native `.join(roomId)` / `.to(roomId).emit(...)` API is completely unused.

**This is the most important finding for Phase 4.3.** We have two design choices:

| Option A | Option B |
|---|---|
| Use Socket.IO's native `.join()` and `.to()` | Stick with Maps like the existing code |
| `socket.join(roomId)` to add a socket to a room | `audioRooms.get(roomId).participants.add(userId)` |
| `io.to(roomId).emit(event, data)` to broadcast | Manually iterate Map entries and emit to each socket |
| Cleaner, less code, built-in cleanup on disconnect | Explicit control, same pattern as existing code |

**Recommendation: Use Socket.IO native rooms (Option A)** for audio rooms. Here's why:
- Less boilerplate code.
- Socket.IO automatically removes a socket from all its rooms when it disconnects — no manual cleanup needed for broadcasting.
- We still keep our own in-memory Map for participant data (names, mute status) because Socket.IO rooms only track socket IDs, not user metadata.
- This does not conflict with the existing code because the existing code never calls `.join()` at all.

---

## 5. How the AudioRoom Model Stores Room Information

```js
// MongoDB document (created in Phase 4.2)
{
  roomId:          "a1b2c3d4",   // short 8-char string — the public identifier
  roomName:        "Team Standup",
  description:     "Daily engineering sync",
  createdBy:       ObjectId("..."),  // references User collection
  maxParticipants: 8,
  isActive:        true,
  createdAt:       ISODate(...),
  updatedAt:       ISODate(...)
}
```

**What is NOT in MongoDB (by design):**
- Who is currently connected → lives in memory only (too volatile for DB)
- Mute status → lives in memory only (changes too frequently)
- WebRTC peer connection state → browser-only, never touches the server

**What we need in memory for Phase 4.3** (a new in-memory Map):
```js
const audioRoomParticipants = new Map();
// Key:   roomId (string, e.g. "a1b2c3d4")
// Value: Map<userId, { userId, name, socketId, muted }>
```

---

## 6. How to Implement Separate Audio Rooms Using Socket.IO

### Architecture for Phase 4.3

```
Client A (roomId="a1b2c3d4")       Client B (roomId="a1b2c3d4")       Client C (roomId="zz99yy88")
         │                                     │                                   │
         └──── socket.join("room:a1b2c3d4") ───┘                                   │
                        │                                                           │
               Socket.IO room "room:a1b2c3d4"                          Socket.IO room "room:zz99yy88"
                        │                                                           │
         io.to("room:a1b2c3d4").emit(...)       ←── only A and B receive ───────────┤
                                                                        C is isolated ┘
```

**Naming convention:** prefix Socket.IO room names with `"room:"` to avoid any name collision with socket IDs (Socket.IO uses socket IDs as default single-socket rooms).

### Events for Phase 4.3

| Direction | Event | Payload | Purpose |
|---|---|---|---|
| Client → Server | `room:join` | `{ roomId }` | User wants to enter a named audio room |
| Client → Server | `room:leave` | `{ roomId }` | User voluntarily exits |
| Client → Server | `room:mute` | `{ roomId, muted }` | User toggled their mic |
| Client → Server | `room:offer` | `{ roomId, targetUserId, sdp }` | WebRTC offer (room-scoped) |
| Client → Server | `room:answer` | `{ roomId, targetUserId, sdp }` | WebRTC answer (room-scoped) |
| Client → Server | `room:ice-candidate` | `{ roomId, targetUserId, candidate }` | ICE candidate (room-scoped) |
| Server → Client | `room:participants` | `{ roomId, participants: [...] }` | Sent to joiner with current participant list |
| Server → Client | `room:user-joined` | `{ roomId, user }` | Sent to room when someone new joins |
| Server → Client | `room:user-left` | `{ roomId, userId }` | Sent to room when someone leaves |
| Server → Client | `room:mute-updated` | `{ roomId, userId, muted }` | Sent to room on mute change |
| Server → Client | `room:error` | `{ message }` | Sent to the specific socket that caused an error |

---

## 7. How to Maintain Live Participant Lists

### In-memory structure (new, in `roomSocket.js`)

```js
// Lives only in RAM — reset if the server restarts
const audioRoomParticipants = new Map();
//
// Example state after two users join "a1b2c3d4":
// {
//   "a1b2c3d4": Map {
//     "userId-alice": { userId: "userId-alice", name: "Alice", socketId: "s1", muted: false },
//     "userId-bob":   { userId: "userId-bob",   name: "Bob",   socketId: "s2", muted: true  },
//   }
// }
```

### On `room:join`
1. Look up `roomId` in MongoDB (verify it exists, is active).
2. Check `audioRoomParticipants.get(roomId).size < room.maxParticipants`.
3. Add `socket.join("room:" + roomId)` — socket now receives broadcasts to this room.
4. Add user entry to the in-memory Map.
5. Emit `room:participants` to the joining socket (current list).
6. Emit `room:user-joined` to everyone else in the room.

### On `room:leave` or `disconnect`
1. Find which room(s) this user is in (we track this per-socket).
2. Remove from in-memory Map.
3. `socket.leave("room:" + roomId)` — socket stops receiving broadcasts.
4. Emit `room:user-left` to everyone remaining in the room.
5. If the room is now empty, optionally clean up the Map entry.

---

## 8. How to Enforce maxParticipants Safely

### The race condition problem

If two users try to join simultaneously:
1. User A reads: `participants.size = 7`, `maxParticipants = 8` → allowed ✓
2. User B reads: `participants.size = 7`, `maxParticipants = 8` → allowed ✓
3. Both join → `participants.size = 9` → overflow!

### Solution: synchronous check + add inside the same event handler

Node.js is **single-threaded**. Because `socket.on("room:join", handler)` callbacks never run concurrently for the same process, the check and the add happen atomically from Node's perspective:

```js
socket.on("room:join", async ({ roomId }) => {
  const room = await AudioRoom.findOne({ roomId, isActive: true }); // async DB read
  // ↑ Other joins CAN run here (await yields), but that's fine — see below ↓

  const participants = audioRoomParticipants.get(roomId) || new Map();

  // This check and the .set() below are SYNCHRONOUS
  // No other Node.js code can run between them
  if (participants.size >= room.maxParticipants) {
    return socket.emit("room:error", { message: "Room is full." });
  }

  participants.set(userId, { ... });  // synchronous — safe
  audioRoomParticipants.set(roomId, participants);
});
```

The only async part is the MongoDB lookup. After the `await`, the in-memory Map check+write is synchronous, so there is no race condition for the participant count.

---

## 9. How to Handle Duplicate Joins, Leaving, and Unexpected Disconnects

### Duplicate join prevention

```js
// Store which room each socket is currently in
const socketRoomMap = new Map();
// Key: socketId → Value: roomId

// On room:join
if (socketRoomMap.has(socket.id)) {
  return socket.emit("room:error", {
    message: "You are already in a room. Leave first."
  });
}
```

This prevents:
- Same user joining the same room twice.
- Same user joining two different rooms simultaneously.

### Voluntary leave (`room:leave`)

```js
function leaveRoom(socket, io) {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;  // not in any room

  const participants = audioRoomParticipants.get(roomId);
  if (participants) {
    participants.delete(socket.data.userId);
    if (participants.size === 0) {
      audioRoomParticipants.delete(roomId);  // clean up empty room
    }
  }

  socket.leave("room:" + roomId);
  socketRoomMap.delete(socket.id);

  io.to("room:" + roomId).emit("room:user-left", {
    roomId,
    userId: socket.data.userId,
  });
}
```

### Unexpected disconnect

The `socket.on("disconnect")` handler calls `leaveRoom(socket, io)` — same cleanup path as voluntary leave. This handles:
- Browser tab closed.
- Network drop.
- Page refresh (creates a new socket, old one disconnects).

---

## 10. How to Avoid Breaking Existing WebRTC Signaling and Office Movement

### Existing events (must stay exactly the same)

| Event | Handler in | Used by |
|---|---|---|
| `player:join` | `officeSocket.js` | Office movement |
| `player:move` | `officeSocket.js` | Office movement |
| `player:leave` | `officeSocket.js` | Office cleanup |
| `voice:join` | `officeSocket.js` | Proximity voice (OfficeCanvas) |
| `voice:leave` | `officeSocket.js` | Proximity voice (OfficeCanvas) |
| `voice:offer` | `officeSocket.js` | WebRTC (proximity) |
| `voice:answer` | `officeSocket.js` | WebRTC (proximity) |
| `voice:ice-candidate` | `officeSocket.js` | WebRTC (proximity) |

**All new room events use the `room:` prefix** — there is zero naming overlap.

### How the new code plugs in without touching `officeSocket.js`

`setupOfficeSocket(server)` creates the `io` instance and returns it. We modify `index.js` to capture that return value and pass it to a new `setupRoomSocket(io)` function:

```js
// index.js (only change)
const setupOfficeSocket = require("./realtime/officeSocket");
const setupRoomSocket   = require("./realtime/roomSocket");   // NEW

const io = setupOfficeSocket(server);   // already returns io (line 641)
setupRoomSocket(io);                    // adds room handlers on the SAME io instance
```

This approach:
- Does NOT modify `officeSocket.js` at all.
- Does NOT create a second Socket.IO server.
- Shares the same authenticated connections — a single socket handles both office movement and room audio.
- Room event handlers in `roomSocket.js` are completely independent of the `voice:*` handlers.

---

## 11. Files to Modify or Create for Phase 4.3

### 🆕 New file — `backend/realtime/roomSocket.js`

The main new file. Registers all `room:*` socket event handlers on the shared `io` instance. Contains:
- `audioRoomParticipants` in-memory Map
- `socketRoomMap` (socket → current roomId)
- `room:join` handler
- `room:leave` handler
- `room:mute` handler
- `room:offer` / `room:answer` / `room:ice-candidate` handlers (room-scoped WebRTC relay)
- `room:error` emitter
- `leaveRoom()` helper used by both `room:leave` and `disconnect`

### ✏️ Modified file — `backend/index.js`

One change only:
```js
const io = setupOfficeSocket(server);   // was: setupOfficeSocket(server)
const setupRoomSocket = require("./realtime/roomSocket");
setupRoomSocket(io);
```

`officeSocket.js` already returns `io` on line 641 (`return io;`) but `index.js` currently ignores the return value. We just capture it and pass it on.

### ✅ No changes to these files

| File | Reason |
|---|---|
| `backend/realtime/officeSocket.js` | Complete and working. `room:*` events are independent. |
| `backend/models/AudioRoom.js` | Phase 4.2 complete. |
| `backend/routes/roomRoutes.js` | Phase 4.2 complete. |
| `backend/app.js` | Phase 4.2 complete. |
| `backend/middleware/authenticate.js` | Socket auth is handled inline in officeSocket; unchanged. |
| All frontend files | Phase 4.6–4.7 scope. |

---

## 12. Implementation Plan — Small Steps

### Step 1: Verify `officeSocket.js` already returns `io`

Confirm `return io;` exists at the bottom of `setupOfficeSocket`. ✅ It does (line 641–642).

### Step 2: Create `backend/realtime/roomSocket.js` — skeleton

Create the file with:
- `audioRoomParticipants` Map
- `socketRoomMap` Map
- `setupRoomSocket(io)` function exported
- Empty handlers registered: `room:join`, `room:leave`, `room:mute`

### Step 3: Implement `room:join`

- Validate `roomId` payload.
- Look up room in MongoDB.
- Enforce `maxParticipants`.
- Prevent duplicate join via `socketRoomMap`.
- Add to participant Map.
- `socket.join("room:" + roomId)`.
- Emit `room:participants` to joiner.
- Emit `room:user-joined` to rest of room.

### Step 4: Implement `room:leave` and disconnect cleanup

- Extract `leaveRoom(socket, io)` as shared helper.
- Call it from `room:leave` event.
- Call it from `disconnect` event (already fires on the socket).

### Step 5: Implement `room:mute`

- Validate socket is in a room.
- Update mute status in `audioRoomParticipants`.
- Emit `room:mute-updated` to everyone in the room.

### Step 6: Implement room-scoped WebRTC relay

- `room:offer` — verify sender is in the room, verify target is in the same room, relay.
- `room:answer` — same guards, relay.
- `room:ice-candidate` — same guards, relay.
- Apply rate limiting using the same `allowSocketEvent` pattern from `officeSocket.js`.

### Step 7: Wire into `index.js`

Capture `io` from `setupOfficeSocket(server)` and pass it to `setupRoomSocket(io)`.

### Step 8: Test all scenarios

Using a WebSocket test tool (Postman WebSocket or a simple test script):
- Create room via REST API → join via socket.
- Two browsers join same room → both appear in participant list.
- One browser closes tab → other sees `room:user-left`.
- Try joining when room is full → receive `room:error`.
- Try joining two rooms → receive `room:error`.
- Mute in one browser → other sees `room:mute-updated`.
- Users in different rooms cannot receive each other's events.

---

## Summary Table

| Question | Answer |
|---|---|
| Socket auth mechanism | `io.use()` JWT middleware, `socket.data.userId` already set |
| Native Socket.IO rooms used? | No — this is new in Phase 4.3 |
| Participant tracking | New in-memory `audioRoomParticipants` Map (not MongoDB) |
| maxParticipants enforcement | Synchronous check after async DB read — safe in Node.js |
| Duplicate join | `socketRoomMap` per socket, check before join |
| Disconnect cleanup | `leaveRoom()` helper called from `disconnect` event |
| Breaking existing events? | No — all new events use `room:` prefix, separate file |
| Files changed | `index.js` (1 line) + new `roomSocket.js` |
| Files NOT changed | `officeSocket.js`, all frontend files, models, routes |
