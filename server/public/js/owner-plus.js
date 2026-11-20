// The owner's dashboard, self-serve parts: a branch's links and cashier PIN, a new branch, the
// team (branch managers), the subscription, and the first steps after signing up. Every action
// says what it does and why, in one line.

import { openForm, showResult } from './forms.js';
import { icons } from './icons.js';
import { CURRENCY, money, quote, TIERS } from './pricing.js';
import { cleanTyped, slugify } from './slug.js';
import { toast } from './staff.js';
import { api, esc } from './util.js';

/** Inside the store apps (iOS / Google Play) the subscription isn't sold: their rules. */
export const inStoreApp = () => /PocketPagerApp/.test(navigator.userAgent);

const PAY_LABEL = { instapay: 'InstaPay', wallet: 'محفظة (فودافون كاش وغيرها)', whatsapp: 'واتساب' };
const DAY = 86_400_000;

async function copy(text, label = 'اتنسخ') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    window.prompt('انسخ:', text);
  }
}

// ---------- the plan, above everything ----------

/** One line on the trial / subscription for a self-serve brand, with its one action. */
export function planBannerHtml(data) {
  if (!data.brand.selfServe || data.demo) return '';
  const owner = data.owner.role === 'owner';
  const cta = owner && !inStoreApp() ? '<a class="btn btn-primary btn-sm" href="#billing" data-tab-link="billing">اشترك</a>' : '';
  if (data.pendingBilling) {
    return `<div class="plan-banner is-wait" role="status">${icons.clock(22)}<div><strong>طلب الاشتراك وصلنا</strong>
      <span>بنأكد الدفع ونشغّل الفروع، وغالبًا ده بيخلص في نفس اليوم.</span></div></div>`;
  }
  if (data.stopped) {
    const why = {
      trial_ended: 'التجربة المجانية خلصت، والعملاء مش بياخدوا أرقام دلوقتي.',
      awaiting_payment: 'الفرع مستني الاشتراك عشان يشتغل.',
      unpaid: 'الاشتراك خلص، والعملاء مش بياخدوا أرقام دلوقتي.',
      stopped: 'الخدمة متوقفة. كلّمنا.',
    }[data.stopped];
    return `<div class="plan-banner is-stop" role="alert">${icons.bell(22)}<div><strong>${esc(why)}</strong>
      <span>${owner ? 'اشترك والفروع ترجع تشتغل في نفس اللحظة اللي الدفع يتأكد فيها.' : 'كلّم صاحب المطعم.'}</span></div>${cta}</div>`;
  }
  const trial = data.branches.find((b) => b.plan.status === 'trial');
  const waiting = data.branches.filter((b) => b.awaitingPayment);
  if (trial) {
    const days = trial.plan.daysLeft;
    return `<div class="plan-banner" role="status">${icons.gift(22)}<div><strong>${days <= 1 ? 'آخر يوم في التجربة المجانية' : `فاضل ${days} أيام في التجربة المجانية`}</strong>
      <span>لو عجبك، اشترك قبل ما تخلص عشان العملاء مايتوقفوش.</span></div>${cta}</div>`;
  }
  if (waiting.length && owner) {
    return `<div class="plan-banner is-wait" role="status">${icons.store(22)}<div><strong>${waiting.length === 1 ? `فرع ${esc(waiting[0].name)} مستني الاشتراك` : `${waiting.length} فروع مستنية الاشتراك`}</strong>
      <span>الفرع جاهز، وبيشتغل أول ما الاشتراك يتأكد.</span></div>${cta}</div>`;
  }
  return '';
}

// ---------- first steps, until the first order ----------

