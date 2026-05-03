---
name: statusline-config
description: Configure the Claude Code statusline managed by the statusline-plugin. Use whenever the user wants to add, remove, reorder, recolor, or otherwise change segments shown in their statusline — including the first-time install of the runtime into ~/.claude/settings.json. Use whenever the user invokes /statusline-plugin:configure or asks "change my statusline to …".
---

# statusline-config

You configure the Claude Code statusline rendered by the **statusline-plugin** runtime. Two artifacts:

1. **`~/.claude/statusline-plugin/config.json`** — schema-driven layout (segments, colors, separator, secondLine). You edit this.
2. **`~/.claude/settings.json`** — Claude Code's own settings; needs a one-time `statusLine` stanza pointing at the plugin runtime. Check it on first run.

The config file is auto-seeded with a sensible default the first time the runtime executes, so you can usually just read it, modify, and write it back.

## Install (run on every `/configure`)

The plugin's renderer lives at a version-pinned path inside `~/.claude/plugins/cache/<marketplace>/statusline-plugin/<version>/bin/statusline.js` — that path goes stale on every plugin upgrade. To survive upgrades, `statusLine.command` points at a stable wrapper at `~/.claude/statusline-plugin/run` that resolves the latest cached version at exec time.

Do this every time the configure skill runs (it is fast, idempotent, and lets new wrapper logic propagate automatically when the plugin updates):

1. **Install (or refresh) the wrapper:**
   ```bash
   mkdir -p ~/.claude/statusline-plugin
   cp "${CLAUDE_PLUGIN_ROOT}/bin/run" ~/.claude/statusline-plugin/run
   chmod +x ~/.claude/statusline-plugin/run
   ```
   Always re-copy — the user might have a new plugin version with an updated resolver.

