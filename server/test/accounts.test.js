import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { hashPin } from '../src/auth.js';
import { accountPhone, cleanSlug } from '../src/routes/account.js';
import { monthlyTotal, quote, TIERS } from '../public/js/pricing.js';
import { client, startServer } from './helpers.js';

const SUPER_PASSWORD = 'super-secret-pass';

const signupBody = (over = {}) => ({
  name: 'أحمد علي', phone: '01011112222', password: 'secret1', brandName: 'كافيه زد', brandId: 'cafe-z', branchName: 'المعادي', branchSlug: 'maadi', ...over,
});

describe('pricing', () => {
  test('2,500 for one branch, 1,500 from 100, never below; adding a branch never lowers the bill', () => {
    assert.equal(quote(1).perBranch, 2500);
    assert.equal(quote(100).perBranch, 1500);
    assert.equal(quote(400).perBranch, 1500);
    let prev = 0;
    for (let n = 1; n <= 200; n++) {
      const total = monthlyTotal(n);
      assert.ok(total >= prev, `total for ${n} drops`);
      assert.ok(total / n >= 1500, `below the floor at ${n}`);
      prev = total;
    }
    assert.equal(quote(3, 6).total, 3 * 2300 * 6);
    assert.equal(quote(3, 5).months, 1, 'only the offered durations');
    assert.deepEqual(TIERS[0], [1, 2500]);
  });
});

describe('account inputs', () => {
  test('phones as typed; link names are small English', () => {
    assert.equal(accountPhone('٠١٠ ١١١١ ٢٢٢٢'), '201011112222');
    assert.equal(accountPhone('+966 50 123 4567'), '966501234567');
    assert.throws(() => accountPhone('123'), (e) => e.status === 400);
    assert.equal(cleanSlug('Cafe-Z', 'x'), 'cafe-z');
    for (const bad of ['a', 'كافيه', 'has space', '-x-', 'demo', 'super']) assert.throws(() => cleanSlug(bad, 'x'), bad);
  });
});

