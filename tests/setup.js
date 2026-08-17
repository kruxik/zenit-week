import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';

const __dirname = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(resolve(__dirname, '../zenit-week.html'), 'utf8');

// Extract the main app <script id="app-script">…</script> block
const match = html.match(/<script\s+id="app-script">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Could not extract <script id="app-script"> block from zenit-week.html');
const scriptCode = match[1];

// Reusable stub for DOM elements returned by getElementById / createElement
function elementStub() {
  const classes = new Set();
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        // Honor the optional force argument like the real DOMTokenList.
        const add = force === undefined ? !classes.has(c) : !!force;
        if (add) classes.add(c);
        else classes.delete(c);
        return add;
      }
    },
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
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  // netFetch() attaches AbortSignal.timeout() to every request; exposing the
  // real thing keeps the timed path under test rather than the fallback.
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  fetch: (url, options) => {
    const finalUrl = (typeof url === 'string' && url.startsWith('/'))
      ? `http://localhost${url}`
      : url;
    return globalThis.fetch(finalUrl, options);
  },
  console,
  CustomEvent: class {
    constructor(type) { this.type = type; }
  },
  window: {
    addEventListener: () => {},
    dispatchEvent: () => {},
    location: { origin: 'http://localhost', pathname: '/' },
    fetch: null, // populated below
    innerWidth: 1280,
    innerHeight: 768,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
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
    documentElement: { ...elementStub(), dataset: { theme: 'light' } },
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
  // Date getter — re-reads host global on each access so withFrozenDate()
  // overrides propagate into the VM sandbox.
  get Date() { return globalThis.Date; },
  indexedDB: fakeIndexedDB,
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
sandbox.window.fetch = sandbox.fetch;

vm.createContext(sandbox);

// Append state accessors so tests can read/write let-scoped app variables
const stateAccessors = `
const _origExchangeToken = exchangeToken;
exchangeToken = async function(params) {
  return _origExchangeToken(params);
};

const _origSilentRefresh = silentRefresh;
silentRefresh = async function(token) {
  return _origSilentRefresh(token);
};

const _origSyncWeekFromDrive = syncWeekFromDrive;
syncWeekFromDrive = async function(...args) {
  return _origSyncWeekFromDrive(...args);
};

const _origSyncWeekToDrive = syncWeekToDrive;
syncWeekToDrive = async function(...args) {
  return _origSyncWeekToDrive(...args);
};

const _origPollDriveMeta = pollDriveMeta;
pollDriveMeta = async function(...args) {
  return _origPollDriveMeta(...args);
};

const _origMergeWeekData = mergeWeekData;
mergeWeekData = function(l, r) {
  return _origMergeWeekData(l, r);
};

const _origApplyRemoteMerge = applyRemoteMerge;
applyRemoteMerge = function(w, d, j, h, s, r) {
  return _origApplyRemoteMerge(w, d, j, h, s, r);
};

// Mock IDB functions by default to keep existing tests synchronous and stable.
// Opt out with _state.useRealIDB(true) — required for anything testing the
// async read-modify-write behaviour of week records, since the synchronous
// localStorage stand-ins below make those look atomic.
//
// The _real* captures MUST come before any override: capturing them afterwards
// meant useRealIDB(true) restored the IDB primitives but left loadWeek/saveWeek
// pointing at the localStorage stand-ins, so "real IDB" tests still wrote to
// localStorage. The overrides are applied by the updateIDBMethods() call below.
let _useMockIDB = true;

const _realOpenDB = openDB;
const _realLoadWeekIDB = loadWeekIDB;
const _realSaveWeekIDB = saveWeekIDB;
const _realDeleteWeekIDB = deleteWeekIDB;
const _realListWeekKeysIDB = listWeekKeysIDB;
const _realLoadValueIDB = loadValueIDB;
const _realSaveValueIDB = saveValueIDB;
const _realDeleteValueIDB = deleteValueIDB;

const _realLoadWeek = loadWeek;
const _realSaveWeek = saveWeek;

function updateIDBMethods() {
  if (_useMockIDB) {
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
  } else {
    openDB = _realOpenDB;
    loadWeekIDB = _realLoadWeekIDB;
    saveWeekIDB = _realSaveWeekIDB;
    deleteWeekIDB = _realDeleteWeekIDB;
    listWeekKeysIDB = _realListWeekKeysIDB;
    loadValueIDB = _realLoadValueIDB;
    saveValueIDB = _realSaveValueIDB;
    deleteValueIDB = _realDeleteValueIDB;
    loadWeek = _realLoadWeek;
    saveWeek = _realSaveWeek;
  }
}

updateIDBMethods();

// UI/DOM Stubs to prevent crashes in VM
render = () => {};
applyAutoLayout = () => {};
updateColorDots = () => {};
updateSvgFilters = () => {};
// syncBranchConfig is pure data (reads node.side → BRANCH_CONFIG, backfills side);
// kept real so tests exercise branch-side propagation through merges.
updateThemeColor = () => {};
scheduleColorsSync = () => {};
isAtomicOpActive = () => false;
stopDrivePoll = () => {};
startDrivePoll = () => {};
startDriveSession = () => {};
onTokensReceived = async (token) => {
  googleAccessToken = token;
  _tokenReceivedAt = Date.now();
  _cancelRefreshRetry();   // mirrors the real one — a token ends the retry loop
};
forcePushAllToDrive = () => {};
initDriveSync = () => Promise.resolve();
scheduleDriveSync = () => {};
todayWeekKey = () => _todayWeekKeyOverride || currentWeekKey;
let _todayWeekKeyOverride = null;

// Network guards — the constants are top-level \`const\`s, which live in the
// context's lexical scope rather than on the global object, so they need an
// accessor like the module-level \`let\`s below.
_state.getNetTimeouts = function() {
  return { NET_TIMEOUT_MS, NET_PROBE_TIMEOUT_MS, PROBE_MIN_INTERVAL_MS };
};
_state.getLastProbeAt = function() { return _lastProbeAt; };
_state.setLastProbeAt = function(v) { _lastProbeAt = v; };

_state.get       = function() { return weekData; };
_state.set       = function(v) { weekData = v; rebuildNodeMap(); };
_state.setWeekKey = function(k) { currentWeekKey = k; };
_state.getWeekKey = function() { return currentWeekKey; };
_state.reset     = function() { undoStack = []; redoStack = []; };
_state.getUndoStack = function() { return undoStack; };
_state.getNextWeekRawCache = function() { return _nextWeekRawCache; };
_state.setNextWeekRawCache = function(v) { _nextWeekRawCache = v; };
_state.refreshNextWeekCache = function() { return refreshNextWeekCache(); };
_state.moveNodeToNextWeek = function(id) { return moveNodeToNextWeek(id); };
_state.withWeekLock = function(wk, fn) { return withWeekLock(wk, fn); };
_state.loadAndRender = function(wk) { return loadAndRender(wk); };
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
_state.getCurrentView = function() { return currentView; };
_state.setCurrentView = function(v) { currentView = v; };
_state.setWindowInnerWidth = function(v) { window.innerWidth = v; };
_state.triggerKeydown = function(e) { _windowKeydownHandler(e); };
_state.getElement = function(id) { return document.getElementById(id); };
_state.setActiveDayFilter = function(v) { activeDayFilter = v; };
_state.setViewLevel = function(v) { currentViewLevel = v; };
_state.getViewLevel = function() { return currentViewLevel; };
_state.getZoom = function() { return zoom; };
_state.setZoom = function(v) { zoom = v; };
_state.getPan = function() { return { x: panX, y: panY }; };
_state.setPan = function(x, y) { panX = x; panY = y; };
_state.getZoomBounds = function() { return { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT }; };
_state.getActiveDayFilter = function() { return activeDayFilter; };
_state.setAgendaActiveTab = function(v) { agendaActiveTab = v; };
_state.getAgendaActiveTab = function() { return agendaActiveTab; };
_state.setTodayWeekKey   = function(k) { _todayWeekKeyOverride = k; };
_state.setLastKnownDate = function(day, wk) { _lastKnownDay = day; _lastKnownWeekKey = wk; };
_state.getLastKnownDate = function() { return { day: _lastKnownDay, weekKey: _lastKnownWeekKey }; };
_state.clearTodayWeekKeyOverride = function() { _todayWeekKeyOverride = null; };
_state.resetView         = async function() { return resetView(); };
_state.getIDBStore = function() { return _idbStore; };
_state.clearIDBStore = function() { for (const k in _idbStore) delete _idbStore[k]; };
_state.getBranchConfig = function() { return BRANCH_CONFIG; };
_state.getBranchColors = function() { return BRANCH_COLORS; };
// Signed-in identity for the root node's derived name. Both '' = signed out.
_state.setGoogleUser = function(displayName, email, photoLink) {
  googleUserName  = displayName || '';
  googleUserEmail = email || '';
  googleUserPhoto = photoLink || '';
  // Mirrors showSignedInAvatar, so the initials tiers behave as they do live.
  googleUserInitials = (displayName || email) ? getInitials(displayName || email) : '';
};
_state.resetSyncState = function() {
  googleAccessToken = null;
  _driveSessionStarted = false;
  driveFileIdCache.clear();
  lastSyncedHash.clear();
  lastSeenRemoteHash.clear();
  etagCache.clear();
  colorsSyncedHash = null;
  lastSeenRemoteColorsHash = null;
  _changesPageToken = null;
  _undoRedoForcePush = new Set();
  _remoteOriginIds.clear();
  clearAllSyncDebounceTimers();
  if (tokenRenewalTimer) { clearInterval(tokenRenewalTimer); tokenRenewalTimer = null; }
  _cancelRefreshRetry();
  syncStatus = 'disconnected';
};
_state.getSyncStatus = function() { return syncStatus; };
_state.hasRefreshRetryPending = function() { return _refreshRetryTimer !== null; };
_state.getUndoRedoForcePush = function() { return _undoRedoForcePush; };
_state.recordRemoteArrivals = function(wk, local, merged) { _recordRemoteArrivals(wk, local, merged); };
_state.getRemoteOriginIds = function(wk) { return _remoteOriginIds.get(wk) || null; };
_state.clearRemoteOriginIds = function() { _remoteOriginIds.clear(); };
_state.isImportPending = function() { return isImportPending(); };
_state.flushAllPendingSyncToDrive = function() { return flushAllPendingSyncToDrive(); };
_state.getSyncDebounceTimerKeys = function() { return [...syncDebounceTimers.keys()]; };
_state.setSyncDebounceTimer = function(wk) {
  syncDebounceTimers.set(wk, setTimeout(() => {}, 60000));
};
// Run fn with a signed-in token and syncWeekToDrive/syncColorsToDrive replaced
// by recorders, so teardown-flush tests can assert which weeks were pushed.
_state.withStubbedUploads = async function(collector, fn) {
  const prevToken = googleAccessToken;
  const prevWeek = syncWeekToDrive;
  const prevColors = syncColorsToDrive;
  googleAccessToken = 'test-token';
  syncWeekToDrive = async (wk) => { collector.push(wk); };
  syncColorsToDrive = async () => {};
  try { return await fn(); }
  finally {
    googleAccessToken = prevToken;
    syncWeekToDrive = prevWeek;
    syncColorsToDrive = prevColors;
  }
};
_state.setUndoRedoForcePush = function(v) {
  _undoRedoForcePush = (v == null) ? new Set() : (v instanceof Set ? v : new Set([v]));
};
_state.getAccessToken = () => googleAccessToken;
_state.setAccessToken = (t) => { googleAccessToken = t; };
_state.takeSnapshot = function() { return takeSnapshot(); };
_state.handleResetTokenMismatch = function(tok) { return _handleResetTokenMismatch(tok); };
_state.getDriveFileMissKeys = function() { return [..._driveFileMissSince.keys()]; };
_state.useRealIDB = function(v) {
  _useMockIDB = !v;
  _db = null;
  _dbPromise = null;
  updateIDBMethods();
};
_state.resetIDB = function() {
  _db = null;
  _dbPromise = null;
};
_state.saveWeekIDB = function(wk, data) {
  _idbStore['week-' + wk] = data;
  return Promise.resolve();
};
_state.loadWeekIDB = function(wk) {
  return Promise.resolve(_idbStore['week-' + wk] ?? null);
};
_state.saveValueIDB = function(key, val) {
  _idbStore['val-' + key] = val;
  return Promise.resolve();
};
_state.loadValueIDB = function(key) {
  return Promise.resolve(_idbStore['val-' + key] ?? null);
};
_state.setDriveFileId = function(wk, id) {
  driveFileIdCache.set(wk, id);
};
_state.setLastSyncedHash = function(wk, hash) {
  lastSyncedHash.set(wk, hash);
};
// Viewport vars are module-level \`let\`s; tests that convert client → world
// coordinates need to pin them (zoom defaults to 0.6).
_state.setViewport = function({ panX: px = 0, panY: py = 0, zoom: z = 1 } = {}) {
  panX = px; panY = py; zoom = z;
};
// dragState is a module-level \`let\`, so it is invisible on the sandbox object.
// Expose a setter so drag/drop tests can stage a drag without real pointer events.
_state.setDragState = function(patch) {
  dragState = {
    activeNodeId: null,
    startX: 0, startY: 0,
    rectLeft: 0, rectTop: 0,
    cursorStartWorldX: 0, cursorStartWorldY: 0,
    initialPositions: {},
    layoutPositions: {},
    descendantSet: new Set(),
    ...patch,
  };
};

// Initialize app state
currentLang = 'en';
currentWeekKey = '2026-01';
weekData = defaultWeekData();
rebuildNodeMap();
`;

vm.runInContext(scriptCode + stateAccessors, sandbox);

sandbox._state.sandbox = sandbox;

// Re-export the pure utility functions for use in tests
export const openDB = (...args) => sandbox.openDB(...args);
export const loadWeekIDB = (...args) => sandbox.loadWeekIDB(...args);
export const saveWeekIDB = (...args) => sandbox.saveWeekIDB(...args);
export const deleteWeekIDB = (...args) => sandbox.deleteWeekIDB(...args);
export const listWeekKeysIDB = (...args) => sandbox.listWeekKeysIDB(...args);
export const loadValueIDB = (...args) => sandbox.loadValueIDB(...args);
export const saveValueIDB = (...args) => sandbox.saveValueIDB(...args);
export const deleteValueIDB = (...args) => sandbox.deleteValueIDB(...args);
export const loadWeek = (...args) => sandbox.loadWeek(...args);
export const saveWeek = (...args) => sandbox.saveWeek(...args);
export const runMigrationIfNeeded = (...args) => sandbox.runMigrationIfNeeded(...args);
export const checkDateRollover = (...args) => sandbox.checkDateRollover(...args);

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
  startAddNode,
  cancelEdit,
  deleteNode,
  setStatus,
  syncStatusUp,
  findNode,
  rebuildNodeMap,
  isLeafActivity,
  getCounterChild,
  getTickInfo,
  createTickChild,
  sortTickChildren,
  setTickDay,
  getScheduledTickRows,
  getPriorityScale,
  getPriorityWeight,
  getDescendantIds,
  // Day-child functions
  dayFilterMatches,
  dayFilterMatchSet,
  parseTodoDays,
  stripDayGroups,
  localizeDayGroups,
  nodeDisplayLabel,
  dayAbbr,
  resolveMagicDayTokens,
  magicTokenResolvesToNextWeek,
  hasNowToken,
  pinToTopOfAgenda,
  restoreToAgendaOrder,
  agendaRowsForNode,
  setActivityDays,
  commitEdit,
  applyMagicLabel,
  migrateDayCounters,
  transferReusable,
  computeLayout,
  getNodeSize,
  updateCounter,
  addBranch,
  deleteBranch,
  applyBranchColor,
  updateSummary,
  computeWeekStats,
  _weekCompletion,
  openStatsPanel,
  closeStatsPanel,
  applyTranslations,
  // Agenda helpers
  isoWeekPos,
  sortDayChildren,
  getAgendaAncestorChain,
  getAgendaNodeLabel,
  getAgendaItems,
  getOverdueItems,
  getAnyDayItems,
  computeDayReschedule,
  localDateStr,
  tabDateString,
  // Agenda group ordering
  loadAgendaGroupOrder,
  saveAgendaGroupOrder,
  applyAgendaOrder,
  // CRDT & Sync
  mergeWeekData,
  migrateCrdt,
  withWeekLock,
  // Multi-tab (Option B) — local sync peer
  _weekContentSig,
  hasEditingNode,
  applyRemoteMerge,
  // Drag & drop
  handleNodeDrop,
  // Transfers
  transferUnfinished,
  moveNodeToNextWeek,
  // History
  takeSnapshot,
  undo,
  redo,
  // Node comments
  planCommentWrite,
  // UI & Action Logic
  showContextMenu,
  hideContextMenu,
  applyTheme,
  getThemeColors,
  deriveBranchPalette,
  t,
  // Center node + week bar
  firstNameFrom,
  centerDisplayName,
  centerNodeText,
  canShowAvatarPhoto,
  formatWeekParts,
  formatWeekLabel,
  roundedRectPathD,
  // Storage
  fnv1a32,
  weekContentHash,
  colorsContentHash,
  sanitizeColorsData,
  loadBranchColors,
  saveBranchColors,
  bootstrapColorsSettings,
  // Color picker
  hexToHsv,
  hsvToHex,
  // View switching
  switchView,
  // Edge drawing
  taperedPathD,
  // Zoom
  zoomAt,
  recomputeZoomBounds,
  // Import
  normalizeImportKey,
  // Network guards
  netFetch,
  isDefinitelyOffline,
  requestAssetUpdateCheck,
  checkForAssetUpdate,
  requestPersistentStorage,
  // Quiet Refresh
  parseAssetVersionHeaders,
  buildRestorePayload,
  validateRestorePayload,
  isAppQuiescent,
  // Google Drive Sync
  attemptSilentRestore,
  authFetch,
  driveApiRequest,
  syncWeekFromDrive,
  syncWeekToDrive,
  syncColorsFromDrive,
  pollDriveMeta,
  pollDriveChanges,
  silentRefresh,
  exchangeToken,
  purgeLegacyRefreshToken,
  _state,
} = sandbox;

export const BRANCH_CONFIG = sandbox._state.getBranchConfig();
export const BRANCH_COLORS = sandbox._state.getBranchColors();