export function welcomeHtml(data) {
  const fresh = data.branches.length && data.branches.every((b) => !b.lastActivityAt && !b.ordersToday);
  const asked = new URLSearchParams(location.search).has('welcome');
  if (!fresh && !asked) return '';
  const b = data.branches[0];
  return `
    <section class="welcome" aria-labelledby="h-welcome">
      <h2 id="h-welcome">ابدأ من هنا</h2>
      <p class="muted">3 خطوات وموبايلات عملاءك ترن. الخطوات دي بتختفي لوحدها بعد أول طلب.</p>
      <ol class="welcome-steps">
        <li><strong>افتح شاشة الكاشير على جهاز الكاشير</strong>
          <span>تابلت أو كمبيوتر جنب الكاشير. اكتب فيها الرقم السري <b class="num" dir="ltr">${esc(b.pin ?? '')}</b> مرة واحدة.</span>
          <span class="welcome-actions"><a class="btn btn-sm btn-primary" href="${esc(b.urls.bar)}" target="_blank" rel="noopener">افتح شاشة الكاشير</a>
          <button class="btn btn-sm" type="button" data-copy-text="${esc(b.urls.bar)}">انسخ اللينك</button></span></li>
        <li><strong>حط الكود قدّام العميل</strong>
          <span>شاشة صغيرة فيها الكود، أو اطبعه من «الإعدادات» وحطه على الكاونتر.</span>
          <span class="welcome-actions"><a class="btn btn-sm" href="${esc(b.urls.qr)}" target="_blank" rel="noopener">افتح شاشة الكود</a></span></li>
        <li><strong>جرّب بنفسك</strong>
          <span>امسح الكود بموبايلك، وبعدين دوس على الرقم في شاشة الكاشير. موبايلك هيرن.</span></li>
      </ol>
    </section>`;
}

// ---------- a branch's links and PIN ----------

export function openLinks(branch, { base, refresh }) {
  const row = (title, why, url, open = true) => `
    <div class="link-row">
      <div><strong>${title}</strong><small>${why}</small><code dir="ltr">${esc(url)}</code></div>
      <div class="link-row-actions">
        ${open ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">افتح</a>` : ''}
        <button class="btn btn-sm" type="button" data-copy-text="${esc(url)}">انسخ</button>
      </div>
    </div>`;
  const { form, close } = openForm({
    title: `لينكات ${branch.name}`,
    intro: 'ابعت كل لينك للجهاز اللي هيفتحه. الكاشير محتاج الرقم السري بس، مش كلمة سرك.',
    fields: [{
      type: 'html',
      html: `<div class="links-list">
        ${row('شاشة الكاشير', 'على جهاز الكاشير. منها بتدوس «جاهز» فموبايل العميل يرن.', branch.urls.bar)}
        ${row('شاشة الكود', 'شاشة صغيرة قدّام العميل فيها الكود اللي بيمسحه.', branch.urls.qr)}
        ${row('إعدادات الفرع', 'الشعار ولونه، والرسايل، والكود المطبوع.', branch.urls.settings)}
        <div class="pin-row">
          <div><strong>الرقم السري للكاشير</strong><small>بيتكتب مرة واحدة على كل جهاز كاشير.</small></div>
          <span class="pin-value num" dir="ltr">${esc(branch.pin ?? '—')}</span>
        </div>
      </div>`,
    }, {
      name: 'pin', label: 'رقم سري جديد (اختياري)', inputmode: 'numeric', dir: 'ltr', maxlength: 8, placeholder: 'مثلًا: 4821',
      hint: 'من 4 لـ 8 أرقام. لو غيّرته، كل أجهزة الكاشير هتطلب الرقم الجديد مرة واحدة.',
    }],
    submit: 'غيّر الرقم السري',
    onSubmit: async (v) => {
      const pin = String(v.pin ?? '').trim();
      if (!pin) throw Object.assign(new Error('اكتب الرقم الجديد الأول'), { data: { field: 'pin' } });
      await api(`${base}/branches/${encodeURIComponent(branch.id)}/pin`, { method: 'POST', body: { pin } });
      toast('الرقم السري اتغيّر');
      await refresh();
    },
  });
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-text]');
    if (btn) copy(btn.dataset.copyText, 'اللينك اتنسخ');
  });
  return close;
}

// ---------- a new branch ----------

export function openAddBranch({ base, brandId, host, refresh, goBilling }) {
  const { form } = openForm({
    title: 'فرع جديد',
    intro: 'الفرع بيتعمل على طول بلينكاته ورقمه السري، وبيبدأ يشتغل أول ما اشتراكه يتأكد.',
    fields: [
      { name: 'name', label: 'اسم الفرع', placeholder: 'مثلًا: مدينة نصر', maxlength: 60, hint: 'اسم المنطقة غالبًا. العميل بيشوفه تحت اسم المطعم.' },
      {
        name: 'slug', label: 'اسم الفرع في اللينك', dir: 'ltr', maxlength: 20, placeholder: 'nasr-city',
        hint: `بالإنجليزي. لينك الفرع هيبقى ${host}/s/${brandId}-…`,
      },
    ],
    submit: 'اعمل الفرع',
    onSubmit: async (v) => {
      const res = await api(`${base}/branches`, { method: 'POST', body: { name: v.name ?? '', slug: v.slug ?? '' } });
      await refresh();
      showResult({
        title: 'الفرع اتعمل',
        lines: [
          ['الرقم السري للكاشير', res.pin],
          ['شاشة الكاشير', `${location.origin}/bar/${res.branchId}`],
        ],
      });
      if (goBilling && !inStoreApp()) toast('الفرع هيشتغل أول ما تشترك له من «الاشتراك»');
    },
  });
  const name = form.elements.name;
  const slug = form.elements.slug;
  let touched = false;
  name.addEventListener('input', () => {
    if (!touched) slug.value = slugify(name.value, 20);
  });
  slug.addEventListener('input', () => {
    touched = true;
    slug.value = cleanTyped(slug.value, 20);
  });
}

// ---------- the team: branch managers ----------

export async function renderTeam(el, { base, branches }) {
  const { managers } = await api(`${base}/managers`);
  const nameOf = (id) => branches.find((b) => b.id === id)?.name ?? id;
  el.innerHTML = `
    <p class="muted pane-intro">مدير الفرع بيدخل برقم موبايله وبيشوف فرعه بس: الطلبات والتحليلات والخصائص والمناديب. مش بيشوف باقي الفروع ولا الاشتراك.</p>
    <div class="team-list">
      ${managers.length ? managers.map((m) => `
        <div class="team-row">
          <span class="team-avatar">${esc([...m.name][0] ?? '؟')}</span>
          <div class="team-who"><strong>${esc(m.name)}</strong>
            <span class="muted small">مدير ${esc(nameOf(m.branchId))} · <span dir="ltr">${esc(m.phone ?? '')}</span></span>
            <span class="muted small">${m.lastLoginAt ? `آخر دخول ${new Date(m.lastLoginAt).toLocaleDateString('ar-EG')}` : 'لسه مادخلش'}</span></div>
          <div class="team-actions">
            <button class="btn btn-sm" type="button" data-team="send" data-id="${m.id}">ابعتله الدخول</button>
            <button class="btn btn-sm btn-quiet" type="button" data-team="reset" data-id="${m.id}">كلمة سر جديدة</button>
            <button class="btn btn-sm btn-danger" type="button" data-team="delete" data-id="${m.id}">امسحه</button>
          </div>
        </div>`).join('') : '<p class="empty-note">لسه مفيش مديرين. لو عندك مدير لكل فرع، ضيفه هنا.</p>'}
    </div>
    <button class="btn btn-primary" type="button" data-team="add">${icons.user(20)}ضيف مدير فرع</button>`;

  const invite = (m) => `أهلًا ${m.name}، ده دخولك لفرع ${nameOf(m.branchId)} على Pocket Pager:
