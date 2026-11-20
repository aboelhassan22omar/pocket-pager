import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { splitFrames } from '../src/alarm.js';
import { hashPin } from '../src/auth.js';
import { egyptMobile, localMobile } from '../src/contact.js';
import { BRANCH_MIGRATIONS, openBranchDb } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { client, sse, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';

describe('delivery: the customer’s mobile', () => {
  test('Egyptian mobiles as people type them become 2010xxxxxxxx', () => {
    for (const typed of ['01012345678', '010 1234 5678', '+20 10 1234 5678', '00201012345678', '201012345678', '1012345678', '٠١٠١٢٣٤٥٦٧٨']) {
      assert.equal(egyptMobile(typed), '201012345678', typed);
    }
    assert.equal(egyptMobile('01512345678'), '201512345678');
    assert.equal(localMobile('201012345678'), '01012345678');
  });

  test('anything else is refused, with the field named', () => {
    for (const typed of ['', null, '0101234567', '01312345678', '0221234567', '+971501234567', 'abc', '010123456789']) {
      assert.throws(() => egyptMobile(typed, 'phone'), (err) => err.status === 400 && err.extra?.field === 'phone', String(typed));
    }
  });
});

describe('delivery: a branch database moves to order types without losing anything', () => {
  test('orders stay as they were (pickup), their push subscriptions and ratings too', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-delivery-'));
    const file = path.join(dir, 'pager.db');
    try {
      const old = new DatabaseSync(file);
      old.exec('PRAGMA foreign_keys = ON');
      runMigrations(old, BRANCH_MIGRATIONS.slice(0, 15));
      old.exec(`
        INSERT INTO orders (id, number, status, created_at, ready_at, closed_at, notify_count, ref, rev, receipt)
        VALUES ('order-aaaaaaaaaaaa', 7, 'picked', 10, 20, 30, 2, '1-7', 4, '27'),
               ('order-bbbbbbbbbbbb', 8, 'preparing', 40, NULL, NULL, 0, NULL, 1, NULL);
        INSERT INTO subscriptions (order_id, kind, payload, created_at) VALUES ('order-bbbbbbbbbbbb', 'webpush', '{}', 41);
        INSERT INTO feedback (order_id, rating, created_at) VALUES ('order-aaaaaaaaaaaa', 5, 31);`);
      old.close();

      const db = openBranchDb(file);
      try {
        const a = db.prepare("SELECT * FROM orders WHERE id = 'order-aaaaaaaaaaaa'").get();
        assert.deepEqual(
          [a.number, a.status, a.ready_at, a.closed_at, a.notify_count, a.ref, a.rev, a.receipt, a.order_type, a.customer_phone],
          [7, 'picked', 20, 30, 2, '1-7', 4, '27', 'pickup', null],
        );
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 1, 'subscriptions kept');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1, 'ratings kept');
        assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys back on');
        // The new status is accepted; the cascade still works after the rebuild.
        db.exec("UPDATE orders SET status = 'out_for_delivery' WHERE id = 'order-bbbbbbbbbbbb'");
        db.exec("DELETE FROM orders WHERE id = 'order-bbbbbbbbbbbb'");
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 0);
        assert.throws(() => db.exec("UPDATE orders SET order_type = 'boat'"), /CHECK/);
        const s = db.prepare('SELECT delivery, delivery_close_minutes FROM branch_settings').all();
        assert.deepEqual(s, [], 'no settings row in this bare database');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Over HTTP: brand A (branches dlva-a, dlva-b) and brand B (dlvb-a).
// ---------------------------------------------------------------------------

describe('delivery over HTTP', () => {
  let server;
  const owners = {};
  let bar;
  let barB;

  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD), JOB_INTERVAL_SECONDS: '1' });
    const su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
    for (const [brand, branches] of [['dlva', ['dlva-a', 'dlva-b']], ['dlvb', ['dlvb-a']]]) {
      await su.post('/api/super/brands', { id: brand, name: brand });
      for (const id of branches) await su.post(`/api/super/brands/${brand}/branches`, { id, name: id, pin: '1234', qrMode: 'static' });
      await su.post(`/api/super/brands/${brand}/owners`, { username: `${brand}.owner`, password: `${brand}-owner-pass` });
      owners[brand] = client(server.url);
      await owners[brand].post('/api/brand/login', { username: `${brand}.owner`, password: `${brand}-owner-pass` });
    }
    bar = client(server.url);
    await bar.post('/api/bar/login', { shopId: 'dlva-a', pin: '1234' });
    barB = client(server.url);
    await barB.post('/api/bar/login', { shopId: 'dlva-b', pin: '1234' });
  });
  after(() => server?.stop());

  const drivers = (brand, branch) => `/api/brand/${brand}/branches/${branch}/drivers`;

  test('owner: delivery is off by default; turning it on and the close time are checked', async () => {
    const view = (await owners.dlva.get('/api/brand/dlva/overview')).data.branches.find((b) => b.id === 'dlva-a');
    assert.deepEqual([view.delivery, view.deliveryCloseMinutes], [false, 60]);
    const settings = (body) => owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', body);
    assert.equal((await settings({ deliveryCloseMinutes: 10 })).data.field, 'deliveryCloseMinutes');
    assert.equal((await settings({ deliveryCloseMinutes: 241 })).data.field, 'deliveryCloseMinutes');
    assert.equal((await settings({ delivery: true, deliveryCloseMinutes: 45 })).status, 200);
    const after1 = (await owners.dlva.get('/api/brand/dlva/overview')).data.branches.find((b) => b.id === 'dlva-a');
    assert.deepEqual([after1.delivery, after1.deliveryCloseMinutes], [true, 45]);
    assert.equal((await bar.get('/api/bar/dlva-a/state')).data.shop.delivery, true, 'the cashier sees it');
  });

  test('owner: drivers are added, edited and deleted, with a checked name and mobile', async () => {
    const url = drivers('dlva', 'dlva-a');
    assert.deepEqual((await owners.dlva.get(url)).data, { drivers: [] });
    assert.equal((await owners.dlva.post(url, { name: '', phone: '01012345678' })).data.field, 'name');
    assert.equal((await owners.dlva.post(url, { name: 'أحمد', phone: '12345' })).data.field, 'phone');
    const added = await owners.dlva.post(url, { name: ' أحمد ', phone: '+20 10 1234 5678' });
    assert.equal(added.status, 201);
    assert.deepEqual(added.data.driver, { id: added.data.driver.id, name: 'أحمد', phone: '01012345678' });
    const second = (await owners.dlva.post(url, { name: 'Mido', phone: '01112345678' })).data.driver;
    const edited = await owners.dlva.post(`${url}/${second.id}`, { name: 'Mido S', phone: '01512345678' });
    assert.deepEqual(edited.data.driver, { id: second.id, name: 'Mido S', phone: '01512345678' });
    assert.deepEqual((await owners.dlva.get(url)).data.drivers.map((d) => d.name), ['Mido S', 'أحمد']);
    assert.equal((await owners.dlva.post(`${url}/${second.id}/delete`, {})).status, 200);
    assert.equal((await owners.dlva.post(`${url}/${second.id}/delete`, {})).status, 404, 'once');
    assert.deepEqual((await owners.dlva.get(url)).data.drivers.map((d) => d.name), ['أحمد']);
  });

  test('isolation: drivers belong to one branch; other brands and branches never see them', async () => {
    const mine = (await owners.dlva.get(drivers('dlva', 'dlva-a'))).data.drivers[0];
    assert.deepEqual((await owners.dlva.get(drivers('dlva', 'dlva-b'))).data.drivers, [], 'another branch of the same brand');
    assert.equal((await owners.dlva.post(`${drivers('dlva', 'dlva-b')}/${mine.id}`, { name: 'x', phone: '01012345678' })).status, 404);
    assert.equal((await owners.dlvb.get(drivers('dlva', 'dlva-a'))).status, 401, 'another brand\u2019s owner');
    assert.equal((await owners.dlvb.get(drivers('dlvb', 'dlva-a'))).status, 404, 'a branch of another brand under my brand');
    assert.equal((await owners.dlvb.post(drivers('dlvb', 'dlva-a'), { name: 'x', phone: '01012345678' })).status, 404);
    assert.equal((await bar.get(drivers('dlva', 'dlva-a'))).status, 401, 'cashiers don\u2019t manage drivers');
  });

  const orders = (shop) => `/api/bar/${shop}/orders`;
  const customerView = async (id) => (await client(server.url).get(`/api/b/dlva-a/orders/${id}`)).data;
  const branchDb = () => new DatabaseSync(path.join(server.dataDir, 'tenants', 'dlva', 'dlva-a', 'pager.db'));
  const newDelivery = async (phone = '01012345678') => (await bar.post(orders('dlva-a'), { type: 'delivery', phone })).data;

  test('cashier: a delivery order needs delivery on and an Egyptian mobile; only the cashier sees the mobile', async () => {
    assert.equal((await barB.post(orders('dlva-b'), { type: 'delivery', phone: '01012345678' })).status, 409, 'delivery off');
    assert.equal((await bar.post(orders('dlva-a'), { type: 'delivery', phone: '0123' })).data.field, 'phone');
    assert.equal((await bar.post(orders('dlva-a'), {})).status, 409, 'pickup by the cashier still needs order QR mode');

    const res = await bar.post(orders('dlva-a'), { type: 'delivery', phone: '+20 10 1234 5678' });
    assert.equal(res.status, 200);
    const o = res.data;
    assert.deepEqual([o.type, o.status, o.customer, o.driver], ['delivery', 'preparing', { phone: '01012345678', wa: '201012345678' }, null]);
    assert.equal(o.link, `${server.url}/s/dlva-a?o=${o.id}&j=1`);
    const state = (await bar.get('/api/bar/dlva-a/state')).data;
    assert.deepEqual(state.drivers.map((d) => d.name), ['أحمد']);
    assert.ok(state.orders.find((x) => x.id === o.id).customer, 'the cashier screen has it');

    const seen = await customerView(o.id);
    assert.equal(seen.type, 'delivery');
    assert.ok(!JSON.stringify(seen).includes('1012345678'), 'the customer page never gets the mobile');
    assert.equal(seen.link, undefined);

    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/advance`, {})).status, 409, 'leaves with a driver, not by a tap');
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/status`, { status: 'ready' })).status, 409, 'never ready');
  });

  test('«خرج للتوصيل»: a driver of this branch; the customer sees them on the way; delivered hides them', async () => {
    const o = await newDelivery();
    const url = `${orders('dlva-a')}/${o.id}/dispatch`;
    const driverA = (await bar.get('/api/bar/dlva-a/state')).data.drivers[0];
    const driverB = (await owners.dlva.post(drivers('dlva', 'dlva-b'), { name: 'Other', phone: '01212345678' })).data.driver;
    assert.equal((await bar.post(url, { driverId: 9999 })).data.field, 'driverId');
    assert.equal((await bar.post(url, { driverId: driverB.id + 100 })).data.field, 'driverId');
    assert.equal((await barB.post(`/api/bar/dlva-b/orders/${o.id}/dispatch`, { driverId: driverB.id })).status, 404, 'another branch’s cashier');

    const stream = await sse(`${server.url}/api/b/dlva-a/orders/${o.id}/events`);
    await stream.next('order');
    const sent = await bar.post(url, { driverId: driverA.id, from: 'preparing' });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.status, 'out_for_delivery');
    const pushed = (await stream.next('order')).data;
    assert.deepEqual(pushed.driver, { name: 'أحمد', phone: '01012345678', tel: '+201012345678' });
    assert.equal(pushed.message, 'طلبك في الطريق مع أحمد');
    stream.close();
    assert.equal((await bar.post(url, { driverId: driverA.id })).status, 409, 'once');

    // The driver deleted (or edited) meanwhile: this order keeps who took it.
    await owners.dlva.post(`${drivers('dlva', 'dlva-a')}/${driverA.id}/delete`, {});
    assert.equal((await customerView(o.id)).driver.name, 'أحمد');

    const done = await bar.post(`${orders('dlva-a')}/${o.id}/advance`, { from: 'out_for_delivery' });
    assert.equal(done.data.status, 'picked');
    const closed = await customerView(o.id);
    assert.deepEqual([closed.driver, closed.message], [null, 'طلبك وصل، بالهنا والشفا']);
    const db = branchDb();
    const row = db.prepare('SELECT customer_phone, driver_phone, driver_name FROM orders WHERE id = ?').get(o.id);
    db.close();
    assert.deepEqual({ ...row }, { customer_phone: null, driver_phone: null, driver_name: 'أحمد' }, 'phone numbers gone once closed');
  });

  test('on its way longer than the branch’s minutes, it closes by itself; cancelled hides the driver', async () => {
    const driver = (await owners.dlva.post(drivers('dlva', 'dlva-a'), { name: 'Sayed', phone: '01098765432' })).data.driver;
    const late = await newDelivery();
    const onTime = await newDelivery('01112345678');
    for (const o of [late, onTime]) await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: driver.id });
    const db = branchDb();
    db.prepare('UPDATE orders SET out_at = ? WHERE id = ?').run(Date.now() - 46 * 60_000, late.id); // the branch closes after 45
    db.close();
    for (let i = 0; i < 40 && (await customerView(late.id)).status !== 'picked'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await customerView(late.id)).status, 'picked');
    assert.equal((await customerView(onTime.id)).status, 'out_for_delivery');

    await bar.post(`${orders('dlva-a')}/${onTime.id}/status`, { status: 'cancelled' });
    const gone = await customerView(onTime.id);
    assert.deepEqual([gone.status, gone.driver], ['cancelled', null]);
  });

  test('stamp card: the customer who opened the link gets the stamp when the order leaves, once', async () => {
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { loyaltyEvery: 3, loyaltyRewardText: 'كشري ببلاش', features: { loyalty: true } });
    const driver = (await bar.get('/api/bar/dlva-a/state')).data.drivers[0];
    const o = await newDelivery();
    const customer = client(server.url);
    assert.equal((await customer.post(`/api/b/dlva-a/orders/${o.id}/join`, {})).status, 200);
    const stamps = async () => (await customer.get('/api/b/dlva-a/loyalty')).data.stamps;
    assert.equal(await stamps(), 0);
    await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: driver.id });
    assert.equal(await stamps(), 1, 'when it leaves');
    await bar.post(`${orders('dlva-a')}/${o.id}/advance`, {});
    assert.equal(await stamps(), 1, 'not again when it arrives');

    // On one product: only when the cashier says the order has it.
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { loyaltyProduct: 'كشري كبير' });
    const without = await newDelivery();
    await customer.post(`/api/b/dlva-a/orders/${without.id}/join`, {});
    await bar.post(`${orders('dlva-a')}/${without.id}/dispatch`, { driverId: driver.id });
    await bar.post(`${orders('dlva-a')}/${without.id}/advance`, {});
    assert.equal(await stamps(), 1, 'no');
    const withIt = await newDelivery();
    await customer.post(`/api/b/dlva-a/orders/${withIt.id}/join`, {});
    await bar.post(`${orders('dlva-a')}/${withIt.id}/dispatch`, { driverId: driver.id, product: true });
    assert.equal(await stamps(), 2, 'yes');
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { loyaltyProduct: '', features: { loyalty: false } });
  });

  test('delivery turned off with orders still out: they can still leave and arrive', async () => {
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { delivery: true });
    const o = await newDelivery();
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { delivery: false });
    const state = (await bar.get('/api/bar/dlva-a/state')).data;
    assert.equal(state.shop.delivery, false);
    assert.ok(state.drivers.length > 0, 'the drivers are still there for the open orders');
    assert.equal((await bar.post(orders('dlva-a'), { type: 'delivery', phone: '01012345678' })).status, 409, 'no new ones');
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: state.drivers[0].id })).status, 200);
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/advance`, {})).data.status, 'picked');
    await owners.dlva.post('/api/brand/dlva/branches/dlva-a/settings', { delivery: true });
  });

  test('a JSON body that is not an object ("x", 1, true, [], null) is a 400 everywhere, never a crash', async () => {
    const send = (c, url, body) => c.request('POST', url, { body, headers: { 'content-type': 'application/json' } });
    for (const [c, url] of [
      [bar, '/api/bar/dlva-a/settings'], [bar, '/api/bar/dlva-a/orders'], [bar, '/api/bar/dlva-a/counter'],
      [owners.dlva, '/api/brand/dlva/branches/dlva-a/settings'], [owners.dlva, '/api/brand/dlva/account'],
      [owners.dlva, '/api/brand/dlva/texts'], [owners.dlva, drivers('dlva', 'dlva-a')],
    ]) {
      for (const body of ['"x"', '1', 'true', '[]', 'null']) assert.equal((await send(c, url, body)).status, 400, `${url} ${body}`);
    }
    // A branch id with a stray character in a logout link: no crash (it was a 500).
    for (const id of ['%00', '%0d%0a', 'a%3Bb']) assert.equal((await client(server.url).post(`/api/bar/${id}/logout`, {})).status, 200, id);
  });

  test('pickup is as before: ready then picked, nothing of delivery on it', async () => {
    const k = new URL((await bar.get('/api/bar/dlva-a/state')).data.qr.staticUrl).searchParams.get('k');
    const o = (await client(server.url).post('/api/b/dlva-a/claim', { k })).data;
    assert.deepEqual([o.type, o.driver, o.customer], ['pickup', null, undefined]);
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/advance`, {})).data.status, 'ready');
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: 1 })).status, 400, 'no such driver any more');
    const driver = (await bar.get('/api/bar/dlva-a/state')).data.drivers[0];
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: driver.id })).status, 409, 'a pickup order never leaves with a driver');
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/advance`, {})).data.status, 'picked');
  });

  test('«خرج للتوصيل» rings the customer’s alarm stream (silent while it is prepared)', async () => {
    const o = await newDelivery();
    const driver = (await owners.dlva.post(drivers('dlva', 'dlva-a'), { name: 'Ring', phone: '01112345678' })).data.driver;
    const ctl = new AbortController();
    const res = await fetch(`${server.url}/api/b/dlva-a/orders/${o.id}/alarm.mp3?s=phone-dlv1&ring=0`, { signal: ctl.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    let buffer = Buffer.alloc(0);
    let pending = null; // a read still waiting is kept, so no chunk is lost
    const read = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        pending ??= reader.read();
        const next = await Promise.race([pending, new Promise((r) => setTimeout(() => r(null), end - Date.now()))]);
        if (!next) break;
        pending = null;
        if (next.done) break;
        buffer = Buffer.concat([buffer, Buffer.from(next.value)]);
      }
      return splitFrames(buffer);
    };
    const rings = (frames) => frames.filter((f) => f[2] >> 4 === 6).length; // 48 kbps: the ring
    assert.equal(rings(await read(600)), 0, 'silent while prepared');
    assert.equal((await bar.post(`${orders('dlva-a')}/${o.id}/dispatch`, { driverId: driver.id })).status, 200);
    assert.ok(rings(await read(800)) > 0, 'rings once it leaves');
    ctl.abort();
  });
});
