import fs from 'node:fs';
import path from 'node:path';
import { passwordFields, pinFields, PIN_RE, verifyPin } from '../auth.js';
import { analyticsCsv, brandAnalytics, brandOverview } from '../aggregate.js';
import { appKeyOf, appView, brandAppDir, ownerAppView } from '../apps.js';
import { DEFAULT_RING } from '../../public/js/chime.js';
import { cleanTexts } from '../../public/js/texts.js';
import { brandChannel, channels } from '../bus.js';
import { alertView } from '../owner-alerts.js';
import { openSse } from '../sse.js';
import { cleanEmail, cleanPhone, egyptMobile, localMobile } from '../contact.js';
import { DEMO_LOCKED, isDemo } from '../demo.js';
import { HttpError } from '../errors.js';
import { LOYALTY_EVERY, PRODUCT_TEXT_MAX, REWARD_TEXT_MAX } from '../loyalty.js';
import { createRateLimiter } from '../ratelimit.js';
import {
  AUDIO_MIME, AUDIO_TYPES, clearRingFiles, RING_FILE_MAX_BYTES, RING_FILE_RE, RING_IDS, ringView, sniffAudio,
} from '../ring.js';
import { DELIVERY_CLOSE_MINUTES, DRIVER_NAME_MAX, SHOP_ID_RE } from '../store.js';
import { OWNER_COOKIE, requireJson, requireOwner, setOwnerSession } from '../sessions.js';
import { brandStopReason, FEATURES, planView, stoppedError } from '../plans.js';
import { MAX_BRANCHES, MONTH_OPTIONS, quote } from '../../public/js/pricing.js';
import { provisionBranch } from '../provision.js';
import { randomId } from '../util.js';
import { unseal } from '../vault.js';
import {
  accountPhone, checkNewPassword, cleanPersonName, cleanSlug, newPin, phoneTaken,
} from './account.js';
import { parsePlaceId } from '../upgrades.js';
import { MAX_STAFF, parseGoogleReviewUrl, PIN_TAKEN_TEXT, sniffImage, staffPinTaken } from './bar.js';
import { isReviewBrand } from '../review.js';
import { cleanBranchName } from './super.js';

const PROMO_TEXT_MAX = 120;
export const PROMO_IMAGE_MAX_BYTES = 500 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function promoDay(body, key) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if (!value) return null;
  if (!DAY_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'التاريخ لازم يكون بالشكل 2026-01-31', { field: key });
  }
  return value;
}

// Loyalty rule and promo fields of the owner settings body -> branch_settings columns.
export function ownerExtraFields(body) {
  const fields = {};
  if ('loyaltyEvery' in body) {
    const every = Number(body.loyaltyEvery);
    if (!Number.isInteger(every) || every < LOYALTY_EVERY.min || every > LOYALTY_EVERY.max) {
      throw new HttpError(400, `عدد الطلبات من ${LOYALTY_EVERY.min} لـ ${LOYALTY_EVERY.max}`, { field: 'loyaltyEvery' });
    }
    fields.loyalty_every = every;
  }
  if ('loyaltyRewardText' in body) {
    const text = typeof body.loyaltyRewardText === 'string' ? body.loyaltyRewardText.trim() : '';
    if (text.length > REWARD_TEXT_MAX) throw new HttpError(400, `الهدية لحد ${REWARD_TEXT_MAX} حرف`, { field: 'loyaltyRewardText' });
    fields.loyalty_reward_text = text || null;
  }
  // The card on one product (empty = every order).
  if ('loyaltyProduct' in body) {
    const text = typeof body.loyaltyProduct === 'string' ? body.loyaltyProduct.trim() : '';
    if (text.length > PRODUCT_TEXT_MAX) throw new HttpError(400, `اسم المنتج لحد ${PRODUCT_TEXT_MAX} حرف`, { field: 'loyaltyProduct' });
    fields.loyalty_product = text || null;
  }
  if ('promoText' in body) {
    const text = typeof body.promoText === 'string' ? body.promoText.trim() : '';
    if (text.length > PROMO_TEXT_MAX) throw new HttpError(400, `نص العرض لحد ${PROMO_TEXT_MAX} حرف`, { field: 'promoText' });
    fields.promo_text = text || null;
  }
  // Order QR mode and sharing one order between phones: plain switches.
  if ('orderQr' in body) fields.order_qr = body.orderQr === true ? 1 : 0;
  if ('orderShare' in body) fields.order_share = body.orderShare === false ? 0 : 1;
  if ('manualNumbers' in body) fields.manual_numbers = body.manualNumbers === true ? 1 : 0;
  if ('messageBox' in body) fields.message_box = body.messageBox === true ? 1 : 0;
  // Delivery by the branch's own drivers, and how long an order on its way stays open.
  if ('delivery' in body) fields.delivery = body.delivery === true ? 1 : 0;
  // Paused: customers can't take a number and the cashier can't start an order until it opens.
  if ('paused' in body) fields.paused = body.paused === true ? 1 : 0;
  if ('deliveryCloseMinutes' in body) {
    const minutes = Number(body.deliveryCloseMinutes);
    const { min, max } = DELIVERY_CLOSE_MINUTES;
    if (!Number.isInteger(minutes) || minutes < min || minutes > max) {
      throw new HttpError(400, `من ${min} لـ ${max} دقيقة`, { field: 'deliveryCloseMinutes' });
    }
    fields.delivery_close_minutes = minutes;
  }
  if ('promoStartsAt' in body) fields.promo_starts_at = promoDay(body, 'promoStartsAt');
  if ('promoEndsAt' in body) fields.promo_ends_at = promoDay(body, 'promoEndsAt');
  if (fields.promo_starts_at && fields.promo_ends_at && fields.promo_ends_at < fields.promo_starts_at) {
    throw new HttpError(400, 'تاريخ النهاية لازم يكون بعد البداية', { field: 'promoEndsAt' });
  }
  return fields;
}