${location.origin}/login
الموبايل: ${m.phone?.startsWith('20') ? `0${m.phone.slice(2)}` : m.phone}
كلمة السر: ${m.password ?? '(اطلبها مني)'}`;

  const sendSheet = (m) => {
    const text = invite(m);
    const phone = (m.phone ?? '').replace(/\D/g, '');
    const { form } = openForm({
      title: `دخول ${m.name}`,
      intro: 'ابعتله الرسالة دي، وهو يدخل بيها من أي موبايل.',
      fields: [{ type: 'html', html: `<pre class="invite-text">${esc(text)}</pre>` }],
      submit: 'ابعتها واتساب',
      onSubmit: async () => {
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      },
    });
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-block';
    copyBtn.textContent = 'انسخ الرسالة';
    copyBtn.addEventListener('click', () => copy(text, 'الرسالة اتنسخت'));
    form.querySelector('.sheet-actions').prepend(copyBtn);
  };

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-team]');
    if (!btn) return;
    const m = managers.find((x) => String(x.id) === btn.dataset.id);
    const act = btn.dataset.team;
    if (act === 'add') {
      openForm({
        title: 'مدير فرع جديد',
        intro: 'هنعمله كلمة سر، وتبعتهاله على واتساب بدوسة.',
        fields: [
          { name: 'name', label: 'اسمه', maxlength: 60, placeholder: 'مثلًا: محمد', hint: 'عشان تعرفه في القايمة.' },
          { name: 'phone', label: 'رقم موبايله', type: 'tel', inputmode: 'tel', dir: 'ltr', placeholder: '01012345678', hint: 'هيدخل بيه. لازم يكون رقم مش عليه حساب تاني.' },
          {
            name: 'branchId', label: 'مدير فرع إيه؟', type: 'select', value: branches[0]?.id,
            options: branches.map((b) => ({ value: b.id, label: b.name })),
          },
        ],
        submit: 'ضيفه',
        onSubmit: async (v) => {
          const res = await api(`${base}/managers`, { method: 'POST', body: v });
          await renderTeam(el, { base, branches });
          sendSheet(res.manager);
        },
      });
      return;
    }
    if (act === 'send') sendSheet(m);
    if (act === 'reset') {
      const res = await api(`${base}/managers/${m.id}/password`, { method: 'POST', body: {} });
      await renderTeam(el, { base, branches });
      sendSheet(res.managers.find((x) => x.id === m.id));
    }
    if (act === 'delete') {
      openForm({
        title: `تمسح ${m.name}؟`,
        intro: 'هيخرج من حسابه على طول ومش هيقدر يدخل تاني. فرعه وطلباته مش بيتأثروا.',
        submit: 'امسحه',
        danger: true,
        onSubmit: async () => {
          await api(`${base}/managers/${m.id}/delete`, { method: 'POST', body: {} });
          toast('اتمسح');
          await renderTeam(el, { base, branches });
        },
      });
    }
  };
}

// ---------- the subscription ----------

const STATUS = {
  trial: (p) => `تجربة مجانية · فاضل ${p.daysLeft} ${p.daysLeft === 1 ? 'يوم' : 'أيام'}`,
  active: (p) => (p.until ? `شغّال لحد ${new Date(p.until).toLocaleDateString('ar-EG')}` : 'شغّال'),
  past_due: (p) => `الاشتراك خلص · فاضل ${p.daysLeft} ${p.daysLeft === 1 ? 'يوم' : 'أيام'} سماح`,
  suspended: () => 'واقف',
};

export async function renderBilling(el, { base, refresh }) {
  if (inStoreApp()) {
    el.innerHTML = '<p class="muted pane-intro">حالة كل فرع ظاهرة على كارته في «الفروع». لأي سؤال عن الاشتراك كلّمنا.</p>';
    return;
  }
  const bill = await api(`${base}/billing`);
  let months = 1;
  const count = bill.branches.length;
  const pending = bill.requests.find((r) => r.status === 'pending');
  const q = (m) => bill.quotes.find((x) => x.months === m) ?? quote(count, m);

  const methodsHtml = bill.methods.length
    ? bill.methods.map((m) => `<div class="pay-method"><span>${esc(PAY_LABEL[m.id] ?? m.id)}</span>
        <strong dir="ltr">${esc(m.value)}</strong><button class="btn btn-sm" type="button" data-copy-text="${esc(m.value)}">انسخ</button></div>`).join('')
    : '<p class="muted small">بعد ما تبعت الطلب هنكلمك على رقمك ونتفق على طريقة الدفع اللي تريحك.</p>';

  const draw = () => {
    const now = q(months);
    el.innerHTML = `
      <p class="muted pane-intro">السعر لكل فرع في الشهر. كل ما فروعك تزيد، سعر الفرع بيقل.</p>

      <div class="bill-branches">
        ${bill.branches.map((b) => `<div class="bill-branch"><span>${esc(b.name)}</span>
          <span class="bill-status" data-status="${esc(b.plan.status)}">${esc(b.awaitingPayment && b.plan.status === 'suspended' ? 'مستني الاشتراك' : STATUS[b.plan.status]?.(b.plan) ?? '')}</span></div>`).join('')}
      </div>

      ${pending ? `<div class="plan-banner is-wait" role="status">${icons.clock(22)}<div><strong>طلبك وصلنا: ${pending.months} ${pending.months === 1 ? 'شهر' : 'شهور'} · ${money(pending.amount)} ${CURRENCY}</strong>
        <span>أول ما الدفع يتأكد، الفروع بتشتغل لوحدها. غالبًا في نفس اليوم.</span></div></div>` : `
      <h3 class="bill-h">اشترك لمدة قد إيه؟</h3>
      <div class="months" role="radiogroup" aria-label="المدة">
        ${[1, 3, 6, 12].map((m) => `<button class="month" type="button" role="radio" aria-checked="${m === months}" data-months="${m}">
          <strong>${m === 1 ? 'شهر' : m === 12 ? 'سنة' : `${m} شهور`}</strong><span class="num">${money(q(m).total)} ${CURRENCY}</span></button>`).join('')}
      </div>

      <div class="bill-total">
        <div><span>${count} ${count === 1 ? 'فرع' : 'فروع'} × ${money(now.perBranch)} ${CURRENCY} × ${months} ${months === 1 ? 'شهر' : 'شهور'}</span>
        ${now.next ? `<small>من ${now.next.from} فروع الفرع بـ ${money(now.next.price)} ${CURRENCY} بس</small>` : ''}</div>
        <strong class="num">${money(now.total)} ${CURRENCY}</strong>
      </div>

      <h3 class="bill-h">ادفع إزاي؟</h3>
      <div class="pay-methods">${methodsHtml}</div>
      <label class="field"><span>رقم التحويل أو اسم اللي حوّل (اختياري)</span>
        <input class="input" id="pay-ref" maxlength="120" placeholder="مثلًا: آخر 4 أرقام من التحويل"></label>
      <p class="muted small">بيساعدنا نلاقي تحويلك بسرعة. لو لسه ماحوّلتش، ابعت الطلب وهنكلمك.</p>
      <button class="btn btn-primary btn-block" type="button" data-bill="send">بعت طلب الاشتراك</button>`}

      <details class="tiers">
        <summary>جدول الأسعار</summary>
        <table class="table table-sm tiers-table">
          <thead><tr><th>عدد الفروع</th><th>سعر الفرع في الشهر</th></tr></thead>
          <tbody>${TIERS.map(([from, price], i) => {
            const to = TIERS[i + 1] ? TIERS[i + 1][0] - 1 : null;
            const range = to == null ? `${from} أو أكتر` : from === to ? `${from}` : `${from} – ${to}`;
            return `<tr><td class="num">${range}</td><td class="num">${money(price)} ${CURRENCY}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </details>`;
  };
  draw();

  el.onclick = async (e) => {
    const copyBtn = e.target.closest('[data-copy-text]');
    if (copyBtn) {
      copy(copyBtn.dataset.copyText);
      return;
    }
    const m = e.target.closest('[data-months]');
    if (m) {
      months = Number(m.dataset.months);
      const ref = el.querySelector('#pay-ref')?.value ?? '';
      draw();
      el.querySelector('#pay-ref').value = ref;
      return;
    }
    const send = e.target.closest('[data-bill="send"]');
    if (send) {
      send.disabled = true;
      try {
        await api(`${base}/billing`, {
          method: 'POST',
          body: { months, method: bill.methods[0]?.id ?? 'call', reference: el.querySelector('#pay-ref').value },
        });
        toast('طلبك وصل');
        await refresh();
        await renderBilling(el, { base, refresh });
      } catch (err) {
        toast(err.message, 'error');
        send.disabled = false;
      }
    }
  };
}

// ---------- closing the account (App Store and Google Play ask for it) ----------

export function openDeleteAccount({ base }) {
  openForm({
    title: 'تقفل حسابك؟',
    intro: 'المطعم وكل فروعه هيقفوا على طول، والعملاء مش هياخدوا أرقام. لو غيّرت رأيك بعدين كلّمنا ونرجّعه.',
    fields: [{ name: 'password', label: 'اكتب كلمة السر عشان نتأكد إنه إنت', type: 'password' }],
    submit: 'اقفل الحساب',
    danger: true,
    onSubmit: async (v) => {
      await api(`${base}/account/delete`, { method: 'POST', body: { password: v.password ?? '' } });
      location.href = '/';
    },
  });
}

export function openPassword({ base }) {
  openForm({
    title: 'غيّر كلمة السر',
    fields: [
      { name: 'current', label: 'كلمة السر الحالية', type: 'password' },
      { name: 'password', label: 'كلمة السر الجديدة', type: 'password', hint: '6 حروف أو أرقام على الأقل.' },
    ],
    onSubmit: async (v) => {
      await api(`${base}/account/password`, { method: 'POST', body: v });
      toast('كلمة السر اتغيّرت');
    },
  });
}

export const daysBetween = (a, b) => Math.ceil((b - a) / DAY);
