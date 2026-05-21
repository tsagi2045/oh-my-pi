#!/usr/bin/env bash
# OMP notification click handler.
#
# Dispatched by `terminal-notifier -execute` (preferred) or `alerter
# --execute` (via mac-alerter.sh fallback) when the user clicks an OMP
# desktop notification. Returns focus to the originating tmux/Zellij target
# and softly highlights the pane background once so the user can spot it
# among many panes.
#
# Usage: notify-click.sh <terminal_app> <session> <window_or_tab> <pane> [multiplexer]
#
#   <terminal_app>   macOS application name of the outer terminal (e.g.
#                    "Ghostty", "iTerm", "WezTerm", "kitty"). Empty string
#                    → skip the `activate` step entirely (use this when
#                    OMP can't identify the host terminal — pane jump
#                    still runs).
#   <session>        Multiplexer session name. Required for:
#                       - the Ghostty tab selector used by the tmux branch
#                       - `tmux switch-client -t <session>`
#                       - `zellij --session <session> action ...`
#                    Empty → skip all session-aware steps.
#   <window_or_tab>  tmux: `<session>:<window-index>` for `tmux select-window`
#                    zellij: stable `tab_id` for `go-to-tab-by-id`
#                    Empty → skip window/tab switch.
#   <pane>           tmux: pane id (`%5`) / zellij: `ZELLIJ_PANE_ID`
#                    Empty → skip pane select + highlight.
#   [multiplexer]    Optional. `zellij` enables Zellij tab/pane focusing.
#                    Empty or anything else → legacy tmux behavior.
#
# Cross-session / cross-Ghostty-tab fix (2026-05-14, v3):
# The user runs each tmux session in its own Ghostty tab (⌘1 = `1_work`,
# ⌘2 = `3_sandbox`, ⌘3 = `4_OMP`). Each tab is a separate tmux client
# attached to a separate session. Previously (v2):
#   - `tmux switch-client -t <session>` flipped some other (background)
#     client's active session but did NOT touch the Ghostty tab the user
#     was actually looking at, so the user saw no change.
# v3 fixes this by using Ghostty's AppleScript dictionary to `select tab`
# whose title matches the originating tmux session, BEFORE running tmux
# switch-client. Ghostty's tab name format is `<tmux-session> — <window>`
# (the user's tmux titles-string), so a prefix match on `<session> ` (or
# the bare session) is precise enough.
#
# Notes:
# - alerter/terminal-notifier both run the click command via `/bin/sh -c`
#   with a stripped PATH. Use absolute Homebrew paths for tmux/kitty.
# - All tmux/osascript calls swallow stderr (`2>/dev/null`) so a stale
#   pane id or a mid-flight tab close doesn't surface a dialog to the
#   user.
# - The background flash is one static color flip held for ~1.2 s with
#   a deliberately muted color (`colour237` dark gray) so it reads as
#   a brief shade rather than a strobing blink. Tunable via
#   $OMP_PANE_BLINK_COLOR + $OMP_PANE_BLINK_HOLD_SECONDS.

TERMINAL_APP="$1"
SESSION="$2"
WIN="$3"
PANE="$4"
MULTIPLEXER="${5:-tmux}"

TMUX_BIN="${OMP_TMUX_BIN:-/opt/homebrew/bin/tmux}"
ZELLIJ_BIN="${OMP_ZELLIJ_BIN:-/opt/homebrew/bin/zellij}"
KITTY_BIN="${OMP_KITTY_BIN:-/opt/homebrew/bin/kitty}"

# Pane highlight tunables. Defaults: a bright catppuccin-mocha accent that's
# clearly visible against the dark theme, flashed once. Override any of
# these via env var if the default is too loud / too quiet for your setup
# (e.g. `OMP_PANE_BLINK_COUNT=2` for a double-flash).
BLINK_COLOR="${OMP_PANE_BLINK_COLOR:-yellow}"                    # tmux: color name or hex
ZELLIJ_BLINK_BG="${OMP_ZELLIJ_PANE_BLINK_BG:-#f9e2af}"           # zellij: 24-bit hex (mocha yellow)
BLINK_ON_SECONDS="${OMP_PANE_BLINK_ON_SECONDS:-0.35}"
BLINK_OFF_SECONDS="${OMP_PANE_BLINK_OFF_SECONDS:-0.18}"
BLINK_COUNT="${OMP_PANE_BLINK_COUNT:-1}"
# Legacy single-hold setting wins if explicitly set — keeps prior configs working.
if [ -n "${OMP_PANE_BLINK_HOLD_SECONDS:-}" ]; then
  BLINK_ON_SECONDS="$OMP_PANE_BLINK_HOLD_SECONDS"
  BLINK_COUNT=1
fi

# Fall back to PATH lookup if Homebrew default isn't there.
[ -x "$TMUX_BIN" ] || TMUX_BIN=$(command -v tmux 2>/dev/null)
[ -x "$ZELLIJ_BIN" ] || ZELLIJ_BIN=$(command -v zellij 2>/dev/null)
[ -x "$KITTY_BIN" ] || KITTY_BIN=$(command -v kitty 2>/dev/null)

