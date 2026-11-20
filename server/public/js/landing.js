// The landing page's price calculator: branches -> price per branch and the monthly total.

import { CURRENCY, money, quote } from './pricing.js';

const $ = (id) => document.getElementById(id);
const n = $('calc-n');
const range = $('calc-range');

function show(count) {
  const q = quote(count);
  n.value = q.branches;
  range.value = Math.min(q.branches, Number(range.max));
  $('calc-per').textContent = money(q.perBranch);
  $('calc-total').textContent = `الإجمالي ${money(q.monthly)} ${CURRENCY} في الشهر`;
  $('calc-next').textContent = q.next ? `من ${q.next.from} فروع: الفرع بـ ${money(q.next.price)} ${CURRENCY}` : 'أقل سعر للفرع';
}

if (n) {
  n.addEventListener('input', () => n.value && show(n.value));
  n.addEventListener('blur', () => show(n.value || 1));
  range.addEventListener('input', () => show(range.value));
  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => show(Number(n.value || 1) + Number(btn.dataset.step)));
  }
  show(1);
}
