# vscode-tmux-revive

A VS Code extension that connects the integrated terminal UI to tmux, so terminal processes survive VS Code being fully closed and reopened.

VS Code's built-in terminal persistence only survives window reloads. This extension survives full close/reopen cycles by keeping processes alive in tmux.

## How it works

Each VS Code terminal tab runs `tmux attach-session` pointed at a specific window in a per-workspace tmux session. When you close the tab, tmux detaches — the window keeps running. When you reopen VS Code, the extension calls `tmux list-windows` and reopens tabs for each surviving window. Scrollback history is preserved because it lives in tmux.

Sessions are named `vscode-<fullpath>` by default (e.g. `vscode-/Users/you/vcs/myproject`), matching a common manual tmux convention. A `basename` mode is also available.

## Installation

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
code --install-extension vscode-tmux-revive-0.1.0.vsix
```

Or press **F5** in VS Code to launch an Extension Development Host for interactive debugging.

## Usage

Open a new tmux-backed terminal via the **`+` dropdown → Tmux** or the command palette:

| Command | Description |
|---|---|
| `Tmux Revive: New Terminal` | Open a new tmux-backed terminal tab |
| `Tmux Revive: Restore Session` | Open tabs for all live tmux windows (additive — skips already-open ones) |
| `Tmux Revive: Save Session` | Write the current window list to workspace state |

To make the Tmux profile your default so the plain `+` button uses it, add this to your workspace settings:

```json
"terminal.integrated.defaultProfile.osx": "Tmux"
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `tmuxRevive.tmuxPath` | `/opt/homebrew/bin/tmux` | Path to tmux. Run `which tmux` to confirm. |
| `tmuxRevive.autoRestore` | `true` | Restore terminals automatically on workspace open |
| `tmuxRevive.sessionNaming` | `path` | `path` = full path, `basename` = folder name only |

## Design

- **Ground truth is tmux, not VS Code state.** On restore, `tmux list-windows` is the source of truth. Stored state is only consulted for VS Code tab labels.
- **Closing a tab never kills the tmux window.** `onDidCloseTerminal` only removes the tab from tracking — the process keeps running.
- **Per-tab linked sessions.** Each terminal tab gets its own tmux session linked to the main workspace session (e.g. `vscode-/path--w2`). This gives each tab an independent current-window pointer so clients don't interfere with each other.
- **Auto-indexed windows.** New windows let tmux assign the index and report it back, avoiding conflicts after crashes or manual tmux changes.

## Requirements

- tmux (install via `brew install tmux`)
- VS Code 1.85+
