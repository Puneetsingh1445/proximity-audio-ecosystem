# ProxiSpeak virtual office: frontend Socket.IO contract

The virtual office works locally without a backend. To enable multiplayer, set `VITE_SOCKET_URL` in `.env.local` and agree on the event names and payloads below with the backend developer.

## Proposed events

### Client -> server

- `player:join`: `{ userId: string, name: string, x: number, y: number }`
- `player:move`: `{ userId: string, name: string, x: number, y: number }` (emitted while moving, throttled to about 12.5 updates/second)
- `player:leave`: `{ userId: string, x: number, y: number }`

### Server -> client

- `players:update`: either an array of `{ userId: string, name: string, x: number, y: number, color?: string }` or `{ players: [...] }`
- Optional `player:moved` delta event: `{ userId: string, name: string, x: number, y: number, color?: string, left?: boolean }`

The client ignores its own ID in remote-player lists. A server should validate all coordinates, associate `userId` with the authenticated socket rather than trusting client identity, enforce office bounds, and rate-limit movement messages. The event names/payloads are a proposed integration contract, not a claim about the teammate's current backend. Update the environment variables or adapter to match the real server contract.

## Environment variables

Copy `.env.example` to `.env.local` and set `VITE_SOCKET_URL` to the backend's Socket.IO URL, for example `http://localhost:3000`. If blank or omitted, the app uses three sample avatars and local movement. `VITE_SOCKET_JOIN_EVENT`, `VITE_SOCKET_MOVE_EVENT`, `VITE_SOCKET_PLAYERS_EVENT`, and `VITE_SOCKET_LEAVE_EVENT` override the default event names.

Vite environment variables are public to browser code. Never put API secrets or private keys in `VITE_*` variables.

## Current feature boundary

Implemented in the frontend: Canvas office map, avatar rendering, WASD/arrow-key movement, touch controls, map-edge limits, collision against desk/meeting/lounge rectangles, responsive canvas scaling, local sample avatars, position display, reset control and optional Socket.IO position sync.

Not implemented in this milestone: WebRTC audio, distance-based audio gain/panning, authentication, server-side collision validation, persistence, room membership, or backend load testing. The backend must be running and follow the agreed contract before remote multiplayer is considered verified.
