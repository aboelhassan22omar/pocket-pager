import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { hashPin } from '../src/auth.js';
import { client, sse, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';
const cookieHeader = (c) => ({ cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') });

describe('the managers’ app: accounts by Aurexis, never signed out, live, alerts', () => {
  let server;
  let su;
  before(async () => {
    server = await startServer({
      SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD), PAY_WHATSAPP: '01043833456', ALERTS_INTERVAL_SECONDS: '1',
    });
    su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
  });
  after(() => server?.stop());

  test('/signup makes no account: it leaves a request for /super', async () => {
    const signup = await client(server.url).post('/api/signup', {
      name: 'أحمد علي', phone: '01011112222', password: 'secret1', brandName: 'كافيه زد', brandId: 'cafe-z',
    });
    assert.equal(signup.status, 403, 'self-serve sign-up is off');
    const req = await client(server.url).post('/api/account-requests', { name: 'أحمد علي', phone: '01011112222', brandName: 'كافيه زد', branches: 3 });
    assert.equal(req.status, 201);
    assert.equal(req.data.whatsapp, '201043833456');
    const [open] = (await su.get('/api/super/overview')).data.requests;
    assert.deepEqual([open.name, open.phone, open.brand_name, open.branches], ['أحمد علي', '201011112222', 'كافيه زد', 3]);
    assert.equal((await su.post(`/api/super/account-requests/${open.id}/close`)).data.requests.length, 0);
  });

  let owner;
  let client1;
  test('/super: brand + first branch + owner in one step, with the WhatsApp message', async () => {
    const res = await su.post('/api/super/clients', {
      brandName: 'مطعم النور', brandId: 'nour', branchName: 'المعادي', branchSlug: 'maadi', ownerName: 'سامي', phone: '01055556666',
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    client1 = res.data;
    assert.equal(client1.branchId, 'nour-maadi');
    assert.equal(client1.username, '01055556666');
    for (const part of ['apps.apple.com', 'play.google.com', client1.username, client1.password, client1.urls.bar, client1.pin]) {
      assert.ok(client1.message.includes(part), part);
    }
    const again = await su.post('/api/super/clients', { brandName: 'x', brandId: 'nour', ownerName: 'سامي', phone: '01055556667' });
    assert.equal(again.status, 409);

    owner = client(server.url);
    const login = await owner.post('/api/login', { login: '01055556666', password: client1.password });
    assert.equal(login.status, 200);
    assert.equal(login.data.brandId, 'nour');
  });

  test('never signed out by time: 400-day cookie, renewed on every dashboard load', async () => {
    const ov = await owner.get('/api/brand/nour/overview');
    assert.equal(ov.status, 200);
    assert.match(ov.headers.getSetCookie().join(';'), /sp_owner=.*Max-Age=34560000/);
    assert.equal(ov.data.whatsapp, '01043833456');
    // Branches are added by Aurexis.
    assert.equal((await owner.post('/api/brand/nour/branches', { name: 'x', slug: 'xx' })).status, 403);
  });

  test('live: the dashboard stream hears a pause, an order and the alert', async () => {
    const stream = await sse(`${server.url}/api/brand/nour/events`, cookieHeader(owner));
    assert.equal(stream.status, 200);
    await stream.next('hello');
    assert.equal((await owner.post('/api/brand/nour/branches/nour-maadi/settings', { paused: true })).status, 200);
    await stream.next('changed');
    const alert = await stream.next('alert');
    assert.equal(alert.data.branchId, 'nour-maadi');
    const { alerts } = (await owner.get('/api/brand/nour/alerts')).data;
    assert.equal(alerts[0].kind, 'paused');
    assert.match(alerts[0].title, /اتقفل مؤقتًا/);
    await owner.post('/api/brand/nour/branches/nour-maadi/settings', { paused: false });
    // The cashier opening their screen reaches the dashboard too.
    const bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'nour-maadi', pin: client1.pin });
    const cashier = await sse(`${server.url}/api/bar/nour-maadi/events`, cookieHeader(bar));
    await stream.next('changed');
    cashier.close();
    stream.close();
  });

  test('alerts: a trial ending soon is noticed by the job; a manager sees their branch only', async () => {
    // A second branch with a manager.
    await su.post('/api/super/brands/nour/branches', { id: 'nour-zamalek', name: 'الزمالك', pin: '4321' });
    const m = await owner.post('/api/brand/nour/managers', { name: 'منى', phone: '01077778888', branchId: 'nour-zamalek' });
    const manager = client(server.url);
    await manager.post('/api/login', { login: '01077778888', password: m.data.manager.password });
    // Both branches are on a 3-day trial: the job (every second here) raises «فاضلها 3 أيام».
    let ending = [];
    for (let i = 0; i < 30 && ending.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 300));
      ending = (await owner.get('/api/brand/nour/alerts')).data.alerts.filter((a) => a.kind === 'ending');
    }
    assert.deepEqual(ending.map((a) => a.branchId).sort(), ['nour-maadi', 'nour-zamalek']);
    const mine = (await manager.get('/api/brand/nour/alerts')).data.alerts;
    assert.ok(mine.length > 0);
    assert.ok(mine.every((a) => a.branchId === 'nour-zamalek'), 'the manager never sees the other branch');
    // Phones register for pushes.
    assert.equal((await manager.post('/api/brand/nour/push-devices', { token: 'a'.repeat(64), platform: 'ios' })).status, 200);
    assert.equal((await manager.post('/api/brand/nour/push-devices', { token: 'x' })).status, 400);
  });

  test('signed out only by the super: a new password or a stopped account', async () => {
    const { brands } = (await su.get('/api/super/overview')).data;
    const sami = brands.find((b) => b.id === 'nour').owners.find((o) => o.username === '01055556666');
    assert.equal(sami.disabled, false);
    assert.equal((await su.post(`/api/super/owners/${sami.id}/disable`, { disabled: true })).status, 200);
    assert.equal((await owner.get('/api/brand/nour/overview')).status, 401, 'stopped: out at once');
    const refused = await client(server.url).post('/api/login', { login: '01055556666', password: client1.password });
    assert.equal(refused.status, 403);
    await su.post(`/api/super/owners/${sami.id}/disable`, { disabled: false });
    assert.equal((await owner.post('/api/login', { login: '01055556666', password: client1.password })).status, 200);
    assert.equal((await owner.get('/api/brand/nour/overview')).status, 200);
    await su.post(`/api/super/brands/nour/owners/${sami.id}`, { password: 'brand-new-pass' });
    assert.equal((await owner.get('/api/brand/nour/overview')).status, 401, 'a new password signs out');
  });
});

describe('the App Store review account', () => {
  let server;
  before(async () => {
    server = await startServer({ REVIEW_ACCOUNT: 'on', REVIEW_PASSWORD: 'Review-test-1' });
  });
  after(() => server?.stop());

  test('made on start: two branches with orders, an owner and a branch manager', async () => {
    const owner = client(server.url);
    const login = await owner.post('/api/login', { login: '01099990001', password: 'Review-test-1' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const ov = (await owner.get('/api/brand/review-cafe/overview')).data;
    assert.deepEqual(ov.branches.map((b) => b.id).sort(), ['review-cafe-maadi', 'review-cafe-zamalek']);
    for (const b of ov.branches) {
      assert.equal(b.plan.status, 'active');
      assert.ok(b.openNow >= 3, `${b.id} has orders being made`);
    }
    const manager = client(server.url);
    await manager.post('/api/login', { login: '01099990002', password: 'Review-test-1' });
    assert.deepEqual((await manager.get('/api/brand/review-cafe/overview')).data.branches.map((b) => b.id), ['review-cafe-maadi']);
  });
});
