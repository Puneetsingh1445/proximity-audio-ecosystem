import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, RotateCcw, Volume2, VolumeX } from "lucide-react";
import useOfficeSocket from "../hooks/useOfficeSocket.js";
import { PROXIMITY_RADIUS, SpatialToneEngine, distanceBetween } from "../lib/spatialAudio.js";
import "./OfficeCanvas.css";

const WORLD = { width: 1200, height: 650 };
const PLAYER_RADIUS = 15;
const SPEED = 230; // world pixels per second
const INITIAL_POSITION = { x: 160, y: 320 };
const FURNITURE = [
  { x: 100, y: 100, w: 160, h: 66, type: "desk", label: "DESIGN" },
  { x: 100, y: 185, w: 160, h: 66, type: "desk", label: "DESIGN" },
  { x: 400, y: 95, w: 170, h: 70, type: "desk", label: "ENGINEERING" },
  { x: 400, y: 185, w: 170, h: 70, type: "desk", label: "ENGINEERING" },
  { x: 820, y: 105, w: 150, h: 66, type: "desk", label: "PRODUCT" },
  { x: 820, y: 190, w: 150, h: 66, type: "desk", label: "PRODUCT" },
  { x: 520, y: 430, w: 180, h: 92, type: "meeting", label: "HUDDLE ROOM" },
  { x: 930, y: 420, w: 120, h: 88, type: "lounge", label: "LOUNGE" },
];
const OBSTACLES = FURNITURE.map(({ x, y, w, h }) => ({ x, y, w, h }));
const DEMO_PLAYERS = [
  { id: "demo-priya", name: "Priya", x: 330, y: 300, color: "#E9A0C4" },
  { id: "demo-aarav", name: "Aarav", x: 665, y: 315, color: "#8FB8F8" },
  { id: "demo-rohan", name: "Rohan", x: 1030, y: 320, color: "#F1B46E" },
];
const DPAD = [
  ["Move up", "ArrowUp", ArrowUp],
  ["Move left", "ArrowLeft", ArrowLeft],
  ["Move down", "ArrowDown", ArrowDown],
  ["Move right", "ArrowRight", ArrowRight],
];
const MOVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"];

