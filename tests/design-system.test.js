// Design system guard: a new control must reuse a catalogue component, not
// invent its own skin. Prose rules in CLAUDE.md did not stop that (the Settings
// "Start view" select shipped with the browser default look because selects
// there were skinned one by one by ID); a failing test does.
//
// Every check has a frozen BASELINE of today's offenders, keyed by selector,
// ID or class - never by line number. Two assertions per check:
//   - nothing outside the baseline offends (a new offender fails), and
//   - every baseline entry still offends (fixing one forces removing it here).
// Baselines may only shrink. Never add an entry to make this test pass: reuse
// the catalogue component the failure message names instead.
//
// Plan and history: docs/plans/design-system.md.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../zenit-week.html', import.meta.url), 'utf8');

// The catalogue: the classes a control may carry to get its look. The first
// class on a JS-built control must be one of these; any of them satisfies the
// markup check. Today's names - Phase 4 of the plan renames them to roles.
const CATALOGUE = {
  'agenda-action-btn': 'button (text or icon+text); `.commit` / `.danger` for the committing one',
  'help-close-btn': 'icon-only / close button',
  'dialog-field': 'select, text or number field',
  'theme-toggle': 'on/off switch, inside `.theme-toggle-row`',
  'agenda-tab': 'tab',
  'ctx-item': 'popup menu item (context menu, day filter menu)',
  'undo-redo-btn': 'toolbar icon button (undo/redo bar)',
  'view-toggle-btn': 'view switcher button (Vision / Mindmap / Agenda / Stats)',
};

const SUGGEST = {
  button: '`.agenda-action-btn` (or `.help-close-btn` for a close X)',
  select: '`.dialog-field`',
  input: '`.dialog-field`',
  textarea: 'a shared field class (none exists yet: stop and ask)',
};

// ---- source extraction ---------------------------------------------------

