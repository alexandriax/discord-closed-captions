export const TRANSCRIPT_STORAGE_KEY = "disccordLatestTranscript";

const TRANSCRIPT_VERSION = 1;
const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_TRANSCRIPT_CHARACTERS = 120_000;

export async function loadTranscript() {
  const stored = await chrome.storage.local.get(TRANSCRIPT_STORAGE_KEY);
  return normalizeTranscript(stored[TRANSCRIPT_STORAGE_KEY]);
}

export async function saveTranscript(transcript) {
  const normalized = normalizeTranscript(transcript);
  await chrome.storage.local.set({ [TRANSCRIPT_STORAGE_KEY]: normalized });
  return normalized;
}

export async function clearTranscript() {
  await chrome.storage.local.remove(TRANSCRIPT_STORAGE_KEY);
}

export function createTranscript({ sessionId, startedAt = Date.now() }) {
  return {
    version: TRANSCRIPT_VERSION,
    sessionId: cleanString(sessionId, 128) || String(startedAt),
    startedAt: cleanTimestamp(startedAt) || Date.now(),
    endedAt: null,
    entries: [],
  };
}

export function addTranscriptCaption(transcript, caption, now = Date.now()) {
  const normalized = normalizeTranscript(transcript);
  const text = cleanString(caption?.text, 8_000);
  if (!text) {
    return normalized;
  }

  const itemId = cleanString(caption?.itemId, 256) || `caption-${now}`;
  const existingIndex = normalized.entries.findIndex(
    (entry) => entry.itemId === itemId,
  );
  const existing = existingIndex >= 0 ? normalized.entries[existingIndex] : null;
  const entry = {
    itemId,
    text,
    speaker: cleanString(caption?.speaker, 160),
    speakerCandidates: cleanStringList(caption?.speakerCandidates, 4, 80),
    createdAt: existing?.createdAt || cleanTimestamp(caption?.createdAt) || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    normalized.entries.splice(existingIndex, 1, entry);
  } else {
    normalized.entries.push(entry);
  }

  return trimTranscript(normalized);
}

export function finishTranscript(transcript, endedAt = Date.now()) {
  const normalized = normalizeTranscript(transcript);
  normalized.endedAt = cleanTimestamp(endedAt) || Date.now();
  return normalized;
}

export function formatTranscriptText(transcript) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) {
    return "";
  }
  return normalized.entries
    .map((entry) => `${entry.speaker || "Unknown speaker"}: ${entry.text}`)
    .join("\n\n");
}

export function normalizeTranscript(value) {
  if (!value || value.version !== TRANSCRIPT_VERSION) {
    return null;
  }

  const startedAt = cleanTimestamp(value.startedAt);
  if (!startedAt || !Array.isArray(value.entries)) {
    return null;
  }

  return trimTranscript({
    version: TRANSCRIPT_VERSION,
    sessionId: cleanString(value.sessionId, 128) || String(startedAt),
    startedAt,
    endedAt: cleanTimestamp(value.endedAt),
    entries: value.entries
      .map((entry) => normalizeEntry(entry))
      .filter(Boolean),
  });
}

function normalizeEntry(entry) {
  const itemId = cleanString(entry?.itemId, 256);
  const text = cleanString(entry?.text, 8_000);
  if (!itemId || !text) {
    return null;
  }
  const createdAt = cleanTimestamp(entry.createdAt) || Date.now();
  return {
    itemId,
    text,
    speaker: cleanString(entry.speaker, 160),
    speakerCandidates: cleanStringList(entry.speakerCandidates, 4, 80),
    createdAt,
    updatedAt: cleanTimestamp(entry.updatedAt) || createdAt,
  };
}

function trimTranscript(transcript) {
  transcript.entries = transcript.entries.slice(-MAX_TRANSCRIPT_ENTRIES);
  let characterCount = transcript.entries.reduce(
    (total, entry) => total + entry.text.length + entry.speaker.length,
    0,
  );
  while (
    transcript.entries.length > 1 &&
    characterCount > MAX_TRANSCRIPT_CHARACTERS
  ) {
    const [removed] = transcript.entries.splice(0, 1);
    characterCount -= removed.text.length + removed.speaker.length;
  }
  return transcript;
}

function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean)),
  ].slice(0, maxItems);
}

function cleanTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}
