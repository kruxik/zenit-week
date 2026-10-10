// No em dash (U+2014) anywhere in the repository: UI text, pages, docs, code,
// comments, tests. Use a plain hyphen ("-") instead. The only exception is the
// built third-party editor bundle (vendor/editor.<hash>.js), which is generated
// by `npm run editor:build` and never edited by hand. Release notes are covered
// separately: cliff.toml rewrites the character in commit messages.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Written as an escape so this file does not contain the character itself.
const EM_DASH = '\u2014';
const EXEMPT = /^vendor\/editor\.[0-9a-f]+\.js$/;

// Tracked files plus new ones not yet added, so a fresh file is caught too.
function repoTextFiles() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter(f => f && !EXEMPT.test(f));
  return files.flatMap(f => {
    let buf;
    try { buf = readFileSync(resolve(REPO, f)); } catch { return []; } // deleted, not yet staged
    if (buf.includes(0)) return []; // binary
    return [[f, buf.toString('utf8')]];
  });
}

describe('no em dash', () => {
  it('appears in no file of the repository', () => {
    const hits = [];
    for (const [file, text] of repoTextFiles()) {
      text.split('\n').forEach((line, i) => {
        if (line.includes(EM_DASH)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
