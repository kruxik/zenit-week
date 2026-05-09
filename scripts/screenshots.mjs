// Screenshot generator for Zenit Week.
// Seeds IndexedDB with realistic week data, captures PNGs in light/dark themes
// at desktop and mobile viewports, then wraps them in laptop/phone SVG mockups.
// Run: npm run screenshots

import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const APP_URL = pathToFileURL(resolve(REPO, 'zenit-week.html')).href;
const ASSETS = resolve(REPO, 'assets');

// ─── Mock week data ──────────────────────────────────────────────────────────
// Realistic week: 3 branches, mix of done/priority/counters/unplanned/reusable.
// Counter children auto-create when activity label matches /\d+x$/ in the app,
// but here we wire them explicitly so seeded state is deterministic.
function buildMockData() {
  const now = Date.now();
  const dayMs = 86_400_000;

  // Helper to generate stable-ish ids (the app accepts any string).
  let i = 0;
  const id = (prefix) => `${prefix}${(++i).toString().padStart(3, '0')}`;

  const nodes = [];

  // ── Branches (defaults) ─────────────────────────────────────────────────
  const work   = { id: 'work',   type: 'branch', branch: 'work',   label: 'Work',   children: [], _ts: 0 };
  const family = { id: 'family', type: 'branch', branch: 'family', label: 'Family', children: [], _ts: 0 };
  const me     = { id: 'me',     type: 'branch', branch: 'me',     label: 'Me',     children: [], _ts: 0 };
  nodes.push(work, family, me);

  // ── Activity factory ────────────────────────────────────────────────────
  function activity(branch, label, opts = {}) {
    const a = {
      id: id('a'),
      type: 'activity',
      branch: branch.id,
      parent: branch.id,
      label,
      done: !!opts.done,
      unplanned: !!opts.unplanned,
      reusable: !!opts.reusable,
      priority: opts.priority || 'normal',
      children: [],
      _ts: now - (opts.ageDays || 0) * dayMs,
    };
    if (opts.done)      a.doneAt      = now - (opts.ageDays || 0) * dayMs;
    if (opts.unplanned) a.unplannedAt = now - (opts.ageDays || 0) * dayMs;
    branch.children.push(a.id);
    nodes.push(a);

    if (opts.counter) {
      const c = {
        id: id('c'),
        type: 'counter',
        branch: branch.id,
        parent: a.id,
        label: String(opts.counter.val),
        val: opts.counter.val,
        max: opts.counter.max,
        ticks: opts.counter.ticks || [],
        children: [],
        _ts: now,
      };
      if (c.val >= c.max) {
        c.done = true;
        c.doneAt = now;
      }
      a.children.push(c.id);
      nodes.push(c);
    }
    return a;
  }

  // ── Work ────────────────────────────────────────────────────────────────
  activity(work, 'Q2 OKRs draft',           { priority: 'critical', ageDays: 1 });
  activity(work, '1:1 with Sara',           { done: true, ageDays: 2 });
  activity(work, 'Sprint review prep',      { priority: 'high' });
  activity(work, 'Code reviews 5x',         { counter: { val: 3, max: 5, ticks: [
    new Date(now - 3 * dayMs).toISOString(),
    new Date(now - 2 * dayMs).toISOString(),
    new Date(now - 1 * dayMs).toISOString(),
  ] } });
  activity(work, 'Onboarding doc',          { done: true, ageDays: 3 });

  // ── Family ──────────────────────────────────────────────────────────────
  activity(family, 'Birthday cake for Mia', { priority: 'critical' });
  activity(family, 'Park walk',             { done: true, ageDays: 1 });
  activity(family, 'Call grandma',          { done: true, ageDays: 2 });
  activity(family, 'Plan summer trip',      { priority: 'high' });

  // ── Me ──────────────────────────────────────────────────────────────────
  activity(me, 'Pushups 50x',               { counter: { val: 30, max: 50, ticks: [
    new Date(now - 4 * dayMs).toISOString(),
    new Date(now - 3 * dayMs).toISOString(),
    new Date(now - 2 * dayMs).toISOString(),
  ] } });
  activity(me, 'Read 30 min 7x',            { reusable: true, counter: { val: 4, max: 7, ticks: [
    new Date(now - 4 * dayMs).toISOString(),
    new Date(now - 3 * dayMs).toISOString(),
    new Date(now - 1 * dayMs).toISOString(),
    new Date(now).toISOString(),
  ] } });
  activity(me, 'Yoga session',              { done: true, reusable: true, ageDays: 1 });
  activity(me, 'Drop off donations',        { unplanned: true });

  return { nodes, tombstones: [], crdtVersion: 0 };
}

