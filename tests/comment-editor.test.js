import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as model from 'prosemirror-model';
import * as state from 'prosemirror-state';
import * as history from 'prosemirror-history';
import {
  _state, sandboxGlobal, findNode, triggerKeydown,
  openCommentDialog, closeCommentDialog, persistCommentDraft, loadCommentEditor,
  buildCommentSchema, commentTextToDoc, commentDocToText, commentTextSlice, isTypingTarget,
} from './setup.js';

// The real packages, injected exactly as the page injects the bundle's namespace.
const pm = { model, state, history };
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
