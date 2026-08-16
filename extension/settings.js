export const DEFAULT_SETTINGS = Object.freeze({
  languages: ["en"],
  keywords: ["Discord"],
  prompt:
    "A casual Discord call between friends. Transcribe only speech, not background sounds.",
  saveTranscripts: true,
  speakerAttribution: true,
  transcribeSelf: false,
});

export async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);

  return normalizeSettings(stored);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set(normalized);
  return normalized;
}

export function normalizeSettings(settings = {}) {
  return {
    languages: cleanList(settings.languages, 6, 8),
    keywords: cleanList(settings.keywords, 30, 80),
    prompt: cleanString(settings.prompt, 500),
    saveTranscripts: cleanBoolean(
      settings.saveTranscripts,
      DEFAULT_SETTINGS.saveTranscripts,
    ),
    speakerAttribution: cleanBoolean(
      settings.speakerAttribution,
      DEFAULT_SETTINGS.speakerAttribution,
    ),
    transcribeSelf: cleanBoolean(
      settings.transcribeSelf,
      DEFAULT_SETTINGS.transcribeSelf,
    ),
  };
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

function cleanBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
