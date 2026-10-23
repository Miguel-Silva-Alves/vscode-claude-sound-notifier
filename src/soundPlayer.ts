import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Builds the argv for a player given the file and a 0..1 volume. */
type PlayerArgs = (file: string, volume: number) => string[];

const LINUX_PLAYERS: [string, PlayerArgs][] = [
  ['paplay', (file, volume) => ['--volume', String(Math.round(volume * 65536)), file]],
  ['pw-play', (file, volume) => ['--volume', volume.toFixed(2), file]],
  ['aplay', (file) => ['-q', file]],
];

/**
 * Plays WAV files through the OS's own command-line player. The extension host has no audio API,
 * and this avoids shipping native binaries or opening a webview.
 */
export class SoundPlayer {
  private linuxPlayerIndex = 0;

  constructor(private readonly mediaDir: string) {}

  /** Resolves a setting value ("default", "none" or a file path) to a playable file, or undefined for silence. */
  resolveSound(setting: string, builtInName: string): string | undefined {
    const value = setting.trim();
    if (!value || value === 'default') {
      return path.join(this.mediaDir, builtInName);
    }
    if (value === 'none') {
      return undefined;
    }
    const expanded = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
    if (!fs.existsSync(expanded)) {
      throw new Error(`Sound file not found: ${expanded}`);
    }
    return expanded;
  }

  play(file: string, volumePercent: number): Promise<void> {
    const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
    switch (process.platform) {
      case 'darwin':
        return run('afplay', ['-v', volume.toFixed(2), file]);
      case 'win32':
        return run('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`,
        ]);
      default:
        return this.playLinux(file, volume);
    }
  }

  /** Tries each Linux player in order and remembers the first one that is installed. */
  private async playLinux(file: string, volume: number): Promise<void> {
    while (this.linuxPlayerIndex < LINUX_PLAYERS.length) {
      const [command, args] = LINUX_PLAYERS[this.linuxPlayerIndex];
      try {
        return await run(command, args(file, volume));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        this.linuxPlayerIndex++;
      }
    }
    throw new Error('No audio player found. Install pulseaudio-utils (paplay), pipewire (pw-play) or alsa-utils (aplay).');
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}
