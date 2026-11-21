import { DatabaseSync } from 'node:sqlite';
import { PRAGMAS, runMigrations, tx } from './migrations.js';
import { effectivePlan } from './plans.js';

// Control database: the registry only (brands, branches). No order or customer data.
export const CONTROL_MIGRATIONS = [
  `
  CREATE TABLE brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE branches (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    name TEXT NOT NULL,
    area TEXT,
    db_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER
  );
  CREATE INDEX branches_brand ON branches (brand_id);
  `,
  // 2: plans, feature flags, brand owners, payments, audit log (phase 2).
  // Existing branches keep plan_status 'active' with no dates: no expiry until a first payment.
  `
  ALTER TABLE branches ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE branches ADD COLUMN trial_ends_at INTEGER;
  ALTER TABLE branches ADD COLUMN paid_until INTEGER;
  ALTER TABLE branches ADD COLUMN suspended_manual INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE branches ADD COLUMN ff_review INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE branches ADD COLUMN ff_loyalty INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE branches ADD COLUMN ff_promo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE branches ADD COLUMN forced_off TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    pw_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id TEXT NOT NULL REFERENCES branches (id),
    amount_egp INTEGER NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    note TEXT,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    brand_id TEXT,
    branch_id TEXT,
    detail TEXT,
    ip TEXT
  );
  CREATE INDEX audit_at ON audit_log (at);
  `,
  // 3: weekly owner summary bookkeeping (phase 3).
  `
  ALTER TABLE brands ADD COLUMN last_summary_week TEXT;
  `,
  // 4: sealed owner password (vault.js) the super can read back; trash (soft delete).
  //    deleted_reason: 'manual' | 'trial_ended' (automatic) | 'brand' (its brand was trashed).
  `
  ALTER TABLE owners ADD COLUMN password_sealed TEXT;
  ALTER TABLE brands ADD COLUMN deleted_at INTEGER;
  ALTER TABLE branches ADD COLUMN deleted_at INTEGER;
  ALTER TABLE branches ADD COLUMN deleted_reason TEXT;
  `,
  // 5: cashier apps. Per brand: the download password (hash + sealed copy for the dashboards),
  //    the key built into its apps, and the app icon version. One row per installed device.
  `
  ALTER TABLE brands ADD COLUMN app_password_hash TEXT;
  ALTER TABLE brands ADD COLUMN app_password_sealed TEXT;
  ALTER TABLE brands ADD COLUMN app_key TEXT;
  ALTER TABLE brands ADD COLUMN app_icon_at INTEGER;
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    branch_id TEXT NOT NULL REFERENCES branches (id),
    platform TEXT NOT NULL CHECK (platform IN ('android', 'windows')),
    name TEXT NOT NULL,
    model TEXT,
    app_version TEXT,
    pin_fp TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX devices_brand ON devices (brand_id);
  `,
  // 6: error log sent by the cashier apps (page errors, long connection drops). The same
  //    message from the same device within an hour bumps its count instead of adding a row.
  `
  CREATE TABLE device_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('error', 'offline')),
    message TEXT NOT NULL,
    detail TEXT,
    page TEXT,
    app_version TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL
  );
  CREATE INDEX device_errors_brand ON device_errors (brand_id, last_at);
  CREATE INDEX device_errors_device ON device_errors (device_id, last_at);
  `,
  // 7: the public demo café (/demo): page loads and new visitors per local day.
  `
  CREATE TABLE demo_visits (
    day TEXT PRIMARY KEY,
    visits INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0
  );
  `,
  // 8: each branch's timezone (NULL = the server's TZ) and the hour its business day starts.
  `
  ALTER TABLE branches ADD COLUMN tz TEXT;
  ALTER TABLE branches ADD COLUMN day_start_hour INTEGER NOT NULL DEFAULT 0;
  `,
  // 9: the brand owner's phone number (optional, like the email).
  `
  ALTER TABLE owners ADD COLUMN phone TEXT;
  `,
  // 10: the brand's own wording of what customers read (JSON of the changed sentences).
  `
  ALTER TABLE brands ADD COLUMN texts TEXT;
  `,
  // 11: the customers' ring, the brand's choice (JSON { tone, file }; NULL = the default tone).
  `
  ALTER TABLE brands ADD COLUMN ring TEXT;
  `,
  // 12: owner usernames are unique within their brand only (each brand logs in at its own
  //     /brand/<id>), capitals allowed; "Ahmed" and "ahmed" are the same name (NOCASE).
  `
  CREATE TABLE owners_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    username TEXT NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    pw_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER,
    password_sealed TEXT,
    phone TEXT
  );
  INSERT INTO owners_new (id, brand_id, username, email, password_hash, pw_version, created_at, last_login_at, password_sealed, phone)
    SELECT id, brand_id, username, email, password_hash, pw_version, created_at, last_login_at, password_sealed, phone FROM owners;
  DROP TABLE owners;
  ALTER TABLE owners_new RENAME TO owners;
  CREATE UNIQUE INDEX owners_brand_username ON owners (brand_id, username COLLATE NOCASE);
  CREATE INDEX owners_username ON owners (username COLLATE NOCASE);
  `,
  // 13: self-serve accounts (/signup). brands.self_serve: made by its owner, not by the super
  //     (its unpaid branches wait for a payment instead of going to the trash).
  //     owners.branch_id: a branch manager (sees that branch only); NULL = the brand's owner.
  //     branches.awaiting_payment: added after the free trial, works once a payment is recorded.
  //     trials: one free trial per phone and per device, ever (rows survive a deleted account).
  //     billing_requests: an owner's «اشترك» (branches x months), confirmed by the super on payment.
  `
  ALTER TABLE brands ADD COLUMN self_serve INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE owners ADD COLUMN branch_id TEXT;
  ALTER TABLE owners ADD COLUMN name TEXT;
  ALTER TABLE branches ADD COLUMN awaiting_payment INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX owners_phone ON owners (phone);
  CREATE TABLE trials (
    key TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    used_at INTEGER NOT NULL
  );
  CREATE TABLE billing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    branch_ids TEXT NOT NULL,
    months INTEGER NOT NULL,
    amount_egp INTEGER NOT NULL,
    method TEXT NOT NULL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    actor TEXT
  );
  CREATE INDEX billing_requests_status ON billing_requests (status, created_at);
  CREATE INDEX billing_requests_brand ON billing_requests (brand_id, created_at);
  `,
  // 14: the owner's messages to their branches' cashier screens (branch_ids NULL = every branch),
  //     and who read each one on which branch.
  `
  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL REFERENCES brands (id),
    text TEXT NOT NULL,
    branch_ids TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    actor TEXT
  );
  CREATE INDEX announcements_brand ON announcements (brand_id, created_at);
  CREATE TABLE announcement_reads (
    announcement_id INTEGER NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    reader TEXT,
    PRIMARY KEY (announcement_id, branch_id)
  );
  `,
  // 15: the managers' app. owners.disabled_at: an account the super stopped (signed out, can't
  //     sign in). account_requests: «اطلب حساب» from /signup (no account is made). owner_alerts:
  //     what the apps notify (once per dedupe key). push_devices: the iPhones (APNs) and Androids
  //     of owners and managers.
  `
  ALTER TABLE owners ADD COLUMN disabled_at INTEGER;
  CREATE TABLE account_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    branches INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE TABLE owner_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id TEXT NOT NULL,
    branch_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    dedupe TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX owner_alerts_brand ON owner_alerts (brand_id, id);
  CREATE TABLE push_devices (
    token TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    brand_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX push_devices_brand ON push_devices (brand_id);
  `,
];

