import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_SETTINGS_PATH, HOOK_SCRIPT_PATH, NOTIFIER_DIR } from './paths';

/** Every command we add contains this, so we can find and remove our own entries without touching the user's. */
const HOOK_MARKER = 'claude-sound-notifier/hook.js';

interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

type HooksConfig = Record<string, HookMatcher[]>;

/** Claude Code events we listen to. PermissionRequest and Notification can both fire for one prompt; the extension debounces. */
const HOOK_EVENTS: { event: string; matcher?: string }[] = [
  { event: 'Stop' },
  { event: 'PermissionRequest' },
  { event: 'Notification', matcher: 'permission_prompt|idle_prompt' },
];

function hookCommand(): string {
  // Forward slashes work on every platform and avoid JSON/shell escaping issues on Windows.
  return `node "${HOOK_SCRIPT_PATH.split(path.sep).join('/')}"`;
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }
  const text = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${CLAUDE_SETTINGS_PATH}: ${(err as Error).message}`);
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    fs.copyFileSync(CLAUDE_SETTINGS_PATH, `${CLAUDE_SETTINGS_PATH}.bak-sound-notifier`);
  }
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

function isOurs(matcher: HookMatcher): boolean {
  return matcher.hooks?.some((h) => h.command?.includes(HOOK_MARKER)) ?? false;
}

/** Returns the hooks config with all of our entries removed, dropping events left empty. */
function withoutOurHooks(hooks: HooksConfig): HooksConfig {
  const result: HooksConfig = {};
  for (const [event, matchers] of Object.entries(hooks)) {
    const kept = (matchers ?? []).filter((m) => !isOurs(m));
    if (kept.length > 0) {
      result[event] = kept;
    }
  }
  return result;
}

/** Copies the bundled hook script to its stable location so updates to the extension reach existing hooks. */
export function syncHookScript(extensionPath: string): void {
  fs.mkdirSync(NOTIFIER_DIR, { recursive: true });
  fs.copyFileSync(path.join(extensionPath, 'resources', 'hook.js'), HOOK_SCRIPT_PATH);
}

export function areHooksInstalled(): boolean {
  try {
    const hooks = (readSettings().hooks ?? {}) as HooksConfig;
    return HOOK_EVENTS.every(({ event }) => hooks[event]?.some(isOurs));
  } catch {
    return false;
  }
}

export function installHooks(extensionPath: string): void {
  syncHookScript(extensionPath);
  const settings = readSettings();
  const hooks = withoutOurHooks((settings.hooks ?? {}) as HooksConfig);
  for (const { event, matcher } of HOOK_EVENTS) {
    const entry: HookMatcher = {
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: hookCommand(), timeout: 5 }],
    };
    hooks[event] = [...(hooks[event] ?? []), entry];
  }
  settings.hooks = hooks;
  writeSettings(settings);
}

export function uninstallHooks(): void {
  const settings = readSettings();
  if (!settings.hooks) {
    return;
  }
  const hooks = withoutOurHooks(settings.hooks as HooksConfig);
  if (Object.keys(hooks).length > 0) {
    settings.hooks = hooks;
  } else {
    delete settings.hooks;
  }
  writeSettings(settings);
}
