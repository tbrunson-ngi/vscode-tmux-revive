import * as vscode from 'vscode';

export interface Config {
	tmuxPath: string;
	autoRestore: boolean;
	sessionNaming: 'path' | 'basename';
}

export function getConfig(): Config {
	const cfg = vscode.workspace.getConfiguration('tmuxRevive');
	return {
		tmuxPath: cfg.get<string>('tmuxPath', '/opt/homebrew/bin/tmux'),
		autoRestore: cfg.get<boolean>('autoRestore', true),
		sessionNaming: cfg.get<'path' | 'basename'>('sessionNaming', 'path'),
	};
}
