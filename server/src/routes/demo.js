import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { ensureDemo, isSandbox } from '../demo.js';
import { createRateLimiter } from '../ratelimit.js';
import { PUBLIC_DIR } from '../paths.js';
import { setOwnerSession, setStaffSession } from '../sessions.js';
import { openSse } from '../sse.js';
import { dayIn } from '../util.js';
import { DEMO_SHARE, publicShop, shareMeta } from '../views.js';
import { HttpError } from '../errors.js';

const VISITOR_COOKIE = 'sp_demo';
const VISITOR_MAX_AGE = 365 * 24 * 3600;
// Which café is this visitor's own (see demo.js). Not a secret: the café holds nothing private.
const CAFE_COOKIE = 'sp_demo_cafe';
const CAFE_MAX_AGE = 7 * 24 * 3600;

// /demo: the one link sent to people from the ad. It signs the visitor in as the cashier and
// owner of their own demo café, and the page shows the customer, cashier and owner screens
// side by side. Two visitors never share a café.
export default async function demoRoutes(app, deps) {
  const { config, control, screens } = deps;
  const page = fs.readFileSync(path.join(PUBLIC_DIR, 'demo.html'), 'utf8').replace('<!--SHARE_META-->', shareMeta(config, DEMO_SHARE));
  // New cafés per address: a person reloading is fine, a script making thousands is not.
  const newCafes = createRateLimiter({ limit: 20, windowMs: 3600_000 });
  app.addHook('onClose', async () => newCafes.close());

  const customerPath = (shop) => `/s/${shop.id}?k=${encodeURIComponent(shop.static_key)}`;

  // The visitor's café from their cookie; a new one (and the cookie) when there is none.
  async function cafeOf(req, reply) {
    const wanted = req.cookies[CAFE_COOKIE];
    if (!isSandbox(wanted) && !newCafes.take(req.ip).ok) throw new HttpError(429, 'محاولات كتير. جرّب الديمو كمان شوية');
    const cafe = await ensureDemo(deps, wanted);
    if (cafe.id !== wanted) {
      reply.setCookie(CAFE_COOKIE, cafe.id, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: CAFE_MAX_AGE });
    }
    return cafe;
  }

  app.get('/demo', async (req, reply) => {
    const { ctx, owner } = await cafeOf(req, reply);
    const shop = ctx.store.getShop();
    setStaffSession(reply, config, shop);
    setOwnerSession(reply, config, owner);
    const newVisitor = !req.cookies[VISITOR_COOKIE];
    if (newVisitor) {
      reply.setCookie(VISITOR_COOKIE, '1', {
        httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: VISITOR_MAX_AGE,
      });
    }
    control.recordDemoVisit(dayIn(config.tz), { newVisitor });
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(page);
  });

  app.get('/api/demo', async (req, reply) => {
    const { ctx } = await cafeOf(req, reply);
    const shop = ctx.store.getShop();
    return { shopId: shop.id, brandId: shop.brand_id, name: shop.name, customerPath: customerPath(shop), theme: publicShop(shop).theme };
  });

  // The customer link as a QR: visitors scan it with their own phone and get a real number.
  app.get('/api/demo/qr.svg', async (req, reply) => {
    const { ctx } = await cafeOf(req, reply);
    const svg = await QRCode.toString(`${config.publicUrl}${customerPath(ctx.store.getShop())}`, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#17191d', light: '#ffffff' },
    });
    return reply.type('image/svg+xml; charset=utf-8').header('cache-control', 'no-store').send(svg);
  });

  // Open while the demo page is: "the demo is open on N screens now" on the super dashboard.
  app.get('/api/demo/live', async (req, reply) => {
    const sse = openSse(req, reply);
    screens.openDemo();
    sse.onClose(() => screens.closeDemo());
  });
}
