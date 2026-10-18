import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A theme is applied one way: applyTheme(). The toggle, Drive sync, undo/redo
// and import all route through it. A second, inline copy is how a Drive-synced
// theme once changed the page but left the mobile status bar (the theme-color
// meta) and the Settings switch on the old theme. The pre-paint script in
// <head> is the one exception - it runs before the app script exists.

describe('theme - one path, source guards', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'zenit-week.html'), 'utf8');
  const script = html.match(/<script\s+id="app-script">([\s\S]*?)<\/script>/)[1];
  const code = script.replace(/^\s*\/\/.*$/gm, ''); // line comments only
  const body = (name) => {
    const start = code.search(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
    expect(start, `${name} exists`).toBeGreaterThan(-1);
    let depth = 0, i = code.indexOf(') {', start) + 2;
    const from = i;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) break;
    }
    return code.slice(from, i + 1);
  };

  it('data-theme is written only by applyTheme', () => {
    const writes = /dataset\.theme\s*=[^=]|setAttribute\(\s*['"]data-theme['"]/g;
    expect(code.match(writes)).toHaveLength(1);
    expect(body('applyTheme')).toMatch(writes);
  });

  it('the stored theme is written only by applyTheme', () => {
    const writes = /setItem\(\s*['"]zenit-week-theme['"]/g;
    expect(code.match(writes)).toHaveLength(1);
    expect(body('applyTheme')).toMatch(writes);
  });

  it('the status-bar colour is written only by updateThemeColor, called only from applyTheme', () => {
    expect(code.match(/theme-color"\]'\)\.content\s*=/g)).toHaveLength(1);
    expect(body('updateThemeColor')).toMatch(/theme-color"\]'\)\.content\s*=/);
    expect(code.match(/updateThemeColor\(\)/g)).toHaveLength(2); // definition + applyTheme
    expect(body('applyTheme')).toContain('updateThemeColor()');
    expect(body('applyTheme')).toContain('syncThemeToggleUI()');
  });

  it('Drive sync, undo/redo and import apply a theme through applyTheme', () => {
    for (const name of ['syncColorsFromDrive', '_applySnapshot', 'importAllData']) {
      expect(body(name), name).toContain('applyTheme(');
    }
  });
});
