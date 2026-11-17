import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { hashPin } from '../src/auth.js';
import { egyptMobile, localMobile } from '../src/contact.js';
import { BRANCH_MIGRATIONS, openBranchDb } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { client, startServer } from './helpers.js';

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
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD) });
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
});
