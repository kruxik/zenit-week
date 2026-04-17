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
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
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
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
    createElement: (tag) => {
      if (tag === 'canvas') {
        return { getContext: () => ({ measureText: () => ({ width: 0 }) }) };
      }
      return elementStub();
    },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { hash: '' },
  navigator: { userAgentData: null, userAgent: '' },
  setTimeout,
  clearTimeout,
};

vm.createContext(sandbox);
vm.runInContext(scriptCode, sandbox);

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
} = sandbox;
