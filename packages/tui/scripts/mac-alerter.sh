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
#                  <click_script> <terminal_app> <session> <window> <pane> <multiplexer>
#
# Empty strings ("") are valid for any of subtitle/group/click_script/
# terminal_app/session/window/pane/multiplexer — they're skipped. When
# click_script is empty, no click handler is wired (notification fires
# without an action button).
#
#   <terminal_app> is the macOS app name of the outer terminal (e.g.
#   "Ghostty"). Forwarded verbatim to the click handler so it can run
#   `osascript -e 'tell application "<app>" to activate'` on click — this
#   is what brings the user back to the terminal window before tmux
#   pane jump + background flash.

ALERTER="$1"
TITLE="$2"
SUBTITLE="$3"
BODY="$4"
GROUP="$5"
CLICK_SCRIPT="$6"
TERMINAL_APP="$7"
SESSION="$8"
WIN="$9"
PANE="${10}"
MULTIPLEXER="${11}"

# Build alerter argv. The shape here decides the on-screen presentation:
#
#   --actions <label>   → Alert-style: persistent on screen until the user
#                         clicks something. Reliable NC entry after dismissal.
#   (no --actions)      → Banner-style: macOS auto-dismisses after ~5–10 s.
#                         macOS archives the entry to Notification Center
#                         iff "Show in Notification Center" is enabled for
#                         this app under System Settings → Notifications.
#
# OMP defaults to Banner: the user asked for "auto-dismiss after ~5 s and
# accumulate in NC". `--timeout` is left at the alerter default (0) so
# alerter never calls `removeDeliveredNotification` — that call would also
# purge the NC entry, defeating the point. Body clicks are still captured
# via `@CONTENTCLICKED` even without an `--actions` button.
ARGS=(--title "$TITLE" --message "$BODY" --sound default)
[ -n "$SUBTITLE" ] && ARGS+=(--subtitle "$SUBTITLE")
[ -n "$GROUP" ] && ARGS+=(--group "$GROUP")

(
	# alerter's output convention is:
	#   - the literal action label when --actions is set, OR
	#     "@ACTIONCLICKED" in some builds/configurations,
	#   - "@CONTENTCLICKED" when the user clicks the notification body,
	#   - "@CLOSED" / "@TIMEOUT" when the user dismisses or it times out.
	# Treat the first three as "user wants to jump back".
	RESULT=$("$ALERTER" "${ARGS[@]}" 2>/dev/null)
	if [ -n "$CLICK_SCRIPT" ] && [ -x "$CLICK_SCRIPT" ] && {
		[ "$RESULT" = "Open" ] || [ "$RESULT" = "@ACTIONCLICKED" ] || [ "$RESULT" = "@CONTENTCLICKED" ]
	}; then
		"$CLICK_SCRIPT" "$TERMINAL_APP" "$SESSION" "$WIN" "$PANE" "$MULTIPLEXER"
	fi
) </dev/null >/dev/null 2>&1 &
# `disown` detaches the subshell from the parent's job table so the OMP
# process can exit without taking the alerter wait with it. `|| :` swallows
# the "no current job" warning some bashes emit when the background pid
# already settled before disown runs.
disown 2>/dev/null || :

exit 0
