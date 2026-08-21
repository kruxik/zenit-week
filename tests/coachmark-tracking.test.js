import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// The coachmark follows its anchor from a rAF loop, and repositioning it reads
// getBoundingClientRect on the anchor plus offsetWidth/offsetHeight on the
// bubble. Each of those forces a synchronous style-and-layout flush over the
// whole document, the ~2900-element SVG included. A tip usually sits still for
// many seconds, so measuring every frame is waste; during a view slide it is
// worse, because the read lands mid-tween and flushes the couple of hundred
// attribute writes the tween has queued, making layout run twice a frame.
//
// The loop therefore measures only when its cheap key changes: pan, zoom, the
// viewport, or _mapGeometrySeq. That key is a guess about *whether* to measure,
// never a source of truth for where the bubble goes — a slow resync backs it up
// so a miss drifts for at most half a second. What it cannot survive is a node
// mover that never bumps the counter and happens between resyncs.

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

describe('coachmark tracking does not measure every frame', () => {
  test('the loop gates its reposition on the geometry key', () => {
    const body = bodyOf('startCoachmarkTracking');
    expect(body).not.toBeNull();
    expect(body).toMatch(/_mapGeometryKey\(\)/);
    expect(body).toMatch(/COACHMARK_RESYNC_MS/);
    // The reposition must sit behind the gate, not before or beside it.
    const gate = body.indexOf('if (key !== lastKey');
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf('positionCoachmark(')).toBeGreaterThan(gate);
  });

  test('the resync keeps a missed mover from drifting forever', () => {
    const ms = /const COACHMARK_RESYNC_MS = (\d+);/.exec(SRC);
    expect(ms).not.toBeNull();
    expect(Number(ms[1])).toBeGreaterThan(0);
    expect(Number(ms[1])).toBeLessThanOrEqual(1000);
  });

  // The fragile half. Every one of these moves a .node-group, so every one has
  // to bump the counter or the bubble sits at a stale position until the resync.
  test.each([
    ['render', 'a full rebuild repositions every node'],
    ['repackLayout', 'a view-level or day-filter switch repacks the survivors'],
    ['updateDraggedVisuals', 'a drag moves the grabbed subtree each frame'],
    ['animateViewSlide', 'the slide tween moves every survivor each frame'],
  ])('%s bumps the geometry counter (%s)', (fn) => {
    const body = bodyOf(fn);
    expect(body).not.toBeNull();
    expect(body).toMatch(/markMapGeometryChanged\(\)/);
  });

  test('nothing else moves a node group without saying so', () => {
    // Node groups are moved by writing a translate() transform. Every site that
    // does it has to sit inside a function that bumps the counter, so a new one
    // added anywhere else shows up here as an uncovered site.
    //
    // makeNodeGroup is the one exception: it places a group as it builds it, and
    // it only ever runs from render(), which bumps on the way out.
    const KNOWN = ['render', 'repackLayout', 'updateDraggedVisuals', 'animateViewSlide',
                   'makeNodeGroup'];
    const bodies = KNOWN.map(bodyOf).join('\n');
    const re = /setAttribute\('transform', `translate\(/g;
    const all = SRC.match(re) || [];
    const covered = bodies.match(re) || [];
    expect(covered.length).toBe(all.length);
  });
});
