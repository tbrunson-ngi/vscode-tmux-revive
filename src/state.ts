import * as vscode from 'vscode';
import { TmuxWindow } from './tmux';

export interface WindowRecord {
	windowIndex: number;
	vscodeLabel: string;
	cwd: string;
}

export interface SessionState {
	version: 1;
	sessionName: string;
	windows: WindowRecord[];
	savedAt: number;
}

const STATE_KEY = 'tmuxRevive.session';

export function read(context: vscode.ExtensionContext): SessionState | undefined {
	return context.workspaceState.get<SessionState>(STATE_KEY);
}

export async function write(context: vscode.ExtensionContext, sessionState: SessionState): Promise<void> {
	await context.workspaceState.update(STATE_KEY, sessionState);
}

export function buildState(
	sessionName: string,
	liveWindows: TmuxWindow[],
	savedState: SessionState | null | undefined,
): SessionState {
	const windows: WindowRecord[] = liveWindows.map(win => {
		const saved = savedState?.windows.find(w => w.windowIndex === win.index);
		return {
			windowIndex: win.index,
			vscodeLabel: saved?.vscodeLabel ?? win.name,
			cwd: win.cwd,
		};
	});
	return {
		version: 1,
		sessionName,
		windows,
		savedAt: Date.now(),
	};
}
