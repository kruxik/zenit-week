// Open Graph image generator. For each locale (en, cs) it:
//   1. Seeds the real Zenit Week app with a minimal week — virtual center
//      plus four branches (Work/Family/Me/Growth) — and captures the rendered
//      mindmap as a transparent-bg PNG.
//   2. Stitches the mindmap into the og-image.svg layout (brand text on the
//      left, mindmap on the right).
//   3. Rasterizes the composed SVG to 1200×630 PNG by loading it in Playwright
//      and screenshotting the viewport.
//
// Mirrors the hero-svg.mjs pattern: SVG is the source of truth, PNG is derived.
//
// Run: npm run og

import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const APP_URL = pathToFileURL(resolve(REPO, 'zenit-week.html')).href;

// ─── Variants ────────────────────────────────────────────────────────────────
const VARIANTS = [
  {
    lang: 'en',
    centerLabel: 'My week',
    labels:   { work: 'Work',  family: 'Family', me: 'Me', growth: 'Growth' },
    headline: { thin: 'Plan what',         bold: 'matters.', letterSpacing: -2,  fontSize: 80 },
    subtitle: ['A visual mind-map week planner.', 'No signup. No servers. Free.'],
    outSvg:   resolve(REPO, 'og-image.svg'),
    outPng:   resolve(REPO, 'og-image.png'),
  },
  {
    lang: 'cs',
    centerLabel: 'Můj týden',
    labels:   { work: 'Práce', family: 'Rodina', me: 'Já', growth: 'Růst' },
    headline: { thin: 'Plánujte to,',      bold: 'na čem záleží.', letterSpacing: -1.5, fontSize: 64 },
    subtitle: ['Vizuální plánovač týdne.', 'Bez registrace. Bez serverů. Zdarma.'],
    outSvg:   resolve(REPO, 'og-image-cs.svg'),
    outPng:   resolve(REPO, 'og-image-cs.png'),
  },
];

// Capture viewport — aspect ratio chosen so the laid-out mindmap (4 branches,
// 2 per side) fills it after fit-to-viewport with minimal whitespace.
const VP_W = 1300;
const VP_H = 1000;
const DPR  = 2;

// Branch palette (must match defaults; growth is added on top).
const COLORS_SEED = {
  work:   { main: '#F24E1E' },
  family: { main: '#A259FF' },
  me:     { main: '#1ABCFE' },
  growth: { main: '#19C82A' },
};

// ─── Seed ────────────────────────────────────────────────────────────────────
function buildSeedWeek(labels) {
  // Order in the array determines vertical stacking within each side:
  // left → [work top, family bottom]; right → [me top, growth bottom].
  // offY pushes branches further from horizontal axis so the captured
  // mindmap bbox is ~square (matches the square embed slot in og-image.svg).
  const SPREAD = 200;
  return {
    nodes: [
      { id: 'work',   type: 'branch', branch: 'work',   label: labels.work,   children: [], side: 'left',  offY: -SPREAD, _ts: 0 },
      { id: 'family', type: 'branch', branch: 'family', label: labels.family, children: [], side: 'left',  offY:  SPREAD, _ts: 0 },
      { id: 'me',     type: 'branch', branch: 'me',     label: labels.me,     children: [], side: 'right', offY: -SPREAD, _ts: 0 },
      { id: 'growth', type: 'branch', branch: 'growth', label: labels.growth, children: [], side: 'right', offY:  SPREAD, _ts: 0 },
    ],
    tombstones: [],
    crdtVersion: 0,
  };
}

