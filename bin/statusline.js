#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const CONFIG_DIR = path.join(os.homedir(), '.claude', 'statusline-plugin');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  $schema: 'https://raw.githubusercontent.com/earchibald/statusline-plugin/main/schema/config.schema.json',
  separator: ' | ',
  segments: [
    { type: 'model', format: 'name', color: 'cyan', bold: true },
    { type: 'cwd', format: 'tilde', color: 'blue' },
    { type: 'git_branch', color: 'magenta', prefix: '⎇ ', dirtySuffix: '*' },
    { type: 'context', format: 'percent', color: 'yellow', prefix: 'ctx ' },
    { type: 'cost', unit: 'session', color: 'gray' }
  ]
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m'
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
      return DEFAULT_CONFIG;
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return DEFAULT_CONFIG;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('{}');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data || '{}'));
    setTimeout(() => resolve(data || '{}'), 250);
  });
}

function safe(fn, fallback) {
  try { const v = fn(); return v == null ? fallback : v; } catch { return fallback; }
}

let _gitCache = null;
function gitInfo(cwd) {
  if (_gitCache && _gitCache.cwd === cwd) return _gitCache.value;
  let value = null;
  try {
    const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 250 };
    const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
    let dirty = false;
    try {
      const status = execSync('git status --porcelain', opts).trim();
      dirty = status.length > 0;
    } catch {}
    value = { branch, dirty };
  } catch {}
  _gitCache = { cwd, value };
  return value;
}

const RENDERERS = {
  text: (seg) => seg.value || '',

  model: (seg, ctx) => {
    const m = ctx.model || {};
    if (seg.format === 'id') return m.id || '';
    return m.display_name || m.id || '';
  },

  cwd: (seg, ctx) => {
    const dir = (ctx.workspace && ctx.workspace.current_dir) || ctx.cwd || process.cwd();
    let out;
    if (seg.format === 'basename') out = path.basename(dir);
    else if (seg.format === 'full') out = dir;
    else out = dir.replace(os.homedir(), '~');
    if (seg.maxLen && out.length > seg.maxLen) {
      out = '…' + out.slice(-(seg.maxLen - 1));
    }
    return out;
  },

  git_branch: (seg, ctx) => {
    const dir = (ctx.workspace && ctx.workspace.current_dir) || ctx.cwd || process.cwd();
    const info = gitInfo(dir);
    if (!info) return '';
    const suffix = info.dirty ? (seg.dirtySuffix == null ? '*' : seg.dirtySuffix) : '';
    return info.branch + suffix;
  },

  time: (seg) => {
    const d = new Date();
    if (seg.format === 'iso') return d.toISOString();
    if (seg.format === 'HH:mm:ss') return d.toTimeString().slice(0, 8);
    return d.toTimeString().slice(0, 5);
  },

  tokens: (seg, ctx) => {
    const cw = ctx.context_window || {};
    if (seg.which === 'input') return String(cw.total_input_tokens || 0);
    if (seg.which === 'output') return String(cw.total_output_tokens || 0);
    return String((cw.total_input_tokens || 0) + (cw.total_output_tokens || 0));
  },

  context: (seg, ctx) => {
    const cw = ctx.context_window || {};
    const used = cw.current_usage;
    const total = cw.context_window_size;
    const pct = cw.used_percentage;
    if (seg.format === 'percent') {
      if (pct == null) return '';
      return Math.round(pct) + '%';
    }
    if (seg.format === 'remaining_percent') {
      if (cw.remaining_percentage == null) return '';
      return Math.round(cw.remaining_percentage) + '%';
    }
    if (seg.format === 'absolute_percent') {
      if (used == null) return '';
      const tail = pct == null ? '' : ' (' + Math.round(pct) + '%)';
      return used + '/' + (total || 0) + tail;
    }
    if (used == null) return '';
    return used + '/' + (total || 0);
  },

  cost: (seg, ctx) => {
    const c = ctx.cost || {};
    if (c.total_cost_usd == null) return '';
    return '$' + Number(c.total_cost_usd).toFixed(2);
  },

  session: (seg, ctx) => (ctx.session_id || '').slice(0, 8),

  output_style: (_seg, ctx) => (ctx.output_style && ctx.output_style.name) || '',

  version: (_seg, ctx) => ctx.version || '',

  agent: (_seg, ctx) => (ctx.agent && (ctx.agent.name || ctx.agent.id)) || ''
};

function colorize(text, seg) {
  if (!text) return '';
  let prefix = '';
  if (seg.bold) prefix += ANSI.bold;
  if (seg.dim) prefix += ANSI.dim;
  if (seg.italic) prefix += ANSI.italic;
  if (seg.color && ANSI[seg.color]) prefix += ANSI[seg.color];
  return prefix ? prefix + text + ANSI.reset : text;
}

function renderSegment(seg, ctx) {
  const renderer = RENDERERS[seg.type];
  if (!renderer) return '';
  const value = safe(() => renderer(seg, ctx), '');
  if (!value && (seg.hideWhenEmpty == null ? true : seg.hideWhenEmpty)) return '';
  const wrapped = (seg.prefix || '') + value + (seg.suffix || '');
  return colorize(wrapped, seg);
}

function render(ctx, cfg) {
  const sep = cfg.separator == null ? ' | ' : cfg.separator;
  return (cfg.segments || [])
    .map((s) => renderSegment(s, ctx))
    .filter(Boolean)
    .join(sep);
}

async function main() {
  try {
    const raw = await readStdin();
    const ctx = safe(() => JSON.parse(raw), {});
    const cfg = loadConfig();
    process.stdout.write(render(ctx, cfg));
  } catch (e) {
    process.stdout.write('statusline-plugin: ' + (e && e.message ? e.message : 'render error'));
  }
}

if (require.main === module) {
  main();
}

module.exports = { render, RENDERERS, DEFAULT_CONFIG, colorize, ANSI };
