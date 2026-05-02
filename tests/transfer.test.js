import { 
  transferUnfinished, moveNodeToNextWeek, transferReusable,
  findNode, _state, genId, offsetWeek
} from './setup.js';

describe('Transfers - Week to Week', () => {
  const mkBranch = (id, children = []) => ({ id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 });
  const mkActivity = (id, parent, branch, extra = {}) => ({ 
    id, parent, branch, type: 'activity', label: id, children: [], done: false, ...extra 
  });

  beforeEach(() => {
    _state.clearLocalStorage();
    _state.reset();
  });

  describe('transferUnfinished', () => {
    test('clones undone activities from previous week', async () => {
      const prevWeek = '2026-01';
      const currWeek = '2026-02';
      
      const b = mkBranch('work', ['a1']);
      const a1 = mkActivity('a1', 'work', 'work', { done: false });
      
      _state.setLocalStorage(`zenit-week-${prevWeek}`, { nodes: [b, a1] });
      _state.setWeekKey(currWeek);
      _state.set({ nodes: [mkBranch('work')] });

      await transferUnfinished();

      const currentNodes = _state.get().nodes;
      const transferred = currentNodes.find(n => n.prevId === 'a1');
      expect(transferred).toBeDefined();
      expect(transferred.done).toBe(false);
      expect(transferred.parent).toBe('work');
      expect(currentNodes.find(n => n.id === 'work').children).toContain(transferred.id);
    });

    test('preserves hierarchy during transfer', async () => {
      const b = mkBranch('work', ['p1']);
      const p1 = mkActivity('p1', 'work', 'work', { children: ['c1'] });
      const c1 = mkActivity('c1', 'p1', 'work');
      
      _state.setLocalStorage(`zenit-week-2026-01`, { nodes: [b, p1, c1] });
      _state.setWeekKey('2026-02');
      _state.set({ nodes: [mkBranch('work')] });

      await transferUnfinished();

      const currentNodes = _state.get().nodes;
      const newP1 = currentNodes.find(n => n.prevId === 'p1');
      const newC1 = currentNodes.find(n => n.prevId === 'c1');
      
      expect(newC1.parent).toBe(newP1.id);
      expect(newP1.children).toContain(newC1.id);
    });

    test('resets counter value during transfer', async () => {
      const b = mkBranch('work', ['a1']);
      const a1 = mkActivity('a1', 'work', 'work', { children: ['cnt1'] });
      const cnt1 = { id: 'cnt1', type: 'counter', parent: 'a1', branch: 'work', val: 5, max: 10, done: false, children: [] };
      
      _state.setLocalStorage(`zenit-week-2026-01`, { nodes: [b, a1, cnt1] });
      _state.setWeekKey('2026-02');
      _state.set({ nodes: [mkBranch('work')] });

      await transferUnfinished();

      const newCnt1 = _state.get().nodes.find(n => n.type === 'counter');
      expect(newCnt1.val).toBe(0);
    });
  });

  describe('moveNodeToNextWeek', () => {
    test('moves node and subtree to next week and leaves tombstone', async () => {
      const currWeek = '2026-01';
      const nextWeek = '2026-02';
      
      const b = mkBranch('work', ['a1']);
      const a1 = mkActivity('a1', 'work', 'work', { children: ['c1'] });
      const c1 = mkActivity('c1', 'a1', 'work');
      
      _state.set({ nodes: [b, a1, c1] });
      _state.setWeekKey(currWeek);
      
      // Mock empty next week
      _state.setLocalStorage(`zenit-week-${nextWeek}`, { nodes: [mkBranch('work')] });

      await moveNodeToNextWeek('a1');

      // Local state should be empty (except branch) and have tombstones
      const localData = _state.get();
      expect(localData.nodes.filter(n => n.type === 'activity')).toHaveLength(0);
      expect(localData.tombstones).toContain('a1');
      expect(localData.tombstones).toContain('c1');

      // Next week should have the nodes (with new IDs)
      const nextWeekRaw = _state.getLocalStorage(`zenit-week-${nextWeek}`);
      const nextWeekData = JSON.parse(nextWeekRaw);
      expect(nextWeekData.nodes.filter(n => n.type === 'activity')).toHaveLength(2);
      
      const movedA1 = nextWeekData.nodes.find(n => n.label === 'a1');
      const movedC1 = nextWeekData.nodes.find(n => n.label === 'c1');
      expect(movedA1.id).not.toBe('a1');
      expect(movedC1.parent).toBe(movedA1.id);
    });

    test('ensures branch exists in next week', async () => {
      _state.set({ nodes: [mkBranch('work', ['a1']), mkActivity('a1', 'work', 'work')] });
      _state.setWeekKey('2026-01');
      
      // Next week is completely empty (no branches)
      _state.setLocalStorage(`zenit-week-2026-02`, { nodes: [] });

      await moveNodeToNextWeek('a1');

      const nextWeekData = JSON.parse(_state.getLocalStorage('zenit-week-2026-02'));
      expect(nextWeekData.nodes.find(n => n.id === 'work')).toBeDefined();
    });
  });

  describe('transferReusable', () => {
    test('clones nodes marked reusable:true even if done', async () => {
      const b = mkBranch('work', ['a1']);
      const a1 = mkActivity('a1', 'work', 'work', { reusable: true, done: true });
      
      _state.setLocalStorage(`zenit-week-2026-01`, { nodes: [b, a1] });
      _state.setWeekKey('2026-02');
      _state.set({ nodes: [mkBranch('work')] });

      await transferReusable();

      const newA1 = _state.get().nodes.find(n => n.label === 'a1');
      expect(newA1).toBeDefined();
      expect(newA1.done).toBe(false); // Should be reset to undone
      expect(newA1.reusable).toBe(true);
    });
  });
});
