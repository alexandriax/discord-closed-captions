import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../../server/config.js";

test("loadConfig applies safe local defaults", () => {
  const config = loadConfig({ OPENAI_API_KEY: "test-key" });

  assert.deepEqual(config, {
    apiKey: "test-key",
    accessKey: "",
    host: "127.0.0.1",
    transcriptionModel: "gpt-live-transcribe",
    port: 8787,
  });
});

test("loadConfig rejects a missing API key", () => {
  assert.throws(() => loadConfig({}), /OPENAI_API_KEY is required/);
});

test("loadConfig rejects invalid ports", () => {
  assert.throws(
    () => loadConfig({ OPENAI_API_KEY: "test-key", PORT: "70000" }),
    /PORT must be an integer/,
  );
});
