// Pocket Pager service worker: ONE notification per order (tag order-<id>).
// preparing -> silent, ready -> sound + vibration, closed -> notification removed.
// Delivery: out for delivery -> one sound and a short vibration (the customer is at home).

const CLOSED = ['picked', 'expired', 'cancelled'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function notificationFor(data) {
  const ready = data.status === 'ready';
  const onTheWay = data.status === 'out_for_delivery';
  const options = {
    tag: `order-${data.orderId}`,
    requireInteraction: true,
    renotify: ready || onTheWay,
    silent: !ready && !onTheWay,
    body: data.message,
    dir: 'rtl',
    lang: 'ar',
    data: { url: `/s/${encodeURIComponent(data.shopId)}?o=${encodeURIComponent(data.orderId)}` },
  };
  if (ready) options.vibrate = [500, 200, 500, 200, 900];
  if (onTheWay) options.vibrate = [300, 150, 300];
  if (data.icon) options.icon = data.icon;
  let title = `${data.shopName}: طلب رقم ${data.number}`;
  if (ready) title = `طلبك رقم ${data.number} جاهز`;
  if (onTheWay) title = `طلبك رقم ${data.number} في الطريق`;
  return { title, options };
}

async function handlePush(data) {
  if (!data || !data.orderId) return;
  const tag = `order-${data.orderId}`;
  if (CLOSED.includes(data.status)) {
    const open = await self.registration.getNotifications({ tag });
    for (const n of open) n.close();
    return;
  }
  const { title, options } = notificationFor(data);
  // Ready (and each ring again): the old notification goes and a new one is posted. Some
  // Android phones stay silent when a quiet notification is only updated in place.
  if (options.renotify) {
    for (const n of await self.registration.getNotifications({ tag })) n.close();
  }
  await self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  event.waitUntil(handlePush(data));
});

self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data?.url ?? '/';
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).pathname === new URL(url, self.location.origin).pathname);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
