import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { hashPin } from '../src/auth.js';
import { purgeSandboxes } from '../src/demo.js';
import { client, sse, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';

describe('demo cafés (/demo)', () => {
  let server;
  let su;

  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD) });
    su = client(server.url);
    assert.equal((await su.post('/api/super/login', { password: SUPER_PASSWORD })).status, 200);
  });
  after(() => server?.stop());

  const cafeOf = async (v) => {
    await v.get('/demo');
    return (await v.get('/api/demo')).data;
  };
  const cookieOf = (v) => [...v.jar].map(([k, val]) => `${k}=${val}`).join('; ');

  test('one link signs the visitor in as the cashier and the owner of their own café', async () => {
    const v = client(server.url);
    const page = await v.get('/demo');
    assert.equal(page.status, 200);
    assert.match(page.data, /كافيه الديمو/);
    assert.match(page.data, /Pocket Pager/);
    assert.doesNotMatch(page.data, /Smart Pager/);

    const info = (await v.get('/api/demo')).data;
    assert.match(info.shopId, /^dm-[a-z0-9]{12}$/, 'a café of their own');
    assert.equal(info.theme, null, 'the default colors');
    const id = info.shopId;
    const state = await v.get(`/api/bar/${id}/state`);
    assert.equal(state.status, 200, 'cashier session from the link');
    assert.equal(state.data.plan.status, 'active', 'never runs out');
    const overview = await v.get(`/api/brand/${id}/overview`);
    assert.equal(overview.status, 200, 'owner session from the link');
    assert.equal(overview.data.demo, true);
    assert.equal(overview.data.branches.length, 1);

    // Two weeks of sample history for the owner's dashboard, nothing open on the cashier.
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const report = await v.get(`/api/brand/${id}/analytics?from=${from}&to=${to}`);
    assert.equal(report.status, 200);
    assert.ok(report.data.total.orders > 300, `sample orders: ${report.data.total.orders}`);
    assert.ok(report.data.feedback.count > 30, 'sample ratings');
    assert.equal(state.data.orders.length, 0);
  });

  test('coming back keeps the same café', async () => {
    const v = client(server.url);
    const first = await cafeOf(v);
    const again = await cafeOf(v);
    assert.equal(again.shopId, first.shopId);
  });

  test('two visitors at once never meet: own numbers, own orders, own rings', async () => {
    const a = client(server.url);
    const b = client(server.url);
    const ca = await cafeOf(a);
    const cb = await cafeOf(b);
    assert.notEqual(ca.shopId, cb.shopId);
    const claim = (info) => {
      const k = new URL(info.customerPath, server.url).searchParams.get('k');
      return client(server.url).post(`/api/b/${info.shopId}/claim`, { k });
    };
    const oa = (await claim(ca)).data;
    const ob = (await claim(cb)).data;
    assert.equal(oa.number, 1);
    assert.equal(ob.number, 1, 'each count starts at 1');
    const stream = await sse(`${server.url}/api/bar/${cb.shopId}/events`, { cookie: cookieOf(b) });
    await stream.next('hello');
    await claim(ca);
    await assert.rejects(stream.next('order', () => true, 600), 'B hears nothing of A');
    stream.close();
    assert.equal((await b.get(`/api/bar/${cb.shopId}/state`)).data.orders.length, 1);
    assert.equal((await a.get(`/api/bar/${cb.shopId}/state`)).status, 401, "A can't open B's cashier screen");
    assert.equal((await a.post(`/api/bar/${ca.shopId}/orders/${oa.id}/advance`)).data.status, 'ready');
    const qr = await a.get('/api/demo/qr.svg');
    assert.match(qr.data, /<svg/);
  });

  test("visitors cannot change their café's settings", async () => {
    const v = client(server.url);
    const { shopId: id } = await cafeOf(v);
    assert.equal((await v.post(`/api/bar/${id}/settings`, { readyMessage: 'تم' })).status, 403);
    assert.equal((await v.post(`/api/bar/${id}/settings`, { currentPin: '000000', newPin: '1234' })).status, 403);
    assert.equal((await v.post(`/api/brand/${id}/branches/${id}/settings`, { name: 'اسم تاني' })).status, 403);
    assert.equal((await v.get(`/api/brand/${id}/overview`)).data.branches[0].name, 'كافيه الديمو');
  });

  test("the visitors' cafés stay off the super's brand list; a brand id can't take the demo prefix", async () => {
    const v = client(server.url);
    const { shopId } = await cafeOf(v);
    const overview = (await su.get('/api/super/overview')).data;
    assert.ok(!overview.brands.some((b) => b.id === shopId));
    assert.ok(overview.live.demo.cafes >= 1);
    assert.equal((await su.post('/api/super/brands', { id: 'dm-mine', name: 'x' })).status, 400);
  });

  test('the super sees how many have the demo open now, and visits per day', async () => {
    const before = (await su.get('/api/super/overview')).data.live.demo;
    const v = client(server.url);
    await v.get('/demo');
    await v.get('/demo'); // a reload: one more visit, same visitor
    const live = await sse(`${server.url}/api/demo/live`);
    try {
      let demo;
      for (let i = 0; i < 20; i++) {
        demo = (await su.get('/api/super/overview')).data.live.demo;
        if (demo.open > before.open) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(demo.open, before.open + 1);
      assert.equal(demo.today.visits, before.today.visits + 2);
      assert.equal(demo.today.visitors, before.today.visitors + 1);
    } finally {
      live.close();
    }
  });

  test("the demo's own screens are visitors, not cafés: they stay out of the super's totals", async () => {
    const v = client(server.url);
    const { shopId: id } = await cafeOf(v);
    const bar = await sse(`${server.url}/api/bar/${id}/events`, { cookie: cookieOf(v) });
    const qr = await sse(`${server.url}/api/bar/${id}/events?screen=qr`, { cookie: cookieOf(v) });
    try {
      await bar.next('hello');
      await qr.next('hello');
      const own = (await v.get(`/api/brand/${id}/overview`)).data.branches[0];
      assert.deepEqual(own.screenKinds, { bar: 1, qr: 1 });
      const overview = (await su.get('/api/super/overview')).data;
      assert.equal(overview.live.bar, 0);
      assert.equal(overview.live.qr, 0);
    } finally {
      bar.close();
      qr.close();
    }
  });
});

describe('removing idle demo cafés', () => {
  test('a café unused for a day goes, a fresh one stays, real brands are never touched', () => {
    const now = Date.now();
    const branches = [
      { id: 'dm-aaaaaaaaaaaa', created_at: now - 3 * 86_400_000, last_activity_at: now - 25 * 3600_000 },
      { id: 'dm-bbbbbbbbbbbb', created_at: now - 3 * 86_400_000, last_activity_at: now - 3600_000 },
      { id: 'dm-cccccccccccc', created_at: now - 2 * 3600_000, last_activity_at: null },
      { id: 'cafe-main', created_at: now - 300 * 86_400_000, last_activity_at: now - 200 * 86_400_000 },
      { id: 'demo', created_at: now - 300 * 86_400_000, last_activity_at: null },
    ];
    const purged = [];
    const dropped = [];
    const count = purgeSandboxes({
      control: { listBranches: () => branches, purgeBrand: (id) => purged.push(id) },
      tenants: { drop: (id) => dropped.push(id) },
    }, now);
    assert.equal(count, 1);
    assert.deepEqual(purged, ['dm-aaaaaaaaaaaa']);
    assert.deepEqual(dropped, ['dm-aaaaaaaaaaaa']);
  });
});
