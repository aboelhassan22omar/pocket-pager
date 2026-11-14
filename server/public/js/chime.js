// WebAudio chimes. unlock() must run inside a user gesture (iOS).
//
// The customer's ring ("ready") is the brand's choice: one of RING_TONES (made here, no audio
// files), or its own sound file. The cashier's chimes ("order", "soft") never change.

/**
 * The ring library the brand owner picks from. Each tone: a wave, how long each note sounds,
 * and its notes as [frequency Hz, start s]. "classic" is the default and was the only ring.
 */
export const RING_TONES = [
  { id: 'classic', label: 'كلاسيك', wave: 'sine', dur: 0.7, notes: [[784, 0], [988, 0.16], [1319, 0.32]] },
  { id: 'bell', label: 'جرس', wave: 'triangle', dur: 1.2, notes: [[1047, 0], [1047, 0.45]] },
  { id: 'doorbell', label: 'جرس الباب', wave: 'sine', dur: 0.9, notes: [[659, 0], [523, 0.45]] },
  { id: 'pager', label: 'بيجر', wave: 'square', dur: 0.09, gain: 0.18, notes: [[2000, 0], [2000, 0.14], [2000, 0.28], [2000, 0.42]] },
  { id: 'marimba', label: 'ماريمبا', wave: 'triangle', dur: 0.35, notes: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]] },
  { id: 'rise', label: 'تصاعدي', wave: 'sine', dur: 0.4, notes: [[523, 0], [659, 0.1], [784, 0.2], [988, 0.3], [1175, 0.4]] },
  { id: 'harp', label: 'هارب', wave: 'triangle', dur: 0.6, notes: [[392, 0], [494, 0.07], [587, 0.14], [784, 0.21], [988, 0.28]] },
  { id: 'gentle', label: 'هادية', wave: 'sine', dur: 1.1, gain: 0.35, notes: [[587, 0], [880, 0.35]] },
  { id: 'alert', label: 'تنبيه', wave: 'square', dur: 0.14, gain: 0.16, notes: [[880, 0], [660, 0.16], [880, 0.32], [660, 0.48]] },
  { id: 'digital', label: 'ديجيتال', wave: 'square', dur: 0.07, gain: 0.16, notes: [[1568, 0], [1568, 0.1], [2093, 0.2]] },
  { id: 'coin', label: 'عملة', wave: 'square', dur: 0.22, gain: 0.16, notes: [[988, 0], [1319, 0.08]] },
];
export const DEFAULT_RING = 'classic';
// A brand's own sound plays at most this long each time it rings.
const CUSTOM_MAX_S = 6;

const STAFF_TONES = {
  order: { wave: 'sine', dur: 0.7, notes: [[659, 0], [880, 0.14]] },
  soft: { wave: 'sine', dur: 0.7, notes: [[740, 0]] },
};

const toneById = (id) => RING_TONES.find((t) => t.id === id) ?? RING_TONES[0];

export class Chime {
  constructor() {
    this.ctx = null;
    this.loopTimer = null;
    this.ring = toneById(DEFAULT_RING);
    this.customUrl = null;
    this.customBuffer = null;
    this.customSource = null;
  }

  get unlocked() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  /** The brand's ring: { tone } from the library, or { url } of its own sound. */
  useRing(ring) {
    this.ring = toneById(ring?.tone);
    const url = ring?.url ?? null;
    if (url !== this.customUrl) {
      this.customUrl = url;
      this.customBuffer = null;
      this.loadCustom();
    }
  }

  async loadCustom() {
    const url = this.customUrl;
    if (!url || !this.ctx || this.customBuffer) return;
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      if (url === this.customUrl) this.customBuffer = buffer;
    } catch {
      /* unreadable: the library tone plays instead */
    }
  }

  /** A sound file picked on this device (the owner hearing it before uploading). */
  async useFile(file) {
    if (!this.ctx) return;
    this.customUrl = null;
    try {
      this.customBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      this.customBuffer = null;
    }
  }

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    // Lets Safari play through the ringer switch where supported.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buffer = this.ctx.createBuffer(1, 1, 22050);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(0);
    this.loadCustom();
    return true;
  }

  /** A tone of the library (or a staff chime) now. */
  playTone(tone) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t0 = this.ctx.currentTime + 0.02;
    const peak = tone.gain ?? 0.45;
    for (const [freq, offset] of tone.notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + tone.dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + tone.dur + 0.05);
    }
  }

  // The brand's own sound; a ring still sounding isn't started again over itself.
  playCustom() {
    if (this.customSource) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = this.customBuffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      if (this.customSource === source) this.customSource = null;
    };
    this.customSource = source;
    source.start(0, 0, Math.min(this.customBuffer.duration, CUSTOM_MAX_S));
  }

  play(kind = 'ready') {
    if (!this.ctx) return;
    if (kind === 'ready') {
      if (this.customBuffer) this.playCustom();
      else this.playTone(this.ring);
      return;
    }
    this.playTone(STAFF_TONES[kind] ?? this.ring);
  }

  loop(kind, everyMs, onTick) {
    this.stop();
    const tick = () => {
      this.play(kind);
      onTick?.();
    };
    tick();
    this.loopTimer = setInterval(tick, everyMs);
  }

  stop() {
    clearInterval(this.loopTimer);
    this.loopTimer = null;
    try {
      this.customSource?.stop();
    } catch {
      /* already ended */
    }
    this.customSource = null;
  }
}
