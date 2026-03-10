#!/bin/sh
# Usage: tmux-attach.sh <slot-id> <session> <tmux-path> <tmpdir>
# $PWD is set by VS Code to the user-selected workspace folder.
SLOT="$1"
SESSION="$2"
TMUX="$3"
TMPDIR_ARG="$4"
TMPFILE="${TMPDIR_ARG}/vscode-tmux-revive-${SLOT}"

# Ensure the main session exists
if ! "$TMUX" has-session -t "$SESSION" 2>/dev/null; then
    "$TMUX" new-session -d -s "$SESSION" -c "$PWD" -x 220 -y 50
    "$TMUX" set-option -t "$SESSION" status off
fi

# Create a new window in the correct directory
INDEX=$("$TMUX" new-window -t "$SESSION" -c "$PWD" -P -F '#{window_index}')

# Create linked session (kill any stale one first)
TAB_SESSION="${SESSION}--w${INDEX}"
"$TMUX" kill-session -t "$TAB_SESSION" 2>/dev/null
"$TMUX" new-session -d -t "$SESSION" -s "$TAB_SESSION"
"$TMUX" select-window -t "${TAB_SESSION}:${INDEX}"

# Write result for the extension to read in onDidOpenTerminal
printf '%s:%s:%s\n' "$INDEX" "$TAB_SESSION" "$PWD" > "$TMPFILE"

# Replace this process with tmux attach
exec "$TMUX" attach-session -t "$TAB_SESSION"
