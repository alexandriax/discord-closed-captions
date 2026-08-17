import {
  configureStorageAccess,
  getApiKeyState,
  unlockApiKey,
} from "./key-vault.js";
import { loadSettings } from "./settings.js";
import {
  formatTranscriptText,
  loadTranscript,
} from "./transcript-store.js";

const DISCORD_URL = /^https:\/\/discord\.com\//;
const captureButton = document.querySelector("#capture-button");
const captureSummary = document.querySelector("#capture-summary");
const clearTranscriptButton = document.querySelector("#clear-transcript");
const copyTranscriptButton = document.querySelector("#copy-transcript");
const keyStateElement = document.querySelector("#key-state");
const openSettingsButton = document.querySelector("#open-settings");
const statusOutput = document.querySelector("#status");
const transcriptElement = document.querySelector("#transcript");
const transcriptMeta = document.querySelector("#transcript-meta");
const unlockForm = document.querySelector("#unlock-form");
const settingInputs = [
  document.querySelector("#saveTranscripts"),
  document.querySelector("#speakerAttribution"),
  document.querySelector("#transcribeSelf"),
];

let activeTabId = null;
let currentTab = null;
let keyState = null;
let refreshTimer = null;

initialize().catch((error) => showStatus(error.message, true));

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  showStatus(activeTabId === null ? "Starting captions…" : "Stopping captions…");
  try {
    if (!keyState?.available) {
      if (keyState?.locked) {
        unlockForm.querySelector("input").focus();
        throw new Error("Unlock your saved API key first.");
      }
      await chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    if (activeTabId !== null) {
      await sendToWorker({ type: "disccord:stop-request" });
    } else {
      if (!currentTab?.id || !DISCORD_URL.test(currentTab.url || "")) {
        throw new Error("Open Discord Web in this tab before starting captions.");
      }
      const settings = await loadSettings();
      if (settings.transcribeSelf) {
        await requestMicrophoneAccess();
      }
      await sendToWorker({
        type: "disccord:start-request",
        tabId: currentTab.id,
      });
    }
    await refresh();
    showStatus(activeTabId === null ? "Captions stopped" : "Captions started");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    captureButton.disabled = false;
  }
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("Unlocking saved key…");
  try {
    await unlockApiKey(new FormData(unlockForm).get("unlockPassphrase"));
    unlockForm.reset();
    await refresh();
    showStatus("Saved API key unlocked");
  } catch (error) {
    showStatus(error.message, true);
  }
});

for (const input of settingInputs) {
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      if (input.id === "transcribeSelf" && input.checked) {
        await requestMicrophoneAccess();
      }
      const response = await sendToWorker({
        type: "disccord:update-settings",
        settings: { [input.id]: input.checked },
      });
      input.checked = response.settings[input.id];
      showStatus(
        input.id === "transcribeSelf" && activeTabId !== null
          ? "Microphone setting applies next session"
          : "Setting saved",
      );
    } catch (error) {
      input.checked = !input.checked;
      showStatus(error.message, true);
    } finally {
      input.disabled = false;
    }
  });
}

clearTranscriptButton.addEventListener("click", async () => {
  if (!window.confirm("Clear the latest saved transcript?")) {
    return;
  }
  await sendToWorker({ type: "disccord:clear-transcript" });
  await refreshTranscript();
  showStatus("Transcript cleared");
});

copyTranscriptButton.addEventListener("click", async () => {
  copyTranscriptButton.disabled = true;
  try {
    const text = formatTranscriptText(await loadTranscript());
    if (!text) {
      throw new Error("There is no transcript to copy.");
    }
    await navigator.clipboard.writeText(text);
    showStatus("Transcript copied");
  } catch (error) {
    showStatus(error.message || "The transcript could not be copied.", true);
  } finally {
    copyTranscriptButton.disabled = false;
  }
});

openSettingsButton.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

chrome.storage.onChanged.addListener(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 60);
});

async function initialize() {
  await configureStorageAccess();
  await refresh();
}

async function refresh() {
  const [tabs, state, nextKeyState, settings] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    sendToWorker({ type: "disccord:get-state" }),
    getApiKeyState(),
    loadSettings(),
  ]);
  [currentTab] = tabs;
  activeTabId = Number.isInteger(state.activeTabId) ? state.activeTabId : null;
  keyState = nextKeyState;
  renderCaptureState();
  renderKeyState();
  for (const input of settingInputs) {
    input.checked = settings[input.id];
  }
  await refreshTranscript();
}

function renderCaptureState() {
  if (activeTabId !== null) {
    captureButton.textContent = "Stop";
    captureSummary.textContent =
      activeTabId === currentTab?.id
        ? "Running in this Discord tab."
        : "Running in another Discord tab.";
    return;
  }
  captureButton.textContent = keyState?.locked
    ? "Unlock"
    : keyState?.available
      ? "Start"
      : "Set up";
  captureSummary.textContent = DISCORD_URL.test(currentTab?.url || "")
    ? "Ready for this Discord tab."
    : "Open a Discord call to start.";
}

function renderKeyState() {
  unlockForm.hidden = !keyState.locked;
  if (keyState.locked) {
    keyStateElement.dataset.state = "locked";
    keyStateElement.textContent = "Key locked";
  } else if (keyState.available) {
    keyStateElement.dataset.state = "ready";
    keyStateElement.textContent =
      keyState.mode === "device" ? "Key saved" : "Key ready";
  } else {
    keyStateElement.dataset.state = "missing";
    keyStateElement.textContent = "No key";
  }
}

async function refreshTranscript() {
  const transcript = await loadTranscript();
  transcriptElement.replaceChildren();
  clearTranscriptButton.hidden = !transcript;
  copyTranscriptButton.hidden = !transcript?.entries.length;
  transcriptMeta.textContent = transcript ? formatTranscriptMeta(transcript) : "";

  if (!transcript?.entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Final captions will appear here.";
    transcriptElement.append(empty);
    return;
  }

  for (const entry of transcript.entries) {
    const container = document.createElement("article");
    container.className = "transcript-entry";
    const speaker = document.createElement("p");
    speaker.className = "transcript-speaker";
    speaker.textContent = entry.speaker || "Unknown speaker";
    const text = document.createElement("p");
    text.className = "transcript-text";
    text.textContent = entry.text;
    container.append(speaker, text);
    transcriptElement.append(container);
  }
  transcriptElement.scrollTop = transcriptElement.scrollHeight;
}

async function requestMicrophoneAccess() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Allow microphone access to transcribe your voice.");
  } finally {
    for (const track of stream?.getTracks() || []) {
      track.stop();
    }
  }
}

async function sendToWorker(message) {
  const response = await chrome.runtime.sendMessage({
    target: "service-worker",
    ...message,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "The extension could not complete that action.");
  }
  return response;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatTranscriptMeta(transcript) {
  const captionCount = `${transcript.entries.length} caption${
    transcript.entries.length === 1 ? "" : "s"
  }`;
  return `${formatDate(transcript.startedAt)} · ${captionCount}${
    transcript.endedAt ? "" : " · live"
  }`;
}

function showStatus(message, isError = false) {
  statusOutput.textContent = message;
  statusOutput.dataset.error = String(isError);
}
