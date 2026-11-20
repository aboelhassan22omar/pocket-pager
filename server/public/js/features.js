// A branch's features as a short list: one line each and a switch that saves at once. Only a
// feature that needs something typed (the stamp card's gift, the promo's words, the Google
// link) asks for it, in a small sheet of its own. The rarely used ones sit under «متقدم».

import { openForm } from './forms.js';
import { icons } from './icons.js';
import { toast } from './staff.js';
import { api, esc } from './util.js';

const FORCED = 'مقفولة من الإدارة';

/**
 * key: what the list calls it. on(b): is it on. body(on): what the server takes.
 * details(b): the fields of its own sheet (none = just a switch). needs(b): it can't be on
 * without its details (the sheet opens first).
 */
const FEATURES = [
  {
    key: 'open', icon: 'store', title: 'الفرع بياخد طلبات',
    text: 'اقفله مؤقتًا لو مش بتستقبل طلبات (زحمة، صيانة، إجازة). العملاء هيشوفوا إن الفرع مقفول.',
    on: (b) => !b.paused,
    body: (on) => ({ paused: !on }),
  },
  {
    key: 'delivery', icon: 'scooter', title: 'التوصيل',
    text: 'مناديبك بيوصّلوا الطلب، والعميل بيتابعه لحد بابه وموبايله بيرن لما يخرج.',
    on: (b) => b.delivery,
    body: (on) => ({ delivery: on }),
    details: (b) => [{
      name: 'deliveryCloseMinutes', label: 'الطلب يتقفل لوحده بعد كام دقيقة من خروجه؟', type: 'number', inputmode: 'numeric', dir: 'ltr',
      value: b.deliveryCloseMinutes ?? 60, hint: 'رقم من 15 لـ 240. لو المندوب وصل بدري، الكاشير يدوس «وصل».',
    }],
    save: (v) => ({ deliveryCloseMinutes: Number(v.deliveryCloseMinutes) }),
    drivers: true,
  },
  {
    key: 'manualNumbers', icon: 'print', title: 'رقم الفاتورة فوق شاشة الكاشير',
    text: 'الكاشير يكتب رقم فاتورة التيكاواي، فالعميل اللي يمسح بعدها ياخد الرقم ده على طول.',
    on: (b) => b.manualNumbers,
    body: (on) => ({ manualNumbers: on }),
  },
  {
    key: 'loyalty', icon: 'gift', title: 'بطاقة الختم', forced: 'loyalty',
    text: 'ختم مع كل طلب، وهدية لما العميل يكمّل الختمات. بيخلّيه يرجعلك.',
    on: (b) => b.toggles.loyalty,
    body: (on) => ({ features: { loyalty: on } }),
    needs: (b) => !b.loyaltyRewardText,
    details: (b) => [
      { name: 'loyaltyRewardText', label: 'الهدية إيه؟', value: b.loyaltyRewardText, placeholder: 'مثلًا: مشروب ببلاش', maxlength: 60, hint: 'الكلام ده العميل بيشوفه بالظبط.' },
      { name: 'loyaltyEvery', label: 'بعد كام ختم؟', type: 'number', inputmode: 'numeric', dir: 'ltr', value: b.loyaltyEvery, hint: 'رقم من 2 لـ 20. مثلًا 5: الطلب السادس هدية.' },
      {
        name: 'loyaltyProduct', label: 'على منتج واحد بس؟ (اختياري)', value: b.loyaltyProduct ?? '', placeholder: 'مثلًا: لاتيه', maxlength: 40,
        hint: 'سيبها فاضية والختم يبقى مع أي طلب.',
      },
    ],
    save: (v) => ({ loyaltyRewardText: v.loyaltyRewardText ?? '', loyaltyEvery: Number(v.loyaltyEvery), loyaltyProduct: v.loyaltyProduct ?? '' }),
  },
  {
    key: 'promo', icon: 'palette', title: 'عرض وهو مستني', forced: 'promo',
    text: 'سطر وصورة تحت رقم الطلب وهو مستني، زي «جرّب الكرواسون الجديد».',
    on: (b) => b.toggles.promo,
    body: (on) => ({ features: { promo: on } }),
    needs: (b) => !b.promoText && !b.promoImageUrl,
    details: (b) => [
      { name: 'promoText', label: 'كلام العرض', type: 'textarea', value: b.promoText, maxlength: 120, placeholder: 'مثلًا: جرّب الكرواسون الجديد' },
      {
        name: 'promoImage', label: 'صورة (اختياري)', type: 'file', accept: 'image/png,image/jpeg,image/webp',
        hint: b.promoImageUrl ? 'فيه صورة دلوقتي. اختار غيرها عشان تغيّرها.' : 'صورة PNG أو JPG، أقل من 500 كيلوبايت.',
      },
      ...(b.promoImageUrl ? [{ name: 'promoImageRemove', type: 'toggle', label: 'شيل الصورة', value: false }] : []),
      { name: 'promoStartsAt', label: 'من يوم (اختياري)', type: 'date', dir: 'ltr', value: b.promoStartsAt ?? '' },
      { name: 'promoEndsAt', label: 'لحد يوم (اختياري)', type: 'date', dir: 'ltr', value: b.promoEndsAt ?? '' },
    ],
    save: (v) => ({ promoText: v.promoText ?? '', promoStartsAt: v.promoStartsAt ?? '', promoEndsAt: v.promoEndsAt ?? '' }),
  },
  {
    key: 'review', icon: 'star', title: 'قيّمنا على جوجل', forced: 'review',
    text: 'بعد ما العميل يستلم، زرار بيفتحله نجوم جوجل بتاعة الفرع على طول.',
    on: (b) => b.toggles.review,
    body: (on) => ({ features: { review: on } }),
    needs: (b) => !b.googlePlaceId && !b.legacyReviewUrl,
    details: (b) => [{
      name: 'googlePlaceId', label: 'لينك تقييم جوجل للفرع', dir: 'ltr', value: b.legacyReviewUrl ?? b.googlePlaceId ?? '',
      placeholder: 'https://g.page/r/…/review',
      hint: 'من Google Business Profile بتاع الفرع ← «اطلب تقييمات» ← انسخ اللينك والصقه هنا.',
    }],
    save: (v) => ({ googlePlaceId: v.googlePlaceId ?? '' }),
  },
  {
    key: 'messageBox', icon: 'chat', title: 'رسالة للإدارة',
    text: 'العميل يكتبلك شكوى أو اقتراح من غير ما الكاشير يشوفها. بتوصلك في «التحليلات».',
    on: (b) => b.messageBox,
    body: (on) => ({ messageBox: on }),
  },
  {
    key: 'orderQr', icon: 'qr', title: 'كود مختلف لكل طلب', advanced: true,
    text: 'بدل كود واحد للكل، شاشة العميل بتعرض كود الطلب ده بس. مفيد لو سيستم الكاشير مربوط.',
    on: (b) => b.orderQr,
    body: (on) => ({ orderQr: on }),
  },
  {
    key: 'orderShare', icon: 'share', title: 'أكتر من موبايل على نفس الطلب', advanced: true,
    text: 'مجموعة أصحاب يمسحوا نفس الكود، وكل موبايلاتهم ترن.',
    on: (b) => b.orderShare,
    body: (on) => ({ orderShare: on }),
  },
];

