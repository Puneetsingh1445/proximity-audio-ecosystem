/**
 * useRoomAudio.js
 *
 * WebRTC audio hook for ProxiSpeak Audio Rooms.
 *
 * Responsibilities
 * ----------------
 * • Request microphone permission when the user joins a room.
 * • Create one RTCPeerConnection per remote participant.
 * • Add local microphone tracks to every peer connection.
 * • Exchange SDP offers/answers via room:offer / room:answer.
 * • Exchange ICE candidates via room:ice-candidate.
 * • Play each remote participant's audio stream through a hidden
 *   Audio element (no proximity gain – room audio is always full-volume).
 * • Implement real mute/unmute via MediaStreamTrack.enabled.
 * • Synchronise mute state through room:mute.
 * • Clean up peer connections, audio elements and mic tracks on leave.
 *
 * Design decisions
 * ----------------
 * • Reuses the existing shared Socket.IO connection through socketRef –
 *   never creates a second connection.
 * • Polite-peer offer collision strategy (identical to useSpatialAudio):
 *   lexicographically smaller userId defers (is "polite") when both sides
 *   simultaneously try to create an offer.
 * • ICE candidates that arrive before the remote description is set are
 *   queued and applied once setRemoteDescription resolves.
 * • No proximity / gain-node logic – room audio is always at full volume.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── STUN servers ─────────────────────────────────────────────────────────────
// Same list as useSpatialAudio.js.  TURN servers would be needed for
// production deployments that cross symmetric NATs.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function useRoomAudio({
  socketRef,   // { current: Socket | null } – the shared office socket
  userId,      // string – the authenticated user's own ID
  roomId,      // string | null – roomId currently joined, or null
}) {
  // ── Mic / status state ───────────────────────────────────────────────────
  const [micStatus, setMicStatus] = useState("idle");
  // "idle" | "requesting" | "granted" | "denied" | "error"

  const [muted, setMuted] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  // Live participant list – set from room:join ack and room:participants-updated.
  // Shape: Array<{ userId, name, muted, joinedAt }>
  const [participants, setParticipants] = useState([]);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const localStreamRef  = useRef(null);   // MediaStream from getUserMedia
  const peersRef        = useRef(new Map()); // userId → PeerState
  const mutedRef        = useRef(false);
  const inRoomRef       = useRef(false);
  const userIdRef       = useRef(userId);
  const roomIdRef       = useRef(roomId);

  // Keep refs in sync with props
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { roomIdRef.current = roomId;  }, [roomId]);

  // ── PeerState shape ───────────────────────────────────────────────────────
  // {
  //   pc:           RTCPeerConnection,
  //   audioEl:      HTMLAudioElement | null,
  //   makingOffer:  boolean,
  //   ignoreOffer:  boolean,
  //   icePending:   RTCIceCandidateInit[]  – candidates queued before remoteDesc
  // }

  // ── createPeer ───────────────────────────────────────────────────────────
  /**
   * Creates (or returns the existing) RTCPeerConnection for `remoteUserId`.
   * Attaches local tracks and all WebRTC event handlers.
   */
  const createPeer = useCallback((remoteUserId) => {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peer = {
      pc,
      audioEl:     null,
      makingOffer: false,
      ignoreOffer: false,
      icePending:  [],
    };

    peersRef.current.set(remoteUserId, peer);

    // Add local mic tracks if we already have them.
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // ── ICE candidate signaling ──────────────────────────────────────────
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return; // null = end-of-candidates; server accepts null
      const socket = socketRef.current;
      if (!socket?.connected || !roomIdRef.current) return;

      socket.emit("room:ice-candidate", {
        targetUserId: remoteUserId,
        candidate:    candidate.toJSON(),
      });
    };

    // ── ICE connection failure recovery ──────────────────────────────────
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
    };

    // ── Remote audio track arrived ───────────────────────────────────────
    pc.ontrack = ({ streams }) => {
      const remoteStream = streams[0];
      if (!remoteStream) return;

      // Create a hidden <audio> element for this peer.
      let { audioEl } = peer;
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.setAttribute("playsinline", "");
        peer.audioEl = audioEl;
      }

      audioEl.srcObject = remoteStream;

      // Trigger play (handles autoplay policy; modern browsers allow it
      // in response to user interaction that triggered the join).
      audioEl.play().catch(() => {
        // If autoplay is blocked we fall back to requiring a user gesture.
        // The audio element will start playing once the user interacts.
      });
    };

    // ── Negotiation needed (we are the initiating side) ─────────────────
    pc.onnegotiationneeded = async () => {
      const socket = socketRef.current;
      if (!socket?.connected || !inRoomRef.current) return;

      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();

        socket.emit("room:offer", {
          targetUserId: remoteUserId,
          sdp:          pc.localDescription,
        });
      } catch (err) {
        console.error("[RoomAudio] negotiation error:", err);
      } finally {
        peer.makingOffer = false;
      }
    };

    return peer;
  }, [socketRef]);

  // ── destroyPeer ──────────────────────────────────────────────────────────
  const destroyPeer = useCallback((remoteUserId) => {
    const peer = peersRef.current.get(remoteUserId);
    if (!peer) return;

    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }

    try { peer.pc.close(); } catch { /* ignore */ }

    peersRef.current.delete(remoteUserId);
  }, []);

  // ── destroyAllPeers ──────────────────────────────────────────────────────
  const destroyAllPeers = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) {
      destroyPeer(id);
    }
  }, [destroyPeer]);

  // ── stopLocalStream ──────────────────────────────────────────────────────
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  // ── joinRoomAudio ────────────────────────────────────────────────────────
  /**
   * Called when the user joins a room.  Requests mic and emits room:join.
   * Returns { success, message } matching the server ack shape.
   */
  const joinRoomAudio = useCallback(async (targetRoomId) => {
    if (inRoomRef.current) return { success: false, message: "Already in a room." };

    const socket = socketRef.current;
    if (!socket?.connected) {
      return { success: false, message: "Socket is not connected." };
    }

    // ── 1. Request microphone ──────────────────────────────────────────
    setMicStatus("requesting");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate:       48000,
        },
        video: false,
      });
    } catch (err) {
      const denied =
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError" ||
        err.name === "NotFoundError";

      setMicStatus(denied ? "denied" : "error");

      return {
        success: false,
        message: denied
          ? "Microphone permission denied. Allow access and try again."
          : `Could not access microphone: ${err.message}`,
      };
    }

    // Apply current mute state to tracks immediately.
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !mutedRef.current;
    });

    localStreamRef.current = stream;
    setMicStatus("granted");

    // ── 2. Emit room:join to backend ───────────────────────────────────
    return new Promise((resolve) => {
      socket.emit("room:join", { roomId: targetRoomId }, (ack) => {
        if (!ack?.success) {
          // Join rejected – release mic immediately.
          stopLocalStream();
          setMicStatus("idle");
          resolve(ack || { success: false, message: "No response from server." });
          return;
        }

        inRoomRef.current = true;
        setInRoom(true);

        // Seed participant list from join ack.
        setParticipants(Array.isArray(ack.participants) ? ack.participants : []);

        // ── 3. Create peer connections for existing participants ────────
        // The ack contains the current participant list.
        // We create a peer for every *other* user already in the room.
        const existing = ack.participants ?? [];
        existing.forEach(({ userId: remoteUserId }) => {
          if (remoteUserId !== userIdRef.current) {
            createPeer(remoteUserId);
          }
        });

        resolve(ack);
      });
    });
  }, [socketRef, stopLocalStream, createPeer]);

  // ── leaveRoomAudio ───────────────────────────────────────────────────────
  /**
   * Called when the user clicks "Leave room" or the component unmounts.
   */
  const leaveRoomAudio = useCallback(() => {
    const socket = socketRef.current;

    if (inRoomRef.current && socket?.connected) {
      socket.emit("room:leave", {});
    }

    inRoomRef.current = false;
    setInRoom(false);
    setParticipants([]);

    destroyAllPeers();
    stopLocalStream();

    mutedRef.current = false;
    setMuted(false);
    setMicStatus("idle");
  }, [socketRef, destroyAllPeers, stopLocalStream]);

  // ── toggleMute ───────────────────────────────────────────────────────────
  /**
   * Flips the local microphone mute state and synchronises it with the
   * server via room:mute so other participants see the updated status.
   */
  const toggleMute = useCallback(() => {
    if (!inRoomRef.current) return;

    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;

      // Real mute: disable/enable the MediaStreamTrack directly.
      if (localStreamRef.current) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((t) => { t.enabled = !next; });
      }

      // Synchronise mute state with backend / other participants.
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit("room:mute", { muted: next });
      }

      return next;
    });
  }, [socketRef]);

  // ── Socket event handlers ────────────────────────────────────────────────
  useEffect(() => {
    // ── room:participants-updated ────────────────────────────────────────
    // Fired whenever anyone joins or leaves the room.
    // We reconcile our peer map against the new participant list.
    const onParticipantsUpdated = ({ participants: list }) => {
      if (!inRoomRef.current || !Array.isArray(list)) return;

      // Update participant list state for UI rendering.
      setParticipants(list);

      const remoteIds = new Set(
        list
          .map((p) => p.userId)
          .filter((id) => id !== userIdRef.current)
      );

      // Destroy peers for users who are no longer listed.
      for (const id of [...peersRef.current.keys()]) {
        if (!remoteIds.has(id)) {
          destroyPeer(id);
        }
      }

      // We do NOT auto-create peers here for newly listed users.
      // Peer creation is triggered by room:offer arriving from the
      // remote side, or by us sending an offer via onnegotiationneeded.
      // Creating a peer on every update would cause duplicate connections.
    };

    // ── room:offer ───────────────────────────────────────────────────────
    // A remote participant is initiating a WebRTC connection with us.
    const onOffer = async ({ fromUserId, sdp }) => {
      const socket = socketRef.current;
      if (!socket || !inRoomRef.current) return;
      if (fromUserId === userIdRef.current) return;

      const peer = createPeer(fromUserId);
      const { pc } = peer;

      // Polite-peer glare resolution (same algorithm as useSpatialAudio).
      const offerCollision =
        peer.makingOffer || pc.signalingState !== "stable";

      // The peer with the lexicographically smaller userId is "polite"
      // and will roll back its own offer to accept the remote one.
      const isPolite =
        (userIdRef.current ?? "") < (fromUserId ?? "");

      peer.ignoreOffer = !isPolite && offerCollision;
      if (peer.ignoreOffer) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Drain any ICE candidates that arrived before the remote desc.
        for (const candidate of peer.icePending) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch { /* ignore stale candidates */ }
        }
        peer.icePending = [];

        await pc.setLocalDescription();

        socket.emit("room:answer", {
          targetUserId: fromUserId,
          sdp:          pc.localDescription,
        });
      } catch (err) {
        console.error("[RoomAudio] offer handling error:", err);
      }
    };

    // ── room:answer ──────────────────────────────────────────────────────
    const onAnswer = async ({ fromUserId, sdp }) => {
      if (!inRoomRef.current) return;
      if (fromUserId === userIdRef.current) return;

      const peer = peersRef.current.get(fromUserId);
      if (!peer || peer.pc.signalingState === "stable") return;

      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Drain queued ICE candidates.
        for (const candidate of peer.icePending) {
          try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch { /* ignore */ }
        }
        peer.icePending = [];
      } catch (err) {
        console.error("[RoomAudio] answer handling error:", err);
      }
    };

    // ── room:ice-candidate ───────────────────────────────────────────────
    const onIceCandidate = async ({ fromUserId, candidate }) => {
      if (!inRoomRef.current) return;
      if (fromUserId === userIdRef.current) return;
      if (!candidate) return; // null = end-of-candidates; nothing to add

      const peer = peersRef.current.get(fromUserId);
      if (!peer || peer.ignoreOffer) return;

      // If we don't yet have a remote description, queue the candidate.
      if (!peer.pc.remoteDescription) {
        peer.icePending.push(candidate);
        return;
      }

      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        if (!peer.ignoreOffer) {
          console.error("[RoomAudio] ICE candidate error:", err);
        }
      }
    };

    // ── Socket disconnect ────────────────────────────────────────────────
    const onDisconnect = () => {
      inRoomRef.current = false;
      setInRoom(false);
      setParticipants([]);
      destroyAllPeers();
      stopLocalStream();
      mutedRef.current = false;
      setMuted(false);
      setMicStatus("idle");
    };

    function attach() {
      const socket = socketRef.current;
      if (!socket) return;

      socket.on("room:participants-updated", onParticipantsUpdated);
      socket.on("room:offer",                onOffer);
      socket.on("room:answer",               onAnswer);
      socket.on("room:ice-candidate",        onIceCandidate);
      socket.on("disconnect",                onDisconnect);
    }

    function detach() {
      const socket = socketRef.current;
      if (!socket) return;

      socket.off("room:participants-updated", onParticipantsUpdated);
      socket.off("room:offer",                onOffer);
      socket.off("room:answer",               onAnswer);
      socket.off("room:ice-candidate",        onIceCandidate);
      socket.off("disconnect",                onDisconnect);
    }

    attach();
    return detach;
  }, [
    socketRef,
    createPeer,
    destroyPeer,
    destroyAllPeers,
    stopLocalStream,
  ]);

  // ── Unmount cleanup ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const socket = socketRef.current;
      if (inRoomRef.current && socket?.connected) {
        socket.emit("room:leave", {});
      }
      inRoomRef.current = false;
      destroyAllPeers();
      stopLocalStream();
    };
  }, [socketRef, destroyAllPeers, stopLocalStream]);

  // ── Public API ───────────────────────────────────────────────────────────
  return {
    micStatus,     // "idle" | "requesting" | "granted" | "denied" | "error"
    muted,         // boolean
    inRoom,        // boolean – whether this client has successfully joined
    participants,  // Array<{ userId, name, muted, joinedAt }> – live list
    joinRoomAudio, // async (roomId) => { success, message, participants?, room? }
    leaveRoomAudio,// () => void
    toggleMute,    // () => void
  };
}
