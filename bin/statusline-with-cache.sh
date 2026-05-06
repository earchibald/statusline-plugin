#!/bin/bash
# Wraps the statusline-plugin renderer and appends a config-driven second line
# with cache cliff segments. Reads secondLine from statusline-plugin/config.json.
set -u

input=$(cat)
cfg="$HOME/.claude/statusline-plugin/config.json"

plugin_dir=$(/bin/ls -1d "$HOME"/.claude/plugins/cache/*/statusline-plugin/*/bin 2>/dev/null | sort -V | tail -1)
base=""
if [ -n "$plugin_dir" ] && [ -x "$plugin_dir/statusline.js" ]; then
  base=$(printf '%s' "$input" | "$plugin_dir/statusline.js" 2>/dev/null)
fi

# Read secondLine config; default: largest(prefix "largest ") then 1h(count 3)
second_sep=" "
segments_json='[{"type":"cache_cliff_largest","prefix":"largest "},{"type":"cache_cliff_1h","count":3}]'
if [ -f "$cfg" ]; then
  _sep=$(/usr/bin/jq -r '.secondLine.separator // empty' "$cfg" 2>/dev/null)
  _segs=$(/usr/bin/jq -c '.secondLine.segments // empty' "$cfg" 2>/dev/null)
  [ -n "$_sep"  ] && second_sep="$_sep"
  [ -n "$_segs" ] && segments_json="$_segs"
fi

transcript=$(printf '%s' "$input" | /usr/bin/jq -r '.transcript_path // empty' 2>/dev/null)

