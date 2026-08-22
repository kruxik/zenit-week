import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// The dev-only Settings block shipped visible on zenitweek.com. The host guard
// was never the problem: the markup carries `hidden`, and init only clears it
// on a development host. What leaked it was the cascade — the UA stylesheet
// offers `[hidden] { display: none }`, a zero-id/zero-class rule that any
// component rule beats, and `.settings-section` sets `display: flex`. The block
// rendered even though nothing ever unhid it.
//
// So the guard belongs in CSS, and it has to be the kind no later rule can
// undo. These tests hold that in place, and hold the reveal on the host check.

/** The app's main stylesheet — the largest <style> block in the document. */
function mainStylesheet() {
  const blocks = [...SRC.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  return blocks.sort((a, b) => b.length - a.length)[0];
}

/** Brace nesting depth at an index — 0 means a top-level rule, not inside @media. */
function depthAt(css, index) {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return depth;
}

/** Body of the first `if (<cond>) {` whose condition matches, braces matched. */
function ifBody(condition) {
  const at = SRC.indexOf(`if (${condition}) {`);
  if (at < 0) return null;
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open + 1, i);
  }
  return null;
}

describe('hidden attribute', () => {
  const css = mainStylesheet();

  it('is enforced globally, so no component rule can render a hidden element', () => {
    const rule = /(^|})\s*\[hidden\]\s*\{([^}]*)\}/m.exec(css);
    expect(rule, 'no global [hidden] rule in the stylesheet').not.toBeNull();
    expect(rule[2].replace(/\s+/g, ' ')).toMatch(/display:\s*none\s*!important/);
    // Inside an @media block it would only hold at some viewport sizes.
    expect(depthAt(css, rule.index)).toBe(0);
  });

  it('is never out-weighed by another !important display', () => {
    // !important beats any normal declaration whatever its specificity, so the
    // only rule that could revive a hidden element is another !important one.
    const visible = [...css.matchAll(/display\s*:\s*([^;}]*?)\s*!important/g)]
      .map(m => m[1].trim())
      .filter(value => value !== 'none');
    expect(visible).toEqual([]);
  });
});

describe('dev-only Settings block', () => {
  it('ships hidden in the markup', () => {
    expect(SRC).toMatch(/<div class="settings-section" id="settings-dev-section" hidden>/);
    expect(SRC).toMatch(/<div class="settings-separator" id="settings-dev-separator" hidden><\/div>/);
  });

  it('is revealed only behind the development-host guard', () => {
    const body = ifBody('devResetEnabled()');
    expect(body, 'no `if (devResetEnabled())` block found').not.toBeNull();
    expect(body).toContain("getElementById('settings-dev-section')");
    expect(body).toContain("getElementById('settings-dev-separator')");

    // And nowhere else: one reveal path, one guard in front of it.
    const reveals = SRC.split(/devSection\.hidden = false|devSeparator\.hidden = false/).length - 1;
    expect(reveals).toBe(2);
    const outside = SRC.replace(body, '');
    expect(outside).not.toContain("getElementById('settings-dev-section')");
    expect(outside).not.toContain("getElementById('settings-dev-separator')");
  });
});
