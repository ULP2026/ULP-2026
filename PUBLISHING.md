# Publishing pipeline

For whoever maintains this site. If you just want to publish a page, read
[`incoming/README.md`](incoming/README.md) instead.

## Why this exists

Claude Design exports cannot be published as they come out. Two separate
reasons:

**They arrive with defects, and the defects are silent.** Observed in a single
fortnight:

| Symptom | Cause |
| ------- | ----- |
| Page renders completely blank | Double-bundled: the outer bundle swaps the document, then an inner loader waits on `DOMContentLoaded`, which has already fired |
| Page ships at 27–28 MB | A ~26 MB video inlined as base64, blocking first paint on a download that should stream |
| A video never loads | `<video>` ships with `data-remote-src` and no `src`, and nothing in the page assigns from it |

None of these throw an error. A blank page and a working page look identical to
anything that is not actually opening them.

**They know nothing about this site's accumulated edits.** Every export resets
internal links to filenames, reinstates routes that have never existed,
reintroduces a dead `/contact` link, and drops the Meta Pixel.

## The two commands

```bash
npm install                 # once
npm run dry-run             # report what would happen, write nothing
npm run publish-pages       # process everything in incoming/
npm run verify              # open every page in a browser and check it
```

Locally, point the verifier at a browser you already have:

```bash
CHROMIUM_PATH="/path/to/chrome" npm run verify
```

## What `tools/publish.js` does

Per file, in order:

1. **Detect and unwrap** a double-bundled export. Assets that exist only in the
   discarded wrapper are written to `uploads/` first.
2. **Extract inlined video** over 1 MB to `uploads/` and repoint at it.
   Content-addressed: an identical file already hosted is reused rather than
   duplicated. A *re-encode* of an existing video will not match, so that case
   is logged as a warning — check it before committing a near-duplicate.
3. **Promote** `data-remote-src` / `data-remote-poster` to `src` / `poster`.
4. **Rewrite links** to clean URLs and repoint routes that do not exist.
5. **Remove** the dead `/contact` link.
6. **Repoint** `#apply` at `/intake`.
7. **Point media** at the copies under `uploads/`.
8. **Install** the CTA routing script, and the Meta Pixel on `/total-package`.
9. **Ensure** Pricing is linked in both navs and the footer — the export ships
   the nav links but never a footer one.
10. **Set the highlight** so exactly one nav item is active, on its own page.

Attribute quoting is *detected*, not assumed — nesting depth varies between
exports, and hard-coding it silently breaks every transform.

## What `tools/verify.js` enforces

Every page is loaded in Chromium, scrolled, and checked for: minimum rendered
text (catches blank pages), zero JS errors, zero failed requests, no dead
`/contact`, no leftover `.html` links, no broken images, a footer Pricing link,
identical menus across all pages, exactly the right nav highlight, `window.fbq`
on `/total-package`, and every `<video>` loading without a media error. Pages
over 12 MB fail as a proxy for something large being inlined.

**Verification is the gate.** CI commits only if it passes, so a broken export
stops before it reaches the live site.

## Editing the transforms

`tools/snippets/` holds the CTA routing script and the Meta Pixel as real
files — edit them there, not inside a page. The link map, page-name matching
and highlight colours are constants at the top of `tools/publish.js`.

The export format has changed shape three times in a fortnight. When it changes
again, expect to adjust `detect()` or add a stage. The pipeline is written to
fail loudly rather than publish something it does not understand — keep it that
way.

## Manual publishing

The pipeline is not required. `npm run publish-pages && npm run verify`, then
commit and push, does the same thing from a laptop. Pushing to `main` is what
triggers the Vercel deploy; nothing else is involved.
