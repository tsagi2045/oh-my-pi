#!/usr/bin/env bash
# OMP notification click handler.
#
# Dispatched by `alerter --execute` / `terminal-notifier -execute` when the
# user clicks an OMP desktop notification. Returns focus to the originating
# tmux pane and flashes its border so the user can spot it among many panes.
#
# Mirrors the behavior of ~/.claude/hooks/focus-session.sh but is invoked
# with positional arguments (session name, window target, pane id) so OMP
# doesn't have to manage env var escaping inside `--execute`.
#
# Usage: notify-click.sh <session_name> <window_target> <pane>
#
# Notes:
# - alerter's `--execute` runs the command via `/bin/sh -c`, with a stripped
#   PATH. Use absolute Homebrew paths for tmux/kitty.
# - All tmux/kitty calls swallow stderr (`2>/dev/null`) so a stale pane id
#   or a mid-flight kitty restart doesn't surface a dialog to the user.

SESSION="$1"
WIN="$2"
PANE="$3"

TMUX_BIN="${OMP_TMUX_BIN:-/opt/homebrew/bin/tmux}"
KITTY_BIN="${OMP_KITTY_BIN:-/opt/homebrew/bin/kitty}"

# Fall back to PATH lookup if Homebrew default isn't there.
[ -x "$TMUX_BIN" ] || TMUX_BIN=$(command -v tmux 2>/dev/null)
[ -x "$KITTY_BIN" ] || KITTY_BIN=$(command -v kitty 2>/dev/null)

# Avoid socket-path conflict if the click handler somehow inherits TMUX env.
unset TMUX

# 1. Bring kitty to the foreground.
osascript -e 'tell application "kitty" to activate' 2>/dev/null

# 2. Switch the kitty tab whose terminal title contains the session name.
#    kitty 0.46+ creates `/tmp/kitty-<PID>` sockets; pick the most recently
#    modified socket (most likely the one currently in focus / freshly spawned).
if [ -n "$KITTY_BIN" ] && [ -n "$SESSION" ]; then
  SOCKET_PATH=$(ls -t /tmp/kitty-* 2>/dev/null | head -1)
  if [ -n "$SOCKET_PATH" ]; then
    "$KITTY_BIN" @ --to "unix:$SOCKET_PATH" focus-tab --match "title:$SESSION" 2>/dev/null
  fi
fi

# 3. Switch tmux window.
if [ -n "$TMUX_BIN" ] && [ -n "$WIN" ]; then
  "$TMUX_BIN" select-window -t "$WIN" 2>/dev/null
fi

# 4. Select the pane and flash its background + border.
if [ -n "$TMUX_BIN" ] && [ -n "$PANE" ]; then
  "$TMUX_BIN" select-pane -t "$PANE" 2>/dev/null

  (
    "$TMUX_BIN" set-option -p -t "$PANE" pane-active-border-style "fg=#f9e2af,bold" 2>/dev/null
    for _ in 1 2; do
      "$TMUX_BIN" select-pane -t "$PANE" -P 'bg=#45475a' 2>/dev/null
      sleep 0.15
      "$TMUX_BIN" select-pane -t "$PANE" -P 'default' 2>/dev/null
      sleep 0.15
    done
    sleep 1
    "$TMUX_BIN" set-option -p -t "$PANE" -u pane-active-border-style 2>/dev/null
  ) </dev/null >/dev/null 2>&1 &
fi

exit 0
