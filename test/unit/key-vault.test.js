import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptApiKey,
  encryptApiKey,
  getApiKeyState,
  loadApiKey,
  normalizeApiKey,
  storeDeviceApiKey,
  storeEncryptedApiKey,
  unlockApiKey,
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

test("device storage keeps the API key after session storage is cleared", async () => {
  globalThis.chrome = createChromeStorageMock();

  await storeDeviceApiKey(API_KEY);
  await chrome.storage.session.clear();

  assert.equal(await loadApiKey(), API_KEY);
  assert.deepEqual(await getApiKeyState(), {
    available: true,
    hasDeviceKey: true,
    hasVault: false,
    locked: false,
    mode: "device",
  });
});

test("encrypted vault survives a browser session and unlocks without the API key", async () => {
  globalThis.chrome = createChromeStorageMock();

  await storeEncryptedApiKey(API_KEY, PASSPHRASE);
  await chrome.storage.session.clear();

  assert.equal(await loadApiKey(), "");
  assert.equal((await getApiKeyState()).locked, true);
  assert.equal(await unlockApiKey(PASSPHRASE), API_KEY);
  assert.equal(await loadApiKey(), API_KEY);
});

function createChromeStorageMock() {
  return {
    storage: {
      local: createStorageArea(),
      session: createStorageArea(),
    },
  };
}

function createStorageArea() {
  const data = {};
  return {
    async get(keys) {
      if (typeof keys === "string") {
        return keys in data ? { [keys]: data[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => key in data).map((key) => [key, data[key]]),
        );
      }
      return { ...(keys || {}), ...data };
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
    async clear() {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    },
  };
}
