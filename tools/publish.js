#!/usr/bin/env node
/*
 * Turns a Claude Design export into a publishable page.
 *
 * Exports cannot go live as-is. They arrive in varying shapes, they carry
 * defects that fail silently, and they know nothing about the edits this site
 * has accumulated. This applies all of that in one pass.
 *
 *   node tools/publish.js            # process everything in incoming/
 *   node tools/publish.js --dry-run  # report only, write nothing
 *
 * Exits non-zero on any problem. Verification lives in tools/verify.js and is
 * what decides whether the result is allowed to ship.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INCOMING = path.join(ROOT, 'incoming');
const UPLOADS = path.join(ROOT, 'uploads');
const DRY = process.argv.includes('--dry-run');

const B = String.fromCharCode(92); // a real backslash, never an escape

/* Which page a dropped file becomes. Matched on a squashed lowercase name, so
   "ULP Total Package (standalone) (1).html" still lands on total-package. */
const PAGES = [
  { page: 'total-package', match: /totalpackage/,        active: '/total-package' },
  { page: 'thank-you',     match: /thankyou/,            active: null },
  { page: 'privacy',       match: /privacy/,             active: null },
  { page: 'index',         match: /(^|[^a-z])home|index/, active: null },
  { page: 'about',         match: /about/,               active: '/about' },
  { page: 'learn',         match: /learn/,               active: '/learn' },
  { page: 'results',       match: /results/,             active: '/results' },
  { page: 'pricing',       match: /pricing/,             active: '/pricing' },
  { page: 'terms',         match: /terms/,               active: null },
  { page: 'intake',        match: /intake/,              active: null },
];

/* Internal links: the export emits filenames and some routes that have never
   existed. Left alone they 404 or bounce through a redirect. */
const LINKS = [
  ['index.html', '/'], ['about.html', '/about'], ['learn.html', '/learn'],
  ['results.html', '/results'], ['total-package.html', '/total-package'],
  ['terms.html', '/terms'], ['privacy.html', '/privacy'],
  ['intake.html', '/intake'], ['thank-you.html', '/thank-you'],
  ['pricing.html', '/pricing'],
  ['/blog', '/#blog'], ['/process', '/#process'], ['/golf', '/#golf'],
  ['/faq', '/#faq'], ['/es/', '/#bilingual'], ['/webinar', '/learn#webinar'],
  ['/centro', '/total-package#centro'], ['/build-log', '/total-package#buildlog'],
];

/* Nav highlight. Desktop swaps weight and colour, mobile swaps colour only. */
const D_OFF = 'font-weight:500; letter-spacing:-0.08px; color:#D8CFB6;';
const D_ON  = 'font-weight:600; letter-spacing:-0.08px; color:var(--ac1);';
const M_OFF = 'color:#F7F1DE;';
const M_ON  = 'color:var(--ac1);';

const log = (...a) => console.log(...a);
const warn = (...a) => console.log('  ! ', ...a);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/* Attribute quoting depends on how deeply the page is nested inside its
   bundle, so it is detected rather than assumed. */
function detect(s) {
  let Q = null, best = 0;
  for (const c of [B + '"', B + B + '"', B + B + B + '"']) {
    const n = s.split('href=' + c).length - 1;
    if (n > best) { best = n; Q = c; }
  }
  if (!Q) throw new Error('no href attributes found — is this a Claude Design export?');
  const closes = ['<' + B + '/a>', '<' + B + 'u002Fa>', '<' + B + B + '/a>', '<' + B + B + 'u002Fa>']
    .filter(c => s.includes(c));
  const divs = ['<' + B + '/div>', '<' + B + 'u002Fdiv>', '<' + B + B + '/div>', '<' + B + B + 'u002Fdiv>']
    .filter(c => s.includes(c));
  return { Q, closes, divs, hrefs: best };
}

const firstOf = (s, list, from) => {
  let at = -1, len = 0;
  for (const t of list) {
    const i = s.indexOf(t, from);
    if (i !== -1 && (at === -1 || i < at)) { at = i; len = t.length; }
  }
  return [at, len];
};

function readBundleScript(s, type) {
  const a = s.indexOf(`<script type="__bundler/${type}">`);
  if (a === -1) return null;
  const open = s.indexOf('>', a) + 1;
  const close = s.indexOf('</script>', open);
  return { open, close, text: s.slice(open, close).trim() };
}

/* Save a manifest asset to uploads/, reusing an identical file if we already
   host one. Content-addressed, so re-exports do not pile up duplicates. */
