import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(resolve(__dirname, '../week-planner.html'), 'utf8');

// Extract the first <script>…</script> block (the app logic)
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('Could not extract <script> block from week-planner.html');
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
    getElementById: () => elementStub(),
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
