// Hero composition: open MacBook (light mindmap) with iPhone in front
// (dark agenda), rendered via CSS 3D transforms and captured by Playwright.
//
// Reads existing PNGs from assets/. Run `npm run screenshots` first if missing.
//
// Run: npm run hero

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const ASSETS = resolve(REPO, 'assets');

const LAPTOP_PNG = resolve(ASSETS, 'screen-light-desktop-mindmap.png');
const PHONE_PNG  = resolve(ASSETS, 'screen-dark-mobile-agenda.png');
const OUT_PNG    = resolve(ASSETS, 'hero.png');

function pngDataUri(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const STAGE_W = 2400;
const STAGE_H = 1600;

// Strategy: lay out the laptop as a 2D mockup (lid on top, fake-perspective
// base under it), then rotate the whole thing slightly around Y for the
// 3/4 hero feel. Phone is placed in front, rotated similarly.

const html = /* html */ `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg-1: #f1f3f7;
    --bg-2: #c8cfdc;
    --gray-light: #2e323b;
    --gray-mid:   #1a1d24;
    --gray-deep:  #0d0f13;
    --hinge:      #0a0c10;
  }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${STAGE_W}px; height: ${STAGE_H}px;
    background: radial-gradient(ellipse at 50% 30%, var(--bg-1) 0%, var(--bg-2) 75%);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  }

  .stage {
    width: 100%; height: 100%;
    position: relative;
    perspective: 3500px;
    perspective-origin: 50% 60%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Direct front view — looking straight at the desk, slight downward tilt
     so we can see the laptop base and the phone in front of it. */
  .scene {
    position: relative;
    transform-style: preserve-3d;
    transform: rotateX(8deg);
  }

  /* ── Laptop ─────────────────────────────────────────────────────────── */
  .macbook {
    position: relative;
    width: 1700px;
    transform-style: preserve-3d;
  }

  /* Lid (the main visible surface). Tilted slightly back like a real laptop
     opened past 90°. Padding-top sets the 16:10 aspect ratio. */
  .lid {
    width: 100%;
    padding-top: 62.5%;       /* 1500 × 0.625 = 937.5 → 16:10 */
    background: var(--gray-mid);
    border-radius: 22px 22px 4px 4px;
    position: relative;
    transform: rotateX(-3deg);
    transform-origin: 50% 100%;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.04) inset,
      0 30px 60px -10px rgba(0,0,0,0.4);
  }
  .lid .notch {
    position: absolute;
    top: 8px; left: 50%; transform: translateX(-50%);
    width: 168px; height: 22px;
    background: var(--hinge);
    border-radius: 0 0 12px 12px;
    z-index: 2;
  }
  .lid .notch::after {
    content: ""; position: absolute;
    top: 9px; left: 50%; transform: translateX(-50%);
    width: 7px; height: 7px; border-radius: 50%;
    background: #1a1c20;
    box-shadow: inset 0 0 0 1px #2a2e36;
  }
  .lid .screen {
    position: absolute;
    inset: 38px 26px 26px 26px;
    border-radius: 6px;
    overflow: hidden;
    background: #fff;
  }
  .lid .screen img {
    width: 100%; height: 100%;
    display: block;
    object-fit: cover;
    object-position: top center;
  }

  /* Base: thicker slab with milder perspective tilt so the keyboard area
     reads clearly. */
  .base {
    width: 104%;
    height: 90px;
    margin-left: -2%;
    background: linear-gradient(180deg, var(--gray-light) 0%, var(--gray-mid) 55%, var(--gray-deep) 100%);
    border-radius: 0 0 14px 14px;
    transform-origin: 50% 0%;
    transform: perspective(1200px) rotateX(58deg);
    position: relative;
    z-index: 0;
  }
  /* Symmetric drop shadow under the whole laptop, decoupled from the base's
     3D rotation so it doesn't lean to one side. */
  .macbook-shadow {
    position: absolute;
    bottom: -80px;
    left: 50%;
    transform: translateX(-50%);
    width: 95%;
    height: 90px;
    background: radial-gradient(ellipse at center, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0) 70%);
    filter: blur(20px);
    z-index: -1;
  }
  /* Front lip notch (where you'd open the lid). */
  .base::after {
    content: ""; position: absolute;
    top: 6px; left: 50%; transform: translateX(-50%);
    width: 240px; height: 5px;
    background: var(--gray-deep);
    border-radius: 4px;
  }

  /* ── Phone ───────────────────────────────────────────────────────────── */
  /* Centered horizontally, pulled toward camera so it sits in front of
     the laptop on the desk. */
  .phone {
    position: absolute;
    left: 50%;
    bottom: -70px;
    width: 420px;
    height: 910px;
    margin-left: -210px;
    transform-style: preserve-3d;
    transform: translateZ(500px);
    background: linear-gradient(155deg, #2a2e36 0%, #14161b 60%, #0a0c10 100%);
    border-radius: 40px;
    padding: 11px;
    box-sizing: border-box;
    box-shadow:
      0 -1px 0 rgba(255,255,255,0.07) inset,
      0 40px 70px -15px rgba(0,0,0,0.45),
      0 12px 20px -6px rgba(0,0,0,0.3);
    z-index: 5;
  }
  .phone .screen {
    position: relative;
    width: 100%; height: 100%;
    border-radius: 34px;
    overflow: hidden;
    background: #000;
  }
  /* Show the whole agenda edge-to-edge horizontally. Cover-fit with
     top-center anchor keeps the full width visible (only ~6 px of side
     bleed cropped) and the top of the agenda anchored. */
  .phone .screen img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    object-position: top center;
    image-rendering: -webkit-optimize-contrast;
  }
  .lid .screen img,
  .phone .screen img {
    image-rendering: -webkit-optimize-contrast;
  }
  .phone .island {
    position: absolute;
    top: 16px; left: 50%; transform: translateX(-50%);
    width: 118px; height: 34px;
    background: var(--hinge);
    border-radius: 18px;
    z-index: 2;
  }
  .phone::before {
    content: ""; position: absolute;
    top: 130px; left: -3px;
    width: 4px; height: 90px;
    background: linear-gradient(90deg, #0a0c10 0%, #2a2e36 100%);
    border-radius: 2px 0 0 2px;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="scene">
      <div class="macbook">
        <div class="lid">
          <div class="notch"></div>
          <div class="screen"><img src="${pngDataUri(LAPTOP_PNG)}" alt=""></div>
        </div>
        <div class="base"></div>
        <div class="macbook-shadow"></div>
      </div>

      <div class="phone">
        <div class="screen"><img src="${pngDataUri(PHONE_PNG)}" alt=""></div>
      </div>
    </div>
  </div>
</body>
</html>
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: STAGE_W, height: STAGE_H },
  deviceScaleFactor: 3,           // matches mobile capture DPR for crisp screen content
});
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT_PNG, type: 'png' });
await browser.close();
console.log(`  ✓ ${OUT_PNG.replace(REPO + '/', '')}`);
