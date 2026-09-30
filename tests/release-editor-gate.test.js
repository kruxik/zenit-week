import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorPackages, outdatedEditorPackages } from '../scripts/release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('release editor gate', () => {
  it('covers every bundled ProseMirror package, pinned exactly', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const names = editorPackages(pkg);
    expect(names).toEqual([
      'prosemirror-commands', 'prosemirror-history', 'prosemirror-inputrules', 'prosemirror-keymap',
      'prosemirror-model', 'prosemirror-schema-list', 'prosemirror-state', 'prosemirror-transform',
      'prosemirror-view',
    ]);
    for (const name of names) expect(pkg.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('flags an editor package behind its latest release', () => {
    const json = {
      'prosemirror-state': { current: '1.4.3', wanted: '1.4.3', latest: '1.4.4' },
      'prosemirror-view': { current: '1.42.6', wanted: '1.42.6', latest: '1.42.6' },
      vitest: { current: '4.1.5', wanted: '4.1.5', latest: '5.0.0' },
    };
    expect(outdatedEditorPackages(json, ['prosemirror-state', 'prosemirror-view']))
      .toEqual(['prosemirror-state 1.4.3 → 1.4.4']);
  });

  it('reads npm\'s array form, one entry per dependent', () => {
    const json = { 'prosemirror-state': [
      { current: '1.4.3', wanted: '1.4.4', latest: '1.4.4', dependent: 'prosemirror-view' },
      { current: '1.4.3', wanted: '1.4.3', latest: '1.4.4', dependent: 'zenit-week' },
    ] };
    expect(outdatedEditorPackages(json, ['prosemirror-state'])).toEqual(['prosemirror-state 1.4.3 → 1.4.4']);
  });

  it('passes when nothing is outdated', () => {
    expect(outdatedEditorPackages({}, ['prosemirror-model'])).toEqual([]);
  });
});
