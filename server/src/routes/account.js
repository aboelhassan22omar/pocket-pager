// Self-serve accounts: a restaurant signs itself up (/signup), and owners and branch managers
// sign in with their phone (/login). One free trial per phone and per device, ever.

import crypto from 'node:crypto';
import { passwordFields, verifyPin } from '../auth.js';
import { cleanPhone, egyptMobile } from '../contact.js';
import { isDemo } from '../demo.js';
import { HttpError } from '../errors.js';
import { provisionBrand, provisionBranch, branchUrls } from '../provision.js';
import { createRateLimiter } from '../ratelimit.js';
import { requireJson, setOwnerSession } from '../sessions.js';
import { randomId } from '../util.js';

export const TRIAL_COOKIE = 'sp_tr';
const TRIAL_COOKIE_AGE = 400 * 24 * 3600;
const NAME_MAX = 60;
const PASSWORD_MIN = 6;
// Ids that would read like ours, not a restaurant's.
const RESERVED = new Set([
  'admin', 'api', 'app', 'apps', 'aurexis', 'bar', 'brand', 'demo', 'help', 'login', 'media', 'pager',
  'pocket', 'pocket-pager', 'pocketpager', 'privacy', 'qr', 'settings', 'signup', 'start', 'super', 'support', 'test',
]);

const bad = (field, message) => new HttpError(400, message, { field });

/**
 * A phone as stored on accounts: Egyptian mobiles as 2010xxxxxxxx, any other number as its
 * digits (8 to 15). Arabic digits, spaces and dashes are fine as typed.
 */
export function accountPhone(value, field = 'phone') {
  try {
    return egyptMobile(value, field);
  } catch {
    let digits;
    try {
      digits = cleanPhone(value, field)?.replace(/^\+/, '') ?? '';
    } catch {
      digits = '';
    }
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!/^\d{8,15}$/.test(digits)) throw bad(field, 'اكتب رقم موبايلك صح، زي 01012345678');
    return digits;
  }
}

/** The ways the same phone may already be stored on an owner (typed by the super, or by us). */
function phoneForms(digits) {
  const forms = new Set([digits, `+${digits}`]);
  if (digits.startsWith('20')) forms.add(`0${digits.slice(2)}`);
  return [...forms];
}

export function cleanPersonName(value, field = 'name') {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > NAME_MAX) throw bad(field, 'اكتب الاسم (من 2 لـ 60 حرف)');
  return name;
}

export function checkNewPassword(value, field = 'password') {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN || value.length > 128) {
    throw bad(field, `كلمة السر ${PASSWORD_MIN} حروف أو أرقام على الأقل`);
  }
  return value;
}

/** A link name: small English letters, digits and dashes, 3 to 24, not ours. */
export function cleanSlug(value, field, { min = 3, max = 24 } = {}) {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (slug.length < min || slug.length > max || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw bad(field, `من ${min} لـ ${max} حرف إنجليزي صغير أو أرقام، ومن غير مسافات (ممكن تستخدم -)`);
  }
  if (RESERVED.has(slug) || isDemo(slug)) throw new HttpError(409, 'الاسم ده محجوز، اختار غيره', { field });
  return slug;
}

/** A 4-digit cashier PIN (the owner can change it later). */
export const newPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** Every owner/manager signed in with these: by phone first, then by username. */
export function loginCandidates(control, login) {
  const typed = typeof login === 'string' ? login.trim() : '';
  if (!typed) return [];
  const found = new Map();
  let digits = null;
  try {
    digits = accountPhone(typed);
  } catch {
    // not a phone: a username
  }
  if (digits) for (const form of phoneForms(digits)) for (const o of control.ownersByPhone(form)) found.set(o.id, o);
  for (const o of control.ownersByUsername(typed)) found.set(o.id, o);
  return [...found.values()];
}

export function phoneTaken(control, digits) {
  return phoneForms(digits).some((form) => control.ownersByPhone(form).some((o) => !control.getBrand(o.brand_id)?.deleted_at));
}

