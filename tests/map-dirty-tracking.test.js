import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// The mindmap SVG is rebuilt whole — every node group, every edge — so switchView
// used to pay ~105 ms of script on a full week each time the user came back to it,
// however little had changed. It now rebuilds only when the map actually fell
// behind, which on a Galaxy S22 took that switch from 328 ms to 240 ms INP
// (paired, 10 of 10 reps).
//
// That trade rests on one invariant: _mapDirty is set whenever a render is asked
// for and not performed. Only the mobile agenda skips, because it hides the
// canvas. If a second skip is ever added — another view that hides the map, a
// different width rule, an early return for a background tab — and it does not
// flag, the map silently keeps showing stale data until something unrelated
// forces a rebuild. That is a correctness bug with no visible failure at the call
// site, and nothing else in the suite would catch it, so it is pinned here.

function bodyOf(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(SRC);
  if (!m) return null;
  const open = SRC.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open, i + 1);
  }
  return SRC.slice(open);
}

describe('the map is only rebuilt when it fell behind', () => {
  test('renderIfVisible flags every render it skips', () => {
    const body = bodyOf('renderIfVisible');
    expect(body).not.toBeNull();

    // Every early exit is a skipped render, so each one has to set the flag
    // before it leaves. The tail call to render() is the only way out that does
    // not — it rendered.
    const earlyReturns = body.match(/return\s*;/g) || [];
    expect(earlyReturns.length).toBeGreaterThan(0);
    const flagged = body.match(/_mapDirty\s*=\s*true\s*;\s*return\s*;/g) || [];
    expect(flagged.length).toBe(earlyReturns.length);

    expect(body).toMatch(/render\(\)/);
  });

  test('render clears the flag', () => {
    const body = bodyOf('render');
    expect(body).not.toBeNull();
    expect(body).toMatch(/_mapDirty\s*=\s*false/);
  });

  test('switchView rebuilds the mindmap only behind the flag', () => {
    const body = bodyOf('switchView');
    expect(body).not.toBeNull();
    expect(body).toMatch(/if\s*\(_mapDirty\)\s*render\(\)/);
  });

  test('nothing else writes the flag without saying so', () => {
    // Three writes exist by design: the declaration, the skip in
    // renderIfVisible, and the clear in render(). A fourth means someone is
    // steering the rebuild from somewhere new — which may well be right, but it
    // belongs in this test's reasoning rather than slipping in unnoticed.
    const KNOWN = ['renderIfVisible', 'render'];
    const writes = SRC.match(/_mapDirty\s*=\s*(true|false)/g) || [];
    const declared = SRC.match(/let\s+_mapDirty\s*=\s*false/g) || [];
    expect(declared.length).toBe(1);

    const inKnown = KNOWN.map(bodyOf).join('\n').match(/_mapDirty\s*=\s*(true|false)/g) || [];
    // render()'s body is nested inside nothing else, and renderIfVisible's skip
    // is the only other write, so the declaration is the single remainder.
    expect(writes.length - declared.length).toBe(inKnown.length);
  });
});
