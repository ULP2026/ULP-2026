#!/usr/bin/env node
/*
 * Loads every page in a real browser and refuses to pass if anything is wrong.
 *
 *   node tools/verify.js
 *
 * This is the gate. Publishing runs it before committing, because every defect
 * these exports have shipped so far has been silent: a page that renders blank,
 * a video that never loads, a 27MB page. None of them throw. All of them are
 * obvious once something actually opens the page and looks.
 *
 * Exits non-zero on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;

const PAGES = {
  '/': null, '/about': 'About', '/learn': 'Learn', '/results': 'Results',
  '/pricing': 'Pricing', '/total-package': 'Total Package',
  '/terms': null, '/privacy': null, '/intake': null, '/thank-you': null,
};

/* A page under 500 chars of text has not unpacked — that is the blank-page
   failure mode, and it is the single most important thing this catches. */
const MIN_TEXT = 500;
const MAX_MB = 12;

/* Third parties that 4xx in headless Chrome for their own reasons. */
const NOISY = /challenges\.cloudflare|jnn-pa\.googleapis|doubleclick|google\.com\/pagead/;

const TYPES = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serve() {
  return http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    let f = path.join(ROOT, p);
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('not found'); }
    const st = fs.statSync(f);
    const ct = TYPES[path.extname(f)] || 'application/octet-stream';
    const range = q.headers.range;
    if (range && range.startsWith('bytes=')) {
      const [a, b] = range.replace('bytes=', '').split('-');
      const start = parseInt(a, 10), end = b ? parseInt(b, 10) : st.size - 1;
      r.writeHead(206, { 'Content-Type': ct, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(f, { start, end }).pipe(r);
    }
    r.writeHead(200, { 'Content-Type': ct, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(f).pipe(r);
  });
}

(async () => {
  const failures = [];
  const menus = new Set();
  const srv = serve();
  await new Promise(r => srv.listen(PORT, r));

  const exe = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  for (const [route, expectHighlight] of Object.entries(PAGES)) {
    const file = path.join(ROOT, (route === '/' ? 'index' : route.slice(1)) + '.html');
    if (!fs.existsSync(file)) { failures.push(`${route}: ${path.basename(file)} is missing`); continue; }

    const mb = fs.statSync(file).size / 1048576;
    if (mb > MAX_MB) failures.push(`${route}: ${mb.toFixed(1)}MB exceeds the ${MAX_MB}MB budget — a large asset is probably inlined`);

    const page = await ctx.newPage();
    const errors = [], bad = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
    page.on('response', r => { if (r.status() >= 400 && !NOISY.test(r.url())) bad.push(`${r.status()} ${r.url().slice(0, 80)}`); });

    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(6000);
      await page.evaluate(async () => {
        const h = document.body.scrollHeight;
        for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(5000);

      const r = await page.evaluate(() => {
        const desktopPricing = document.querySelector('a[href="/pricing"]:not(.ulp-moblink)');
        const navLinks = desktopPricing ? [...desktopPricing.parentElement.querySelectorAll('a')] : [];
        return {
          text: document.body.innerText.replace(/\s+/g, ' ').trim().length,
          menu: navLinks.map(a => a.textContent.trim()).filter(Boolean).join(' | '),
          highlight: navLinks.filter(a => getComputedStyle(a).color === 'rgb(242, 169, 0)').map(a => a.textContent.trim()),
          footerPricing: !![...document.querySelectorAll('a[href="/pricing"]')].some(a => a.closest('footer')),
          contact: document.querySelectorAll('a[href="/contact"]').length,
          stale: [...document.querySelectorAll('a[href]')].filter(a => /\.html($|#)/.test(a.getAttribute('href'))).length,
          fbq: typeof window.fbq,
          videos: [...document.querySelectorAll('video')].map(v => ({
            src: (v.currentSrc || v.getAttribute('src') || '(none)').split('/').slice(-1)[0].slice(0, 40),
            ready: v.readyState, err: v.error ? v.error.code : null })),
          images: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
        };
      });

      if (r.text < MIN_TEXT) failures.push(`${route}: only ${r.text} chars of text — the page did not unpack`);
      if (errors.length) failures.push(`${route}: ${errors.length} JS error(s) — ${errors[0]}`);
      if (bad.length) failures.push(`${route}: ${bad.length} failed request(s) — ${bad[0]}`);
      if (r.contact) failures.push(`${route}: ${r.contact} dead /contact link(s)`);
      if (r.stale) failures.push(`${route}: ${r.stale} link(s) still pointing at .html`);
      if (r.images) failures.push(`${route}: ${r.images} broken image(s)`);
      if (!r.footerPricing) failures.push(`${route}: no Pricing link in the footer`);
      if (!r.menu) failures.push(`${route}: no nav found`);
      else menus.add(r.menu);

      const want = expectHighlight ? [expectHighlight] : [];
      if (JSON.stringify(r.highlight) !== JSON.stringify(want)) {
        failures.push(`${route}: highlight is ${JSON.stringify(r.highlight)}, expected ${JSON.stringify(want)}`);
      }
      if (route === '/total-package' && r.fbq !== 'function') failures.push('/total-package: Meta Pixel did not initialise');
      for (const v of r.videos) {
        if (v.err) failures.push(`${route}: video ${v.src} failed with media error ${v.err}`);
        else if (v.src !== '(none)' && v.ready === 0) failures.push(`${route}: video ${v.src} never loaded (readyState 0)`);
      }

      console.log(`  ${route.padEnd(16)} text=${String(r.text).padEnd(6)} ${mb.toFixed(2)}MB highlight=${JSON.stringify(r.highlight)} videos=${r.videos.length} ok`);
    } catch (err) {
      failures.push(`${route}: ${err.message.slice(0, 120)}`);
    }
    await page.close();
  }

  await browser.close();
  srv.close();

  if (menus.size > 1) {
    failures.push(`menus differ between pages (${menus.size} variants): ${[...menus].join('  //  ')}`);
  }

  if (failures.length) {
    console.log(`\nFAILED — ${failures.length} problem(s):`);
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(`\nPASSED — ${Object.keys(PAGES).length} pages, menus identical, highlights correct.`);
})();
