// Regression tests for the security audit of 2026-11-22 (security-audit skill, run 1).
// Each test failed before its fix: it states the boundary the code must now hold.

import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { hashPin } from '../src/auth.js';
import * as summary from '../src/summary.js';
import { openControl } from '../src/control.js';
import { client, sse, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';
const cookieHeader = (c) => ({ cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') });

describe('security audit regressions', () => {
  let server;
  let su;
  let owner;
  let other;
  let k;
  const controlDb = () => new DatabaseSync(path.join(server.dataDir, 'control.db'));

  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD) });
    su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
    const a = await su.post('/api/super/clients', {
      brandName: 'Audit A', brandId: 'auda', branchName: 'A', branchSlug: 'one', ownerName: 'Owner A', phone: '01011110001', pin: '2468',
    });
    const b = await su.post('/api/super/clients', {
      brandName: 'Audit B', brandId: 'audb', branchName: 'B', ownerName: 'Owner B', phone: '01011110002', pin: '1357',
    });
    owner = client(server.url);
    await owner.post('/api/login', { login: '01011110001', password: a.data.password });
    other = client(server.url);
    await other.post('/api/login', { login: '01011110002', password: b.data.password });
    // Static QR on, one phone per order.
    const bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'auda-one', pin: '2468' });
    await bar.post('/api/bar/auda-one/settings', { qrMode: 'both' });
    await owner.post('/api/brand/auda/branches/auda-one/settings', { orderShare: false });
    k = new URL((await bar.get('/api/bar/auda-one/state')).data.qr.staticUrl).searchParams.get('k');
  });
  after(() => server?.stop());

  test('receipt link: an order already on someone else’s phone is not handed out by number', async () => {
    const victim = await client(server.url).post('/api/b/auda-one/claim', { k }, { headers: { 'x-client-id': 'victim-phone-xxxxxxxxxx' } });
    assert.equal(victim.status, 200);
    const res = await fetch(`${server.url}/r/auda-one/${k}/${victim.data.number}`, { redirect: 'manual' });
    assert.ok(!String(res.headers.get('location') ?? '').includes(victim.data.id), 'the victim’s bearer order id leaked');
  });

  test('receipt link: enumerating numbers is rate limited', async () => {
    const statuses = [];
    for (let n = 1; n <= 40; n++) {
      const res = await fetch(`${server.url}/r/auda-one/${k}/${n}`, { redirect: 'manual', headers: { 'x-forwarded-for': '10.9.9.9' } });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `no limit: ${[...new Set(statuses)]}`);
  });

  test('a cashier removed by the owner stops receiving the live order stream at once', async () => {
    const add = await owner.post('/api/brand/auda/branches/auda-one/staff', { name: 'Fired', pin: '9753' });
    const cashier = client(server.url);
    await cashier.post('/api/bar/login', { shopId: 'auda-one', pin: '9753' });
    const stream = await sse(`${server.url}/api/bar/auda-one/events`, cookieHeader(cashier));
    assert.equal(stream.status, 200);
    await owner.post(`/api/brand/auda/branches/auda-one/staff/${add.data.added.id}/delete`);
    // A new customer order after the removal must not reach the removed cashier's stream.
    await client(server.url).post('/api/b/auda-one/claim', { k }, { headers: { 'x-client-id': 'after-fire-xxxxxxxxxxxxx' } });
    await assert.rejects(stream.next('order', () => true, 2500), /timed out/);
    stream.close();
  });

  test('a manager signed out by a new password stops getting pushes on their phone', async () => {
    const m = await owner.post('/api/brand/auda/managers', { name: 'Mgr', phone: '01011110003', branchId: 'auda-one' });
    const manager = client(server.url);
    await manager.post('/api/login', { login: '01011110003', password: m.data.manager.password });
    assert.equal((await manager.post('/api/brand/auda/push-devices', { token: 'b'.repeat(64), platform: 'ios' })).status, 200);
    await owner.post(`/api/brand/auda/managers/${m.data.manager.id}/password`);
    const db = controlDb();
    const left = db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE token = ?').get('b'.repeat(64)).n;
    db.close();
    assert.equal(left, 0, 'the signed-out phone still receives pushes');
  });

  test('another brand cannot remove (or take over) a phone’s push registration', async () => {
    await owner.post('/api/brand/auda/push-devices', { token: 'c'.repeat(64), platform: 'ios' });
    await other.post('/api/brand/audb/push-devices/delete', { token: 'c'.repeat(64) });
    const db = controlDb();
    const row = db.prepare('SELECT brand_id FROM push_devices WHERE token = ?').get('c'.repeat(64));
    db.close();
    assert.equal(row?.brand_id, 'auda');
  });
});

