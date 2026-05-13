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

# Build alerter argv. alerter (vjeantet) renders Alert-style (persistent in
# Notification Center) when at least one `--actions` value is set; without
# `--actions` it renders a Banner that macOS auto-dismisses and may drop
# from NC. We always pass `--actions Open` so every OMP toast archives to
# NC, and we leave `--timeout` at the alerter default (0 = no auto-remove)
# so the user can come back to the alert hours later. `--close-label` gives
# an explicit dismissal button next to "Open".
ARGS=(--title "$TITLE" --message "$BODY" --sound default --close-label "Close" --actions "Open")
[ -n "$SUBTITLE" ] && ARGS+=(--subtitle "$SUBTITLE")
[ -n "$GROUP" ] && ARGS+=(--group "$GROUP")

(
	# `--actions Open` makes alerter wait for input. Capture the chosen
	# action; alerter's output convention is:
	#   - the literal action label (here, "Open") when the action button is
	#     clicked, OR "@ACTIONCLICKED" in some builds/configurations,
	#   - "@CONTENTCLICKED" when the user clicks the notification body,
	#   - "@CLOSED" / "@TIMEOUT" when the user dismisses or it times out.
	# Treat the first three as "user wants to jump back".
	RESULT=$("$ALERTER" "${ARGS[@]}" 2>/dev/null)
	if [ -n "$CLICK_SCRIPT" ] && [ -x "$CLICK_SCRIPT" ] && {
		[ "$RESULT" = "Open" ] || [ "$RESULT" = "@ACTIONCLICKED" ] || [ "$RESULT" = "@CONTENTCLICKED" ]
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
