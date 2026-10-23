#!/usr/bin/env node
// Invoked by Claude Code hooks. Reads the hook payload from stdin and drops it
// into the events folder watched by the "Sound Notifier for Claude Code" extension.
// It must never print to stdout or fail loudly: Claude Code reads hook output.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS_DIR = path.join(os.homedir(), '.claude', 'claude-sound-notifier', 'events');

let raw = '';
const finish = () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const event = {
      hookEvent: payload.hook_event_name || process.argv[2] || 'unknown',
      notificationType: payload.notification_type,
      toolName: payload.tool_name,
      cwd: payload.cwd || process.cwd(),
      sessionId: payload.session_id,
      timestamp: Date.now(),
    };
    fs.mkdirSync(EVENTS_DIR, { recursive: true });
    const name = `${event.timestamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const tmp = path.join(EVENTS_DIR, `${name}.tmp`);
    // Write then rename so the watcher never sees a half-written file.
    fs.writeFileSync(tmp, JSON.stringify(event));
    fs.renameSync(tmp, path.join(EVENTS_DIR, `${name}.json`));
  } catch {
    // Swallow everything: a sound notifier must never break Claude.
  }
  process.exit(0);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', finish);
setTimeout(finish, 2000).unref();