function stash(buf, preferredName) {
  const digest = sha(buf);
  for (const f of fs.readdirSync(UPLOADS)) {
    const p = path.join(UPLOADS, f);
    if (fs.statSync(p).isFile() && fs.statSync(p).size === buf.length && sha(fs.readFileSync(p)) === digest) {
      return { name: f, reused: true };
    }
  }
  if (!DRY) fs.writeFileSync(path.join(UPLOADS, preferredName), buf);
  return { name: preferredName, reused: false };
}

/* ---------------------------------------------------------------- stages */

/* Some exports ship double-bundled: the outer bundle swaps the document, then
   an inner loader waits on DOMContentLoaded, which has already fired. The page
   never renders. Unwrapping one level yields the ordinary single-bundle page.
   Assets that live only in the discarded wrapper are written out first. */
function unwrap(s, pageName, repoints) {
  const tpl = readBundleScript(s, 'template');
  if (!tpl) return s;
  let inner;
  try { inner = JSON.parse(tpl.text); } catch { return s; }
  if (typeof inner !== 'string' || !inner.includes('__bundler/template')) return s;

  const man = readBundleScript(s, 'manifest');
  const ext = readBundleScript(s, 'ext_resources');
  if (man && ext) {
    let assets = {}, refs = [];
    try { assets = JSON.parse(man.text); refs = JSON.parse(ext.text); } catch { /* leave it */ }
    for (const r of refs) {
      const a = assets[r.uuid];
      if (!a || !a.data) continue;
      const buf = Buffer.from(a.data, 'base64');
      const ext2 = (a.mime.split('/')[1] || 'bin').replace('quicktime', 'mov');
      const { name, reused } = stash(buf, `${r.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.${ext2}`);
      repoints.push([`${r.id}.${ext2}`, `uploads/${name}`]);
      repoints.push([name, `uploads/${name}`]);
      log(`  wrapper asset ${r.id} -> uploads/${name} (${buf.length} bytes${reused ? ', reused' : ''})`);
    }
  }
  log(`  double-bundled: unwrapped ${(s.length / 1048576).toFixed(2)}MB -> ${(inner.length / 1048576).toFixed(2)}MB`);
  return inner;
}

/* Large videos get inlined as base64, which blocks first paint on a download
   that should stream. Pull them out to a real file and reference it. */
