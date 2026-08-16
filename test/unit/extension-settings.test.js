import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSettings,
  parseList,
} from "../../extension/settings.js";

test("parseList trims comma-separated preferences", () => {
  assert.deepEqual(parseList("en, es,  fr "), ["en", "es", "fr"]);
});

test("normalizeSettings trims, deduplicates, and bounds caption preferences", () => {
  assert.deepEqual(
    normalizeSettings({
      languages: ["en", " en ", "fr"],
      keywords: ["Discord", "Discord", "A".repeat(100)],
      prompt: `  ${"context ".repeat(100)}  `,
    }),
    {
      languages: ["en", "fr"],
      keywords: ["Discord", "A".repeat(80)],
      prompt: "context ".repeat(100).trim().slice(0, 500),
      saveTranscripts: true,
      speakerAttribution: true,
      transcribeSelf: false,
    },
  );
});

test("normalizeSettings preserves explicit session feature choices", () => {
  const settings = normalizeSettings({
    saveTranscripts: false,
    speakerAttribution: false,
    transcribeSelf: false,
  });

  assert.equal(settings.saveTranscripts, false);
  assert.equal(settings.speakerAttribution, false);
  assert.equal(settings.transcribeSelf, false);
});
