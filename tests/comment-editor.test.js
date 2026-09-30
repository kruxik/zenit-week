import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as model from 'prosemirror-model';
import * as state from 'prosemirror-state';
import * as history from 'prosemirror-history';
import * as commands from 'prosemirror-commands';
import * as inputrules from 'prosemirror-inputrules';
import {
  _state, sandboxGlobal, findNode, triggerKeydown,
  openCommentDialog, closeCommentDialog, persistCommentDraft, loadCommentEditor,
  buildCommentSchema, commentTextToDoc, commentDocToText, commentTextSlice, isTypingTarget,
  toggleCommentCheck, commentEnterCommand, commentLiftAtStart, commentToggleAtCaret, commentInputRuleList,
  commentBlockToggle, commentToolbarState, shouldPrefetchCommentEditor, commentEditorText, commentViewportBox, shouldPinPanelCaption,
  takeSnapshot, refreshOpenComment, cssFontSizeInPt,
} from './setup.js';

// The real packages, injected exactly as the page injects the bundle's namespace.
const pm = { model, state, history, commands, inputrules };
const schema = buildCommentSchema(pm);

describe('comment text ↔ ProseMirror doc', () => {
  const corpus = [
    '',
    'one line',
    'a\nb',
    '*not bold* and # not a heading',
    '- [ ] not yet a checkbox\n- [x] nor this',
    '\n\nblank lines\n\n\nkept\n\n',
    'trailing spaces   \n   leading spaces',
    '\ttabs\tinside\t',
    'ěščřžýáíé — emoji 👍 and CJK 漢字',
    '[text](https://example.com) _under_ `code` > quote',
    ' ',
    '\n',
  ];

  it.each(corpus)('round-trips %j byte-identically', (text) => {
    expect(commentDocToText(commentTextToDoc(schema, text))).toBe(text);
  });

  it.each([
    ['# Heading', 'heading'],
    ['- bullet', 'bullet'],
    ['* bullet', 'bullet'],
    ['3. third', 'ordered'],
    ['- [ ] open', 'check'],
    ['- [x] done', 'check'],
    ['plain', 'paragraph'],
  ])('%j becomes a %s node without its marker', (text, type) => {
    const node = commentTextToDoc(schema, text).firstChild;
    expect(node.type.name).toBe(type);
    expect(node.textContent).toBe(text.replace(/^(- \[[ x]\] |[-*] |\d+\. |# )/, ''));
  });

  it('reads inline syntax into marks', () => {
    const text = '- [x] **bold** [doc](https://a.cz)';
    const doc = commentTextToDoc(schema, text);
    expect(doc.firstChild.attrs.checked).toBe(true);
    expect(doc.firstChild.textContent).toBe('bold doc');
    const [bold, , link] = doc.firstChild.content.content;
    expect(bold.marks.map(m => m.type.name)).toEqual(['strong']);
    expect(link.marks[0].attrs).toEqual({ href: 'https://a.cz', auto: false });
    expect(commentDocToText(doc)).toBe(text);
  });

  it('round-trips a rich comment with every block type', () => {
    const text = '# Trip\n\nPack:\n- [x] passport\n- [ ] charger\n- \n- snacks *maybe*\n# \n- [ ] ';
    expect(commentDocToText(commentTextToDoc(schema, text))).toBe(text);
  });

  it('maps every line to one paragraph', () => {
    const doc = commentTextToDoc(schema, 'a\n\nb');
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).content.size).toBe(0);
  });

  it('treats a missing comment as empty', () => {
    expect(commentDocToText(commentTextToDoc(schema, undefined))).toBe('');
  });

  it('pastes multi-line text into the caret paragraph like a textarea', () => {
    const doc = commentTextToDoc(schema, 'ab');
    let st = state.EditorState.create({ doc, selection: state.TextSelection.create(doc, 2) });
    st = st.apply(st.tr.replaceSelection(commentTextSlice(pm, schema, 'X\r\n\r\nY')));
    expect(commentDocToText(st.doc)).toBe('aX\n\nYb');
  });

  it('history plugin answers beforeinput undo/redo, not just keys', () => {
    expect(typeof history.history().props.handleDOMEvents.beforeinput).toBe('function');
  });
});

describe('loadCommentEditor', () => {
  let doc, origCreate, appended;

  beforeEach(() => {
    doc = sandboxGlobal.document;
    origCreate = doc.createElement;
    appended = [];
    doc.head = { appendChild: (el) => { appended.push(el); el.parentNode = doc.head; }, removeChild: () => {} };
    doc.createElement = (tag) => (tag === 'script' ? { tag } : origCreate(tag));
    delete sandboxGlobal.window.ZenitProseMirror;
    _state.resetCommentEditorLoad();
  });

  afterEach(() => {
    doc.createElement = origCreate;
    delete doc.head;
    delete sandboxGlobal.window.ZenitProseMirror;
    _state.resetCommentEditorLoad();
  });

  it('injects one SRI-pinned same-origin script and memoises it', async () => {
    const p1 = loadCommentEditor();
    const p2 = loadCommentEditor();
    expect(p1).toBe(p2);
    expect(appended).toHaveLength(1);
    const script = appended[0];
    expect(script.src).toMatch(/^\/vendor\/editor\.[0-9a-f]{16}\.js$/);
    expect(script.integrity).toMatch(/^sha384-/);
    expect(script.crossOrigin).toBe('anonymous');
    sandboxGlobal.window.ZenitProseMirror = pm;
    script.onload();
    await expect(p1).resolves.toBe(pm);
  });

  it('rejects on a load error and lets the next call retry', async () => {
    const p = loadCommentEditor();
    appended[0].onerror();
    await expect(p).rejects.toThrow(/failed to load/);
    loadCommentEditor();
    expect(appended).toHaveLength(2);
  });

  it('rejects when the script runs but defines no namespace', async () => {
    const p = loadCommentEditor();
    appended[0].onload();
    await expect(p).rejects.toThrow(/no namespace/);
  });

  it('a failed load leaves the textarea in charge of the dialog', async () => {
    _state.set({ nodes: [
      { id: 'work', type: 'branch', branch: 'work', label: 'Work', children: ['a1'], side: 'left', _ts: 0 },
      { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Task', children: [], comments: 'note', _ts: 5 },
    ] });
    const ta = doc.getElementById('comment-textarea');
    const opened = openCommentDialog('a1');
    appended[0].onerror();
    await opened;
    expect(_state.getCommentEditor()).toBe(null);
    expect(ta.hidden).not.toBe(true);
    expect(ta.value).toBe('note');
    ta.value = 'note edited';
    _state.setCommentTyped(true); // what the textarea's input event does
    persistCommentDraft();
    expect(findNode('a1').comments).toBe('note edited');
    closeCommentDialog();
  });
});

describe('comment dialog with no edit', () => {
  it('open then close writes nothing: no _ts bump, no undo entry', () => {
    _state.set({ nodes: [
      { id: 'work', type: 'branch', branch: 'work', label: 'Work', children: ['a1'], side: 'left', _ts: 0 },
      { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Task', children: [], comments: 'keep', _ts: 5 },
    ] });
    const undoBefore = _state.getUndoStack().length;
    openCommentDialog('a1').catch(() => {});
    closeCommentDialog();
    expect(findNode('a1')._ts).toBe(5);
    expect(findNode('a1').comments).toBe('keep');
    expect(_state.getUndoStack().length).toBe(undoBefore);
  });
});

describe('typing in the rich editor never fires app hotkeys', () => {
  const editable = { tagName: 'DIV', isContentEditable: true };
  const key = (k, target) => ({
    key: k, target, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {},
  });

  it('isTypingTarget recognises a contenteditable element', () => {
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('a view letter typed into the editor stays text', () => {
    _state.setCurrentView('mindmap');
    triggerKeydown(key('a', editable));
    expect(_state.getCurrentView()).toBe('mindmap');
  });
});

describe('rich blocks — editing commands', () => {
  const at = (text, pos) => {
    const doc = commentTextToDoc(schema, text);
    return state.EditorState.create({ doc, selection: state.TextSelection.create(doc, pos), plugins: [history.history()] });
  };
  const run = (st, cmd) => { let next = st; const ok = cmd(st, tr => { next = st.apply(tr); }); return { ok, st: next }; };
  const text = st => commentDocToText(st.doc);

  it('a tick serializes as [x] and back', () => {
    const st = at('- [ ] milk\n- [ ] eggs', 1);
    const ticked = st.apply(toggleCommentCheck(pm, st, 0));
    expect(text(ticked)).toBe('- [x] milk\n- [ ] eggs');
    const unticked = ticked.apply(toggleCommentCheck(pm, ticked, 0));
    expect(text(unticked)).toBe('- [ ] milk\n- [ ] eggs');
  });

  it('undo reverses exactly one tick', () => {
    let st = at('- [ ] a', 2);
    st = st.apply(st.tr.insertText('b'));
    st = st.apply(toggleCommentCheck(pm, st, 0));
    let undone = st;
    history.undo(st, tr => { undone = st.apply(tr); });
    expect(text(undone)).toBe('- [ ] ab');
  });

  it('toggle refuses anything but a check item', () => {
    expect(toggleCommentCheck(pm, at('- a', 1), 0)).toBe(null);
  });

  it('Mod-Enter ticks the item under the caret', () => {
    const { ok, st } = run(at('- [ ] a', 2), commentToggleAtCaret(pm));
    expect(ok).toBe(true);
    expect(text(st)).toBe('- [x] a');
  });

  it('Enter continues a * list with *', () => {
    const { st } = run(at('* milk', 5), commentEnterCommand(pm));
    expect(text(st)).toBe('* milk\n* ');
  });

  it('Enter continues a bullet list', () => {
    const { st } = run(at('- milk', 5), commentEnterCommand(pm));
    expect(text(st)).toBe('- milk\n- ');
  });

  it('Enter continues a checklist with an unticked item', () => {
    const { st } = run(at('- [x] milk', 5), commentEnterCommand(pm));
    expect(text(st)).toBe('- [x] milk\n- [ ] ');
  });

  it('Enter splits an item mid-text into two items', () => {
    const { st } = run(at('- milkeggs', 5), commentEnterCommand(pm));
    expect(text(st)).toBe('- milk\n- eggs');
  });

  it('Enter on an empty item ends the list', () => {
    const { st } = run(at('- milk\n- ', 7), commentEnterCommand(pm));
    expect(text(st)).toBe('- milk\n');
  });

  it('Enter in a paragraph is left to the base keymap', () => {
    expect(run(at('plain', 3), commentEnterCommand(pm)).ok).toBe(false);
  });

  it('Backspace at item start lifts it to a paragraph, text kept', () => {
    const { ok, st } = run(at('- [x] milk', 1), commentLiftAtStart);
    expect(ok).toBe(true);
    expect(text(st)).toBe('milk');
  });

  it('Backspace mid-item or in a paragraph is left alone', () => {
    expect(run(at('- milk', 3), commentLiftAtStart).ok).toBe(false);
    expect(run(at('milk', 1), commentLiftAtStart).ok).toBe(false);
  });

  it('input rules cover - , [] , [ ] , [x] , - [ ]  and # ', () => {
    const rules = commentInputRuleList(pm, schema);
    const matches = (s) => rules.filter(r => r.match.test(s)).length;
    for (const typed of ['- ', '* ', '1. ', '12. ', '[] ', '[ ] ', '[x] ', '- [ ] ', '- [x] ', '# ', '-\u00a0']) {
      expect(matches(typed)).toBeGreaterThan(0);
    }
    for (const typed of ['-- ', '## ', '[X] ', 'a- ']) expect(matches(typed)).toBe(0);
  });
});

describe('rich inline — marks', () => {
  const para = (...nodes) => schema.node('doc', null, [schema.node('paragraph', null, nodes)]);
  const txt = (t, ...marks) => schema.text(t, marks);
  const { strong, em, link } = schema.marks;

  it.each([
    'plain **bold** and *italic* text',
    'see [the doc](https://docs.example.com/x) or https://example.com/a?b=1.',
    '**a** *b* **c**',
    'mail [me](mailto:me@example.com)',
    'literal: 2 * 3, a**b, ** x **, [x](javascript:alert(1))',
    '# **Heading** with https://a.cz\n- [x] *done* [l](https://b.cz)\n- item',
  ])('round-trips %j byte-identically through marks', (text) => {
    expect(commentDocToText(commentTextToDoc(schema, text))).toBe(text);
  });

  it('moves whitespace at a mark edge outside the delimiters', () => {
    expect(commentDocToText(para(txt('a'), txt(' b ', strong.create()), txt('c')))).toBe('a **b** c');
    expect(commentDocToText(para(txt(' i', em.create())))).toBe(' *i*');
  });

  it('a whitespace-only marked run is written as plain text', () => {
    expect(commentDocToText(para(txt('a'), txt('  ', strong.create()), txt('b')))).toBe('a  b');
  });

  it('an auto link stays a bare URL until its text is edited', () => {
    const href = 'https://a.cz';
    expect(commentDocToText(para(txt(href, link.create({ href, auto: true }))))).toBe(href);
    expect(commentDocToText(para(txt('site', link.create({ href, auto: true }))))).toBe(`[site](${href})`);
  });

  it('marks exclude one another — the grammar has no nesting', () => {
    const doc = para(txt('word', em.create()));
    let st = state.EditorState.create({ doc, selection: state.TextSelection.create(doc, 1, 5) });
    commands.toggleMark(strong)(st, tr => { st = st.apply(tr); });
    expect(commentDocToText(st.doc)).toBe('**word**');
  });
});

describe('rich inline — paste allow-list', () => {
  const allRules = () => [
    ...Object.values(schema.nodes).flatMap(t => t.spec.parseDOM || []),
    ...Object.values(schema.marks).flatMap(t => t.spec.parseDOM || []),
  ];

  it('parse rules name only the grammar\'s own elements', () => {
    const tags = allRules().filter(r => r.tag).map(r => r.tag.split(/[.[]/)[0]);
    expect([...new Set(tags)].sort()).toEqual([
      'a', 'b', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'li', 'ol > li', 'p', 'strong', 'ul > li',
    ]);
    for (const bad of ['script', 'img', 'iframe', 'style', 'object', 'svg', 'form', 'input']) {
      expect(tags).not.toContain(bad);
    }
  });

  it('a pasted link with an unsafe scheme becomes plain text', () => {
    const rule = schema.marks.link.spec.parseDOM[0];
    const a = (href) => ({ getAttribute: () => href });
    expect(rule.getAttrs(a('javascript:alert(1)'))).toBe(false);
    expect(rule.getAttrs(a('JAVASCRIPT:alert(1)'))).toBe(false);
    expect(rule.getAttrs(a('data:text/html,x'))).toBe(false);
    expect(rule.getAttrs(a(' https://a.cz'))).toBe(false);
    expect(rule.getAttrs(a('https://a.cz'))).toEqual({ href: 'https://a.cz' });
  });

  it('Google Docs\' normal-weight <b> wrapper is not bold', () => {
    const rule = schema.marks.strong.spec.parseDOM.find(r => r.tag === 'b');
    expect(rule.getAttrs({ style: { fontWeight: 'normal' } })).toBe(false);
    expect(rule.getAttrs({ style: { fontWeight: '' } })).toBe(null);
  });
});

describe('rich inline — input rules', () => {
  const rules = commentInputRuleList(pm, schema);
  // Mirrors prosemirror-inputrules: the typed character is part of the match
  // but not yet part of the document.
  const typeInto = (before, typed) => {
    // Raw text, not through the tokenizer — which would already link a URL.
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(before)])]);
    const cursor = doc.content.size - 1;
    const st = state.EditorState.create({ doc, selection: state.TextSelection.create(doc, cursor) });
    const textBefore = before + typed;
    for (const rule of rules) {
      const match = rule.match.exec(textBefore);
      if (!match) continue;
      const tr = rule.handler(st, match, cursor - (match[0].length - typed.length), cursor);
      if (tr) return st.apply(tr);
    }
    return st.apply(st.tr.insertText(typed));
  };

  it('closing ** makes bold and drops the delimiters', () => {
    const st = typeInto('say **hi*', '*');
    expect(st.doc.textContent).toBe('say hi');
    expect(commentDocToText(st.doc)).toBe('say **hi**');
  });

  it('closing * makes italic, but not inside a bold run being typed', () => {
    expect(commentDocToText(typeInto('an *idea', '*').doc)).toBe('an *idea*');
    expect(typeInto('an *idea', '*').doc.textContent).toBe('an idea');
    expect(typeInto('**bold', '*').doc.textContent).toBe('**bold*');
  });

  it('spaces around the content keep asterisks literal', () => {
    expect(typeInto('2 * 3 ', '*').doc.textContent).toBe('2 * 3 *');
  });

  it('a space after a bare URL makes it a link', () => {
    const st = typeInto('go https://example.com/x.', ' ');
    expect(st.doc.textContent).toBe('go https://example.com/x. ');
    expect(commentDocToText(st.doc)).toBe('go https://example.com/x. ');
    const linked = st.doc.firstChild.child(1);
    expect(linked.text).toBe('https://example.com/x');
    expect(linked.marks[0].attrs).toEqual({ href: 'https://example.com/x', auto: true });
  });

  it('an unsafe scheme is never auto-linked', () => {
    const st = typeInto('javascript://x', ' ');
    expect(st.doc.firstChild.content.content.every(n => !n.marks.length)).toBe(true);
  });
});

describe('phone formatting toolbar', () => {
  const at = (text, from, to = from) => {
    const doc = commentTextToDoc(schema, text);
    return state.EditorState.create({ doc, selection: state.TextSelection.create(doc, from, to) });
  };
  const run = (st, cmd) => { let next = st; cmd(st, tr => { next = st.apply(tr); }); return next; };

  it.each([
    ['bullet', 'milk', '- milk'],
    ['check', 'milk', '- [ ] milk'],
    ['heading', 'Trip', '# Trip'],
  ])('%s turns a paragraph into that block, and back', (type, text, md) => {
    const on = run(at(text, 2), commentBlockToggle(schema, type));
    expect(commentDocToText(on.doc)).toBe(md);
    const off = run(on, commentBlockToggle(schema, type));
    expect(commentDocToText(off.doc)).toBe(text);
  });

  it('switches every line in the selection', () => {
    const st = run(at('a\nb', 1, 4), commentBlockToggle(schema, 'bullet'));
    expect(commentDocToText(st.doc)).toBe('- a\n- b');
  });

  it('reports which marks and block are active at the caret', () => {
    const st = at('- [ ] **bold** x', 3);
    expect(commentToolbarState(st)).toEqual({ strong: true, em: false, heading: false, bullet: false, ordered: false, check: true });
  });
});

describe('idle prefetch of the editor', () => {
  it('runs on an ordinary link', () => {
    expect(shouldPrefetchCommentEditor(null)).toBe(true);
    expect(shouldPrefetchCommentEditor({ effectiveType: '4g', saveData: false })).toBe(true);
  });

  it('skips Data Saver and 2G links', () => {
    expect(shouldPrefetchCommentEditor({ effectiveType: '4g', saveData: true })).toBe(false);
    expect(shouldPrefetchCommentEditor({ effectiveType: '2g' })).toBe(false);
    expect(shouldPrefetchCommentEditor({ effectiveType: 'slow-2g' })).toBe(false);
  });

  it('skips when the device is definitely offline', () => {
    const nav = sandboxGlobal.navigator;
    sandboxGlobal.navigator = { ...nav, onLine: false };
    try {
      expect(shouldPrefetchCommentEditor(null)).toBe(false);
    } finally {
      sandboxGlobal.navigator = nav;
    }
  });
});

describe('pre-release review fixes', () => {
  const { strong, em, link } = schema.marks;
  const para = (...nodes) => schema.node('doc', null, [schema.node('paragraph', null, nodes)]);
  const txt = (t, ...marks) => schema.text(t, marks);
  const reread = (doc) => commentTextToDoc(schema, commentDocToText(doc));

  it.each(['[ a ](https://x.cz)', '[ ](https://x.cz)', '[a ](https://x.cz)'])(
    '%j — brackets with edge spaces are literal, and round-trip', (text) => {
      const doc = commentTextToDoc(schema, text);
      // No bracket link — only the bare URL inside may autolink, showing itself.
      doc.firstChild.forEach(n => n.marks.forEach(m => expect(n.text).toBe(m.attrs.href)));
      expect(commentDocToText(doc)).toBe(text);
    });

  it('ProseMirror merges touching same-mark runs — why an untouched dialog keeps its source', () => {
    expect(commentDocToText(commentTextToDoc(schema, '**a****b**'))).toBe('**ab**');
    const editor = { dirty: false, source: '**a****b**', view: { state: { doc: commentTextToDoc(schema, '**a****b**') } } };
    expect(commentEditorText(editor)).toBe('**a****b**');
    editor.dirty = true;
    expect(commentEditorText(editor)).toBe('**ab**');
  });

  it('a URL with parentheses keeps its full target', () => {
    const href = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    const md = commentDocToText(para(txt('x', link.create({ href }))));
    expect(md).toBe('[x](https://en.wikipedia.org/wiki/Foo_%28bar%29)');
    const back = reread(para(txt('x', link.create({ href })))).firstChild.firstChild;
    expect(back.text).toBe('x');
    expect(back.marks[0].attrs.href).toBe('https://en.wikipedia.org/wiki/Foo_%28bar%29');
  });

  it('link text holding "](" can never redirect the link', () => {
    const doc = para(txt('x](https://evil.cz)', link.create({ href: 'https://a.cz' })));
    const back = reread(doc).firstChild;
    // Degraded to plain text: at most the bare URL autolinks, and then the
    // link's visible text is its own destination — nothing hides a target.
    back.forEach(n => n.marks.forEach(m => expect(n.text).toBe(m.attrs.href)));
    expect(back.textContent).toBe('x](https://evil.cz)');
  });

  it.each([
    ['bold then italic', [['a', strong], ['b', em]]],
    ['italic then bold', [['a', em], ['b', strong]]],
    ['bold then bold-less star text', [['a', strong], ['*x', null]]],
    ['star text then italic', [['x*', null], ['b', em]]],
  ])('%s: what is stored reads back as exactly the stored text', (_name, parts) => {
    const doc = para(...parts.map(([t, m]) => (m ? txt(t, m.create()) : txt(t))));
    const md = commentDocToText(doc);
    const back = commentTextToDoc(schema, md);
    expect(commentDocToText(back)).toBe(md);
    expect(back.textContent).toBe(doc.textContent);
  });

  it('Cmd+Z in the plain textarea fallback leaves the app undo stack alone', () => {
    _state.set({ nodes: [
      { id: 'work', type: 'branch', branch: 'work', label: 'Work', children: ['a1'], side: 'left', _ts: 0 },
      { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Task', children: [], _ts: 5 },
    ] });
    takeSnapshot();
    const before = _state.getUndoStack().length;
    openCommentDialog('a1').catch(() => {});
    triggerKeydown({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
      target: { tagName: 'TEXTAREA' }, preventDefault() {}, stopPropagation() {} });
    expect(_state.getUndoStack().length).toBe(before);
    closeCommentDialog();
    triggerKeydown({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
      target: { tagName: 'BODY' }, preventDefault() {}, stopPropagation() {} });
    expect(_state.getUndoStack().length).toBe(before - 1);
  });
});

describe('comment panel takes the visible area above a phone keyboard', () => {
  const vv = (height, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });

  it('matches the visible area exactly — top and height', () => {
    expect(commentViewportBox(800, vv(450, 0), true)).toEqual({ top: 0, height: 450 });
    expect(commentViewportBox(800, vv(450.6, 212.3), true)).toEqual({ top: 212, height: 451 });
  });

  it('leaves the normal layout alone without a keyboard', () => {
    expect(commentViewportBox(800, vv(800), true)).toBe(null);
    expect(commentViewportBox(800, vv(720), true)).toBe(null); // URL bar, not a keyboard
  });

  it('ignores desktop widths, pinch-zoom and browsers without the API', () => {
    expect(commentViewportBox(800, vv(450), false)).toBe(null);
    expect(commentViewportBox(800, vv(400, 0, 2), true)).toBe(null);
    expect(commentViewportBox(800, null, true)).toBe(null);
  });
});

describe('phone panels pin their caption (Help, Comment)', () => {
  it('pins once the content has scrolled past the app bar', () => {
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 0 })).toBe(false);
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 56 })).toBe(false);
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 57 })).toBe(true);
  });

  it('pins while a keyboard is up, wherever the text is scrolled', () => {
    expect(shouldPinPanelCaption({ narrow: true, keyboard: true, scrollTop: 0 })).toBe(true);
  });

  it('once pinned, stays pinned until back at the top — no flip-flop', () => {
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 30, pinned: true })).toBe(true);
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 30, pinned: false })).toBe(false);
    expect(shouldPinPanelCaption({ narrow: true, keyboard: false, scrollTop: 0, pinned: true })).toBe(false);
  });

  it('never on desktop', () => {
    expect(shouldPinPanelCaption({ narrow: false, keyboard: true, scrollTop: 500 })).toBe(false);
  });
});

