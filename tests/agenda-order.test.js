import {
  _state, genId, defaultWeekData,
  applyAgendaOrder, loadAgendaGroupOrder, saveAgendaGroupOrder,
} from './setup.js';

function makeWeek(...activityLabels) {
  const data = defaultWeekData();
  const branchId = data.nodes.find(n => n.type === 'branch')?.id;
  const acts = activityLabels.map(label => ({
    id: genId(), type: 'activity', branch: branchId, label,
    parent: branchId, children: [], done: false, unplanned: false,
    priority: 'normal', reusable: false, _ts: Date.now(),
  }));
  acts.forEach(a => {
    data.nodes.push(a);
    const branch = data.nodes.find(n => n.id === branchId);
    branch.children.push(a.id);
  });
  return { data, acts };
}

beforeEach(() => {
  _state.clearLocalStorage();
  const fresh = defaultWeekData();
  _state.set(fresh);
  _state.setWeekKey('2026-18');
});

// ─── applyAgendaOrder ────────────────────────────────────────────────────────

describe('applyAgendaOrder', () => {
  test('returns nodes in saved order', () => {
    const { acts } = makeWeek('A', 'B', 'C');
    const savedOrder = [acts[2].id, acts[0].id, acts[1].id];
    const result = applyAgendaOrder(acts, savedOrder);
    expect(result.map(n => n.label)).toEqual(['C', 'A', 'B']);
  });

  test('appends unknown nodes at end', () => {
    const { acts } = makeWeek('A', 'B', 'C');
    const savedOrder = [acts[0].id, acts[2].id];
    const result = applyAgendaOrder(acts, savedOrder);
    expect(result.map(n => n.label)).toEqual(['A', 'C', 'B']);
  });

  test('prunes stale IDs (node no longer in list)', () => {
    const { acts } = makeWeek('A', 'B');
    const staleId = genId();
    const savedOrder = [staleId, acts[1].id, acts[0].id];
    const result = applyAgendaOrder(acts, savedOrder);
    expect(result.map(n => n.label)).toEqual(['B', 'A']);
  });

  test('returns original order when no saved order', () => {
    const { acts } = makeWeek('X', 'Y');
    const result = applyAgendaOrder(acts, []);
    expect(result.map(n => n.label)).toEqual(['X', 'Y']);
  });
});

// ─── loadAgendaGroupOrder / saveAgendaGroupOrder ─────────────────────────────

describe('loadAgendaGroupOrder / saveAgendaGroupOrder', () => {
  test('returns empty array when no order saved', () => {
    expect(loadAgendaGroupOrder(1, 'pending')).toEqual([]);
  });

  test('round-trips through weekData.agendaOrder', () => {
    const ids = ['id1', 'id2', 'id3'];
    saveAgendaGroupOrder(1, 'pending', ids);
    expect(loadAgendaGroupOrder(1, 'pending')).toEqual(ids);
  });

  test('different tab+group keys are independent', () => {
    saveAgendaGroupOrder(1, 'pending', ['a', 'b']);
    saveAgendaGroupOrder(1, 'done', ['c', 'd']);
    saveAgendaGroupOrder(2, 'pending', ['e', 'f']);
    expect(loadAgendaGroupOrder(1, 'pending')).toEqual(['a', 'b']);
    expect(loadAgendaGroupOrder(1, 'done')).toEqual(['c', 'd']);
    expect(loadAgendaGroupOrder(2, 'pending')).toEqual(['e', 'f']);
  });

  test('overdue tab uses "overdue" as tabKey', () => {
    saveAgendaGroupOrder('overdue', 'pending', ['x', 'y']);
    expect(loadAgendaGroupOrder('overdue', 'pending')).toEqual(['x', 'y']);
  });

  test('saveAgendaGroupOrder persists to weekData.agendaOrder', () => {
    saveAgendaGroupOrder(3, 'anyday', ['z1', 'z2']);
    const wd = _state.get();
    expect(wd.agendaOrder?.['3-anyday']).toEqual(['z1', 'z2']);
  });
});
