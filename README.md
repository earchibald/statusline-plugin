# statusline-plugin

A Claude Code plugin that lets you configure your statusline **from inside Claude** — schema-driven, zero dependencies, no external `npx` runtime.

Loosely inspired by [`ccstatusline`](https://www.npmjs.com/package/ccstatusline), but the runtime ships with the plugin and the configuration UX is `/statusline-plugin:configure` plus a skill that teaches Claude the schema. No leaving the session, no spawning npm processes per render.

## Install

```bash
/plugin install statusline-plugin
```

Then run once:

```
/statusline-plugin:configure
```

Claude reads `~/.claude/settings.json`, adds the `statusLine` stanza if missing, and seeds a default `~/.claude/statusline-plugin/config.json`. The change takes effect on the next prompt.

The manual stanza, if you'd rather paste it yourself:

```json
{
  "statusLine": {
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/bin/statusline.js"
  }
}
```

`subagentStatusLine` is wired automatically by the plugin's bundled `settings.json`, so subagent statuslines work out of the box.

## Configure

Just talk to Claude:

```
/statusline-plugin:configure show model, cwd, and cost
/statusline-plugin:configure add the time on the right
/statusline-plugin:configure make the model green
```

Claude knows the schema (via the bundled `statusline-config` skill), edits `~/.claude/statusline-plugin/config.json` directly, and reports the change.

## Schema

Top-level: `{ separator, segments[] }`. Each segment has a `type` and shared optional fields (`color`, `bold`, `dim`, `italic`, `prefix`, `suffix`, `hideWhenEmpty`).

Available segment types:

| Type           | What it shows                                       |
| -------------- | --------------------------------------------------- |
| `text`         | Literal `value`                                     |
| `model`        | Active model display name (or `id`)                 |
| `cwd`          | Working directory (`tilde` / `basename` / `full`)   |
| `git_branch`   | Current branch + dirty marker                       |
| `time`         | Local clock (`HH:mm` / `HH:mm:ss` / `iso`)          |
| `tokens`       | Session tokens (`total` / `input` / `output`)       |
| `context`      | Context-window usage (`percent` / `absolute`)       |
| `cost`         | Session cost in USD                                 |
| `session`      | Short session id                                    |
| `output_style` | Active output style                                 |
| `version`      | Claude Code version                                 |
| `agent`        | Active subagent name (empty in main session)        |

Full JSON Schema in [`schema/config.schema.json`](schema/config.schema.json).

## Default

```json
{
  "separator": " | ",
  "segments": [
    { "type": "model", "format": "name", "color": "cyan", "bold": true },
    { "type": "cwd", "format": "tilde", "color": "blue" },
    { "type": "git_branch", "color": "magenta", "prefix": "⎇ ", "dirtySuffix": "*" },
    { "type": "context", "format": "percent", "color": "yellow", "prefix": "ctx " },
    { "type": "cost", "unit": "session", "color": "gray" }
  ]
}
```

Renders something like:

```
Opus 4.7 | ~/Projects/statusline-plugin | ⎇ main | ctx 18% | $0.42
```

## Test the runtime

```bash
node test/smoke.js
```

Pipes a fixture stdin payload at `bin/statusline.js` and asserts the rendered output is non-empty and contains the model name.

## License

MIT
