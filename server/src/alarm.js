import fs from 'node:fs';
import path from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';
import { DEFAULT_RING, RING_TONES } from '../public/js/chime.js';
import { brandAppDir } from './apps.js';
import { channels } from './bus.js';
import { CLOSED_STATUSES } from './store.js';

// The customer's alarm, as a live MP3 stream (like a radio station). A phone keeps playing
// audio with its screen locked or another app open, where it stops the page itself: so the
// ring comes inside the stream, not from the page. Silent while the order is prepared (digital
// silence, nothing to hear), then the brand's ring, again and again, until that phone's owner
// taps their screen (ack), the order is picked up, or RING_MAX_MS. A delivery order rings the
// same way when it leaves the branch (out_for_delivery), for at most OUT_RING_MAX_MS.
//
// MPEG-2 Layer III, 22050 Hz, mono. Silence frames are built by hand; ring frames come from
// LAME, made once per ring and kept. Every frame stands alone where the two meet (a fresh
// encode starts with no bit reservoir), so they can follow each other freely.
//
// How late the ring is heard depends on the bytes per second, not the sound: browsers read a
// stream in blocks of about 32 KB and play a block once it is whole. Measured in Chrome: 8 kbps
// of silence is over 30 s late, 32 kbps about 7 s, 64 kbps about 3 s. 32 kbps (4 KB/s, about
// 2.4 MB for 10 minutes of waiting) is the trade-off; the start is sent at 160 kbps so playback
// begins at once. When the ring starts, BURST_BYTES of it go out at once (its silent gaps as
// 160 kbps silence, so the burst adds little playing time): the block the browser is waiting
// to fill fills now, and the ring is heard about as soon as it starts instead of seconds later.
// While the page is on screen it rings itself at once (customer.js).

export const RATE = 22050;
const FRAME_SAMPLES = 576;
export const FRAME_MS = (FRAME_SAMPLES / RATE) * 1000;
const RING_KBPS = 48;
const LEAD_FRAMES = Math.round(Number(process.env.ALARM_LEAD_MS ?? 1500) / FRAME_MS); // sent at once so the player starts
// A stream opened ringing (the page heard "ready" and opens a fresh one, see lockscreen.js
// ringNow): the burst starts the player, so the ring needn't wait behind 1.5 s of silence.
const RING_LEAD_FRAMES = Math.round(Number(process.env.ALARM_RING_LEAD_MS ?? 200) / FRAME_MS);
const TICK_MS = 200;
export const RING_EVERY_MS = 2600;
const RING_MAX_MS = 5 * 60 * 1000;
const OUT_RING_MAX_MS = 60 * 1000;
const BURST_BYTES = Number(process.env.ALARM_BURST_KB ?? 48) * 1024;
// The statuses a phone rings for: ready (come and get it), out_for_delivery (it left the branch).
const RINGS = new Set(['ready', 'out_for_delivery']);
const CUSTOM_MAX_S = 6;
const MAX_PER_ORDER = 12;
const MAX_STREAMS = 3000;
// One address (a café's Wi-Fi holds many phones) and one branch get a share, never everything.
const MAX_PER_IP = Number(process.env.ALARM_MAX_PER_IP ?? 100);
const MAX_PER_BRANCH = Number(process.env.ALARM_MAX_PER_BRANCH ?? 600);
export const ALARM_SID_RE = /^[A-Za-z0-9_-]{8,40}$/;

const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** One silent frame: header, then side info and main data all zero (nothing to decode). */
export function silenceFrame(kbps = 8) {
  const frame = Buffer.alloc(Math.floor((72 * kbps * 1000) / RATE)); // 26 bytes at 8 kbps
  frame[0] = 0xff;
  frame[1] = 0xf3; // MPEG-2, Layer III, no CRC
  frame[2] = MPEG2_L3_KBPS.indexOf(kbps) << 4; // 22050 Hz, no padding
  frame[3] = 0xc4; // mono
  return frame;
}
const SILENCE = silenceFrame(Number(process.env.ALARM_SILENCE_KBPS ?? 32));
const LEAD_SILENCE = silenceFrame(Number(process.env.ALARM_LEAD_KBPS ?? 160));

/** The MP3 frames of an encoder's output (MPEG-2 Layer III at RATE), Xing/Info frames left out. */
export function splitFrames(buf) {
  const frames = [];
  let at = 0;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff || (buf[at + 1] & 0xfe) !== 0xf2) {
      at++;
      continue;
    }
    const kbps = MPEG2_L3_KBPS[buf[at + 2] >> 4];
    if (!kbps) {
      at++;
      continue;
    }
    const len = Math.floor((72 * kbps * 1000) / RATE) + ((buf[at + 2] >> 1) & 1);
    const frame = buf.subarray(at, at + len);
    if (frame.length < len) break;
    const tag = frame.subarray(4, 40).toString('latin1');
    if (!tag.includes('Xing') && !tag.includes('Info')) frames.push(Buffer.from(frame));
    at += len;
  }
  return frames;
}

