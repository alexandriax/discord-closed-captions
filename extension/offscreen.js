import {
  BrowserRealtimeTranscriber,
  mapOpenAIEvent,
  sanitizeOpenAIError,
} from "./openai-realtime.js";

let apiKey = "";
let audioContext = null;
let captureStream = null;
let captureTabId = null;
let microphoneStream = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let selfAnalyser = null;
let selfSpeaking = false;
let selfSpeakingTimer = null;
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

  if (settings.transcribeSelf) {
    await connectMicrophone();
  }

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

  stopSelfSpeakingMonitor();

  for (const track of captureStream?.getTracks() || []) {
    track.stop();
  }
  captureStream = null;

  for (const track of microphoneStream?.getTracks() || []) {
    track.stop();
  }
  microphoneStream = null;

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

async function connectMicrophone() {
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch {
    throw new Error(
      "Microphone access is required to transcribe your voice. " +
        "Turn off ‘Transcribe my microphone’ or allow microphone access for the extension.",
    );
  }

  const [microphoneTrack] = microphoneStream.getAudioTracks();
  if (!microphoneTrack) {
    throw new Error("The microphone did not provide an audio track.");
  }

  const microphoneSource =
    audioContext.createMediaStreamSource(microphoneStream);
  const microphoneGain = audioContext.createGain();
  microphoneGain.gain.value = 0.9;
  selfAnalyser = audioContext.createAnalyser();
  selfAnalyser.fftSize = 512;
  selfAnalyser.smoothingTimeConstant = 0.2;
  microphoneSource
    .connect(microphoneGain)
    .connect(selfAnalyser)
    .connect(workletNode);
  startSelfSpeakingMonitor();
}

function startSelfSpeakingMonitor() {
  const samples = new Float32Array(selfAnalyser.fftSize);
  let lastVoiceAt = 0;
  selfSpeakingTimer = setInterval(() => {
    selfAnalyser.getFloatTimeDomainData(samples);
    const sum = samples.reduce((total, sample) => total + sample * sample, 0);
    const rms = Math.sqrt(sum / samples.length);
    if (rms >= 0.025) {
      lastVoiceAt = Date.now();
    }
    const active = Date.now() - lastVoiceAt < 350;
    if (active !== selfSpeaking) {
      selfSpeaking = active;
      emit({
        type: "disccord:self-speaking",
        active,
        at: Date.now(),
      });
    }
  }, 100);
}

function stopSelfSpeakingMonitor() {
  clearInterval(selfSpeakingTimer);
  selfSpeakingTimer = null;
  if (selfSpeaking && captureTabId !== null) {
    emit({
      type: "disccord:self-speaking",
      active: false,
      at: Date.now(),
    });
  }
  selfSpeaking = false;
  selfAnalyser?.disconnect();
  selfAnalyser = null;
}

function emit(payload) {
  chrome.runtime.sendMessage({
    target: "service-worker",
    type: "disccord:offscreen-event",
    tabId: captureTabId,
    payload,
  });
}
