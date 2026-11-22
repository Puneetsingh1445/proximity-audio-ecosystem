// Pure spatial-audio math + a Web Audio test-tone engine.
// Units are world pixels, matching the project brief (100 px earshot radius).
export const PROXIMITY_RADIUS = 100;

export function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 1 when very close, falling smoothly to 0 at `radius`. */
export function computeGain(distance, radius = PROXIMITY_RADIUS, inner = 20) {
  if (!Number.isFinite(distance) || distance >= radius) return 0;
  if (distance <= inner) return 1;
  const t = (distance - inner) / (radius - inner);
  return (1 - t) ** 2;
}

/** -1 (hard left) .. +1 (hard right), based on horizontal offset. */
export function computePan(listener, source, radius = PROXIMITY_RADIUS) {
  const dx = source.x - listener.x;
  return Math.max(-1, Math.min(1, dx / radius));
}

const TONES = [261.63, 329.63, 392.0, 493.88, 587.33];

/**
 * Plays one test tone per peer, with volume and stereo pan driven by position.
 * This validates the audio math before WebRTC streams exist. Later, replace the
 * oscillator with createMediaStreamSource(remoteStream).
 */
export class SpatialToneEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voices = new Map();
    this.nextIndex = 0;
  }

  async start() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("This browser does not support the Web Audio API.");
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.2;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  createVoice() {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = TONES[this.nextIndex++ % TONES.length];
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    osc.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    osc.start();
    return { osc, gain, panner };
  }

  removeVoice(voice) {
    try { voice.osc.stop(); } catch { /* already stopped */ }
    voice.osc.disconnect();
    voice.gain.disconnect();
    voice.panner?.disconnect();
  }

  update(listener, sources) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const live = new Set();
    for (const source of sources) {
      live.add(source.id);
      let voice = this.voices.get(source.id);
      if (!voice) {
        voice = this.createVoice();
        this.voices.set(source.id, voice);
      }
      voice.gain.gain.setTargetAtTime(computeGain(distanceBetween(listener, source)), now, 0.05);
      if (voice.panner) voice.panner.pan.setTargetAtTime(computePan(listener, source), now, 0.05);
    }
    for (const [id, voice] of this.voices) {
      if (!live.has(id)) {
        this.removeVoice(voice);
        this.voices.delete(id);
      }
    }
  }

  stop() {
    for (const voice of this.voices.values()) this.removeVoice(voice);
    this.voices.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) ctx.close().catch(() => {});
  }
}