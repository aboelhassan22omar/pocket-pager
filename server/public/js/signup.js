// /signup: three short steps (you, your restaurant, its first branch), then the ready links
// and the cashier PIN. Every field explains itself; the preview shows what customers will see.

import { icons } from './icons.js';
import { cleanTyped, slugify, SLUG_RE } from './slug.js';
import { api, esc } from './util.js';

const $ = (id) => document.getElementById(id);
const form = $('signup');
const STEPS = 3;
const FIELD_STEP = { name: 1, phone: 1, password: 1, brandName: 2, brandId: 2, branchName: 3, branchSlug: 3 };
let step = 1;
let host = location.host;
let slugTouched = false;
let slugCheck = { id: null, ok: null };
let result = null;

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icons[el.dataset.icon]?.(22) ?? '';

// ---------- the live preview ----------

function updatePreview() {
  const name = form.elements.brandName.value.trim() || 'كافيه زد';
  const branch = form.elements.branchName.value.trim() || 'الفرع الرئيسي';
  for (const el of document.querySelectorAll('[data-preview="name"]')) el.textContent = name;
  for (const el of document.querySelectorAll('[data-preview="branch"]')) el.textContent = branch;
  for (const el of document.querySelectorAll('[data-preview="initial"]')) el.textContent = [...name][0] ?? 'ك';
  $('link-preview').textContent = `${host}/s/${branchId() || 'your-cafe'}`;
}

const brandId = () => form.elements.brandId.value.trim();
function branchId() {
  const b = form.elements.branchSlug.value.trim();
  return b ? `${brandId()}-${b}` : brandId();
}

// ---------- link name: suggested from the restaurant's name, checked as it's typed ----------

let checkTimer;
function scheduleCheck() {
  clearTimeout(checkTimer);
  const id = brandId();
  const state = $('slug-state');
  state.className = 'slug-state';
  if (!id) {
    state.textContent = '';
    return;
  }
  if (id.length < 3 || !SLUG_RE.test(id)) {
    state.textContent = 'من 3 حروف إنجليزي على الأقل، ومن غير - في الأول أو الآخر';
    state.classList.add('is-bad');
    slugCheck = { id, ok: false };
    return;
  }
  state.textContent = 'بنشوف الاسم متاح ولا لأ…';
  checkTimer = setTimeout(async () => {
    try {
      const res = await api(`/api/signup/check?brand=${encodeURIComponent(id)}`);
      if (brandId() !== id) return;
      slugCheck = { id, ok: res.brand.ok };
      state.textContent = res.brand.ok ? 'الاسم متاح' : res.brand.error;
      state.classList.add(res.brand.ok ? 'is-ok' : 'is-bad');
    } catch {
      state.textContent = '';
    }
  }, 350);
}

form.elements.brandName.addEventListener('input', () => {
  if (!slugTouched) {
    form.elements.brandId.value = slugify(form.elements.brandName.value);
    scheduleCheck();
  }
  updatePreview();
});
form.elements.brandId.addEventListener('input', (e) => {
  slugTouched = true;
  const caret = e.target.selectionStart;
  e.target.value = cleanTyped(e.target.value, 24);
  e.target.setSelectionRange(caret, caret);
  scheduleCheck();
  updatePreview();
});
form.elements.branchSlug.addEventListener('input', (e) => {
  e.target.value = cleanTyped(e.target.value, 20);
  updatePreview();
});
form.elements.branchName.addEventListener('input', updatePreview);

// ---------- steps ----------