# Avoid multiplexer env confusion if the click handler somehow inherits it.
unset TMUX
unset ZELLIJ
unset ZELLIJ_SESSION_NAME
unset ZELLIJ_PANE_ID

# 1. Bring the outer terminal to the foreground (when known). This is the
#    coarse "make this app active" step; Ghostty's `select tab` in step 2
#    will pick the right tab inside that app.
if [ -n "$TERMINAL_APP" ]; then
  osascript -e "tell application \"$TERMINAL_APP\" to activate" 2>/dev/null
fi

# 2. Pick the Ghostty tab whose title matches the originating multiplexer
#    session. Each Ghostty tab hosts a separate tmux/Zellij session, so we
#    need this step to flip the OUTER Ghostty tab BEFORE issuing pane-jump
#    commands inside the multiplexer — without it, the user clicks the
#    toast but the wrong Ghostty tab stays in front.
#
#    Title formats covered by `starts with`:
#      - tmux:  `<session> — <window>`  (em dash from set-titles-string)
#      - zellij: `<session> | <pane-title>`  (Ghostty's default title shape)
#    Both have the session name as a prefix followed by a separator, so
#    `starts with (sess & " ")` matches either layout.
if [ "$TERMINAL_APP" = "Ghostty" ] && [ -n "$SESSION" ]; then
  /usr/bin/osascript <<OSA 2>/dev/null
tell application "Ghostty"
  set sess to "$SESSION"
  repeat with w in windows
    repeat with t in tabs of w
      set n to name of t
      if n starts with (sess & " ") or n is equal to sess or n starts with (sess & "—") or n starts with (sess & "|") then
        select tab t
        activate
        return
      end if
    end repeat
  end repeat
end tell
OSA
fi

# 3. Kitty-only: switch the kitty tab whose terminal title contains the
#    tmux session name. Zellij focus does not use terminal titles.
if [ "$MULTIPLEXER" != "zellij" ] && [ "$TERMINAL_APP" = "kitty" ] && [ -n "$KITTY_BIN" ] && [ -n "$SESSION" ]; then
  SOCKET_PATH=$(ls -t /tmp/kitty-* 2>/dev/null | head -1)
  if [ -n "$SOCKET_PATH" ]; then
    "$KITTY_BIN" @ --to "unix:$SOCKET_PATH" focus-tab --match "title:$SESSION" 2>/dev/null
  fi
fi

if [ "$MULTIPLEXER" = "zellij" ]; then
  # 4a. Zellij: select the target tab, then focus the target pane, then
  # flash the pane background N times in a bright accent color so the user
  # can spot which pane the notification originated from.
  if [ -n "$ZELLIJ_BIN" ] && [ -n "$SESSION" ] && [ -n "$WIN" ]; then
    "$ZELLIJ_BIN" --session "$SESSION" action go-to-tab-by-id "$WIN" 2>/dev/null
  fi
  if [ -n "$ZELLIJ_BIN" ] && [ -n "$SESSION" ] && [ -n "$PANE" ]; then
    "$ZELLIJ_BIN" --session "$SESSION" action focus-pane-id "$PANE" 2>/dev/null
    (
      i=0
      while [ "$i" -lt "$BLINK_COUNT" ]; do
        "$ZELLIJ_BIN" --session "$SESSION" action set-pane-color --pane-id "$PANE" --bg "$ZELLIJ_BLINK_BG" 2>/dev/null
        sleep "$BLINK_ON_SECONDS"
        "$ZELLIJ_BIN" --session "$SESSION" action set-pane-color --pane-id "$PANE" --reset 2>/dev/null
        i=$((i + 1))
        if [ "$i" -lt "$BLINK_COUNT" ]; then
          sleep "$BLINK_OFF_SECONDS"
        fi
      done
    ) </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || :
  fi
  exit 0
fi

# 4b. tmux: flip the attached client to the originating session. After the
#     Ghostty tab is already selected (step 2), this is the client that's
#     visible in front of the user; switch-client + select-window +
#     select-pane now operate where the user can see them.
if [ -n "$TMUX_BIN" ] && [ -n "$SESSION" ]; then
  "$TMUX_BIN" switch-client -t "$SESSION" 2>/dev/null
fi

# 5. Switch tmux window inside the (now-active) session.
if [ -n "$TMUX_BIN" ] && [ -n "$WIN" ]; then
  "$TMUX_BIN" select-window -t "$WIN" 2>/dev/null
fi

# 6. Select the tmux pane and flash its background N times so the user
#    can spot which pane the notification came from.
if [ -n "$TMUX_BIN" ] && [ -n "$PANE" ]; then
  "$TMUX_BIN" select-pane -t "$PANE" 2>/dev/null
  (
    i=0
    while [ "$i" -lt "$BLINK_COUNT" ]; do
      "$TMUX_BIN" select-pane -t "$PANE" -P "bg=${BLINK_COLOR}" 2>/dev/null
      sleep "$BLINK_ON_SECONDS"
      "$TMUX_BIN" select-pane -t "$PANE" -P 'default' 2>/dev/null
      i=$((i + 1))
      if [ "$i" -lt "$BLINK_COUNT" ]; then
        sleep "$BLINK_OFF_SECONDS"
      fi
    done
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || :
fi

exit 0
