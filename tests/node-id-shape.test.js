import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genId, defaultWeekData, validateAndRepair, migrateCrdt, isValidNodeId, nodeGroupEl } from './setup.js';

const BAD_IDS = ['a"]x', 'a b', 'x[y]', '', 'a'.repeat(65), '#a', 'a.b', 12, null];

function weekWith(extra) {
  const d = defaultWeekData();
  d.nodes.push(...extra);
  return d;
}

describe('isValidNodeId', () => {
  test('accepts genId output, center and default branch ids', () => {
    expect(isValidNodeId(genId())).toBe(true);
    ['center', 'work', 'family', 'me', 'my_branch-2'].forEach(id => expect(isValidNodeId(id)).toBe(true));
  });
  test('rejects selector-breaking and non-string ids', () => {
    BAD_IDS.forEach(id => expect(isValidNodeId(id)).toBe(false));
  });
});

describe('validateAndRepair node ids', () => {
  test('drops a node with a malicious id and its reference in the parent', () => {
    const evil = { id: 'a"]x', type: 'activity', label: 'evil', parent: 'work', children: [] };
    const d = weekWith([evil]);
    d.nodes.find(n => n.id === 'work').children.push('a"]x');
    const out = validateAndRepair(d);
    expect(out.nodes.some(n => n.id === 'a"]x')).toBe(false);
    expect(out.nodes.find(n => n.id === 'work').children).not.toContain('a"]x');
  });

  test('leaves valid ids and their tree untouched', () => {
    const ok = { id: 'n1abc', type: 'activity', label: 'ok', parent: 'work', children: [] };
    const d = weekWith([ok]);
    d.nodes.find(n => n.id === 'work').children.push('n1abc');
    const before = d.nodes.map(n => n.id).sort();
    const out = validateAndRepair(d);
    expect(out.nodes.map(n => n.id).sort()).toEqual(before);
    expect(out.nodes.find(n => n.id === 'work').children).toContain('n1abc');
  });

  test('descendants of a dropped node are garbage-collected, not left dangling', () => {
    const evil = { id: 'x"y', type: 'activity', label: 'evil', parent: 'work', children: ['n2'] };
    const kid = { id: 'n2', type: 'activity', label: 'kid', parent: 'x"y', children: [] };
    const d = weekWith([evil, kid]);
    d.nodes.find(n => n.id === 'work').children.push('x"y');
    const out = validateAndRepair(d);
    expect(out.nodes.some(n => n.id === 'n2')).toBe(false);
  });
});

describe('migrateCrdt node ids', () => {
  test('filters malformed nodes and tombstones from remote data', () => {
    const data = {
      nodes: [{ id: 'ok1', type: 'activity' }, { id: 'a"]', type: 'activity' }, { id: 5 }],
      tombstones: ['gone1', 'b"]', 7],
    };
    const out = migrateCrdt(data);
    expect(out.nodes.map(n => n.id)).toEqual(['ok1']);
    expect(out.tombstones).toEqual(['gone1']);
  });
});

describe('selector sites', () => {
  test('nodeGroupEl does not throw on a selector-breaking id', () => {
    expect(() => nodeGroupEl('a"]x')).not.toThrow();
  });

  test('no templated selector embeds an unescaped node or branch id', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../zenit-week.html'), 'utf8');
    const bad = html.split('\n').filter(l =>
      /querySelector(All)?\(`/.test(l) && /data-id="\$\{(?!CSS)|#grad-\$\{|\[data-branch-dot="\$\{(?!CSS)/.test(l));
    expect(bad).toEqual([]);
  });
});
