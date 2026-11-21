// /welcome: the store apps' first screen. Someone already signed in goes straight to their
// dashboard (the page remembers the brand after login / sign-up); the rest see three short
// pictures of what Pocket Pager does, then sign up or log in.

import { icons } from './icons.js';
import { api } from './util.js';

export const BRAND_KEY = 'pp:brand';

const $ = (id) => document.getElementById(id);
let brand = null;
try {
  brand = localStorage.getItem(BRAND_KEY);
} catch {
  /* private mode */
}
if (brand && /^[a-z0-9-]{3,32}$/.test(brand)) location.replace(`/brand/${brand}`);

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icons[el.dataset.icon]?.(56) ?? '';

let current = 0;
function go(n) {
  current = (n + 3) % 3;
  for (const s of document.querySelectorAll('.slide')) s.hidden = Number(s.dataset.slide) !== current;
  for (const d of document.querySelectorAll('[data-go]')) d.setAttribute('aria-selected', String(Number(d.dataset.go) === current));
}
$('dots').addEventListener('click', (e) => {
  const d = e.target.closest('[data-go]');
  if (d) go(Number(d.dataset.go));
});
// A swipe moves between the pictures (right to left reading: a swipe to the right goes on).
let startX = null;
$('slides').addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
$('slides').addEventListener('touchend', (e) => {
  if (startX == null) return;
  const dx = e.changedTouches[0].clientX - startX;
  if (Math.abs(dx) > 40) go(current + (dx > 0 ? 1 : -1));
  startX = null;
});
const timer = setInterval(() => go(current + 1), 4500);
$('slides').addEventListener('touchstart', () => clearInterval(timer), { once: true, passive: true });
go(0);

api('/api/signup/info').then((info) => {
  if (info.support) $('wa').href = `https://wa.me/${info.support}`;
}).catch(() => {});
