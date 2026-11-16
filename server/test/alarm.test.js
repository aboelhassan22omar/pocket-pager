import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RING_TONES } from '../public/js/chime.js';
import { encodeMp3, RATE, silenceFrame, splitFrames, tonePcm, wavPcm } from '../src/alarm.js';
import { hashPin } from '../src/auth.js';
import { client, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';

const kbpsOf = (frame) => [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][frame[2] >> 4];

describe('alarm stream: frames', () => {
  test('a silent frame: MPEG-2 Layer III, 22050 Hz, mono, 8 kbps, nothing to decode', () => {
    const f = silenceFrame();
    assert.equal(f.length, 26);
    assert.deepEqual([...f.subarray(0, 4)], [0xff, 0xf3, 0x10, 0xc4]);
    assert.ok(f.subarray(4).every((b) => b === 0));
  });

  test('every library tone encodes to frames of the same format (MPEG-2 L3, 22050 Hz, mono)', () => {
    for (const tone of RING_TONES) {
      const frames = encodeMp3(tonePcm(tone));
      assert.ok(frames.length > 10, tone.id);
      for (const f of frames) {
        assert.equal(f[0], 0xff);
        assert.equal(f[1] & 0xfe, 0xf2, 'MPEG-2 Layer III');
        assert.equal((f[2] >> 2) & 3, 0, '22050 Hz');
        assert.equal(f[3] >> 6, 3, 'mono');
      }
      // The first frame of each ring uses no bit reservoir: it may follow any frame.
      assert.equal(frames[0][4], 0, `${tone.id}: main_data_begin 0`);
    }
  });

  test('splitFrames reads back what it is given, and a WAV becomes mono samples at 22050 Hz', () => {
    const frames = [silenceFrame(), silenceFrame()];
    assert.equal(splitFrames(Buffer.concat(frames)).length, 2);
    // 0.5 s stereo at 44100 Hz
    const n = 22050;
    const buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0, 'latin1');
    buf.writeUInt32LE(36 + n * 4, 4);
    buf.write('WAVEfmt ', 8, 'latin1');
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(44100, 24);
    buf.writeUInt32LE(44100 * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36, 'latin1');
    buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n * 2; i++) buf.writeInt16LE(10000, 44 + i * 2);
    const pcm = wavPcm(buf);
    assert.equal(pcm.length, Math.floor(RATE / 2));
    assert.ok(Math.abs(pcm[100] - 9766) < 50);
    assert.equal(wavPcm(Buffer.from('not a wav at all, no no no no no no no no no')), null);
  });
});

// Reads an alarm stream; .until(fn) waits for a frame passing fn.
function listen(url) {
  const ctl = new AbortController();
  const frames = [];
  let buffer = Buffer.alloc(0);
  let waiters = [];
  const done = (async () => {
    const res = await fetch(url, { signal: ctl.signal });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    for await (const chunk of res.body) {
      buffer = Buffer.concat([buffer, chunk]);
      const got = splitFrames(buffer);
      const used = got.reduce((n, f) => n + f.length, 0);
      buffer = buffer.subarray(used);
      for (const f of got) {
        frames.push(f);
        waiters = waiters.filter((w) => !w(f));
      }
    }
  })().catch(() => {});
  return {
    frames,
    done,
    until(fn, ms = 4000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), ms);
        waiters.push((f) => {
          if (!fn(f)) return false;
          clearTimeout(timer);
          resolve(f);
          return true;
        });
      });
    },
    close: () => ctl.abort(),
  };
}

describe('alarm stream: every phone on the order rings, each stops on its own tap', () => {
  let server;
  let bar;
  let k;

  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD), READY_REPEAT_SECONDS: '600' });
    const su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
    await su.post('/api/super/brands', { id: 'alrm', name: 'Alarm' });
    await su.post('/api/super/brands/alrm/branches', { id: 'alrm-a', name: 'Alarm', pin: '1234', qrMode: 'static' });
    bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'alrm-a', pin: '1234' });
    k = new URL((await bar.get('/api/bar/alrm-a/state')).data.qr.staticUrl).searchParams.get('k');
  });
  after(() => server?.stop());

  const claim = async () => (await client(server.url).post('/api/b/alrm-a/claim', { k })).data;
  const status = (id, s) => bar.post(`/api/bar/alrm-a/orders/${id}/status`, { status: s });
  const streamUrl = (id, sid, ring = 0) => `${server.url}/api/b/alrm-a/orders/${id}/alarm.mp3?s=${sid}&ring=${ring}`;
  const isRing = (f) => kbpsOf(f) === 48;

  test('silent while preparing; both phones ring when ready; one taps, the other rings on', async () => {
    const order = await claim();
    const a = listen(streamUrl(order.id, 'phone-aaaa'));
    const b = listen(streamUrl(order.id, 'phone-bbbb'));
    await a.until(() => true);
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(a.frames.length > 20, 'a lead of silence at once, then live');
    assert.ok(a.frames.every((f) => !isRing(f) && f.subarray(4).every((x) => x === 0)), 'only silence while preparing');

    await status(order.id, 'ready');
    await Promise.all([a.until(isRing), b.until(isRing)]);

    const ack = await client(server.url).post(`/api/b/alrm-a/orders/${order.id}/alarm/ack`, { s: 'phone-aaaa' });
    assert.equal(ack.data.ok, true);
    // After the tap: A goes silent; B still rings (its next ring comes).
    await new Promise((r) => setTimeout(r, 400));
    const mark = a.frames.length;
    const bMark = b.frames.length;
    await new Promise((r) => setTimeout(r, 3200));
    assert.ok(a.frames.slice(mark).every((f) => !isRing(f)), 'A stopped ringing');
    assert.ok(b.frames.slice(bMark).some(isRing), 'B rings on');

    // The cashier rings again: A rings again too.
    await bar.post(`/api/bar/alrm-a/orders/${order.id}/renotify`);
    await a.until(isRing);

    // Picked up: the streams end.
    await status(order.id, 'picked');
    await Promise.all([a.done, b.done]);
    a.close();
    b.close();
  });

  test('a phone opening an order that is already ready (and not tapped there) rings at once', async () => {
    const order = await claim();
    await status(order.id, 'ready');
    const c = listen(streamUrl(order.id, 'phone-cccc', 1));
    await c.until(isRing);
    c.close();
  });

  test('closed orders and bad stream ids are turned away', async () => {
    const order = await claim();
    await status(order.id, 'cancelled');
    assert.equal((await fetch(streamUrl(order.id, 'phone-dddd'))).status, 410);
    const open = await claim();
    assert.equal((await fetch(streamUrl(open.id, 'x'))).status, 400);
    assert.equal((await fetch(`${server.url}/api/b/alrm-a/orders/nope/alarm.mp3?s=phone-eeee`)).status, 404);
  });
});
