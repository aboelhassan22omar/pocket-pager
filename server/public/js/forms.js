// Bottom-sheet form shared by the super and brand dashboards.
//   openForm({ title, intro, fields: [{ name, label, type, value, placeholder, options, hint, disabled }], submit, onSubmit })
//   type: text (default) | number | date | select | textarea | file (values[name] is a File) |
//         toggle (checkbox: values[name] === 'on') | heading | html (f.html, already escaped)
// onSubmit(values) may throw an ApiError; its message (and data.field) is shown in the sheet.

import { icons } from './icons.js';
import { esc } from './util.js';

const NO_FILE = 'لسه ما اخترتش ملف';

const fileSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت` : `${(bytes / 1024 / 1024).toFixed(1)} ميجا`);

/**
 * A file picker in our own look instead of the browser's «Choose File»: a tap (or a drop)
 * area with the file's name once picked. The real input covers it, invisible, so tapping,
 * dropping and the keyboard all reach it.
 */
export function filePickHtml({ id, name = '', accept = '', text = 'اختار ملف', attrs = '' }) {
  return `<span class="file-pick">
      <input class="file-pick-input" type="file" id="${esc(id)}" ${name ? `name="${esc(name)}"` : ''} accept="${esc(accept)}" ${attrs}>
      <span class="file-pick-icon" aria-hidden="true">${icons.upload(20)}</span>
      <span class="file-pick-text">
        <strong>${esc(text)}</strong>
        <small class="file-pick-name">${NO_FILE}</small>
      </span>
    </span>`;
}

// One listener for every picker on the page: shows the picked file's name and size.
if (typeof document !== 'undefined') {
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.classList?.contains('file-pick-input')) return;
    const pick = input.closest('.file-pick');
    const file = input.files?.[0];
    pick.classList.toggle('has-file', Boolean(file));
    // The name in its own <bdi>: a Latin file name doesn't flip the Arabic size around it.
    pick.querySelector('.file-pick-name').innerHTML = file ? `<bdi>${esc(file.name)}</bdi> · ${fileSize(file.size)}` : NO_FILE;
  });
}

// On a phone the keyboard would cover half the sheet before anything is read: focus the
// sheet itself there, and the first field only with a real keyboard.
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Puts a sheet on screen; the page behind it stops scrolling until it closes. */
function mountSheet(backdrop) {
  document.body.append(backdrop);
  document.body.classList.add('has-sheet');
  return () => {
    backdrop.remove();
    if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('has-sheet');
  };
}

function fieldHtml(f) {
  if (f.type === 'heading') return `<h3 class="form-heading">${esc(f.label)}</h3>`;
  if (f.type === 'html') return f.html;
  const id = `f-${f.name}`;
  const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.disabled ? 'disabled' : ''}`;
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  if (f.type === 'toggle') {
    return `<label class="toggle-row" for="${id}"><span>${esc(f.label)}${hint}</span>
      <input class="switch" type="checkbox" ${common} ${f.value ? 'checked' : ''}></label>`;
  }
  if (f.type === 'file') {
    return `<label class="field" for="${id}"><span>${esc(f.label)}</span>
      ${filePickHtml({ id, name: f.name, accept: f.accept ?? '', text: f.pick ?? 'اختار صورة', attrs: `${f.required ? 'required' : ''} ${f.disabled ? 'disabled' : ''}` })}${hint}</label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="field" for="${id}"><span>${esc(f.label)}</span>
      <textarea class="input" ${common} rows="2" maxlength="${esc(f.maxlength ?? 500)}"
        placeholder="${esc(f.placeholder ?? '')}">${esc(f.value ?? '')}</textarea>${hint}</label>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<label class="field" for="${id}"><span>${esc(f.label)}</span><select class="input" ${common}>${opts}</select></label>`;
  }
  const dir = f.dir ? `dir="${esc(f.dir)}"` : '';
  const mode = f.inputmode ? `inputmode="${esc(f.inputmode)}"` : '';
  const max = f.maxlength ? `maxlength="${esc(f.maxlength)}"` : '';
  return `<label class="field" for="${id}"><span>${esc(f.label)}</span>
    <input class="input" ${common} type="${esc(f.type ?? 'text')}" ${dir} ${mode} ${max}
           value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}" autocomplete="off">${hint}</label>`;
}

export function openForm({ title, intro = '', fields = [], submit = 'حفظ', danger = false, onSubmit }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <form class="sheet form-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1" novalidate>
      <div class="sheet-body">
        <h2 id="sheet-title">${esc(title)}</h2>
        ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
        <div class="stack">${fields.map(fieldHtml).join('')}</div>
        <p class="form-error" hidden></p>
      </div>
      <div class="sheet-actions">
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'} btn-block" type="submit">${esc(submit)}</button>
        <button class="btn btn-quiet btn-block" type="button" data-close>رجوع</button>
      </div>
    </form>`;
  const close = mountSheet(backdrop);
  const form = backdrop.querySelector('form');
  const error = form.querySelector('.form-error');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  if (touch()) form.focus({ preventScroll: true });
  else (form.querySelector('input, select') ?? form.querySelector('[type=submit]')).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    error.hidden = true;
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const keepOpen = await onSubmit(values);
      if (!keepOpen) close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      const field = err.data?.field && form.elements[err.data.field];
      field?.setAttribute('aria-invalid', 'true');
      field?.focus();
    } finally {
      button.disabled = false;
    }
  });
  return { close, form };
}

/** A sheet that only shows a result (e.g. a generated password) with a copy button. */
export function showResult({ title, lines }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(title)}</h2>
      <dl class="result-list">${lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd dir="ltr">${esc(v)}</dd></div>`).join('')}</dl>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" type="button" data-copy>انسخ</button>
        <button class="btn btn-quiet btn-block" type="button" data-close>تمام</button>
      </div>
    </div>`;
  const close = mountSheet(backdrop);
  backdrop.addEventListener('click', async (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
    if (e.target.closest('[data-copy]')) {
      await navigator.clipboard?.writeText(lines.map(([k, v]) => `${k}: ${v}`).join('\n')).catch(() => {});
      e.target.closest('[data-copy]').textContent = 'اتنسخ';
    }
  });
}
