import { mountAnalytics } from './analytics.js';
import { watchAppUpdates } from './app-update.js';
import { Chime, DEFAULT_RING, RING_TONES } from './chime.js';
import { applyTheme } from './color.js';
import { appInviteText, branchCardHtml, devicesHtml, renewalHtml, renewalInfo } from './dashboard.js';
import { openFeatureList } from './features.js';
import { filePickHtml, openForm } from './forms.js';
import { icons } from './icons.js';
import { TEXT_DEFAULTS, TEXT_GROUPS, TEXT_MAX } from './texts.js';
import { toast } from './staff.js';
import {
  inStoreApp, openAddBranch, openBroadcast, openStaff, openDeleteAccount, openLinks, openPassword, planBannerHtml, renderBilling, renderTeam, welcomeHtml,
} from './owner-plus.js';
import { api, esc, isCashierApp, isIOS, reloadOnNewVersion, shopIdFromPath } from './util.js';

const POLL_MS = 30_000;
const $ = (id) => document.getElementById(id);
const brandId = shopIdFromPath(location.pathname);
const base = `/api/brand/${encodeURIComponent(brandId)}`;
let data = null;
let appView = null;

function showLogin() {
  const root = $('login-root');
  root.innerHTML = `
    <form class="login login-account" novalidate>
      <h1>دخول</h1>
      <p class="muted small">لصاحب المطعم ومدير الفرع.</p>
      <input class="input" name="username" dir="ltr" inputmode="tel" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="رقم الموبايل أو اسم المستخدم" aria-label="رقم الموبايل أو اسم المستخدم" required>
      <input class="input" name="password" type="password" autocomplete="current-password" placeholder="كلمة السر" aria-label="كلمة السر" required>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">دخول</button>
    </form>`;
  const form = root.querySelector('form');
  form.elements.username.focus();
  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const error = form.querySelector('.form-error');
      try {
        const res = await api('/api/login', {
          method: 'POST',
          body: { login: form.elements.username.value.trim(), password: form.elements.password.value },
        });
        // An owner always lands on their own brand.
        if (res.brandId !== brandId) {
          location.href = `/brand/${encodeURIComponent(res.brandId)}`;
          return;
        }
        root.innerHTML = '';
        resolve();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  });
}

// ---------- sections: a tab bar on phones, pills in the header on wider screens ----------

// The owner gets the team and (a self-serve brand) the subscription; a branch manager doesn't.
let TABS = [];
function tabsFor(d) {
  const owner = d.owner.role === 'owner';
  return [
    ['branches', owner ? 'الفروع' : 'فرعي', icons.store],
    ['analytics', 'التحليلات', icons.chart],
    ...(owner && !d.demo ? [['team', 'الفريق', icons.user]] : []),
    ...(owner && d.brand.selfServe && !d.demo && !inStoreApp() ? [['billing', 'الاشتراك', icons.gift]] : []),
    ['apps', 'التطبيقات', icons.phone],
    ['account', 'حسابي', icons.settings],
  ];
}
const TAB_KEY = `sp:owner-tab:${brandId}`;

function renderTabs() {
  for (const nav of document.querySelectorAll('[data-tabs]')) {
    const pills = nav.classList.contains('nav');
    const tabs = !pills && TABS.length > 5 ? TABS.filter(([id]) => id !== 'apps') : TABS;
    nav.innerHTML = tabs.map(([id, label, icon]) => (pills
      ? `<button class="nav-link" type="button" data-tab="${id}">${icon(18)}${label}</button>`
      : `<button type="button" data-tab="${id}"><span class="tab-icon">${icon(22)}</span>${label}</button>`)).join('');
    nav.addEventListener('click', (e) => {
      const el = e.target.closest('[data-tab]');
      if (el) showTab(el.dataset.tab, { scroll: true });
    });
  }
}

