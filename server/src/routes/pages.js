import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../paths.js';
import { appleAppSiteAssociation, appleMeta, LANDING_SHARE, shareMeta } from '../views.js';

const PAGES = { s: 's.html', bar: 'bar.html', qr: 'qr.html', settings: 'settings.html' };

export default async function pageRoutes(app, { config }) {
  const read = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  const sendHtml = (reply, html) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);

  for (const [prefix, file] of Object.entries(PAGES)) {
    let html = read(file);
    if (prefix === 's') html = html.replace('<!--APPLE_META-->', appleMeta(config));
    app.get(`/${prefix}/:shop`, (_req, reply) => sendHtml(reply, html));
  }

  // Self-serve: sign up, sign in (owners and branch managers).
  for (const name of ['signup', 'login', 'welcome']) {
    const page = read(`${name}.html`);
    app.get(`/${name}`, (_req, reply) => sendHtml(reply, page));
  }

  const superPage = read('super.html');
  app.get('/super', (_req, reply) => sendHtml(reply, superPage));
  const brandPage = read('brand.html');
  app.get('/brand/:brand', (_req, reply) => sendHtml(reply, brandPage));

  const index = read('index.html').replace('<!--SHARE_META-->', shareMeta(config, LANDING_SHARE));
  app.get('/', (_req, reply) => sendHtml(reply, index));

  // App Store privacy policy + support URL (one page, #contact anchors support).
  const privacy = read('privacy.html');
  app.get('/privacy', (_req, reply) => sendHtml(reply, privacy));
  app.get('/support', (_req, reply) => reply.redirect('/privacy#contact'));

  app.get('/.well-known/apple-app-site-association', (_req, reply) => {
    const aasa = appleAppSiteAssociation(config);
    if (!aasa) return reply.code(404).send({ error: 'مش موجود' });
    return reply.type('application/json').send(aasa);
  });
}
