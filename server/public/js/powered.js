// The "Powered by" footer, fixed at the bottom of every page (splash included).
// Dashboards (<body data-powered="inline">) end with it instead, so on a phone it never
// covers what is being read. Not inside a brand's app: that one carries the brand's name only.
//
// A café's pages: "Powered by" + the Pocket Pager lockup. Pocket Pager's own pages
// (<html class="pp">) are the product already: they close with "POWERED BY AUREXIS".

import { isCashierApp } from './util.js';

export const AUREXIS_URL = 'https://aurexis.cc/';
// Self-hosted (no request to another site from a customer's page); white words, for dark pages.
export const PP_LOCKUP = '/img/brand/lockup-on-dark.svg';

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
    logo.src = PP_LOCKUP;
    logo.alt = 'Pocket Pager';
    logo.width = 73;
    logo.height = 16;
    logo.addEventListener('error', () => {
      logo.hidden = true;
    });
    link.append(logo);
  }

  footer.append(link);
  doc.body.append(footer);
  return footer;
}

// Pages framed by the demo (/demo) leave the footer to the demo page itself.
const framed = typeof window !== 'undefined' && window.self !== window.top;
if (typeof document !== 'undefined' && !isCashierApp(document) && !framed) mountPoweredBy(document);
