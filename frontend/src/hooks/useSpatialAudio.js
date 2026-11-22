
import { useCallback, useEffect, useRef, useState } from "react";

// Audio range configuration
export const AUDIO_CONFIG = {
  INNER_RADIUS: 100,
  MAX_RADIUS: 250,
};

// Calculate distance between two players
function calcDistance(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Calculate audio volume based on distance
function calcGain(distance) {
  const { INNER_RADIUS, MAX_RADIUS } = AUDIO_CONFIG;

  if (!Number.isFinite(distance) || distance >= MAX_RADIUS) {
    return 0;
  }

  if (distance <= INNER_RADIUS) {
    return 1;
  }

  const t = (distance - INNER_RADIUS) / (MAX_RADIUS - INNER_RADIUS);
  return (1 - t) ** 2;
}

// STUN servers for WebRTC connectivity
// TURN servers are needed for reliable cross-network deployment.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function useSpatialAudio({
  socketRef,
  userId,
  position,
  remotePlayers,
  enabled = true,
}) {
  // Microphone states
  const [micStatus, setMicStatus] = useState("idle");
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);

  // Connected WebRTC peers
  const [connectedPeers, setConnectedPeers] = useState([]);

  // Refs
  const localStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const peersRef = useRef(new Map());

  const positionRef = useRef(position);
  const remotePlayersRef = useRef(remotePlayers);
  const mutedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const joinedVoiceRef = useRef(false);
  const userIdRef = useRef(userId);

  // Keep refs updated
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
  }, [remotePlayers]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Create audio context when needed
  function getAudioCtx() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;

      if (Ctx) {
        audioCtxRef.current = new Ctx();
      }
    }

    return audioCtxRef.current;
  }

  // Create WebRTC peer connection
  const createPeer = useCallback((remoteUserId) => {
    const existing = peersRef.current.get(remoteUserId);

    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    const peer = {
      pc,
      gainNode: null,
      sourceNode: null,
      audioEl: null,
      makingOffer: false,
      ignoreOffer: false,
    };

    peersRef.current.set(remoteUserId, peer);

    // Add local microphone tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // ICE candidate signaling
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current?.connected) {
        socketRef.current.emit("voice:ice-candidate", {
          targetUserId: remoteUserId,
          candidate: candidate.toJSON(),
        });
      }
    };

    // ICE connection recovery
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try {
          pc.restartIce();
        } catch {
          // Ignore restart errors
        }
      }
    };

    // Handle remote audio
    pc.ontrack = ({ streams }) => {
      const remoteStream = streams[0];

      if (!remoteStream) {
        return;
      }

      let audioEl = peer.audioEl;

      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.setAttribute("playsinline", "");
        peer.audioEl = audioEl;
      }

      audioEl.srcObject = remoteStream;

      const ctx = getAudioCtx();

      if (ctx) {
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }

        if (peer.sourceNode) {
          try {
            peer.sourceNode.disconnect();
          } catch {
            // Ignore cleanup errors
          }
        }

        const sourceNode = ctx.createMediaStreamSource(remoteStream);
        const gainNode = ctx.createGain();

        gainNode.gain.value = 0;

        sourceNode.connect(gainNode);
        gainNode.connect(ctx.destination);

        peer.sourceNode = sourceNode;
        peer.gainNode = gainNode;

        // Avoid playing audio twice
        audioEl.volume = 0;
      } else {
        audioEl.play().catch((error) => {
          console.warn("Remote audio playback failed:", error);
        });
      }

      setConnectedPeers((prev) =>
        prev.includes(remoteUserId)
          ? prev
          : [...prev, remoteUserId]
      );
    };

    // WebRTC negotiation
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;

        await pc.setLocalDescription();

        socketRef.current?.emit("voice:offer", {
          targetUserId: remoteUserId,
          sdp: pc.localDescription,
        });
      } catch (error) {
        console.error(
          "[SpatialAudio] negotiation error:",
          error
        );
      } finally {
        peer.makingOffer = false;
      }
    };

    return peer;
  }, []);

  // Destroy one peer
  const destroyPeer = useCallback((remoteUserId) => {
    const peer = peersRef.current.get(remoteUserId);

    if (!peer) {
      return;
    }

    try {
      peer.gainNode?.disconnect();
    } catch {}

    try {
      peer.sourceNode?.disconnect();
    } catch {}

    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }

    try {
      peer.pc.close();
    } catch {}

    peersRef.current.delete(remoteUserId);

    setConnectedPeers((prev) =>
      prev.filter((id) => id !== remoteUserId)
    );
  }, []);

  // Destroy all peers
  const destroyAllPeers = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) {
      destroyPeer(id);
    }

    setConnectedPeers([]);
  }, [destroyPeer]);

  // Stop local microphone
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });

      localStreamRef.current = null;
    }

    setVoiceActive(false);
  }, []);

  // Join voice room
  const joinVoice = useCallback(async () => {
    if (!enabledRef.current) {
      return;
    }

    if (joinedVoiceRef.current) {
      return;
    }

    const socket = socketRef.current;

    if (!socket?.connected) {
      console.error("[SpatialAudio] Socket is not connected.");
      return;
    }

    setMicStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
        video: false,
      });

      // If the user left while the permission request was pending,
      // stop the newly acquired microphone stream.
      if (!enabledRef.current || !socketRef.current?.connected) {
        stream.getTracks().forEach((track) => track.stop());
        setMicStatus("idle");
        return;
      }

      localStreamRef.current = stream;
      joinedVoiceRef.current = true;

      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });

      setMicStatus("granted");
      setVoiceActive(true);

      socket.emit("voice:join");
    } catch (error) {
      console.error(
        "[SpatialAudio] Microphone error:",
        error
      );

      setMicStatus(
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
          ? "denied"
          : "error"
      );
    }
  }, []);

  // Leave voice room
  const leaveVoice = useCallback(() => {
    const socket = socketRef.current;

    // Notify backend
    if (joinedVoiceRef.current && socket?.connected) {
      socket.emit("voice:leave");
    }

    // Mark user as no longer in voice
    joinedVoiceRef.current = false;

    // Close all WebRTC connections
    destroyAllPeers();

    // Stop microphone tracks
    stopLocalStream();

    // Reset mute state
    mutedRef.current = false;
    setMuted(false);

    // Reset microphone status
    setMicStatus("idle");

    console.log("[SpatialAudio] Left voice room.");
  }, [destroyAllPeers, stopLocalStream]);

  // Mute and unmute microphone
  const toggleMute = useCallback(() => {
    if (!joinedVoiceRef.current) {
      return;
    }

    setMuted((previous) => {
      const next = !previous;

      mutedRef.current = next;

      if (localStreamRef.current) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((track) => {
            track.enabled = !next;
          });
      }

      return next;
    });
  }, []);

  // Update volume according to proximity
  const updateProximityVolume = useCallback((myPos, players) => {
    const ctx = audioCtxRef.current;

    if (!ctx) {
      return;
    }

    for (const [remoteUserId, peer] of peersRef.current) {
      if (!peer.gainNode) {
        continue;
      }

      const remote = players.find(
        (player) => player.id === remoteUserId
      );

      const gain = remote
        ? calcGain(calcDistance(myPos, remote))
        : 0;

      peer.gainNode.gain.setTargetAtTime(
        gain,
        ctx.currentTime,
        0.05
      );
    }
  }, []);

  // WebRTC signaling handlers
  useEffect(() => {
    const onVoiceUserJoined = ({ userId: remoteUserId }) => {
      if (
        remoteUserId === userIdRef.current ||
        !joinedVoiceRef.current
      ) {
        return;
      }

      createPeer(remoteUserId);
    };

    const onOffer = async ({ fromUserId, sdp }) => {
      const socket = socketRef.current;

      if (
        !socket ||
        !joinedVoiceRef.current ||
        fromUserId === userIdRef.current
      ) {
        return;
      }

      const peer = createPeer(fromUserId);
      const { pc } = peer;

      const offerCollision =
        peer.makingOffer ||
        pc.signalingState !== "stable";

      const isPolite =
        (userIdRef.current ?? "") < (fromUserId ?? "");

      peer.ignoreOffer = !isPolite && offerCollision;

      if (peer.ignoreOffer) {
        return;
      }

      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription(sdp)
        );

        await pc.setLocalDescription();

        socket.emit("voice:answer", {
          targetUserId: fromUserId,
          sdp: pc.localDescription,
        });
      } catch (error) {
        console.error(
          "[SpatialAudio] Offer error:",
          error
        );
      }
    };

    const onAnswer = async ({ fromUserId, sdp }) => {
      if (
        !joinedVoiceRef.current ||
        fromUserId === userIdRef.current
      ) {
        return;
      }

      const peer = peersRef.current.get(fromUserId);

      if (!peer || peer.pc.signalingState === "stable") {
        return;
      }

      try {
        await peer.pc.setRemoteDescription(
          new RTCSessionDescription(sdp)
        );
      } catch (error) {
        console.error(
          "[SpatialAudio] Answer error:",
          error
        );
      }
    };

    const onIceCandidate = async ({ fromUserId, candidate }) => {
      if (
        !joinedVoiceRef.current ||
        fromUserId === userIdRef.current
      ) {
        return;
      }

      const peer = peersRef.current.get(fromUserId);

      if (!peer || !candidate || peer.ignoreOffer) {
        return;
      }

      try {
        await peer.pc.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        if (!peer.ignoreOffer) {
          console.error(
            "[SpatialAudio] ICE candidate error:",
            error
          );
        }
      }
    };

    const onVoiceUserLeft = ({ userId: remoteUserId }) => {
      destroyPeer(remoteUserId);
    };

    const onVoicePeers = ({ peers }) => {
      if (!Array.isArray(peers)) {
        return;
      }

      peers.forEach((id) => {
        if (id !== userIdRef.current) {
          createPeer(id);
        }
      });
    };

    const onDisconnect = () => {
      joinedVoiceRef.current = false;

      destroyAllPeers();
      stopLocalStream();

      mutedRef.current = false;
      setMuted(false);
      setMicStatus("idle");
    };

    function attach() {
      const socket = socketRef.current;

      if (!socket) {
        return;
      }

      socket.on("voice:user-joined", onVoiceUserJoined);
      socket.on("voice:offer", onOffer);
      socket.on("voice:answer", onAnswer);
      socket.on("voice:ice-candidate", onIceCandidate);
      socket.on("voice:user-left", onVoiceUserLeft);
      socket.on("voice:peers", onVoicePeers);
      socket.on("disconnect", onDisconnect);
    }

    function detach() {
      const socket = socketRef.current;

      if (!socket) {
        return;
      }

      socket.off("voice:user-joined", onVoiceUserJoined);
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice-candidate", onIceCandidate);
      socket.off("voice:user-left", onVoiceUserLeft);
      socket.off("voice:peers", onVoicePeers);
      socket.off("disconnect", onDisconnect);
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

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (
        joinedVoiceRef.current &&
        socketRef.current?.connected
      ) {
        socketRef.current.emit("voice:leave");
      }

      joinedVoiceRef.current = false;

      destroyAllPeers();
      stopLocalStream();

      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [destroyAllPeers, stopLocalStream]);

  return {
    micStatus,
    muted,
    voiceActive,
    connectedPeers,
    joinVoice,
    leaveVoice,
    toggleMute,
    updateProximityVolume,
    destroyAllPeers,
  };
}