export function encodeMp3(pcm) {
  const encoder = new Mp3Encoder(1, RATE, RING_KBPS);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152 * 8) parts.push(Buffer.from(encoder.encodeBuffer(pcm.subarray(i, i + 1152 * 8))));
  parts.push(Buffer.from(encoder.flush()));
  return splitFrames(Buffer.concat(parts));
}

const WAVES = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  triangle: (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25)),
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
};

/** A library tone as samples, shaped as the page plays it (chime.js playTone). */
export function tonePcm(tone) {
  const peak = tone.gain ?? 0.45;
  const end = Math.max(...tone.notes.map(([, at]) => at)) + tone.dur + 0.05;
  const out = new Float32Array(Math.ceil(end * RATE));
  const wave = WAVES[tone.wave] ?? WAVES.sine;
  for (const [freq, at] of tone.notes) {
    const from = Math.floor(at * RATE);
    const n = Math.floor((tone.dur + 0.05) * RATE);
    for (let i = 0; i < n && from + i < out.length; i++) {
      const t = i / RATE;
      let g;
      if (t < 0.02) g = 0.0001 * (peak / 0.0001) ** (t / 0.02);
      else if (t < tone.dur) g = peak * (0.0001 / peak) ** ((t - 0.02) / (tone.dur - 0.02));
      else g = 0;
      out[from + i] += g * wave((freq * t) % 1);
    }
  }
  return toInt16(out);
}

function toInt16(floats) {
  const pcm = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, floats[i])) * 32000);
  return pcm;
}

/** PCM 16-bit WAV (any rate, mono or stereo) as mono samples at RATE, at most CUSTOM_MAX_S. */
export function wavPcm(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      if (fmt.format !== 1 || fmt.bits !== 16 || !fmt.channels || !fmt.rate) return null;
      const frames = Math.floor(Math.min(size, buf.length - body) / (2 * fmt.channels));
      const outLen = Math.min(Math.floor((frames * RATE) / fmt.rate), CUSTOM_MAX_S * RATE);
      const floats = new Float32Array(outLen);
      const sample = (f) => {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += buf.readInt16LE(body + (f * fmt.channels + c) * 2);
        return sum / fmt.channels / 32768;
      };
      for (let i = 0; i < outLen; i++) {
        const pos = (i * fmt.rate) / RATE;
        const f = Math.floor(pos);
        const next = Math.min(f + 1, frames - 1);
        floats[i] = sample(f) + (sample(next) - sample(f)) * (pos - f);
      }
      // A short fade at the end: no click where the sound is cut.
      const fade = Math.min(outLen, Math.round(0.03 * RATE));
      for (let i = 0; i < fade; i++) floats[outLen - 1 - i] *= i / fade;
      return toInt16(floats);
    }
    at = body + size + (size & 1);
  }
  return null;
}

