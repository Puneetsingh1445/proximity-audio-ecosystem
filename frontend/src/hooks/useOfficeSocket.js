
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL?.trim();

const JOIN_EVENT = "player:join";
const MOVE_EVENT = "player:move";
const PLAYERS_EVENT = "players:update";
const LEAVE_EVENT = "player:leave";
const POSITION_RESTORED_EVENT = "player:position-restored";

function normalizePlayer(player) {
  const id = player?.userId ?? player?.id;

  if (id == null || player?.x == null || player?.y == null) {
    return null;
  }

  const x = Number(player.x);
  const y = Number(player.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    id: String(id),
    name: String(player.name || "Teammate"),
    x,
    y,
    color: player.color || "#8B7CF6",
    status: player.status || "Online",
  };
}

export default function useOfficeSocket({
  userId,
  displayName,
  token,
  getPosition,
}) {
  const socketRef = useRef(null);
  const nameRef = useRef(displayName);

  const [remotePlayers, setRemotePlayers] = useState([]);
  const [restoredPosition, setRestoredPosition] = useState(null);

  const [status, setStatus] = useState(
    SOCKET_URL && token ? "connecting" : "disconnected"
  );

  useEffect(() => {
    nameRef.current = displayName;
  }, [displayName]);

  const publishPosition = useCallback((position) => {
    const socket = socketRef.current;

    if (!socket?.connected) return;

    socket.emit(MOVE_EVENT, {
      x: Math.round(position.x),
      y: Math.round(position.y),
    });
  }, []);

  useEffect(() => {
    console.log("Socket configuration:", {
      socketURL: SOCKET_URL,
      hasToken: Boolean(token),
      hasUserId: Boolean(userId),
    });

    if (!SOCKET_URL || !token || !userId) {
      console.error("Socket connection skipped: missing configuration");
      setStatus("disconnected");
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: {
        token,
      },
      autoConnect: true,
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      timeout: 10000,
    });

    socketRef.current = socket;

    const handleConnect = () => {
      console.log("Socket connected:", socket.id);
      setStatus("connected");

      const position = getPosition();

      socket.emit(JOIN_EVENT, {
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    };

    const handleDisconnect = (reason) => {
      console.log("Socket disconnected:", reason);
      setStatus("disconnected");
      setRemotePlayers([]);
    };

    const handleConnectError = (error) => {
      console.error("Socket connection error:", error.message);
      setStatus("disconnected");
    };

    const handlePlayers = (payload) => {
      const list = Array.isArray(payload)
        ? payload
        : payload?.players;

      if (!Array.isArray(list)) return;

      setRemotePlayers(
        list
          .map(normalizePlayer)
          .filter(
            (player) => player && player.id !== String(userId)
          )
      );
    };

    const handlePlayerError = (message) => {
      console.error("Office player error:", message);
    };

    // Receive the user's saved position from the backend.
    const handlePositionRestored = (position) => {
      console.log("Saved position restored:", position);

      if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
      ) {
        console.error("Invalid restored position received");
        return;
      }

      setRestoredPosition({
        x: position.x,
        y: position.y,
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on(PLAYERS_EVENT, handlePlayers);
    socket.on("player:error", handlePlayerError);

    socket.on(
      POSITION_RESTORED_EVENT,
      handlePositionRestored
    );

    return () => {
      if (socket.connected) {
        socket.emit(LEAVE_EVENT);
      }

      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off(PLAYERS_EVENT, handlePlayers);
      socket.off("player:error", handlePlayerError);

      socket.off(
        POSITION_RESTORED_EVENT,
        handlePositionRestored
      );

      socket.disconnect();
      socketRef.current = null;
    };
  }, [getPosition, userId, token]);

  return {
    remotePlayers,
    connectionStatus: status,
    publishPosition,
    restoredPosition,
    socket: socketRef.current,
    socketRef,
  };
}
