# Drop exports here to publish them

This folder is the inbox. Put a Claude Design export in it and the site updates
itself — no software to install, no terminal.

## Publishing a page

1. Export the page from Claude Design to your computer.
2. Open this folder on GitHub:
   **https://github.com/ULP2026/ULP-2026/tree/main/incoming**
3. Click **Add file → Upload files**, drag the export in, and click
   **Commit changes**.
4. Wait a few minutes. The site updates on its own.

You can upload several pages at once.

## How the page is identified

By the filename, so leave it roughly as exported. Anything containing the word
below becomes that page — extra words, capitals, spaces and `(1)` suffixes are
all fine.

| Filename contains | Page it becomes |
| ----------------- | --------------- |
| `home` or `index` | the homepage     |
| `about`           | /about           |
| `learn`           | /learn           |
| `results`         | /results         |
| `pricing`         | /pricing         |
| `total package`   | /total-package   |
| `terms`           | /terms           |
| `privacy`         | /privacy         |
| `intake`          | /intake          |
| `thank you`       | /thank-you       |

`ULP Total Package (standalone).html` works. So does `Total Package (2).html`.
A file the list cannot match is skipped and reported, not guessed at.

## Checking it worked

Go to the **Actions** tab:
**https://github.com/ULP2026/ULP-2026/actions**

The newest run at the top is yours.

- **Green tick** — published. The site is live within a minute or two.
- **Red cross** — nothing was published and the live site is untouched. Click
  the run to see why.

## If it fails

Nothing breaks. The live site is only ever updated *after* every page has been
opened in a real browser and checked, so a bad export stops at the gate rather
than going live.

Your file stays here in `incoming/` when a run fails, so nothing is lost.

Exports have shipped genuinely broken more than once — pages that render
completely blank, pages 27 MB in size, videos that never load. None of those
show an error on their own; they just quietly fail. That is exactly what the
check is for. If a run goes red, send the export to whoever maintains the site
rather than trying to force it through.

## What happens to your file

Once published successfully it is removed from this folder — that is normal, it
means the export was consumed and turned into the live page.
