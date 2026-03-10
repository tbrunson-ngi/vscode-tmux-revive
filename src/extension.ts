import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as tmux from './tmux';
import * as state from './state';
import { getConfig, Config } from './config';
import {
	trackedTerminals,
	createAndTrackTerminal,
	registerLifecycleHooks,
	registerPendingTerminal,
} from './terminals';

// Tmux normalizes '.' and ':' in session names to '_'. We apply the same
// transformation up front so our has-session checks and new-session calls
// always agree on the name.
function sanitizeForTmux(s: string): string {
	return s.replace(/[.:]/g, '_');
}

function sessionName(workspacePath: string, naming: 'path' | 'basename'): string {
	if (naming === 'basename') {
		return `vscode-${sanitizeForTmux(path.basename(workspacePath))}`;
	}
	return `vscode-${sanitizeForTmux(workspacePath)}`;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function tabSessionName(session: string, index: number): string {
	return `${session}--w${index}`;
}

function terminalName(session: string): string {
	// session is "vscode-/full/path" or "vscode-basename" — strip prefix, take basename
	return path.basename(session.replace(/^vscode-/, ''));
}

async function createLinkedTerminal(
	session: string,
	index: number,
	label: string,
	cwd: string,
	context: vscode.ExtensionContext,
	cfg: Config,
): Promise<vscode.Terminal> {
	const tabSession = tabSessionName(session, index);
	await tmux.newLinkedSession(session, tabSession, index, cfg.tmuxPath);
	return createAndTrackTerminal(tabSession, index, label, cwd, context, cfg);
}

// Ensures the main session exists, creating it if needed.
// Returns 0 (the window newSession creates) if the session was just created, null otherwise.
async function ensureMainSession(session: string, cwd: string, cfg: Config): Promise<number | null> {
	if (!await tmux.sessionExists(session, cfg.tmuxPath)) {
		await tmux.newSession(session, cwd, cfg.tmuxPath);
		return 0;
	}
	return null;
}

// Gets the next window index, creating the session if it doesn't exist.
// Handles the race where a session is destroyed (last window closed) between
// the existence check and the new-window call.
async function getOrCreateWindow(session: string, cwd: string, cfg: Config): Promise<number> {
	const initial = await ensureMainSession(session, cwd, cfg);
	if (initial !== null) { return initial; }
	try {
		return await tmux.newWindow(session, cwd, cfg.tmuxPath);
	} catch {
		// Session was destroyed between our check and new-window (e.g. last window exited).
		await tmux.newSession(session, cwd, cfg.tmuxPath);
		return 0;
	}
}

async function restoreSession(
	session: string,
	context: vscode.ExtensionContext,
	cfg: Config,
): Promise<void> {
	if (!await tmux.sessionExists(session, cfg.tmuxPath)) {
		const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath;
		await tmux.newSession(session, cwd, cfg.tmuxPath);
		await createLinkedTerminal(session, 0, 'terminal', cwd, context, cfg);
		return;
	}

	const liveWindows = await tmux.listWindows(session, cfg.tmuxPath);
	await tmux.hideStatusBar(session, cfg.tmuxPath);

	if (liveWindows.length === 0) {
		const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath;
		const index = await getOrCreateWindow(session, cwd, cfg);
		await createLinkedTerminal(session, index, 'terminal', cwd, context, cfg);
		return;
	}

	const savedState = state.read(context);
	const openIndexes = new Set(Array.from(trackedTerminals.values()).map(r => r.index));

	for (const win of liveWindows) {
		if (openIndexes.has(win.index)) { continue; }
		const saved = savedState?.windows.find(w => w.windowIndex === win.index);
		const label = saved?.vscodeLabel ?? win.name;
		await createLinkedTerminal(session, win.index, label, win.cwd, context, cfg);
		await delay(80);
	}

	state.write(context, state.buildState(session, liveWindows, savedState));
}

class TmuxProfileProvider implements vscode.TerminalProfileProvider {
	constructor(
		private readonly session: string,
		private readonly context: vscode.ExtensionContext,
		private readonly cfg: Config,
	) {}

	async provideTerminalProfile(): Promise<vscode.TerminalProfile> {
		const slotId = Date.now().toString();
		const scriptPath = path.join(this.context.extensionPath, 'scripts', 'tmux-attach.sh');

		registerPendingTerminal(slotId, this.session);

		return new vscode.TerminalProfile({
			name: terminalName(this.session),
			shellPath: scriptPath,
			shellArgs: [slotId, this.session, this.cfg.tmuxPath, os.tmpdir()],
			env: { VSCODE_TMUX_REVIVE_SLOT: slotId },
			// No cwd — VS Code sets $PWD to the user-selected folder
		});
	}
}

function registerCommands(
	context: vscode.ExtensionContext,
	session: string,
	cfg: Config,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('tmuxRevive.newTerminal', async () => {
			const slotId = Date.now().toString();
			const scriptPath = path.join(context.extensionPath, 'scripts', 'tmux-attach.sh');

			registerPendingTerminal(slotId, session);

			vscode.window.createTerminal({
				name: terminalName(session),
				shellPath: scriptPath,
				shellArgs: [slotId, session, cfg.tmuxPath, os.tmpdir()],
				env: { VSCODE_TMUX_REVIVE_SLOT: slotId },
				// No cwd — VS Code defaults to active workspace folder
			}).show();
		}),

		vscode.commands.registerCommand('tmuxRevive.restoreSession', async () => {
			await restoreSession(session, context, cfg);
		}),

		vscode.commands.registerCommand('tmuxRevive.saveSession', async () => {
			const windows = await tmux.listWindows(session, cfg.tmuxPath);
			state.write(context, state.buildState(session, windows, null));
			vscode.window.showInformationMessage(`Tmux Revive: saved ${windows.length} terminal(s)`);
		}),
	);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const cfg = getConfig();
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

	if (!workspacePath) { return; }

	if (!await tmux.isAvailable(cfg.tmuxPath)) {
		vscode.window.showWarningMessage(
			`tmux-revive: tmux not found at "${cfg.tmuxPath}". Check tmuxRevive.tmuxPath setting.`,
		);
		return;
	}

	const session = sessionName(workspacePath, cfg.sessionNaming);

	context.subscriptions.push(
		vscode.window.registerTerminalProfileProvider('tmux-revive.tmux',
			new TmuxProfileProvider(session, context, cfg)),
	);

	registerCommands(context, session, cfg);
	registerLifecycleHooks(context, session, cfg);

	if (!cfg.autoRestore) { return; }

	if (await tmux.sessionExists(session, cfg.tmuxPath)) {
		await restoreSession(session, context, cfg);
	} else {
		await tmux.newSession(session, workspacePath, cfg.tmuxPath);
		await createLinkedTerminal(session, 0, 'terminal', workspacePath, context, cfg);
	}
}

export function deactivate(): void {}
