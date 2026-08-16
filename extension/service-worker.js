import {
  configureStorageAccess,
  getApiKeyState,
  loadApiKey,
} from "./key-vault.js";
import { loadSettings, saveSettings } from "./settings.js";
import { SpeakerAttributionTracker } from "./speaker-attribution.js";
import {
  addTranscriptCaption,
  clearTranscript,
  createTranscript,
  finishTranscript,
  loadTranscript,
  saveTranscript,
} from "./transcript-store.js";

const SESSION_KEY = "disccordActiveTabId";
const SESSION_METADATA_KEY = "disccordActiveSession";
const DISCORD_URL = /^https:\/\/discord\.com\//;

const speakerTracker = new SpeakerAttributionTracker();
let activeSettings = null;
let activeTranscript = null;
let discordSpeakers = [];
let segmentAttributions = new Map();
let selfName = "You";
let selfSpeaking = false;
let transcriptQueue = Promise.resolve();

configureStorageAccess().catch(() => {});

chrome.runtime.onInstalled.addListener(async (details) => {
  await configureStorageAccess();
  chrome.action.setBadgeBackgroundColor({ color: "#5865f2" });

  if (details.reason === "install") {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.target !== "service-worker"
  ) {
    return undefined;
  }

  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getActiveTabId()) === tabId) {
    await stopCapture(tabId);
  }
});

async function startCapture(tab) {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    const keyState = await getApiKeyState();
    throw new Error(
      keyState.locked
        ? "Unlock your saved OpenAI API key first."
        : "Add your OpenAI API key in extension settings first.",
    );
  }

  if (!tab?.id || !DISCORD_URL.test(tab.url || "")) {
    await setBadge(tab?.id, "!", "#ed4245");
    throw new Error("Open Discord Web in the active tab before starting captions.");
  }

  const alreadyActiveTabId = await getActiveTabId();
  if (alreadyActiveTabId !== null) {
    if (alreadyActiveTabId === tab.id) {
      return;
    }
    throw new Error("Captions are already running in another Discord tab.");
  }

  await ensureOffscreenDocument();
  const settings = await loadSettings();
  const session = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    tabId: tab.id,
  };
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });

  resetSpeakerTracking();
  activeSettings = settings;
  await chrome.storage.session.set({
    [SESSION_KEY]: tab.id,
    [SESSION_METADATA_KEY]: session,
  });
  await setBadge(tab.id, "CC", "#5865f2");
  await setActionTitle(tab.id, "Discord captions are running");
  await sendToTab(tab.id, {
    type: "disccord:status",
    status: "capturing",
    message: "Capturing Discord audio…",
  });

  try {
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "disccord:start",
      streamId,
      tabId: tab.id,
      apiKey,
      settings,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Discord audio capture could not start.");
    }

    if (settings.saveTranscripts) {
      activeTranscript = createTranscript({
        sessionId: session.id,
        startedAt: session.startedAt,
      });
      await saveTranscript(activeTranscript);
    }
  } catch (error) {
    await clearActiveState(tab.id);
    await sendToTab(tab.id, {
      type: "disccord:error",
      fatal: true,
      message: error.message,
    });
    throw error;
  }
}

async function stopCapture(tabId) {
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "disccord:stop",
    });
  } catch {
    // The offscreen document may already have stopped after a fatal error.
  }
  await finishActiveTranscript();
  await clearActiveState(tabId);
  await sendToTab(tabId, { type: "disccord:stopped" });
}

async function handleMessage(message, sender) {
  if (message.type === "disccord:offscreen-event") {
    return handleOffscreenEvent(message);
  }

  if (message.type === "disccord:get-state") {
    const tabId = sender.tab?.id;
    const activeTabId = await getActiveTabId();
    return {
      ok: true,
      active: tabId !== undefined && activeTabId === tabId,
      activeTabId,
    };
  }

  if (message.type === "disccord:start-request") {
    const tab = await chrome.tabs.get(message.tabId);
    await startCapture(tab);
    return { ok: true };
  }

  if (message.type === "disccord:stop-request") {
    const tabId = sender.tab?.id ?? (await getActiveTabId());
    if (tabId !== null && tabId !== undefined) {
      await stopCapture(tabId);
    }
    return { ok: true };
  }

  if (message.type === "disccord:speakers") {
    const activeTabId = await getActiveTabId();
    if (sender.tab?.id !== activeTabId) {
      return { ok: false };
    }
    discordSpeakers = Array.isArray(message.speakers) ? message.speakers : [];
    if (typeof message.selfName === "string" && message.selfName.trim()) {
      selfName = message.selfName.trim().slice(0, 80);
    }
    addCombinedSpeakerSample(message.at);
    return { ok: true };
  }

  if (message.type === "disccord:update-settings") {
    const previous = activeSettings || (await loadSettings());
    const settings = await saveSettings({ ...previous, ...message.settings });
    activeSettings = (await getActiveTabId()) === null ? null : settings;
    await handleTranscriptSettingChange(previous, settings);
    return { ok: true, settings };
  }

  if (message.type === "disccord:clear-transcript") {
    await clearTranscript();
    activeTranscript = null;
    const session = await getActiveSession();
    const settings = activeSettings || (await loadSettings());
    if (session && settings.saveTranscripts) {
      activeTranscript = createTranscript({
        sessionId: session.id,
        startedAt: session.startedAt,
      });
      await saveTranscript(activeTranscript);
    }
    return { ok: true };
  }

  return { ok: false };
}

