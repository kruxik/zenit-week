#!/usr/bin/env node
// Generate static PNG icons for the PWA manifest, rendered from the same
// canvas brandmark code that draws favicons in zenit-week.html.
//
// Why static files: Android Chrome only builds a real WebAPK (no browser
// badge on the home-screen icon) when the manifest icons resolve to real
// fetchable URLs. Inline `data:` URLs work for desktop but cause Chrome
// to install a shortcut instead — hence the Chrome-icon overlay.
//
// Outputs:
//   assets/icon-192.png           purpose "any"      — 192  rounded bg
//   assets/icon-512.png           purpose "any"      — 512  rounded bg
//   assets/icon-1024.png          purpose "any"      — 1024 rounded bg (HiDPI)
//   assets/icon-1024-maskable.png purpose "maskable" — 1024 70% safe zone
//
// Only one maskable size: 512 maskable was confirmed via the watermark
// trick to be the icon Chrome picked for the Android splash screen
// (~192dp ≈ 768px on xxxhdpi), and upscaling 512→768 softens the
// brandmark. With only 1024 maskable in the manifest Chrome is forced
// to use it for both launcher (clean downscale) and splash (clean
// downscale) so both render sharp.
//
// Diagnostic mode:
//   WATERMARK=1 node scripts/generate-pwa-icons.mjs
// Bakes the size into the top-left corner of each PNG so you can
// visually identify which icon Android Chrome picked for the splash
// screen (or any other surface). Reinstall the PWA after deploy; the
// number you see on the splash IS the picked size. Re-run without the
// flag to regenerate clean icons before committing.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '..', 'assets');

const HTML = `<!doctype html><html><body><script>
function drawBrandmark(ctx, size, rootFill) {
  const s = size / 64;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.5 * s;
  ctx.strokeStyle = '#A259FF';
  ctx.beginPath(); ctx.moveTo(18*s, 32*s); ctx.bezierCurveTo(32*s, 32*s, 32*s, 14*s, 42*s, 14*s); ctx.stroke();
  ctx.strokeStyle = '#1ABCFE';
  ctx.beginPath(); ctx.moveTo(18*s, 32*s); ctx.bezierCurveTo(32*s, 32*s, 32*s, 50*s, 42*s, 50*s); ctx.stroke();
  ctx.fillStyle = rootFill;
  ctx.beginPath(); ctx.arc(12*s, 32*s, 7*s, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#A259FF';
  ctx.beginPath(); ctx.arc(48*s, 14*s, 5*s, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#1ABCFE';
  ctx.beginPath(); ctx.arc(48*s, 50*s, 5*s, 0, Math.PI*2); ctx.fill();
}
// Fresh canvas per render — reusing a single canvas across sizes
// occasionally produced blank output in headless Chromium.
function newCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function drawCenteredLabel(ctx, size, label) {
  ctx.save();
  ctx.fillStyle = '#FFEB3B';
  // Font size shrinks slightly as the label gets longer so 4-char strings
  // ("1024m") still fit comfortably inside the safe zone.
  const factor = label.length >= 5 ? 0.26 : label.length >= 4 ? 0.30 : 0.36;
  const fontPx = Math.round(size * factor);
  ctx.font = 'bold ' + fontPx + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  ctx.restore();
}
window.renderAny = (size, watermark) => {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#181825';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * 0.22); ctx.fill(); }
  else ctx.fillRect(0, 0, size, size);
  if (watermark) {
    // Diagnostic mode: replace the brandmark with a big centered size
    // label so the picked icon is unambiguous on launcher and splash.
    drawCenteredLabel(ctx, size, String(size));
  } else {
    drawBrandmark(ctx, size, '#f0f0f0');
  }
  return c.toDataURL('image/png');
};
window.renderMaskable = (size, watermark) => {
  const c = newCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#181825';
  ctx.fillRect(0, 0, size, size);
  if (watermark) {
    // Label sits at the true canvas center, fully inside the 70% safe
    // zone — survives adaptive-icon masking on the launcher.
    drawCenteredLabel(ctx, size, String(size) + 'm');
  } else {
    ctx.translate(size * 0.15, size * 0.15);
    ctx.scale(0.7, 0.7);
    drawBrandmark(ctx, size, '#f0f0f0');
  }
  return c.toDataURL('image/png');
};
</script></body></html>`;

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

async function main() {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(HTML);

    const targets = [
      { fn: 'renderAny',      size: 192,  out: 'icon-192.png' },
      { fn: 'renderAny',      size: 512,  out: 'icon-512.png' },
      { fn: 'renderAny',      size: 1024, out: 'icon-1024.png' },
      { fn: 'renderMaskable', size: 1024, out: 'icon-1024-maskable.png' },
    ];

    const watermark = !!process.env.WATERMARK;
    if (watermark) console.log('[pwa-icons] watermark mode ON — bake size labels into corners');
    for (const t of targets) {
      const dataUrl = await page.evaluate(([fn, size, wm]) => window[fn](size, wm), [t.fn, t.size, watermark]);
      const buf = dataUrlToBuffer(dataUrl);
      // Sanity floor — a blank PNG compresses to far less than a drawn one.
      // Anything near the floor for the given size means the canvas
      // rendered empty (silent headless-Chromium glitch).
      const minBytes = t.size >= 1024 ? 40000 : t.size >= 512 ? 12000 : 3000;
      if (buf.length < minBytes) {
        throw new Error(`[pwa-icons] ${t.out} suspiciously small (${buf.length} bytes) — likely blank canvas`);
      }
      const outPath = resolve(ASSETS_DIR, t.out);
      writeFileSync(outPath, buf);
      console.log(`[pwa-icons] wrote ${t.out} (${t.size}x${t.size}, ${buf.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
