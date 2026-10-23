import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { EVENTS_DIR } from './paths';

export interface ClaudeHookEvent {
  hookEvent: string;
  notificationType?: string;
  toolName?: string;
  cwd: string;
  sessionId?: string;
  timestamp: number;
}

/** Events older than this are not worth a sound (e.g. written while VS Code was closed). */
const MAX_EVENT_AGE_MS = 10_000;
/** Unclaimed event files older than this are deleted. */
const STALE_FILE_AGE_MS = 60_000;
const SWEEP_INTERVAL_MS = 3_000;

/**
 * Watches the events folder written by hook.js. Several VS Code windows may watch the same folder,
 * so each event is "claimed" with an atomic rename: only the window whose rename succeeds handles it.
 */
export class ClaudeEventWatcher extends EventEmitter {
  private watcher?: fs.FSWatcher;
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly shouldHandle: (event: ClaudeHookEvent) => boolean) {
    super();
  }

  start(): void {
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
    try {
      this.watcher = fs.watch(EVENTS_DIR, (_type, filename) => {
        if (filename?.endsWith('.json')) {
          this.processFile(path.join(EVENTS_DIR, filename));
        }
      });
    } catch {
      // fs.watch is unavailable on some filesystems; the periodic sweep still picks events up.
    }
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweep();
  }

  dispose(): void {
    this.watcher?.close();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.removeAllListeners();
  }

  private sweep(): void {
    let files: string[];
    try {
      files = fs.readdirSync(EVENTS_DIR);
    } catch {
      return;
    }
    const now = Date.now();
    for (const file of files) {
      const fullPath = path.join(EVENTS_DIR, file);
      if (file.endsWith('.json')) {
        this.processFile(fullPath);
      } else {
        // Leftover .tmp/.claimed files from crashed writers or windows.
        this.deleteIfOlderThan(fullPath, now, STALE_FILE_AGE_MS);
      }
    }
  }

  private processFile(filePath: string): void {
    let event: ClaudeHookEvent;
    try {
      event = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return; // Already claimed by another window, or not readable yet.
    }

    const age = Date.now() - event.timestamp;
    if (age > MAX_EVENT_AGE_MS) {
      this.deleteIfOlderThan(filePath, Date.now(), STALE_FILE_AGE_MS);
      return;
    }
    if (!this.shouldHandle(event)) {
      return; // Leave it for a window whose workspace matches.
    }

    const claimedPath = `${filePath}.${process.pid}.claimed`;
    try {
      fs.renameSync(filePath, claimedPath);
    } catch {
      return; // Another window won the race.
    }
    fs.rmSync(claimedPath, { force: true });
    this.emit('event', event);
  }

  private deleteIfOlderThan(filePath: string, now: number, maxAgeMs: number): void {
    try {
      if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      // Already gone.
    }
  }
}