// Password checks per login at most (one per brand using that name).
const MAX_LOGIN_CANDIDATES = 5;

// Brand owner: sees and manages the branches of their own brand only.
export default async function brandRoutes(app, deps) {
  const { config, control, tenants, service, bus } = deps;
  const loginLimiter = createRateLimiter({ limit: config.loginRatePerMin });
  app.addHook('onClose', async () => loginLimiter.close());

  app.post('/api/brand/login', async (req, reply) => {
    const { username, password, brandId } = req.body ?? {};
    const name = typeof username === 'string' ? username.trim() : '';
    const limit = loginLimiter.take(`owner|${name.toLowerCase()}|${req.ip}`);
    if (!limit.ok) {
      reply.header('retry-after', String(limit.retryAfter));
      throw new HttpError(429, 'محاولات كتير. استنى دقيقة وجرّب تاني');
    }
    // The same name may be used in several brands: the login page's brand first, then the
    // others (an owner on another brand's page still lands on their own). Capitals or not.
    const candidates = name ? control.ownersByUsername(name) : [];
    candidates.sort((a, b) => (b.brand_id === brandId) - (a.brand_id === brandId));
    let owner = null;
    for (const o of candidates.slice(0, MAX_LOGIN_CANDIDATES)) {
      if (await verifyPin(String(password ?? ''), o.password_hash)) {
        owner = o;
        break;
      }
    }
    if (!owner) throw new HttpError(401, 'اسم المستخدم أو كلمة السر غلط');
    if (control.getBrand(owner.brand_id)?.deleted_at) throw new HttpError(403, 'الحساب ده متوقف. كلّم Aurexis');
    if (control.getOwner(owner.id)?.disabled_at) throw new HttpError(403, 'الحساب ده متوقف. كلّم Aurexis');
    control.markOwnerLogin(owner.id);
    setOwnerSession(reply, config, owner);
    control.audit({ actor: `owner:${owner.id}`, action: 'owner.login', brandId: owner.brand_id, ip: req.ip });
    return { brandId: owner.brand_id };
  });

  app.post('/api/brand/:brand/logout', async (_req, reply) => {
    reply.clearCookie(OWNER_COOKIE, { path: '/' });
    return { ok: true };
  });

  // The brand's own ring sound, for its customers' pages (public, like a logo).
  app.get('/media/brand/:brand/:file', async (req, reply) => {
    const { brand, file } = req.params;
    if (!SHOP_ID_RE.test(brand) || !RING_FILE_RE.test(file) || !control.getBrand(brand)) throw new HttpError(404, 'مش موجود');
    let data;
    try {
      data = await fs.promises.readFile(path.join(brandAppDir(config, brand), file));
    } catch {
      throw new HttpError(404, 'مش موجود');
    }
    reply.type(AUDIO_MIME[path.extname(file).slice(1)]).header('cache-control', 'public, max-age=31536000, immutable');
    return data;
  });

  await app.register(async (b) => {
    b.addHook('onRequest', async (req) => {
      req.owner = requireOwner(req, deps, req.params.brand);
      // A branch manager: that one branch only. null = the brand's owner (every branch).
      req.scope = req.owner.branch_id ?? null;
      const mine = control.branchesOfBrand(req.params.brand).filter((br) => !req.scope || br.id === req.scope);
      // None of the brand's branches works any more: the owner page shows only why. A brand
      // that signed itself up still opens, so its owner can subscribe (the page leads with that).
      const stopped = brandStopReason(mine);
      if (stopped && !control.getBrand(req.params.brand)?.self_serve) throw stoppedError(stopped);
      if (req.method !== 'GET' && isDemo(req.params.brand)) throw new HttpError(403, DEMO_LOCKED);
      // The App Review account's password is public: it can look at everything and register its
      // phone for alerts, nothing else.
      if (req.method !== 'GET' && isReviewBrand(req.params.brand) && !req.url.split('?')[0].includes('/push-devices')) {
        throw new HttpError(403, DEMO_LOCKED);
      }
      const url = req.url.split('?')[0];
      requireJson(req, url.endsWith('/promo-image') ? IMAGE_TYPES : url.endsWith('/ring-file') ? AUDIO_TYPES : []);
    });

    // A branch of THIS brand (and the manager's own), or 404 (never reveals other branches).
    function ownBranch(req) {
      const branch = control.getBranch(req.params.branch);
      if (!branch || branch.brand_id !== req.params.brand || branch.deleted_at) throw new HttpError(404, 'الفرع ده مش موجود');
      if (req.scope && branch.id !== req.scope) throw new HttpError(404, 'الفرع ده مش موجود');
      return tenants.resolve(branch.id);
    }

    // Brand-wide things (new branches, managers, the subscription, the brand's sound and words).
    function ownerOnly(req) {
      if (req.scope) throw new HttpError(403, 'دي لصاحب المطعم بس');
    }

    const ownerView = (o) => ({
      username: o.username, name: o.name ?? null, email: o.email ?? null, phone: o.phone ?? null,
      role: o.branch_id ? 'manager' : 'owner', branchId: o.branch_id ?? null,
    });

    b.get('/overview', async (req, reply) => {
      // Every dashboard load renews the session: owners and managers are never signed out by time.
      setOwnerSession(reply, config, req.owner);
      const overview = brandOverview(deps, req.params.brand, Date.now(), { branchId: req.scope });
      const mine = control.branchesOfBrand(req.params.brand).filter((br) => !br.deleted_at && (!req.scope || br.id === req.scope));
      return {
        ...overview,
        owner: ownerView(req.owner),
        demo: isDemo(req.params.brand),
        // Why nothing works (a self-serve brand still opens its page, to subscribe).
        stopped: brandStopReason(mine),
        pendingBilling: req.scope ? null : control.billingRequestsOfBrand(req.params.brand).find((r) => r.status === 'pending') ?? null,
        whatsapp: config.pay.whatsapp || null,
      };
    });

    // The owner's own email and phone (both optional; empty clears).
    b.post('/account', async (req) => {
      const body = req.body ?? {};
      const owner = control.setOwnerContact(req.owner.id, { email: cleanEmail(body.email), phone: cleanPhone(body.phone) });
      control.audit({ actor: `owner:${owner.id}`, action: 'owner.contact', brandId: req.params.brand, ip: req.ip });
      return { owner: ownerView(owner) };
    });

    // ?from=YYYY-MM-DD&to=YYYY-MM-DD[&branch=<id>]  (at most 366 days)
    function analyticsQuery(req) {
      const { from, to, branch } = req.query;
      if (!DAY_RE.test(from ?? '') || !DAY_RE.test(to ?? '') || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
        throw new HttpError(400, 'التاريخ لازم يكون بالشكل 2026-01-31', { field: 'from' });
      }
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days < 0) throw new HttpError(400, 'تاريخ البداية لازم يكون قبل النهاية', { field: 'to' });
      if (days > 365) throw new HttpError(400, 'أقصى فترة سنة', { field: 'from' });
      // A manager's report is their branch's, whatever was asked.
      const branchId = req.scope ?? (branch || null);
      if (branchId) {
        const b = control.getBranch(branchId);
        if (!b || b.brand_id !== req.params.brand) throw new HttpError(404, 'الفرع ده مش موجود');
      }
      return brandAnalytics(deps, req.params.brand, { from, to, branchId });
    }

    b.get('/analytics', async (req) => analyticsQuery(req));

    b.get('/analytics.csv', async (req, reply) => {
      const report = analyticsQuery(req);
      reply.type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${req.params.brand}-${report.range.from}-${report.range.to}.csv"`);
      return analyticsCsv(report);
    });

    // Owner settings of one branch: name, feature toggles, Google place id (+ loyalty/promo).
    b.post('/branches/:branch/settings', async (req) => {
      const ctx = ownBranch(req);
      const body = req.body ?? {};
      const audit = (action, detail) => control.audit({
        actor: `owner:${req.owner.id}`, action, brandId: req.params.brand, branchId: ctx.branch.id, detail, ip: req.ip,
      });
      const fields = {};
      if ('name' in body) {
        ownerOnly(req);
        fields.name = cleanBranchName(body.name);
      }
      // This branch's Google review link: a normal review link (g.page/r/…/review, maps.app.goo.gl/…)
      // or a place id. Each branch keeps its own; empty clears it.
      if ('googlePlaceId' in body) {
        const id = parsePlaceId(body.googlePlaceId);
        if (id === undefined) {
          try {
            fields.google_review_url = parseGoogleReviewUrl(body.googlePlaceId);
          } catch {
            throw new HttpError(400, 'الصق لينك تقييم جوجل بتاع الفرع ده (بيبدأ بـ https://) أو الـ Place ID', { field: 'googlePlaceId' });
          }
          fields.google_place_id = null;
        } else {
          fields.google_place_id = id;
          fields.google_review_url = null;
        }
      }
      Object.assign(fields, ownerExtraFields(body));
      const features = body.features && typeof body.features === 'object' ? body.features : {};
      const toggles = Object.entries(features).filter(([f]) => FEATURES.includes(f));
      if (!Object.keys(fields).length && !toggles.length) throw new HttpError(400, 'مفيش تغييرات تتحفظ');
      // A stamp card needs a reward to promise.
      const rewardText = 'loyalty_reward_text' in fields ? fields.loyalty_reward_text : ctx.store.getShop().loyalty_reward_text;
      if (features.loyalty === true && !rewardText) {
        throw new HttpError(400, 'اكتب الهدية الأول (مثلًا: مشروب ببلاش)', { field: 'loyaltyRewardText' });
      }

      if (Object.keys(fields).length) {
        const wasPaused = Boolean(ctx.store.getShop().paused);
        ctx.store.updateShop(fields);
        if ('paused' in fields && Boolean(fields.paused) !== wasPaused) deps.ownerAlerts?.paused(ctx.branch, Boolean(fields.paused));
        // Open cashier and QR screens pick the change up (order QR mode, name, ...).
        service.publishShop(ctx, ctx.store.getShop());
        audit(fields.name ? 'branch.rename' : 'branch.owner_settings', { fields: Object.keys(fields), name: fields.name });
      }
      for (const [feature, on] of toggles) {
        control.setFeature(ctx.branch.id, feature, Boolean(on));
        audit(on ? 'feature.enable' : 'feature.disable', { feature });
      }
      return { ok: true };
    });

    // ---- drivers: the branch's own delivery drivers (name + mobile), in its own database ----

    const driverView = (d) => ({ id: d.id, name: d.name, phone: localMobile(d.phone) });
    function driverBody(body) {
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > DRIVER_NAME_MAX) throw new HttpError(400, `اسم المندوب من 1 لـ ${DRIVER_NAME_MAX} حرف`, { field: 'name' });
      return { name, phone: egyptMobile(body?.phone, 'phone') };
    }
    function ownDriver(ctx, req) {
      const driver = ctx.store.getDriver(Number(req.params.driver));
      if (!driver) throw new HttpError(404, 'المندوب ده مش موجود');
      return driver;
    }
    // Open cashier screens get the new list at once.
    function driversChanged(req, ctx, action, detail) {
      const list = ctx.store.listDrivers().map(driverView);
      bus.emit(channels(ctx.branch.id).bar, 'drivers', list);
      control.audit({ actor: `owner:${req.owner.id}`, action, brandId: req.params.brand, branchId: ctx.branch.id, detail, ip: req.ip });
      return list;
    }

    b.get('/branches/:branch/drivers', async (req) => ({ drivers: ownBranch(req).store.listDrivers().map(driverView) }));

    b.post('/branches/:branch/drivers', async (req, reply) => {
      const ctx = ownBranch(req);
      const driver = ctx.store.addDriver(driverBody(req.body));
      const drivers = driversChanged(req, ctx, 'driver.add', { id: driver.id, name: driver.name });
      return reply.code(201).send({ driver: driverView(driver), drivers });
    });

    b.post('/branches/:branch/drivers/:driver', async (req) => {
      const ctx = ownBranch(req);
      const driver = ctx.store.updateDriver(ownDriver(ctx, req).id, driverBody(req.body));
      return { driver: driverView(driver), drivers: driversChanged(req, ctx, 'driver.edit', { id: driver.id, name: driver.name }) };
    });

    // Orders already on their way keep the driver's name and phone until they close.
    b.post('/branches/:branch/drivers/:driver/delete', async (req) => {
      const ctx = ownBranch(req);
      const driver = ownDriver(ctx, req);
      ctx.store.deleteDriver(driver.id);
      return { ok: true, drivers: driversChanged(req, ctx, 'driver.delete', { id: driver.id, name: driver.name }) };
    });

    // ---- cashier app: the download link to pass on, and the devices it is installed on ----

    b.get('/app', async (req) => {
      const view = appView(deps, control.getBrand(req.params.brand));
      return req.scope ? { ...view, devices: view.devices.filter((d) => d.branchId === req.scope) } : view;
    });

    // The owner turns the cashier-app download on by themselves (a password is made for them).
    b.post('/app/enable', async (req) => {
      ownerOnly(req);
      const brand = control.getBrand(req.params.brand);
      if (!brand.app_password_hash) {
        control.setAppPassword(brand.id, await passwordFields(config.cookieSecret, randomId(6)));
        control.audit({ actor: `owner:${req.owner.id}`, action: 'app.password', brandId: brand.id, ip: req.ip });
      }
      appKeyOf(control, brand.id);
      return appView(deps, control.getBrand(brand.id));
    });

    // What customers read, in the brand's own words (empty = the default sentence).
    // ---- the customers' ring: a tone of the library, or the brand's own sound ----

    b.get('/ring', async (req) => ringView(req.params.brand, control.brandRing(req.params.brand)));

    // A tone of the library (and the brand's own sound, if any, goes).
    b.post('/ring', async (req) => {
      ownerOnly(req);
      const tone = req.body?.tone;
      if (!RING_IDS.has(tone)) throw new HttpError(400, 'الرنة دي مش موجودة', { field: 'tone' });
      const saved = control.setBrandRing(req.params.brand, tone === DEFAULT_RING ? null : { tone, file: null });
      await clearRingFiles(config, req.params.brand);
      control.audit({ actor: `owner:${req.owner.id}`, action: 'brand.ring', brandId: req.params.brand, detail: { tone }, ip: req.ip });
      return ringView(req.params.brand, saved);
    });

    // The brand's own sound (mp3, wav, ogg, m4a, webm), up to 600 KB.
    b.post('/ring-file', async (req) => {
      ownerOnly(req);
      if (Buffer.isBuffer(req.body) && req.body.length > RING_FILE_MAX_BYTES) {
        throw new HttpError(413, 'ملف الرنة لازم يكون أقل من 600 كيلوبايت', { field: 'ringFile' });
      }
      const ext = sniffAudio(req.body);
      if (!ext) throw new HttpError(400, 'الملف لازم يكون صوت MP3 أو WAV أو OGG أو M4A', { field: 'ringFile' });
      const dir = brandAppDir(config, req.params.brand);
      await fs.promises.mkdir(dir, { recursive: true });
      const file = `ring-${Date.now()}.${ext}`;
      await fs.promises.writeFile(path.join(dir, file), req.body);
      await clearRingFiles(config, req.params.brand, file);
      const before = control.brandRing(req.params.brand);
      const saved = control.setBrandRing(req.params.brand, { tone: before?.tone ?? DEFAULT_RING, file });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'brand.ring_file', brandId: req.params.brand, ip: req.ip });
      return ringView(req.params.brand, saved);
    });

    b.get('/texts', async (req) => ({ texts: control.brandTexts(req.params.brand) }));
    b.post('/texts', async (req) => {
      ownerOnly(req);
      const { texts, error, field } = cleanTexts(req.body?.texts);
      if (error) throw new HttpError(400, error, { field });
      const saved = control.setBrandTexts(req.params.brand, texts);
      control.audit({ actor: `owner:${req.owner.id}`, action: 'brand.texts', brandId: req.params.brand, detail: { changed: Object.keys(saved) }, ip: req.ip });
      return { texts: saved };
    });

    // The owner's own app (Android, Windows): signed-in download links.
    b.get('/owner-app', async (req) => ownerAppView(deps, control.getBrand(req.params.brand)));

    function ownDevice(req) {
      const device = control.getDevice(req.params.device);
      const outside = !device || device.brand_id !== req.params.brand || (req.scope && device.branch_id !== req.scope);
      if (outside || device.revoked_at) throw new HttpError(404, 'الجهاز ده مش موجود');
      return device;
    }
    const deviceAudit = (req, device, action, detail) => control.audit({
      actor: `owner:${req.owner.id}`, action, brandId: device.brand_id, branchId: device.branch_id, detail, ip: req.ip,
    });

    b.post('/devices/:device/rename', async (req) => {
      const device = ownDevice(req);
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (name.length < 1 || name.length > 40) throw new HttpError(400, 'الاسم من 1 لـ 40 حرف', { field: 'name' });
      control.renameDevice(device.id, name);
      deviceAudit(req, device, 'device.rename', { name });
      return { ok: true };
    });

    // The app on that device goes back to "pick your branch + PIN" right away.
    b.post('/devices/:device/revoke', async (req) => {
      const device = ownDevice(req);
      control.revokeDevice(device.id);
      deviceAudit(req, device, 'device.revoke', { name: device.name });
      return { ok: true };
    });

    // ---- the branch's cashier PIN: the owner (or its manager) changes it ----

    b.post('/branches/:branch/pin', async (req) => {
      const ctx = ownBranch(req);
      const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!PIN_RE.test(pin)) throw new HttpError(400, 'الرقم السري من 4 لـ 8 أرقام', { field: 'pin' });
      if (await staffPinTaken(ctx.store, pin)) throw new HttpError(409, PIN_TAKEN_TEXT, { field: 'pin' });
      ctx.store.updateShop(await pinFields(config.cookieSecret, pin));
      control.audit({ actor: `owner:${req.owner.id}`, action: 'branch.pin_reset', brandId: req.params.brand, branchId: ctx.branch.id, ip: req.ip });
      return { ok: true, pin };
    });

    // ---- a new branch: ready at once, working once its subscription is paid ----

    b.post('/branches', async (req, reply) => {
      ownerOnly(req);
      const brandId = req.params.brand;
      // Aurexis adds branches (/super); a self-serve brand (SIGNUP=on) still adds its own.
      if (!control.getBrand(brandId)?.self_serve) throw new HttpError(403, 'الفروع الجديدة بتتعمل مع Aurexis. كلّمنا على واتساب');
      const body = req.body ?? {};
      const live = control.branchesOfBrand(brandId).filter((br) => !br.deleted_at);
      if (live.length >= MAX_BRANCHES) throw new HttpError(400, `أقصى عدد ${MAX_BRANCHES} فرع. كلّمنا لو محتاج أكتر`);
      const name = cleanBranchName(body.name);
      const slug = cleanSlug(body.slug, 'slug', { min: 2, max: 20 });
      const id = `${brandId}-${slug}`;
      if (id.length > 32) throw new HttpError(400, 'اسم الفرع في اللينك أقصر شوية', { field: 'slug' });
      if (control.getBranch(id) || control.getBrand(id)) throw new HttpError(409, 'الاسم ده مستخدم، اختار غيره', { field: 'slug' });
      const pin = body.pin ? String(body.pin).trim() : newPin();
      if (!PIN_RE.test(pin)) throw new HttpError(400, 'الرقم السري من 4 لـ 8 أرقام', { field: 'pin' });
      const shop = await provisionBranch(deps, { brandId, id, name, pin, awaitingPayment: true });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'branch.create', brandId, branchId: shop.id, detail: { name }, ip: req.ip });
      return reply.code(201).send({ branchId: shop.id, pin, awaitingPayment: true });
    });

    // ---- branch managers: an account that sees one branch only ----

    const managerView = (o) => ({
      id: o.id, name: o.name ?? o.username, phone: o.phone ?? null, branchId: o.branch_id,
      password: unseal(config.cookieSecret, o.password_sealed), lastLoginAt: o.last_login_at ?? null,
    });
    const managersOf = (brandId) => control.ownersOfBrand(brandId).filter((o) => o.branch_id).map(managerView);
    function ownManager(req) {
      const m = control.getOwner(Number(req.params.manager));
      if (!m || m.brand_id !== req.params.brand || !m.branch_id) throw new HttpError(404, 'المدير ده مش موجود');
      return m;
    }

    b.get('/managers', async (req) => {
      ownerOnly(req);
      return { managers: managersOf(req.params.brand) };
    });

    b.post('/managers', async (req, reply) => {
      ownerOnly(req);
      const brandId = req.params.brand;
      const body = req.body ?? {};
      const name = cleanPersonName(body.name);
      const phone = accountPhone(body.phone);
      const branch = control.getBranch(String(body.branchId ?? ''));
      if (!branch || branch.brand_id !== brandId || branch.deleted_at) throw new HttpError(400, 'اختار الفرع', { field: 'branchId' });
      if (phoneTaken(control, phone)) throw new HttpError(409, 'الرقم ده عليه حساب قبل كده', { field: 'phone' });
      const password = body.password ? checkNewPassword(body.password) : randomId(6);
      const username = phone.startsWith('20') ? `0${phone.slice(2)}` : phone;
      if (control.ownerInBrand(brandId, username)) throw new HttpError(409, 'الرقم ده عليه حساب قبل كده', { field: 'phone' });
      const fields = await passwordFields(config.cookieSecret, password);
      const manager = control.createOwner({ brandId, branchId: branch.id, name, username, phone, ...fields });
      bus.emit(brandChannel(brandId), 'changed', {});
      control.audit({ actor: `owner:${req.owner.id}`, action: 'manager.create', brandId, branchId: branch.id, detail: { name }, ip: req.ip });
      return reply.code(201).send({ manager: managerView(manager), managers: managersOf(brandId), loginUrl: `${config.publicUrl}/login` });
    });

    // A new password (signs the manager out everywhere).
    b.post('/managers/:manager/password', async (req) => {
      ownerOnly(req);
      const m = ownManager(req);
      const password = req.body?.password ? checkNewPassword(req.body.password) : randomId(6);
      control.resetOwnerPassword(m.id, await passwordFields(config.cookieSecret, password));
      control.audit({ actor: `owner:${req.owner.id}`, action: 'manager.reset', brandId: req.params.brand, branchId: m.branch_id, ip: req.ip });
      return { managers: managersOf(req.params.brand) };
    });

    b.post('/managers/:manager/delete', async (req) => {
      ownerOnly(req);
      const m = ownManager(req);
      control.deleteOwner(m.id);
      control.audit({ actor: `owner:${req.owner.id}`, action: 'manager.delete', brandId: req.params.brand, branchId: m.branch_id, detail: { name: m.name }, ip: req.ip });
      return { managers: managersOf(req.params.brand) };
    });

    // ---- the subscription: price for the brand's branches, and «اشترك» ----

    const payMethods = () => Object.entries(config.pay).filter(([, v]) => v).map(([id, value]) => ({ id, value }));
    const billingView = (brandId) => {
      const branches = control.branchesOfBrand(brandId).filter((br) => !br.deleted_at);
      return {
        branches: branches.map((br) => ({ id: br.id, name: br.name, plan: planView(br), awaitingPayment: Boolean(br.awaiting_payment) })),
        quotes: MONTH_OPTIONS.map((m) => quote(Math.max(1, branches.length), m)),
        methods: payMethods(),
        requests: control.billingRequestsOfBrand(brandId).slice(0, 5).map((r) => ({
          id: r.id, months: r.months, amount: r.amount_egp, method: r.method, status: r.status, createdAt: r.created_at, branches: r.branch_ids.length,
        })),
      };
    };

    b.get('/billing', async (req) => {
      ownerOnly(req);
      return billingView(req.params.brand);
    });

    b.post('/billing', async (req, reply) => {
      ownerOnly(req);
      const brandId = req.params.brand;
      const body = req.body ?? {};
      const months = Number(body.months);
      if (!MONTH_OPTIONS.includes(months)) throw new HttpError(400, 'اختار المدة', { field: 'months' });
      const methods = payMethods().map((m) => m.id);
      const method = methods.includes(body.method) ? body.method : 'call';
      const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) || null : null;
      const branches = control.branchesOfBrand(brandId).filter((br) => !br.deleted_at);
      if (!branches.length) throw new HttpError(400, 'مفيش فروع تشترك فيها');
      if (control.billingRequestsOfBrand(brandId).some((r) => r.status === 'pending')) {
        throw new HttpError(409, 'عندك طلب اشتراك لسه بنأكده. هنكلمك في أقرب وقت');
      }
      const q = quote(branches.length, months);
      const request = control.createBillingRequest({
        brandId, branchIds: branches.map((br) => br.id), months, amountEgp: q.total, method, reference,
      });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'billing.request', brandId, detail: { id: request.id, months, amount: q.total, method }, ip: req.ip });
      return reply.code(201).send(billingView(brandId));
    });

    // ---- the managers' apps: live changes, alerts, phones to notify ----

    // Server-sent events: «changed» whenever anything of these branches changes (orders, settings,
    // the super's plan changes, cashier screens), and «alert» for a new alert. Clients refetch.
    b.get('/events', async (req, reply) => {
      const sse = openSse(req, reply);
      sse.send('hello', { at: Date.now() });
      const brandId = req.params.brand;
      const mine = () => control.branchesOfBrand(brandId).filter((br) => !br.deleted_at && (!req.scope || br.id === req.scope));
      let timer = null;
      const changed = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          sse.send('changed', { at: Date.now() });
        }, 400);
      };
      const listeners = [];
      // Access is checked on every event: a deleted or signed-out manager stops receiving at once.
      const listen = (channel, fn) => {
        const guarded = (event, data) => {
          try {
            requireOwner(req, deps, brandId);
          } catch {
            sse.close();
            return;
          }
          fn(event, data);
        };
        bus.on(channel, guarded);
        listeners.push([channel, guarded]);
      };
      for (const br of mine()) listen(channels(br.id).bar, changed);
      listen(brandChannel(brandId), (event, data) => {
        if (event === 'alert' && req.scope && data?.branchId && data.branchId !== req.scope) return;
        if (event === 'alert') sse.send('alert', data);
        changed();
      });
      sse.onClose(() => {
        clearTimeout(timer);
        for (const [channel, fn] of listeners) bus.off(channel, fn);
      });
    });

    b.get('/alerts', async (req) => {
      const afterId = Math.max(0, Number(req.query.after) || 0);
      return { alerts: control.alertsFor(req.params.brand, req.scope, { afterId }).map(alertView) };
    });

    // This phone gets the alerts: { token, platform: ios | android }.
    b.post('/push-devices', async (req) => {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const platform = req.body?.platform === 'android' ? 'android' : 'ios';
      if (!/^[A-Za-z0-9:_-]{16,300}$/.test(token)) throw new HttpError(400, 'مش مظبوط', { field: 'token' });
      control.savePushDevice({ token, ownerId: req.owner.id, brandId: req.params.brand, platform });
      return { ok: true };
    });

    b.post('/push-devices/delete', async (req) => {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      // Only this account's own phone.
      if (token) control.dropPushDevice(token, req.owner.id);
      return { ok: true };
    });

    // ---- messages to the cashier screens (owner only) ----

    const ANNOUNCE_MAX = 280;
    b.get('/announcements', async (req) => {
      ownerOnly(req);
      return { announcements: control.announcementsOfBrand(req.params.brand) };
    });

    b.post('/announcements', async (req, reply) => {
      ownerOnly(req);
      const brandId = req.params.brand;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text || text.length > ANNOUNCE_MAX) throw new HttpError(400, `اكتب الرسالة (لحد ${ANNOUNCE_MAX} حرف)`, { field: 'text' });
      const live = control.branchesOfBrand(brandId).filter((br) => !br.deleted_at).map((br) => br.id);
      let branchIds = Array.isArray(req.body?.branchIds) ? req.body.branchIds.filter((id) => live.includes(id)) : null;
      if (branchIds && !branchIds.length) throw new HttpError(400, 'اختار فرع واحد على الأقل', { field: 'branchIds' });
      if (branchIds && branchIds.length === live.length) branchIds = null;
      const days = [1, 3, 7].includes(Number(req.body?.days)) ? Number(req.body.days) : 3;
      const id = control.createAnnouncement({ brandId, text, branchIds, days, actor: `owner:${req.owner.id}` });
      for (const branchId of branchIds ?? live) {
        bus.emit(channels(branchId).bar, 'announcements', control.announcementsForBranch(branchId));
      }
      control.audit({ actor: `owner:${req.owner.id}`, action: 'announcement.send', brandId, detail: { id, branches: branchIds?.length ?? 'all' }, ip: req.ip });
      return reply.code(201).send({ announcements: control.announcementsOfBrand(brandId) });
    });

    b.post('/announcements/:id/delete', async (req) => {
      ownerOnly(req);
      control.deleteAnnouncement(Number(req.params.id), req.params.brand);
      for (const br of control.branchesOfBrand(req.params.brand)) {
        bus.emit(channels(br.id).bar, 'announcements', control.announcementsForBranch(br.id));
      }
      return { announcements: control.announcementsOfBrand(req.params.brand) };
    });

    // ---- a branch's cashiers, each with their own PIN (owner or that branch's manager) ----

    const staffView = (s) => ({ id: s.id, name: s.name, pin: unseal(config.cookieSecret, s.pin_sealed) });
    b.get('/branches/:branch/staff', async (req) => ({ staff: ownBranch(req).store.listStaff().map(staffView) }));

    async function staffPin(ctx, typed, exceptId = null) {
      const pin = typed ? String(typed).trim() : newPin(6);
      if (!PIN_RE.test(pin)) throw new HttpError(400, 'الرقم السري من 4 لـ 8 أرقام', { field: 'pin' });
      // Two people with one PIN would sign in as each other (or as the branch).
      const taken = [ctx.store.getShop().pin_hash, ...ctx.store.listStaff().filter((s) => s.id !== exceptId).map((s) => s.pin_hash)];
      for (const hash of taken) {
        if (await verifyPin(pin, hash)) throw new HttpError(409, 'الرقم السري ده مستخدم في الفرع، اختار غيره', { field: 'pin' });
      }
      return { pin, fields: await pinFields(config.cookieSecret, pin) };
    }

    b.post('/branches/:branch/staff', async (req, reply) => {
      const ctx = ownBranch(req);
      if (ctx.store.listStaff().length >= MAX_STAFF) throw new HttpError(400, `أقصى عدد ${MAX_STAFF} كاشير للفرع`);
      const name = cleanPersonName(req.body?.name);
      const { fields } = await staffPin(ctx, req.body?.pin);
      const staff = ctx.store.addStaff({ name, pinHash: fields.pin_hash, pinSealed: fields.pin_sealed });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'staff.add', brandId: req.params.brand, branchId: ctx.branch.id, detail: { name }, ip: req.ip });
      return reply.code(201).send({ staff: ctx.store.listStaff().map(staffView), added: staffView(staff) });
    });

    b.post('/branches/:branch/staff/:staff/pin', async (req) => {
      const ctx = ownBranch(req);
      const staff = ctx.store.getStaff(Number(req.params.staff));
      if (!staff) throw new HttpError(404, 'الكاشير ده مش موجود');
      const { fields } = await staffPin(ctx, req.body?.pin, staff.id);
      ctx.store.setStaffPin(staff.id, { pinHash: fields.pin_hash, pinSealed: fields.pin_sealed });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'staff.pin', brandId: req.params.brand, branchId: ctx.branch.id, detail: { name: staff.name }, ip: req.ip });
      return { staff: ctx.store.listStaff().map(staffView) };
    });

    b.post('/branches/:branch/staff/:staff/delete', async (req) => {
      const ctx = ownBranch(req);
      const staff = ctx.store.getStaff(Number(req.params.staff));
      if (!staff) throw new HttpError(404, 'الكاشير ده مش موجود');
      ctx.store.deleteStaff(staff.id);
      control.audit({ actor: `owner:${req.owner.id}`, action: 'staff.delete', brandId: req.params.brand, branchId: ctx.branch.id, detail: { name: staff.name }, ip: req.ip });
      return { staff: ctx.store.listStaff().map(staffView) };
    });

    // ---- the account itself ----

    b.post('/account/password', async (req) => {
      const { current, password } = req.body ?? {};
      if (!(await verifyPin(String(current ?? ''), req.owner.password_hash))) {
        throw new HttpError(400, 'كلمة السر الحالية غلط', { field: 'current' });
      }
      const fields = await passwordFields(config.cookieSecret, checkNewPassword(password));
      const owner = control.resetOwnerPassword(req.owner.id, fields);
      control.audit({ actor: `owner:${owner.id}`, action: 'owner.password', brandId: req.params.brand, ip: req.ip });
      return { ok: true };
    });

    // Closes the account (App Store and Google Play ask for it): the brand and every branch stop
    // and go to the trash, the owner is signed out. The super can bring it back on request.
    b.post('/account/delete', async (req, reply) => {
      ownerOnly(req);
      if (!(await verifyPin(String(req.body?.password ?? ''), req.owner.password_hash))) {
        throw new HttpError(400, 'كلمة السر غلط', { field: 'password' });
      }
      control.trashBrand(req.params.brand);
      control.audit({ actor: `owner:${req.owner.id}`, action: 'account.delete', brandId: req.params.brand, ip: req.ip });
      reply.clearCookie(OWNER_COOKIE, { path: '/' });
      return { ok: true };
    });

    // Promo image: PNG/JPG/WEBP (checked by magic bytes), up to 500 KB, in the branch's media.
    b.post('/branches/:branch/promo-image', async (req) => {
      const ctx = ownBranch(req);
      if (Buffer.isBuffer(req.body) && req.body.length > PROMO_IMAGE_MAX_BYTES) {
        throw new HttpError(413, 'الصورة لازم تكون أقل من 500 كيلوبايت', { field: 'promoImage' });
      }
      const ext = sniffImage(req.body);
      if (!ext) throw new HttpError(400, 'الصورة لازم تكون PNG أو JPG أو WEBP', { field: 'promoImage' });
      const old = ctx.store.getShop().promo_image;
      const file = `promo-${Date.now()}.${ext}`;
      await fs.promises.writeFile(path.join(ctx.mediaDir, file), req.body);
      if (old) await fs.promises.rm(path.join(ctx.mediaDir, old), { force: true });
      ctx.store.updateShop({ promo_image: file });
      control.audit({ actor: `owner:${req.owner.id}`, action: 'promo.image', brandId: req.params.brand, branchId: ctx.branch.id, ip: req.ip });
      return { imageUrl: `/media/b/${ctx.branch.id}/${file}` };
    });

    b.delete('/branches/:branch/promo-image', async (req) => {
      const ctx = ownBranch(req);
      const old = ctx.store.getShop().promo_image;
      if (old) await fs.promises.rm(path.join(ctx.mediaDir, old), { force: true });
      ctx.store.updateShop({ promo_image: null });
      return { imageUrl: null };
    });
  }, { prefix: '/api/brand/:brand' });
}
