import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export async function isAvailable(tmuxPath: string): Promise<boolean> {
	try {
		await exec(tmuxPath, ['-V']);
		return true;
	} catch {
		return false;
	}
}

export async function sessionExists(sessionName: string, tmuxPath: string): Promise<boolean> {
	try {
		await exec(tmuxPath, ['has-session', '-t', sessionName]);
		return true;
	} catch {
		return false;
	}
}

export async function newSession(sessionName: string, cwd: string, tmuxPath: string): Promise<void> {
	await exec(tmuxPath, ['new-session', '-d', '-s', sessionName, '-c', cwd, '-x', '220', '-y', '50']);
	await exec(tmuxPath, ['set-option', '-t', sessionName, 'status', 'off']);
}

export async function newWindow(sessionName: string, cwd: string, tmuxPath: string): Promise<number> {
	const { stdout } = await exec(tmuxPath, [
		'new-window', '-t', sessionName, '-c', cwd, '-P', '-F', '#{window_index}',
	]);
	return parseInt(stdout.trim(), 10);
}

export async function hideStatusBar(sessionName: string, tmuxPath: string): Promise<void> {
	await exec(tmuxPath, ['set-option', '-t', sessionName, 'status', 'off']);
}

export interface TmuxWindow {
	index: number;
	name: string;
	cwd: string;
}

export async function newLinkedSession(
	mainSession: string,
	tabSession: string,
	windowIndex: number,
	tmuxPath: string,
): Promise<void> {
	// Kill any stale linked session from a previous crash before recreating.
	try { await exec(tmuxPath, ['kill-session', '-t', tabSession]); } catch { /* didn't exist */ }
	await exec(tmuxPath, ['new-session', '-d', '-t', mainSession, '-s', tabSession]);
	await exec(tmuxPath, ['select-window', '-t', `${tabSession}:${windowIndex}`]);
}

export async function killSession(sessionName: string, tmuxPath: string): Promise<void> {
	try { await exec(tmuxPath, ['kill-session', '-t', sessionName]); } catch { /* already gone */ }
}

export async function listWindows(sessionName: string, tmuxPath: string): Promise<TmuxWindow[]> {
	try {
		const { stdout } = await exec(tmuxPath, [
			'list-windows', '-t', sessionName, '-F', '#{window_index}|#{window_name}|#{pane_current_path}',
		]);
		return stdout.trim().split('\n').filter(Boolean).map(line => {
			const [indexStr, name, cwd] = line.split('|');
			return { index: parseInt(indexStr, 10), name, cwd };
		});
	} catch {
		return [];
	}
}
