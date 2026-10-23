// Run by VS Code as "vscode:uninstall" after the extension is fully removed (not on updates).
// It runs in plain Node without the vscode API, so it only touches the filesystem.
import * as fs from 'fs';
import { uninstallHooks } from './hookInstaller';
import { NOTIFIER_DIR } from './paths';

try {
  uninstallHooks();
} catch {
  // Unparseable settings.json: leave it for the user rather than risk damaging it.
}
fs.rmSync(NOTIFIER_DIR, { recursive: true, force: true });
