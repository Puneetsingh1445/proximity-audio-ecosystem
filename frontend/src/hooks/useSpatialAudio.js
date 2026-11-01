/**
 * useSpatialAudio — WebRTC proximity voice for ProxiSpeak
 *
 * Manages:
 *  - Microphone permission + local audio stream
 *  - WebRTC RTCPeerConnection per remote peer
 *  - Socket.IO signaling (voice:join / offer / answer / ice-candidate / leave)
 *  - Proximity-based volume via Web Audio GainNode
 *  - Mute / unmute of local track
 *  - Full cleanup on unmount or user disconnect
 *
 * Audio range (configurable via AUDIO_CONFIG):
 *   0 – INNER_RADIUS  px  → full volume (gain = 1)
 *   INNER_RADIUS – MAX_RADIUS px  → quadratic fade
 *   > MAX_RADIUS px         → muted / no connection
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Audio-range constants ────────────────────────────────────────────────────
export const AUDIO_CONFIG = {
  INNER_RADIUS: 100,   // full volume below this distance
  MAX_RADIUS:   250,   // completely silent at and beyond this distance
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcDistance(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Gain 0–1 based on distance.
 * 1 inside INNER_RADIUS, smooth quadratic fade until MAX_RADIUS, 0 beyond.
 */
function calcGain(distance) {
  const { INNER_RADIUS, MAX_RADIUS } = AUDIO_CONFIG;
  if (!Number.isFinite(distance) || distance >= MAX_RADIUS) return 0;
  if (distance <= INNER_RADIUS) return 1;
  const t = (distance - INNER_RADIUS) / (MAX_RADIUS - INNER_RADIUS);
  return (1 - t) ** 2;
}

// ICE servers — STUN only for same-LAN/localhost testing.
// Replace with TURN credentials for cross-network deployments.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {{ current: import("socket.io-client").Socket|null }} opts.socketRef  — React ref holding the shared Socket.IO socket
 * @param {string|null} opts.userId       — authenticated user's own ID
 * @param {{ x: number, y: number }} opts.position  — local player position (live ref OK)
 * @param {Array<{ id: string, x: number, y: number }>} opts.remotePlayers  — remote player list
 * @param {boolean} opts.enabled          — false when not in office / unauthenticated
 */
