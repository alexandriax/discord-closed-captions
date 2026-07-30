import assert from "node:assert/strict";
import test from "node:test";

import {
  parseList,
  validateRelayUrl,
} from "../../extension/settings.js";

test("validateRelayUrl allows local ws and remote wss", () => {
  assert.equal(
    validateRelayUrl("ws://127.0.0.1:8787/captions"),
    "ws://127.0.0.1:8787/captions",
  );
  assert.equal(
    validateRelayUrl("wss://captions.example.com/captions"),
    "wss://captions.example.com/captions",
  );
});

test("validateRelayUrl refuses unencrypted remote relays", () => {
  assert.throws(
    () => validateRelayUrl("ws://captions.example.com/captions"),
    /Remote relays must use encrypted wss/,
  );
});

test("parseList trims comma-separated preferences", () => {
  assert.deepEqual(parseList("en, es,  fr "), ["en", "es", "fr"]);
});

