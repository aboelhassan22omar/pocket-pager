// Shapes the API exposes. Never leak pin_hash, nonces or keys outside bar-only views.

import { brandTheme, readableAccent } from '../public/js/color.js';
import { localMobile } from './contact.js';
import { loyaltyEnabled } from './loyalty.js';
import { featureFlags } from './plans.js';

/** Google review link of this branch: its own link (branch settings) first, else the place id. */
export function reviewUrl(shop) {
  if (shop.google_review_url) return shop.google_review_url;
  if (shop.google_place_id) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(shop.google_place_id)}`;
  }
  return null;
}

export const reviewEnabled = (shop) => featureFlags(shop).review;

export const DONE_MESSAGES = {
  picked: 'بالهنا والشفا',
  expired: 'الطلب ده انتهى',
  cancelled: 'الطلب ده اتلغى',
};

export function statusMessage(order, shop) {
  if (order.status === 'preparing') return shop.preparing_message;
  if (order.status === 'ready') return shop.ready_message;
  if (order.status === 'out_for_delivery') return order.driver_name ? `طلبك في الطريق مع ${order.driver_name}` : 'طلبك في الطريق';
  if (order.status === 'picked' && order.order_type === 'delivery') return 'طلبك وصل، بالهنا والشفا';
  return DONE_MESSAGES[order.status] ?? '';
}

export const logoUrl = (shop) => (shop.logo ? `/media/b/${shop.id}/${shop.logo}` : null);

export const promoEnabled = (shop) => featureFlags(shop).promo;

/** The promo while the feature is on and `today` (local YYYY-MM-DD) is inside its dates. */
export function promoView(shop, today) {
  if (!promoEnabled(shop) || (!shop.promo_text && !shop.promo_image)) return null;
  if (shop.promo_starts_at && today < shop.promo_starts_at) return null;
  if (shop.promo_ends_at && today > shop.promo_ends_at) return null;
  return { text: shop.promo_text ?? '', imageUrl: shop.promo_image ? `/media/b/${shop.id}/${shop.promo_image}` : null };
}

// `today` (local day) is only passed for the customer page, the one place the promo shows.
export const publicShop = (shop, { today } = {}) => ({
  id: shop.id,
  name: shop.name,
  logoUrl: logoUrl(shop),
  preparingMessage: shop.preparing_message,
  readyMessage: shop.ready_message,
  // {color, ink} already adjusted for contrast; null = the default accent.
  accent: shop.accent_color ? readableAccent(shop.accent_color) : null,
  // The whole page in the logo's color (surfaces, text, accent); null = the default look.
  theme: shop.accent_color ? brandTheme(shop.accent_color) : null,
  // After pickup: the Google review button (the page's own stars are gone).
  feedback: reviewEnabled(shop),
  googleReviewUrl: reviewEnabled(shop) ? reviewUrl(shop) : null,
  // «رسالة للإدارة» at the bottom of the order page.
  messageBox: Boolean(shop.message_box),
  // «شارك الطلب»: the order's link for someone with the customer (off = one phone per order).
  orderShare: shop.order_share == null ? true : Boolean(shop.order_share),
  // Stamp card rule (phase 6); the device's own count comes from GET /loyalty.
  // product: the card counts this product only (the cashier is asked at handover); null = every order.
  loyalty: loyaltyEnabled(shop) ? { every: shop.loyalty_every, rewardText: shop.loyalty_reward_text ?? '', product: shop.loyalty_product ?? null } : null,
  promo: today ? promoView(shop, today) : null,
});

/** A loyalty reward attached to this order (shown on the bar and to the customer). */
const orderReward = (order, shop) => (order.reward_id && loyaltyEnabled(shop)
  ? { text: shop.loyalty_reward_text ?? '', redeemed: Boolean(order.reward_redeemed_at) }
  : null);

export const publicOrder = (order, shop) => ({
  id: order.id,
  shopId: shop.id,
  shopName: shop.name,
  number: order.number,
  // What the customer's receipt says, when a POS terminal prefixes it ("2-1008").
  ref: order.ref ?? null,
  // Takeaway numbers typed by the cashier: the receipt this order's number was given for.
  receipt: order.receipt ?? null,
  status: order.status,
  message: statusMessage(order, shop),
  createdAt: order.created_at,
  readyAt: order.ready_at ?? null,
  closedAt: order.closed_at ?? null,
  notifyCount: order.notify_count,
  rev: order.rev ?? 0,
  reward: orderReward(order, shop),
  // The customer has a stamp card on this order (it gets a stamp at handover).
  card: loyaltyEnabled(shop) && Boolean(order.device_hash),
  // Delivery: the driver (name, and a phone to call) only while the order is on its way.
  type: order.order_type ?? 'pickup',
  outAt: order.out_at ?? null,
  driver: order.status === 'out_for_delivery' && order.driver_name
    ? { name: order.driver_name, phone: localMobile(order.driver_phone), tel: order.driver_phone ? `+${order.driver_phone}` : null }
    : null,
});

/**
 * The cashier's view of an order: a delivery order also carries the customer's mobile and the
 * order's link, for «ابعت على واتساب». Never sent to customer pages.
 */
export const barOrder = (order, shop, config) => ({
  ...publicOrder(order, shop),
  ...(order.order_type === 'delivery' && order.customer_phone
    ? { customer: { phone: localMobile(order.customer_phone), wa: order.customer_phone }, link: orderUrl(config, shop.id, order.id) }
    : {}),
});

export const barShop = (shop) => ({
  ...publicShop(shop),
  accentColor: shop.accent_color ?? null,
  qrMode: shop.qr_mode,
  maxNumber: shop.max_number,
  expireHours: shop.expire_hours,
  lateAfterMinutes: shop.late_after_minutes ?? 10,
  reviewClicks: shop.review_clicks ?? 0,
  themeVersion: shop.theme_version ?? 0,
  posOnly: Boolean(shop.pos_only),
  orderQr: Boolean(shop.order_qr),
  orderShare: shop.order_share == null ? true : Boolean(shop.order_share),
  manualNumbers: Boolean(shop.manual_numbers),
  // Delivery by the branch's own drivers («توصيل جديد» on the cashier screen).
  delivery: Boolean(shop.delivery),
  deliveryCloseMinutes: shop.delivery_close_minutes ?? 60,
  dayStartHour: shop.day_start_hour ?? 0,
  timezone: shop.tz ?? null,
});

/** The link in an order's own QR: opens (joins) that order. */
export const orderUrl = (config, shopId, orderId) => `${config.publicUrl}/s/${shopId}?o=${orderId}&j=1`;

export function qrInfo(shop, config) {
  const base = `${config.publicUrl}/s/${shop.id}`;
  return {
    mode: shop.qr_mode,
    dynamicUrl: shop.qr_mode === 'static' ? null : `${base}?n=${shop.qr_nonce}`,
    staticUrl: shop.qr_mode === 'dynamic' ? null : `${base}?k=${shop.static_key}`,
    rotateSeconds: config.nonceRotateSeconds,
    expiresAt: shop.qr_rotated_at + config.nonceRotateSeconds * 1000,
    serverNow: Date.now(),
  };
}

export function appleStatus(config, apnsReady) {
  const a = config.apple;
  return {
    liveActivity: apnsReady,
    appClipBanner: Boolean(a.appId && a.clipBundleId),
    associatedDomains: Boolean(a.teamId),
    apnsEnv: a.env,
    clipBundleId: a.clipBundleId,
  };
}

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The link preview (WhatsApp, Facebook, X) of Pocket Pager's own pages: they need absolute URLs,
 * so the server fills <!--SHARE_META--> with PUBLIC_URL.
 */
export function shareMeta(config, { path = '/', title, description }) {
  const url = `${config.publicUrl}${path}`;
  const image = `${config.publicUrl}/img/brand/og-image-1200x630.png`;
  return [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Pocket Pager'],
    ['property', 'og:locale', 'ar_EG'],
    ['property', 'og:url', url],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:image', image],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', 'Pocket Pager: طلبك جاهز في جيبك'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', image],
  ].map(([k, n, v]) => `<meta ${k}="${n}" content="${attr(v)}">`).join('\n  ');
}

export const LANDING_SHARE = {
  title: 'Pocket Pager: طلبك جاهز في جيبك',
  description: 'العميل يمسح كود، ياخد رقم، وموبايله يرن أول ما طلبه يجهز. من غير تطبيق ولا أجهزة.',
};
export const DEMO_SHARE = {
  path: '/demo',
  title: 'جرّب Pocket Pager بنفسك',
  description: 'كافيه ديمو شغال بجد: خد رقم من موبايلك، دوس عليه من شاشة الكاشير، وشوف موبايلك بيرن.',
};

export function appleMeta(config) {
  const { appId, clipBundleId } = config.apple;
  if (!appId || !clipBundleId) return '';
  return `<meta name="apple-itunes-app" content="app-id=${attr(appId)}, app-clip-bundle-id=${attr(clipBundleId)}, app-clip-display=card">`;
}

export function appleAppSiteAssociation(config) {
  const { teamId, previousTeamId, appBundleId, clipBundleId } = config.apple;
  if (!teamId) return null;
  const teams = previousTeamId ? [teamId, previousTeamId] : [teamId];
  return {
    applinks: {
      details: [{ appIDs: teams.map((t) => `${t}.${appBundleId}`), components: [{ '/': '/s/*' }] }],
    },
    appclips: { apps: teams.map((t) => `${t}.${clipBundleId}`) },
  };
}
