// Android: once the phone is locked, Chrome freezes a page that isn't playing sound, so the
// page can't ring when the order gets ready. While the customer waits, an inaudible track
// plays: Chrome then keeps the page running (the ring sounds as with the page open) and shows
// the order on the lock screen as a media card, updated as it moves.
//
// Started by a tap («فعّل التنبيه»); stopped when the order closes.

const TRACK_S = 10; // Chrome only shows the lock-screen card for media of 5 s or more.
const RATE = 8000;
// About -63 dBFS: nobody hears it, but Chrome counts the page as playing sound, so it
// isn't frozen or throttled.
const NOISE = 40;

let audio = null;
let trackUrl = null;

function noiseTrack() {
  const samples = TRACK_S * RATE;
  const buf = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buf);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  let seed = 7;
  for (let i = 0; i < samples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    view.setInt16(44 + i * 2, (seed % (2 * NOISE + 1)) - NOISE, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export const lockScreenSupported = () =>
  typeof Audio !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function';

/** Starts holding the page awake. Call inside a tap; harmless to call again. */
export function holdOnLockScreen() {
  if (!lockScreenSupported()) return false;
  if (!audio) {
    trackUrl = URL.createObjectURL(noiseTrack());
    audio = new Audio(trackUrl);
    audio.loop = true;
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
  }
  audio.play().catch(() => {
    /* no tap behind it (autoplay blocked): the push notification still rings */
  });
  return true;
}

/** What the lock-screen card says: the order and where it is. */
export function showOnLockScreen({ title, text, shopName, artwork }) {
  if (!audio || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: text,
    album: shopName,
    artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : [],
  });
}

export function releaseLockScreen() {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  audio = null;
  URL.revokeObjectURL(trackUrl);
  trackUrl = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}
