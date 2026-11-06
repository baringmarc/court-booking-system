# Maintaining the venue owner manual

Edit the owner-facing copy in `manual.html` and the print layout in `manual.css`. Each article is one page. Contents page numbers and `data-ref` cross-references are computed when the page loads, and the build fails if a page runs into its footer or a link has no target. The generator uses the repo’s installed Fraunces and DM Sans fonts, brand tile and Playwright Chromium. Screenshots are included so normal edits can be printed without a database.

From the repository root, with dependencies and Chromium installed (`npm ci`, then `npx playwright install chromium`), run:

```sh
node docs/owner-manual/build.mjs
```

The local Dashboard downloads `/guides/venue-owner-manual.pdf`. The intended stable public address on release is `https://app.plotline.fit/guides/venue-owner-manual.pdf`. T17.25 can fetch the versioned static asset at `/guides/venue-owner-manual-v1.0.pdf` for the attachment. Both files in `public/guides/` must be byte-identical for the current edition. The generator enforces a 2,000,000-byte budget before copying the edition to the stable name. Keep older released editions available. For a new edition, change the version metadata and visible date/edition in the source, and update the attachment URL and its download test together.

## Refresh demo screenshots

With Node 22.12+ and the full local Supabase stack running, run:

```sh
node scripts/with-lock.mjs node --experimental-strip-types docs/owner-manual/capture.mjs
node docs/owner-manual/build.mjs
```

The capture uses a disposable local Garden Courts venue and synthetic transfers, sets the local booking fee to ₱10 for the walkthrough and restores its previous value afterward. Only that fixture uses the activated schedule. Captures are cropped to the relevant controls. The script removes its venue, sample receipt and staff account on exit. Use only synthetic data and inspect pixels as well as PDF text and link annotations for private details.

## Check an edition before release

1. Render all pages (`pdftoppm -png public/guides/venue-owner-manual.pdf /tmp/owner-page`) and read each at page-fit and zoom. Look for missing screenshots, clipped controls, broken glyphs and text touching footers. Check the contents and return links, plus email, Facebook and Messenger targets against `../plotline-site/src/config/site.ts` and the task’s support address.
2. Run `node .claude/hooks/verify-gate.mjs --full`. The owner-manual e2e downloads from the Dashboard at desktop and 360px and checks both public URLs before sign-in. Inspect the finished build on a local static server as well.
3. Before inviting real owners, confirm the deployed admin UI matches this edition (including per-venue schedule activation and the Reports migration). Release hosting and invitation delivery together after the separate release approval. Verify the public file returns PDF bytes before enabling invitations.
