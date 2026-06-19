import {
  _state, genId, defaultWeekData, findNode, rebuildNodeMap,
  agendaRowsForNode, pinToTopOfAgenda, restoreToAgendaOrder,
  setStatus, loadAgendaGroupOrder, setActivityDays,
} from './setup.js';

function branchId() {
  return _state.get().nodes.find(n => n.type === 'branch')?.id;
}

function addActivity(label, props = {}) {
  const id = genId();
  const b = branchId();
  const node = {
    id, type: 'activity', branch: b, label, parent: b, children: [],
    done: false, unplanned: false, priority: 'normal', reusable: false,
    _ts: Date.now(), ...props,
  };
  const wd = _state.get();
  wd.nodes.push(node);
  wd.nodes.find(n => n.id === b).children.push(id);
  _state.set(wd);
  rebuildNodeMap();
  return id;
}

beforeEach(() => {
  _state.clearLocalStorage();
  _state.set(defaultWeekData());
  _state.setWeekKey('2026-18');
});

// ─── agendaRowsForNode ───────────────────────────────────────────────────────

describe('agendaRowsForNode', () => {
  test('an any-day leaf contributes to all 7 day tabs Any-day group', () => {
    const id = addActivity('Read');
    const rows = agendaRowsForNode(findNode(id));
    expect(rows).toHaveLength(7);
    expect(rows.every(r => r.groupKey === 'anyday' && r.rowId === id)).toBe(true);
    expect(rows.map(r => r.tabKey).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('a day-scheduled leaf contributes a pending row on that day, not Any-day', () => {
    const id = addActivity('Gym (we)'); // Wednesday = index 3
    const rows = agendaRowsForNode(findNode(id));
    expect(rows.some(r => r.tabKey === 3 && r.groupKey === 'pending' && r.rowId === id)).toBe(true);
    expect(rows.some(r => r.groupKey === 'anyday')).toBe(false);
  });

  test('a day-split parent maps to its day-children rows, not the parent id', () => {
    const id = addActivity('Run');
    setActivityDays(id, new Set([1, 3])); // split into day-children Mon(1) + Wed(3)
    const parent = findNode(id);
    const dayKids = parent.children.map(findNode).filter(n => n?.dayChild);
    expect(dayKids).toHaveLength(2);
    const rows = agendaRowsForNode(parent);
    // Rows are keyed by the day-children, never the parent.
    expect(rows.some(r => r.rowId === id)).toBe(false);
    dayKids.forEach(c => {
      expect(rows.some(r => r.tabKey === c.dayIndex && r.groupKey === 'pending' && r.rowId === c.id)).toBe(true);
    });
  });
});

// ─── pinToTopOfAgenda ────────────────────────────────────────────────────────

describe('pinToTopOfAgenda', () => {
  test('prepends across every group it appears in, preserving existing entries', () => {
    const id = addActivity('Read'); // any-day → 7 groups
    const wd = _state.get();
    wd.agendaOrder = { '3-anyday': { ids: ['other'], ts: 1 } };
    _state.set(wd);

    pinToTopOfAgenda(id);

    expect(loadAgendaGroupOrder(3, 'anyday')).toEqual([id, 'other']);
    expect(loadAgendaGroupOrder(0, 'anyday')).toEqual([id]); // seeded fresh
  });

  test('is idempotent — re-pinning keeps the row at front, deduped', () => {
    const id = addActivity('Read');
    pinToTopOfAgenda(id);
    pinToTopOfAgenda(id);
    expect(loadAgendaGroupOrder(2, 'anyday')).toEqual([id]);
  });
});

// ─── restoreToAgendaOrder ────────────────────────────────────────────────────

describe('restoreToAgendaOrder', () => {
  test('no-op when no group has a manual order', () => {
    const id = addActivity('Read');
    restoreToAgendaOrder(id);
    expect(_state.get().agendaOrder).toBeUndefined();
  });

  test('prepends to a manually-ordered group the row was pruned from', () => {
    const id = addActivity('Read');
    const wd = _state.get();
    wd.agendaOrder = { '2-anyday': { ids: ['x', 'y'], ts: 1 } };
    _state.set(wd);

    restoreToAgendaOrder(id);
    expect(loadAgendaGroupOrder(2, 'anyday')).toEqual([id, 'x', 'y']);
    // Groups with no manual order stay empty — restore never seeds them.
    expect(loadAgendaGroupOrder(0, 'anyday')).toEqual([]);
  });

  test('leaves an existing slot untouched when the row is still listed', () => {
    const id = addActivity('Read');
    const wd = _state.get();
    wd.agendaOrder = { '2-anyday': { ids: ['x', id, 'y'], ts: 1 } };
    _state.set(wd);

    restoreToAgendaOrder(id);
    expect(loadAgendaGroupOrder(2, 'anyday')).toEqual(['x', id, 'y']);
  });
});

// ─── setStatus integration ───────────────────────────────────────────────────

describe('setStatus pins on bump and restores on undone', () => {
  test('bumping to high pins the row to the top of its groups', () => {
    const id = addActivity('Read');
    setStatus(id, 'prio-high');
    expect(findNode(id).priority).toBe('high');
    expect(loadAgendaGroupOrder(0, 'anyday')).toEqual([id]);
  });

  test('clearing the bump does not auto-unpin (user order is remembered)', () => {
    const id = addActivity('Read');
    setStatus(id, 'prio-high');   // pin
    setStatus(id, 'prio-high');   // toggles back to normal
    expect(findNode(id).priority).toBe(null);
    expect(loadAgendaGroupOrder(0, 'anyday')).toEqual([id]);
  });

  test('undoing a done task returns it to the top of a group it was pruned from', () => {
    const id = addActivity('Read', { done: true, doneAt: new Date().toISOString() });
    const wd = _state.get();
    wd.agendaOrder = { '2-anyday': { ids: ['x'], ts: 1 } };
    _state.set(wd);

    setStatus(id, 'undone');
    expect(findNode(id).done).toBe(false);
    expect(loadAgendaGroupOrder(2, 'anyday')).toEqual([id, 'x']);
  });
});
