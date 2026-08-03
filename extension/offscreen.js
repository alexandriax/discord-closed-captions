import {
  BrowserRealtimeTranscriber,
  mapOpenAIEvent,
  sanitizeOpenAIError,
} from "./openai-realtime.js";

let apiKey = "";
let audioContext = null;
let captureStream = null;
let captureTabId = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let settings = null;
let shouldReconnect = false;
let transcriber = null;
let workletNode = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen") {
    return undefined;
  }

  if (message.type === "disccord:start") {
    startCapture(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        emit({
          type: "disccord:error",
          fatal: true,
          message: error.message,
        });
        stopCapture({ notify: false });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "disccord:stop") {
    stopCapture();
    sendResponse({ ok: true });
  }

  return undefined;
});

async function startCapture(message) {
  stopCapture({ notify: false });

  apiKey = message.apiKey;
  captureTabId = message.tabId;
  settings = message.settings;
  shouldReconnect = true;

  captureStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId,
      },
    },
    video: false,
  });

  const [audioTrack] = captureStream.getAudioTracks();
  if (!audioTrack) {
    throw new Error("The Discord tab did not provide an audio track.");
  }
  audioTrack.addEventListener("ended", () => stopCapture(), { once: true });

  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("pcm-worklet.js");
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(captureStream);

  // Chrome mutes captured tab playback unless the stream is routed back out.
  source.connect(audioContext.destination);

  workletNode = new AudioWorkletNode(audioContext, "disccord-pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: {
      targetSampleRate: 24000,
      chunkDurationMs: 100,
    },
  });
  source.connect(workletNode);

  workletNode.port.onmessage = (event) => {
    if (event.data?.type !== "audio" || !transcriber) {
      return;
    }

    try {
      transcriber.appendAudio(event.data.buffer);
    } catch (error) {
      emit({ type: "disccord:error", message: error.message });
    }
  };

  emit({
    type: "disccord:status",
    status: "capturing",
    message: "Discord audio captured. Connecting to OpenAI…",
  });
  connectOpenAI();
}

function connectOpenAI() {
  clearTimeout(reconnectTimer);
  transcriber?.close();

  const connection = new BrowserRealtimeTranscriber({
    apiKey,
    settings,
    onEvent: (event) => {
      if (transcriber !== connection) {
        return;
      }
      const mapped = mapOpenAIEvent(event);
      if (mapped) {
        if (mapped.status === "ready") {
          reconnectAttempt = 0;
        }
        emit(mapped);
      }
    },
    onClose: (code, reason) => {
      if (transcriber === connection && shouldReconnect && code !== 1000) {
        scheduleReconnect(
          reason || "The OpenAI transcription connection closed.",
        );
      }
    },
  });
  transcriber = connection;

  connection.connect().catch((error) => {
    if (transcriber === connection) {
      scheduleReconnect(error.message);
    }
  });
}

function scheduleReconnect(reason) {
  const safeReason =
    sanitizeOpenAIError(reason) || "OpenAI live transcription is unavailable.";

  if (!shouldReconnect || reconnectAttempt >= 4) {
    shouldReconnect = false;
    emit({
      type: "disccord:error",
      fatal: true,
      message: `${safeReason} Open the extension options to check your API key.`,
    });
    stopCapture({ notify: false });
    return;
  }

  const delay = Math.min(1000 * 2 ** reconnectAttempt, 8000);
  reconnectAttempt += 1;
  emit({
    type: "disccord:status",
    status: "connecting",
    message: `OpenAI unavailable. Retrying in ${delay / 1000}s…`,
  });
  reconnectTimer = setTimeout(connectOpenAI, delay);
}

function stopCapture({ notify = true } = {}) {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  transcriber?.close();
  transcriber = null;

  workletNode?.disconnect();
  workletNode = null;

  for (const track of captureStream?.getTracks() || []) {
    track.stop();
  }
  captureStream = null;

  audioContext?.close();
  audioContext = null;

  if (notify && captureTabId !== null) {
    emit({ type: "disccord:stopped" });
  }

  apiKey = "";
  captureTabId = null;
  settings = null;
  reconnectAttempt = 0;
}

function emit(payload) {
  chrome.runtime.sendMessage({
    target: "service-worker",
    type: "disccord:offscreen-event",
    tabId: captureTabId,
    payload,
  });
}
