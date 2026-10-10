// Screenshot generator for Zenit Week.
// Loads the onboarding playground week from assets/playground-seed.json (the
// sample week a new user sees), seeds IndexedDB with it, then captures PNGs at desktop and
// mobile viewports in both views (mindmap + agenda) and both themes (light + dark).
// Each PNG is also wrapped in a vector laptop / phone SVG frame.
//
// Run: npm run screenshots

import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const APP_URL = pathToFileURL(resolve(REPO, 'zenit-week.html')).href;
const ASSETS = resolve(REPO, 'assets');
// The onboarding playground: the sample week a new user sees on first run.
// The marketing shots show the same week, so tuning it updates both.
const SEED_JSON = resolve(REPO, 'assets', 'playground-seed.json');

// ─── Seed data load ──────────────────────────────────────────────────────────
// Builds the week the way maybeSeedPlayground() in the app does: in Czech
// `labelCs` / `commentsCs` replace the English text wherever they exist, in
// English they are dropped. Unlike the app it leaves out `_demo`, which would
// bring up the "clear the example week" nudge.
function loadSeed(lang) {
  const seed = JSON.parse(readFileSync(SEED_JSON, 'utf8'));
  const nodes = (seed.week?.nodes || []).map(({ labelCs, commentsCs, ...rest }) => {
    const node = { ...rest, _ts: 0 };
    if (lang === 'cs' && labelCs) node.label = labelCs;
    if (lang === 'cs' && commentsCs) node.comments = commentsCs;
    return node;
  });
  const week = { nodes, tombstones: [], crdtVersion: 0 };

  // Every branch renders in its playground colour, so the shots, the OG images
  // and a freshly seeded app all show the same palette.
  const colors = {};
  for (const [branch, c] of Object.entries(seed.colors || {})) {
    if (c?.main) colors[branch] = { main: c.main };
  }

  return { week, colors };
}

// ─── Page seeding ────────────────────────────────────────────────────────────
// Runs in browser context. Writes localStorage + IDB before app first paint.
async function seedPage(page, { lang, theme, view, week, colors }) {
  await page.evaluate(async ({ lang, theme, view, week, colors }) => {
    localStorage.setItem('zenit-week-theme', theme);
    localStorage.setItem('zenit-week-lang', lang);
    localStorage.setItem('zenit-week-view', view);

    // Open IDB exactly like the app does (DB_NAME='zenit-week-db' v1).
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

    // Seed weekData.
    await new Promise((res, rej) => {
      const tx = db.transaction('weeks', 'readwrite');
      tx.objectStore('weeks').put({ weekKey: wk, data: week });
      tx.oncomplete = res;
      tx.onerror = (e) => rej(e.target.error);
    });

    // Seed branch colors so every branch keeps its playground colour.
    if (colors) {
      await new Promise((res, rej) => {
        const tx = db.transaction('misc', 'readwrite');
        tx.objectStore('misc').put(colors, 'zenit-week-colors');
        tx.oncomplete = res;
        tx.onerror = (e) => rej(e.target.error);
      });
    }

    db.close();
  }, { lang, theme, view, week, colors });
}

// ─── Capture matrix ──────────────────────────────────────────────────────────
// Mobile mindmap is intentionally skipped: the mind-map's wide aspect leaves
// large dead zones in portrait. The agenda is how the app is actually used
// on a phone, so that's what we ship.
const FORMS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2,                                    views: ['mindmap', 'agenda'] },
  mobile:  { width: 390,  height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true,    views: ['agenda'] },
};
const THEMES = ['light', 'dark'];
// English gets the whole matrix. Czech only the two shots the hero is built
// from (scripts/hero-svg.mjs), saved with a `-cs` suffix for cs/index.html.
const LANGS = ['en', 'cs'];
const CS_SHOTS = new Set(['light-desktop-mindmap', 'dark-mobile-agenda']);

async function capture() {
  const browser = await chromium.launch();

  const results = {};
  for (const lang of LANGS) {
    const seed = loadSeed(lang);
    const suffix = lang === 'en' ? '' : `-${lang}`;
    for (const theme of THEMES) {
      for (const [form, vp] of Object.entries(FORMS)) {
        for (const view of vp.views) {
          if (lang === 'cs' && !CS_SHOTS.has(`${theme}-${form}-${view}`)) continue;
          const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: vp.deviceScaleFactor,
            isMobile: !!vp.isMobile,
            hasTouch: !!vp.hasTouch,
          });
          const page = await ctx.newPage();

          await page.goto(APP_URL, { waitUntil: 'load' });
          await seedPage(page, { lang, theme, view, week: seed.week, colors: seed.colors });
          await page.reload({ waitUntil: 'load' });

          // Seeding the view through localStorage alone has come back on the
          // wrong view (a dark mobile run captured the mindmap), so state the
          // intent again once the app is live and wait for it to land.
          await page.waitForFunction(() => typeof window.switchView === 'function', { timeout: 10_000 });
          await page.evaluate((v) => {
            if (document.documentElement.dataset.view !== v) window.switchView(v);
          }, view);
          await page.waitForFunction(
            (v) => document.documentElement.dataset.view === v,
            view,
            { timeout: 10_000 },
          );

          if (view === 'mindmap') {
            await page.waitForFunction(
              () => document.querySelectorAll('#main-svg text').length > 3,
              { timeout: 10_000 },
            );
            // Fit content to viewport — same UX as clicking the zoom label.
            await page.evaluate(() => document.getElementById('zoom-label')?.click());
          } else {
            await page.waitForFunction(
              () => document.querySelector('#agenda-view')?.children.length > 0,
              { timeout: 10_000 },
            );
          }
          await page.waitForTimeout(500);

          const out = resolve(ASSETS, `screen-${theme}-${form}-${view}${suffix}.png`);
          await page.screenshot({ path: out, type: 'png' });
          results[`${theme}-${form}-${view}${suffix}`] = out;
          console.log(`  ✓ ${out.replace(REPO + '/', '')}`);

          await ctx.close();
        }
      }
    }
  }
  await browser.close();
  return results;
}