function showTab(id, { scroll = false } = {}) {
  if (!TABS.some(([t]) => t === id)) id = 'branches';
  for (const pane of document.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== id;
  for (const el of document.querySelectorAll('[data-tab]')) {
    const on = el.dataset.tab === id;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* private mode */
  }
  if (scroll) window.scrollTo({ top: 0 });
  loadPane(id);
}

/** The team and the subscription load when opened. */
function loadPane(id) {
  if (!data) return;
  if (id === 'team') renderTeam($('team-body'), { base, branches: data.branches }).catch((err) => toast(err.message, 'error'));
  if (id === 'billing') renderBilling($('billing-body'), { base, refresh }).catch((err) => toast(err.message, 'error'));
}

function firstTab() {
  const fromHash = location.hash.slice(1);
  if (fromHash) return fromHash;
  try {
    return localStorage.getItem(TAB_KEY) ?? 'branches';
  } catch {
    return 'branches';
  }
}

/** Today in every branch together, above the cards. */
function todayHtml(branches, { renewals = true } = {}) {
  const sum = (k) => branches.reduce((n, b) => n + (b[k] ?? 0), 0);
  const open = branches.filter((b) => b.screens > 0).length;
  const late = sum('lateToday');
  return `
    <div class="today-tile"><span>طلبات النهارده</span><strong class="num">${sum('ordersToday')}</strong></div>
    <div class="today-tile"><span>مفتوح دلوقتي</span><strong class="num">${sum('openNow')}</strong></div>
    <div class="today-tile"><span>متأخر</span><strong class="num ${late ? 'is-alert' : ''}">${late}</strong></div>
    <p class="today-note"><span class="dot" data-online="${open > 0}"></span>الكاشير مفتوح في ${open} من ${branches.length} ${branches.length === 1 ? 'فرع' : 'فروع'}</p>
    ${renewals ? renewalsDueHtml(branches) : ''}`;
}

/** Branches to renew within a week (or already late), soonest first. */
function renewalsDueHtml(branches) {
  const due = branches
    .map((b) => ({ b, r: renewalInfo(b.plan, b.lastPayment) }))
    .filter(({ r }) => r?.soon)
    .sort((x, y) => (x.b.plan.until ?? 0) - (y.b.plan.until ?? 0));
  if (!due.length) return '';
  return `
    <div class="renewals-due" role="note">
      <strong>${due.length === 1 ? 'فرع محتاج تجديد قريب' : `${due.length} فروع محتاجة تجديد قريب`}</strong>
      <ul>${due.map(({ b, r }) => `<li><span>${esc(b.name)}</span><span>${esc(r.title)}</span></li>`).join('')}</ul>
      <span class="muted small">التجديد بيتم مع Aurexis. كلّمنا قبل المعاد عشان الفرع مايقفش.</span>
    </div>`;
}

function render() {
  applyTheme(document.documentElement, data.brand.theme);
  $('brand-name').textContent = data.brand.name;
  $('brand-name').title = data.brand.name;
  document.title = `فروعي — ${data.brand.name}`;
  const who = data.owner.name ?? data.owner.username;
  $('owner-line').textContent = data.demo ? 'نسخة الديمو: ده اللي صاحب المحل بيشوفه'
    : data.owner.role === 'manager' ? `${who} · مدير الفرع` : `داخل باسم ${who}`;
  const logo = data.branches.find((b) => b.logoUrl)?.logoUrl;
  $('brand-logo').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : esc(data.brand.name.slice(0, 1));
  const owner = data.owner.role === 'owner';
  $('plan-banner').innerHTML = planBannerHtml(data);
  $('welcome').innerHTML = welcomeHtml(data);
  // One branch: its card already says it all.
  $('today').innerHTML = data.branches.length > 1 ? todayHtml(data.branches, { renewals: !data.brand.selfServe }) : '';
  $('branches-head').hidden = !owner || data.demo;
  // Aurexis adds branches; a self-serve brand (SIGNUP=on) adds its own.
  $('add-branch').hidden = !data.brand.selfServe;
  renderAccount();
  for (const id of ['h-ring', 'ring-body', 'h-texts', 'texts-body']) $(id).hidden = !owner;
  const now = Date.now();
  $('branches').innerHTML = data.branches.length
    ? `<div class="cards">${data.branches.map((b) => branchCardHtml(b, {
      now,
      extra: data.brand.selfServe ? '' : renewalHtml(b.plan, b.lastPayment),
      actions: `<button class="btn btn-sm btn-primary" data-act="links" data-branch="${esc(b.id)}" type="button">اللينكات والرقم السري</button>
        <button class="btn btn-sm" data-act="features" data-branch="${esc(b.id)}" type="button">الخصائص</button>
        <button class="btn btn-sm" data-act="staff" data-branch="${esc(b.id)}" type="button">الكاشيرية</button>
        ${b.delivery ? `<button class="btn btn-sm" data-act="drivers" data-branch="${esc(b.id)}" type="button">المناديب</button>` : ''}
        ${owner ? `<button class="btn btn-sm btn-quiet" data-act="rename" data-branch="${esc(b.id)}" type="button">غيّر الاسم</button>` : ''}`,
    })).join('')}</div>`
    : '<p class="empty-note">لسه مفيش فروع. دوس «ضيف فرع» فوق.</p>';
}

// ---------- what customers read, in the brand's own words ----------

let brandTexts = {};

function renderTexts() {
  const changed = Object.keys(brandTexts).length;
  $('texts-body').innerHTML = `
    <div class="creds texts-card">
      <p>كل جملة بتظهر للعميل في صفحة طلبه تقدر تكتبها بطريقتك: اسم بطاقة الختم، سؤال التقييم، الزراير، رسالة الطابور... في كل الفروع.</p>
      <p class="muted small">${changed ? `غيّرت ${changed} ${changed === 1 ? 'جملة' : changed === 2 ? 'جملتين' : 'جمل'}، والباقي بالكلام الأصلي.` : 'كله بالكلام الأصلي دلوقتي.'}
        رسايل «بيتحضّر» و«جاهز» بتتغيّر من إعدادات كل فرع.</p>
      ${data.demo ? '' : '<button class="btn btn-primary" data-act="texts" type="button">عدّل الكلام</button>'}
    </div>`;
}

async function loadTexts() {
  try {
    brandTexts = (await api(`${base}/texts`)).texts ?? {};
  } catch {
    brandTexts = {};
  }
  renderTexts();
}

function openTexts() {
  openForm({
    title: 'الكلام اللي العميل بيشوفه',
    intro: 'اكتب الجملة زي ما تحب تظهر. سيب الخانة فاضية عشان ترجع للكلام الأصلي (مكتوب باهت جوه الخانة). الكلمات اللي بين {} زي {n} و{reward} سيبها زي ما هي، بيتحط مكانها الرقم أو الهدية.',
    submit: 'احفظ الكلام',
    fields: TEXT_GROUPS.flatMap((g) => [
      { type: 'heading', label: g.title },
      ...g.items.map(([key, label]) => ({
        name: key, label, value: brandTexts[key] ?? '', placeholder: TEXT_DEFAULTS[key], maxlength: TEXT_MAX,
      })),
    ]),
    onSubmit: async (v) => {
      const texts = Object.fromEntries(Object.keys(TEXT_DEFAULTS).map((k) => [k, v[k] ?? '']));
      brandTexts = (await api(`${base}/texts`, { method: 'POST', body: { texts } })).texts;
      renderTexts();
      toast('اتحفظ، والعملاء هيشوفوه من الطلب الجاي');
    },
  });
}

// ---------- the customers' ring: a tone of the library, or the brand's own sound ----------

let ring = { tone: DEFAULT_RING, url: null };
const preview = new Chime();
const RING_FILE_MAX = 600 * 1024;

const toneLabel = (id) => RING_TONES.find((t) => t.id === id)?.label ?? RING_TONES[0].label;

function renderRing() {
  $('ring-body').innerHTML = `
    <div class="creds texts-card">
      <p>الصوت اللي موبايل العميل بيرنه لما طلبه يجهز، في كل الفروع.</p>
      <p class="muted small">دلوقتي: <strong>${ring.url ? 'صوت خاص بيك' : esc(toneLabel(ring.tone))}</strong>${ring.tone === DEFAULT_RING && !ring.url ? ' (الأساسية)' : ''}.
        رنة الإشعار والشاشة مقفولة بتبقى صوت إشعارات موبايل العميل نفسه.</p>
      ${data.demo ? '' : '<button class="btn btn-primary" data-act="ring" type="button">اختار الرنة</button>'}
    </div>`;
}

async function loadRing() {
  try {
    ring = await api(`${base}/ring`);
  } catch {
    /* the default */
  }
  renderRing();
}

// The brand's own sound, as the customers' alarm stream needs it (src/alarm.js): any file the
// browser can play, made a 22050 Hz mono WAV of at most 6 s, with a short fade at the end.
const RING_RATE = 22050;
const RING_MAX_S = 6;

async function toRingWav(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    ctx.close?.();
  }
  const seconds = Math.min(decoded.duration, RING_MAX_S);
  const length = Math.max(1, Math.round(seconds * RING_RATE));
  const offline = new OfflineAudioContext(1, length, RING_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const samples = (await offline.startRendering()).getChannelData(0);
  const fade = Math.min(length, Math.round(0.03 * RING_RATE));
  const buf = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buf);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RING_RATE, true);
  view.setUint32(28, RING_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const gain = i >= length - fade ? (length - i) / fade : 1;
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// The picker: every tone with ▶ to hear it, plus the brand's own file.
function openRing() {
  let chosen = ring.url ? 'custom' : ring.tone;
  let file = null;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet ring-sheet" role="dialog" aria-modal="true" aria-labelledby="ring-title">
      <h2 id="ring-title">صوت الرنة</h2>
      <p class="muted small">دوس ▶ عشان تسمع، واختار اللي يعجبك.</p>
      <div class="ring-list" role="radiogroup" aria-label="الرنات">
        ${RING_TONES.map((t) => `
          <label class="ring-row">
            <input type="radio" name="ring" value="${esc(t.id)}" ${chosen === t.id ? 'checked' : ''}>
            <span class="ring-name">${esc(t.label)}${t.id === DEFAULT_RING ? ' <span class="muted small">(الأساسية)</span>' : ''}</span>
            <button class="btn btn-sm ring-play" type="button" data-play="${esc(t.id)}" aria-label="اسمع ${esc(t.label)}">▶</button>
          </label>`).join('')}
        <label class="ring-row">
          <input type="radio" name="ring" value="custom" ${chosen === 'custom' ? 'checked' : ''} ${ring.url ? '' : 'disabled'} id="ring-custom-radio">
          <span class="ring-name">صوت خاص بيك</span>
          <button class="btn btn-sm ring-play" type="button" data-play="custom" aria-label="اسمع الصوت الخاص" ${ring.url ? '' : 'hidden'} id="ring-custom-play">▶</button>
        </label>
        <div class="ring-upload">
          ${filePickHtml({ id: 'ring-file', accept: 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a', text: 'ارفع صوت من عندك' })}
          <p class="muted small">MP3 أو WAV أو OGG أو M4A، أقل من 600 كيلوبايت. أول 6 ثواني بس بتترن.</p>
        </div>
      </div>
      <p class="form-error" id="ring-error" hidden></p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" type="button" data-save>احفظ</button>
        <button class="btn btn-quiet btn-block" type="button" data-close>رجوع</button>
      </div>
    </div>`;
  document.body.append(backdrop);
  const close = () => {
    preview.stop();
    backdrop.remove();
  };
  const error = (message) => {
    const el = backdrop.querySelector('#ring-error');
    el.textContent = message;
    el.hidden = !message;
  };

  backdrop.addEventListener('change', (e) => {
    if (e.target.name === 'ring') chosen = e.target.value;
    if (e.target.id !== 'ring-file') return;
    const picked = e.target.files?.[0] ?? null;
    error('');
    if (picked && picked.size > RING_FILE_MAX) {
      e.target.value = '';
      error('الملف لازم يكون أقل من 600 كيلوبايت');
      return;
    }
    file = picked;
    if (!file) return;
    const radio = backdrop.querySelector('#ring-custom-radio');
    radio.disabled = false;
    radio.checked = true;
    chosen = 'custom';
    backdrop.querySelector('#ring-custom-play').hidden = false;
  });

  backdrop.addEventListener('click', async (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) {
      close();
      return;
    }
    const play = e.target.closest('[data-play]');
    if (play) {
      e.preventDefault();
      preview.unlock();
      preview.stop();
      if (play.dataset.play === 'custom' && file) {
        await preview.useFile(file);
        if (!preview.customBuffer) {
          error('الملف ده مش بيشتغل كصوت. جرّب ملف MP3 تاني');
          return;
        }
      } else if (play.dataset.play === 'custom') {
        preview.useRing({ tone: DEFAULT_RING, url: ring.url });
        await preview.loadCustom();
      } else {
        preview.useRing({ tone: play.dataset.play });
      }
      preview.play('ready');
      return;
    }
    if (!e.target.closest('[data-save]')) return;
    const button = e.target.closest('[data-save]');
    button.disabled = true;
    error('');
    try {
      if (chosen === 'custom' && file) {
        let wav;
        try {
          wav = await toRingWav(file);
        } catch {
          throw new Error('الملف ده مش صوت أو المتصفح مش عارف يشغّله. جرّب MP3 أو WAV');
        }
        ring = await api(`${base}/ring-file`, { method: 'POST', raw: wav, contentType: 'audio/wav' });
      } else if (chosen !== 'custom') {
        ring = await api(`${base}/ring`, { method: 'POST', body: { tone: chosen } });
      }
      renderRing();
      close();
      toast('اتحفظ، والعملاء هيسمعوه من الطلب الجاي');
    } catch (err) {
      error(err.message);
      button.disabled = false;
    }
  });
}

// ---------- account: the owner's own email and phone ----------

const notSet = '<span class="muted">مش متسجّل</span>';

function renderAccount() {
  const o = data.owner;
  // The demo signs visitors in by itself; editing or logging out would only strand them.
  $('account-body').innerHTML = `
    <dl class="account-card">
      ${o.name ? `<div><dt>الاسم</dt><dd>${esc(o.name)}</dd></div>` : ''}
      <div><dt>${o.role === 'manager' ? 'بتدخل بـ' : 'اسم المستخدم'}</dt><dd dir="ltr">${esc(o.username)}</dd></div>
      <div><dt>الصلاحية</dt><dd>${o.role === 'manager' ? 'مدير فرع' : 'صاحب المطعم'}</dd></div>
      <div><dt>الإيميل</dt><dd dir="ltr">${o.email ? esc(o.email) : notSet}</dd></div>
      <div><dt>التليفون</dt><dd dir="ltr">${o.phone ? esc(o.phone) : notSet}</dd></div>
    </dl>
    <a class="btn btn-block d-md-none apps-link" href="#apps" data-tab-link="apps">${icons.phone(20)}التطبيقات: تطبيق الكاشير وتطبيقك</a>
    <p class="muted small">الإيميل والتليفون اختياريين. بنستخدمهم عشان نكلمك لو فيه حاجة تخص الفروع أو الاشتراك.</p>
    ${data.demo ? '' : `
    <div class="account-actions">
      <button class="btn btn-primary" data-act="contact" type="button">عدّل الإيميل والتليفون</button>
      <button class="btn" data-act="password" type="button">غيّر كلمة السر</button>
      <button class="btn btn-quiet" data-act="logout" type="button">${icons.logout(20)}خروج</button>
    </div>
    ${o.role === 'owner' ? `<details class="danger-zone"><summary>اقفل الحساب</summary>
      <p class="muted small">بيوقّف المطعم وكل فروعه. استخدمه بس لو مش عايز تكمّل.</p>
      <button class="btn btn-danger" data-act="delete" type="button">اقفل حسابي</button></details>` : ''}`}`;
}

function accountAction(act) {
  if (act === 'password') {
    openPassword({ base });
    return;
  }
  if (act === 'delete') {
    openDeleteAccount({ base });
    return;
  }
  if (act === 'logout') {
    try {
      localStorage.removeItem('pp:brand');
    } catch {
      /* private mode */
    }
    api(`${base}/logout`, { method: 'POST' }).finally(() => location.reload());
    return;
  }
  openForm({
    title: 'بياناتك',
    intro: 'الاتنين اختياريين. سيب الخانة فاضية عشان تشيلها.',
    fields: [
      { name: 'email', label: 'الإيميل', type: 'email', dir: 'ltr', value: data.owner.email ?? '', placeholder: 'name@example.com' },
      { name: 'phone', label: 'التليفون', type: 'tel', inputmode: 'tel', dir: 'ltr', value: data.owner.phone ?? '', placeholder: '01xxxxxxxxx' },
    ],
    onSubmit: async (v) => {
      const res = await api(`${base}/account`, { method: 'POST', body: { email: v.email ?? '', phone: v.phone ?? '' } });
      data.owner = res.owner;
      renderAccount();
      toast('اتحفظ');
    },
  });
}

// ---------- cashier app: link + password to forward, and where it is installed ----------

const copyBtn = (value) => `<button class="link-btn" data-copy="${esc(value)}" type="button">انسخ</button>`;

// ---------- the owner's own app ----------

let ownerApp = null;

function ownerAppHtml() {
  if (isCashierApp()) {
    return `<div class="creds"><p class="muted">إنت فاتح تطبيقك دلوقتي. لما تنزل نسخة جديدة هيظهر لك شريط «حدّث» فوق.</p></div>`;
  }
  const p = ownerApp?.platforms ?? {};
  const btn = (id, label) => (p[id]?.available
    ? `<a class="btn btn-primary" href="${esc(p[id].url)}" download>${icons.download(20)}${label}</a>`
    : `<button class="btn" type="button" disabled>${label} (لسه بيتجهز)</button>`);
  const ios = isIOS(navigator)
    ? '<p class="muted small">على الآيفون مفيش تطبيق: افتح الصفحة دي من Safari، ودوس مشاركة ← «إضافة إلى الشاشة الرئيسية». هتبقى أيقونة زي التطبيق.</p>'
    : '';
  return `
    <div class="creds owner-app">
      <p>صفحتك دي كتطبيق على موبايلك أو الكمبيوتر، باسم «إدارة ${esc(data.brand.name)}» ولوجو البراند. بتفتح على فروعك على طول.</p>
      <div class="owner-app-actions">${btn('android', 'نزّل لأندرويد')}${btn('windows', 'نزّل لويندوز')}</div>
      ${ios}
      <p class="muted small">ده غير تطبيق الكاشير، والاتنين يتركبوا على نفس الموبايل عادي. لما اللوجو أو الاسم يتغيّر، التطبيق بيقولك «حدّث» ويتحدّث من غير ما تمسحه.</p>
    </div>`;
}

async function loadOwnerApp() {
  try {
    ownerApp = await api(`${base}/owner-app`);
  } catch {
    ownerApp = null;
  }
  $('owner-app-body').innerHTML = ownerAppHtml();
}

function renderApp() {
  if (!appView) {
    $('app-body').innerHTML = '<p class="empty-note">مش قادرين نجيب بيانات التطبيق دلوقتي. جرّب كمان شوية.</p>';
    return;
  }
  if (!appView.enabled) {
    $('app-body').innerHTML = '<p class="empty-note">تطبيق الكاشير لسه مش متفعّل لبراندك. كلّم Aurexis عشان يتفعّل.</p>';
    return;
  }
  $('app-body').innerHTML = `
    <div class="creds">
      <dl class="creds-list">
        <div><dt>لينك التحميل</dt><dd dir="ltr"><a href="${esc(appView.url)}" target="_blank" rel="noopener">${esc(appView.url.replace(/^https?:\/\//, ''))}</a>${copyBtn(appView.url)}</dd></div>
        <div><dt>الباسورد</dt><dd dir="ltr">${appView.password ? `<span>${esc(appView.password)}</span>${copyBtn(appView.password)}` : '<span class="muted">اسأل Aurexis</span>'}</dd></div>
      </dl>
      <button class="btn btn-sm btn-primary" data-act="invite" type="button">انسخ رسالة لمديرين الفروع</button>
    </div>
    <p class="muted">ابعت الرسالة دي لمديرين الفروع. كل فرع بينزّل التطبيق على جهاز الكاشير (أندرويد أو ويندوز)، ويختار فرعه ويكتب الرقم السري بتاعه. أي جهاز تفصله بيرجع يطلب الفرع والرقم السري.</p>
    ${devicesHtml(appView, data.branches, {
      actions: (d) => `
        <button class="link-btn" data-act="device-rename" data-device="${esc(d.id)}" type="button">غيّر الاسم</button>
        <button class="link-btn" data-act="device-revoke" data-device="${esc(d.id)}" type="button">افصل</button>`,
    })}`;
}

async function loadApp() {
  try {
    appView = await api(`${base}/app`);
  } catch {
    appView = null;
  }
  renderApp();
}

function appAction(el) {
  const act = el.dataset.act;
  if (el.dataset.copy !== undefined) {
    navigator.clipboard?.writeText(el.dataset.copy).then(() => toast('اتنسخ'), () => {});
    return;
  }
  if (act === 'invite') {
    navigator.clipboard?.writeText(appInviteText(appView, data.brand.name)).then(() => toast('الرسالة اتنسخت'), () => {});
    return;
  }
  const device = appView.devices.find((d) => d.id === el.dataset.device);
  if (!device) return;
  const path = `${base}/devices/${encodeURIComponent(device.id)}`;
  if (act === 'device-rename') {
    openForm({
      title: 'اسم الجهاز',
      fields: [{ name: 'name', label: 'الاسم', value: device.name, placeholder: 'مثلًا: كاشير 1', maxlength: 40 }],
      onSubmit: async (v) => {
        await api(`${path}/rename`, { method: 'POST', body: { name: v.name } });
        await loadApp();
      },
    });
  } else if (act === 'device-revoke') {
    openForm({
      title: `افصل «${device.name}»؟`,
      intro: 'التطبيق على الجهاز ده هيرجع يطلب الفرع والرقم السري. استخدمها لو الجهاز اتسرق أو اتغيّر.',
      submit: 'افصل',
      danger: true,
      onSubmit: async () => {
        await api(`${path}/revoke`, { method: 'POST', body: {} });
        toast('الجهاز اتفصل');
        await loadApp();
      },
    });
  }
}

// ---------- the branch's delivery drivers ----------

const driversHtml = (list) => (list.length
  ? list.map((d) => `<li class="driver-row">
      <span class="driver-who"><strong>${esc(d.name)}</strong><span class="num" dir="ltr">${esc(d.phone)}</span></span>
      <span class="driver-actions">
        <button class="btn btn-sm" type="button" data-driver-edit="${d.id}">تعديل</button>
        <button class="btn btn-sm btn-danger" type="button" data-driver-delete="${d.id}">امسح</button>
      </span></li>`).join('')
  : '<li class="driver-empty muted">لسه مفيش مناديب. ضيف أول واحد تحت.</li>');

async function openDrivers(b) {
  const driversBase = `${base}/branches/${encodeURIComponent(b.id)}/drivers`;
  let list = (await api(driversBase)).drivers;
  let editing = null;
  const { form } = openForm({
    title: `مناديب ${b.name}`,
    intro: 'الكاشير بيختار منهم لما الطلب يخرج، والعميل بيشوف اسم المندوب ويقدر يتصل بيه وهو في الطريق.',
    fields: [
      { type: 'html', html: `<ul class="driver-list" id="driver-list">${driversHtml(list)}</ul>` },
      { type: 'heading', label: 'مندوب جديد' },
      { name: 'name', label: 'الاسم', maxlength: 40, placeholder: 'مثلًا: أحمد' },
      { name: 'phone', label: 'الموبايل', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '01012345678' },
    ],
    submit: 'ضيف المندوب',
    onSubmit: async (v) => {
      const body = { name: v.name ?? '', phone: v.phone ?? '' };
      const res = editing
        ? await api(`${driversBase}/${editing}`, { method: 'POST', body })
        : await api(driversBase, { method: 'POST', body });
      list = res.drivers;
      toast(editing ? 'اتعدّل' : 'المندوب اتضاف');
      reset();
      return true; // stays open for the next one
    },
  });
  const heading = form.querySelector('.form-heading');
  const submit = form.querySelector('[type=submit]');
  function reset() {
    editing = null;
    form.elements.name.value = '';
    form.elements.phone.value = '';
    heading.textContent = 'مندوب جديد';
    submit.textContent = 'ضيف المندوب';
    form.querySelector('#driver-list').innerHTML = driversHtml(list);
  }
  form.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-driver-edit]');
    const del = e.target.closest('[data-driver-delete]');
    if (edit) {
      const d = list.find((x) => String(x.id) === edit.dataset.driverEdit);
      if (!d) return;
      editing = d.id;
      form.elements.name.value = d.name;
      form.elements.phone.value = d.phone;
      heading.textContent = `تعديل ${d.name}`;
      submit.textContent = 'احفظ التعديل';
      form.elements.name.focus();
    } else if (del) {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'متأكد؟';
        return;
      }
      del.disabled = true;
      try {
        list = (await api(`${driversBase}/${del.dataset.driverDelete}/delete`, { method: 'POST', body: {} })).drivers;
        toast('المندوب اتمسح');
        reset();
      } catch (err) {
        toast(err.message, 'error');
        del.disabled = false;
      }
    }
  });
}

function watchLive() {
  let es = null;
  let pending = null;
  const connect = () => {
    es = new EventSource(`${base}/events`);
    es.addEventListener('changed', () => {
      clearTimeout(pending);
      pending = setTimeout(refresh, 250);
    });
    es.addEventListener('alert', () => refresh());
    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000);
    });
  };
  connect();
}

async function refresh() {
  try {
    data = await api(`${base}/overview`);
    render();
    await loadApp();
  } catch (err) {
    if (err.status === 401) location.reload();
  }
}

async function boot() {
  reloadOnNewVersion();
  for (;;) {
    try {
      data = await api(`${base}/overview`);
      break;
    } catch (err) {
      if (err.status !== 401) throw err;
      await showLogin();
    }
  }
  $('app').hidden = false;
  watchAppUpdates();
  document.body.classList.add('has-tabbar');
  TABS = tabsFor(data);
  renderTabs();
  showTab(firstTab());
  addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  render();
  await Promise.all([loadApp(), loadOwnerApp(), loadTexts(), loadRing()]);
  mountAnalytics($('analytics'), { base, branches: data.branches });
  $('app-body').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act], [data-copy]');
    if (el) appAction(el);
  });
  // Live: the server says when anything of these branches changes (orders, the cashier screen,
  // the super's plan changes, alerts); the 30s poll stays as a fallback.
  watchLive();
  setInterval(refresh, POLL_MS);

  $('texts-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="texts"]')) openTexts();
  });
  $('ring-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="ring"]')) openRing();
  });
  $('account-body').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab-link]');
    if (tab) {
      e.preventDefault();
      showTab(tab.dataset.tabLink, { scroll: true });
      return;
    }
    const el = e.target.closest('[data-act]');
    if (el) accountAction(el.dataset.act);
  });
  // Links in banners and the first steps: «اشترك», copy a link.
  $('pane-branches').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab-link]');
    if (tab) {
      e.preventDefault();
      showTab(tab.dataset.tabLink, { scroll: true });
      return;
    }
    const copyEl = e.target.closest('[data-copy-text]');
    if (copyEl) navigator.clipboard?.writeText(copyEl.dataset.copyText).then(() => toast('اللينك اتنسخ'), () => {});
  });
  $('broadcast').addEventListener('click', () => openBroadcast({ base, branches: data.branches }).catch((err) => toast(err.message, 'error')));
  $('add-branch').addEventListener('click', () => openAddBranch({
    base, brandId, host: location.host, refresh, goBilling: data.brand.selfServe,
  }));
  $('branches').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const branch = data.branches.find((b) => b.id === el.dataset.branch);
    if (el.dataset.act === 'staff') {
      openStaff(branch, { base }).catch((err) => toast(err.message, 'error'));
      return;
    }
    if (el.dataset.act === 'links') {
      openLinks(branch, { base, refresh });
      return;
    }
    if (el.dataset.act === 'features') {
      openFeatureList(branch, {
        base,
        fresh: async (id) => {
          await refresh();
          return data.branches.find((b) => b.id === id);
        },
        openDrivers: (b) => openDrivers(b).catch((err) => toast(err.message, 'error')),
      });
      return;
    }
    if (el.dataset.act === 'drivers') {
      openDrivers(branch).catch((err) => toast(err.message, 'error'));
      return;
    }
    openForm({
      title: 'اسم الفرع',
      intro: 'الاسم ده بيظهر للعملاء على شاشة الطلب وشاشة الكود.',
      fields: [{ name: 'name', label: 'الاسم', value: branch.name }],
      onSubmit: async (v) => {
        await api(`${base}/branches/${encodeURIComponent(branch.id)}/settings`, { method: 'POST', body: { name: v.name } });
        toast('الاسم اتغيّر');
        await refresh();
      },
    });
  });
}

boot().catch((err) => {
  $('login-root').innerHTML = `<p class="login">${esc(err.message)}</p>`;
});
