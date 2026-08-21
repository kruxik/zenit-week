import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// A CSS opacity transition and a per-frame geometry write must never land on the
// same element. Both halves are cheap alone and ruinous together:
//
//   - Writing style.opacity every frame while a `transition: opacity` rule is in
//     force retargets a live transition on every element, every frame. Measured
//     on a 197-node week at 6x CPU throttle: 33.3 ms/frame for 360 elements,
//     against an 8.3 ms idle floor.
//   - Handing that same fade to CSS moves the cost to the compositor, where it
//     is worse. A running opacity transition promotes its element to its own
//     composited layer, and a tween that rewrites the element's transform (or
//     its path `d`) every frame forces every one of those layers to be
//     re-rastered every frame. Traced over USB on a Galaxy S22 Ultra, one
//     Rocks -> Sand switch with 386 appearing elements: 412 composited layers
//     and 1602 raster tasks, against 4 and 33 with the fade gone. Raster and the
//     GPU process both sat at 80-90% and kept draining for 650 ms after the
//     animation ended, while the main thread idled at 12 ms/frame.
//
// The second form is why this needs a guard rather than a comment. It was
// invisible for days: an appearing element leaves display:none in the repack
// task and has its opacity released in the very next rAF, so its first resolved
// style is already the target and CSS starts no transition at all. The fade was
// dormant almost always. Any style recalc landing between those two points wakes
// it — a soft keyboard opening and closing reliably does — so the same tap was
// smooth or unusable depending on whether the user had typed recently.

/** Body of the first `function <name>(` in the source, braces matched. */
function functionBody(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(SRC);
  if (!m) return null;
  return bodyAt(SRC.indexOf('{', m.index + m[0].length - 1));
}

function bodyAt(open) {
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open, i + 1);
  }
  return SRC.slice(open);
}

/** Every top-level `function name(...)` whose body drives a rAF loop. */
function rafDrivenFunctions() {
  const out = [];
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(SRC)) !== null) {
    const body = bodyAt(SRC.indexOf('{', m.index + m[0].length - 1));
    if (body.includes('requestAnimationFrame')) {
      out.push({ name: m[1], line: SRC.slice(0, m.index).split('\n').length, body });
    }
  }
  return out;
}

// Functions allowed to write opacity inside a rAF-driven body. Empty on purpose:
// adding a name here is a claim that the element carries no opacity transition
// and no per-frame geometry write, and that claim belongs next to the entry.
const OPACITY_ALLOWED = [];

describe('rAF tweens never fight a CSS opacity transition', () => {
  test('no rAF-driven function writes style.opacity', () => {
    const offenders = rafDrivenFunctions()
      .filter(f => !OPACITY_ALLOWED.includes(f.name))
      .filter(f => /\.style\.opacity\s*=/.test(f.body))
      .map(f => `line ${f.line}: ${f.name}() writes style.opacity inside a rAF loop`);
    expect(offenders).toEqual([]);
  });

  test('the view slide writes geometry and nothing else', () => {
    const body = functionBody('animateViewSlide');
    expect(body).not.toBeNull();
    // The fix: no opacity, and no transition override to sneak it back in.
    expect(body).not.toMatch(/\.style\.opacity\s*=/);
    expect(body).not.toMatch(/\.style\.transition\s*=/);
    // Anchor the negatives — they must not pass by the tween having been gutted.
    expect(body).toMatch(/setAttribute\('transform'/);
    expect(body).toMatch(/setAttribute\('d'/);
  });

  test('the elements the slide moves still carry the transition that made this bite', () => {
    // If either rule goes away the guard above is no longer load-bearing for that
    // element, and the reasoning at the top of this file should be revisited
    // rather than quietly outliving the CSS it describes.
    expect(SRC).toMatch(/\.node-group\s*\{\s*transition:\s*opacity/);
    expect(SRC).toMatch(/#lines-layer path\s*\{\s*transition:\s*opacity/);
  });
});
