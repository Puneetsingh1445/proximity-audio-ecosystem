import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.trim();
const JOIN_EVENT = import.meta.env.VITE_SOCKET_JOIN_EVENT || "player:join";
const MOVE_EVENT = import.meta.env.VITE_SOCKET_MOVE_EVENT || "player:move";
const PLAYERS_EVENT = import.meta.env.VITE_SOCKET_PLAYERS_EVENT || "players:update";
const LEAVE_EVENT = import.meta.env.VITE_SOCKET_LEAVE_EVENT || "player:leave";

function normalizePlayer(player) {
  const id = player?.userId ?? player?.id;
  if (id == null || player?.x == null || player?.y == null) return null;
  const x = Number(player.x);
  const y = Number(player.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id: String(id), name: String(player.name || "Teammate"), x, y, color: player.color || "#8B7CF6" };
}

/**
 * Optional Socket.IO adapter. Event names/payloads are a proposed contract
 * (see SOCKET_CONTRACT.md). Without VITE_SOCKET_URL the office runs in demo mode.
 */
export default function useOfficeSocket({ userId, displayName, getPosition }) {
  const socketRef = useRef(null);
  const nameRef = useRef(displayName);
  const [remotePlayers, setRemotePlayers] = useState([]);
  const [status, setStatus] = useState(SOCKET_URL ? "connecting" : "demo");

  useEffect(() => { nameRef.current = displayName; }, [displayName]);

  const publishPosition = useCallback((position) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit(MOVE_EVENT, {
      userId,
      name: nameRef.current,
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
  }, [userId]);

  useEffect(() => {
    if (!SOCKET_URL) return undefined;

    const socket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      timeout: 10000,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      setStatus("connected");
      const position = getPosition();
      socket.emit(JOIN_EVENT, {
        userId,
        name: nameRef.current,
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    };
    const handleDisconnect = () => {
      setStatus("disconnected");
      setRemotePlayers([]); // avoid ghost avatars while offline
    };
    const handleConnectError = () => setStatus("disconnected");
    const handlePlayers = (payload) => {
      const list = Array.isArray(payload) ? payload : payload?.players;
      if (!Array.isArray(list)) return;
      setRemotePlayers(list.map(normalizePlayer).filter((p) => p && p.id !== String(userId)));
    };
    // Some backends send one-player deltas instead of a full list.
    const handleMoved = (payload) => {
      const id = payload?.userId ?? payload?.id;
      if (id == null || String(id) === String(userId)) return;
      setRemotePlayers((current) => {
        const rest = current.filter((item) => item.id !== String(id));
        if (payload.left) return rest;
        const next = normalizePlayer(payload);
        return next ? [...rest, next] : current;
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on(PLAYERS_EVENT, handlePlayers);
    socket.on("player:moved", handleMoved);

    return () => {
      const position = getPosition();
      if (socket.connected) socket.emit(LEAVE_EVENT, { userId, x: position.x, y: position.y });
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off(PLAYERS_EVENT, handlePlayers);
      socket.off("player:moved", handleMoved);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [getPosition, userId]);

  return { remotePlayers, connectionStatus: status, publishPosition };
}