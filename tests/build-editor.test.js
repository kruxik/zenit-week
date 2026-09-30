import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  BUNDLE_FILE_REGEX, GLOBAL_NAME, bundle, bundleFileName, sriHash, contentHash,
  checkLicenses, isLicenseAllowed, packageDirOf, buildNotices,
  applyEditorConstant, readEditorConstant,
  buildLicenseSection, applyLicenseSection, readLicenseSection, NOTICES_FILE,
} from '../scripts/build-editor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'zenit-week.html'), 'utf8');
const vendorFiles = readdirSync(resolve(root, 'vendor')).filter(f => BUNDLE_FILE_REGEX.test(f));
const bundleName = vendorFiles[0];
const bundleBytes = bundleName ? readFileSync(resolve(root, 'vendor', bundleName)) : Buffer.alloc(0);
const bundleText = bundleBytes.toString('utf8');

const EDITOR_PACKAGES = [
  'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform',
  'prosemirror-history', 'prosemirror-keymap', 'prosemirror-inputrules', 'prosemirror-commands',
  'prosemirror-schema-list', 'orderedmap', 'rope-sequence', 'w3c-keyname',
];

describe('committed editor bundle', () => {
  it('exactly one hashed bundle lives in vendor/', () => {
    // The build deletes the previous file; two would mean a stale leftover.
    expect(vendorFiles).toHaveLength(1);
  });

  it('file name hash matches the file content', () => {
    expect(bundleName).toBe(bundleFileName(bundleBytes));
    expect(bundleName).toBe(`editor.${contentHash(bundleBytes)}.js`);
  });

  it('page constant names the file with a matching SRI hash', () => {
    const constant = readEditorConstant(html);
    expect(constant.src).toBe(`/vendor/${bundleName}`);
    expect(constant.integrity).toBe(sriHash(bundleBytes));
  });

  it('is exactly what a fresh build of the installed packages produces', async () => {
    // Fails when a dependency bump or entry edit lands without `npm run editor:build`.
    const { bytes } = await bundle({ root });
    expect(bundleFileName(bytes)).toBe(bundleName);
  }, 30000);

  it('THIRD_PARTY_NOTICES.md lists exactly the packages the bundle is built from', async () => {
    // Fails when a dependency is added, dropped or relicensed without a rebuild.
    const { packages } = await bundle({ root });
    const notices = readFileSync(resolve(root, NOTICES_FILE), 'utf8');
    expect(readLicenseSection(notices)).toBe(buildLicenseSection(packages));
    for (const name of EDITOR_PACKAGES) expect(readLicenseSection(notices)).toContain(`- \`${name}\` (MIT)`);
    expect(notices).toContain('Copyright (c) 2020-2026 Paweł Kuna');
  }, 30000);

  it('LICENSE is the app\'s own MIT text alone, so GitHub detects it', () => {
    const license = readFileSync(resolve(root, 'LICENSE'), 'utf8');
    expect(license.startsWith('MIT License\n\nCopyright (c) 2026 Petr Burian\n')).toBe(true);
    expect(license.trimEnd().endsWith('SOFTWARE.')).toBe(true);
    expect(license.match(/Permission is hereby granted/g)).toHaveLength(1);
    expect(license).not.toMatch(/Tabler|ProseMirror|Third-Party/i);
  });

  it('carries the licence notice of every bundled package', () => {
    for (const name of EDITOR_PACKAGES) {
      const { version } = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
      expect(bundleText).toContain(`--- ${name}@${version} (MIT) ---`);
    }
    const grants = bundleText.match(/Permission is hereby granted, free of charge/g) || [];
    expect(grants.length).toBe(EDITOR_PACKAGES.length);
  });

  it('exposes every ProseMirror package as a namespace on the global', () => {
    const sandbox = {};
    vm.runInNewContext(bundleText, sandbox);
    const pm = sandbox[GLOBAL_NAME];
    expect(Object.keys(pm).sort()).toEqual([
      'commands', 'history', 'inputrules', 'keymap', 'model', 'schemaList', 'state', 'transform', 'view',
    ]);
    expect(typeof pm.model.Schema).toBe('function');
    expect(typeof pm.view.EditorView).toBe('function');
    expect(typeof pm.history.undo).toBe('function');
  });
});