function extractBigMedia(s, E, pageName) {
  const man = readBundleScript(s, 'manifest');
  if (!man) return s;
  let assets;
  try { assets = JSON.parse(man.text); } catch { return s; }
  let changed = false, n = 0;
  for (const [uuid, a] of Object.entries(assets)) {
    if (!a || !a.data || !/^video\//.test(a.mime || '') || a.data.length < 1000000) continue;
    const buf = Buffer.from(a.data, 'base64');
    const ext = (a.mime.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    const { name, reused } = stash(buf, `${pageName}-video-${++n}.${ext}`);
    if (!reused) warn(`extracted a new ${(buf.length / 1048576).toFixed(1)}MB video as uploads/${name} — check it is not a re-encode of one already hosted`);
    const ref = 'src=' + E.Q + uuid + E.Q;
    const hits = s.split(ref).length - 1;
    s = s.split(ref).join('src=' + E.Q + 'uploads/' + name + E.Q);
    delete assets[uuid];
    changed = true;
    log(`  inlined video ${uuid.slice(0, 8)} (${(a.data.length / 1048576).toFixed(1)}MB base64) -> uploads/${name}, ${hits} reference(s) repointed`);
  }
  if (!changed) return s;
  const m2 = readBundleScript(s, 'manifest');
  return s.slice(0, m2.open) + '\n' + JSON.stringify(assets) + '\n  ' + s.slice(m2.close);
}

/* Videos sometimes ship with data-remote-src and no src at all, and nothing in
   the page assigns from it, so they never load. Promote them. */
function promoteDeferredMedia(s) {
  const a = s.split('data-remote-src=').length - 1;
  const b = s.split('data-remote-poster=').length - 1;
  if (a || b) {
    s = s.split('data-remote-src=').join('src=').split('data-remote-poster=').join('poster=');
    log(`  promoted ${a} data-remote-src and ${b} data-remote-poster to real attributes`);
  }
  return s;
}

function stripAnchors(s, E, hrefToken) {
  const OPEN = '<a ' + hrefToken;
  let n = 0;
  for (;;) {
    const i = s.indexOf(OPEN);
    if (i === -1) break;
    const [end, len] = firstOf(s, E.closes, i);
    if (end === -1 || end + len - i > 500) break;
    s = s.slice(0, i) + s.slice(end + len);
    n++;
  }
  return [s, n];
}

/* Clone an existing anchor into a Pricing one, so styling always matches the
   page it lands on rather than being hand-rolled. */
function asPricing(markup, E) {
  const openEnd = markup.indexOf('>');
  let open = markup.slice(0, openEnd + 1);
  const ht = 'href=' + E.Q;
  const hs = open.indexOf(ht);
  const he = open.indexOf(E.Q, hs + ht.length);
  open = open.slice(0, hs) + 'href=' + E.Q + '/pricing' + E.Q + open.slice(he + E.Q.length);
  open = open.split('aria-current=' + E.Q + 'page' + E.Q + ' ').join('');
  const [, clen] = firstOf(markup, E.closes, 0);
  return open + 'Pricing' + markup.slice(markup.length - clen);
}

/* Pricing is linked in both navs and the footer. The export ships the nav
   links but never a footer one. */
function ensurePricing(s, E) {
  if (s.includes('href=' + E.Q + '/pricing' + E.Q)) return [s, 'already present'];
  const RES = '<a href=' + E.Q + '/results' + E.Q;
  const hits = [];
  let i = -1;
  while ((i = s.indexOf(RES, i + 1)) !== -1) {
    const [end, len] = firstOf(s, E.closes, i);
    const m = s.slice(i, end + len);
    if (m.includes('ulp-moblink') || m.includes('font-size:13.5px')) hits.push([i, end + len, m]);
  }
  let nav = 0;
  for (let k = hits.length - 1; k >= 0; k--) {
    const [, en, m] = hits[k];
    const sep = B + 'n' + (m.includes('ulp-moblink') ? '        ' : '          ');
    s = s.slice(0, en) + sep + asPricing(m, E) + s.slice(en);
    nav++;
  }
  let foot = 0;
  const p = s.indexOf('>PRODUCTS<');
  if (p !== -1) {
    const [colEnd] = firstOf(s, E.divs, p);
    const col = s.slice(p, colEnd);
    const r = col.indexOf('>Results<');
    const lastA = r !== -1 ? col.lastIndexOf('<a ', r) : col.lastIndexOf('<a ');
    if (lastA !== -1) {
      const abs = p + lastA;
      const [end, len] = firstOf(s, E.closes, abs);
      s = s.slice(0, end + len) + B + 'n          ' + asPricing(s.slice(abs, end + len), E) + s.slice(end + len);
      foot = 1;
    }
  }
  return [s, `nav+${nav} footer+${foot}`];
}

/* Exactly one nav item highlighted, and only on its own page. Reset everything
   first so a link never inherits another page's active state. */
function setHighlight(s, E, activeHref) {
  const AC = 'aria-current=' + E.Q + 'page' + E.Q;
  let touched = 0, active = 0;
  for (const [cls, mobile] of [['ulp-navlinks', false], ['ulp-mobmenu', true]]) {
    const c = s.indexOf('class=' + E.Q + cls + E.Q);
    if (c === -1) continue;
    let [colEnd] = firstOf(s, E.divs, c);
    let i = c;
    for (;;) {
      i = s.indexOf('<a ', i + 1);
      if (i === -1 || i > colEnd) break;
      const [end, len] = firstOf(s, E.closes, i);
      const m = s.slice(i, end + len);
      const open = m.slice(0, m.indexOf('>') + 1);
      const ht = 'href=' + E.Q;
      const hs = open.indexOf(ht);
      if (hs === -1) { i += open.length; continue; }
      const href = open.slice(hs + ht.length, open.indexOf(E.Q, hs + ht.length));
      let neu = open.split(AC + ' ').join('').split(' ' + AC).join('');
      neu = mobile ? neu.split(M_ON).join(M_OFF) : neu.split(D_ON).join(D_OFF);
      if (activeHref && href === activeHref) {
        neu = mobile ? neu.split(M_OFF).join(M_ON) : neu.split(D_OFF).join(D_ON);
        const h2 = neu.indexOf(ht);
        const cut = neu.indexOf(E.Q, h2 + ht.length) + E.Q.length;
        neu = neu.slice(0, cut) + ' ' + AC + neu.slice(cut);
        active++;
      }
      if (neu !== open) { s = s.slice(0, i) + neu + s.slice(i + open.length); touched++; colEnd += neu.length - open.length; }
      i += neu.length;
    }
  }
  return [s, `${touched} adjusted, ${active} active`];
}

function build(srcFile, spec) {
  const name = spec.page;
  log(`\n=== ${path.basename(srcFile)}  ->  ${name}.html`);
  let s = fs.readFileSync(srcFile, 'utf8');
  const repoints = [];

  s = unwrap(s, name, repoints);
  const E = detect(s);
  log(`  bundle: quote=${E.Q.length}ch, ${E.hrefs} hrefs, ${E.closes.length} close form(s)`);

  s = extractBigMedia(s, E, name);
  s = promoteDeferredMedia(s);

  for (const [from, to] of LINKS) {
    s = s.split('href=' + E.Q + from + E.Q).join('href=' + E.Q + to + E.Q);
  }
  const [s1, gone] = stripAnchors(s, E, 'href=' + E.Q + '/contact' + E.Q);
  s = s1;
  if (gone) log(`  removed ${gone} dead /contact link(s)`);

  const apply = s.split('href=' + E.Q + '#apply' + E.Q).length - 1;
  if (apply) {
    s = s.split('href=' + E.Q + '#apply' + E.Q).join('href=' + E.Q + '/intake' + E.Q);
    log(`  repointed ${apply} #apply link(s) to /intake`);
  }

  /* Media the page expects beside it, which we host under uploads/. */
  const media = [['AJ-Alex-Testimonial.mp4', 'uploads/AJ-Alex-Testimonial.mp4'],
                 ['hero-loop.mp4', 'uploads/hero-loop.mp4'],
                 ['hero-loop.webm', 'uploads/hero-loop.webm'], ...repoints];
  let moved = 0;
  for (const [from, to] of media) {
    const t = 'src=' + E.Q + from + E.Q;
    const n = s.split(t).length - 1;
    if (n) { s = s.split(t).join('src=' + E.Q + to + E.Q); moved += n; }
  }
  if (moved) log(`  repointed ${moved} media reference(s) at uploads/`);

  const head = s.indexOf('</head>');
  if (head === -1) throw new Error(`${name}: no </head> — cannot install page scripts`);
  if (!s.includes('__ulpCtaIntake')) {
    s = s.slice(0, head) + fs.readFileSync(path.join(__dirname, 'snippets/cta-routing.html'), 'utf8') + s.slice(head);
    log('  installed CTA routing (Apply CTAs are labels, not links, so they need it)');
  }
  if (name === 'total-package' && !s.includes('1479736690450235')) {
    const h2 = s.indexOf('</head>');
    s = s.slice(0, h2) + fs.readFileSync(path.join(__dirname, 'snippets/meta-pixel.html'), 'utf8') + s.slice(h2);
    log('  installed Meta Pixel');
  }

  const [s2, pricing] = ensurePricing(s, E);
  s = s2;
  log(`  Pricing links: ${pricing}`);
  const [s3, hl] = setHighlight(s, E, spec.active);
  s = s3;
  log(`  nav highlight: ${hl}`);

  const out = path.join(ROOT, `${name}.html`);
  if (!DRY) fs.writeFileSync(out, s);
  log(`  wrote ${name}.html (${(s.length / 1048576).toFixed(2)}MB)${DRY ? ' [dry run — not written]' : ''}`);
  return name;
}

/* ------------------------------------------------------------------ main */

if (!fs.existsSync(INCOMING)) { log('incoming/ does not exist — nothing to do'); process.exit(0); }
const files = fs.readdirSync(INCOMING).filter(f => /\.html?$/i.test(f));
if (!files.length) { log('No .html files in incoming/ — nothing to publish.'); process.exit(0); }

log(`Found ${files.length} file(s) in incoming/`);
const done = [];
let failed = 0;
for (const f of files) {
  const squashed = f.toLowerCase().replace(/[^a-z]/g, '');
  const spec = PAGES.find(p => p.match.test(squashed));
  if (!spec) {
    warn(`SKIPPED ${f} — filename does not identify a page. Expected one of: ${PAGES.map(p => p.page).join(', ')}`);
    failed++;
    continue;
  }
  try {
    done.push(build(path.join(INCOMING, f), spec));
    if (!DRY) fs.unlinkSync(path.join(INCOMING, f));
  } catch (err) {
    warn(`FAILED ${f}: ${err.message}`);
    failed++;
  }
}

log(`\n${done.length} page(s) rebuilt: ${done.join(', ') || '(none)'}`);
if (failed) { log(`${failed} file(s) could not be processed.`); process.exit(1); }
if (!done.length) process.exit(1);
