import {
  configureStorageAccess,
  getApiKeyState,
  loadApiKey,
} from "./key-vault.js";
import { loadSettings } from "./settings.js";

const SESSION_KEY = "disccordActiveTabId";
const DISCORD_URL = /^https:\/\/discord\.com\//;

configureStorageAccess().catch(() => {});

chrome.runtime.onInstalled.addListener(async (details) => {
  await configureStorageAccess();
  chrome.action.setBadgeBackgroundColor({ color: "#5865f2" });

  if (details.reason === "install") {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const activeTabId = await getActiveTabId();
    if (activeTabId !== null) {
      await stopCapture(activeTabId);
      return;
    }

    if (!tab.id || !DISCORD_URL.test(tab.url || "")) {
      await setBadge(tab.id, "!", "#ed4245");
      return;
    }

    await startCapture(tab);
  } catch (error) {
    await reportError(tab.id, error.message);
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
    await chrome.runtime.openOptionsPage();
    throw new Error(
      keyState.locked
        ? "Unlock your OpenAI API key in the extension options first."
        : "Add your OpenAI API key in the extension options first.",
    );
  }

  await ensureOffscreenDocument();
  const settings = await loadSettings();
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });

  await chrome.storage.session.set({ [SESSION_KEY]: tab.id });
  await setBadge(tab.id, "CC", "#5865f2");
  await setActionTitle(tab.id, "Stop Discord closed captions");
  await sendToTab(tab.id, {
    type: "disccord:status",
    status: "capturing",
    message: "Capturing Discord audio…",
  });

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "disccord:start",
    streamId,
    tabId: tab.id,
    apiKey,
    settings,
  });
}

async function stopCapture(tabId) {
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "disccord:stop",
  });
  await clearActiveState(tabId);
  await sendToTab(tabId, { type: "disccord:stopped" });
}

async function handleMessage(message, sender) {
  if (message.type === "disccord:offscreen-event") {
    const tabId = message.tabId ?? (await getActiveTabId());
    if (tabId === null) {
      return { ok: false };
    }

    await sendToTab(tabId, message.payload);
    await updateBadgeForEvent(tabId, message.payload);

    if (
      message.payload?.type === "disccord:error" &&
      message.payload.fatal
    ) {
      await chrome.storage.session.remove(SESSION_KEY);
      await setActionTitle(tabId, "Start Discord closed captions");
    }

    if (message.payload?.type === "disccord:stopped") {
      await clearActiveState(tabId);
    }
    return { ok: true };
  }

  if (message.type === "disccord:get-state") {
    const tabId = sender.tab?.id;
    const activeTabId = await getActiveTabId();
    return {
      ok: true,
      active: tabId !== undefined && activeTabId === tabId,
    };
  }

  if (message.type === "disccord:stop-request") {
    const tabId = sender.tab?.id ?? (await getActiveTabId());
    if (tabId !== null && tabId !== undefined) {
      await stopCapture(tabId);
    }
    return { ok: true };
  }

  return { ok: false };
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
  await chrome.storage.session.remove(SESSION_KEY);
  await setBadge(tabId, "", "#5865f2");
  await setActionTitle(tabId, "Start Discord closed captions");
}

async function getActiveTabId() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return Number.isInteger(stored[SESSION_KEY]) ? stored[SESSION_KEY] : null;
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
      justification: "Capture the user-selected Discord tab audio for captions.",
    });
  }
}

async function reportError(tabId, message) {
  if (tabId) {
    await setBadge(tabId, "!", "#ed4245");
    await sendToTab(tabId, {
      type: "disccord:error",
      message,
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