export default async function accountRoutes(app, deps) {
  const { config, control } = deps;
  const signupLimiter = createRateLimiter({ limit: config.signupRatePerHour, windowMs: 3600_000 });
  const loginLimiter = createRateLimiter({ limit: config.loginRatePerMin });
  const checkLimiter = createRateLimiter({ limit: 60 });
  app.addHook('onClose', async () => {
    signupLimiter.close();
    loginLimiter.close();
    checkLimiter.close();
  });

  const limited = (limiter, key, reply) => {
    const r = limiter.take(key);
    if (r.ok) return;
    reply.header('retry-after', String(r.retryAfter));
    throw new HttpError(429, 'محاولات كتير. استنى شوية وجرّب تاني');
  };

  // What the sign-up and login pages say: the trial length and where to ask for help.
  app.get('/api/signup/info', async () => ({
    signup: config.signup,
    trialDays: config.trialDays,
    support: config.pay.whatsapp || null,
    host: config.publicUrl.replace(/^https?:\/\//, ''),
  }));

  // Is this link name free? ?brand=<slug>[&branch=<slug>]
  app.get('/api/signup/check', async (req, reply) => {
    limited(checkLimiter, `check|${req.ip}`, reply);
    const out = {};
    try {
      const brand = cleanSlug(req.query.brand, 'brandId');
      out.brand = { ok: !control.getBrand(brand) && !control.getBranch(brand), id: brand };
      if (!out.brand.ok) out.brand.error = 'الاسم ده مستخدم، جرّب اسم تاني';
    } catch (err) {
      out.brand = { ok: false, error: err.message };
    }
    return out;
  });

  app.post('/api/signup', async (req, reply) => {
    requireJson(req);
    if (!config.signup) throw new HttpError(403, 'التسجيل مقفول دلوقتي. كلّم Aurexis');
    limited(signupLimiter, `signup|${req.ip}`, reply);
    const body = req.body ?? {};
    const name = cleanPersonName(body.name);
    const phone = accountPhone(body.phone);
    const password = checkNewPassword(body.password);
    const brandName = typeof body.brandName === 'string' ? body.brandName.trim() : '';
    if (brandName.length < 2 || brandName.length > NAME_MAX) throw bad('brandName', 'اكتب اسم المطعم أو الكافيه (من 2 لـ 60 حرف)');
    const brandId = cleanSlug(body.brandId, 'brandId');
    const branchName = typeof body.branchName === 'string' && body.branchName.trim() ? body.branchName.trim() : 'الفرع الرئيسي';
    if (branchName.length > NAME_MAX) throw bad('branchName', 'اسم الفرع لحد 60 حرف');
    const branchSlug = body.branchSlug ? cleanSlug(body.branchSlug, 'branchSlug', { min: 2, max: 20 }) : null;
    const branchId = branchSlug ? `${brandId}-${branchSlug}` : brandId;
    if (branchId.length > 32) throw bad('branchSlug', 'اسم المطعم واسم الفرع مع بعض لحد 32 حرف');

    if (phoneTaken(control, phone)) throw new HttpError(409, 'الرقم ده عليه حساب قبل كده. ادخل من «عندي حساب»', { field: 'phone' });
    if (control.getBrand(brandId) || control.getBranch(brandId)) throw new HttpError(409, 'الاسم ده مستخدم، جرّب اسم تاني', { field: 'brandId' });
    if (control.getBranch(branchId)) throw new HttpError(409, 'اسم الفرع ده مستخدم، جرّب اسم تاني', { field: 'branchSlug' });

    // One free trial per phone and per device: the second account starts without one.
    let deviceKey = req.cookies[TRIAL_COOKIE];
    if (typeof deviceKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceKey)) deviceKey = randomId(18);
    const trialKeys = [`phone:${phone}`, `dev:${deviceKey}`];
    const trial = !control.trialUsed(trialKeys);

    const pin = newPin();
    provisionBrand(deps, { id: brandId, name: brandName, selfServe: true });
    const shop = await provisionBranch(deps, {
      brandId, id: branchId, name: branchName, pin, trial, awaitingPayment: !trial,
    });
    const fields = await passwordFields(config.cookieSecret, password);
    const username = phone.startsWith('20') ? `0${phone.slice(2)}` : phone;
    const owner = control.createOwner({ brandId, name, username, phone, ...fields });
    control.markTrialUsed(trialKeys, brandId);
    control.audit({ actor: `owner:${owner.id}`, action: 'account.signup', brandId, branchId: shop.id, detail: { trial }, ip: req.ip });

    reply.setCookie(TRIAL_COOKIE, deviceKey, {
      httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/', maxAge: TRIAL_COOKIE_AGE,
    });
    setOwnerSession(reply, config, owner);
    return reply.code(201).send({
      brandId,
      branchId: shop.id,
      pin,
      trial,
      trialDays: trial ? config.trialDays : 0,
      urls: { ...branchUrls(config, shop.id), customer: `${config.publicUrl}/s/${shop.id}`, owner: `${config.publicUrl}/brand/${brandId}` },
    });
  });

  // One sign-in for everyone with an account: the phone (or the old username) and the password.
  app.post('/api/login', async (req, reply) => {
    requireJson(req);
    const { login, password } = req.body ?? {};
    const typed = typeof login === 'string' ? login.trim() : '';
    limited(loginLimiter, `login|${typed.toLowerCase()}|${req.ip}`, reply);
    let owner = null;
    for (const o of loginCandidates(control, typed).slice(0, 5)) {
      if (await verifyPin(String(password ?? ''), o.password_hash)) {
        owner = o;
        break;
      }
    }
    if (!owner) throw new HttpError(401, 'الرقم أو كلمة السر غلط');
    if (control.getBrand(owner.brand_id)?.deleted_at) throw new HttpError(403, 'الحساب ده اتقفل. كلّم Aurexis لو عايز ترجّعه');
    control.markOwnerLogin(owner.id);
    setOwnerSession(reply, config, owner);
    control.audit({ actor: `owner:${owner.id}`, action: 'owner.login', brandId: owner.brand_id, ip: req.ip });
    return { brandId: owner.brand_id, manager: Boolean(owner.branch_id), to: `/brand/${owner.brand_id}` };
  });
}

