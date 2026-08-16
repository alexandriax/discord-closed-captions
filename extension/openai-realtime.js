const CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const REALTIME_URL =
  "wss://api.openai.com/v1/realtime?intent=transcription";
const MODEL = "gpt-live-transcribe";
const MAX_QUEUED_AUDIO_BYTES = 480_000;
const MIN_COMMIT_BYTES = 4_800;
const COMMIT_INTERVAL_MS = 4_000;

export function buildTranscriptionSession(settings = {}) {
  const transcription = {
    model: MODEL,
    delay: "low",
  };

  if (settings.prompt) {
    transcription.prompt = settings.prompt;
  }
  if (settings.keywords?.length) {
    transcription.keywords = settings.keywords;
  }
  if (settings.languages?.length) {
    transcription.languages = settings.languages;
  }

  return {
    type: "transcription",
    audio: {
      input: {
        format: {
          type: "audio/pcm",
          rate: 24000,
        },
        transcription,
        turn_detection: null,
      },
    },
  };
}

export async function mintEphemeralToken({
  apiKey,
  settings,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: buildTranscriptionSession(settings),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.value !== "string" || !data.value) {
    const message = sanitizeOpenAIError(data.error?.message);
    throw new Error(
      message || `OpenAI rejected the session request (${response.status}).`,
    );
  }

  return data.value;
}

export class BrowserRealtimeTranscriber {
  #apiKey;
  #audioBytesSinceCommit = 0;
  #closed = false;
  #commitTimer = null;
  #onClose;
  #onEvent;
  #queuedAudio = [];
  #queuedAudioBytes = 0;
  #ready = false;
  #settings;
  #socket = null;
  #WebSocketImpl;

  constructor({
    apiKey,
    settings,
    onEvent,
    onClose,
    WebSocketImpl = globalThis.WebSocket,
  }) {
    this.#apiKey = apiKey;
    this.#settings = settings;
    this.#onEvent = onEvent;
    this.#onClose = onClose;
    this.#WebSocketImpl = WebSocketImpl;
  }

  async connect() {
    if (this.#socket || this.#closed) {
      throw new Error("The transcription session has already been started.");
    }

    const token = await mintEphemeralToken({
      apiKey: this.#apiKey,
      settings: this.#settings,
    });
    if (this.#closed) {
      return;
    }

    this.#socket = new this.#WebSocketImpl(REALTIME_URL, [
      "realtime",
      `openai-insecure-api-key.${token}`,
    ]);

    this.#socket.addEventListener("open", () => {
      this.#socket.send(
        JSON.stringify({
          type: "session.update",
          session: buildTranscriptionSession(this.#settings),
        }),
      );
    });

    this.#socket.addEventListener("message", (message) => {
      this.#handleMessage(message.data);
    });

    this.#socket.addEventListener("error", () => {
      this.#onEvent?.({
        type: "error",
        error: {
          code: "openai_connection_error",
          message: "Could not connect to OpenAI live transcription.",
        },
      });
    });

    this.#socket.addEventListener("close", (event) => {
      clearInterval(this.#commitTimer);
      this.#commitTimer = null;
      this.#ready = false;
      this.#onClose?.(event.code, sanitizeOpenAIError(event.reason));
    });

    this.#commitTimer = setInterval(
      () => this.commitAudio(),
      COMMIT_INTERVAL_MS,
    );
  }

  appendAudio(buffer) {
    if (this.#closed) {
      return false;
    }

    const bytes = toUint8Array(buffer);
    if (bytes.byteLength === 0) {
      return false;
    }
    this.#audioBytesSinceCommit += bytes.byteLength;

    if (this.#ready && this.#socket?.readyState === this.#WebSocketImpl.OPEN) {
      this.#sendAudio(bytes);
      return true;
    }

    if (this.#queuedAudioBytes + bytes.byteLength > MAX_QUEUED_AUDIO_BYTES) {
      throw new Error("OpenAI did not become ready before the audio queue filled.");
    }

    this.#queuedAudio.push(bytes.slice());
    this.#queuedAudioBytes += bytes.byteLength;
    return true;
  }

  commitAudio() {
    if (
      !this.#ready ||
      this.#audioBytesSinceCommit < MIN_COMMIT_BYTES ||
      this.#socket?.readyState !== this.#WebSocketImpl.OPEN
    ) {
      return false;
    }

    this.#socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    this.#audioBytesSinceCommit = 0;
    return true;
  }

  close() {
    this.#closed = true;
    clearInterval(this.#commitTimer);
    this.#commitTimer = null;
    this.#queuedAudio = [];
    this.#queuedAudioBytes = 0;
    this.#apiKey = "";

    if (
      this.#socket &&
      this.#socket.readyState !== this.#WebSocketImpl.CLOSING &&
      this.#socket.readyState !== this.#WebSocketImpl.CLOSED
    ) {
      this.#socket.close(1000, "Captions stopped");
    }
    this.#socket = null;
  }

  #handleMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      this.#onEvent?.({
        type: "error",
        error: {
          code: "invalid_openai_event",
          message: "OpenAI sent an unreadable event.",
        },
      });
      return;
    }

    if (event.type === "session.updated") {
      this.#ready = true;
      for (const bytes of this.#queuedAudio) {
        this.#sendAudio(bytes);
      }
      this.#queuedAudio = [];
      this.#queuedAudioBytes = 0;
    }

    this.#onEvent?.(event);
  }

  #sendAudio(bytes) {
    this.#socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: bytesToBase64(bytes),
      }),
    );
  }
}

export function mapOpenAIEvent(event) {
  switch (event?.type) {
    case "session.created":
      return {
        type: "disccord:status",
        status: "connected",
        message: "Connected to OpenAI live transcription…",
      };
    case "session.updated":
      return {
        type: "disccord:status",
        status: "ready",
        message: "Live captions are on",
      };
    case "input_audio_buffer.committed":
      return {
        type: "disccord:segment-committed",
        itemId: event.item_id,
      };
    case "conversation.item.input_audio_transcription.delta":
      return {
        type: "disccord:caption",
        final: false,
        itemId: event.item_id,
        text: event.delta || "",
      };
    case "conversation.item.input_audio_transcription.completed":
      return {
        type: "disccord:caption",
        final: true,
        itemId: event.item_id,
        text: event.transcript || "",
      };
    case "conversation.item.input_audio_transcription.failed":
      return {
        type: "disccord:error",
        code: "transcription_failed",
        message:
          sanitizeOpenAIError(event.error?.message) ||
          "OpenAI could not transcribe this audio segment.",
      };
    case "error":
      return {
        type: "disccord:error",
        code: event.error?.code || "openai_error",
        message:
          sanitizeOpenAIError(event.error?.message) ||
          "OpenAI returned an error.",
      };
    default:
      return null;
  }
}

export function sanitizeOpenAIError(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted API key]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 240);
}

function toUint8Array(buffer) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  throw new Error("Audio chunks must be binary data.");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
