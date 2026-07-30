export const DEFAULT_SETTINGS = Object.freeze({
  relayUrl: "ws://127.0.0.1:8787/captions",
  accessKey: "",
  languages: ["en"],
  keywords: ["Disccord", "Discord"],
  prompt:
    "A casual video call between friends. Transcribe only speech, not background sounds.",
});

export async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);

  return {
    relayUrl: validateRelayUrl(stored.relayUrl),
    accessKey: cleanString(stored.accessKey, 200),
    languages: cleanList(stored.languages, 6, 8),
    keywords: cleanList(stored.keywords, 30, 80),
    prompt: cleanString(stored.prompt, 500),
  };
}

export async function saveSettings(settings) {
  const normalized = {
    relayUrl: validateRelayUrl(settings.relayUrl),
    accessKey: cleanString(settings.accessKey, 200),
    languages: cleanList(settings.languages, 6, 8),
    keywords: cleanList(settings.keywords, 30, 80),
    prompt: cleanString(settings.prompt, 500),
  };

  await chrome.storage.local.set(normalized);
  return normalized;
}

export function parseList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateRelayUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_SETTINGS.relayUrl);
  } catch {
    throw new Error("Relay URL must be a valid WebSocket URL.");
  }

  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Relay URL must start with ws:// or wss://.");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (url.protocol === "ws:" && !localHosts.has(url.hostname)) {
    throw new Error("Remote relays must use encrypted wss://.");
  }

  return url.toString();
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value, maxItems, maxLength) {
  return [
    ...new Set(
      parseList(value)
        .map((item) => cleanString(item, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