describe('licence allow-list', () => {
  const pkg = (name, license) => ({ name, version: '1.0.0', license, licenseText: '' });

  it('rejects a GPL package and names it', () => {
    expect(() => checkLicenses([pkg('prosemirror-model', 'MIT'), pkg('fake-gpl', 'GPL-3.0')]))
      .toThrow(/fake-gpl@1\.0\.0 \(GPL-3\.0\)/);
  });

  it('rejects a package with no licence', () => {
    expect(() => checkLicenses([pkg('mystery', '')])).toThrow(/mystery/);
    expect(() => checkLicenses([pkg('mystery', undefined)])).toThrow(/no licence/);
  });

  it('accepts every allowed licence', () => {
    for (const l of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']) {
      expect(isLicenseAllowed(l)).toBe(true);
    }
  });

  it('evaluates SPDX OR / AND expressions', () => {
    expect(isLicenseAllowed('(MIT OR GPL-3.0)')).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-3.0')).toBe(false);
    expect(isLicenseAllowed('MIT AND ISC')).toBe(true);
    expect(isLicenseAllowed('LGPL-2.1')).toBe(false);
  });
});

describe('build helpers', () => {
  it('maps metafile inputs to package directories', () => {
    expect(packageDirOf('node_modules/prosemirror-model/dist/index.js')).toBe('node_modules/prosemirror-model');
    expect(packageDirOf('node_modules/@scope/pkg/lib/a.js')).toBe('node_modules/@scope/pkg');
    expect(packageDirOf('vendor/editor-entry.js')).toBe(null);
  });

  it('notice block cannot be closed early by licence text', () => {
    const notices = buildNotices([{ name: 'x', version: '1.0.0', license: 'MIT', licenseText: 'evil */ code()' }]);
    expect(notices.indexOf('*/')).toBe(notices.length - 3);
  });

  it('rewrites only the marked constant', () => {
    const page = "a\nconst X = /* editor-bundle:start */ { src: '', integrity: '' } /* editor-bundle:end */;\nb";
    const out = applyEditorConstant(page, { src: '/vendor/editor.0123456789abcdef.js', integrity: 'sha384-abc' });
    expect(out.startsWith('a\nconst X = ')).toBe(true);
    expect(out.endsWith(';\nb')).toBe(true);
    expect(readEditorConstant(out)).toEqual({ src: '/vendor/editor.0123456789abcdef.js', integrity: 'sha384-abc' });
  });

  it('fails loudly when the marker is missing', () => {
    expect(() => applyEditorConstant('no marker here', { src: 'x', integrity: 'y' })).toThrow(/marker not found/);
  });
});

describe('third-party notice section', () => {
  const pkgs = [
    { name: 'b-pkg', version: '1.0.0', license: 'MIT', licenseText: 'Copyright (c) 2020 B\n\nMIT terms here' },
    { name: 'a-pkg', version: '1.0.0', license: 'MIT', licenseText: 'Copyright (c) 2019 A\n\nMIT terms here' },
    { name: 'c-pkg', version: '1.0.0', license: 'ISC', licenseText: 'Copyright (c) 2021 C\n\nISC terms here' },
  ];

  it('keeps every copyright line and prints shared terms once', () => {
    const section = buildLicenseSection(pkgs);
    expect(section).toContain('- `b-pkg` (MIT) — Copyright (c) 2020 B');
    expect(section).toContain('- `a-pkg` (MIT) — Copyright (c) 2019 A');
    expect(section.match(/MIT terms here/g)).toHaveLength(1);
    expect(section).toContain('ISC terms here');
  });

  it('appends once, then replaces in place — idempotent', () => {
    const base = 'MIT License\n\nOwn terms\n';
    const once = applyLicenseSection(base, buildLicenseSection(pkgs));
    expect(once.startsWith(base.trimEnd())).toBe(true);
    expect(applyLicenseSection(once, buildLicenseSection(pkgs))).toBe(once);
    const fewer = applyLicenseSection(once, buildLicenseSection(pkgs.slice(0, 1)));
    expect(fewer).not.toContain('c-pkg');
    expect(fewer.startsWith(base.trimEnd())).toBe(true);
  });
});

describe('vendor cache header (vercel.json)', () => {
  it('serves /vendor/ as immutable for a year', () => {
    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
    const rule = vercel.headers.find(h => h.source === '/vendor/(.*)');
    expect(rule.headers).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
  });
});
