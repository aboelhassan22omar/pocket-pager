// /login: the owner or a branch manager signs in with their phone and password, and lands on
// their dashboard (/brand/<id>; a manager sees their branch only).

import { api } from './util.js';

const $ = (id) => document.getElementById(id);
const form = $('login');
const next = new URLSearchParams(location.search).get('next');

function eyeIcon(open) {
  const slash = open ? '' : '<path d="m3 3 18 18"/>';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${slash}</svg>`;
}
const eye = document.querySelector('[data-eye]');
eye.innerHTML = eyeIcon(false);
eye.addEventListener('click', () => {
  const input = $(eye.dataset.eye);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(show));
  eye.innerHTML = eyeIcon(show);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('form-error');
  error.hidden = true;
  const login = form.elements.login.value.trim();
  const password = form.elements.password.value;
  if (!login || !password) {
    error.textContent = !login ? 'اكتب رقم موبايلك' : 'اكتب كلمة السر';
    error.hidden = false;
    (login ? form.elements.password : form.elements.login).focus();
    return;
  }
  const go = $('go');
  go.disabled = true;
  go.textContent = 'بندخلك…';
  try {
    const res = await api('/api/login', { method: 'POST', body: { login, password } });
    try {
      localStorage.setItem('pp:brand', res.brandId);
    } catch {
      /* private mode */
    }
    // Only our own dashboard path, never somewhere else.
    location.href = next && next.startsWith(`/brand/${res.brandId}`) ? next : res.to;
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    go.disabled = false;
    go.textContent = 'دخول';
  }
});

(async () => {
  try {
    const info = await api('/api/signup/info');
    if (info.support) $('forgot').href = `https://wa.me/${encodeURIComponent(info.support.replace(/\D/g, ''))}`;
  } catch {
    /* /support stays */
  }
  form.elements.login.focus();
})();
