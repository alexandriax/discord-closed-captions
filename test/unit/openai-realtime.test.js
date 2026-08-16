import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTranscriptionSession,
  mapOpenAIEvent,
  mintEphemeralToken,
} from "../../extension/openai-realtime.js";

test("buildTranscriptionSession configures GPT-Live-Transcribe PCM input", () => {
  assert.deepEqual(
    buildTranscriptionSession({
      languages: ["en", "fr"],
      keywords: ["Discord"],
      prompt: "A call between friends.",
    }),
    {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: {
            model: "gpt-live-transcribe",
            delay: "low",
            prompt: "A call between friends.",
            keywords: ["Discord"],
            languages: ["en", "fr"],
          },
          turn_detection: null,
        },
      },
    },
  );
});

test("mintEphemeralToken exchanges the user key without returning it", async () => {
  const calls = [];
  const token = await mintEphemeralToken({
    apiKey: "definitely-not-a-real-user-key-1234567890",
    settings: { languages: ["en"] },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { value: "ek_short_lived" };
        },
      };
    },
  });

  assert.equal(token, "ek_short_lived");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.openai.com/v1/realtime/client_secrets",
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer definitely-not-a-real-user-key-1234567890",
  );
  assert.equal(JSON.parse(calls[0].options.body).session.type, "transcription");
});

test("mapOpenAIEvent maps streaming and completed transcripts", () => {
  assert.deepEqual(
    mapOpenAIEvent({
      type: "input_audio_buffer.committed",
      item_id: "item-1",
    }),
    {
      type: "disccord:segment-committed",
      itemId: "item-1",
    },
  );

  assert.deepEqual(
    mapOpenAIEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "Good ",
    }),
    {
      type: "disccord:caption",
      final: false,
      itemId: "item-1",
      text: "Good ",
    },
  );

  assert.deepEqual(
    mapOpenAIEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "Good morning.",
    }),
    {
      type: "disccord:caption",
      final: true,
      itemId: "item-1",
      text: "Good morning.",
    },
  );
});

test("mapOpenAIEvent redacts credentials from upstream error text", () => {
  const fakeCredential = ["sk", "sensitive-looking-value-1234567890"].join("-");
  const mapped = mapOpenAIEvent({
    type: "error",
    error: {
      code: "test_error",
      message: `Request used Bearer ${fakeCredential}`,
    },
  });

  assert.equal(mapped.message.includes(fakeCredential), false);
  assert.match(mapped.message, /redacted/);
});
