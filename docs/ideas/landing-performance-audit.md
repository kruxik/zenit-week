# Landing Page Performance Audit (zenitweek.com)

Audit of `https://zenitweek.com/`, taken on 2026-09-22 from a desktop on a fixed line in Prague. Tools: `dig`, `ping`, `traceroute`, `curl` timing, and a Chrome DevTools performance trace (no CPU or network throttling).

## Summary
The landing page is fast. No finding blocks first render. The items below are headroom, ranked by impact.

| Metric | Value |
|---|---|
| Ping / DNS / TCP / TLS | 7.8 ms / 3 ms / 9 ms / 35 ms |
| TTFB (curl, edge `fra1`, `x-vercel-cache: HIT`) | 54–66 ms |
| TTFB (Chrome) | 13 ms |
| LCP | 78 ms (text node, no resource load) |
| CLS | 0.00 |
| `load` event | 50 ms |
| HTML | 45 KB raw, 11 KB brotli |
| Third-party requests | none (Vercel Insights is first-party, 4.5 KB) |

`traceroute` ends in `*` after the first hops. Vercel filters ICMP, so this is expected and does not indicate a problem.

## 1. Oversized hero image (Low)
**Issue:** `assets/hero.svg` is 661 KB raw and 477 KB with brotli. Brotli saves only 28 %, which usually means the SVG embeds raster data or very dense path data.
**Impact:** The image sits at 2 136 px, below the fold, and has `loading="lazy"`, so it does not delay first render. It still costs almost 0.5 MB on mobile data when the visitor scrolls down.
**Recommendations:**
- Check what makes the file large. `npm run hero:svg` generates it, so fix the generator, not the output.
- If the file embeds raster screenshots, export the hero as AVIF or WebP with `srcset` (1x / 2x) and keep an explicit `width` / `height` to hold CLS at 0.
- If the size comes from path data, run it through SVGO with reduced coordinate precision.
- Target: under 150 KB transferred.

## 2. No long-lived cache for static assets (Low)
**Issue:** Every response, including `/assets/hero.svg` and `/og-image.png`, is served with `cache-control: public, max-age=0, must-revalidate`. A repeat visit revalidates each file (304) instead of reading it from the browser cache.
**Impact:** Tens of milliseconds per request on the Vercel edge. Noticeable only on high-latency mobile connections.
**Recommendations:**
- Add a `vercel.json` header rule for `/assets/(.*)`. The filenames are not content-hashed, so `immutable` with a one-year `max-age` is unsafe. Use `public, max-age=86400, stale-while-revalidate=604800` instead.
- Alternatively, add a content hash or version to asset filenames and then use `max-age=31536000, immutable`.
- Keep `max-age=0, must-revalidate` on HTML, `/app` and `/sw.js`. The update flow depends on that.

## 3. App shell is a single 1 MB file (Low)
**Issue:** `/app` (`zenit-week.html`) is 1.06 MB raw and 306 KB with brotli.
**Impact:** Only the first launch pays for the download and parse. On a slow phone the parse costs a few hundred milliseconds. Later launches are served by `sw.js`.
**Recommendations:**
- No structural change. The single-file policy rules out code splitting.
- Keep an eye on growth. Consider a size budget check in `npm run validate` (for example, fail above 350 KB brotli).

## 4. Heavy social preview image (Very low)
**Issue:** `og-image.png` is 502 KB.
**Impact:** No effect on page load. Link previews on LinkedIn, WhatsApp or Slack can load slowly or be skipped by crawlers with size limits.
**Recommendations:**
- Re-export at 1200×630 and compress it (for example, with `oxipng` or `pngquant`) to under 200 KB. Apply the same to `og-image-cs.png`.

## 5. Inline SVGs in the landing HTML (Negligible)
**Issue:** The HTML contains 21 inline `<svg>` elements. This makes it 45 KB raw.
**Impact:** 11 KB with brotli, and each inline SVG saves a request. This is a net win.
**Recommendations:**
- None. Revisit only if the HTML grows past about 30 KB brotli.

## Reference: comparison with a slow site
A trace of a Laravel/Statamic event site, run the same day with the same method, gave these results for contrast:

| Metric | zenitweek.com | Comparison site |
|---|---|---|
| TTFB | 13 ms | 2 820 ms |
| LCP | 78 ms | 3 064 ms |
| CLS | 0.00 | 0.38 |
| Page weight | ~11 KB | 16.8 MB |

That site was slow because of three things: HTML rendered uncached on every request, a single 16.4 MB PNG shown at 640 px, and a JS height animation that shifted the layout. zenitweek.com avoids all three by design: static HTML at the edge, no large images above the fold, and no layout animation.
