#!/usr/bin/env bash
# OMP notification pane-flash helper.
#
# Fires at notification *dispatch* time (not on click) when OMP cannot
# observe the user's click — the native-macOS path for ghostty/iTerm2/
# wezterm emits OSC 9 to stdout and the terminal app handles the click
# entirely in-app, so the click never reaches an OMP-controlled script
# the way it does on the alerter path. To compensate, this helper lights
# up the originating tmux pane border immediately when the notification
# is fired, and HOLDS the golden border long enough that the user can
# still spot the pane after walking back to the terminal.
#
# Usage: notify-flash.sh <pane>
#
# Tunables (env):
#   OMP_TMUX_BIN              — tmux binary (default /opt/homebrew/bin/tmux)
#   OMP_FLASH_HOLD_SECONDS    — how long the golden border stays lit
#                                (default 30s). Set to 0 to disable.
#
# Differences from notify-click.sh:
#   - Does NOT call kitty / osascript / select-pane (don't yank focus
#     before the user clicks — they may be reading something else).
#   - Holds the border much longer (~30s vs ~1s) since the visual cue
#     must remain visible after the user takes their attention back.
#   - Skips tmux/ghostty/iterm window activation entirely.
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

HOLD_SECONDS="${OMP_FLASH_HOLD_SECONDS:-30}"

(
	"$TMUX_BIN" set-option -p -t "$PANE" pane-active-border-style "fg=#f9e2af,bold" 2>/dev/null
	# Two quick 150 ms background blinks pull the eye to the pane at the
	# same time the macOS toast appears in the corner.
	for _ in 1 2; do
		"$TMUX_BIN" select-pane -t "$PANE" -P 'bg=#45475a' 2>/dev/null
		sleep 0.15
		"$TMUX_BIN" select-pane -t "$PANE" -P 'default' 2>/dev/null
		sleep 0.15
	done
	# Hold the golden border so the user still sees it after returning to
	# the terminal. `sleep 0` is a no-op for users who want to opt out.
	if [ "$HOLD_SECONDS" -gt 0 ] 2>/dev/null; then
		sleep "$HOLD_SECONDS"
	fi
	"$TMUX_BIN" set-option -p -t "$PANE" -u pane-active-border-style 2>/dev/null
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || :

exit 0
