// The "Powered by" footer, fixed at the bottom of every page (splash included).
// Dashboards (<body data-powered="inline">) end with it instead, so on a phone it never
// covers what is being read. Not inside a brand's app: that one carries the brand's name only.
//
// A café's pages: "Powered by" + the Aurexis mark + "AUREXIS". Pocket Pager's own pages
// (<html class="pp">) close with the caps line "POWERED BY AUREXIS".

import { isCashierApp } from './util.js';

export const AUREXIS_URL = 'https://aurexis.cc/';
// The colored mark from aurexis.cc, self-hosted: a customer's page makes no request to another site.
export const AUREXIS_MARK = '/img/brand/aurexis-mark.svg';

export function mountPoweredBy(doc) {
  if (doc.getElementById('powered-by')) return doc.getElementById('powered-by');
  const own = Boolean(doc.documentElement?.classList?.contains('pp'));

  const footer = doc.createElement('footer');
  footer.id = 'powered-by';
  footer.className = doc.body.dataset?.powered === 'inline' ? 'powered-by is-inline' : 'powered-by';
  if (own) footer.className += ' is-own';
  footer.setAttribute('dir', 'ltr');

  const link = doc.createElement('a');
  link.href = AUREXIS_URL;
  link.target = '_blank';
  link.rel = 'noopener';

  const label = doc.createElement('span');
  label.textContent = own ? 'Powered by Aurexis' : 'Powered by';
  link.append(label);

  if (!own) {
    const logo = doc.createElement('img');
    logo.src = AUREXIS_MARK;
    logo.alt = '';
    logo.width = 17;
    logo.height = 16;
    logo.addEventListener('error', () => {
      logo.hidden = true;
    });
    const brand = doc.createElement('strong');
    brand.textContent = 'AUREXIS';
    link.append(logo, brand);
  }

  footer.append(link);
  doc.body.append(footer);
  return footer;
}

// Pages framed by the demo (/demo) leave the footer to the demo page itself.
const framed = typeof window !== 'undefined' && window.self !== window.top;
if (typeof document !== 'undefined' && !isCashierApp(document) && !framed) mountPoweredBy(document);
