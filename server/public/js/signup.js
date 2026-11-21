// /signup: «اطلب حساب». Aurexis makes every account; this leaves the request in /super and
// offers the same message on WhatsApp.

import { icons } from './icons.js';
import { api } from './util.js';

const $ = (id) => document.getElementById(id);
const form = $('request');
let wa = null;

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icons[el.dataset.icon]?.(26) ?? '';

const waLink = (text) => (wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : '/support');
const message = () => {
  const f = form.elements;
  return [
    'أهلًا، عايز حساب Pocket Pager',
    `الاسم: ${f.name.value.trim()}`,
    `المطعم: ${f.brandName.value.trim()}`,
    `عدد الفروع: ${f.branches.value || 1}`,
    `موبايلي: ${f.phone.value.trim()}`,
    f.note.value.trim(),
  ].filter(Boolean).join('\n');
};

function showError(text, field) {
  const error = $('form-error');
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  error.hidden = !text;
  error.textContent = text ?? '';
  if (field && form.elements[field]) {
    form.elements[field].setAttribute('aria-invalid', 'true');
    form.elements[field].focus();
  }
}

form.addEventListener('input', () => {
  $('wa').href = waLink(message());
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  if (f.name.value.trim().length < 2) return showError('اكتب اسمك', 'name');
  if (f.phone.value.replace(/\D/g, '').length < 8 && !/[٠-٩]{8,}/.test(f.phone.value)) return showError('اكتب رقم موبايلك صح، زي 01012345678', 'phone');
  if (f.brandName.value.trim().length < 2) return showError('اكتب اسم المطعم', 'brandName');
  showError(null);
  const send = $('send');
  send.disabled = true;
  send.textContent = 'بنبعت…';
  try {
    await api('/api/account-requests', {
      method: 'POST',
      body: {
        name: f.name.value.trim(), phone: f.phone.value.trim(), brandName: f.brandName.value.trim(),
        branches: Number(f.branches.value) || 1, note: f.note.value.trim(),
      },
    });
    $('done-wa').href = waLink(message());
    form.hidden = true;
    $('done').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (err) {
    showError(err.message, err.data?.field);
    send.disabled = false;
    send.textContent = 'ابعت الطلب';
  }
});

api('/api/signup/info').then((info) => {
  wa = info.support;
  $('wa').href = waLink(message());
}).catch(() => {});
