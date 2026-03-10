import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Pending map for script-launched terminals: slotId → session.
// slotId is passed via env var VSCODE_TMUX_REVIVE_SLOT so we can use a
// human-readable terminal name instead of encoding the id in the name.
const pendingTerminals = new Map<string, { session: string }>();

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

export function registerPendingTerminal(slotId: string, session: string): void {
	pendingTerminals.set(slotId, { session });
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
		vscode.window.onDidOpenTerminal(async terminal => {
			const opts = terminal.creationOptions as vscode.TerminalOptions;
			const slotId = opts.env?.VSCODE_TMUX_REVIVE_SLOT;
			if (!slotId) { return; }
			const pending = pendingTerminals.get(slotId);
			if (!pending) { return; }
			pendingTerminals.delete(slotId);

			// Script writes the temp file just before exec'ing into tmux.
			// Retry a few times to handle the short race window.
			const tmpFile = path.join(os.tmpdir(), `vscode-tmux-revive-${slotId}`);
			let parsed: { index: number; tabSession: string; cwd: string } | undefined;
			for (let i = 0; i < 10; i++) {
				await delay(100);
				try {
					const raw = fs.readFileSync(tmpFile, 'utf8').trim();
					const [indexStr, tabSession, cwd] = raw.split(':');
					parsed = { index: parseInt(indexStr, 10), tabSession, cwd };
					fs.unlinkSync(tmpFile);
					break;
				} catch { /* not written yet */ }
			}
			if (!parsed) { return; }

			trackedTerminals.set(terminal, {
				index: parsed.index,
				label: `terminal-${parsed.index}`,
				cwd: parsed.cwd,
				tabSession: parsed.tabSession,
			});
			state.write(context, buildStateFromTracked(pending.session));
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