cliff_segment=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  now_epoch=$(date +%s)

  human_tokens() {
    local n=$1
    if   [ "$n" -ge 1000000 ]; then printf '%.1fM' "$(echo "scale=2; $n/1000000" | bc)"
    elif [ "$n" -ge 1000 ];    then printf '%.0fk' "$(echo "scale=0; $n/1000"    | bc)"
    else printf '%d' "$n"
    fi
  }

  reset=$'\033[0m'

  # Fetch all 1h groups in one pass.
  # ephemeral_1h_input_tokens is the total cache size, not incremental additions.
  # Within a single expiry minute, use max (not sum) to avoid double-counting
  # the same cached conversation across multiple cache-write events.
  # Output: <total_groups>\t<largest_min>:<largest_tok>\t<min1>:<tok1>\t<min2>:<tok2>\t...
  read -r all_data < <(
    /usr/bin/jq -rs --argjson now "$now_epoch" '
      [ .[]
        | select(type=="object")
        | select(.type=="assistant" and (.message.usage // empty))
        | { ts: (.timestamp | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601),
            m1h: (.message.usage.cache_creation.ephemeral_1h_input_tokens // 0) }
      ]
      | [ .[] | select(.ts > ($now - 3600) and .m1h > 0) ]
      | sort_by(.ts)
      | group_by((.ts + 3600) | . / 60 | floor)
      | map({ cliff_min: (.[0].ts + 3600 | . / 60 | floor), tokens: (map(.m1h) | max) })
      | sort_by(.cliff_min) as $groups
      | ($groups | length) as $total
      | (($groups | max_by(.tokens)) // {cliff_min:0,tokens:0}) as $lg
      | "\($total)\t\($lg.cliff_min):\($lg.tokens)\t" +
        ([$groups[] | "\(.cliff_min):\(.tokens)"] | join("\t"))
    ' "$transcript" 2>/dev/null
  )

  total_groups="${all_data%%$'\t'*}"
  _rest="${all_data#*$'\t'}"
  largest_field="${_rest%%$'\t'*}"
  groups_tsv="${_rest#*$'\t'}"
  total_groups="${total_groups:-0}"

  render_1h() {
    local count=$1
    [ "${total_groups:-0}" -eq 0 ] && { printf '\033[90m1h[—]\033[0m'; return; }
    local items=() n=0 first_rem=-1 color
    local IFS=$'\t'
    for group in $groups_tsv; do
      [ "$n" -ge "$count" ] && break
      local cliff_min="${group%%:*}" tokens="${group##*:}"
      local cliff=$((cliff_min * 60))
      local rem=$((cliff - now_epoch))
      [ "$rem" -le 0 ] && { total_groups=$((total_groups - 1)); continue; }
      [ "$first_rem" -eq -1 ] && first_rem=$rem
      items+=("$(human_tokens "$tokens")@$(date -r "$cliff" '+%H:%M')")
      n=$((n + 1))
    done
    [ ${#items[@]} -eq 0 ] && { printf '\033[90m1h[—]\033[0m'; return; }
    if   [ "$first_rem" -gt 1800 ]; then color=$'\033[32m'
    elif [ "$first_rem" -gt  600 ]; then color=$'\033[33m'
    else                                  color=$'\033[31m'
    fi
    local joined n_more
    joined=$(IFS=', '; echo "${items[*]}")
    n_more=$((total_groups - n))
    [ "$n_more" -gt 0 ] && joined="${joined}, ${n_more} more"
    printf '%s1h[%s]%s' "$color" "$joined" "$reset"
  }

  render_largest() {
    local prefix=$1
    local lg_min="${largest_field%%:*}" lg_tok="${largest_field##*:}"
    if [ "${lg_min:-0}" -eq 0 ] || [ "${lg_tok:-0}" -eq 0 ]; then
      printf '\033[90m%s—\033[0m' "$prefix"; return
    fi
    local cliff=$((lg_min * 60)) rem
    rem=$((cliff - now_epoch))
    if [ "$rem" -le 0 ]; then
      printf '\033[90m%s—\033[0m' "$prefix"; return
    fi
    local color
    if   [ "$rem" -gt 1800 ]; then color=$'\033[32m'
    elif [ "$rem" -gt  600 ]; then color=$'\033[33m'
    else                           color=$'\033[31m'
    fi
    printf '%s%s%s@%s%s' "$color" "$prefix" "$(human_tokens "$lg_tok")" "$(date -r "$cliff" '+%H:%M')" "$reset"
  }

  # Iterate segments_json and render each one
  n_segs=$(/usr/bin/jq 'length' <<< "$segments_json" 2>/dev/null)
  n_segs=${n_segs:-0}
  parts=()
  for i in $(seq 0 $((n_segs - 1))); do
    seg=$(/usr/bin/jq -c ".[$i]" <<< "$segments_json" 2>/dev/null)
    type=$(/usr/bin/jq -r '.type' <<< "$seg" 2>/dev/null)
    case "$type" in
      cache_cliff_1h)
        count=$(/usr/bin/jq -r '.count // 3' <<< "$seg" 2>/dev/null)
        parts+=("$(render_1h "$count")")
        ;;
      cache_cliff_largest)
        prefix=$(/usr/bin/jq -r '.prefix // "largest "' <<< "$seg" 2>/dev/null)
        parts+=("$(render_largest "$prefix")")
        ;;
    esac
  done

  cliff_segment=$(IFS="$second_sep"; echo "${parts[*]}")
fi

# CLAUDE_DS: the claude-ds compat shim routes requests through DeepSeek's API.
# DeepSeek's caching is automatic/server-side with no API-visible cache fields,
# so cache cliffs can't be computed. Show a [DEEPSEEK] badge on the statusline
# and a static message instead of cache cliffs.
if [ "${CLAUDE_DS:-0}" = "1" ]; then
  base=$'\033[94m[DEEPSEEK]\033[0m '"${base}"
  cliff_segment=$'\033[90mnon-caching model selected\033[0m'
fi

if [ -n "$base" ] && [ -n "$cliff_segment" ]; then
  printf '%s\n%s' "$base" "$cliff_segment"
elif [ -n "$base" ]; then
  printf '%s' "$base"
else
  printf '%s' "$cliff_segment"
fi
