import * as os from 'os';
import * as path from 'path';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

/** Stable location for our files, independent of the extension's install folder (which changes per version). */
export const NOTIFIER_DIR = path.join(CLAUDE_DIR, 'claude-sound-notifier');
export const EVENTS_DIR = path.join(NOTIFIER_DIR, 'events');
export const HOOK_SCRIPT_PATH = path.join(NOTIFIER_DIR, 'hook.js');