export default function useSpatialAudio({
  socketRef,
  userId,
  position,
  remotePlayers,
  enabled = true,
}) {
  // ── Mic state ──
  const [micStatus, setMicStatus] = useState("idle"); // idle | requesting | granted | denied | error
  const [muted, setMuted]         = useState(false);
  const [voiceActive, setVoiceActive] = useState(false); // true once we have a local stream

  // ── Per-peer state (for UI) ──
  const [connectedPeers, setConnectedPeers] = useState([]); // array of userId strings

  // ── Refs that must survive re-renders without triggering them ──
  const localStreamRef  = useRef(null);   // MediaStream from getUserMedia
  const audioCtxRef     = useRef(null);   // Web Audio context for gain control
  const peersRef        = useRef(new Map()); // userId => PeerState
  // socketRef is passed in directly as a prop — always has the live socket
  const positionRef     = useRef(position);
  const remotePlayersRef = useRef(remotePlayers);
  const mutedRef        = useRef(false);
  const enabledRef      = useRef(enabled);
  const joinedVoiceRef  = useRef(false);
  const userIdRef       = useRef(userId);

  // keep refs in sync
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { remotePlayersRef.current = remotePlayers; }, [remotePlayers]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ── Audio context (lazy, shared) ──────────────────────────────────────────
  function getAudioCtx() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }

  // ── Create & store a peer connection ─────────────────────────────────────
  const createPeer = useCallback((remoteUserId) => {
    const existing = peersRef.current.get(remoteUserId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peer = {
      pc,
      gainNode:   null,
      sourceNode: null,
      audioEl:    null,
      makingOffer:  false,
      ignoreOffer:  false,
    };

    peersRef.current.set(remoteUserId, peer);

    // Add local tracks if we have a stream
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // ICE candidate — forward to signaling server
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current?.connected) {
        socketRef.current.emit("voice:ice-candidate", {
          targetUserId: remoteUserId,
          candidate: candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
    };

    // Remote audio track arrived
    pc.ontrack = ({ streams }) => {
      const remoteStream = streams[0];
      if (!remoteStream) return;

      // HTMLAudioElement to play the stream
      let audioEl = peer.audioEl;
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.setAttribute("playsinline", "");
        peer.audioEl = audioEl;
      }
      audioEl.srcObject = remoteStream;

      // Wire into Web Audio for gain control
      const ctx = getAudioCtx();
      if (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        if (peer.sourceNode) {
          try { peer.sourceNode.disconnect(); } catch { /* ignore */ }
        }
        const sourceNode = ctx.createMediaStreamSource(remoteStream);
        const gainNode   = ctx.createGain();
        gainNode.gain.value = 0; // proximity loop will set this
        sourceNode.connect(gainNode);
        gainNode.connect(ctx.destination);
        peer.sourceNode = sourceNode;
        peer.gainNode   = gainNode;
        // Silence the element so we don't double-play
        audioEl.volume = 0;
      }

      setConnectedPeers((prev) =>
        prev.includes(remoteUserId) ? prev : [...prev, remoteUserId]
      );
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        socketRef.current?.emit("voice:offer", {
          targetUserId: remoteUserId,
          sdp: pc.localDescription,
        });
      } catch (err) {
        console.error("[SpatialAudio] negotiationneeded error:", err);
      } finally {
        peer.makingOffer = false;
      }
    };

    return peer;
  }, []);

  // ── Tear down a single peer connection ───────────────────────────────────
  const destroyPeer = useCallback((remoteUserId) => {
    const peer = peersRef.current.get(remoteUserId);
    if (!peer) return;

    try { peer.gainNode?.disconnect(); } catch { /* ignore */ }
    try { peer.sourceNode?.disconnect(); } catch { /* ignore */ }
    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }
    try { peer.pc.close(); } catch { /* ignore */ }

    peersRef.current.delete(remoteUserId);
    setConnectedPeers((prev) => prev.filter((id) => id !== remoteUserId));
  }, []);

  // ── Tear down all peers ───────────────────────────────────────────────────
  const destroyAllPeers = useCallback(() => {
    for (const id of [...peersRef.current.keys()]) {
      destroyPeer(id);
    }
  }, [destroyPeer]);

  // ── Stop local mic stream ─────────────────────────────────────────────────
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setVoiceActive(false);
  }, []);

  // ── Request microphone and join voice session ─────────────────────────────
  const joinVoice = useCallback(async () => {
    if (!enabledRef.current) return;
    if (joinedVoiceRef.current) return;
    if (!socketRef.current?.connected) return;

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

      localStreamRef.current = stream;
      joinedVoiceRef.current = true;

      // Apply current mute state immediately
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !mutedRef.current;
      });

      setMicStatus("granted");
      setVoiceActive(true);

      // Tell the server we're in voice
      socketRef.current?.emit("voice:join");
    } catch (err) {
      console.error("[SpatialAudio] getUserMedia failed:", err);
      setMicStatus(err.name === "NotAllowedError" ? "denied" : "error");
    }
  }, []);

  // ── Mute / unmute ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (localStreamRef.current) {
        localStreamRef.current
          .getAudioTracks()
          .forEach((t) => { t.enabled = !next; });
      }
      return next;
    });
  }, []);

  // ── Proximity volume update (call this from animation loop) ───────────────
  const updateProximityVolume = useCallback((myPos, players) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    for (const [remoteUserId, peer] of peersRef.current) {
      if (!peer.gainNode) continue;

      const remote = players.find((p) => p.id === remoteUserId);
      const gain = remote ? calcGain(calcDistance(myPos, remote)) : 0;

      const now = ctx.currentTime;
      peer.gainNode.gain.setTargetAtTime(gain, now, 0.05);
    }
  }, []);

  // ── Signaling event handlers + disconnect ─────────────────────────────────
  // All handlers read socketRef.current lazily at call time, so they work
  // whether the socket is already connected at effect-mount time or not.
  useEffect(() => {
    const onVoiceUserJoined = ({ userId: remoteUserId }) => {
      if (remoteUserId === userIdRef.current || !joinedVoiceRef.current) return;
      createPeer(remoteUserId);
    };

    const onOffer = async ({ fromUserId, sdp }) => {
      const sk = socketRef.current;
      if (!sk || !joinedVoiceRef.current || fromUserId === userIdRef.current) return;
      const peer = createPeer(fromUserId);
      const { pc } = peer;
      const offerCollision = peer.makingOffer || pc.signalingState !== "stable";
      const isPolite = (userIdRef.current ?? "") < (fromUserId ?? "");
      peer.ignoreOffer = !isPolite && offerCollision;
      if (peer.ignoreOffer) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await pc.setLocalDescription();
        sk.emit("voice:answer", { targetUserId: fromUserId, sdp: pc.localDescription });
      } catch (err) {
        console.error("[SpatialAudio] onOffer error:", err);
      }
    };

    const onAnswer = async ({ fromUserId, sdp }) => {
      if (!joinedVoiceRef.current || fromUserId === userIdRef.current) return;
      const peer = peersRef.current.get(fromUserId);
      if (!peer || peer.pc.signalingState === "stable") return;
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (err) {
        console.error("[SpatialAudio] onAnswer error:", err);
      }
    };

    const onIceCandidate = async ({ fromUserId, candidate }) => {
      if (!joinedVoiceRef.current || fromUserId === userIdRef.current) return;
      const peer = peersRef.current.get(fromUserId);
      if (!peer || !candidate || peer.ignoreOffer) return;
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        if (!peer.ignoreOffer) console.error("[SpatialAudio] onIceCandidate error:", err);
      }
    };

    const onVoiceUserLeft = ({ userId: remoteUserId }) => { destroyPeer(remoteUserId); };

    const onVoicePeers = ({ peers }) => {
      if (!Array.isArray(peers)) return;
      peers.forEach((id) => { if (id !== userIdRef.current) createPeer(id); });
    };

    const onDisconnect = () => {
      joinedVoiceRef.current = false;
      destroyAllPeers();
      setVoiceActive(false);
    };

    function attach() {
      const sk = socketRef.current;
      if (!sk) return;
      sk.on("voice:user-joined",   onVoiceUserJoined);
      sk.on("voice:offer",         onOffer);
      sk.on("voice:answer",        onAnswer);
      sk.on("voice:ice-candidate", onIceCandidate);
      sk.on("voice:user-left",     onVoiceUserLeft);
      sk.on("voice:peers",         onVoicePeers);
      sk.on("disconnect",          onDisconnect);
    }

    function detach() {
      const sk = socketRef.current;
      if (!sk) return;
      sk.off("voice:user-joined",   onVoiceUserJoined);
      sk.off("voice:offer",         onOffer);
      sk.off("voice:answer",        onAnswer);
      sk.off("voice:ice-candidate", onIceCandidate);
      sk.off("voice:user-left",     onVoiceUserLeft);
      sk.off("voice:peers",         onVoicePeers);
      sk.off("disconnect",          onDisconnect);
    }

    attach();
    return detach;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketRef, createPeer, destroyPeer, destroyAllPeers]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (joinedVoiceRef.current && socketRef.current?.connected) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  return {
    micStatus,             // "idle" | "requesting" | "granted" | "denied" | "error"
    muted,                 // boolean
    voiceActive,           // boolean
    connectedPeers,        // string[] — userIds with active WebRTC connections
    joinVoice,             // () => Promise<void>
    toggleMute,            // () => void
    updateProximityVolume, // (myPos, players) => void
    destroyAllPeers,       // for external cleanup
  };
}
