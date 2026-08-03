import assert from "node:assert/strict";
import test from "node:test";

import {
  floatToPcm16,
  mixToMono,
  Pcm16Resampler,
} from "../../extension/pcm.js";

test("floatToPcm16 clamps and converts browser audio samples", () => {
  assert.equal(floatToPcm16(-2), -32768);
  assert.equal(floatToPcm16(-1), -32768);
  assert.equal(floatToPcm16(0), 0);
  assert.equal(floatToPcm16(1), 32767);
  assert.equal(floatToPcm16(2), 32767);
});

test("mixToMono averages stereo channels", () => {
  const mono = mixToMono([
    new Float32Array([1, -1]),
    new Float32Array([-1, 1]),
  ]);

  assert.deepEqual([...mono], [0, 0]);
});

test("Pcm16Resampler turns 48 kHz frames into 24 kHz 100 ms chunks", () => {
  const resampler = new Pcm16Resampler({
    sourceSampleRate: 48000,
    targetSampleRate: 24000,
    chunkDurationMs: 100,
  });
  const input = new Float32Array(4800).fill(0.25);
  const chunks = resampler.push([input]);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 2400);
  assert.equal(chunks[0][0], floatToPcm16(0.25));
});
