import "dotenv/config";

import assert from "node:assert/strict";
import test from "node:test";

import { OpenAIRealtimeTranscriber } from "../../server/openai-realtime.js";

test(
  "gpt-live-transcribe accepts a realtime transcription session",
  { timeout: 20_000 },
  async () => {
    assert.ok(
      process.env.OPENAI_API_KEY,
      "OPENAI_API_KEY must be set to run the live test",
    );

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for session.updated")),
        15_000,
      );

      const transcriber = new OpenAIRealtimeTranscriber({
        apiKey: process.env.OPENAI_API_KEY,
        transcriptionModel:
          process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-live-transcribe",
        transcriptionConfig: {
          languages: ["en"],
          prompt: "A short connectivity test for live captions.",
        },
        onEvent(event) {
          if (event.type === "session.updated") {
            clearTimeout(timeout);
            transcriber.close();
            resolve();
          }

          if (event.type === "error") {
            clearTimeout(timeout);
            transcriber.close();
            reject(
              new Error(
                `${event.error?.code || "openai_error"}: ${
                  event.error?.message || "Unknown OpenAI error"
                }`,
              ),
            );
          }
        },
      });

      transcriber.connect();
    });
  },
);