function rowHtml(f, b) {
  const forced = f.forced && b.forcedOff.includes(f.forced);
  const on = Boolean(f.on(b)) && !forced;
  const edit = on && (f.details || f.drivers)
    ? `<span class="feat-links">${f.details ? `<button class="link-btn" type="button" data-edit="${f.key}">عدّل</button>` : ''}
       ${f.drivers ? `<button class="link-btn" type="button" data-drivers>المناديب</button>` : ''}</span>`
    : '';
  return `
    <div class="feat ${on ? 'is-on' : ''}" data-key="${f.key}">
      <span class="feat-icon">${icons[f.icon](22)}</span>
      <div class="feat-text">
        <strong>${esc(f.title)}</strong>
        <small>${esc(forced ? FORCED : f.text)}</small>
        ${edit}
      </div>
      <input class="switch" type="checkbox" role="switch" aria-label="${esc(f.title)}" data-toggle="${f.key}" ${on ? 'checked' : ''} ${forced ? 'disabled' : ''}>
    </div>`;
}

function listHtml(b) {
  const main = FEATURES.filter((f) => !f.advanced);
  const extra = FEATURES.filter((f) => f.advanced);
  return `
    <div class="feat-list">${main.map((f) => rowHtml(f, b)).join('')}</div>
    <details class="feat-more"><summary>متقدم (سيبه زي ما هو لو مش متأكد)</summary>
      <div class="feat-list">${extra.map((f) => rowHtml(f, b)).join('')}</div>
    </details>`;
}

