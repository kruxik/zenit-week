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
    title: '',
    ariaLabel: '',
    placeholder: '',
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
    querySelectorAll: (selector) => {
      const all = Object.values(sandbox._elCache || {});
      if (selector === '[data-i18n]') {
        return all.filter(el => el.dataset.i18n);
      }
      if (selector === '[data-i18n-title]') {
        return all.filter(el => el.dataset.i18nTitle);
      }
      return [];
    },
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
  CustomEvent: class {
    constructor(type) { this.type = type; }
  },
  window: { 
    addEventListener: () => {},
    dispatchEvent: () => {},
    location: { origin: '' },
  },
  BroadcastChannel: class {
    constructor() {}
    postMessage() {}
    close() {}
  },
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
      // Return a cached stub per ID so tests can verify side effects (like .style.display)
      if (!sandbox._elCache) sandbox._elCache = {};
      if (!sandbox._elCache[id]) sandbox._elCache[id] = elementStub();
      return sandbox._elCache[id];
    },
    querySelector: () => null,
    querySelectorAll: (selector) => {
      const all = Object.values(sandbox._elCache || {});
      if (selector === '[data-i18n]') {
        return all.filter(el => el.dataset.i18n);
      }
      if (selector === '[data-i18n-title]') {
        return all.filter(el => el.dataset.i18nTitle);
      }
      return [];
    },
    documentElement: { dataset: { theme: 'light' } },
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
    key(i)        { return Object.keys(sandbox._lsStore)[i] ?? null; },
    get length()  { return Object.keys(sandbox._lsStore).length; },
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
  _idbStore: {},
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
loadWeekIDB = (wk) => Promise.resolve(_idbStore['week-' + wk] ?? null);
saveWeekIDB = (wk, data) => {
  _idbStore['week-' + wk] = data;
  return Promise.resolve();
};
deleteWeekIDB = (wk) => {
  delete _idbStore['week-' + wk];
  return Promise.resolve();
};
listWeekKeysIDB = () => Promise.resolve(Object.keys(_idbStore).filter(k => k.startsWith('week-')).map(k => k.slice(5)));
loadValueIDB = (key) => Promise.resolve(_idbStore['val-' + key] ?? null);
saveValueIDB = (key, val) => {
  _idbStore['val-' + key] = val;
  return Promise.resolve();
};
deleteValueIDB = (key) => {
  delete _idbStore['val-' + key];
  return Promise.resolve();
};

// UI/DOM Stubs to prevent crashes in VM
render = () => {};
applyAutoLayout = () => {};
updateColorDots = () => {};
updateSvgFilters = () => {};
syncBranchConfig = () => {};
updateThemeColor = () => {};
scheduleColorsSync = () => {};
isAtomicOpActive = () => false;
stopDrivePoll = () => {};
startDrivePoll = () => {};
forcePushAllToDrive = () => {};
initDriveSync = () => Promise.resolve();
scheduleDriveSync = () => {};
todayWeekKey = () => currentWeekKey;

_state.get       = function() { return weekData; };
_state.set       = function(v) { weekData = v; rebuildNodeMap(); };
_state.setWeekKey = function(k) { currentWeekKey = k; };
_state.reset     = function() { undoStack = []; redoStack = []; };
_state.getUndoStack = function() { return undoStack; };
_state.setLang   = function(l) { 
  currentLang = l; 
  localStorage.setItem('zenit-week-lang', l);
};
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
_state.getLocalStorage = function(key) {
  return _lsStore[key];
};
_state.getDocument = function() { return document; };
_state.getElement = function(id) { return document.getElementById(id); };
_state.setActiveDayFilter = function(v) { activeDayFilter = v; };
_state.getIDBStore = function() { return _idbStore; };
_state.clearIDBStore = function() { for (const k in _idbStore) delete _idbStore[k]; };
_state.getBranchConfig = function() { return BRANCH_CONFIG; };
_state.getBranchColors = function() { return BRANCH_COLORS; };

// Initialize app state
currentLang = 'en';
currentWeekKey = '2026-01';
weekData = defaultWeekData();
rebuildNodeMap();
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
  getPriorityScale,
  getPriorityWeight,
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
  updateCounter,
  addBranch,
  deleteBranch,
  applyBranchColor,
  updateSummary,
  applyTranslations,
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
  // CRDT & Sync
  mergeWeekData,
  migrateCrdt,
  // Transfers
  transferUnfinished,
  moveNodeToNextWeek,
  // History
  takeSnapshot,
  undo,
  redo,
  // UI & Action Logic
  showContextMenu,
  hideContextMenu,
  applyTheme,
  getThemeColors,
  deriveBranchPalette,
  t,
  // Storage
  runMigrationIfNeeded,
  _state,
} = sandbox;

export const BRANCH_CONFIG = sandbox._state.getBranchConfig();
export const BRANCH_COLORS = sandbox._state.getBranchColors();