// Stable per-tab identity (the server should still assign identity from the socket).
function getClientId() {
  try {
    const saved = sessionStorage.getItem("proxispeak:userId");
    if (saved) return saved;
    const id = globalThis.crypto?.randomUUID?.() ?? `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("proxispeak:userId", id);
    return id;
  } catch {
    return `u-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function circleHitsRect(x, y, radius, rect) {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 < radius ** 2;
}

function drawDesk(ctx, item) {
  ctx.save();
  ctx.fillStyle = item.type === "meeting" ? "#E7E2D8" : item.type === "lounge" ? "#DCECE5" : "#E8E2D7";
  ctx.strokeStyle = "#CFC8BB";
  ctx.lineWidth = 2;
  const radius = item.type === "desk" ? 10 : 18;
  ctx.beginPath();
  ctx.roundRect(item.x, item.y, item.w, item.h, radius);
  ctx.fill(); ctx.stroke();
  if (item.type === "desk") {
    ctx.fillStyle = "#B8C8D9";
    ctx.beginPath(); ctx.roundRect(item.x + item.w / 2 - 22, item.y + 10, 44, 25, 5); ctx.fill();
    ctx.fillStyle = "#879EB4";
    ctx.fillRect(item.x + item.w / 2 - 17, item.y + 15, 34, 15);
    ctx.fillStyle = "#C9B8A1";
    ctx.fillRect(item.x + 18, item.y + item.h - 10, item.w - 36, 4);
  } else if (item.type === "meeting") {
    ctx.fillStyle = "#C7BBA8";
    ctx.beginPath(); ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, item.w * 0.32, item.h * 0.27, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = "#8FC6A7";
    ctx.beginPath(); ctx.roundRect(item.x + 18, item.y + 16, item.w - 36, item.h - 32, 12); ctx.fill();
  }
  ctx.fillStyle = "#89918C";
  ctx.font = "600 10px DM Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(item.label, item.x + item.w / 2, item.y + item.h + 17);
  ctx.restore();
}

function drawAvatar(ctx, player, { isSelf = false, inRange = false } = {}) {
  ctx.save();
  ctx.shadowColor = "#26354A22";
  ctx.shadowBlur = 12;
  ctx.fillStyle = player.color || (isSelf ? "#4F70E8" : "#8B7CF6");
  ctx.beginPath(); ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath(); ctx.arc(player.x, player.y - 3, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(player.x - 7, player.y + 2, 14, 8, 4); ctx.fill();
  if (isSelf) {
    ctx.strokeStyle = "#4F70E8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(player.x, player.y, PLAYER_RADIUS + 5, 0, Math.PI * 2); ctx.stroke();
  } else if (inRange) {
    ctx.strokeStyle = "#31A56C"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(player.x, player.y, PLAYER_RADIUS + 5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.font = "600 12px DM Sans, sans-serif";
  const label = player.name || "";
  if (label) {
    const width = ctx.measureText(label).width + 18;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath(); ctx.roundRect(player.x - width / 2, player.y + 23, width, 23, 7); ctx.fill();
    ctx.strokeStyle = "#E5EAF1"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#273248"; ctx.textAlign = "center"; ctx.fillText(label, player.x, player.y + 38);
  }
  ctx.restore();
}

export default function OfficeCanvas({ displayName = "Sam" }) {
  const canvasRef = useRef(null);
  const worldRef = useRef({ ...INITIAL_POSITION });
  const keysRef = useRef(new Set());
  const playersRef = useRef([]);
  const renderedRef = useRef(new Map());
  const displayNameRef = useRef(displayName);
  const showLabelsRef = useRef(true);
  const engineRef = useRef(null);
  const [position, setPosition] = useState(INITIAL_POSITION);
  const [showLabels, setShowLabels] = useState(true);
  const [nearby, setNearby] = useState([]);
  const [audioTest, setAudioTest] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [userId] = useState(getClientId);
  const getPosition = useCallback(() => worldRef.current, []);
  const { remotePlayers, connectionStatus, publishPosition } = useOfficeSocket({ userId, displayName, getPosition });
  const players = connectionStatus === "demo" ? DEMO_PLAYERS : remotePlayers;

  // Keep the render loop independent of React state so it never restarts.
  useEffect(() => {
    playersRef.current = players;
    displayNameRef.current = displayName;
    showLabelsRef.current = showLabels;
  }, [players, displayName, showLabels]);

  const resetPosition = useCallback(() => {
    worldRef.current = { ...INITIAL_POSITION };
    setPosition({ ...INITIAL_POSITION });
    publishPosition(INITIAL_POSITION);
  }, [publishPosition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let animationFrame = 0;
    let previousTime = 0;
    let lastHudUpdate = 0;
    let lastPublish = 0;
    let lastNearby = 0;
    let lastAudio = 0;
    let nearbyKey = "";
    let hudPending = false;
    let publishPending = false;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      // Uniform scale: circles stay circles whatever the box shape.
      const scale = Math.min(canvas.width / WORLD.width, canvas.height / WORLD.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);

    const frame = (time) => {
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.04) : 0;
      previousTime = time;
      let dx = 0; let dy = 0;
      const keys = keysRef.current;
      if (keys.has("ArrowLeft") || keys.has("a")) dx -= 1;
      if (keys.has("ArrowRight") || keys.has("d")) dx += 1;
      if (keys.has("ArrowUp") || keys.has("w")) dy -= 1;
      if (keys.has("ArrowDown") || keys.has("s")) dy += 1;
      if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      const pressing = dx !== 0 || dy !== 0;
      const current = worldRef.current;

      if (pressing) {
        const beforeX = current.x; const beforeY = current.y;
        const nextX = Math.max(PLAYER_RADIUS + 10, Math.min(WORLD.width - PLAYER_RADIUS - 10, current.x + dx * SPEED * delta));
        const nextY = Math.max(PLAYER_RADIUS + 10, Math.min(WORLD.height - PLAYER_RADIUS - 10, current.y + dy * SPEED * delta));
        if (!OBSTACLES.some((rect) => circleHitsRect(nextX, current.y, PLAYER_RADIUS, rect))) current.x = nextX;
        if (!OBSTACLES.some((rect) => circleHitsRect(current.x, nextY, PLAYER_RADIUS, rect))) current.y = nextY;
        if (current.x !== beforeX || current.y !== beforeY) { hudPending = true; publishPending = true; }
      }
      // Throttle while moving, but always flush the final position once movement stops.
      if (hudPending && (!pressing || time - lastHudUpdate > 90)) {
        setPosition({ x: Math.round(current.x), y: Math.round(current.y) });
        lastHudUpdate = time; hudPending = false;
      }
      if (publishPending && (!pressing || time - lastPublish > 80)) {
        publishPosition(current);
        lastPublish = time; publishPending = false;
      }

      // Smooth remote players toward their latest reported position.
      const rendered = renderedRef.current;
      const seen = new Set();
      const k = 1 - Math.exp(-delta * 14);
      const drawn = playersRef.current.map((player) => {
        seen.add(player.id);
        let r = rendered.get(player.id);
        if (!r) { r = { x: player.x, y: player.y }; rendered.set(player.id, r); }
        else { r.x += (player.x - r.x) * k; r.y += (player.y - r.y) * k; }
        return { ...player, x: r.x, y: r.y };
      });
      for (const id of rendered.keys()) if (!seen.has(id)) rendered.delete(id);

      if (time - lastNearby > 100) {
        lastNearby = time;
        const near = drawn
          .map((p) => ({ id: p.id, name: p.name, distance: Math.round(distanceBetween(current, p)) }))
          .filter((p) => p.distance <= PROXIMITY_RADIUS)
          .sort((a, b) => a.distance - b.distance);
        const key = near.map((p) => `${p.id}:${p.distance}`).join("|");
        if (key !== nearbyKey) { nearbyKey = key; setNearby(near); }
      }
      if (engineRef.current && time - lastAudio > 50) {
        lastAudio = time;
        engineRef.current.update(current, drawn);
      }

      ctx.clearRect(0, 0, WORLD.width, WORLD.height);
      ctx.fillStyle = "#F4F3EE"; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.strokeStyle = "#E6E4DC"; ctx.lineWidth = 1;
      for (let x = 0; x <= WORLD.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
      for (let y = 0; y <= WORLD.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }
      ctx.fillStyle = "#E4EEE5"; ctx.beginPath(); ctx.roundRect(40, 385, 360, 210, 22); ctx.fill();
      ctx.fillStyle = "#C9DCCB"; ctx.font = "700 12px DM Sans, sans-serif"; ctx.textAlign = "left"; ctx.fillText("COLLABORATION ZONE", 60, 410);
      ctx.fillStyle = "#E7EAF4"; ctx.beginPath(); ctx.roundRect(760, 350, 390, 245, 22); ctx.fill();
      ctx.fillStyle = "#A2AEC7"; ctx.fillText("FOCUS & LOUNGE", 780, 375);
      [[335, 105], [740, 130], [1080, 300], [455, 555], [100, 555]].forEach(([x, y]) => {
        ctx.fillStyle = "#A9CBB0"; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6FAD85"; ctx.beginPath(); ctx.arc(x - 5, y - 4, 7, 0, Math.PI * 2); ctx.fill();
      });
      FURNITURE.forEach((item) => drawDesk(ctx, item));

      // Earshot radius around you.
      ctx.save();
      ctx.fillStyle = "#4F70E812"; ctx.strokeStyle = "#4F70E899"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(current.x, current.y, PROXIMITY_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();

      drawn.forEach((player) => {
        const inRange = distanceBetween(current, player) <= PROXIMITY_RADIUS;
        drawAvatar(ctx, showLabelsRef.current ? player : { ...player, name: "" }, { inRange });
      });
      drawAvatar(ctx, { ...current, name: displayNameRef.current || "You", color: "#4F70E8" }, { isSelf: true });
      animationFrame = window.requestAnimationFrame(frame);
    };
    animationFrame = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [publishPosition]);

  useEffect(() => {
    const down = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return; // keep browser shortcuts working
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!MOVE_KEYS.includes(key)) return;
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      event.preventDefault();
      keysRef.current.add(key);
    };
    const up = (event) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      keysRef.current.delete(key);
    };
    const clear = () => keysRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Stop test tones if the page is left while they are playing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { engineRef.current?.stop(); engineRef.current = null; }, []);

  async function toggleAudioTest() {
    if (audioTest) {
      engineRef.current?.stop();
      engineRef.current = null;
      setAudioTest(false);
      return;
    }
    try {
      const engine = new SpatialToneEngine();
      await engine.start(); // must run inside a click for browser autoplay rules
      engineRef.current = engine;
      setAudioError("");
      setAudioTest(true);
    } catch (error) {
      setAudioError(error?.message || "Could not start audio.");
    }
  }

  const statusText = {
    demo: "Demo mode · sample teammates",
    connecting: "Connecting to server…",
    connected: "Connected to office",
    disconnected: "Server disconnected · retrying",
  }[connectionStatus];

  return (
    <section className="office-page">
      <div className="office-heading">
        <div>
          <p className="eyebrow">REAL-TIME WORKSPACE</p>
          <h1>Virtual office</h1>
          <p className="muted">Move around the office to meet your teammates naturally.</p>
        </div>
        <span className={`office-connection office-${connectionStatus}`}><span />{statusText}</span>
      </div>
      <div className="office-toolbar">
        <div className="office-key-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>or arrow keys to move</span></div>
        <div className="office-toolbar-actions">
          <button className="office-tool-button" onClick={toggleAudioTest}>
            {audioTest ? <VolumeX size={15} /> : <Volume2 size={15} />} {audioTest ? "Stop audio test" : "Audio test"}
          </button>
          <button className="office-tool-button" onClick={() => setShowLabels((value) => !value)}><Maximize2 size={15} /> {showLabels ? "Hide labels" : "Show labels"}</button>
          <button className="office-tool-button" onClick={resetPosition}><RotateCcw size={15} /> Reset position</button>
        </div>
      </div>
      {audioError && <p className="office-footnote" role="alert">{audioError}</p>}
      <div className="office-map-frame">
        <canvas ref={canvasRef} className="office-canvas" aria-label="Virtual office map. Use WASD or arrow keys to move your avatar." />
        <div className="office-map-legend">
          <span><i className="legend-self" /> You</span>
          <span><i className="legend-peer" /> Teammate</span>
          <span><i className="legend-range" /> Earshot ({PROXIMITY_RADIUS}px)</span>
          <span><i className="legend-furniture" /> Furniture (blocked)</span>
        </div>
      </div>
      <div className="office-bottom-grid">
        <div className="office-info-card">
          <div className="office-info-icon"><ArrowRight size={18} /></div>
          <div><strong>Your position</strong><p>X: {position.x} · Y: {position.y}</p></div>
        </div>
        <div className="office-info-card">
          <div className="office-info-icon office-info-green"><span className="office-online-dot" /></div>
          <div>
            <strong>{players.length} {connectionStatus === "demo" ? "sample" : "remote"} teammates · {nearby.length} in earshot</strong>
            <p>{nearby.length ? nearby.map((p) => `${p.name} (${p.distance}px)`).join(", ") : `Walk within ${PROXIMITY_RADIUS}px of a teammate to enter earshot.`}</p>
          </div>
        </div>
        <div className="office-info-card office-controls-card">
          <strong>Movement controls</strong>
          <div className="office-dpad" aria-label="Touch movement controls">
            {DPAD.map(([label, key, Icon]) => {
              const press = (event) => { event.preventDefault(); keysRef.current.add(key); };
              const release = () => keysRef.current.delete(key);
              return (
                <button key={key} aria-label={label} onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}>
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="office-footnote">Frontend milestone: movement, collisions, earshot radius and a test-tone spatial audio check are implemented. The audio test plays local tones, not WebRTC voice. Live shared positions and voice need the backend and signaling to match the documented contract.</p>
    </section>
  );
}