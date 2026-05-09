// Pure-SVG hero: vector laptop + phone frames with the screen PNGs embedded
// as base64 <image> elements. No CSS-3D — front view, with a foreshortened
// trapezoid base for fake depth. Output is portable and self-contained,
// matching the quality pattern of the mockup-laptop-*.svg files.
//
// Run: npm run hero:svg

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const ASSETS = resolve(REPO, 'assets');

const LAPTOP_PNG = resolve(ASSETS, 'screen-light-desktop-mindmap.png');
const PHONE_PNG  = resolve(ASSETS, 'screen-dark-mobile-agenda.png');
const OUT_SVG    = resolve(ASSETS, 'hero.svg');

function pngDataUri(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

// ─── Margin ──────────────────────────────────────────────────────────────────
// Uniform breathing room on every side of the composition. Canvas size is
// derived from the content + margin, so left/top/right/bottom all match.
const MARGIN = 100;

// ─── Laptop ──────────────────────────────────────────────────────────────────
// Bezel thickness uniform on all four sides (real MacBook look). Lid width
// is derived from the screen — the notebook ends up a touch narrower than
// a fixed-1700 lid would, which is the whole point.
const BEZEL = 30;
const LID_H = 1062;
const SCREEN_H = LID_H - BEZEL * 2;                       // 1002
const SCREEN_W = Math.round(SCREEN_H * 16 / 10);          // 1603 — keep 16:10
const LID_W = SCREEN_W + BEZEL * 2;                       // 1663
const LID_X = MARGIN;
const LID_Y = MARGIN;
const LID_BOTTOM = LID_Y + LID_H;
const SCREEN_X = LID_X + BEZEL;
const SCREEN_Y = LID_Y + BEZEL;

// Base — drawn as the side profile of the laptop body seen straight-on.
// Sides are vertical (no perspective skew); only the bottom corners are
// rounded, which is how a closed-laptop edge actually reads from the front.
const BASE_HEIGHT = 34;
const BASE_TOP_Y = LID_BOTTOM;
const BASE_BOTTOM_Y = LID_BOTTOM + BASE_HEIGHT;
const BASE_RADIUS = 10;

// Notch (camera housing) at top-center of the lid.
const NOTCH_W = 168;
const NOTCH_H = 22;
const NOTCH_X = LID_X + (LID_W - NOTCH_W) / 2;
const NOTCH_Y = LID_Y + 8;

// ─── Phone ───────────────────────────────────────────────────────────────────
// Sized larger than nominal (×1.17) to mimic the CSS hero's translateZ
// foreshortening — phone reads as "closer to camera" than the laptop.
const PHONE_W = 490;
const PHONE_H = 1062;
const PHONE_OVERHANG_BELOW_BASE = 200;       // phone bottom extends below laptop base
const PHONE_X_OFFSET = 300;                  // shift right of laptop center
const PHONE_BOTTOM_Y = BASE_BOTTOM_Y + PHONE_OVERHANG_BELOW_BASE;
const PHONE_X = LID_X + Math.round(LID_W / 2) - Math.round(PHONE_W / 2) + PHONE_X_OFFSET;
const PHONE_Y = PHONE_BOTTOM_Y - PHONE_H;

// ─── Stage geometry ──────────────────────────────────────────────────────────
// Canvas wraps the content with MARGIN on every side.
const RIGHTMOST = Math.max(LID_X + LID_W, PHONE_X + PHONE_W);
const W = RIGHTMOST + MARGIN;
const H = PHONE_BOTTOM_Y + MARGIN;

// Phone bezel padding before the screen window.
const PHONE_BEZEL = 13;
const PHONE_SCREEN_X = PHONE_X + PHONE_BEZEL;
const PHONE_SCREEN_Y = PHONE_Y + PHONE_BEZEL;
const PHONE_SCREEN_W = PHONE_W - PHONE_BEZEL * 2;
const PHONE_SCREEN_H = PHONE_H - PHONE_BEZEL * 2;

// ─── Build SVG ───────────────────────────────────────────────────────────────
const laptopUri = pngDataUri(LAPTOP_PNG);
const phoneUri  = pngDataUri(PHONE_PNG);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Zenit Week hero — laptop and phone">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="85%">
      <stop offset="0" stop-color="#f1f3f7"/>
      <stop offset="1" stop-color="#c8cfdc"/>
    </radialGradient>
    <linearGradient id="lid-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f2229"/>
      <stop offset="1" stop-color="#16191f"/>
    </linearGradient>
    <linearGradient id="base-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e323b"/>
      <stop offset="0.55" stop-color="#1a1d24"/>
      <stop offset="1" stop-color="#0d0f13"/>
    </linearGradient>
    <linearGradient id="phone-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2e36"/>
      <stop offset="0.6" stop-color="#14161b"/>
      <stop offset="1" stop-color="#0a0c10"/>
    </linearGradient>
    <filter id="laptop-shadow" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="22"/>
    </filter>
    <filter id="phone-shadow" x="-30%" y="-10%" width="160%" height="140%">
      <feDropShadow dx="0" dy="36" stdDeviation="32" flood-color="#000" flood-opacity="0.42"/>
    </filter>
    <clipPath id="lid-screen-clip">
      <rect x="${SCREEN_X}" y="${SCREEN_Y}" width="${SCREEN_W}" height="${SCREEN_H}" rx="6" ry="6"/>
    </clipPath>
    <clipPath id="phone-screen-clip">
      <rect x="${PHONE_SCREEN_X}" y="${PHONE_SCREEN_Y}" width="${PHONE_SCREEN_W}" height="${PHONE_SCREEN_H}" rx="28" ry="28"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- Laptop drop shadow on the desk -->
  <ellipse cx="${W / 2}" cy="${BASE_BOTTOM_Y + 30}" rx="${LID_W / 2 + 60}" ry="36" fill="#000" opacity="0.32" filter="url(#laptop-shadow)"/>

  <!-- Base: vertical sides flush with the lid, only bottom corners rounded. -->
  <path d="M ${LID_X} ${BASE_TOP_Y}
           L ${LID_X + LID_W} ${BASE_TOP_Y}
           L ${LID_X + LID_W} ${BASE_BOTTOM_Y - BASE_RADIUS}
           A ${BASE_RADIUS} ${BASE_RADIUS} 0 0 1 ${LID_X + LID_W - BASE_RADIUS} ${BASE_BOTTOM_Y}
           L ${LID_X + BASE_RADIUS} ${BASE_BOTTOM_Y}
           A ${BASE_RADIUS} ${BASE_RADIUS} 0 0 1 ${LID_X} ${BASE_BOTTOM_Y - BASE_RADIUS}
           Z"
        fill="url(#base-grad)"/>
  <!-- Front lip notch (where you'd open the lid) -->
  <rect x="${W / 2 - 120}" y="${BASE_TOP_Y + 8}" width="240" height="5" rx="2" fill="#0a0c10"/>

  <!-- Lid -->
  <rect x="${LID_X}" y="${LID_Y}" width="${LID_W}" height="${LID_H}" rx="22" ry="22" fill="url(#lid-grad)"/>
  <!-- Lid inner bezel highlight -->
  <rect x="${LID_X + 1}" y="${LID_Y + 1}" width="${LID_W - 2}" height="${LID_H - 2}" rx="21" ry="21" fill="none" stroke="#ffffff" stroke-opacity="0.04"/>

  <!-- Notch -->
  <rect x="${NOTCH_X}" y="${NOTCH_Y}" width="${NOTCH_W}" height="${NOTCH_H}" rx="11" ry="11" fill="#0a0c10"/>
  <circle cx="${W / 2}" cy="${NOTCH_Y + NOTCH_H / 2}" r="3.5" fill="#1a1c20" stroke="#2a2e36" stroke-width="0.5"/>

  <!-- Lid screen content. Use meet since the rect matches the PNG's
       16:10 aspect — nothing crops, nothing letterboxes. -->
  <image href="${laptopUri}" x="${SCREEN_X}" y="${SCREEN_Y}" width="${SCREEN_W}" height="${SCREEN_H}" preserveAspectRatio="xMidYMid meet" clip-path="url(#lid-screen-clip)"/>

  <!-- Phone (drawn last → sits in front of the laptop) -->
  <g filter="url(#phone-shadow)">
    <rect x="${PHONE_X}" y="${PHONE_Y}" width="${PHONE_W}" height="${PHONE_H}" rx="40" ry="40" fill="url(#phone-grad)"/>
  </g>
  <!-- Inner bezel hairline -->
  <rect x="${PHONE_X + 1}" y="${PHONE_Y + 1}" width="${PHONE_W - 2}" height="${PHONE_H - 2}" rx="39" ry="39" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>

  <!-- Phone screen content -->
  <image href="${phoneUri}" x="${PHONE_SCREEN_X}" y="${PHONE_SCREEN_Y}" width="${PHONE_SCREEN_W}" height="${PHONE_SCREEN_H}" preserveAspectRatio="xMidYMin slice" clip-path="url(#phone-screen-clip)"/>
</svg>
`;

writeFileSync(OUT_SVG, svg);
console.log(`  ✓ ${OUT_SVG.replace(REPO + '/', '')}`);
