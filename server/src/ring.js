import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RING, RING_TONES } from '../public/js/chime.js';
import { brandAppDir } from './apps.js';

// The customers' ring, the brand owner's choice: a tone of the library (public/js/chime.js) or
// the brand's own sound file, kept next to its app icon and served at /media/brand/<brand>/.

export const RING_IDS = new Set(RING_TONES.map((t) => t.id));
export const RING_FILE_MAX_BYTES = 600 * 1024;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm'];
export const RING_FILE_RE = /^ring-\d+\.(mp3|wav|ogg|m4a|webm)$/;
export const AUDIO_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' };

/** The file's format from its first bytes (never from its name or type), or null. */
export function sniffAudio(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const ascii = (from, to) => buf.subarray(from, to).toString('latin1');
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

/** What the customer page gets: the tone, and the brand's own sound when it has one. */
export function ringView(brandId, ring) {
  const tone = RING_IDS.has(ring?.tone) ? ring.tone : DEFAULT_RING;
  return { tone, url: ring?.file ? `/media/brand/${brandId}/${ring.file}` : null };
}

/** Removes the brand's ring files except `keep`. */
export async function clearRingFiles(config, brandId, keep = null) {
  const dir = brandAppDir(config, brandId);
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (RING_FILE_RE.test(name) && name !== keep) await fs.promises.rm(path.join(dir, name), { force: true });
  }
}
