const API_KEY_SESSION_KEY = "discordClosedCaptionsApiKey";
const KEY_MODE_LOCAL_KEY = "discordClosedCaptionsKeyMode";
const VAULT_LOCAL_KEY = "discordClosedCaptionsKeyVault";
const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const AAD = "discord-closed-captions-api-key-v1";

export async function configureStorageAccess() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

export async function getApiKeyState() {
  const [session, local] = await Promise.all([
    chrome.storage.session.get(API_KEY_SESSION_KEY),
    chrome.storage.local.get([KEY_MODE_LOCAL_KEY, VAULT_LOCAL_KEY]),
  ]);

  const mode = local[KEY_MODE_LOCAL_KEY] === "vault" ? "vault" : "session";
  const available = Boolean(session[API_KEY_SESSION_KEY]);
  const hasVault = isVault(local[VAULT_LOCAL_KEY]);

  return {
    available,
    hasVault,
    locked: mode === "vault" && hasVault && !available,
    mode,
  };
}

export async function loadApiKey() {
  const stored = await chrome.storage.session.get(API_KEY_SESSION_KEY);
  return normalizeApiKey(stored[API_KEY_SESSION_KEY], { required: false });
}

export async function storeSessionApiKey(apiKey) {
  const normalized = normalizeApiKey(apiKey);
  await Promise.all([
    chrome.storage.session.set({ [API_KEY_SESSION_KEY]: normalized }),
    chrome.storage.local.set({ [KEY_MODE_LOCAL_KEY]: "session" }),
    chrome.storage.local.remove(VAULT_LOCAL_KEY),
  ]);
}

export async function storeEncryptedApiKey(apiKey, passphrase) {
  const normalized = normalizeApiKey(apiKey);
  validatePassphrase(passphrase);
  const vault = await encryptApiKey(normalized, passphrase);

  await Promise.all([
    chrome.storage.local.set({
      [KEY_MODE_LOCAL_KEY]: "vault",
      [VAULT_LOCAL_KEY]: vault,
    }),
    chrome.storage.session.set({ [API_KEY_SESSION_KEY]: normalized }),
  ]);
}

export async function unlockApiKey(passphrase) {
  const stored = await chrome.storage.local.get(VAULT_LOCAL_KEY);
  if (!isVault(stored[VAULT_LOCAL_KEY])) {
    throw new Error("No encrypted API key is configured.");
  }

  const apiKey = await decryptApiKey(stored[VAULT_LOCAL_KEY], passphrase);
  await chrome.storage.session.set({ [API_KEY_SESSION_KEY]: apiKey });
  return apiKey;
}

export async function lockApiKey() {
  await chrome.storage.session.remove(API_KEY_SESSION_KEY);
}

export async function clearApiKey() {
  await Promise.all([
    chrome.storage.session.remove(API_KEY_SESSION_KEY),
    chrome.storage.local.remove([KEY_MODE_LOCAL_KEY, VAULT_LOCAL_KEY]),
  ]);
}

export async function encryptApiKey(
  apiKey,
  passphrase,
  cryptoImpl = globalThis.crypto,
) {
  const normalized = normalizeApiKey(apiKey);
  validatePassphrase(passphrase);
  requireCrypto(cryptoImpl);

  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, cryptoImpl, ["encrypt"]);
  const ciphertext = await cryptoImpl.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encode(AAD),
    },
    key,
    encode(normalized),
  );

  return {
    version: VAULT_VERSION,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptApiKey(
  vault,
  passphrase,
  cryptoImpl = globalThis.crypto,
) {
  if (!isVault(vault)) {
    throw new Error("The encrypted API key has an unsupported format.");
  }
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("Enter the vault passphrase.");
  }
  requireCrypto(cryptoImpl);

  try {
    const salt = fromBase64(vault.salt);
    const iv = fromBase64(vault.iv);
    const key = await deriveKey(passphrase, salt, cryptoImpl, ["decrypt"]);
    const plaintext = await cryptoImpl.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encode(AAD),
      },
      key,
      fromBase64(vault.ciphertext),
    );
    return normalizeApiKey(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Could not unlock the API key. Check the passphrase.");
  }
}

export function normalizeApiKey(value, { required = true } = {}) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey && !required) {
    return "";
  }
  if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
    throw new Error("Enter a valid OpenAI API key.");
  }
  return apiKey;
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Use a vault passphrase with at least 12 characters.");
  }
  if (passphrase.length > 512) {
    throw new Error("The vault passphrase is too long.");
  }
}

async function deriveKey(passphrase, salt, cryptoImpl, usages) {
  const material = await cryptoImpl.subtle.importKey(
    "raw",
    encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return cryptoImpl.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function isVault(value) {
  return Boolean(
    value &&
      value.version === VAULT_VERSION &&
      value.cipher === "AES-GCM" &&
      value.kdf === "PBKDF2-SHA-256" &&
      value.iterations === PBKDF2_ITERATIONS &&
      typeof value.salt === "string" &&
      typeof value.iv === "string" &&
      typeof value.ciphertext === "string",
  );
}

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
