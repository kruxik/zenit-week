import { mergeWeekData, _weekContentSig, hasEditingNode, applyRemoteMerge, _state } from './setup.js';

// Multi-tab editing (Option B — local sync peer). The CRDT merge itself is
// covered by crdt.test.js; these tests pin the feature-specific properties:
// convergence on disjoint edits, the _weekContentSig echo-guard, and the
// edit-in-flight deferral that protects an open inline editor.
describe('Multi-tab (Option B) — local sync peer', () => {
  const mkNode = (id, parent, ts = 100, extra = {}) => ({
    id, parent, branch: 'work', type: 'activity', label: id, children: [], _ts: ts, ...extra,
  });
  const mkWeek = (nodes = [], tombstones = [], savedAt = 1000) => ({
    nodes, tombstones, savedAt, crdtVersion: 1,
  });
  const activityIds = (week) =>
    week.nodes.filter(n => n.type === 'activity').map(n => n.id).sort();

  describe('convergence: disjoint edits union', () => {
    test('two tabs adding different nodes → both survive the merge', () => {
      // Tab A added a1, Tab B added b1; neither knows about the other.
      const merged = mergeWeekData(mkWeek([mkNode('a1', 'work')]), mkWeek([mkNode('b1', 'work')]));
      expect(activityIds(merged)).toEqual(['a1', 'b1']);
    });

    test('disjoint merge is order-independent (A∪B === B∪A)', () => {
      const a = mkWeek([mkNode('a1', 'work')]);
      const b = mkWeek([mkNode('b1', 'work')]);
      expect(activityIds(mergeWeekData(a, b))).toEqual(activityIds(mergeWeekData(b, a)));
    });
  });

  describe('echo-guard: _weekContentSig dedup', () => {
    test('identical content with different _ts has the same signature', () => {
      // _ts is the LWW clock, not content — it must not break convergence dedup.
      const w1 = mkWeek([mkNode('a1', 'work', 100)]);
      const w2 = mkWeek([mkNode('a1', 'work', 999)]);
      expect(_weekContentSig(w1)).toBe(_weekContentSig(w2));
    });

    test('the transient _editing flag does not affect the signature', () => {
      const w1 = mkWeek([mkNode('a1', 'work', 100)]);
      const w2 = mkWeek([mkNode('a1', 'work', 100, { _editing: true })]);
      expect(_weekContentSig(w1)).toBe(_weekContentSig(w2));
    });

    test('a real content change DOES change the signature', () => {
      const w1 = mkWeek([mkNode('a1', 'work', 100)]);
      const renamed = mkNode('a1', 'work', 100); renamed.label = 'changed';
      expect(_weekContentSig(w1)).not.toBe(_weekContentSig(mkWeek([renamed])));
    });
  });

  describe('edit-in-flight guard', () => {
    test('hasEditingNode() is false when nothing is being edited', () => {
      _state.set(mkWeek([mkNode('a1', 'work')]));
      expect(hasEditingNode()).toBe(false);
    });

    test('hasEditingNode() is true when a node has an open editor', () => {
      _state.set(mkWeek([mkNode('a1', 'work', 100, { _editing: true })]));
      expect(hasEditingNode()).toBe(true);
    });

    test('applyRemoteMerge defers (does not clobber) a peer merge mid-edit', async () => {
      // currentWeekKey holds a node with an open inline editor.
      _state.setWeekKey('2026-01');
      _state.set(mkWeek([mkNode('a1', 'work', 100, { _editing: true })]));
      _state.clearIDBStore();

      const remote = mkWeek([mkNode('a1', 'work', 200)]); // peer's newer record
      await applyRemoteMerge('2026-01', remote, JSON.stringify(remote), 1, false, remote);

      // Deferred: the open editor survives and nothing was written to IDB.
      expect(hasEditingNode()).toBe(true);
      expect(_state.getIDBStore()['week-2026-01']).toBeUndefined();
    });
  });
});
