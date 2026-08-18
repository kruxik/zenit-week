import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// Anything that starts the view-level / day-filter slide. Running one of these
// straight from a pointer handler puts every frame of a ~400-element animation
// downstream of a discrete input event, and the browser then serialises input to
// paint instead of letting the compositor run ahead. Measured on a Galaxy S22:
// 4 frames at a 75 ms gap inline, against 13-16 frames at 25 ms when deferred by
// one macrotask. It cost a full day to find, because it is invisible to any
// scripted benchmark — calling switchViewLevel() from a script never enters the
// input path at all.
const SLIDE_TRIGGERS = ['switchViewLevel', 'setDayFilter', '_setViewLevel', 'repackWithSlide'];

// Handlers that legitimately mention a trigger without starting a slide. Keyed
// by a stable snippet so an unrelated edit cannot silently widen the exemption.
const ALLOWED = [
  // Toggling the row open/shut, and the Mindmap tab returning to the map, do not
  // repack anything.
  'toggleViewLevels',
];

/** Text of the whole addEventListener(...) call starting at `from`. */
function callTextAt(src, from) {
  const open = src.indexOf('(', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(from, i + 1); }
  }
  return src.slice(from, from + 2000);
}

function pointerHandlers() {
  const out = [];
  const re = /addEventListener\(\s*'(click|pointerup|pointerdown)'/g;
  let m;
  while ((m = re.exec(SRC)) !== null) {
    out.push({
      event: m[1],
      line: SRC.slice(0, m.index).split('\n').length,
      text: callTextAt(SRC, m.index),
    });
  }
  return out;
}

describe('pointer handlers never start the view slide inline', () => {
  test('every slide trigger reached from a pointer handler is deferred', () => {
    const offenders = [];
    for (const h of pointerHandlers()) {
      if (ALLOWED.some(a => h.text.includes(a))) continue;
      const trigger = SLIDE_TRIGGERS.find(t => new RegExp('\\b' + t + '\\s*\\(').test(h.text));
      if (!trigger) continue;
      if (!h.text.includes('deferFromInput')) {
        offenders.push(`line ${h.line}: '${h.event}' handler calls ${trigger}() inline`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the three known entry points are still deferred', () => {
    // the view-level buttons
    expect(SRC).toMatch(/addEventListener\('click', \(\) => deferFromInput\(\(\) => switchViewLevel\(btn\.dataset\.level\)\)\)/);
    // the branch swipe
    expect(SRC).toMatch(/deferFromInput\(\(\) => _setViewLevel\(next\)\)/);
    // the day-filter menu rows
    expect(SRC).toMatch(/deferFromInput\(\(\) => setDayFilter\(day\)\)/);
  });

  test('deferFromInput yields a macrotask, not a frame', () => {
    const body = /function deferFromInput\(fn\) \{([\s\S]*?)\n\}/.exec(SRC);
    expect(body).not.toBeNull();
    // requestAnimationFrame was measured NOT to fix this: it stays inside the
    // same input-driven pipeline and only delays the start. Two frames of delay
    // measured worse than doing nothing (6 frames, 225 ms worst) and showed as a
    // visibly broken render. Only a task boundary releases the compositor.
    expect(body[1]).toMatch(/setTimeout\(fn, 0\)/);
    expect(body[1]).not.toMatch(/requestAnimationFrame/);
  });
});