describe('numbered lists', () => {
  const at = (text, pos) => {
    const doc = commentTextToDoc(schema, text);
    return state.EditorState.create({ doc, selection: state.TextSelection.create(doc, pos) });
  };
  const run = (st, cmd) => { let next = st; cmd(st, tr => { next = st.apply(tr); }); return next; };

  it('keeps the written numbers on an untouched read', () => {
    const doc = commentTextToDoc(schema, '1. a\n1. b');
    expect(doc.child(0).attrs.number).toBe('1');
    expect(doc.child(1).attrs.number).toBe('1');
  });

  it('once edited, a run is written the way it shows — counting on from its first item', () => {
    expect(commentDocToText(commentTextToDoc(schema, '1. a\n1. b\n1. c'))).toBe('1. a\n2. b\n3. c');
    expect(commentDocToText(commentTextToDoc(schema, '3. a\n9. b'))).toBe('3. a\n4. b');
    expect(commentDocToText(commentTextToDoc(schema, '1. a\ntext\n5. b\n5. c'))).toBe('1. a\ntext\n5. b\n6. c');
  });

  it('Enter continues a numbered list, and the next number follows on save', () => {
    const st = run(at('1. milk', 5), commentEnterCommand(pm));
    expect(commentDocToText(st.doc)).toBe('1. milk\n2. ');
  });

  it('the toolbar button turns a line into a numbered item and back', () => {
    const on = run(at('milk', 2), commentBlockToggle(schema, 'ordered'));
    expect(commentDocToText(on.doc)).toBe('1. milk');
    expect(commentDocToText(run(on, commentBlockToggle(schema, 'ordered')).doc)).toBe('milk');
  });
});

