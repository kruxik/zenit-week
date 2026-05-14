import { mergeWeekData, validateAndRepair } from './setup.js';

describe('CRDT - mergeWeekData', () => {
  const mkNode = (id, parent, ts = 100) => ({ 
    id, parent, branch: 'work', type: 'activity', label: id, children: [], _ts: ts 
  });

  const mkWeek = (nodes = [], tombstones = [], savedAt = 1000) => ({
    nodes, tombstones, savedAt, crdtVersion: 1
  });

  test('unions tombstones from both sides', () => {
    const local = mkWeek([], ['t1']);
    const remote = mkWeek([], ['t2']);
    const merged = mergeWeekData(local, remote);
    expect(new Set(merged.tombstones)).toEqual(new Set(['t1', 't2']));
  });

  test('LWW: newer _ts wins for the same node', () => {
    const localNode = mkNode('a1', 'work', 100);
    localNode.label = 'local version';
    const remoteNode = mkNode('a1', 'work', 200);
    remoteNode.label = 'remote version';

    const local = mkWeek([localNode]);
    const remote = mkWeek([remoteNode]);
    
    const merged = mergeWeekData(local, remote);
    const node = merged.nodes.find(n => n.id === 'a1');
    expect(node.label).toBe('remote version');
  });

  test('LWW: remote wins on identical _ts', () => {
    const localNode = mkNode('a1', 'work', 100);
    localNode.label = 'local';
    const remoteNode = mkNode('a1', 'work', 100);
    remoteNode.label = 'remote';

    const merged = mergeWeekData(mkWeek([localNode]), mkWeek([remoteNode]));
    expect(merged.nodes.find(n => n.id === 'a1').label).toBe('remote');
  });

  test('tombstones delete nodes from either side', () => {
    const local = mkWeek([mkNode('a1', 'work')], ['a2']);
    const remote = mkWeek([mkNode('a2', 'work')], ['a1']);
    
    const merged = mergeWeekData(local, remote);
    // Mandatory branches (work, family, me) will be present
    expect(merged.nodes.filter(n => n.type === 'activity')).toHaveLength(0);
    expect(new Set(merged.tombstones)).toEqual(new Set(['a1', 'a2']));
  });

  test('preserves node order from the "winner" side (higher savedAt)', () => {
    const n1 = mkNode('n1', 'work');
    const n2 = mkNode('n2', 'work');
    
    // Local: [n1, n2], savedAt 1000
    const local = mkWeek([{...n1}, {...n2}], [], 1000);
    // Remote: [n2, n1], savedAt 2000 (Remote wins)
    const remote = mkWeek([{...n2}, {...n1}], [], 2000);

    const merged = mergeWeekData(local, remote);
    // Filter out mandatory branches for easier comparison
    const activityIds = merged.nodes.filter(n => n.type === 'activity').map(n => n.id);
    expect(activityIds).toEqual(['n2', 'n1']);
  });

  test('repairs children arrays: filters out tombstoned or missing nodes', () => {
    const p = mkNode('parent', 'work');
    p.children = ['c1', 'c2'];
    const c1 = mkNode('c1', 'parent');
    const c2 = mkNode('c2', 'parent');

    const local = mkWeek([p, c1, c2], [], 1000);
    const remote = mkWeek([], ['c2'], 2000); // remote deleted c2

    const merged = mergeWeekData(local, remote);
    const mergedParent = merged.nodes.find(n => n.id === 'parent');
    expect(mergedParent.children).toEqual(['c1']);
  });

  test('baseline: newer savedAt wins', () => {
    const local  = mkWeek([], [], 1000); local.baseline  = 10;
    const remote = mkWeek([], [], 2000); remote.baseline = 20;
    expect(mergeWeekData(local, remote).baseline).toBe(20);
  });

  test('drops dead todoOrder field on output', () => {
    const local  = mkWeek([], [], 1000); local.todoOrder  = { 'a': ['x'] };
    const remote = mkWeek([], [], 2000); remote.todoOrder = { 'b': ['y'] };
    const merged = mergeWeekData(local, remote);
    expect(merged.todoOrder).toBeUndefined();
  });

  test('agendaOrder: per-key LWW by entry.ts (not document savedAt)', () => {
    // local: low savedAt but fresh per-key ts → must still win
    const local = mkWeek([], [], 1000);
    local.agendaOrder = {
      'mo-pending': { ids: ['fresh1', 'fresh2'], ts: 5000 },
      'tu-pending': { ids: ['old-local'],       ts: 2000 },
    };
    // remote: high savedAt but stale per-key ts → loses on shared key
    const remote = mkWeek([], [], 9000);
    remote.agendaOrder = {
      'mo-pending': { ids: ['stale1'],          ts: 3000 },
      'we-pending': { ids: ['remote-only'],     ts: 4000 },
    };
    const merged = mergeWeekData(local, remote);
    expect(merged.agendaOrder['mo-pending'].ids).toEqual(['fresh1', 'fresh2']); // local fresh
    expect(merged.agendaOrder['tu-pending'].ids).toEqual(['old-local']);        // local only
    expect(merged.agendaOrder['we-pending'].ids).toEqual(['remote-only']);      // remote only
  });

  test('agendaOrder: tie-break favors remote', () => {
    const local  = mkWeek([], [], 1000);
    local.agendaOrder  = { 'k': { ids: ['L'], ts: 100 } };
    const remote = mkWeek([], [], 2000);
    remote.agendaOrder = { 'k': { ids: ['R'], ts: 100 } };
    expect(mergeWeekData(local, remote).agendaOrder['k'].ids).toEqual(['R']);
  });

  test('agendaOrder: pre-migration array shape treated as ts=0', () => {
    const local = mkWeek([], [], 1000);
    local.agendaOrder  = { 'k': ['legacy'] };                       // legacy array → ts=0
    const remote = mkWeek([], [], 2000);
    remote.agendaOrder = { 'k': { ids: ['fresh'], ts: 1 } };        // any ts>0 beats legacy
    expect(mergeWeekData(local, remote).agendaOrder['k'].ids).toEqual(['fresh']);
  });

  test('handles complete missing branches by delegating to validateAndRepair', () => {
    const local = mkWeek([], [], 1000); // completely empty
    const remote = mkWeek([], [], 2000);
    
    const merged = mergeWeekData(local, remote);
    const branchIds = merged.nodes.filter(n => n.type === 'branch').map(n => n.id);
    expect(branchIds).toContain('work');
    expect(branchIds).toContain('family');
    expect(branchIds).toContain('me');
  });
});
