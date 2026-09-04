import {
  getAgendaAncestorChain,
  getAgendaNodeLabel,
  laterRowNode,
  findNode, rebuildNodeMap,
  _state,
} from './setup.js';

function setUp(nodes) {
  _state.set({ nodes });
  _state.setWeekKey('2026-01');
  _state.reset();
  _state.setLang('en');
}

function branch(id, children = []) {
  return { id, type: 'branch', branch: id, label: id, children, side: 'left', _ts: 0 };
}
function activity(id, parent, branchId, children = []) {
  return { id, type: 'activity', branch: branchId, parent, label: id, done: false,
    unplanned: false, children, _ts: 0 };
}

describe('getAgendaAncestorChain', () => {
  test('direct child of branch → chain is [branch]', () => {
    setUp([branch('family', ['a'])].concat([activity('a', 'family', 'family')]));
    const chain = getAgendaAncestorChain(findNode('a'));
    expect(chain).toEqual(['family']);
  });

  test('grandchild → chain is [branch, parent]', () => {
    setUp([
      branch('family', ['trip']),
      activity('trip', 'family', 'family', ['paris']),
      activity('paris', 'trip', 'family'),
    ]);
    const chain = getAgendaAncestorChain(findNode('paris'));
    expect(chain).toEqual(['family', 'trip']);
  });

  test('deep nest → full chain branch→parent', () => {
    setUp([
      branch('family', ['trip']),
      activity('trip', 'family', 'family', ['france']),
      activity('france', 'trip', 'family', ['paris']),
      activity('paris', 'france', 'family'),
    ]);
    const chain = getAgendaAncestorChain(findNode('paris'));
    expect(chain).toEqual(['family', 'trip', 'france']);
  });

  test('day-child treats its activity-parent as the leaf', () => {
    setUp([
      branch('family', ['trip']),
      activity('trip', 'family', 'family', ['paris']),
      activity('paris', 'trip', 'family', ['paris-mo']),
      { id: 'paris-mo', type: 'activity', branch: 'family', parent: 'paris',
        label: '0', dayChild: true, dayIndex: 1, children: [], _ts: 0,
        done: false, unplanned: false },
    ]);
    const chain = getAgendaAncestorChain(findNode('paris-mo'));
    expect(chain).toEqual(['family', 'trip']);
  });

  test('strips day groups from ancestor labels', () => {
    setUp([
      branch('me', ['workouts']),
      activity('workouts', 'me', 'me', ['pushups']),
      activity('pushups', 'workouts', 'me'),
    ]);
    findNode('workouts').label = 'Workouts (mo, we, fr)';
    rebuildNodeMap();
    const chain = getAgendaAncestorChain(findNode('pushups'));
    expect(chain).toEqual(['me', 'Workouts']);
  });
});


// A Later row stands for a schedule entry, not a node in this week, so the
// chain cannot be walked — it comes from the path the entry carries. The rows
// must still read exactly like the task rows they become.
describe('Later rows use the same label logic as a day row', () => {
  const entry = (over = {}) => ({
    id: 's1', label: 'Go for a run', branch: 'me', priority: 'normal',
    path: ['Health', 'Running'], anchor: '2026-09-15', repeat: null,
    end: { type: 'never' }, plantedThrough: null, planted: [], _ts: 1,
    ...over,
  });

  beforeEach(() => setUp([branch('me', [])]));

  test('chain is the branch followed by the entry path', () => {
    expect(getAgendaAncestorChain(laterRowNode(entry(), '2026-09-15')))
      .toEqual(['me', 'Health', 'Running']);
  });

  test('prefix is the nearest name in the path, as it is for a task row', () => {
    expect(getAgendaNodeLabel(laterRowNode(entry(), '2026-09-15')))
      .toEqual({ prefix: 'Running', main: 'Go for a run' });
  });

  test('an entry with no path falls back to its branch, like a top-level task', () => {
    const row = laterRowNode(entry({ path: [] }), '2026-09-15');
    expect(getAgendaAncestorChain(row)).toEqual(['me']);
    expect(getAgendaNodeLabel(row)).toEqual({ prefix: 'me', main: 'Go for a run' });
  });

  test('a branch this week no longer has leaves the path standing alone', () => {
    const row = laterRowNode(entry({ branch: 'gone' }), '2026-09-15');
    expect(getAgendaAncestorChain(row)).toEqual(['Health', 'Running']);
  });
});
