import * as vscode from 'vscode';
import * as tmux from './tmux';
import * as state from './state';
import { Config } from './config';

interface TerminalRecord {
	index: number;
	label: string;
	cwd: string;
	tabSession: string;
}

export const trackedTerminals = new Map<vscode.Terminal, TerminalRecord>();

// Pending map for profile-created terminals: name → record
// VS Code creates the terminal object after provideTerminalProfile() returns,
// so we register it here and pick it up in onDidOpenTerminal.
const pendingTerminals = new Map<string, { index: number; cwd: string; tabSession: string }>();

export function nextWindowIndex(): number {
	const indexes = Array.from(trackedTerminals.values()).map(r => r.index);
	return indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
}

export function buildStateFromTracked(sessionName: string): state.SessionState {
	const windows: state.WindowRecord[] = Array.from(trackedTerminals.values()).map(r => ({
		windowIndex: r.index,
		vscodeLabel: r.label,
		cwd: r.cwd,
	}));
	return {
		version: 1,
		sessionName,
		windows,
		savedAt: Date.now(),
	};
}

export function registerPendingTerminal(name: string, index: number, cwd: string, tabSession: string): void {
	pendingTerminals.set(name, { index, cwd, tabSession });
}

export function createAndTrackTerminal(
	tabSession: string,
	index: number,
	label: string,
	cwd: string,
	context: vscode.ExtensionContext,
	cfg: Config,
): vscode.Terminal {
	const terminal = vscode.window.createTerminal({
		name: label,
		shellPath: cfg.tmuxPath,
		shellArgs: ['attach-session', '-t', tabSession],
		cwd,
	});
	trackedTerminals.set(terminal, { index, label, cwd, tabSession });
	terminal.show();
	return terminal;
}

export function registerLifecycleHooks(
	context: vscode.ExtensionContext,
	session: string,
	cfg: Config,
): void {
	context.subscriptions.push(
		vscode.window.onDidOpenTerminal(terminal => {
			const pending = pendingTerminals.get(terminal.name);
			if (!pending) { return; }
			pendingTerminals.delete(terminal.name);
			trackedTerminals.set(terminal, { index: pending.index, label: terminal.name, cwd: pending.cwd, tabSession: pending.tabSession });
			state.write(context, buildStateFromTracked(session));
		}),

		vscode.window.onDidCloseTerminal(terminal => {
			const record = trackedTerminals.get(terminal);
			if (!record) { return; }
			trackedTerminals.delete(terminal);
			// Kill the linked session for this tab — does NOT kill the underlying
			// tmux window, which keeps running in the main session.
			tmux.killSession(record.tabSession, cfg.tmuxPath);
			state.write(context, buildStateFromTracked(session));
		}),
	);
}
