import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { egyptMobile, localMobile } from '../src/contact.js';
import { BRANCH_MIGRATIONS, openBranchDb } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';

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
