import { 
  takeSnapshot, undo, redo, _state, findNode, applyTheme, t
} from './setup.js';

describe('History & Global State restoration', () => {
  const mkBranch = (id) => ({ id, type: 'branch', branch: id, label: id, children: [], side: 'left', _ts: 0 });

  beforeEach(() => {
    _state.reset();
    _state.set({ nodes: [mkBranch('work')] });
    _state.setWeekKey('2026-01');
  });

  test('undo/redo restores node structure', async () => {
    _state.set({ nodes: [mkBranch('work')] }); 
    const initialActivityCount = _state.get().nodes.filter(n => n.type === 'activity').length;
    takeSnapshot();
    
    // Mutation: add a node
    const data = _state.get();
    data.nodes.push({ id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'task', children: [] });
    data.nodes.find(n => n.id === 'work').children.push('a1');
    _state.set(data);
    
    expect(_state.get().nodes.filter(n => n.type === 'activity')).toHaveLength(initialActivityCount + 1);
    
    await undo();
    expect(_state.get().nodes.filter(n => n.type === 'activity')).toHaveLength(initialActivityCount);
    
    await redo();
    expect(_state.get().nodes.filter(n => n.type === 'activity')).toHaveLength(initialActivityCount + 1);
  });

  test('undo restores theme', async () => {
    const doc = _state.getDocument();
    doc.documentElement.dataset.theme = 'light';
    _state.setLocalStorage('zenit-week-theme', 'light');
    takeSnapshot();
    
    applyTheme('dark');
    expect(doc.documentElement.dataset.theme).toBe('dark');
    
    await undo();
    expect(JSON.parse(_state.getLocalStorage('zenit-week-theme'))).toBe('light');
  });

  test('undo restores language', async () => {
    _state.setLang('en');
    takeSnapshot(); 
    
    _state.setLang('cs');
    expect(t('help.title')).toBe('Nápověda & klávesové zkratky');
    
    await undo();
    expect(t('help.title')).toBe('Help & Hotkeys');
  });

  // I4 — an undo stamps only what it actually changes. Restamping the whole
  // snapshot is what let a stale device win the next LWW merge for a week's
  // worth of nodes it had never touched.
  describe('undo restamps only what it changes (I4)', () => {
    const mkWeek = () => ({
      nodes: [
        mkBranch('work'),
        { id: 'a1', type: 'activity', parent: 'work', branch: 'work', label: 'A1',
          children: [], _ts: 100, _posTs: 100, offX: 0, offY: 0 },
        { id: 'a2', type: 'activity', parent: 'work', branch: 'work', label: 'A2',
          children: [], _ts: 100, _posTs: 100, offX: 0, offY: 0 },
      ],
      tombstones: [],
      crdtVersion: 0,
    });

    beforeEach(() => {
      _state.reset();
      _state.setWeekKey('2026-01');
      const w = mkWeek();
      w.nodes.find(n => n.id === 'work').children = ['a1', 'a2'];
      _state.set(w);
    });

    test('an undo over an unchanged week leaves every stamp alone', async () => {
      takeSnapshot();
      await undo();
      for (const id of ['a1', 'a2']) {
        expect(findNode(id)._ts, `${id} _ts`).toBe(100);
        expect(findNode(id)._posTs, `${id} _posTs`).toBe(100);
      }
    });

    test('reverting one node\'s done restamps only that node\'s _ts', async () => {
      takeSnapshot();
      const data = _state.get();
      const a1 = data.nodes.find(n => n.id === 'a1');
      a1.done = true;
      a1._ts = 500;
      _state.set(data);

      await undo();

      expect(findNode('a1').done).toBeFalsy();
      expect(findNode('a1')._ts, 'the reverted node must win the next merge').toBeGreaterThan(500);
      expect(findNode('a1')._posTs, 'its position did not change').toBe(100);
      expect(findNode('a2')._ts, 'the untouched sibling must not be promoted').toBe(100);
      expect(findNode('a2')._posTs).toBe(100);
    });

    test('reverting one node\'s offset restamps only that node\'s _posTs', async () => {
      takeSnapshot();
      const data = _state.get();
      const a1 = data.nodes.find(n => n.id === 'a1');
      a1.offX = 120;
      a1._posTs = 500;
      _state.set(data);

      await undo();

      expect(findNode('a1').offX).toBe(0);
      expect(findNode('a1')._posTs).toBeGreaterThan(500);
      expect(findNode('a1')._ts, 'content never moved').toBe(100);
      expect(findNode('a2')._ts).toBe(100);
      expect(findNode('a2')._posTs).toBe(100);
    });

    test('a node the undo re-creates wins on both axes', async () => {
      takeSnapshot();
      const data = _state.get();
      data.nodes = data.nodes.filter(n => n.id !== 'a2');
      data.nodes.find(n => n.id === 'work').children = ['a1'];
      _state.set(data);

      await undo();

      const a2 = findNode('a2');
      expect(a2).toBeDefined();
      expect(a2._ts).toBeGreaterThan(100);
      expect(a2._posTs).toBeGreaterThan(100);
    });
  });

  test('undo/redo across week boundaries', async () => {
    _state.setWeekKey('2026-01');
    _state.set({ nodes: [mkBranch('work')] });
    takeSnapshot();
    
    // Change week. No second snapshot — takeSnapshot captures the state to
    // return to, so snapshotting after the change would make undo a no-op.
    // (It used to pass anyway: the repair pass resurrected the missing branch.)
    _state.setWeekKey('2026-02');
    _state.set({ nodes: [mkBranch('family')] });

    await undo();
    expect(_state.get().nodes.find(n => n.id === 'work')).toBeDefined();
    
    await redo();
    expect(_state.get().nodes.find(n => n.id === 'family')).toBeDefined();
  });
});