describe('comment open on two devices', () => {
  const tree = (comments, ts) => _state.set({ nodes: [
    { id: 'work', type: 'branch', branch: 'work', label: 'Work', children: ['a1'], side: 'left', _ts: 0 },
    { id: 'a1', type: 'activity', branch: 'work', parent: 'work', label: 'Task', children: [], comments, _ts: ts },
  ] });
  const ta = () => sandboxGlobal.document.getElementById('comment-textarea');

  it('an untouched dialog never writes its stale text over a newer synced one', () => {
    tree('old', 5);
    openCommentDialog('a1').catch(() => {});
    findNode('a1').comments = 'new from desktop'; // sync lands while the dialog is open
    findNode('a1')._ts = 9;
    persistCommentDraft();                          // autosave / page hidden
    closeCommentDialog();
    expect(findNode('a1').comments).toBe('new from desktop');
    expect(findNode('a1')._ts).toBe(9);
  });

  it('an untouched dialog shows the newer version when it syncs in', () => {
    tree('old', 5);
    openCommentDialog('a1').catch(() => {});
    findNode('a1').comments = 'new from desktop';
    refreshOpenComment();
    expect(ta().value).toBe('new from desktop');
    closeCommentDialog();
    expect(findNode('a1').comments).toBe('new from desktop');
  });

  it('once the user has typed, their text stands and is saved', () => {
    tree('old', 5);
    openCommentDialog('a1').catch(() => {});
    _state.setCommentTyped(true);
    ta().value = 'mine';
    findNode('a1').comments = 'new from desktop';
    refreshOpenComment();
    expect(ta().value).toBe('mine');
    closeCommentDialog();
    expect(findNode('a1').comments).toBe('mine');
  });

  it('typing and then restoring the original text writes nothing', () => {
    tree('old', 5);
    openCommentDialog('a1').catch(() => {});
    _state.setCommentTyped(true);
    ta().value = 'old';
    closeCommentDialog();
    expect(findNode('a1')._ts).toBe(5);
  });
});

describe('pasted large text reads as a heading', () => {
  it('reads inline font sizes in pt and px', () => {
    expect(cssFontSizeInPt('26pt')).toBe(26);
    expect(cssFontSizeInPt(' 20pt ')).toBe(20);
    expect(cssFontSizeInPt('32px')).toBe(24);
    expect(cssFontSizeInPt('1.5em')).toBe(null);
    expect(cssFontSizeInPt('')).toBe(null);
    expect(cssFontSizeInPt(undefined)).toBe(null);
  });
});
