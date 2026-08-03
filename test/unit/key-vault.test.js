import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptApiKey,
  encryptApiKey,
  normalizeApiKey,
} from "../../extension/key-vault.js";

const API_KEY = "definitely-not-a-real-api-key-0123456789";
const PASSPHRASE = "correct horse battery staple";

test("encrypted vault round-trips an API key without storing plaintext", async () => {
  const vault = await encryptApiKey(API_KEY, PASSPHRASE);

  assert.equal(JSON.stringify(vault).includes(API_KEY), false);
  assert.equal(JSON.stringify(vault).includes(PASSPHRASE), false);
  assert.equal(await decryptApiKey(vault, PASSPHRASE), API_KEY);
});

test("encrypted vault rejects an incorrect passphrase", async () => {
  const vault = await encryptApiKey(API_KEY, PASSPHRASE);

  await assert.rejects(
    decryptApiKey(vault, "this is the wrong passphrase"),
    /Could not unlock/,
  );
});

test("API key normalization rejects missing and malformed values", () => {
  assert.throws(() => normalizeApiKey(""), /valid OpenAI API key/);
  assert.throws(() => normalizeApiKey("short"), /valid OpenAI API key/);
  assert.throws(
    () => normalizeApiKey("test key with spaces and enough length"),
    /valid OpenAI API key/,
  );
});
