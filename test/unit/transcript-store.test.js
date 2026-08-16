import assert from "node:assert/strict";
import test from "node:test";

import {
  addTranscriptCaption,
  createTranscript,
  finishTranscript,
  formatTranscriptText,
} from "../../extension/transcript-store.js";

test("transcript store keeps finalized captions and speaker attribution", () => {
  const started = createTranscript({ sessionId: "session-1", startedAt: 1_000 });
  const withCaption = addTranscriptCaption(
    started,
    {
      itemId: "item-1",
      text: "Hello, everyone.",
      speaker: "Alex",
      speakerCandidates: ["Alex"],
    },
    1_500,
  );

  assert.equal(withCaption.entries.length, 1);
  assert.equal(withCaption.entries[0].speaker, "Alex");
  assert.equal(withCaption.entries[0].text, "Hello, everyone.");
  assert.equal(formatTranscriptText(withCaption), "Alex: Hello, everyone.");
});

test("transcript entries update by OpenAI item id without duplication", () => {
  const started = createTranscript({ sessionId: "session-1", startedAt: 1_000 });
  const first = addTranscriptCaption(
    started,
    { itemId: "item-1", text: "Hello", speaker: "Alex" },
    1_500,
  );
  const updated = addTranscriptCaption(
    first,
    { itemId: "item-1", text: "Hello there", speaker: "Alex" },
    1_600,
  );
  const finished = finishTranscript(updated, 2_000);

  assert.equal(finished.entries.length, 1);
  assert.equal(finished.entries[0].text, "Hello there");
  assert.equal(finished.endedAt, 2_000);
});
