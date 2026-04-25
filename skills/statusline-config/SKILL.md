---
name: statusline-config
description: Configure the Claude Code statusline managed by the statusline-plugin. Use whenever the user wants to add, remove, reorder, recolor, or otherwise change segments shown in their statusline — including the first-time install of the runtime into ~/.claude/settings.json. Use whenever the user invokes /statusline-plugin:configure or asks "change my statusline to …".
---

# statusline-config

You configure the Claude Code statusline rendered by the **statusline-plugin** runtime. Two artifacts:

1. **`~/.claude/statusline-plugin/config.json`** — schema-driven layout (segments, colors, separator). You edit this.
2. **`~/.claude/settings.json`** — Claude Code's own settings; needs a one-time `statusLine` stanza pointing at the plugin runtime. Check it on first run.

The config file is auto-seeded with a sensible default the first time the runtime executes, so you can usually just read it, modify, and write it back.

## First-time install (check once per machine)

Read `~/.claude/settings.json`. If `statusLine` is missing or doesn't point at this plugin, install it:

```json
{
  "statusLine": {
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/bin/statusline.js"
  }
}
```

Notes:

- Merge with existing settings — never overwrite the file.
- `${CLAUDE_PLUGIN_ROOT}` is expanded by Claude Code when the statusline command runs, so this exact string is correct.
- Optional: `"padding": 2` adds horizontal padding.
- The change takes effect on the next prompt — no restart needed.

## Schema (authoritative)

```json
{
  "$schema": "https://raw.githubusercontent.com/earchibald/statusline-plugin/main/schema/config.schema.json",
  "separator": " | ",
  "segments": [ /* Segment[] */ ]
}
```

Every segment has a `type` and shares these optional common fields:

| Field           | Type    | Default | Notes |
| --------------- | ------- | ------- | ----- |
| `color`         | enum    | —       | `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white` `gray` `brightRed` `brightGreen` `brightYellow` `brightBlue` `brightMagenta` `brightCyan` `brightWhite` |
| `bold`          | boolean | false   | |
| `dim`           | boolean | false   | |
| `italic`        | boolean | false   | |
| `prefix`        | string  | `""`    | Rendered before the value (e.g. `"⎇ "`). |
| `suffix`        | string  | `""`    | Rendered after the value. |
| `hideWhenEmpty` | boolean | true    | Drop the segment entirely if the value resolves to empty. |

### Segment types

| Type            | Type-specific fields                                     | Renders |
| --------------- | -------------------------------------------------------- | ------- |
| `text`          | `value` (string, required)                               | the literal `value` |
| `model`         | `format`: `name` (default) \| `id`                       | model display name (e.g. `Opus 4.7`) |
| `cwd`           | `format`: `tilde` (default) \| `basename` \| `full`; `maxLen` | working directory; with `maxLen`, truncates from the left with `…` |
| `git_branch`    | `dirtySuffix` (default `*`)                              | current branch + suffix when dirty; empty outside a repo |
| `time`          | `format`: `HH:mm` (default) \| `HH:mm:ss` \| `iso`       | local clock |
| `tokens`        | `which`: `total` (default) \| `input` \| `output`        | session token counter |
| `context`       | `format`: `percent` (default) \| `remaining_percent` \| `absolute` \| `absolute_percent` | context-window usage; `absolute_percent` renders e.g. `36800/200000 (18%)` |
| `cost`          | `unit`: `session` (default)                              | session spend in USD, `$0.00` shape |
| `session`       | —                                                        | first 8 chars of `session_id` |
| `output_style`  | —                                                        | active output style name |
| `version`       | —                                                        | Claude Code version |
| `agent`         | —                                                        | active subagent name (empty in main session) |

Unknown types render empty (forward-compat) — keep configs valid against the schema above.

## Edit recipes

Be additive when the user's request is ambiguous: ask which slot the new segment goes in (left, right, replace) only if there's real ambiguity. Otherwise infer from intent — e.g. "add the time" → append to the segments array.

**"Show me model and current directory only."**
```json
{
  "separator": " | ",
  "segments": [
    { "type": "model", "format": "name", "color": "cyan", "bold": true },
    { "type": "cwd",   "format": "tilde", "color": "blue" }
  ]
}
```

**"Add cost on the right."** Append a `cost` segment to the end:
```json
{ "type": "cost", "unit": "session", "color": "gray" }
```

**"Add a clock."**
```json
{ "type": "time", "format": "HH:mm", "color": "gray" }
```

**"Make the model name green."** Find the existing `model` segment, set `"color": "green"`. Don't add a duplicate.

**"Show context usage as a percentage."**
```json
{ "type": "context", "format": "percent", "color": "yellow", "prefix": "ctx " }
```

**"Show context as absolute(percent)" — e.g. `ctx 36800/200000 (18%)`.**
```json
{ "type": "context", "format": "absolute_percent", "color": "yellow", "prefix": "ctx " }
```

**"I want a tag in front."** Use a `text` segment first:
```json
{ "type": "text", "value": "[claude]", "color": "magenta", "bold": true }
```

## Workflow

1. Read `~/.claude/statusline-plugin/config.json`. If missing, write the default below first (the runtime will create it lazily, but creating it now lets the user see what you're modifying).
2. Apply the user's change minimally — preserve unrelated segments, ordering, separator, and field values.
3. Validate: every segment has a known `type`, all `color` values are from the enum, `text.value` is present.
4. Write the file with 2-space indentation and a trailing newline.
5. Show the user the diff in plain English: "Added a `cost` segment after the git branch, gray." Don't dump JSON unless they ask.
6. Mention that the change takes effect on the next prompt.

## Default config (use when seeding)

```json
{
  "$schema": "https://raw.githubusercontent.com/earchibald/statusline-plugin/main/schema/config.schema.json",
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

## Don'ts

- Don't introduce segment types not in the schema — they render empty.
- Don't put `prefix`/`suffix` strings inside the `value` of a `text` segment when the user wanted a real segment (e.g. don't fake a git branch via `text` — use `git_branch`).
- Don't change `separator` unless the user asked for it; it touches every segment.
- Don't write the config to anywhere other than `~/.claude/statusline-plugin/config.json`.
- Don't restart Claude Code or instruct the user to — the runtime is invoked fresh on every render.