// ─── SVG mockups ─────────────────────────────────────────────────────────────
// Embed each PNG inside a vector device frame. PNG is base64-inlined so the
// SVG stays portable without companion files.
function pngDataUri(path) {
  const b64 = readFileSync(path).toString('base64');
  return `data:image/png;base64,${b64}`;
}

function laptopMockup(pngPath, theme) {
  const screenW = 1440, screenH = 900;
  const pad = 32, bezel = 18, hingeH = 14, baseH = 26;
  const lidW = screenW + pad * 2;
  const lidH = screenH + pad * 2;
  const baseW = lidW + 120;
  const totalW = baseW + 80;
  const totalH = lidH + hingeH + baseH + 80;
  const lidX = (totalW - lidW) / 2;
  const lidY = 40;
  const screenX = lidX + pad;
  const screenY = lidY + pad;
  const baseX = (totalW - baseW) / 2;
  const baseY = lidY + lidH;

  const bg = theme === 'dark' ? '#0b0d12' : '#eef0f4';
  const lid = theme === 'dark' ? '#1a1d24' : '#1f2229';
  const base = theme === 'dark' ? '#23262e' : '#2a2d35';
  const baseEdge = theme === 'dark' ? '#3a3e48' : '#42464f';
  const dataUri = pngDataUri(pngPath);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" role="img" aria-label="Zenit Week on a laptop">
  <defs>
    <filter id="lid-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.18"/>
    </filter>
    <linearGradient id="base-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${baseEdge}"/>
      <stop offset="1" stop-color="${base}"/>
    </linearGradient>
    <clipPath id="screen-clip">
      <rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="${bezel}" ry="${bezel}"/>
    </clipPath>
  </defs>
  <rect width="${totalW}" height="${totalH}" fill="${bg}"/>

  <!-- Lid -->
  <g filter="url(#lid-shadow)">
    <rect x="${lidX}" y="${lidY}" width="${lidW}" height="${lidH}" rx="${bezel + 6}" ry="${bezel + 6}" fill="${lid}"/>
    <circle cx="${totalW / 2}" cy="${lidY + pad / 2}" r="3" fill="#0a0a0a"/>
    <image href="${dataUri}" x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#screen-clip)"/>
  </g>

  <!-- Hinge gap -->
  <rect x="${baseX}" y="${baseY}" width="${baseW}" height="${hingeH}" fill="${base}"/>

  <!-- Base -->
  <path d="M ${baseX} ${baseY + hingeH}
           L ${baseX + baseW} ${baseY + hingeH}
           L ${baseX + baseW - 30} ${baseY + hingeH + baseH}
           L ${baseX + 30} ${baseY + hingeH + baseH} Z"
        fill="url(#base-grad)"/>
  <rect x="${totalW / 2 - 80}" y="${baseY + hingeH + 4}" width="160" height="6" rx="3" fill="#000" opacity="0.35"/>
</svg>`;
}

function phoneMockup(pngPath, theme) {
  const screenW = 390, screenH = 844;
  const bezel = 14;
  const totalW = screenW + bezel * 2;
  const totalH = screenH + bezel * 2;
  const radius = 56;
  const bg = theme === 'dark' ? '#0b0d12' : '#eef0f4';
  const frame = theme === 'dark' ? '#1a1d24' : '#1f2229';
  const dataUri = pngDataUri(pngPath);

  const margin = 40;
  const canvasW = totalW + margin * 2;
  const canvasH = totalH + margin * 2;
  const fx = margin, fy = margin;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}" role="img" aria-label="Zenit Week on a phone">
  <defs>
    <filter id="phone-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#000" flood-opacity="0.22"/>
    </filter>
    <clipPath id="phone-screen-clip">
      <rect x="${fx + bezel}" y="${fy + bezel}" width="${screenW}" height="${screenH}" rx="${radius - bezel}" ry="${radius - bezel}"/>
    </clipPath>
  </defs>
  <rect width="${canvasW}" height="${canvasH}" fill="${bg}"/>

  <g filter="url(#phone-shadow)">
    <rect x="${fx}" y="${fy}" width="${totalW}" height="${totalH}" rx="${radius}" ry="${radius}" fill="${frame}"/>
    <image href="${dataUri}" x="${fx + bezel}" y="${fy + bezel}" width="${screenW}" height="${screenH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#phone-screen-clip)"/>
    <rect x="${fx + totalW / 2 - 50}" y="${fy + 16}" width="100" height="28" rx="14" fill="#0a0a0a"/>
  </g>
</svg>`;
}

function buildMockups(captures) {
  for (const theme of THEMES) {
    for (const view of FORMS.desktop.views) {
      const lp = resolve(ASSETS, `mockup-laptop-${theme}-${view}.svg`);
      writeFileSync(lp, laptopMockup(captures[`${theme}-desktop-${view}`], theme));
      console.log(`  ✓ ${lp.replace(REPO + '/', '')}`);
    }
    for (const view of FORMS.mobile.views) {
      const pp = resolve(ASSETS, `mockup-phone-${theme}-${view}.svg`);
      writeFileSync(pp, phoneMockup(captures[`${theme}-mobile-${view}`], theme));
      console.log(`  ✓ ${pp.replace(REPO + '/', '')}`);
    }
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
console.log('Capturing screenshots…');
const captures = await capture();
console.log('Building SVG mockups…');
buildMockups(captures);
console.log('Done.');