2. **Point `~/.claude/settings.json` at the wrapper.** Read the file (merge — never overwrite). Resolve the user's absolute home dir (`echo "$HOME"`); settings.json does **not** expand `~`. Then ensure:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "<HOME>/.claude/statusline-plugin/run"
     }
   }
   ```
   - **If `statusLine.command` is missing:** install the stanza above.
   - **If `statusLine.command` matches the old version-pinned shape** (`*/.claude/plugins/cache/*/statusline-plugin/*/bin/statusline.js`): rewrite it to the wrapper path. This is the migration path — once-per-machine, transparent to the user.
   - **If `statusLine.command` already points at `~/.claude/statusline-plugin/run`:** leave it alone (the wrapper file refresh in step 1 is the only mutation needed).
   - **If it points at something else** (a hand-rolled command, a different plugin): leave it and tell the user — don't clobber their config.

3. Optional: `"padding": 2` adds horizontal padding.
4. The change takes effect on the next prompt — no restart needed.

The wrapper itself has zero dependencies and exits cleanly (status 0, stderr hint) if no cached version is found, so a temporarily empty cache won't break the prompt.

## Schema (authoritative)

```json
{
  "$schema": "https://raw.githubusercontent.com/earchibald/statusline-plugin/main/schema/config.schema.json",
  "separator": " | ",
  "segments": [ /* Segment[] — first line */ ],
  "secondLine": {
    "separator": " ",
    "segments": [ /* SecondLineSegment[] — optional second line */ ]
  }
}
```

The `secondLine` key is optional. When present, the wrapper script (`~/.claude/statusline-with-cache.sh`) renders a second line below the main segments using the segment types listed below. The `separator` defaults to `" "` (space).

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
| `joinPrev`      | boolean | false   | When true, no separator is inserted before this segment — it concatenates directly to the previous visible segment. Use for tight clusters like `Opus 4.7 [high]`. |

### Segment types

| Type            | Type-specific fields                                     | Renders |
| --------------- | -------------------------------------------------------- | ------- |
| `text`          | `value` (string, required)                               | the literal `value` |
| `model`         | `format`: `name` (default) \| `id`                       | model display name (e.g. `Opus 4.7`) |
| `cwd`           | `format`: `tilde` (default) \| `basename` \| `full` \| `brief`; `maxLen`; `briefDepth` (default 1) | working directory. `brief` abbreviates intermediate components to one char (`~/Projects/tts-me-baby/.claude/worktrees/tmb-28` → `~/P/t/.c/w/tmb-28`); leading dots are preserved (`.claude` → `.c`). `briefDepth` keeps the last N components full (default 1 = leaf only); falls through to tilde-style output when ≥ total path components; ignored when `format` ≠ `brief`. `maxLen` truncates from the left with `…`. |
| `git_branch`    | `dirtySuffix` (default `*`)                              | current branch + suffix when dirty; empty outside a repo |
| `time`          | `format`: `HH:mm` (default) \| `HH:mm:ss` \| `iso`       | local clock |
| `tokens`        | `which`: `total` (default) \| `input` \| `output`        | session token counter |
| `context`       | `format`: `percent` (default) \| `remaining_percent` \| `absolute` \| `absolute_percent`; `scale`: `auto` (default) \| `raw` | context-window usage. `auto` scales numbers briefly (`147001` → `147k`, `1000000` → `1M`); `raw` keeps full numbers. Only affects `absolute` / `absolute_percent`. |
| `cost`          | `unit`: `session` (default)                              | session spend in USD, `$0.00` shape |
| `session`       | —                                                        | first 8 chars of `session_id` |
| `output_style`  | —                                                        | active output style name |
| `version`       | —                                                        | Claude Code version |
| `agent`         | —                                                        | active subagent name (empty in main session) |
| `effort`        | —                                                        | thinking-effort level (`low` / `medium` / `high`) when set |

Unknown types render empty (forward-compat) — keep configs valid against the schema above.

### Second-line segment types

These are rendered by `~/.claude/statusline-with-cache.sh`, not the plugin runtime. They read the session transcript to display prompt-cache cliff information.

| Type | Fields | Renders |
| ---- | ------ | ------- |
| `cache_cliff_1h` | `count` (integer, default `3`) | `1h[Xk@HH:MM, Yk@HH:MM, …, N more]` — next `count` expiry groups of the 1h cache, grouped by minute, soonest first. Appends `N more` when groups exist beyond the shown count. Color: green > 30m, yellow > 10m, red ≤ 10m on the soonest cliff. |
| `cache_cliff_largest` | `prefix` (string, default `"largest "`) | `<prefix>Xk@HH:MM` — the single group with the most tokens across all live 1h blocks. Independent of `cache_cliff_1h`. Color follows the same thresholds. |

**Methodology:** A "group" is all 1h cache blocks whose `ts + 3600` falls in the same wall-clock minute. Within a group, `ephemeral_1h_input_tokens` values are summed. Only blocks with `ts > now − 3600` are included (live window). `cache_cliff_largest` picks the globally largest group regardless of its position in the expiry order.

**Examples:**

`"1h cache cliff with 3 examples and largest"` →
```json
"secondLine": {
  "segments": [
    { "type": "cache_cliff_1h", "count": 3 },
    { "type": "cache_cliff_largest" }
  ]
}
```
Renders: `1h[15k@23:42, 2k@23:44, 4k@23:45, 27 more] largest 191k@00:17`

`"largest: prefix, then 4 examples"` →
```json
"secondLine": {
  "segments": [
    { "type": "cache_cliff_largest", "prefix": "largest: " },
    { "type": "cache_cliff_1h", "count": 4 }
  ]
}
```
Renders: `largest: 191k@00:17 1h[15k@23:42, 2k@23:44, 4k@23:45, 3k@23:46, 26 more]`

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

**"Show effort right after the model with no separator" — e.g. `Opus 4.7 [high]`.**
Add an `effort` segment with `joinPrev: true`, plus a leading-space prefix and bracket suffix:
```json
{ "type": "effort", "joinPrev": true, "prefix": " [", "suffix": "]" }
```

**"Show a brief cwd" — abbreviates parents, keeps the last folder full.**
```json
{ "type": "cwd", "format": "brief", "color": "blue" }
```
Renders `~/P/t/.c/w/tmb-28` for `~/Projects/tts-me-baby/.claude/worktrees/tmb-28`.

**"Brief cwd, but keep the last two folders readable."** Set `briefDepth` to 2:
```json
{ "type": "cwd", "format": "brief", "briefDepth": 2, "color": "blue" }
```
Renders `~/P/t/.c/worktrees/tmb-28` for the same path. `briefDepth` ≥ total path components falls through to tilde-style output (no abbreviation).

**"Show context as absolute(percent)" — brief by default, e.g. `147k/1M (15%)`.**
```json
{ "type": "context", "format": "absolute_percent", "color": "yellow" }
```

**"Show full numbers, not the k/M scale."**
```json
{ "type": "context", "format": "absolute_percent", "scale": "raw", "color": "yellow" }
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
