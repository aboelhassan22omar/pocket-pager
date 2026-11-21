// The App Store / Google Play review account: brand «كافيه بوكيت» (review-cafe) with two
// branches, a few weeks of realistic orders and some open right now, an owner and a branch
// manager. Made on start and kept as it should be every hour: if a reviewer stops it, signs it
// out or closes the account, it comes back by itself. Its numbers are written in the store notes.

import { passwordFields, pinFields, verifyPin } from './auth.js';
import { topUpDemo } from './demo.js';
import { NEW_BRANCH_DEFAULTS } from './provision.js';

export const REVIEW_BRAND = 'review-cafe';
export const REVIEW_OWNER = { username: '01099990001', phone: '201099990001', name: 'حساب المراجعة' };
export const REVIEW_MANAGER = { username: '01099990002', phone: '201099990002', name: 'مدير فرع المعادي' };
const BRANCHES = [
  { id: 'review-cafe-maadi', name: 'المعادي' },
  { id: 'review-cafe-zamalek', name: 'الزمالك' },
];
const OPEN_NOW = 3;

async function ensureAccount(deps, { username, phone, name }, branchId = null) {
  const { control, config } = deps;
  let account = control.ownerInBrand(REVIEW_BRAND, username);
  if (!account) {
    const fields = await passwordFields(config.cookieSecret, config.reviewPassword);
    account = control.createOwner({ brandId: REVIEW_BRAND, branchId, name, username, phone, ...fields });
  } else if (!(await verifyPin(config.reviewPassword, account.password_hash))) {
    account = control.resetOwnerPassword(account.id, await passwordFields(config.cookieSecret, config.reviewPassword));
  }
  if (account.disabled_at) control.setOwnerDisabled(account.id, false);
}

export async function ensureReview(deps) {
  const { control, tenants, config } = deps;
  if (!config.reviewAccount) return;
  if (!control.getBrand(REVIEW_BRAND)) control.createBrand({ id: REVIEW_BRAND, name: 'كافيه بوكيت' });
  if (control.getBrand(REVIEW_BRAND).deleted_at) control.restoreBrand(REVIEW_BRAND);
  for (const b of BRANCHES) {
    let branch = control.getBranch(b.id);
    if (!branch) {
      // No trial, no end date: always active.
      branch = control.createBranch({ id: b.id, brandId: REVIEW_BRAND, name: b.name, area: b.name });
      const { store } = tenants.get(b.id);
      const pin = await pinFields(config.cookieSecret, '1234');
      store.initSettings({ pinHash: pin.pin_hash, pinSealed: pin.pin_sealed, qrMode: 'both' });
      store.updateShop({ ...NEW_BRANCH_DEFAULTS, loyalty_every: 5, loyalty_reward_text: 'مشروب ببلاش' });
      control.setFeature(b.id, 'loyalty', true);
    }
    if (branch.deleted_at) control.restoreBranch(b.id);
    if (branch.suspended_manual) control.setSuspended(b.id, false);
    const { store } = tenants.get(b.id);
    if (store.getShop().paused) store.updateShop({ paused: 0 });
    topUpDemo({ tenants, config }, Date.now(), b.id);
    // A few orders being made right now, as a reviewer would expect to see.
    const open = store.openOrders().length;
    for (let i = open; i < OPEN_NOW; i++) store.createOrder();
  }
  await ensureAccount(deps, REVIEW_OWNER);
  await ensureAccount(deps, REVIEW_MANAGER, BRANCHES[0].id);
}
