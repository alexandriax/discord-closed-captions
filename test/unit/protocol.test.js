import assert from "node:assert/strict";
import test from "node:test";

import {
  isAccessKeyValid,
  parseStartMessage,
  ProtocolError,
  sanitizeTranscriptionConfig,
  toClientEvent,
} from "../../server/protocol.js";

test("parseStartMessage accepts and sanitizes caption preferences", () => {
  const message = parseStartMessage(
    JSON.stringify({
      type: "start",
      accessKey: "friend-key",
      config: {
        prompt: "A casual Discord call.\nNoisy room.",
        keywords: ["Disccord", "Disccord", "<invalid>", 42],
        languages: ["EN", "fr", "not-a-language"],
      },
    }),
  );

  assert.deepEqual(message, {
    accessKey: "friend-key",
    config: {
      prompt: "A casual Discord call. Noisy room.",
      keywords: ["Disccord"],
      languages: ["en", "fr"],
    },
  });
});

test("parseStartMessage requires a start event", () => {
  assert.throws(
    () => parseStartMessage('{"type":"audio"}'),
    (error) =>
      error instanceof ProtocolError && error.code === "start_required",
  );
});

test("sanitizeTranscriptionConfig returns an empty object for junk", () => {
  assert.deepEqual(sanitizeTranscriptionConfig("junk"), {});
});

test("isAccessKeyValid supports optional keys and exact matching", () => {
  assert.equal(isAccessKeyValid("", ""), true);
  assert.equal(isAccessKeyValid("secret", "secret"), true);
  assert.equal(isAccessKeyValid("secret", "wrong"), false);
  assert.equal(isAccessKeyValid("secret", "longer-secret"), false);
});

test("toClientEvent maps streaming and final transcripts", () => {
  assert.deepEqual(
    toClientEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "Good ",
    }),
    {
      type: "caption",
      final: false,
      itemId: "item-1",
      text: "Good ",
    },
  );

  assert.deepEqual(
    toClientEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "Good morning.",
    }),
    {
      type: "caption",
      final: true,
      itemId: "item-1",
      text: "Good morning.",
    },
  );
});

