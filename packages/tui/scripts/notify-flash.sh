#!/usr/bin/env bash
# OMP notification pane-flash helper.
#
# Fires at notification *dispatch* time (not on click) when OMP cannot
# observe the user's click — the native-macOS path for ghostty/iTerm2/
# wezterm emits OSC 9 to stdout and the terminal app handles the click
# entirely in-app, so the click never reaches an OMP-controlled script
# the way it does on the alerter path. To compensate, this helper lights
# up the originating tmux pane border so the user can still spot the
# pane after returning to the terminal.
#
# Usage: notify-flash.sh <pane>
#
# Tunables (env):
#   OMP_TMUX_BIN              — tmux binary (default /opt/homebrew/bin/tmux)
#   OMP_FLASH_HOLD_SECONDS    — how long the golden border stays lit
#                                (default 8s). Set to 0 to disable.
#
# Visual design (revised after user feedback that the earlier
# `select-pane -P bg=…` blink pulses inside the pane were jarring during
# normal code editing — too many notifications fire in a streaming
# session, and a 0.6 s background flip × N stacks up to a distracting
# flicker):
#   - **Static border-color change only.** Border flips to gold once,
#     stays gold for HOLD_SECONDS, then resets. No background flips,
#     no animation, no select-pane.
#   - **Short hold (8s default).** Long enough to catch the eye when the
#     user comes back from clicking the toast, short enough that it
#     doesn't bleed across consecutive notifications.
#
# Fire-and-forget: backgrounds + disowns the worker subshell so the
# caller (OMP's notification dispatch) returns immediately.

PANE="$1"

TMUX_BIN="${OMP_TMUX_BIN:-/opt/homebrew/bin/tmux}"
[ -x "$TMUX_BIN" ] || TMUX_BIN=$(command -v tmux 2>/dev/null)

# Avoid socket-path conflict if the helper somehow inherits TMUX env.
unset TMUX

if [ -z "$TMUX_BIN" ] || [ -z "$PANE" ]; then
	exit 0
fi

HOLD_SECONDS="${OMP_FLASH_HOLD_SECONDS:-8}"

# Bail before spawning anything if the caller disabled the hold entirely.
if [ "$HOLD_SECONDS" -le 0 ] 2>/dev/null; then
	exit 0
fi

(
	"$TMUX_BIN" set-option -p -t "$PANE" pane-active-border-style "fg=#f9e2af,bold" 2>/dev/null
	sleep "$HOLD_SECONDS"
	"$TMUX_BIN" set-option -p -t "$PANE" -u pane-active-border-style 2>/dev/null
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || :

exit 0
