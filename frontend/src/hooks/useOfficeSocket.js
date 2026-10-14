import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.trim();
const JOIN_EVENT = import.meta.env.VITE_SOCKET_JOIN_EVENT || "player:join";
const MOVE_EVENT = import.meta.env.VITE_SOCKET_MOVE_EVENT || "player:move";
const PLAYERS_EVENT = import.meta.env.VITE_SOCKET_PLAYERS_EVENT || "players:update";
const LEAVE_EVENT = import.meta.env.VITE_SOCKET_LEAVE_EVENT || "player:leave";

/**
 * Optional Socket.IO adapter for the ProxiSpeak office.
 * Event names and payloads are a proposed contract; align them with the backend team.
 * Without VITE_SOCKET_URL, the office intentionally runs in local demo mode.
 */
export default function useOfficeSocket({ userId, displayName, getPosition }) {
  const socketRef = useRef(null);
  const [remotePlayers, setRemotePlayers] = useState([]);
  const [status, setStatus] = useState(SOCKET_URL ? "connecting" : "demo");

  const publishPosition = useCallback((position) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit(MOVE_EVENT, {
      userId,
      name: displayName,
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
  }, [displayName, userId]);

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
        name: displayName,
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    };
    const handleDisconnect = () => setStatus("disconnected");
    const handleConnectError = () => setStatus("disconnected");
    const handlePlayers = (payload) => {
      const players = Array.isArray(payload) ? payload : payload?.players;
      if (!Array.isArray(players)) return;
      setRemotePlayers(players.filter((player) => {
        const id = player.userId ?? player.id;
        return id != null && String(id) !== String(userId)
          && Number.isFinite(Number(player.x)) && Number.isFinite(Number(player.y));
      }).map((player) => ({
        id: String(player.userId ?? player.id),
        name: String(player.name || "Teammate"),
        x: Number(player.x),
        y: Number(player.y),
        color: player.color || "#8B7CF6",
      })));
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on(PLAYERS_EVENT, handlePlayers);
    // Some backends send one-player deltas instead of a full player list.
    socket.on("player:moved", (player) => {
      if (!player || (player.userId ?? player.id) == null) return;
      const id = String(player.userId ?? player.id);
      if (id === String(userId)) return;
      setRemotePlayers((current) => {
        const next = current.filter((item) => item.id !== id);
        if (player.left) return next;
        if (!Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return current;
        return [...next, { id, name: String(player.name || "Teammate"), x: Number(player.x), y: Number(player.y), color: player.color || "#8B7CF6" }];
      });
    });

    return () => {
      const position = getPosition();
      if (socket.connected) socket.emit(LEAVE_EVENT, { userId, x: position.x, y: position.y });
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off(PLAYERS_EVENT, handlePlayers);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [displayName, getPosition, userId]);

  return { remotePlayers, connectionStatus: status, publishPosition };
}
