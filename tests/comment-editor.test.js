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
    ['- [ ] open', 'check'],
    ['- [x] done', 'check'],
    ['plain', 'paragraph'],
  ])('%j becomes a %s node without its marker', (text, type) => {
    const node = commentTextToDoc(schema, text).firstChild;
    expect(node.type.name).toBe(type);
    expect(node.textContent).toBe(text.replace(/^(- \[[ x]\] |- |# )/, ''));
  });

  it('keeps inline syntax as literal text until marks exist', () => {
    const text = '- [x] **bold** [doc](https://a.cz)';
    const doc = commentTextToDoc(schema, text);
    expect(doc.firstChild.attrs.checked).toBe(true);
    expect(doc.firstChild.textContent).toBe('**bold** [doc](https://a.cz)');
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
    for (const typed of ['- ', '[] ', '[ ] ', '[x] ', '- [ ] ', '- [x] ', '# ', '-\u00a0']) {
      expect(matches(typed)).toBeGreaterThan(0);
    }
    for (const typed of ['-- ', '## ', '[X] ', 'a- ']) expect(matches(typed)).toBe(0);
  });
});