export const branchDbPath = (brandId, branchId) => `tenants/${brandId}/${branchId}/pager.db`;

export class ControlStore {
  constructor(db) {
    this.db = db;
    const p = (sql) => db.prepare(sql);
    this.sql = {
      brand: p('SELECT * FROM brands WHERE id = ?'),
      brands: p('SELECT * FROM brands ORDER BY created_at'),
      insertBrand: p('INSERT INTO brands (id, name, created_at, self_serve) VALUES (?, ?, ?, ?)'),
      branch: p('SELECT * FROM branches WHERE id = ?'),
      branches: p('SELECT * FROM branches ORDER BY brand_id, created_at'),
      branchIds: p('SELECT id FROM branches ORDER BY id'),
      brandBranches: p('SELECT * FROM branches WHERE brand_id = ? ORDER BY created_at'),
      insertBranch: p(`INSERT INTO branches (id, brand_id, name, area, db_path, created_at, plan_status, trial_ends_at, awaiting_payment)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      rename: p('UPDATE branches SET name = ? WHERE id = ?'),
      touch: p('UPDATE branches SET last_activity_at = ? WHERE id = ?'),
      setTrial: p('UPDATE branches SET trial_ends_at = ? WHERE id = ?'),
      setPaidUntil: p('UPDATE branches SET paid_until = ? WHERE id = ?'),
      restartTrial: p('UPDATE branches SET paid_until = NULL, trial_ends_at = ? WHERE id = ?'),
      setSuspended: p('UPDATE branches SET suspended_manual = ? WHERE id = ?'),
      setForcedOff: p('UPDATE branches SET forced_off = ? WHERE id = ?'),
      setReviewFlag: p('UPDATE branches SET ff_review = ? WHERE id = ?'),
      setLoyaltyFlag: p('UPDATE branches SET ff_loyalty = ? WHERE id = ?'),
      setPromoFlag: p('UPDATE branches SET ff_promo = ? WHERE id = ?'),
      setPlanStatus: p('UPDATE branches SET plan_status = ? WHERE id = ?'),
      owner: p('SELECT * FROM owners WHERE id = ?'),
      ownersByName: p('SELECT * FROM owners WHERE username = ? COLLATE NOCASE ORDER BY id'),
      ownerInBrand: p('SELECT * FROM owners WHERE brand_id = ? AND username = ? COLLATE NOCASE'),
      ownersByPhone: p('SELECT * FROM owners WHERE phone = ? ORDER BY id'),
      brandOwners: p(`SELECT id, brand_id, branch_id, name, username, email, phone, password_sealed, created_at, last_login_at, disabled_at
                      FROM owners WHERE brand_id = ? ORDER BY id`),
      insertOwner: p(`INSERT INTO owners (brand_id, branch_id, name, username, email, phone, password_hash, password_sealed, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      deleteOwner: p('DELETE FROM owners WHERE id = ?'),
      ownerName: p('UPDATE owners SET name = ? WHERE id = ?'),
      trial: p('SELECT * FROM trials WHERE key = ?'),
      insertTrial: p('INSERT OR IGNORE INTO trials (key, brand_id, used_at) VALUES (?, ?, ?)'),
      setAwaiting: p('UPDATE branches SET awaiting_payment = ? WHERE id = ?'),
      insertBilling: p(`INSERT INTO billing_requests (brand_id, branch_ids, months, amount_egp, method, reference, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
      billing: p('SELECT * FROM billing_requests WHERE id = ?'),
      brandBilling: p('SELECT * FROM billing_requests WHERE brand_id = ? ORDER BY id DESC LIMIT 20'),
      pendingBilling: p(`SELECT * FROM billing_requests WHERE status = 'pending' ORDER BY id`),
      decideBilling: p(`UPDATE billing_requests SET status = ?, decided_at = ?, actor = ? WHERE id = ? AND status = 'pending'`),
      ownerContact: p('UPDATE owners SET email = ?, phone = ? WHERE id = ?'),
      resetOwner: p('UPDATE owners SET password_hash = ?, password_sealed = ?, pw_version = pw_version + 1 WHERE id = ?'),
      renameOwner: p('UPDATE owners SET username = ? WHERE id = ?'),
      trashBranch: p('UPDATE branches SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL'),
      restoreBranch: p('UPDATE branches SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?'),
      trashBrand: p('UPDATE brands SET deleted_at = ? WHERE id = ?'),
      trashBrandBranches: p(`UPDATE branches SET deleted_at = ?, deleted_reason = 'brand' WHERE brand_id = ? AND deleted_at IS NULL`),
      restoreBrand: p('UPDATE brands SET deleted_at = NULL WHERE id = ?'),
      restoreBrandBranches: p(`UPDATE branches SET deleted_at = NULL, deleted_reason = NULL WHERE brand_id = ? AND deleted_reason = 'brand'`),
      ownerLogin: p('UPDATE owners SET last_login_at = ? WHERE id = ?'),
      insertPayment: p(`INSERT INTO payments (branch_id, amount_egp, period_start, period_end, note, actor, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
      payments: p('SELECT * FROM payments WHERE branch_id = ? ORDER BY period_end DESC'),
      insertAudit: p('INSERT INTO audit_log (at, actor, action, brand_id, branch_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      audit: p('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'),
      markSummary: p('UPDATE brands SET last_summary_week = ? WHERE id = ?'),
      setAppPassword: p('UPDATE brands SET app_password_hash = ?, app_password_sealed = ? WHERE id = ?'),
      setAppKey: p('UPDATE brands SET app_key = ? WHERE id = ? AND app_key IS NULL'),
      setAppIcon: p('UPDATE brands SET app_icon_at = ? WHERE id = ?'),
      device: p('SELECT * FROM devices WHERE id = ?'),
      brandDevices: p('SELECT * FROM devices WHERE brand_id = ? AND revoked_at IS NULL ORDER BY created_at'),
      insertDevice: p(`INSERT INTO devices (id, brand_id, branch_id, platform, name, model, app_version, pin_fp, created_at, last_seen_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      relinkDevice: p('UPDATE devices SET branch_id = ?, name = ?, model = ?, app_version = ?, pin_fp = ?, last_seen_at = ? WHERE id = ?'),
      seenDevice: p('UPDATE devices SET last_seen_at = ?, app_version = COALESCE(?, app_version), model = COALESCE(?, model) WHERE id = ?'),
      renameDevice: p('UPDATE devices SET name = ? WHERE id = ?'),
      revokeDevice: p('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
      sameError: p(`SELECT id FROM device_errors WHERE device_id = ? AND kind = ? AND message = ? AND last_at > ?
                     ORDER BY id DESC LIMIT 1`),
      bumpError: p('UPDATE device_errors SET count = count + 1, last_at = ?, detail = ?, page = ?, app_version = ? WHERE id = ?'),
      insertError: p(`INSERT INTO device_errors (device_id, brand_id, branch_id, kind, message, detail, page, app_version, first_at, last_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      brandErrors: p('SELECT * FROM device_errors WHERE brand_id = ? ORDER BY last_at DESC LIMIT ?'),
      errorsSince: p(`SELECT brand_id, COUNT(*) AS n, SUM(count) AS total FROM device_errors
                      WHERE last_at > ? AND kind = 'error' GROUP BY brand_id`),
      purgeErrors: p('DELETE FROM device_errors WHERE last_at < ?'),
      downloads: p(`SELECT json_extract(detail, '$.platform') AS platform, COUNT(*) AS n, MAX(at) AS last
                    FROM audit_log WHERE brand_id = ? AND action = 'app.download' GROUP BY 1`),
    };
  }

  ping() {
    return this.db.prepare('SELECT 1 AS ok').get().ok === 1;
  }

  getBrand(id) {
    return this.sql.brand.get(id);
  }

  listBrands() {
    return this.sql.brands.all();
  }

  createBrand({ id, name, createdAt = Date.now(), selfServe = false }) {
    this.sql.insertBrand.run(id, name, createdAt, selfServe ? 1 : 0);
    return this.getBrand(id);
  }

  getBranch(id) {
    return this.sql.branch.get(id);
  }

  listBranches() {
    return this.sql.branches.all();
  }

  branchIds() {
    return this.sql.branchIds.all().map((r) => r.id);
  }

  branchesOfBrand(brandId) {
    return this.sql.brandBranches.all(brandId);
  }

  /**
   * `trialEndsAt` null = no trial (used for branches migrated from v1). `awaitingPayment`: a
   * branch added after the free trial; it stays off until a payment is recorded.
   */
  createBranch({ id, brandId, name, area = null, createdAt = Date.now(), trialEndsAt = null, awaitingPayment = false }) {
    const status = awaitingPayment ? 'suspended' : trialEndsAt == null ? 'active' : 'trial';
    this.sql.insertBranch.run(id, brandId, name, area, branchDbPath(brandId, id), createdAt, status, trialEndsAt, awaitingPayment ? 1 : 0);
    return this.getBranch(id);
  }

  // ---- plans ----

  /** Ends any paid period and puts the branch on a free trial until `at` (payments stay on record). */
  restartTrial(id, at) {
    this.sql.restartTrial.run(at, id);
    this.refreshPlanStatuses();
    return this.getBranch(id);
  }

  setTrialEnd(id, at) {
    this.sql.setTrial.run(at, id);
  }

  setSuspended(id, suspended) {
    this.sql.setSuspended.run(suspended ? 1 : 0, id);
  }

  /** Owner toggle for one feature ('review' | 'loyalty' | 'promo'). */
  setFeature(id, feature, on) {
    const stmt = { review: this.sql.setReviewFlag, loyalty: this.sql.setLoyaltyFlag, promo: this.sql.setPromoFlag }[feature];
    if (!stmt) throw new Error(`unknown feature ${feature}`);
    stmt.run(on ? 1 : 0, id);
  }

  setForcedOff(id, features) {
    this.sql.setForcedOff.run(JSON.stringify([...new Set(features)].sort()), id);
  }

  /** Records a manual payment and moves paid_until forward to the period end (never back). */
  recordPayment(branchId, { amountEgp, periodStart, periodEnd, note = null, actor }) {
    return tx(this.db, () => {
      this.sql.insertPayment.run(branchId, amountEgp, periodStart, periodEnd, note, actor, Date.now());
      const branch = this.getBranch(branchId);
      if (branch.paid_until == null || periodEnd > branch.paid_until) this.sql.setPaidUntil.run(periodEnd, branchId);
      this.sql.setAwaiting.run(0, branchId);
      this.sql.setPlanStatus.run(effectivePlan(this.getBranch(branchId)).status, branchId);
      return this.getBranch(branchId);
    });
  }

  payments(branchId) {
    return this.sql.payments.all(branchId);
  }

  /**
   * Stores the computed status for dashboards (requests always recompute it), and moves
   * branches whose free trial ended unpaid to the trash. Returns the ids it trashed.
   */
  refreshPlanStatuses(now = Date.now()) {
    const trashed = [];
    for (const branch of this.listBranches()) {
      const plan = effectivePlan(branch, now);
      // A self-serve brand's branch waits for its owner to subscribe instead.
      if (!branch.deleted_at && plan.reason === 'trial_ended' && !this.getBrand(branch.brand_id)?.self_serve) {
        this.trashBranch(branch.id, 'trial_ended', now);
        this.audit({ actor: 'system', action: 'branch.trash', brandId: branch.brand_id, branchId: branch.id, detail: { reason: 'trial_ended' } });
        trashed.push(branch.id);
        continue;
      }
      if (plan.status !== branch.plan_status) this.sql.setPlanStatus.run(plan.status, branch.id);
    }
    return trashed;
  }

  // ---- trash (soft delete) ----

  /** A trashed branch keeps all its data; customers can't take numbers until it's restored. */
  trashBranch(id, reason = 'manual', at = Date.now()) {
    this.sql.trashBranch.run(at, reason, id);
    this.sql.setPlanStatus.run('suspended', id);
  }

  restoreBranch(id) {
    this.sql.restoreBranch.run(id);
    const branch = this.getBranch(id);
    this.sql.setPlanStatus.run(effectivePlan(branch).status, id);
    return branch;
  }

  /** Trashing a brand trashes its live branches with it (reason 'brand'); restore brings back those only. */
  trashBrand(id, at = Date.now()) {
    tx(this.db, () => {
      this.sql.trashBrand.run(at, id);
      this.sql.trashBrandBranches.run(at, id);
    });
  }

  restoreBrand(id) {
    tx(this.db, () => {
      this.sql.restoreBrand.run(id);
      this.sql.restoreBrandBranches.run(id);
    });
    this.refreshPlanStatuses();
  }

  // ---- the brand's customer texts ----

  /** The sentences this brand reworded: { key: text }. */
  brandTexts(brandId) {
    try {
      return JSON.parse(this.db.prepare('SELECT texts FROM brands WHERE id = ?').get(brandId)?.texts || '{}');
    } catch {
      return {};
    }
  }

  setBrandTexts(brandId, texts) {
    this.db.prepare('UPDATE brands SET texts = ? WHERE id = ?').run(Object.keys(texts).length ? JSON.stringify(texts) : null, brandId);
    return this.brandTexts(brandId);
  }

  // ---- the customers' ring ----

  /** { tone, file } (file: the brand's own sound, or null), or null for the default. */
  brandRing(brandId) {
    try {
      return JSON.parse(this.db.prepare('SELECT ring FROM brands WHERE id = ?').get(brandId)?.ring || 'null');
    } catch {
      return null;
    }
  }

  setBrandRing(brandId, ring) {
    this.db.prepare('UPDATE brands SET ring = ? WHERE id = ?').run(ring ? JSON.stringify(ring) : null, brandId);
    return this.brandRing(brandId);
  }

  // ---- owners ----

  getOwner(id) {
    return this.sql.owner.get(id);
  }

  /** Every brand's owner by this name (the same name may be used in several brands). */
  ownersByUsername(username) {
    return this.sql.ownersByName.all(username);
  }

  /** This brand's owner by this name, capitals or not. */
  ownerInBrand(brandId, username) {
    return this.sql.ownerInBrand.get(brandId, username);
  }

  ownersOfBrand(brandId) {
    return this.sql.brandOwners.all(brandId);
  }

  /** `branchId` set = a branch manager (that branch only); null = the brand's owner. */
  createOwner({ brandId, branchId = null, name = null, username, email = null, phone = null, passwordHash, passwordSealed = null }) {
    const res = this.sql.insertOwner.run(brandId, branchId, name, username, email, phone, passwordHash, passwordSealed, Date.now());
    return this.getOwner(Number(res.lastInsertRowid));
  }

  /** Owners and managers with this phone (digits as stored), any brand. */
  ownersByPhone(phone) {
    return phone ? this.sql.ownersByPhone.all(phone) : [];
  }

  deleteOwner(id) {
    this.sql.deleteOwner.run(id);
  }

  setOwnerName(id, name) {
    this.sql.ownerName.run(name, id);
    return this.getOwner(id);
  }

  // ---- the managers' app: stopped accounts, requests, alerts, phones to notify ----

  setOwnerDisabled(id, disabled, at = Date.now()) {
    this.db.prepare('UPDATE owners SET disabled_at = ? WHERE id = ?').run(disabled ? at : null, id);
    if (disabled) this.db.prepare('DELETE FROM push_devices WHERE owner_id = ?').run(id);
    return this.getOwner(id);
  }

  createAccountRequest({ name, phone, brandName, branches = 1, note = null, at = Date.now() }) {
    const res = this.db.prepare(`INSERT INTO account_requests (name, phone, brand_name, branches, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(name, phone, brandName, branches, note, at);
    return Number(res.lastInsertRowid);
  }

  openAccountRequests() {
    return this.db.prepare('SELECT * FROM account_requests WHERE closed_at IS NULL ORDER BY id').all();
  }

  closeAccountRequest(id, at = Date.now()) {
    return this.db.prepare('UPDATE account_requests SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(at, id).changes === 1;
  }

  /** A new alert, or null when this dedupe key was raised before. */
  addAlert({ brandId, branchId = null, kind, title, body, dedupe, at = Date.now() }) {
    const res = this.db.prepare(`INSERT OR IGNORE INTO owner_alerts (brand_id, branch_id, kind, title, body, dedupe, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(brandId, branchId, kind, title, body, dedupe, at);
    return res.changes ? this.db.prepare('SELECT * FROM owner_alerts WHERE id = ?').get(Number(res.lastInsertRowid)) : null;
  }

  /** The latest alerts of a brand (or of one branch, for its manager), newest first. */
  alertsFor(brandId, branchId = null, { limit = 50, afterId = 0 } = {}) {
    return branchId
      ? this.db.prepare('SELECT * FROM owner_alerts WHERE brand_id = ? AND (branch_id = ? OR branch_id IS NULL) AND id > ? ORDER BY id DESC LIMIT ?')
        .all(brandId, branchId, afterId, limit)
      : this.db.prepare('SELECT * FROM owner_alerts WHERE brand_id = ? AND id > ? ORDER BY id DESC LIMIT ?').all(brandId, afterId, limit);
  }

  savePushDevice({ token, ownerId, brandId, platform, at = Date.now() }) {
    this.db.prepare(`INSERT INTO push_devices (token, owner_id, brand_id, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (token) DO UPDATE SET owner_id = excluded.owner_id, brand_id = excluded.brand_id, platform = excluded.platform,
        last_seen_at = excluded.last_seen_at`).run(token, ownerId, brandId, platform, at, at);
  }

  pushDevicesOfBrand(brandId) {
    return this.db.prepare('SELECT * FROM push_devices WHERE brand_id = ?').all(brandId);
  }

  dropPushDevice(token) {
    this.db.prepare('DELETE FROM push_devices WHERE token = ?').run(token);
  }

  // ---- the owner's messages to the cashier screens ----

  createAnnouncement({ brandId, text, branchIds = null, days = 3, actor = null, at = Date.now() }) {
    const res = this.db.prepare(`INSERT INTO announcements (brand_id, text, branch_ids, created_at, expires_at, actor)
      VALUES (?, ?, ?, ?, ?, ?)`).run(brandId, text, branchIds ? JSON.stringify(branchIds) : null, at, at + days * 86_400_000, actor);
    return Number(res.lastInsertRowid);
  }

  /** The brand's latest messages with who read them: [{ id, text, branchIds, createdAt, expiresAt, reads: {branch: at} }]. */
  announcementsOfBrand(brandId, limit = 20) {
    const rows = this.db.prepare('SELECT * FROM announcements WHERE brand_id = ? ORDER BY id DESC LIMIT ?').all(brandId, limit);
    const reads = this.db.prepare('SELECT branch_id, read_at, reader FROM announcement_reads WHERE announcement_id = ?');
    return rows.map((r) => ({
      id: r.id, text: r.text, branchIds: r.branch_ids ? JSON.parse(r.branch_ids) : null, createdAt: r.created_at, expiresAt: r.expires_at,
      reads: Object.fromEntries(reads.all(r.id).map((x) => [x.branch_id, { at: x.read_at, by: x.reader }])),
    }));
  }

  /** Unread, unexpired messages for one branch's cashier screen. */
  announcementsForBranch(branchId, now = Date.now()) {
    const branch = this.getBranch(branchId);
    if (!branch) return [];
    return this.db.prepare(`SELECT a.* FROM announcements a
      WHERE a.brand_id = ? AND a.expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.branch_id = ?)
      ORDER BY a.id`).all(branch.brand_id, now, branchId)
      .filter((a) => !a.branch_ids || JSON.parse(a.branch_ids).includes(branchId))
      .map((a) => ({ id: a.id, text: a.text, createdAt: a.created_at }));
  }

  markAnnouncementRead(id, branchId, reader = null, at = Date.now()) {
    this.db.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, branch_id, read_at, reader) VALUES (?, ?, ?, ?)')
      .run(id, branchId, at, reader);
  }

  deleteAnnouncement(id, brandId) {
    this.db.prepare('DELETE FROM announcement_reads WHERE announcement_id IN (SELECT id FROM announcements WHERE id = ? AND brand_id = ?)').run(id, brandId);
    this.db.prepare('DELETE FROM announcements WHERE id = ? AND brand_id = ?').run(id, brandId);
  }

  // ---- free trials: once per phone and per device, ever ----

  trialUsed(keys) {
    return keys.some((k) => k && this.sql.trial.get(k));
  }

  markTrialUsed(keys, brandId, at = Date.now()) {
    for (const k of keys) if (k) this.sql.insertTrial.run(k, brandId, at);
  }

  // ---- billing requests: the owner's «اشترك»; the super confirms once the money arrives ----

  createBillingRequest({ brandId, branchIds, months, amountEgp, method, reference = null, at = Date.now() }) {
    const res = this.sql.insertBilling.run(brandId, JSON.stringify(branchIds), months, amountEgp, method, reference, at);
    return this.getBillingRequest(Number(res.lastInsertRowid));
  }

  getBillingRequest(id) {
    const row = this.sql.billing.get(id);
    return row ? { ...row, branch_ids: JSON.parse(row.branch_ids) } : null;
  }

  billingRequestsOfBrand(brandId) {
    return this.sql.brandBilling.all(brandId).map((r) => ({ ...r, branch_ids: JSON.parse(r.branch_ids) }));
  }

  pendingBillingRequests() {
    return this.sql.pendingBilling.all().map((r) => ({ ...r, branch_ids: JSON.parse(r.branch_ids) }));
  }

  /** 'paid' | 'cancelled'; false when it was already decided. */
  decideBillingRequest(id, status, actor, at = Date.now()) {
    return this.sql.decideBilling.run(status, at, actor, id).changes === 1;
  }

  /** Email and phone, both optional (null clears). */
  setOwnerContact(id, { email = null, phone = null }) {
    this.sql.ownerContact.run(email, phone, id);
    return this.getOwner(id);
  }

  /** New password; bumping pw_version signs every existing owner session out. */
  resetOwnerPassword(id, { passwordHash, passwordSealed = null }) {
    this.sql.resetOwner.run(passwordHash, passwordSealed, id);
    return this.getOwner(id);
  }

  /** Username only: sessions stay valid (they are bound to the owner id and password version). */
  renameOwner(id, username) {
    this.sql.renameOwner.run(username, id);
    return this.getOwner(id);
  }

  markOwnerLogin(id) {
    this.sql.ownerLogin.run(Date.now(), id);
  }

  markSummarySent(brandId, week) {
    this.sql.markSummary.run(week, brandId);
  }

  // ---- cashier apps ----

  setAppPassword(brandId, { passwordHash, passwordSealed }) {
    this.sql.setAppPassword.run(passwordHash, passwordSealed, brandId);
  }

  /** The brand's app key, created once (it is built into every app the brand downloads). */
  ensureAppKey(brandId, newKey) {
    this.sql.setAppKey.run(newKey, brandId);
    return this.getBrand(brandId).app_key;
  }

  setAppIcon(brandId, at) {
    this.sql.setAppIcon.run(at, brandId);
  }

  getDevice(id) {
    return this.sql.device.get(id);
  }

  devicesOfBrand(brandId) {
    return this.sql.brandDevices.all(brandId);
  }

  createDevice({ id, brandId, branchId, platform, name, model = null, version = null, pinFp, at = Date.now() }) {
    this.sql.insertDevice.run(id, brandId, branchId, platform, name, model, version, pinFp, at, at);
    return this.getDevice(id);
  }

  relinkDevice(id, { branchId, name, model = null, version = null, pinFp, at = Date.now() }) {
    this.sql.relinkDevice.run(branchId, name, model, version, pinFp, at, id);
    return this.getDevice(id);
  }

  touchDevice(id, { version = null, model = null, at = Date.now() } = {}) {
    this.sql.seenDevice.run(at, version, model, id);
  }

  renameDevice(id, name) {
    this.sql.renameDevice.run(name, id);
  }

  revokeDevice(id, at = Date.now()) {
    this.sql.revokeDevice.run(at, id);
  }

  /** One error from a device; the same message within an hour only bumps its count. */
  recordDeviceError(device, { kind, message, detail = null, page = null, at = Date.now() }) {
    const same = this.sql.sameError.get(device.id, kind, message, at - 3_600_000);
    if (same) this.sql.bumpError.run(at, detail, page, device.app_version, same.id);
    else {
      this.sql.insertError.run(device.id, device.brand_id, device.branch_id, kind, message, detail, page, device.app_version, at, at);
    }
  }

  deviceErrors(brandId, limit = 100) {
    return this.sql.brandErrors.all(brandId, limit);
  }

  /** { brandId: { rows, total } } of page errors (not connection drops) since `since`. */
  errorCountsSince(since) {
    return Object.fromEntries(this.sql.errorsSince.all(since).map((r) => [r.brand_id, { rows: Number(r.n), total: Number(r.total) }]));
  }

  /** Error log retention: 30 days. */
  purgeDeviceErrors(before) {
    this.sql.purgeErrors.run(before);
  }

  /** { android: { count, last }, windows: {...} } from the audit log. */
  appDownloads(brandId) {
    const out = { android: { count: 0, last: null }, windows: { count: 0, last: null } };
    for (const r of this.sql.downloads.all(brandId)) if (out[r.platform]) out[r.platform] = { count: Number(r.n), last: r.last };
    return out;
  }

  // ---- audit ----

  audit({ actor, action, brandId = null, branchId = null, detail = null, ip = null }) {
    this.sql.insertAudit.run(Date.now(), actor, action, brandId, branchId, detail == null ? null : JSON.stringify(detail), ip);
  }

  auditLog(limit = 100) {
    return this.sql.audit.all(limit).map((row) => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
  }

  renameBranch(id, name) {
    this.sql.rename.run(name, id);
  }

  setBranchTz(id, tz) {
    this.db.prepare('UPDATE branches SET tz = ? WHERE id = ?').run(tz, id);
  }

  setDayStart(id, hour) {
    this.db.prepare('UPDATE branches SET day_start_hour = ? WHERE id = ?').run(hour, id);
  }

  // ---- demo café ----

  recordDemoVisit(day, { newVisitor }) {
    this.db.prepare(`INSERT INTO demo_visits (day, visits, visitors) VALUES (?, 1, ?)
                     ON CONFLICT (day) DO UPDATE SET visits = visits + 1, visitors = visitors + excluded.visitors`)
      .run(day, newVisitor ? 1 : 0);
  }

  /** { today: {visits, visitors}, total: {visits, visitors} } */
  demoVisits(day) {
    const today = this.db.prepare('SELECT visits, visitors FROM demo_visits WHERE day = ?').get(day);
    const total = this.db.prepare('SELECT SUM(visits) AS visits, SUM(visitors) AS visitors FROM demo_visits').get();
    return {
      today: { visits: today?.visits ?? 0, visitors: today?.visitors ?? 0 },
      total: { visits: Number(total?.visits ?? 0), visitors: Number(total?.visitors ?? 0) },
    };
  }

  /**
   * Removes a brand and everything of it from this database: its branches, owners, payments,
   * devices. Only for the demo's visitor cafés (real brands go to the trash instead).
   */
  purgeBrand(id) {
    this.db.exec('BEGIN');
    try {
      for (const sql of [
        'DELETE FROM device_errors WHERE brand_id = ?',
        'DELETE FROM devices WHERE brand_id = ?',
        'DELETE FROM payments WHERE branch_id IN (SELECT id FROM branches WHERE brand_id = ?)',
        'DELETE FROM billing_requests WHERE brand_id = ?',
        'DELETE FROM announcement_reads WHERE announcement_id IN (SELECT id FROM announcements WHERE brand_id = ?)',
        'DELETE FROM announcements WHERE brand_id = ?',
        'DELETE FROM owner_alerts WHERE brand_id = ?',
        'DELETE FROM push_devices WHERE brand_id = ?',
        'DELETE FROM owners WHERE brand_id = ?',
        'DELETE FROM branches WHERE brand_id = ?',
        'DELETE FROM brands WHERE id = ?',
      ]) this.db.prepare(sql).run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  touch(id, at = Date.now()) {
    this.sql.touch.run(at, id);
  }

  close() {
    this.db.close();
  }
}

export function openControl(file, { backupFile } = {}) {
  const db = new DatabaseSync(file);
  db.exec(PRAGMAS);
  runMigrations(db, CONTROL_MIGRATIONS, { backupFile });
  return new ControlStore(db);
}
