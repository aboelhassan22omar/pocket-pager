import crypto from 'node:crypto';
import { passwordFields, pinFields } from './auth.js';
import { dayIn, startOfDayIn } from './util.js';

// The public demo café (/demo). Every visitor of the ad link gets a café of their own (a
// "sandbox": its own brand, branch and owner, id dm-<12>), so two people trying it at the same
// time never see each other's numbers, orders or rings. It is created on the first visit, kept
// by a cookie, has two weeks of sample orders for the owner dashboard, can't be reconfigured
// (see DEMO_LOCKED), and is removed a day after its visitor last used it. It looks like any
// new branch: the default colors. The old shared café (id "demo") is left as it was.

export const DEMO_ID = 'demo';
export const DEMO_NAME = 'كافيه الديمو';
export const DEMO_PREFIX = 'dm-';
const SANDBOX_RE = /^dm-[a-z0-9]{12}$/;
// Removed this long after its visitor last opened it or took a number.
export const SANDBOX_IDLE_MS = 24 * 3600 * 1000;
// More than this at once: the oldest go first (a flood of visits can't fill the disk).
const SANDBOX_MAX = 400;
const SEED_DAYS = 14;
const SEED_PREFIX = 'seed-';
export const DEMO_LOCKED = 'دي نسخة الديمو: الإعدادات مقفولة هنا، وبتتغيّر عادي في النسخة بتاعتك';

/** The shared demo café or a visitor's own one: settings locked, never billed or alerted. */
export const isDemo = (id) => typeof id === 'string' && (id === DEMO_ID || id.startsWith(DEMO_PREFIX));
export const isSandbox = (id) => typeof id === 'string' && SANDBOX_RE.test(id);

function newSandboxId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = DEMO_PREFIX;
  for (let i = 0; i < 12; i++) id += chars[crypto.randomInt(chars.length)];
  return id;
}

function ready({ control, tenants }, id) {
  const ctx = tenants.get(id);
  const first = control.ownersOfBrand(id)[0];
  const owner = first && control.getOwner(first.id); // the full row (session version)
  return ctx?.store.getShop() && owner ? { id, ctx, owner } : null;
}

/** The visitor's own café (`wanted`, from their cookie), or a new one. */
export async function ensureDemo(deps, wanted = null) {
  if (isSandbox(wanted)) {
    const found = ready(deps, wanted);
    if (found) {
      deps.control.touch(wanted);
      return found;
    }
  }
  const id = newSandboxId();
  await create(deps, id);
  topUpDemo(deps, Date.now(), id);
  deps.control.touch(id);
  purgeSandboxes(deps);
  return ready(deps, id);
}

async function create({ control, tenants, config }, id) {
  control.createBrand({ id, name: DEMO_NAME });
  // No trial and no paid_until: active with no end date.
  control.createBranch({ id, brandId: id, name: DEMO_NAME, area: 'تجربة' });
  for (const feature of ['review', 'loyalty', 'promo']) control.setFeature(id, feature, true);
  const ctx = tenants.get(id);
  const pin = String(crypto.randomInt(100000, 1000000));
  const cols = await pinFields(config.cookieSecret, pin);
  ctx.store.initSettings({ pinHash: cols.pin_hash, pinSealed: cols.pin_sealed, qrMode: 'both' });
  ctx.store.updateShop({
    theme_version: 1, // the default colors, and no color read from a logo
    expire_hours: 1,
    preparing_message: 'طلبك بيتحضّر دلوقتي. هنرن عليك أول ما يجهز',
    ready_message: 'طلبك جاهز، اتفضّل استلمه من الكاشير',
    loyalty_every: 5,
    loyalty_reward_text: 'مشروب ببلاش',
    promo_text: 'خصم ١٠٪ على أي حلو مع القهوة النهارده',
  });
  const fields = await passwordFields(config.cookieSecret, crypto.randomBytes(9).toString('base64url'));
  control.createOwner({ brandId: id, username: id, ...fields });
}

/**
 * Removes the visitors' cafés nobody used for a day, and the oldest beyond SANDBOX_MAX.
 * Returns how many went.
 */
export function purgeSandboxes({ control, tenants }, now = Date.now()) {
  const sandboxes = control.listBranches()
    .filter((b) => isSandbox(b.id))
    .map((b) => ({ id: b.id, last: b.last_activity_at ?? b.created_at }))
    .sort((a, b) => b.last - a.last);
  const gone = sandboxes.filter((s, i) => now - s.last > SANDBOX_IDLE_MS || i >= SANDBOX_MAX);
  for (const s of gone) {
    tenants.drop(s.id, s.id);
    control.purgeBrand(s.id);
  }
  return gone.length;
}

