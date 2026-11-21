// What the managers' apps notify: a branch paused or opened, stopped (trial over, unpaid, by
// hand, waiting for payment), a subscription about to end or ended, a cashier screen closed at a
// usually busy hour. Each alert is stored once (its dedupe key), listed in the apps, pushed to the
// brand's iPhones (APNs) and announced on the brand's live stream. Androids fetch new alerts.

import { screenAlert } from './alerts.js';
import { brandChannel } from './bus.js';
import { DAY_MS, effectivePlan, stopReason } from './plans.js';
import { branchTz, businessDay } from './util.js';

const STOP_TEXT = {
  trial_ended: 'التجربة المجانية خلصت، والعملاء مش بياخدوا أرقام. كلّمنا على واتساب عشان يرجع يشتغل.',
  unpaid: 'الاشتراك خلص، والعملاء مش بياخدوا أرقام. كلّمنا على واتساب عشان يرجع يشتغل.',
  awaiting_payment: 'الفرع مستني تفعيل الاشتراك. كلّمنا على واتساب.',
  stopped: 'الخدمة متوقفة في الفرع ده. كلّمنا على واتساب.',
};

export function createOwnerAlerts({ control, tenants, screens, config, notifier, bus, log }) {
  /** Stores the alert (once per dedupe key) and tells everyone who should know. */
  function raise({ brandId, branchId = null, kind, title, body, dedupe }) {
    const alert = control.addAlert({ brandId, branchId, kind, title, body, dedupe });
    if (!alert) return null;
    bus.emit(brandChannel(brandId), 'alert', { id: alert.id, branchId });
    for (const device of control.pushDevicesOfBrand(brandId)) {
      // A branch manager hears about their own branch (and brand-wide news) only.
      const owner = control.getOwner(device.owner_id);
      if (!owner || owner.disabled_at || owner.brand_id !== brandId) {
        control.dropPushDevice(device.token);
        continue;
      }
      if (owner.branch_id && branchId && owner.branch_id !== branchId) continue;
      if (device.platform !== 'ios') continue; // Androids fetch /alerts by themselves
      notifier.appAlert(device.token, { title, body, data: { brandId, branchId, alertId: alert.id } })
        .then((res) => {
          if (res?.gone) control.dropPushDevice(device.token);
        })
        .catch((err) => log.warn({ err }, 'app push failed'));
    }
    return alert;
  }

  /** The owner (or its manager) paused or opened a branch. */
  function paused(branch, on, now = Date.now()) {
    raise({
      brandId: branch.brand_id,
      branchId: branch.id,
      kind: on ? 'paused' : 'opened',
      title: on ? `فرع ${branch.name} اتقفل مؤقتًا` : `فرع ${branch.name} رجع يشتغل`,
      body: on ? 'العملاء مش بياخدوا أرقام لحد ما يتفتح تاني.' : 'العملاء بياخدوا أرقام عادي.',
      dedupe: `pause:${branch.id}:${on ? 1 : 0}:${now}`,
    });
  }

  /** Every branch, every few minutes: plan changes coming or come, cashier screens closed. */
  function check(now = Date.now()) {
    let raised = 0;
    for (const branch of control.listBranches()) {
      if (branch.deleted_at && branch.deleted_reason === 'brand') continue;
      const brand = control.getBrand(branch.brand_id);
      if (!brand || brand.deleted_at) continue;
      const name = branch.name;
      const add = (a) => {
        if (raise({ brandId: branch.brand_id, branchId: branch.id, ...a })) raised++;
      };

      const reason = stopReason(branch, now);
      if (reason) {
        add({ kind: 'stopped', title: `فرع ${name} وقف`, body: STOP_TEXT[reason], dedupe: `stop:${branch.id}:${reason}:${branch.paid_until ?? branch.trial_ends_at ?? 0}` });
        continue;
      }
      const plan = effectivePlan(branch, now);
      if (plan.status === 'past_due') {
        add({
          kind: 'past_due', title: `اشتراك فرع ${name} خلص`,
          body: 'الفرع لسه شغال كام يوم سماح. كلّمنا على واتساب عشان يفضل شغال.', dedupe: `pastdue:${branch.id}:${branch.paid_until}`,
        });
      } else if (plan.until && plan.until > now) {
        const days = Math.ceil((plan.until - now) / DAY_MS);
        const what = plan.status === 'trial' ? 'التجربة المجانية' : 'الاشتراك';
        for (const at of [3, 1]) {
          if (days <= at && plan.status !== 'past_due') {
            add({
              kind: 'ending', title: `${what} في فرع ${name} ${days <= 1 ? 'بيخلص بكرة' : `فاضلها ${days} أيام`}`,
              body: 'كلّمنا على واتساب عشان الفرع مايقفش.', dedupe: `ending:${branch.id}:${plan.until}:${at}`,
            });
            break;
          }
        }
      }
      const closed = screenAlert({ screens, config, tenants }, branch, now);
      if (closed) {
        const day = businessDay(branchTz(branch, config), branch.day_start_hour ?? 0, now);
        add({
          kind: 'cashier_closed', title: `شاشة الكاشير في فرع ${name} مقفولة`,
          body: `مقفولة من ${closed.closedMinutes} دقيقة، والوقت ده عادةً فيه طلبات.`,
          dedupe: `screen:${branch.id}:${day}:${Math.floor(now / (3 * 3600_000))}`,
        });
      }
    }
    return raised;
  }

  return { raise, paused, check };
}

export const alertView = (a) => ({
  id: a.id, branchId: a.branch_id, kind: a.kind, title: a.title, body: a.body, at: a.created_at,
});