// ─── Page seeding ────────────────────────────────────────────────────────────
// Runs in browser context. Writes localStorage + IDB before app first paint.
async function seedPage(page, theme, view, mockData) {
  await page.evaluate(async ({ theme, view, mockData }) => {
    localStorage.setItem('zenit-week-theme', theme);
    localStorage.setItem('zenit-week-lang', 'en');
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

    // Compute current ISO week key the app would use (YYYY-WW).
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
      tx.objectStore('weeks').put({ weekKey: wk, data: mockData });
      tx.oncomplete = res;
      tx.onerror = (e) => rej(e.target.error);
    });

    db.close();
  }, { theme, view, mockData });
}

// ─── Capture loop ────────────────────────────────────────────────────────────
// Each form factor is paired with the view that shows the app at its best:
// mindmap for the wide laptop canvas, agenda for the tall phone canvas.
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, view: 'mindmap' },
  mobile:  { width: 390,  height: 844, deviceScaleFactor: 3, view: 'agenda', isMobile: true, hasTouch: true },
};
const THEMES = ['light', 'dark'];

async function capture() {
  const browser = await chromium.launch();
  const mockData = buildMockData();

  const results = {};
  for (const theme of THEMES) {
    for (const [form, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.hasTouch,
      });
      const page = await ctx.newPage();

      // Visit once to establish origin so IDB/localStorage writes apply.
      await page.goto(APP_URL, { waitUntil: 'load' });
      await seedPage(page, theme, vp.view, mockData);

      // Reload so the app boots with seeded state.
      await page.reload({ waitUntil: 'load' });

      if (vp.view === 'mindmap') {
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
      await page.waitForTimeout(500); // settle: layout/animations

      const out = resolve(ASSETS, `screen-${theme}-${form}.png`);
      await page.screenshot({ path: out, type: 'png' });
      results[`${theme}-${form}`] = out;
      console.log(`  ✓ ${out.replace(REPO + '/', '')}`);

      await ctx.close();
    }
  }
  await browser.close();
  return results;
}

// ─── SVG mockups ─────────────────────────────────────────────────────────────
// Embed each PNG inside a vector device frame. PNG is base64-inlined so the
// SVG is portable without companion files.
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
    <!-- Camera notch -->
    <circle cx="${totalW / 2}" cy="${lidY + pad / 2}" r="3" fill="#0a0a0a"/>
    <!-- Screen -->
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
  <!-- Trackpad notch -->
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

  // Outer canvas adds margin around the device for shadow.
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

  <!-- Phone body -->
  <g filter="url(#phone-shadow)">
    <rect x="${fx}" y="${fy}" width="${totalW}" height="${totalH}" rx="${radius}" ry="${radius}" fill="${frame}"/>
    <image href="${dataUri}" x="${fx + bezel}" y="${fy + bezel}" width="${screenW}" height="${screenH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#phone-screen-clip)"/>
    <!-- Dynamic island -->
    <rect x="${fx + totalW / 2 - 50}" y="${fy + 16}" width="100" height="28" rx="14" fill="#0a0a0a"/>
  </g>
</svg>`;
}

function buildMockups(captures) {
  for (const theme of THEMES) {
    const laptop = laptopMockup(captures[`${theme}-desktop`], theme);
    const phone  = phoneMockup(captures[`${theme}-mobile`], theme);
    const lp = resolve(ASSETS, `mockup-laptop-${theme}.svg`);
    const pp = resolve(ASSETS, `mockup-phone-${theme}.svg`);
    writeFileSync(lp, laptop);
    writeFileSync(pp, phone);
    console.log(`  ✓ ${lp.replace(REPO + '/', '')}`);
    console.log(`  ✓ ${pp.replace(REPO + '/', '')}`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
console.log('Capturing screenshots…');
const captures = await capture();
console.log('Building SVG mockups…');
buildMockups(captures);
console.log('Done.');
