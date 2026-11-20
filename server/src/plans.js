// Branch plans (DESIGN §17). The stored plan_status is only a cache for dashboards;
// requests always use effectivePlan().

import { HttpError } from './errors.js';

export const DAY_MS = 24 * 3600 * 1000;
export const GRACE_DAYS = 3;
export const PLAN_STATUSES = ['trial', 'active', 'past_due', 'suspended'];
export const FEATURES = ['review', 'loyalty', 'promo'];

/**
 * deleted_at set    -> suspended (in the trash)
 * suspended_manual  -> suspended
 * paid_until set    -> active until paid_until, past_due for 3 more days, then suspended
 * trial_ends_at set -> trial until then, then suspended
 * awaiting_payment  -> suspended (a branch added after the free trial, until its first payment)
 * neither           -> active (branches migrated from v1: no expiry until a first payment)
 */
export function effectivePlan(branch, now = Date.now()) {
  if (branch.deleted_at) return { status: 'suspended', reason: 'deleted', until: null };
  if (branch.suspended_manual) return { status: 'suspended', reason: 'manual', until: null };
  if (branch.paid_until != null) {
    if (now <= branch.paid_until) return { status: 'active', until: branch.paid_until };
    const graceEnd = branch.paid_until + GRACE_DAYS * DAY_MS;
    if (now <= graceEnd) return { status: 'past_due', until: graceEnd };
    return { status: 'suspended', reason: 'unpaid', until: null };
  }
  if (branch.trial_ends_at != null) {
    if (now < branch.trial_ends_at) return { status: 'trial', until: branch.trial_ends_at };
    return { status: 'suspended', reason: 'trial_ended', until: null };
  }
  if (branch.awaiting_payment) return { status: 'suspended', reason: 'awaiting_payment', until: null };
  return { status: 'active', until: null };
}

export function planView(branch, now = Date.now()) {
  const plan = effectivePlan(branch, now);
  return {
    status: plan.status,
    reason: plan.reason ?? null,
    until: plan.until,
    daysLeft: plan.until == null ? null : Math.max(0, Math.ceil((plan.until - now) / DAY_MS)),
  };
}

export const canClaim = (branch, now = Date.now()) => effectivePlan(branch, now).status !== 'suspended';

// ---- a stopped branch: every page about it shows only why ----

export const STOPPED_CODE = 'branch_stopped';
export const STOP_MESSAGES = {
  trial_ended: 'التجربة المجانية خلصت',
  awaiting_payment: 'الفرع ده مستني الاشتراك',
  unpaid: 'الاشتراك خلص',
  stopped: 'الخدمة متوقفة',
};

/**
 * Why the branch is stopped, or null while it works:
 * 'trial_ended' (before the hourly job trashes it, and after), 'unpaid' (past the grace days),
 * 'stopped' (the super stopped or trashed it by hand).
 */
export function stopReason(branch, now = Date.now()) {
  if (branch.deleted_at) return branch.deleted_reason === 'trial_ended' ? 'trial_ended' : 'stopped';
  const plan = effectivePlan(branch, now);
  if (plan.status !== 'suspended') return null;
  return ['trial_ended', 'unpaid', 'awaiting_payment'].includes(plan.reason) ? plan.reason : 'stopped';
}

/**
 * The owner's page stops once none of the brand's branches works. It says what the owner can
 * act on first: a subscription to renew, then a trial that ended, then a stop by hand.
 */
export function brandStopReason(branches, now = Date.now()) {
  const reasons = branches.map((b) => stopReason(b, now));
  if (!reasons.length || reasons.includes(null)) return null;
  return ['unpaid', 'trial_ended', 'awaiting_payment'].find((r) => reasons.includes(r)) ?? 'stopped';
}

/**
 * The one reply for anything about a stopped branch (or brand): every page shows this message
 * alone, full screen (public/js/util.js), for the cashier, the owner and customers alike.
 */
export const stoppedError = (reason) => new HttpError(402, STOP_MESSAGES[reason], { code: STOPPED_CODE, reason });

/** Effective feature flags: the owner's toggle, unless super forced it off. */
export function featureFlags(branch) {
  const forced = new Set(JSON.parse(branch.forced_off || '[]'));
  return Object.fromEntries(FEATURES.map((f) => [f, Boolean(branch[`ff_${f}`]) && !forced.has(f)]));
}