describe('self-serve sign-up, login, trial once, managers, billing', () => {
  let server;
  let su;
  before(async () => {
    server = await startServer({ SUPER_PASSWORD_HASH: await hashPin(SUPER_PASSWORD), PAY_INSTAPAY: 'pocket@instapay', PAY_WALLET: 'off' });
    su = client(server.url);
    await su.post('/api/super/login', { password: SUPER_PASSWORD });
  });
  after(() => server?.stop());

  let owner;
  let pin;
  test('help on WhatsApp in international form, for wa.me', async () => {
    const info = (await client(server.url).get('/api/signup/info')).data;
    assert.equal(info.support, '201043833456');
  });

  test('sign-up makes the brand, the first branch on a 3-day trial, and signs the owner in', async () => {
    owner = client(server.url);
    assert.deepEqual((await owner.get('/api/signup/check?brand=cafe-z')).data.brand.ok, true);
    const res = await owner.post('/api/signup', signupBody());
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.branchId, 'cafe-z-maadi');
    assert.equal(res.data.trial, true);
    assert.match(res.data.pin, /^\d{4}$/);
    pin = res.data.pin;
    assert.equal(res.data.urls.customer, `${server.url}/s/cafe-z-maadi`);
    assert.equal((await owner.get('/api/signup/check?brand=cafe-z')).data.brand.ok, false);

    const ov = await owner.get('/api/brand/cafe-z/overview');
    assert.equal(ov.status, 200);
    assert.equal(ov.data.brand.selfServe, true);
    assert.equal(ov.data.owner.role, 'owner');
    const [b] = ov.data.branches;
    assert.equal(b.plan.status, 'trial');
    assert.equal(b.pin, pin, 'the owner sees the cashier PIN');
    assert.equal(b.delivery, true, 'delivery on by default');
    assert.equal(b.manualNumbers, true, 'the takeaway receipt box on by default');

    // The cashier signs in with that PIN.
    const bar = client(server.url);
    assert.equal((await bar.post('/api/bar/login', { shopId: 'cafe-z-maadi', pin })).status, 200);
  });

  test('the phone and the link name are taken once', async () => {
    const again = await client(server.url).post('/api/signup', signupBody({ brandId: 'cafe-y', branchSlug: '' }));
    assert.equal(again.status, 409);
    assert.equal(again.data.field, 'phone');
    const taken = await client(server.url).post('/api/signup', signupBody({ phone: '01033334444' }));
    assert.equal(taken.status, 409);
    assert.equal(taken.data.field, 'brandId');
  });

  test('the same device gets no second trial', async () => {
    // owner's jar holds the trial cookie: a second account from it starts unpaid.
    const second = client(server.url);
    second.jar.set('sp_tr', owner.jar.get('sp_tr'));
    const res = await second.post('/api/signup', signupBody({ phone: '01055556666', brandId: 'cafe-w', branchSlug: '' }));
    assert.equal(res.status, 201);
    assert.equal(res.data.trial, false);
    assert.equal(res.data.branchId, 'cafe-w');
    const ov = await second.get('/api/brand/cafe-w/overview');
    assert.equal(ov.status, 200, 'a stopped self-serve brand still opens, to subscribe');
    assert.equal(ov.data.stopped, 'awaiting_payment');
    const claim = await client(server.url).get('/api/b/cafe-w');
    assert.ok([200, 402].includes(claim.status));
  });

  test('login by phone (any way it is typed) and password', async () => {
    const c = client(server.url);
    assert.equal((await c.post('/api/login', { login: '٠١٠١١١١٢٢٢٢', password: 'nope' })).status, 401);
    const ok = await c.post('/api/login', { login: '+20 101 111 2222', password: 'secret1' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.to, '/brand/cafe-z');
    assert.equal((await c.get('/api/brand/cafe-z/overview')).status, 200);
  });

  test('a new branch is ready at once and waits for the subscription', async () => {
    const res = await owner.post('/api/brand/cafe-z/branches', { name: 'الزمالك', slug: 'zamalek' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.branchId, 'cafe-z-zamalek');
    const ov = await owner.get('/api/brand/cafe-z/overview');
    const z = ov.data.branches.find((b) => b.id === 'cafe-z-zamalek');
    assert.equal(z.plan.status, 'suspended');
    assert.equal(z.plan.reason, 'awaiting_payment');
    assert.equal(ov.data.stopped, null, 'the first branch still works');
  });

  let managerPassword;
  test('a branch manager sees their branch only', async () => {
    const res = await owner.post('/api/brand/cafe-z/managers', { name: 'سارة', phone: '01077778888', branchId: 'cafe-z-maadi' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    managerPassword = res.data.manager.password;
    assert.ok(managerPassword);

    const m = client(server.url);
    const login = await m.post('/api/login', { login: '01077778888', password: managerPassword });
    assert.equal(login.data.manager, true);
    const ov = await m.get('/api/brand/cafe-z/overview');
    assert.deepEqual(ov.data.branches.map((b) => b.id), ['cafe-z-maadi']);
    assert.equal(ov.data.owner.role, 'manager');
    assert.equal((await m.get('/api/brand/cafe-z/branches/cafe-z-zamalek/drivers')).status, 404);
    assert.equal((await m.get('/api/brand/cafe-z/branches/cafe-z-maadi/drivers')).status, 200);
    const report = await m.get('/api/brand/cafe-z/analytics?from=2026-01-01&to=2026-01-02&branch=cafe-z-zamalek');
    assert.equal(report.status, 200);
    assert.deepEqual(report.data.branches.map((b) => b.id), ['cafe-z-maadi'], 'their branch, whatever was asked');
    for (const [path, body] of [
      ['/api/brand/cafe-z/branches', { name: 'x', slug: 'xx' }],
      ['/api/brand/cafe-z/managers', { name: 'x', phone: '01000000000', branchId: 'cafe-z-maadi' }],
      ['/api/brand/cafe-z/billing', { months: 1 }],
      ['/api/brand/cafe-z/texts', { texts: {} }],
      ['/api/brand/cafe-z/account/delete', { password: managerPassword }],
      ['/api/brand/cafe-z/branches/cafe-z-maadi/settings', { name: 'غيره' }],
    ]) assert.equal((await m.post(path, body)).status, 403, path);
    assert.equal((await m.get('/api/brand/cafe-z/billing')).status, 403);
    // The manager can change their branch's PIN.
    assert.equal((await m.post('/api/brand/cafe-z/branches/cafe-z-maadi/pin', { pin: '9876' })).status, 200);
    // Deleting the manager signs them out.
    const list = (await owner.get('/api/brand/cafe-z/managers')).data.managers;
    await owner.post(`/api/brand/cafe-z/managers/${list[0].id}/delete`);
    assert.equal((await m.get('/api/brand/cafe-z/overview')).status, 401);
  });

  test('«اشترك» asks for every branch × months; the super confirms and the branches work', async () => {
    const bill = await owner.get('/api/brand/cafe-z/billing');
    assert.equal(bill.data.branches.length, 2);
    assert.deepEqual(bill.data.methods, [{ id: 'instapay', value: 'pocket@instapay' }, { id: 'whatsapp', value: '01043833456' }]);
    const q3 = bill.data.quotes.find((q) => q.months === 3);
    assert.equal(q3.total, 2 * 2300 * 3);

    const req = await owner.post('/api/brand/cafe-z/billing', { months: 3, method: 'instapay', reference: 'TX-1' });
    assert.equal(req.status, 201);
    assert.equal((await owner.post('/api/brand/cafe-z/billing', { months: 1 })).status, 409, 'one request at a time');

    const ov = await su.get('/api/super/overview');
    const pending = ov.data.billing.find((r) => r.brandId === 'cafe-z');
    assert.equal(pending.amount, 13800);
    assert.equal(pending.phone, '201011112222');
    const done = await su.post(`/api/super/billing/${pending.id}/confirm`);
    assert.equal(done.status, 200);
    assert.equal(done.data.billing.some((r) => r.id === pending.id), false);

    const after = await owner.get('/api/brand/cafe-z/overview');
    for (const b of after.data.branches) assert.equal(b.plan.status, 'active', b.id);
    const maadi = after.data.branches.find((b) => b.id === 'cafe-z-maadi');
    // Paid from the end of the running trial: 3 x 30 days after it.
    assert.ok(maadi.paidUntil > maadi.trialEndsAt + 89 * 86_400_000);
  });

  test('closing the account stops everything and signs out', async () => {
    const c = client(server.url);
    await c.post('/api/login', { login: '01055556666', password: 'secret1' });
    assert.equal((await c.post('/api/brand/cafe-w/account/delete', { password: 'wrong' })).status, 400);
    assert.equal((await c.post('/api/brand/cafe-w/account/delete', { password: 'secret1' })).status, 200);
    assert.equal((await c.get('/api/brand/cafe-w/overview')).status, 401);
    assert.equal((await c.post('/api/login', { login: '01055556666', password: 'secret1' })).status, 403);
    // The phone can sign up again, without a second trial.
    const again = await client(server.url).post('/api/signup', signupBody({ phone: '01055556666', brandId: 'cafe-v', branchSlug: '' }));
    assert.equal(again.status, 201);
    assert.equal(again.data.trial, false);
  });
});
