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

  test('undo/redo across week boundaries', async () => {
    _state.setWeekKey('2026-01');
    _state.set({ nodes: [mkBranch('work')] });
    takeSnapshot();
    
    // Change week
    _state.setWeekKey('2026-02');
    _state.set({ nodes: [mkBranch('family')] });
    takeSnapshot();
    
    await undo();
    expect(_state.get().nodes.find(n => n.id === 'work')).toBeDefined();
    
    await redo();
    expect(_state.get().nodes.find(n => n.id === 'family')).toBeDefined();
  });
});
