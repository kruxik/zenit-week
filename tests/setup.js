import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(resolve(__dirname, '../zenit-week.html'), 'utf8');

// Extract the main app <script id="app">…</script> block
const match = html.match(/<script\s+id="app">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Could not extract <script id="app"> block from zenit-week.html');
const scriptCode = match[1];

// Reusable stub for DOM elements returned by getElementById / createElement
function elementStub() {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
    style: {},
    contains: () => false,
    value: '',
    textContent: '',
    innerHTML: '',
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    focus: () => {},
    select: () => {},
    scrollWidth: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }),
    dataset: {},
  };
}

// Minimal sandbox — only what the pure functions need.
// window.addEventListener is stubbed so the 'load' callback never fires.
const sandbox = {
  crypto: globalThis.crypto,
  console,
  window: { addEventListener: () => {} },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (id === 'cp-sb-canvas') {
        const grad = { addColorStop: () => {} };
        const ctx2d = {
          fillStyle: '',
          fillRect: () => {},
          createLinearGradient: () => grad,
          arc: () => {}, beginPath: () => {}, stroke: () => {},
          strokeStyle: '', lineWidth: 0,
        };
        return { ...elementStub(), getContext: () => ctx2d, width: 160, height: 120 };
      }
      return elementStub();
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createElement: (tag) => {
      if (tag === 'canvas') {
        return { getContext: () => ({ measureText: () => ({ width: 0 }), font: '' }) };
      }
      return elementStub();
    },
    createElementNS: (_ns, _tag) => elementStub(),
    body: elementStub(),
  },
  _lsStore: {},
  localStorage: {
    getItem(k)    { return sandbox._lsStore[k] ?? null; },
    setItem(k, v) { sandbox._lsStore[k] = v; },
    removeItem(k) { delete sandbox._lsStore[k]; },
  },
  location: { hash: '' },
  navigator: { userAgentData: null, userAgent: '' },
  performance: { now: () => 0 },
  requestAnimationFrame: () => {},
  setTimeout,
  clearTimeout,
  Date,
  indexedDB: {
    open: () => ({ onsuccess: null, onupgradeneeded: null, onerror: null, onblocked: null })
  },
  _dbMock: {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => ({
      objectStore: () => ({
        get: () => ({ onsuccess: null }),
        put: () => ({}),
        delete: () => ({}),
        getAllKeys: () => ({ onsuccess: null }),
      }),
      oncomplete: null,
      onerror: null,
    }),
  },
  // Test state bridge — populated by the appended accessor snippet below
  _state: {},
};

vm.createContext(sandbox);

// Append state accessors so tests can read/write let-scoped app variables
const stateAccessors = `
// Sync overrides for tests because existing tests are synchronous
loadWeek = function(wk) {
  const raw = localStorage.getItem('zenit-week-' + wk);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      return migrateCrdt(validateAndRepair(migrateDayCounters(data)));
    } catch(e) {}
  }
  const prevWk = offsetWeek(wk, -1);
  const prevRaw = localStorage.getItem('zenit-week-' + prevWk);
  if (prevRaw) {
    try {
      const prevData = JSON.parse(prevRaw);
      const prevBranches = (prevData.nodes || []).filter(n => n.type === 'branch');
      if (prevBranches.length > 0) {
        prevBranches.forEach(b => {
          if (!BRANCH_COLORS[b.id]) {
            BRANCH_COLORS[b.id] = deriveBranchPalette((BRANCH_COLORS[b.id] || {}).main || pickBranchColor());
          }
        });
        const newWeek = { nodes: prevBranches.map(b => ({ ...b, children: [] })) };
        if (prevData.baseline) newWeek.baseline = prevData.baseline;
        return newWeek;
      }
    } catch(e) {}
  }
  return defaultWeekData();
};

saveWeek = function(wk, data) {
  data.savedAt = Date.now();
  data.crdtVersion = (data.crdtVersion || 0) + 1;
  if (!Array.isArray(data.tombstones)) data.tombstones = [];
  localStorage.setItem('zenit-week-' + wk, JSON.stringify(data));
};

// Mock IDB functions to be no-ops or simple resolved promises to avoid ReferenceErrors
openDB = () => Promise.resolve(_dbMock);
loadWeekIDB = (wk) => Promise.resolve(null);
saveWeekIDB = (wk, data) => Promise.resolve();
deleteWeekIDB = (wk) => Promise.resolve();
listWeekKeysIDB = () => Promise.resolve([]);
loadValueIDB = (key) => Promise.resolve(null);
saveValueIDB = (key, val) => Promise.resolve();
deleteValueIDB = (key) => Promise.resolve();

_state.get       = function() { return weekData; };
_state.set       = function(v) { weekData = v; rebuildNodeMap(); };
_state.setWeekKey = function(k) { currentWeekKey = k; };
_state.reset     = function() { undoStack = []; redoStack = []; };
_state.setLang   = function(l) { currentLang = l; };
_state.setAutoLayout = function(v) { autoLayout = v; };
_state.setEditState = function(v, inputVal) {
  editState = v;
  if (inputVal !== undefined) inlineInput.value = inputVal;
};
_state.setLocalStorage = function(key, data) {
  _lsStore[key] = JSON.stringify(data);
};
_state.clearLocalStorage = function() {
  for (const k in _lsStore) delete _lsStore[k];
};
_state.setActiveDayFilter = function(v) { activeDayFilter = v; };
`;

vm.runInContext(scriptCode + stateAccessors, sandbox);

// Re-export the pure utility functions for use in tests
export const {
  getISOWeek,
  weeksInYear,
  offsetWeek,
  weekKey,
  parseWeekKey,
  genId,
  defaultWeekData,
  validateAndRepair,
  // Status-propagation functions
  addNode,
  startAddNode,
  cancelEdit,
  deleteNode,
  setStatus,
  syncStatusUp,
  findNode,
  rebuildNodeMap,
  isLeafActivity,
  getDescendantIds,
  // Day-child functions
  getDayFilterOpacity,
  parseTodoDays,
  stripDayGroups,
  commitEdit,
  migrateDayCounters,
  transferReusable,
  computeLayout,
  getNodeSize,
  // Agenda helpers
  isoWeekPos,
  sortDayChildren,
  getAgendaItems,
  getOverdueItems,
  getAnyDayItems,
  rescheduleNode,
  localDateStr,
  tabDateString,
  // Agenda group ordering
  loadAgendaGroupOrder,
  saveAgendaGroupOrder,
  applyAgendaOrder,
  _state,
} = sandbox;
