#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveLatest, parseSemver, compareSemver } = require('../bin/run');

let failed = 0;
function check(label, fn) {
  try { fn(); process.stdout.write('  ok ' + label + '\n'); }
  catch (e) { failed++; process.stdout.write('  FAIL ' + label + ' — ' + (e.message || e) + '\n'); }
}

process.stdout.write('statusline-plugin run/wrapper test\n');

// Build a tmp cache root with a layered structure mirroring the real
// ~/.claude/plugins/cache/<marketplace>/statusline-plugin/<version>/bin/statusline.js
function makeCache(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl9-cache-'));
  for (const [marketplace, versions] of Object.entries(layout)) {
    for (const [v, contents] of Object.entries(versions)) {
      const binDir = path.join(root, marketplace, 'statusline-plugin', v, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      if (contents !== null) {
        fs.writeFileSync(path.join(binDir, 'statusline.js'), contents);
      }
    }
  }
  return root;
}

check('parseSemver: extracts major.minor.patch', () => {
  assert.deepEqual(parseSemver('0.5.0'), [0, 5, 0]);
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseSemver('10.20.30'), [10, 20, 30]);
});

check('parseSemver: tolerates pre-release suffix', () => {
  assert.deepEqual(parseSemver('0.6.0-beta.1'), [0, 6, 0]);
});

check('parseSemver: rejects non-semver names', () => {
  assert.equal(parseSemver('latest'), null);
  assert.equal(parseSemver('0.5'), null);
  assert.equal(parseSemver(''), null);
});

check('compareSemver: numeric, not lexicographic (0.10.0 > 0.9.0)', () => {
  assert.ok(compareSemver([0, 10, 0], [0, 9, 0]) > 0);
  assert.ok(compareSemver([0, 9, 0], [0, 10, 0]) < 0);
  assert.equal(compareSemver([1, 2, 3], [1, 2, 3]), 0);
});

check('resolveLatest: returns null for non-existent cache root', () => {
  assert.equal(resolveLatest('/nonexistent/path/that/does/not/exist'), null);
});

check('resolveLatest: returns null for empty cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl9-empty-'));
  assert.equal(resolveLatest(root), null);
});

check('resolveLatest: returns null when no statusline-plugin in cache', () => {
  const root = makeCache({ 'mp1': {} });
  // mp1 directory exists but has no statusline-plugin folder
  fs.rmSync(path.join(root, 'mp1', 'statusline-plugin'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'mp1', 'other-plugin'), { recursive: true });
  assert.equal(resolveLatest(root), null);
});

check('resolveLatest: single version returns it', () => {
  const root = makeCache({ 'mp1': { '0.5.0': '// stub' } });
  const out = resolveLatest(root);
  assert.ok(out, 'expected a path');
  assert.ok(out.endsWith(path.join('mp1', 'statusline-plugin', '0.5.0', 'bin', 'statusline.js')));
});

check('resolveLatest: picks highest semver across versions', () => {
  const root = makeCache({ 'mp1': {
    '0.1.0': '// v1', '0.2.0': '// v2', '0.5.0': '// v3', '0.4.0': '// v4'
  }});
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('statusline-plugin', '0.5.0')));
});

check('resolveLatest: 0.10.0 beats 0.9.0 (numeric, not lexicographic)', () => {
  const root = makeCache({ 'mp1': {
    '0.9.0': '// nine', '0.10.0': '// ten', '0.2.0': '// two'
  }});
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('statusline-plugin', '0.10.0')),
    'expected 0.10.0, got: ' + out);
});

check('resolveLatest: highest version wins across multiple marketplaces', () => {
  const root = makeCache({
    'mp-old': { '0.3.0': '// old', '0.4.0': '// old4' },
    'mp-new': { '0.5.0': '// new', '0.6.0': '// new6' }
  });
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('mp-new', 'statusline-plugin', '0.6.0')),
    'expected mp-new/0.6.0, got: ' + out);
});

check('resolveLatest: skips version dirs without bin/statusline.js', () => {
  const root = makeCache({ 'mp1': {
    '0.4.0': '// good',
    '0.5.0': null  // dir created but no statusline.js
  }});
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('statusline-plugin', '0.4.0')),
    'expected fallback to 0.4.0, got: ' + out);
});

check('resolveLatest: ignores non-semver version dirs', () => {
  const root = makeCache({ 'mp1': {
    '0.4.0': '// real',
    '0.5.0': '// real'
  }});
  // Add a stray non-semver dir alongside
  fs.mkdirSync(path.join(root, 'mp1', 'statusline-plugin', 'latest', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mp1', 'statusline-plugin', 'latest', 'bin', 'statusline.js'), '// stray');
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('statusline-plugin', '0.5.0')));
});

check('resolveLatest: skips marketplaces missing the plugin folder', () => {
  const root = makeCache({
    'mp-empty': {},  // no plugin
    'mp-other': { '0.7.0': '// here' }
  });
  fs.rmSync(path.join(root, 'mp-empty', 'statusline-plugin'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'mp-empty'), { recursive: true });
  const out = resolveLatest(root);
  assert.ok(out.includes(path.join('mp-other', 'statusline-plugin', '0.7.0')));
});

// End-to-end: invoke bin/run with PATH unchanged but a tmp HOME so the
// wrapper resolves against our fixture cache, and confirm it execs the
// renderer and produces non-empty output.
check('bin/run end-to-end: execs resolved renderer with stdin', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sl9-home-'));
  const cacheVerDir = path.join(tmpHome, '.claude', 'plugins', 'cache', 'mp1', 'statusline-plugin', '0.9.9', 'bin');
  fs.mkdirSync(cacheVerDir, { recursive: true });
  // Use the real renderer from this checkout as the stub — proves the wrapper
  // hands stdin through and the renderer produces non-empty output.
  fs.copyFileSync(path.join(__dirname, '..', 'bin', 'statusline.js'), path.join(cacheVerDir, 'statusline.js'));

  const fixture = JSON.stringify({
    model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7' },
    workspace: { current_dir: tmpHome },
    cwd: tmpHome,
    session_id: 'abcd1234',
    cost: { total_cost_usd: 0 }
  });
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'run')], {
    input: fixture,
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, 'wrapper should exit 0; stderr: ' + result.stderr);
  assert.ok(result.stdout.includes('Opus 4.7'), 'expected renderer output, got: ' + JSON.stringify(result.stdout));
});

check('bin/run end-to-end: empty cache exits 0 with stderr hint', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sl9-home-empty-'));
  fs.mkdirSync(path.join(tmpHome, '.claude', 'plugins', 'cache'), { recursive: true });
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'run')], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  assert.ok(result.stderr.includes('no cached version'), 'expected stderr hint, got: ' + result.stderr);
  assert.equal(result.stdout, '');
});

if (failed > 0) {
  process.stderr.write('\n' + failed + ' test(s) failed\n');
  process.exit(1);
}
process.stdout.write('\nall passed\n');
