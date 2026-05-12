#!/usr/bin/env bash
# Fire-and-forget wrapper around `alerter` for OMP desktop notifications.
#
# alerter is an *interactive* notifier (no `--execute` flag): it blocks on
# `--actions Foo`, then prints the chosen action / `@CONTENTCLICKED` to stdout
# and exits. To get terminal-notifier-style fire-and-forget semantics, we
# background the alerter call inside this wrapper and route the click result
# to OMP's notify-click.sh in the same subshell. The wrapper itself returns
# immediately so the OMP process can exit cleanly.
#
# Usage:
#   mac-alerter.sh <alerter_bin> <title> <subtitle> <body> <group> \
#                  <click_script> <session> <window> <pane>
#
# Empty strings ("") are valid for any of subtitle/group/click_script/session/
# window/pane — they're skipped. When click_script is empty, no click handler
# is wired (notification fires without an action button).

ALERTER="$1"
TITLE="$2"
SUBTITLE="$3"
BODY="$4"
GROUP="$5"
CLICK_SCRIPT="$6"
SESSION="$7"
WIN="$8"
PANE="$9"

# Build alerter argv. Defaults match the Claude Code hook: 30s timeout (after
# which the notification quietly disappears), explicit close label so the
# action button isn't the only escape hatch.
ARGS=(--title "$TITLE" --message "$BODY" --sound default --timeout 30 --close-label "Close")
[ -n "$SUBTITLE" ] && ARGS+=(--subtitle "$SUBTITLE")
[ -n "$GROUP" ] && ARGS+=(--group "$GROUP")
[ -n "$CLICK_SCRIPT" ] && ARGS+=(--actions "Open")

(
	# `--actions Open` makes alerter wait for input. Capture the chosen
	# action; alerter prints "Open" for the action button and
	# "@CONTENTCLICKED" when the user clicks the notification body itself.
	# Both should trigger focus-jump.
	RESULT=$("$ALERTER" "${ARGS[@]}" 2>/dev/null)
	if [ -n "$CLICK_SCRIPT" ] && [ -x "$CLICK_SCRIPT" ] && {
		[ "$RESULT" = "Open" ] || [ "$RESULT" = "@CONTENTCLICKED" ]
	}; then
		"$CLICK_SCRIPT" "$SESSION" "$WIN" "$PANE"
	fi
) </dev/null >/dev/null 2>&1 &
# `disown` detaches the subshell from the parent's job table so the OMP
# process can exit without taking the alerter wait with it. `|| :` swallows
# the "no current job" warning some bashes emit when the background pid
# already settled before disown runs.
disown 2>/dev/null || :

exit 0
