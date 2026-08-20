import { describe, it, expect, beforeEach } from 'vitest';
import { animatePanTo, panState, endPan, sandboxGlobal } from './setup.js';

// Three triggers ask for the reveal pan on mobile — the optimistic one at focus,
// the keyboard-settled one, and a 500ms fallback — and they usually name the
// same target. A device trace (Galaxy S22, Chrome 151) showed the fallback
// restarting the tween 109ms into it: the running ease decelerated and the new
// one accelerated from rest again, which is what "laggy" actually looked like.
// Every frame in that trace was delivered on time; the motion itself was wrong.
describe('reveal pan', () => {
  let frames;

  beforeEach(() => {
    endPan();
    frames = 0;
    sandboxGlobal.requestAnimationFrame = () => { frames++; return 1; };
  });

  it('starts a tween when nothing is in flight', () => {
    animatePanTo(100, 100, null, 300);
    expect(frames).toBe(1);
    expect(panState()).toMatchObject({ animating: true, tx: 100, ty: 100 });
  });

  it('drops a repeat request for the target it is already flying to', () => {
    animatePanTo(100, 100, null, 300);
    animatePanTo(102, 98, null, 300);   // within the 4px epsilon
    expect(frames).toBe(1);
    expect(panState()).toMatchObject({ tx: 100, ty: 100 });
  });

  it('retargets when the destination really moved', () => {
    animatePanTo(100, 100, null, 300);
    animatePanTo(300, 100, null, 300);
    expect(frames).toBe(2);
    expect(panState()).toMatchObject({ tx: 300, ty: 100 });
  });

  it('does not tween when it is already parked on the target', () => {
    // The 500ms fallback lands here once the earlier passes have arrived: a
    // 1px delta was spending a full 300ms tween in the device trace.
    animatePanTo(0, 1, null, 300);
    expect(frames).toBe(0);
    expect(panState().animating).toBe(false);
  });

  it('takes a fresh request once the previous pan has ended', () => {
    animatePanTo(100, 100, null, 300);
    endPan();
    animatePanTo(100, 100, null, 300);
    expect(frames).toBe(2);
  });
});