async function handleOffscreenEvent(message) {
  const tabId = message.tabId ?? (await getActiveTabId());
  if (tabId === null) {
    return { ok: false };
  }

  const payload = message.payload;
  if (payload?.type === "disccord:self-speaking") {
    selfSpeaking = Boolean(payload.active);
    addCombinedSpeakerSample(payload.at);
    return { ok: true };
  }

  if (payload?.type === "disccord:segment-committed") {
    if (payload.itemId) {
      segmentAttributions.set(
        payload.itemId,
        speakerTracker.attribute(Date.now()),
      );
      trimSegmentAttributions();
    }
    return { ok: true };
  }

  const settings = activeSettings || (await loadSettings());
  activeSettings = settings;
  const attribution =
    segmentAttributions.get(payload?.itemId) ||
    speakerTracker.attribute(Date.now());
  const enriched =
    payload?.type === "disccord:caption" && settings.speakerAttribution
      ? { ...payload, ...attribution }
      : payload;

  // Render first; transcript persistence and badge work never gate live captions.
  await sendToTab(tabId, enriched);
  await updateBadgeForEvent(tabId, enriched);

  if (enriched?.type === "disccord:caption" && enriched.final) {
    await recordTranscriptCaption(enriched);
    segmentAttributions.delete(enriched.itemId);
  }

  if (enriched?.type === "disccord:error" && enriched.fatal) {
    await finishActiveTranscript();
    await clearActiveState(tabId);
  }

  if (enriched?.type === "disccord:stopped") {
    await finishActiveTranscript();
    await clearActiveState(tabId);
  }
  return { ok: true };
}

async function recordTranscriptCaption(caption) {
  if (!activeSettings?.saveTranscripts) {
    return;
  }
  await queueTranscriptWrite(async () => {
    const session = await getActiveSession();
    const transcript = activeTranscript || (await loadTranscript());
    if (!session || !transcript || transcript.sessionId !== session.id) {
      return;
    }
    activeTranscript = addTranscriptCaption(transcript, caption);
    await saveTranscript(activeTranscript);
  });
}

async function finishActiveTranscript() {
  await queueTranscriptWrite(async () => {
    const session = await getActiveSession();
    const transcript = activeTranscript || (await loadTranscript());
    if (
      !session ||
      !transcript ||
      transcript.sessionId !== session.id ||
      transcript.endedAt
    ) {
      activeTranscript = transcript;
      return;
    }
    activeTranscript = finishTranscript(transcript);
    await saveTranscript(activeTranscript);
  });
}

async function handleTranscriptSettingChange(previous, settings) {
  const session = await getActiveSession();
  if (!session) {
    return;
  }
  if (previous.saveTranscripts && !settings.saveTranscripts) {
    await finishActiveTranscript();
  }
  if (!previous.saveTranscripts && settings.saveTranscripts) {
    activeTranscript = createTranscript({
      sessionId: session.id,
      startedAt: Date.now(),
    });
    await saveTranscript(activeTranscript);
  }
}

function queueTranscriptWrite(operation) {
  transcriptQueue = transcriptQueue.then(operation, operation);
  return transcriptQueue;
}

function addCombinedSpeakerSample(at) {
  const timestamp =
    Number.isFinite(at) && Math.abs(Date.now() - at) < 15_000 ? at : Date.now();
  const speakers = selfSpeaking
    ? [...discordSpeakers, selfName || "You"]
    : discordSpeakers;
  speakerTracker.addSample(speakers, timestamp);
}

function resetSpeakerTracking() {
  speakerTracker.reset();
  discordSpeakers = [];
  segmentAttributions = new Map();
  selfName = "You";
  selfSpeaking = false;
}

function trimSegmentAttributions() {
  while (segmentAttributions.size > 128) {
    segmentAttributions.delete(segmentAttributions.keys().next().value);
  }
}

async function updateBadgeForEvent(tabId, event) {
  if (event?.type === "disccord:status") {
    if (event.status === "ready") {
      await setBadge(tabId, "CC", "#23a55a");
    } else if (event.status === "connecting") {
      await setBadge(tabId, "…", "#f0b232");
    }
  }

  if (event?.type === "disccord:error") {
    await setBadge(tabId, "!", "#ed4245");
  }
}

async function clearActiveState(tabId) {
  await chrome.storage.session.remove([SESSION_KEY, SESSION_METADATA_KEY]);
  await setBadge(tabId, "", "#5865f2");
  await setActionTitle(tabId, "Open Discord closed captions");
  activeSettings = null;
  activeTranscript = null;
  resetSpeakerTracking();
}

async function getActiveTabId() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return Number.isInteger(stored[SESSION_KEY]) ? stored[SESSION_KEY] : null;
}

async function getActiveSession() {
  const stored = await chrome.storage.session.get(SESSION_METADATA_KEY);
  const session = stored[SESSION_METADATA_KEY];
  return session && Number.isInteger(session.tabId) ? session : null;
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification:
        "Capture Discord tab audio and, when enabled, the user's microphone for captions.",
    });
  }
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Discord may still be loading; the content script requests state on mount.
  }
}

async function setBadge(tabId, text, color) {
  if (!tabId) {
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
}

async function setActionTitle(tabId, title) {
  if (tabId) {
    await chrome.action.setTitle({ tabId, title });
  }
}
