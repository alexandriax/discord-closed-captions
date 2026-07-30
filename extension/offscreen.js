let audioContext = null;
let captureStream = null;
let captureTabId = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let settings = null;
let shouldReconnect = false;
let socket = null;
let workletNode = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") {
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

  // Tab capture silences normal tab playback unless it is routed back out.
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
    if (
      event.data?.type === "audio" &&
      socket?.readyState === WebSocket.OPEN
    ) {
      socket.send(event.data.buffer);
    }
  };

  emit({
    type: "disccord:status",
    status: "capturing",
    message: "Discord audio captured. Connecting…",
  });
  connectRelay();
}

function connectRelay() {
  clearTimeout(reconnectTimer);

  try {
    socket = new WebSocket(settings.relayUrl);
  } catch (error) {
    scheduleReconnect(error.message);
    return;
  }

  socket.binaryType = "arraybuffer";

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    socket.send(
      JSON.stringify({
        type: "start",
        accessKey: settings.accessKey,
        config: {
          languages: settings.languages,
          keywords: settings.keywords,
          prompt: settings.prompt,
        },
      }),
    );
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      emit(mapRelayEvent(message));
    } catch {
      emit({
        type: "disccord:error",
        message: "The relay sent an unreadable message.",
      });
    }
  });

  socket.addEventListener("error", () => {
    emit({
      type: "disccord:error",
      message: "Could not reach the Disccord relay.",
    });
  });

  socket.addEventListener("close", (event) => {
    if (event.code === 1008) {
      shouldReconnect = false;
      emit({
        type: "disccord:error",
        message: event.reason || "The relay rejected this caption session.",
      });
      return;
    }

    if (shouldReconnect && event.code !== 1000) {
      scheduleReconnect(
        event.reason || "The relay connection closed unexpectedly.",
      );
    }
  });
}

function scheduleReconnect(reason) {
  if (!shouldReconnect || reconnectAttempt >= 4) {
    emit({
      type: "disccord:error",
      message: `${reason} Open the extension options to check the relay URL.`,
    });
    return;
  }

  const delay = Math.min(1000 * 2 ** reconnectAttempt, 8000);
  reconnectAttempt += 1;
  emit({
    type: "disccord:status",
    status: "connecting",
    message: `Relay unavailable. Retrying in ${delay / 1000}s…`,
  });
  reconnectTimer = setTimeout(connectRelay, delay);
}

function stopCapture({ notify = true } = {}) {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);

  if (
    socket &&
    socket.readyState !== WebSocket.CLOSED &&
    socket.readyState !== WebSocket.CLOSING
  ) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
    socket.close(1000, "Captions stopped");
  }
  socket = null;

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

  captureTabId = null;
  settings = null;
  reconnectAttempt = 0;
}

function mapRelayEvent(message) {
  if (message.type === "caption") {
    return {
      type: "disccord:caption",
      final: message.final,
      itemId: message.itemId,
      text: message.text,
    };
  }

  if (message.type === "error") {
    return {
      type: "disccord:error",
      code: message.code,
      message: message.message,
    };
  }

  return {
    type: "disccord:status",
    status: message.status || "connecting",
    message: statusMessage(message.status),
  };
}

function statusMessage(status) {
  const messages = {
    waiting: "Relay connected. Starting transcription…",
    connecting: "Connecting to live transcription…",
    connected: "Live transcription connected…",
    ready: "Live captions are on",
  };
  return messages[status] || "Starting live captions…";
}

function emit(payload) {
  chrome.runtime.sendMessage({
    target: "service-worker",
    type: "disccord:offscreen-event",
    tabId: captureTabId,
    payload,
  });
}