async function seedPage(page, { lang, week, colors }) {
  await page.evaluate(async ({ lang, week, colors }) => {
    localStorage.setItem('zenit-week-theme', 'dark');
    localStorage.setItem('zenit-week-lang',  lang);
    localStorage.setItem('zenit-week-view',  'mindmap');

    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('zenit-week-db', 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('weeks')) d.createObjectStore('weeks', { keyPath: 'weekKey' });
        if (!d.objectStoreNames.contains('misc'))  d.createObjectStore('misc');
      };
      req.onsuccess = (e) => res(e.target.result);
      req.onerror   = (e) => rej(e.target.error);
    });

    function todayWeekKey() {
      const d = new Date();
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((t - yearStart) / 86_400_000) + 1) / 7);
      return `${t.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
    }
    const wk = todayWeekKey();

    await new Promise((res, rej) => {
      const tx = db.transaction('weeks', 'readwrite');
      tx.objectStore('weeks').put({ weekKey: wk, data: week });
      tx.oncomplete = res;
      tx.onerror = (e) => rej(e.target.error);
    });

    await new Promise((res, rej) => {
      const tx = db.transaction('misc', 'readwrite');
      tx.objectStore('misc').put(colors, 'zenit-week-colors');
      tx.oncomplete = res;
      tx.onerror = (e) => rej(e.target.error);
    });

    db.close();
  }, { lang, week, colors });
}

// ─── Capture ─────────────────────────────────────────────────────────────────
async function captureMindmap(variant) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    deviceScaleFactor: DPR,
  });
  const page = await ctx.newPage();

  await page.goto(APP_URL, { waitUntil: 'load' });
  await seedPage(page, {
    lang: variant.lang,
    week: buildSeedWeek(variant.labels),
    colors: COLORS_SEED,
  });
  await page.reload({ waitUntil: 'load' });

  await page.waitForFunction(
    () => document.querySelectorAll('#main-svg .node-group').length >= 5,
    { timeout: 10_000 },
  );

  // Replace the virtual center's "Week N / (range)" label with the marketing
  // line. The renderer creates one <text> per visual line, so drop extras and
  // recentre the survivor vertically inside the rect.
  await page.evaluate((centerLabel) => {
    const g = document.querySelector('.node-group[data-id="center"]');
    if (!g) return;
    // Strip in-app chrome (settings gear, week-nav arrows, +branch buttons)
    // from the center node — pure noise in a static marketing image.
    g.querySelectorAll('.gear-btn, .week-nav-btn, .add-btn').forEach(n => n.remove());
    const texts = g.querySelectorAll('text');
    if (!texts.length) return;
    for (let i = 1; i < texts.length; i++) texts[i].remove();
    const t = texts[0];
    t.textContent = centerLabel;
    t.setAttribute('y', '0');
    t.setAttribute('dominant-baseline', 'middle');
  }, variant.centerLabel);

  // Fit content to viewport (same UX as clicking the zoom label).
  await page.evaluate(() => document.getElementById('zoom-label')?.click());
  await page.waitForTimeout(400);

  // Strip every overlay so the only painted content inside the clip rect is
  // the mindmap geometry on a transparent canvas.
  await page.evaluate(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const svg = document.getElementById('main-svg');
    if (svg) svg.style.background = 'transparent';
    const cc = document.getElementById('canvas-container');
    if (cc) { cc.style.background = 'transparent'; cc.style.backgroundImage = 'none'; }
    const overlays = [
      '#toolbar', '#fab-pill', '#view-level-bar', '#view-level-toast',
      '#zoom-label', '#help-fab', '#help-panel', '#sync-container',
      '#placeholder-panel', '#agenda-view', '#context-menu',
      '#app-confirm-overlay',
    ];
    for (const sel of overlays) {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    }
  });
  await page.waitForTimeout(200);

  // Tight crop: the mindmap's union bbox in viewport coordinates, padded
  // lightly. Beats screenshotting the whole #main-svg (which is viewport-
  // sized and leaves the mindmap looking tiny when embedded).
  const clip = await page.evaluate(() => {
    const root = document.getElementById('map-root');
    if (!root) return null;
    const r = root.getBoundingClientRect();
    const pad = 30;
    return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  });
  if (!clip) throw new Error('map-root not found — render failed');

  const buf = await page.screenshot({ omitBackground: true, type: 'png', clip });
  await browser.close();
  return buf;
}

// ─── Compose SVG ─────────────────────────────────────────────────────────────
// Brand text on the left, embedded mindmap PNG on the right. The mindmap is
// placed in the same 480×500 area the hand-drawn mockup used to occupy.
function buildOgSvg(variant, mindmapB64) {
  const { headline, subtitle } = variant;
  const headlineThinY = 200;
  const headlineBoldY = headlineThinY + headline.fontSize * 1.125;
  const subY1 = Math.round(headlineBoldY + 80);
  const subY2 = subY1 + 38;

  // Mindmap embed area (right column). Square slot, right padding mirrors
  // the 80px left padding of the brand block. Width is 20% larger than the
  // original 480px footprint; height matches to keep the slot square so the
  // bezier curves read as a square mind-map rather than a wide ribbon.
  const MM_W = 576;            // 480 * 1.2
  const MM_H = 576;            // square
  const MM_X = 1200 - 80 - MM_W; // 544 — right padding == left padding (80)
  const MM_Y = (630 - MM_H) / 2; // 27 — vertically centered

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="bg-glow" cx="65%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#2a2a4e" stop-opacity="1"/>
      <stop offset="100%" stop-color="#1a1a2e" stop-opacity="1"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg-glow)"/>

  <!-- ══ LEFT: brand + headline ══ -->
  <g transform="translate(80, 90)" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
    <!-- Logo -->
    <g transform="translate(0, 0)">
      <text x="0" y="36" font-size="36" font-weight="300" fill="#fff">Zen</text>
      <path d="M 79,28 C 91,28 91,18 95,18" fill="none" stroke="#A259FF" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M 79,28 C 91,28 91,38 95,38" fill="none" stroke="#1ABCFE" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="74" cy="28" r="6" fill="#fff"/>
      <circle cx="98" cy="18" r="4.5" fill="#A259FF"/>
      <circle cx="98" cy="38" r="4.5" fill="#1ABCFE"/>
      <text x="106" y="36" font-size="36" font-weight="700" fill="#fff">it</text>
      <text x="138" y="36" font-size="36" font-weight="300" fill="#fff"> Week</text>
    </g>

    <!-- Headline -->
    <text x="0" y="${headlineThinY}" font-size="${headline.fontSize}" font-weight="300" fill="#fff" letter-spacing="${headline.letterSpacing}">${headline.thin}</text>
    <text x="0" y="${headlineBoldY}" font-size="${headline.fontSize}" font-weight="700" fill="#fff" letter-spacing="${headline.letterSpacing}">${headline.bold}</text>

    <!-- Subtitle -->
    <text x="0" y="${subY1}" font-size="26" font-weight="400" fill="rgba(255,255,255,0.65)">${subtitle[0]}</text>
    <text x="0" y="${subY2}" font-size="26" font-weight="400" fill="rgba(255,255,255,0.65)">${subtitle[1]}</text>

    <!-- URL -->
    <text x="0" y="490" font-size="22" font-weight="600" fill="#1ABCFE">zenitweek.com</text>
  </g>

  <!-- ══ RIGHT: real mindmap rendering ══ -->
  <image href="data:image/png;base64,${mindmapB64}" x="${MM_X}" y="${MM_Y}" width="${MM_W}" height="${MM_H}" preserveAspectRatio="xMidYMid meet"/>
</svg>
`;
}

// ─── Rasterize ───────────────────────────────────────────────────────────────
async function rasterizeSvgToPng(svgPath, pngPath) {
  // DPR=2 → 2400×1260 raw pixels for the 1200×630 logical canvas. Social
  // scrapers downscale to fit their cards, so a 2× source keeps text and
  // the embedded mindmap PNG crisp instead of blurring at 1×.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(svgPath).href, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
}

// ─── Run ─────────────────────────────────────────────────────────────────────
for (const variant of VARIANTS) {
  console.log(`[${variant.lang}] capturing mindmap…`);
  const buf = await captureMindmap(variant);
  const b64 = buf.toString('base64');

  writeFileSync(variant.outSvg, buildOgSvg(variant, b64));
  console.log(`  ✓ ${variant.outSvg.replace(REPO + '/', '')}`);

  await rasterizeSvgToPng(variant.outSvg, variant.outPng);
  console.log(`  ✓ ${variant.outPng.replace(REPO + '/', '')}`);
}
console.log('Done.');
