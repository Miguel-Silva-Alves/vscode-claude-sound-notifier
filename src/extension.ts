import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeEventWatcher, ClaudeHookEvent } from './eventWatcher';
import { areHooksInstalled, installHooks, syncHookScript, uninstallHooks } from './hookInstaller';
import { SoundPlayer } from './soundPlayer';

const CONFIG_SECTION = 'claudeSoundNotifier';
const DONT_ASK_KEY = 'claudeSoundNotifier.dontAskToInstall';
/** One approval prompt can trigger both PermissionRequest and Notification hooks; play once. */
const DEBOUNCE_MS = 2_000;

type Category = 'permission' | 'done' | 'idle';

const CATEGORY_INFO: Record<Category, { file: string; label: string }> = {
  permission: { file: 'permission.wav', label: 'Claude needs your approval' },
  done: { file: 'done.wav', label: 'Claude finished' },
  idle: { file: 'idle.wav', label: 'Claude is waiting for you' },
};

function categorize(event: ClaudeHookEvent): Category | undefined {
  switch (event.hookEvent) {
    case 'Stop':
      return 'done';
    case 'PermissionRequest':
      return 'permission';
    case 'Notification':
      if (event.notificationType === 'permission_prompt') {
        return 'permission';
      }
      if (event.notificationType === 'idle_prompt') {
        return 'idle';
      }
      return undefined;
    default:
      return undefined;
  }
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function isInWorkspace(cwd: string): boolean {
  const normalize = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const target = normalize(cwd);
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
    const root = normalize(folder.uri.fsPath);
    return target === root || target.startsWith(root + path.sep);
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const player = new SoundPlayer(path.join(context.extensionPath, 'media'));
  const lastPlayed = new Map<Category, number>();

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'claudeSoundNotifier.toggleMute';
  let flashTimer: NodeJS.Timeout | undefined;

  const renderStatusBar = () => {
    const enabled = config().get<boolean>('enabled', true);
    statusBar.text = enabled ? '$(bell) Claude' : '$(bell-slash) Claude';
    statusBar.tooltip = enabled ? 'Claude sounds on — click to mute' : 'Claude sounds muted — click to unmute';
    statusBar.backgroundColor = undefined;
  };

  const flashStatusBar = (category: Category) => {
    statusBar.text = `$(bell-dot) ${CATEGORY_INFO[category].label}`;
    if (category === 'permission') {
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(renderStatusBar, 5_000);
  };

  const playCategory = async (category: Category) => {
    const cfg = config();
    const file = player.resolveSound(cfg.get<string>(`${category}.sound`, 'default'), CATEGORY_INFO[category].file);
    if (!file) {
      return;
    }
    const repeat = Math.max(1, Math.min(10, Math.round(cfg.get<number>('repeat', 1))));
    for (let i = 0; i < repeat; i++) {
      await player.play(file, cfg.get<number>('volume', 70));
    }
  };

  const handleEvent = async (event: ClaudeHookEvent) => {
    const category = categorize(event);
    const cfg = config();
    if (!category || !cfg.get<boolean>('enabled', true) || !cfg.get<boolean>(`${category}.enabled`, true)) {
      return;
    }
    if (cfg.get<boolean>('onlyWhenWindowUnfocused', false) && vscode.window.state.focused) {
      return;
    }
    const now = Date.now();
    if (now - (lastPlayed.get(category) ?? 0) < DEBOUNCE_MS) {
      return;
    }
    lastPlayed.set(category, now);
    flashStatusBar(category);
    try {
      await playCategory(category);
    } catch (err) {
      vscode.window.showWarningMessage(`Claude Sound: ${(err as Error).message}`);
    }
  };

  const watcher = new ClaudeEventWatcher((event) => {
    if (!categorize(event)) {
      return false;
    }
    return config().get<string>('scope', 'workspace') === 'all' || isInWorkspace(event.cwd);
  });
  watcher.on('event', handleEvent);
  watcher.start();

  const runInstall = () => {
    try {
      installHooks(context.extensionPath);
      vscode.window.showInformationMessage(
        'Claude Code hooks installed. Restart running Claude sessions so they pick up the new hooks.',
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Could not install Claude Code hooks: ${(err as Error).message}`);
    }
  };

  context.subscriptions.push(
    statusBar,
    { dispose: () => watcher.dispose() },
    { dispose: () => clearTimeout(flashTimer) },
    vscode.commands.registerCommand('claudeSoundNotifier.installHooks', runInstall),
    vscode.commands.registerCommand('claudeSoundNotifier.uninstallHooks', () => {
      try {
        uninstallHooks();
        vscode.window.showInformationMessage('Claude Code hooks removed.');
      } catch (err) {
        vscode.window.showErrorMessage(`Could not remove Claude Code hooks: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('claudeSoundNotifier.toggleMute', async () => {
      const enabled = config().get<boolean>('enabled', true);
      await config().update('enabled', !enabled, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('claudeSoundNotifier.testSounds', async () => {
      try {
        for (const category of Object.keys(CATEGORY_INFO) as Category[]) {
          flashStatusBar(category);
          await playCategory(category);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Claude Sound: ${(err as Error).message}`);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        renderStatusBar();
      }
    }),
  );

  renderStatusBar();
  statusBar.show();

  if (areHooksInstalled()) {
    // Keep the copied hook script in sync with this version of the extension.
    syncHookScript(context.extensionPath);
  } else if (!context.globalState.get<boolean>(DONT_ASK_KEY)) {
    vscode.window
      .showInformationMessage(
        'Sound Notifier needs to add hooks to ~/.claude/settings.json to hear Claude Code events. Install them now?',
        'Install',
        'Not now',
        "Don't ask again",
      )
      .then((choice) => {
        if (choice === 'Install') {
          runInstall();
        } else if (choice === "Don't ask again") {
          context.globalState.update(DONT_ASK_KEY, true);
        }
      });
  }
}

export function deactivate(): void {}
