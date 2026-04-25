#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { render, RENDERERS, DEFAULT_CONFIG, usageScalar } = require('../bin/statusline.js');

// Mirrors the real Claude Code stdin payload:
// `context_window.current_usage` is an object, not a scalar.
const FIXTURE = {
  model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7' },
  workspace: { current_dir: process.cwd() },
  cwd: process.cwd(),
  session_id: 'abcdef1234567890',
  transcript_path: '/tmp/transcript.jsonl',
  version: '1.2.3',
  output_style: { name: 'default' },
  cost: { total_cost_usd: 0.4234, total_duration_ms: 12345 },
  context_window: {
    total_input_tokens: 50000,
    total_output_tokens: 2000,
    context_window_size: 200000,
    used_percentage: 18.4,
    remaining_percentage: 81.6,
    current_usage: {
      input_tokens: 36800,
      output_tokens: 1200,
      cache_read_input_tokens: 50000,
      cache_creation_input_tokens: 0
    }
  }
};

let failed = 0;
function check(label, fn) {
  try {
    fn();
    process.stdout.write('  ok ' + label + '\n');
  } catch (e) {
    failed++;
    process.stdout.write('  FAIL ' + label + ' — ' + (e.message || e) + '\n');
  }
}

process.stdout.write('statusline-plugin smoke test\n');

check('default config renders non-empty', () => {
  const out = render(FIXTURE, DEFAULT_CONFIG);
  assert.ok(out.length > 0, 'expected non-empty output');
});

check('default config includes model display name', () => {
  const out = render(FIXTURE, DEFAULT_CONFIG);
  assert.ok(out.includes('Opus 4.7'), 'expected "Opus 4.7" in output, got: ' + out);
});

check('default config includes cost', () => {
  const out = render(FIXTURE, DEFAULT_CONFIG);
  assert.ok(out.includes('$0.42'), 'expected "$0.42" in output, got: ' + out);
});

check('default config includes context percent', () => {
  const out = render(FIXTURE, DEFAULT_CONFIG);
  assert.ok(out.includes('18%') || out.includes('ctx 18'), 'expected ctx percent, got: ' + out);
});

check('context absolute_percent renders absolute and percent', () => {
  const out = render(FIXTURE, { separator: '', segments: [{ type: 'context', format: 'absolute_percent' }] });
  assert.equal(out, '36800/200000 (18%)');
});

check('context absolute_percent gracefully omits percent when missing', () => {
  const out = render(
    { context_window: { current_usage: 100, context_window_size: 1000 } },
    { separator: '', segments: [{ type: 'context', format: 'absolute_percent' }] }
  );
  assert.equal(out, '100/1000');
});

check('usageScalar: scalar number passes through', () => {
  assert.equal(usageScalar(36800), 36800);
});

check('usageScalar: object with input_tokens uses that field', () => {
  assert.equal(usageScalar({ input_tokens: 36800, output_tokens: 1200 }), 36800);
});

check('usageScalar: object without input_tokens sums numeric fields', () => {
  assert.equal(usageScalar({ a: 100, b: 200, c: 'x' }), 300);
});

check('usageScalar: null/undefined return null', () => {
  assert.equal(usageScalar(null), null);
  assert.equal(usageScalar(undefined), null);
});

check('regression: object current_usage no longer renders [object Object]', () => {
  const ctx = { context_window: { current_usage: { input_tokens: 130000, output_tokens: 500 }, context_window_size: 1000000, used_percentage: 13 } };
  const out = render(ctx, { separator: '', segments: [{ type: 'context', format: 'absolute_percent' }] });
  assert.equal(out, '130000/1000000 (13%)');
  assert.ok(!out.includes('[object Object]'));
});

check('context absolute (existing) still works', () => {
  const out = render(FIXTURE, { separator: '', segments: [{ type: 'context', format: 'absolute' }] });
  assert.equal(out, '36800/200000');
});

check('text segment renders literal value', () => {
  const out = render({}, { separator: '', segments: [{ type: 'text', value: 'hello' }] });
  assert.ok(out.includes('hello'));
});

check('cwd basename mode', () => {
  const out = render(FIXTURE, { separator: '', segments: [{ type: 'cwd', format: 'basename' }] });
  assert.equal(out, path.basename(process.cwd()));
});

check('cwd maxLen truncates from the left', () => {
  const out = render(
    { workspace: { current_dir: '/very/long/path/that/should/be/truncated' } },
    { separator: '', segments: [{ type: 'cwd', format: 'full', maxLen: 10 }] }
  );
  assert.equal(out.length, 10);
  assert.ok(out.startsWith('…'));
});

check('unknown segment type renders empty', () => {
  const out = render(FIXTURE, { separator: '|', segments: [
    { type: 'model' }, { type: 'no_such_type' }, { type: 'session' }
  ]});
  assert.ok(!out.includes('|||'), 'unknown segment should be filtered out');
});

check('hideWhenEmpty drops empty segments', () => {
  const out = render({}, { separator: '|', segments: [
    { type: 'cost' }, { type: 'text', value: 'kept' }
  ]});
  assert.equal(out, 'kept');
});

check('separator joins multiple segments', () => {
  const out = render(FIXTURE, { separator: ' :: ', segments: [
    { type: 'text', value: 'a' }, { type: 'text', value: 'b' }, { type: 'text', value: 'c' }
  ]});
  assert.equal(out, 'a :: b :: c');
});

check('color wraps in ANSI escape', () => {
  const out = render({}, { separator: '', segments: [{ type: 'text', value: 'x', color: 'red' }] });
  assert.ok(out.includes('\x1b[31m') && out.includes('\x1b[0m'));
});

check('renderer set covers schema types', () => {
  const expected = ['text','model','cwd','git_branch','time','tokens','context','cost','session','output_style','version','agent'];
  for (const t of expected) {
    assert.ok(typeof RENDERERS[t] === 'function', 'missing renderer: ' + t);
  }
});

if (failed > 0) {
  process.stderr.write('\n' + failed + ' test(s) failed\n');
  process.exit(1);
}
process.stdout.write('\nall passed\n');