/** The list sheet. `fresh()` reloads the branch after a change; `openDrivers(b)` opens its drivers. */
export function openFeatureList(branch, { base, fresh, openDrivers }) {
  let b = branch;
  const url = () => `${base}/branches/${encodeURIComponent(b.id)}`;
  const { form, close } = openForm({
    title: `خصائص ${b.name}`,
    intro: 'دوس على أي مفتاح يشغّل أو يقفل على طول. مفيش حاجة بتتمسح لو قفلتها.',
    fields: [{ type: 'html', html: `<div id="feat-root">${listHtml(b)}</div>` }],
    submit: 'تمام',
    onSubmit: async () => {},
  });
  const root = form.querySelector('#feat-root');
  const redraw = async () => {
    b = (await fresh(b.id)) ?? b;
    const open = root.querySelector('details')?.open;
    root.innerHTML = listHtml(b);
    if (open) root.querySelector('details').open = true;
  };

  /** The feature's own small sheet; `turnOn`: saving also switches it on. */
  const details = (f, turnOn) => openForm({
    title: f.title,
    intro: turnOn ? 'محتاجين حاجة صغيرة قبل ما نشغّلها.' : f.text,
    fields: f.details(b),
    submit: turnOn ? 'شغّلها' : 'احفظ',
    onSubmit: async (v) => {
      const image = v.promoImage instanceof File && v.promoImage.size ? v.promoImage : null;
      if (image && image.size > 500 * 1024) {
        throw Object.assign(new Error('الصورة لازم تكون أقل من 500 كيلوبايت'), { data: { field: 'promoImage' } });
      }
      const body = { ...f.save(v), ...(turnOn ? f.body(true) : {}) };
      await api(`${url()}/settings`, { method: 'POST', body });
      if (image) await api(`${url()}/promo-image`, { method: 'POST', raw: image, contentType: image.type });
      else if (v.promoImageRemove === 'on') await api(`${url()}/promo-image`, { method: 'DELETE', body: {} });
      toast(turnOn ? `«${f.title}» اشتغلت` : 'اتحفظ');
      await redraw();
    },
  });

  root.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-toggle]');
    if (!input) return;
    const f = FEATURES.find((x) => x.key === input.dataset.toggle);
    const on = input.checked;
    if (on && f.needs?.(b)) {
      input.checked = false;
      details(f, true);
      return;
    }
    input.disabled = true;
    try {
      await api(`${url()}/settings`, { method: 'POST', body: f.body(on) });
      toast(on ? `«${f.title}» اشتغلت` : `«${f.title}» اتقفلت`);
      await redraw();
    } catch (err) {
      input.checked = !on;
      input.disabled = false;
      toast(err.message, 'error');
    }
  });

  root.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) details(FEATURES.find((x) => x.key === edit.dataset.edit), false);
    if (e.target.closest('[data-drivers]')) {
      close();
      openDrivers(b);
    }
  });
}
