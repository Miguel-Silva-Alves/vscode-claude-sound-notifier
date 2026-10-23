// Synthesizes the built-in notification sounds as 16-bit mono WAV files,
// so the extension ships no third-party audio assets.
'use strict';

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(__dirname, '..', 'media');

/** A bell-like note: a few harmonics with a short attack and exponential decay. */
function renderNotes(notes, totalSeconds) {
  const samples = new Float32Array(Math.ceil(totalSeconds * SAMPLE_RATE));
  for (const { freq, start, duration, decay, gain = 1 } of notes) {
    const offset = Math.floor(start * SAMPLE_RATE);
    const length = Math.floor(duration * SAMPLE_RATE);
    for (let i = 0; i < length && offset + i < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.005);
      const envelope = attack * Math.exp(-t * decay);
      const tone =
        Math.sin(2 * Math.PI * freq * t) +
        0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
        0.12 * Math.sin(2 * Math.PI * freq * 3 * t);
      samples[offset + i] += gain * envelope * tone;
    }
  }
  return normalize(samples, 0.8);
}

function normalize(samples, peak) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max > 0) for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] / max) * peak;
  return samples;
}

function toWav(samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((s, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buffer;
}

const sounds = {
  // Two rising notes that ask for attention: B5 -> E6.
  'permission.wav': renderNotes(
    [
      { freq: 987.77, start: 0, duration: 0.45, decay: 7 },
      { freq: 1318.51, start: 0.16, duration: 0.6, decay: 6 },
    ],
    0.8,
  ),
  // A relaxed C major arpeggio: task complete.
  'done.wav': renderNotes(
    [
      { freq: 523.25, start: 0, duration: 0.9, decay: 4, gain: 0.8 },
      { freq: 659.25, start: 0.09, duration: 0.9, decay: 4, gain: 0.8 },
      { freq: 783.99, start: 0.18, duration: 0.9, decay: 4, gain: 0.8 },
      { freq: 1046.5, start: 0.27, duration: 0.9, decay: 4 },
    ],
    1.2,
  ),
  // A single soft tap: still waiting for you.
  'idle.wav': renderNotes([{ freq: 880, start: 0, duration: 0.4, decay: 9, gain: 0.6 }], 0.45),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(OUT_DIR, name), toWav(samples));
  console.log(`wrote media/${name}`);
}