/** How many visitors' cafés exist now (the super's demo line). */
export const sandboxCount = (control) => control.listBranches().filter((b) => isSandbox(b.id)).length;

// ---------------------------------------------------------------------------
// Sample history: closed orders and ratings for each of the last SEED_DAYS days.
// Deterministic per day, and only added for days that don't have it yet.
// ---------------------------------------------------------------------------

function rng(seedText) {
  let a = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Relative traffic per local hour: a morning coffee rush, lunch, and a busy evening.
const HOUR_WEIGHT = [0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 7, 5, 4, 5, 6, 4, 3, 4, 6, 8, 9, 8, 5, 2];
const COMMENTS = {
  5: ['القهوة تحفة والرقم رن أول ما الطلب جهز', 'سريعين جدًا', null, null, null],
  4: ['حلو، بس الزحمة كانت كتير', null, null],
  3: ['الطلب اتأخر شوية', null],
  2: ['استنيت كتير النهارده'],
};

function seedDay(store, day, dayStart) {
  const rand = rng(`demo|${day}`);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const busy = weekday === 4 || weekday === 5 ? 1.35 : 1; // Thursday/Friday nights
  const total = Math.round((45 + rand() * 30) * busy);
  const weightSum = HOUR_WEIGHT.reduce((s, w) => s + w, 0);
  const orders = [];
  for (let i = 0; i < total; i++) {
    let pick = rand() * weightSum;
    let hour = 0;
    while (pick > HOUR_WEIGHT[hour]) pick -= HOUR_WEIGHT[hour++];
    const createdAt = dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000);
    orders.push(createdAt);
  }
  orders.sort((a, b) => a - b);

  const insert = store.db.prepare(`INSERT OR IGNORE INTO orders (id, number, status, created_at, ready_at, closed_at, notify_count)
                                   VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const feedback = store.db.prepare('INSERT OR IGNORE INTO feedback (order_id, rating, comment, created_at) VALUES (?, ?, ?, ?)');
  orders.forEach((createdAt, i) => {
    const id = `${SEED_PREFIX}${day}-${String(i + 1).padStart(4, '0')}`;
    const roll = rand();
    if (roll < 0.04) {
      insert.run(id, i + 1, 'cancelled', createdAt, null, createdAt + 120_000, 0);
      return;
    }
    // Prep 3-9 minutes, with a slow tail at rush hour that makes some orders late.
    const prep = (3 + rand() * 6 + (rand() < 0.12 ? 4 + rand() * 6 : 0)) * 60_000;
    const readyAt = createdAt + Math.round(prep);
    const pickedAt = readyAt + Math.round((0.4 + rand() * 2.5) * 60_000);
    insert.run(id, i + 1, 'picked', createdAt, readyAt, pickedAt, rand() < 0.15 ? 2 : 1);
    if (rand() < 0.18) {
      const r = rand();
      const rating = r < 0.62 ? 5 : r < 0.88 ? 4 : r < 0.96 ? 3 : 2;
      const options = COMMENTS[rating];
      feedback.run(id, rating, options[Math.floor(rand() * options.length)], pickedAt + 60_000);
    }
  });
  return orders.length ? orders[0] : null;
}

/** Adds the sample history for any of the last SEED_DAYS days that lack it (cheap when done). */
export function topUpDemo({ tenants, config }, now = Date.now(), id = DEMO_ID) {
  const ctx = tenants.get(id);
  if (!ctx?.store.getShop()) return 0;
  const { db } = ctx.store;
  const has = db.prepare('SELECT 1 FROM orders WHERE id = ?');
  let earliest = null;
  let added = 0;
  db.exec('BEGIN');
  try {
    // Past days only: today's numbers are the visitors' own orders.
    for (let d = SEED_DAYS; d >= 1; d--) {
      const dayStart = startOfDayIn(config.tz, now - d * 86_400_000);
      const day = dayIn(config.tz, new Date(dayStart + 12 * 3_600_000));
      if (has.get(`${SEED_PREFIX}${day}-0001`)) continue;
      const first = seedDay(ctx.store, day, dayStart);
      if (first != null) {
        earliest = earliest == null ? first : Math.min(earliest, first);
        added++;
      }
    }
    // Let the hourly rollups pick the new (past) orders up.
    if (earliest != null) {
      const cursor = Number(db.prepare("SELECT value FROM meta WHERE key = 'rollup_at'").get()?.value ?? 0);
      if (cursor >= earliest) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('rollup_at', ?)").run(String(earliest - 1));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
}