describe('security audit regressions: logins, limits, review account', () => {
  let server;
  let su;
  let owner;
  let k;
  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD), REVIEW_ACCOUNT: 'on', ALARM_MAX_PER_IP: '30' });
    su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
    const a = await su.post('/api/super/clients', {
      brandName: 'Audit C', brandId: 'audc', branchName: 'C', branchSlug: 'one', ownerName: 'Owner C', phone: '01022220001', pin: '2468',
    });
    owner = client(server.url);
    await owner.post('/api/login', { login: '01022220001', password: a.data.password });
    const bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'audc-one', pin: '2468' });
    await bar.post('/api/bar/audc-one/settings', { qrMode: 'both' });
    k = new URL((await bar.get('/api/bar/audc-one/state')).data.qr.staticUrl).searchParams.get('k');
  });
  after(() => server?.stop());

  test('a cashier with their own PIN cannot read the branch POS link', async () => {
    await owner.post('/api/brand/audc/branches/audc-one/staff', { name: 'Cashier', pin: '864201' });
    const cashier = client(server.url);
    assert.equal((await cashier.post('/api/bar/login', { shopId: 'audc-one', pin: '864201' })).status, 200);
    assert.equal((await cashier.get('/api/bar/audc-one/pos')).status, 403);
  });

  test('the branch PIN can never be set to a cashier\u2019s PIN', async () => {
    await owner.post('/api/brand/audc/branches/audc-one/staff', { name: 'Other', pin: '975310' });
    assert.equal((await owner.post('/api/brand/audc/branches/audc-one/pin', { pin: '975310' })).status, 409);
  });

  test('sign-in attempts are counted per account, whatever way the phone is typed', async () => {
    const ip = '10.77.0.1';
    const spellings = ['01022220001', '0102 2220001', '0102-2220001', '+201022220001', '00201022220001', '(0102)2220001', '٠١٠٢٢٢٢٠٠٠١'];
    const statuses = [];
    for (const login of spellings) statuses.push((await client(server.url).post('/api/login', { login, password: 'wrong-pass' }, { ip })).status);
    assert.ok(statuses.includes(429), `no limit across spellings: ${statuses}`);
  });

  test('static-key claims from one address are capped (the number pool cannot be drained)', async () => {
    const ip = '10.77.0.2';
    const statuses = [];
    for (let i = 0; i < 45; i++) {
      const res = await client(server.url).post('/api/b/audc-one/claim', { k }, { ip, headers: { 'x-client-id': `drain-${i}-xxxxxxxxxxxxxxxxxx` } });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `no cap: ${[...new Set(statuses)]}`);
  });

  test('one address cannot hold all the alarm streams', async () => {
    const ip = '10.77.0.3';
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const res = await client(server.url).post('/api/b/audc-one/claim', { k }, { ip: `10.77.1.${i}`, headers: { 'x-client-id': `alarm-${i}-xxxxxxxxxxxxxxxxxx` } });
      assert.equal(res.status, 200, `claim ${i}: ${res.status} ${JSON.stringify(res.data)}`);
      ids.push(res.data.id);
    }
    const ctrls = [];
    const statuses = [];
    // Held on purpose: an unread response that gets garbage-collected closes its stream.
    const held = [];
    for (const id of ids) {
      for (let s = 0; s < 12; s++) {
        const ctrl = new AbortController();
        ctrls.push(ctrl);
        const res = await fetch(`${server.url}/api/b/audc-one/orders/${id}/alarm.mp3?s=sid${s}xxxxxxxx`, { signal: ctrl.signal, headers: { 'x-forwarded-for': ip } });
        statuses.push(res.status);
        held.push(res);
      }
    }
    for (const c of ctrls) c.abort();
    held.length = 0;
    assert.ok(statuses.includes(429), `one address held 48 streams: ${[...new Set(statuses)]}`);
  });

  test('the public review account is read-only: it cannot add managers or change the brand', async () => {
    const review = client(server.url);
    assert.equal((await review.post('/api/login', { login: '01099990001', password: 'PocketReview1' })).status, 200);
    assert.equal((await review.get('/api/brand/review-cafe/overview')).status, 200);
    const add = await review.post('/api/brand/review-cafe/managers', { name: 'Squat', phone: '01033334444', branchId: 'review-cafe-maadi', password: 'chosen1' });
    assert.equal(add.status, 403);
    assert.equal((await review.post('/api/brand/review-cafe/account/delete', { password: 'PocketReview1' })).status, 403);
    // Its phones can still get the alerts (App Review tries notifications).
    assert.equal((await review.post('/api/brand/review-cafe/push-devices', { token: 'd'.repeat(64), platform: 'ios' })).status, 200);
  });
});

describe('weekly summary recipients', () => {
  test('the brand’s owners only: never branch managers or stopped accounts', () => {
    const control = openControl(':memory:');
    control.createBrand({ id: 'sumb', name: 'S' });
    control.createOwner({ brandId: 'sumb', username: 'own', email: 'owner@example.com', passwordHash: 'x' });
    control.createOwner({ brandId: 'sumb', branchId: 'sumb', username: 'mgr', email: 'mgr@example.com', passwordHash: 'x' });
    const stopped = control.createOwner({ brandId: 'sumb', username: 'old', email: 'old@example.com', passwordHash: 'x' });
    control.setOwnerDisabled(stopped.id, true);
    assert.deepEqual(summary.summaryRecipients(control, 'sumb'), ['owner@example.com']);
    control.close();
  });
});