export function createAlarms({ config, control, bus, log }) {
  const ringCache = new Map(); // key -> frames
  const streams = new Set();

  function framesFor(key, make) {
    let frames = ringCache.get(key);
    if (!frames) {
      frames = encodeMp3(make());
      if (ringCache.size > 200) ringCache.clear();
      ringCache.set(key, frames);
    }
    return frames;
  }

  /** The brand's ring as MP3 frames: its own sound (a WAV) or the tone it chose. */
  function ringFrames(brandId) {
    const ring = control.brandRing(brandId);
    const tone = RING_TONES.find((t) => t.id === ring?.tone) ?? RING_TONES.find((t) => t.id === DEFAULT_RING);
    if (ring?.file?.endsWith('.wav')) {
      try {
        const file = path.join(brandAppDir(config, brandId), ring.file);
        const key = `file:${brandId}:${ring.file}`;
        const frames = ringCache.get(key) ?? (() => {
          const pcm = wavPcm(fs.readFileSync(file));
          return pcm?.length ? framesFor(key, () => pcm) : null;
        })();
        if (frames) return frames;
      } catch (err) {
        log.warn({ err, brandId }, 'brand ring file unreadable; the tone rings');
      }
    }
    return framesFor(`tone:${tone.id}`, () => tonePcm(tone));
  }

  function startRing(s, status = s.status) {
    pump(s);
    s.ringing = true;
    s.ringUntil = Date.now() + (status === 'out_for_delivery' ? OUT_RING_MAX_MS : RING_MAX_MS);
    s.queue = [];
    burst(s);
  }

  /** The ring's first seconds at once, BURST_BYTES of them: see the top of this file. */
  function burst(s) {
    if (s.res.writableNeedDrain || s.res.writableEnded) return;
    const chunk = [];
    let bytes = 0;
    while (bytes < BURST_BYTES && s.ringing) {
      const frame = nextFrame(s);
      const out = frame === SILENCE ? LEAD_SILENCE : frame;
      chunk.push(out);
      bytes += out.length;
      s.sent++;
    }
    if (chunk.length) s.res.write(Buffer.concat(chunk));
  }

  function stopRing(s) {
    s.ringing = false;
    s.queue = [];
  }

  function nextFrame(s) {
    if (!s.queue.length && s.ringing) {
      if (Date.now() > s.ringUntil) {
        stopRing(s);
      } else {
        const frames = ringFrames(s.brandId);
        const gap = Math.max(Math.round(RING_EVERY_MS / FRAME_MS) - frames.length, Math.round(700 / FRAME_MS));
        s.queue = [...frames, ...Array(gap).fill(SILENCE)];
      }
    }
    return s.queue.length ? s.queue.shift() : SILENCE;
  }

  function pump(s, now = Date.now()) {
    const target = Math.floor((now - s.start) / FRAME_MS) + s.lead;
    if (s.res.writableNeedDrain) {
      // A slow network: silence is skipped rather than piled up, so the ring stays on time.
      s.sent = target;
      return;
    }
    const chunk = [];
    while (s.sent < target) {
      chunk.push(s.sent < s.lead ? LEAD_SILENCE : nextFrame(s));
      s.sent++;
    }
    if (chunk.length) s.res.write(Buffer.concat(chunk));
  }

  const ticker = setInterval(() => {
    for (const s of streams) pump(s);
  }, TICK_MS);
  ticker.unref?.();

  function close(s) {
    if (!streams.delete(s)) return;
    bus.off(s.channel, s.listener);
    if (!s.res.writableEnded) s.res.end();
  }

  return {
    get count() {
      return streams.size;
    },

    /** Starts a phone's stream on the hijacked reply. ring: the order rings (ready, or a delivery that left) and isn't acked there. */
    open({ req, reply, branchId, brandId, order, sid, ring, ip = null }) {
      const all = [...streams];
      const mine = all.filter((s) => s.orderId === order.id);
      if (mine.length >= MAX_PER_ORDER || streams.size >= MAX_STREAMS) return false;
      const reconnect = mine.some((s) => s.sid === sid);
      if (!reconnect && ip && all.filter((s) => s.ip === ip).length >= MAX_PER_IP) return false;
      if (!reconnect && all.filter((s) => s.branchId === branchId).length >= MAX_PER_BRANCH) return false;
      // The same phone reconnecting: its old stream goes.
      for (const s of mine) if (s.sid === sid) close(s);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'accept-ranges': 'none',
      });
      const s = {
        ip,
        sid, res, branchId, brandId, orderId: order.id, status: order.status,
        start: Date.now(), sent: 0, queue: [], ringing: false, ringUntil: 0,
        lead: ring && RINGS.has(order.status) ? RING_LEAD_FRAMES : LEAD_FRAMES,
        channel: channels(branchId).order(order.id),
      };
      s.listener = (event, data) => {
        if (event === 'renotify') {
          startRing(s);
        } else if (event === 'order') {
          if (CLOSED_STATUSES.includes(data.status)) {
            stopRing(s);
            close(s);
            return;
          }
          if (RINGS.has(data.status) && s.status !== data.status) startRing(s, data.status);
          if (!RINGS.has(data.status)) stopRing(s);
          s.status = data.status;
        }
      };
      bus.on(s.channel, s.listener);
      req.raw.on('close', () => close(s));
      streams.add(s);
      pump(s);
      if (ring && RINGS.has(order.status)) startRing(s);
      return true;
    },

    /** That phone's owner tapped their screen: its ring stops (the others go on). */
    ack(orderId, sid) {
      let found = false;
      for (const s of streams) {
        if (s.orderId === orderId && s.sid === sid) {
          stopRing(s);
          found = true;
        }
      }
      return found;
    },

    /** Builds the rings ahead of time, so the first ready isn't late. */
    warm(brandId) {
      try {
        ringFrames(brandId);
      } catch (err) {
        log.warn({ err, brandId }, 'ring encode failed');
      }
    },

    stop() {
      clearInterval(ticker);
      for (const s of [...streams]) close(s);
    },
  };
}