/** The app's main stylesheet - the largest <style> block in the document. */
function mainStylesheet() {
  const blocks = [...SRC.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  return blocks.sort((a, b) => b.length - a.length)[0];
}

/** Body markup with every inline <script> removed. */
function markup() {
  return SRC.slice(SRC.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/g, '');
}

/** Flat list of style rules `{ selector, decls: [[prop, value]] }`, @media unwrapped. */
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  let quote = null;
  for (const ch of css) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (ch === '}') {
      const selector = stack.pop();
      if (buf.trim() && !selector.startsWith('@')) {
        const decls = buf.split(';').map(d => d.trim()).filter(Boolean).map(d => {
          const at = d.indexOf(':');
          return [d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()];
        });
        rules.push({ selector: selector.replace(/\s+/g, ' '), decls });
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return rules;
}

const CSS = mainStylesheet();
const RULES = cssRules(CSS);
const MARKUP = markup();

/** Form controls in markup: `{ tag, type, id, classes }`. */
function markupControls() {
  return [...MARKUP.matchAll(/<(button|select|input|textarea)\b([^>]*)>/g)].map(m => {
    const attr = name => (new RegExp(`\\b${name}="([^"]*)"`).exec(m[2]) || [])[1];
    return {
      tag: m[1],
      type: attr('type') || '',
      id: attr('id') || '',
      classes: (attr('class') || '').split(/\s+/).filter(Boolean),
    };
  });
}

/** Compare a found set against its baseline: no new offenders, no stale entries. */
function expectBaseline(found, baseline, hint) {
  const foundSet = new Set(found);
  const fresh = [...foundSet].filter(k => !baseline.includes(k)).sort();
  const stale = baseline.filter(k => !foundSet.has(k));
  expect(fresh, `new offenders - ${hint}`).toEqual([]);
  expect(stale, 'fixed offenders still in the baseline - remove them from the list (baselines only shrink)').toEqual([]);
}

// ---- 1. every control carries a catalogue class ----------------------------

// Key: `tag#id`. Classless controls as of af4dc18.
const CLASSLESS_BASELINE = [
  'button#account-btn',
  'button#fab-add',
  'button#perf-probe-arm',
  'button#perf-probe-last',
  'button#week-picker-label',
  'input#bp-input',
  'input#cp-hex',
  'textarea#comment-textarea',
  'textarea#inline-input',
];

// ---- 2. no skin on a form-control ID --------------------------------------

// Skin = how it looks. An ID may still set layout (width, flex, margin, display).
const SKIN_PROP = /^(border(-[a-z-]+)?|background(-[a-z-]+)?|color|font-size|font-weight|padding(-[a-z]+)?|box-shadow)$/;

// Control IDs that receive skin from an ID selector, as of af4dc18.
const ID_SKIN_BASELINE = [
  'account-btn',
  'bp-input',
  'comment-textarea',
  'cp-hex',
  'cp-hue-slider',
  'date-picker-set',
  'fab-add',
  'inline-input',
  'perf-probe-arm',
  'perf-probe-last',
  'quick-add-input',
  'vtb-agenda',
  'vtb-mindmap',
  'vtb-stats',
  'vtb-vision',
  'week-picker-label',
];

// ---- 3. JS-built controls start with a catalogue class --------------------

// First class of a JS-built control that is not in the catalogue, as of af4dc18.
const JS_CLASS_BASELINE = [
  'agenda-rename-input',
  'dp-day',
  'qab-recent-branch',
  'wp-week-row',
];

// ---- 4. dialogs wear the dialog vocabulary --------------------------------

// `role="dialog"` elements without `.dialog-shell` + `.dialog-header`, by id.
const DIALOG_BASELINE = [
  'week-picker-fold',
];

// ---- 5. literal colours live in tokens only --------------------------------

// Rules (by selector) with a hex or rgb() literal outside a custom property.
const LITERAL_COLOR_BASELINE = [
  '#account-btn-initials',
  '#cp-hue-slider',
  '#cp-hue-slider::-moz-range-thumb',
  '#cp-hue-slider::-webkit-slider-thumb',
  '#perf-probe-arm',
  '#perf-probe-badge',
  '.agenda-action-btn.commit:not(:disabled)',
  '.agenda-action-btn.commit:not(:disabled):hover',
  '.agenda-item-drop-above .agenda-item',
  '.agenda-item-drop-below .agenda-item',
  '.agenda-overdue-badge',
  '.dp-day.selected, .dp-day.selected:hover',
  '.pie-label',
  '.ratio-segment',
  '.settings-badge',
  '.wp-week-row.open',
  '.wp-week-row.open .wp-day.today',
  '.wp-week-row.open .wp-weekno, .wp-week-row.open .wp-day.outside',
  ':root[data-dev-host] #dev-badge',
  '[data-theme="dark"] *',
  '[data-theme="dark"] ::-webkit-scrollbar-thumb',
  '[data-theme="dark"] ::-webkit-scrollbar-thumb:hover',
  '[data-theme="dark"] ::-webkit-scrollbar-track',
];

// ---- 6. control-like class names are a closed set --------------------------

const CONTROL_CLASS = /-(btn|toggle|field|select|input|close)(-|$)/;

// Every class name in CSS, markup or JS that looks like a control, as of af4dc18.
const CONTROL_CLASS_SET = [
  'account-btn-placeholder',
  'add-btn',
  'add-btn-inner',
  'agenda-action-btn',
  'agenda-rename-input',
  'app-panel-close',
  'comment-fmt-toggle',
  'dialog-field',
  'dp-field-row',
  'help-close-btn',
  'theme-toggle',
  'theme-toggle-row',
  'theme-toggle-thumb',
  'undo-redo-btn',
  'view-level-btn',
  'view-toggle-btn',
  'view-toggle-separator',
];

describe('design system guard', () => {
  it('knows every catalogue class from the stylesheet', () => {
    const missing = Object.keys(CATALOGUE).filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(CSS));
    expect(missing, 'catalogue class with no CSS rule').toEqual([]);
  });

  it('1. every button, select, input and textarea in markup carries a catalogue class', () => {
    const offenders = markupControls()
      .filter(c => !(c.tag === 'input' && ['file', 'range', 'hidden'].includes(c.type)))
      .filter(c => !c.classes.some(cls => cls in CATALOGUE))
      .map(c => `${c.tag}#${c.id || '(no id)'}`);
    expectBaseline(offenders, CLASSLESS_BASELINE,
      `give the control a catalogue class: button ${SUGGEST.button}, select/input ${SUGGEST.select}`);
  });

  it('2. no CSS rule skins a form control by its ID (layout only)', () => {
    const controlIds = new Set(markupControls().map(c => c.id).filter(Boolean));
    const offenders = [];
    for (const rule of RULES) {
      const skin = rule.decls.some(([prop]) => SKIN_PROP.test(prop));
      if (!skin) continue;
      for (const sel of rule.selector.split(',')) {
        const compound = sel.trim().split(/\s*[\s>+~]\s*/).pop();
        for (const m of compound.matchAll(/#([\w-]+)/g)) {
          if (controlIds.has(m[1])) offenders.push(m[1]);
        }
      }
    }
    expectBaseline(offenders, ID_SKIN_BASELINE,
      'skin (border, background, color, radius, font, padding, shadow) belongs on a catalogue class; an ID may set width, flex, margin, display only');
  });

  it('3. a JS-built control starts with a catalogue class', () => {
    const lines = SRC.split('\n');
    const offenders = [];
    lines.forEach((line, i) => {
      const m = /([\w$.]+)\s*=\s*document\.createElement\('(button|input|select|textarea)'\)/.exec(line);
      if (!m) return;
      const assign = new RegExp(`${m[1].replace(/[.$]/g, '\\$&')}\\.className\\s*=\\s*['\`"]([^'\`"]*)`);
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const a = assign.exec(lines[j]);
        if (!a) continue;
        const first = a[1].trim().split(/\s+/)[0];
        if (!(first in CATALOGUE)) offenders.push(first);
        break;
      }
    });
    expectBaseline(offenders, JS_CLASS_BASELINE,
      `put the catalogue class first: button ${SUGGEST.button}, select/input ${SUGGEST.select}`);
  });

  it('4. every role="dialog" element wears .dialog-shell and contains a .dialog-header', () => {
    const offenders = [];
    for (const m of MARKUP.matchAll(/<(\w+)\b([^>]*\brole="dialog"[^>]*)>/g)) {
      const tag = m[1];
      const id = (/\bid="([^"]*)"/.exec(m[2]) || [])[1] || '(no id)';
      const classes = ((/\bclass="([^"]*)"/.exec(m[2]) || [])[1] || '').split(/\s+/);
      // Matching close tag, counting nested elements of the same name.
      const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
      tagRe.lastIndex = m.index;
      let depth = 0;
      let end = MARKUP.length;
      for (let t; (t = tagRe.exec(MARKUP));) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) { end = t.index; break; }
      }
      const inner = MARKUP.slice(m.index + m[0].length, end);
      const hasHeader = /\bclass="[^"]*\bdialog-header\b/.test(inner);
      if (!classes.includes('dialog-shell') || !hasHeader) offenders.push(id);
    }
    expectBaseline(offenders, DIALOG_BASELINE,
      'a dialog is built from .dialog-shell / .dialog-header / .dialog-title / .dialog-body / .dialog-actions');
  });

  it('5. hex and rgb() colours appear only in custom-property (token) declarations', () => {
    const offenders = RULES
      .filter(rule => rule.decls.some(([prop, value]) =>
        !prop.startsWith('--') && /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value)))
      .map(rule => rule.selector);
    expectBaseline(offenders, LITERAL_COLOR_BASELINE,
      'use a colour token from :root (var(--...)), defining a new one there if needed');
  });

  it('6. control-like class names (-btn, -toggle, -field, -select, -input, -close) are a frozen set', () => {
    const found = new Set();
    const add = list => list.split(/\s+/).forEach(c => { if (CONTROL_CLASS.test(c) && !c.includes('$')) found.add(c); });
    for (const m of CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z_][\w-]*)/g)) add(m[1]);
    for (const m of SRC.matchAll(/\bclass="([^"]*)"/g)) add(m[1]);
    for (const m of SRC.matchAll(/(?:className\s*=\s*|classList\.(?:add|toggle|remove|contains)\()\s*(['`])([^'`]*)\1/g)) add(m[2]);
    expectBaseline([...found], CONTROL_CLASS_SET,
      'reuse a catalogue component or add it to the catalogue');
  });

  it.todo('7. border-radius, font-size and z-index use tokens (switched on in Phase 5)');
});