function showError(message, field = null) {
  const error = $('form-error');
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (!message) {
    error.hidden = true;
    return;
  }
  error.textContent = message;
  error.hidden = false;
  const input = field ? form.elements[field] : null;
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

function goTo(n) {
  step = n;
  for (const s of form.querySelectorAll('.step')) s.hidden = Number(s.dataset.step) !== n;
  for (const li of $('steps').children) {
    const k = Number(li.dataset.step);
    li.classList.toggle('is-done', k < n);
    li.classList.toggle('is-now', k === n);
    if (k === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  $('back').hidden = n === 1;
  $('next').textContent = n === STEPS ? 'اعمل المطعم' : 'كمّل';
  showError(null);
  const first = form.querySelector(`.step[data-step="${n}"] input`);
  first?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** What's missing on this step, in the words next to the field. */
function checkStep(n) {
  const v = (name) => form.elements[name].value.trim();
  if (n === 1) {
    if (v('name').length < 2) return ['اكتب اسمك', 'name'];
    if (v('phone').replace(/\D/g, '').length < 8 && !/[٠-٩]{8,}/.test(v('phone'))) return ['اكتب رقم موبايلك صح، زي 01012345678', 'phone'];
    if (form.elements.password.value.length < 6) return ['كلمة السر 6 حروف أو أرقام على الأقل', 'password'];
  }
  if (n === 2) {
    if (v('brandName').length < 2) return ['اكتب اسم المطعم', 'brandName'];
    if (!SLUG_RE.test(v('brandId')) || v('brandId').length < 3) return ['اكتب اسم المطعم في اللينك بالإنجليزي (3 حروف على الأقل)', 'brandId'];
    if (slugCheck.id === v('brandId') && slugCheck.ok === false) return ['اسم اللينك ده مستخدم، جرّب اسم تاني', 'brandId'];
  }
  if (n === 3) {
    const b = v('branchSlug');
    if (b && (!SLUG_RE.test(b) || b.length < 2)) return ['اسم الفرع في اللينك بالإنجليزي، أو سيبه فاضي', 'branchSlug'];
  }
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const problem = checkStep(step);
  if (problem) {
    showError(...problem);
    return;
  }
  if (step < STEPS) {
    goTo(step + 1);
    return;
  }
  const next = $('next');
  next.disabled = true;
  next.textContent = 'بنجهّز مطعمك…';
  try {
    const f = form.elements;
    result = await api('/api/signup', {
      method: 'POST',
      body: {
        name: f.name.value.trim(),
        phone: f.phone.value.trim(),
        password: f.password.value,
        brandName: f.brandName.value.trim(),
        brandId: f.brandId.value.trim(),
        branchName: f.branchName.value.trim(),
        branchSlug: f.branchSlug.value.trim(),
      },
    });
    showDone();
  } catch (err) {
    const field = err.data?.field ?? null;
    if (field && FIELD_STEP[field] && FIELD_STEP[field] !== step) goTo(FIELD_STEP[field]);
    showError(err.message, field);
    next.disabled = false;
    next.textContent = 'اعمل المطعم';
  }
});

$('back').addEventListener('click', () => goTo(Math.max(1, step - 1)));

// The eye on the password.
for (const eye of document.querySelectorAll('[data-eye]')) {
  eye.innerHTML = eyeIcon(false);
  eye.addEventListener('click', () => {
    const input = $(eye.dataset.eye);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'اخفي كلمة السر' : 'اعرض كلمة السر');
    eye.innerHTML = eyeIcon(show);
  });
}
function eyeIcon(open) {
  const slash = open ? '' : '<path d="m3 3 18 18"/>';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${slash}</svg>`;
}

// ---------- done ----------

function showDone() {
  form.hidden = true;
  $('steps').hidden = true;
  $('done').hidden = false;
  $('done-pin').textContent = result.pin;
  $('open-bar').href = result.urls.bar;
  $('open-qr').href = result.urls.qr;
  $('to-dashboard').href = `/brand/${encodeURIComponent(result.brandId)}?welcome=1#branches`;
  $('done-lede').innerHTML = result.trial
    ? `عندك <strong>${esc(result.trialDays)} أيام ببلاش</strong>. فاضل 3 حاجات بسيطة وتبدأ تشتغل.`
    : 'الرقم ده جرّب قبل كده، فالفرع هيشتغل أول ما تشترك من لوحة التحكم ← «الاشتراك».';
  window.scrollTo({ top: 0 });
  $('h-done').focus?.();
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn || !result) return;
  try {
    await navigator.clipboard.writeText(result.urls[btn.dataset.copy]);
    const old = btn.textContent;
    btn.textContent = 'اتنسخ';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    window.prompt('انسخ اللينك:', result.urls[btn.dataset.copy]);
  }
});

// ---------- start ----------

(async () => {
  try {
    const info = await api('/api/signup/info');
    host = info.host || host;
    $('slug-host').textContent = `${host}/s/`;
    if (!info.signup) {
      showError('التسجيل مقفول دلوقتي. كلّمنا ونعملك الحساب بنفسنا.');
      $('next').disabled = true;
    }
    const days = info.trialDays;
    $('trial-line').textContent = days ? `وأول ${days} أيام ببلاش.` : '';
    $('trial-note').hidden = !days;
    $('trial-note').querySelector('strong').textContent = `جرّب ${days} أيام ببلاش.`;
  } catch {
    /* the defaults on the page are fine */
  }
  updatePreview();
  goTo(1);
})();
