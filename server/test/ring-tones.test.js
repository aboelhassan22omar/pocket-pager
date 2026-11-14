import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RING_TONES } from '../public/js/chime.js';
import { hashPin } from '../src/auth.js';
import { sniffAudio } from '../src/ring.js';
import { client, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';
// The first bytes of real files of each kind.
const MP3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.alloc(2000, 0x55)]);
const WAV = Buffer.concat([Buffer.from('RIFF\x24\x08\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(2000, 1)]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

describe('the ring library', () => {
  test('the default plus at least ten more, each with notes it can play', () => {
    assert.equal(RING_TONES[0].id, 'classic');
    assert.ok(RING_TONES.length >= 11, `${RING_TONES.length} tones`);
    assert.equal(new Set(RING_TONES.map((t) => t.id)).size, RING_TONES.length, 'unique ids');
    for (const t of RING_TONES) {
      assert.ok(t.label && t.notes.length && t.dur > 0 && ['sine', 'square', 'triangle', 'sawtooth'].includes(t.wave), t.id);
    }
  });

  test('a sound file is told by its bytes, not its name', () => {
    assert.equal(sniffAudio(MP3), 'mp3');
    assert.equal(sniffAudio(WAV), 'wav');
    assert.equal(sniffAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)])), 'ogg');
    assert.equal(sniffAudio(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(20)])), 'm4a');
    assert.equal(sniffAudio(PNG), null);
  });
});

describe("the brand's ring", () => {
  let server;
  let owner;
  let k;

  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD) });
    const su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
    await su.post('/api/super/brands', { id: 'ring', name: 'Ring' });
    await su.post('/api/super/brands/ring/branches', { id: 'ring-a', name: 'Ring A', pin: '1234', qrMode: 'static' });
    await su.post('/api/super/brands/ring/owners', { username: 'ring.owner', password: 'ring-owner-pass' });
    owner = client(server.url);
    await owner.post('/api/brand/login', { username: 'ring.owner', password: 'ring-owner-pass' });
    const bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'ring-a', pin: '1234' });
    k = new URL((await bar.get('/api/bar/ring-a/state')).data.qr.staticUrl).searchParams.get('k');
  });
  after(() => server?.stop());

  const customerRing = async () => (await client(server.url).get('/api/b/ring-a')).data.ring;
  const upload = (body, type = 'audio/mpeg') => owner.request('POST', '/api/brand/ring/ring-file', { body, headers: { 'content-type': type } });

  test('by default the customer hears the classic ring', async () => {
    assert.deepEqual(await customerRing(), { tone: 'classic', url: null });
    assert.ok(k);
  });

  test('the owner picks another tone; every customer page gets it', async () => {
    const res = await owner.post('/api/brand/ring/ring', { tone: 'bell' });
    assert.equal(res.status, 200);
    assert.deepEqual(await customerRing(), { tone: 'bell', url: null });
    assert.equal((await owner.post('/api/brand/ring/ring', { tone: 'nope' })).status, 400);
  });

  test("the brand's own sound: stored, served as audio, given to customers", async () => {
    const res = await upload(MP3);
    assert.equal(res.status, 200);
    assert.match(res.data.url, /^\/media\/brand\/ring\/ring-\d+\.mp3$/);
    assert.equal((await customerRing()).url, res.data.url);
    const file = await fetch(server.url + res.data.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'audio/mpeg');
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(MP3));

    const wav = await upload(WAV, 'audio/wav');
    assert.match(wav.data.url, /\.wav$/);
    assert.equal((await fetch(server.url + res.data.url)).status, 404, 'the older file is gone');
  });

  test('not a sound, too big, or another brand: refused', async () => {
    assert.equal((await upload(PNG)).status, 400);
    assert.equal((await upload(Buffer.concat([MP3, Buffer.alloc(700 * 1024)]))).status, 413);
    const stranger = client(server.url);
    assert.equal((await stranger.request('POST', '/api/brand/ring/ring-file', { body: MP3, headers: { 'content-type': 'audio/mpeg' } })).status, 401);
  });

  test('picking a tone again drops the own sound', async () => {
    const before = (await customerRing()).url;
    await owner.post('/api/brand/ring/ring', { tone: 'classic' });
    assert.deepEqual(await customerRing(), { tone: 'classic', url: null });
    assert.equal((await fetch(server.url + before)).status, 404);
  });
});
