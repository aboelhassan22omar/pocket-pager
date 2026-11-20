// The alarm stream (server: src/alarm.js), played by an <audio> element. Phones keep playing
// audio with the screen locked or another app open, where they stop the page itself, so the
// ring comes inside the stream: silent while the order is prepared, the brand's ring when it is
// ready. Started by a tap (the browser's rule); the lock screen shows the order as "now playing".
//
// A browser plays such a stream some seconds behind the server (it reads it in blocks), so a
// ring that comes inside it is heard late. When the page itself hears "ready" (Android keeps a
// page that plays audio running), ringNow() opens a fresh stream that starts with the ring:
// heard in about a second instead of six or seven.

// After a tap, the ring already on its way (the stream is some seconds behind) plays muted.
const ACK_MUTE_MS = 12000;
const RETRY_MS = 3000;

const newSid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

export class AlarmStream {
  constructor() {
    this.audio = null;
    this.base = null; // /api/b/<branch>/orders/<id>
    this.sid = newSid();
    this.wantRing = () => false;
    this.retryTimer = null;
    this.muteTimer = null;
  }

  get supported() {
    return typeof Audio !== 'undefined';
  }

  /** Playing: the ring will come from the stream, the page needn't chime. */
  get live() {
    const a = this.audio;
    return Boolean(a && !a.paused && !a.error && a.readyState >= 2);
  }

  #url(sid = this.sid) {
    return `${this.base}/alarm.mp3?s=${sid}&ring=${this.wantRing() ? 1 : 0}`;
  }

  /** An audio element for the stream, with its retry; the lock screen's pause keeps it going. */
  #makeAudio() {
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    const retry = () => {
      clearTimeout(this.retryTimer);
      // Only the element in use retries (one swapped out by ringNow stays quiet).
      if (a !== this.audio || !this.base || !a.getAttribute('src')) return;
      this.retryTimer = setTimeout(() => this.#reload(), RETRY_MS);
    };
    a.addEventListener('error', retry);
    a.addEventListener('ended', retry);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('pause', () => this.audio?.play().catch(() => {}));
        navigator.mediaSession.setActionHandler('stop', () => this.audio?.play().catch(() => {}));
      } catch {
        /* not supported here */
      }
    }
    return a;
  }

  /**
   * Follows this order (base = its API path). Call inside a tap; again is harmless.
   * wantRing(): whether the order is ready and not yet acked on this phone.
   */
  start(base, wantRing) {
    if (!this.supported) return;
    this.wantRing = wantRing;
    if (!this.audio) this.audio = this.#makeAudio();
    if (this.live && base === this.base) return;
    this.base = base;
    // Always from now: a stream loaded while paused would play late by as long as it waited.
    this.#reload();
  }

  #reload() {
    if (!this.audio || !this.base) return;
    const a = this.audio;
    a.src = this.#url();
    a.play().catch(() => {
      // No tap behind it yet: nothing loads until the next tap starts it.
      if (a.paused) {
        a.removeAttribute('src');
        a.load();
      }
    });
  }

  /**
   * The ring is due now and the page is off screen: a fresh stream, opened ringing, in a second
   * element. The old one stops only once the new one plays, so a browser that refuses keeps
   * the old stream, whose ring still comes, later.
   */
  ringNow() {
    if (!this.live || !this.base || !this.wantRing() || this.swapping) return;
    this.swapping = true;
    const sid = newSid();
    const fresh = this.#makeAudio();
    fresh.muted = this.audio.muted;
    fresh.src = this.#url(sid);
    fresh.play().then(() => {
      const old = this.audio;
      this.audio = fresh;
      this.sid = sid;
      old.pause();
      old.removeAttribute('src');
      old.load();
    }).catch(() => {
      fresh.removeAttribute('src');
      fresh.load();
    }).finally(() => {
      this.swapping = false;
    });
  }

  /** Back on screen: if playback fell behind the live stream (a slow network), start from now. */
  catchUp() {
    const a = this.audio;
    if (!this.live || !a.buffered.length) return;
    if (a.buffered.end(a.buffered.length - 1) - a.currentTime > 20) this.#reload();
  }

  /** This phone's owner tapped: the server stops its ring; what's buffered plays muted. */
  ack() {
    if (!this.audio || !this.base) return;
    this.audio.muted = true;
    clearTimeout(this.muteTimer);
    this.muteTimer = setTimeout(() => {
      if (this.audio) this.audio.muted = false;
    }, ACK_MUTE_MS);
    fetch(`${this.base}/alarm/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ s: this.sid }),
      keepalive: true,
    }).catch(() => {});
  }

  /** A new ring (the cashier rang again): heard even right after a tap. */
  unmute() {
    clearTimeout(this.muteTimer);
    if (this.audio) this.audio.muted = false;
  }

  /** While the page is on screen it rings itself at once; the stream's ring comes later. */
  setMuted(muted) {
    clearTimeout(this.muteTimer);
    if (this.audio) this.audio.muted = muted;
  }

  /** What the lock screen shows: the order and where it is. */
  show({ title, text, shopName, artwork }) {
    if (!this.audio || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: text,
      album: shopName,
      artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : [],
    });
  }

  stop() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.muteTimer);
    this.base = null;
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
}
