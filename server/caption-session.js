import WebSocket from "ws";

import { OpenAIRealtimeTranscriber } from "./openai-realtime.js";
import {
  isAccessKeyValid,
  parseStartMessage,
  ProtocolError,
  toClientEvent,
} from "./protocol.js";

const MAX_QUEUED_AUDIO_BYTES = 480_000;
const START_TIMEOUT_MS = 10_000;
const COMMIT_INTERVAL_MS = 4_000;
const MIN_COMMIT_BYTES = 4_800;

export class CaptionSession {
  #audioBytesSinceCommit = 0;
  #client;
  #commitTimer;
  #config;
  #queuedAudio = [];
  #queuedAudioBytes = 0;
  #ready = false;
  #startTimer;
  #transcriber;
  #Transcriber;

  constructor(client, config, { Transcriber = OpenAIRealtimeTranscriber } = {}) {
    this.#client = client;
    this.#config = config;
    this.#Transcriber = Transcriber;

    this.#startTimer = setTimeout(() => {
      this.#fail("start_timeout", "No start message was received.", 1008);
    }, START_TIMEOUT_MS);
    this.#startTimer.unref?.();
    this.#commitTimer = setInterval(
      () => this.#commitAudio(),
      COMMIT_INTERVAL_MS,
    );
    this.#commitTimer.unref?.();

    client.on("message", (data, isBinary) => this.#onMessage(data, isBinary));
    client.on("close", () => this.close());
    client.on("error", () => this.close());

    this.#send({ type: "status", status: "waiting" });
  }

  close() {
    clearTimeout(this.#startTimer);
    clearInterval(this.#commitTimer);
    this.#transcriber?.close();
    this.#queuedAudio = [];
    this.#queuedAudioBytes = 0;
  }

  #onMessage(data, isBinary) {
    if (!this.#transcriber) {
      if (isBinary) {
        this.#fail(
          "start_required",
          "Send the JSON start message before sending audio.",
          1008,
        );
        return;
      }

      this.#start(data.toString());
      return;
    }

    if (!isBinary) {
      this.#handleControlMessage(data.toString());
      return;
    }

    const buffer = Buffer.from(data);
    if (buffer.length === 0) {
      return;
    }

    this.#audioBytesSinceCommit += buffer.length;

    if (this.#ready) {
      this.#transcriber.appendAudio(buffer);
      return;
    }

    if (this.#queuedAudioBytes + buffer.length > MAX_QUEUED_AUDIO_BYTES) {
      this.#fail(
        "upstream_slow",
        "The transcription service did not become ready in time.",
        1013,
      );
      return;
    }

    this.#queuedAudio.push(buffer);
    this.#queuedAudioBytes += buffer.length;
  }

  #start(raw) {
    try {
      const { accessKey, config } = parseStartMessage(raw);
      if (!isAccessKeyValid(this.#config.accessKey, accessKey)) {
        this.#fail("unauthorized", "The Disccord access key is invalid.", 1008);
        return;
      }

      clearTimeout(this.#startTimer);
      this.#send({ type: "status", status: "connecting" });

      this.#transcriber = new this.#Transcriber({
        apiKey: this.#config.apiKey,
        transcriptionModel: this.#config.transcriptionModel,
        transcriptionConfig: config,
        onEvent: (event) => this.#onOpenAIEvent(event),
        onClose: (code, reason) => this.#onUpstreamClose(code, reason),
      });
      this.#transcriber.connect();
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.#fail(error.code, error.message, 1008);
        return;
      }
      this.#fail("start_failed", error.message, 1011);
    }
  }

  #handleControlMessage(raw) {
    try {
      const message = JSON.parse(raw);
      if (message?.type === "stop") {
        this.#client.close(1000, "Client stopped captions");
      }
    } catch {
      this.#send({
        type: "error",
        code: "invalid_control_message",
        message: "Control messages must be valid JSON.",
      });
    }
  }

  #onOpenAIEvent(event) {
    const clientEvent = toClientEvent(event);
    if (!clientEvent) {
      return;
    }

    if (clientEvent.type === "status" && clientEvent.status === "ready") {
      this.#ready = true;
      for (const buffer of this.#queuedAudio) {
        this.#transcriber.appendAudio(buffer);
      }
      this.#queuedAudio = [];
      this.#queuedAudioBytes = 0;
    }

    this.#send(clientEvent);
  }

  #commitAudio() {
    if (!this.#ready || this.#audioBytesSinceCommit < MIN_COMMIT_BYTES) {
      return;
    }

    if (this.#transcriber.commitAudio()) {
      this.#audioBytesSinceCommit = 0;
    }
  }

  #onUpstreamClose(code, reason) {
    if (this.#client.readyState === WebSocket.OPEN) {
      this.#send({
        type: "error",
        code: "upstream_closed",
        message: reason || `The transcription service closed (${code}).`,
      });
      this.#client.close(1011, "Transcription service closed");
    }
  }

  #fail(code, message, closeCode) {
    this.#send({ type: "error", code, message });
    if (
      this.#client.readyState === WebSocket.OPEN ||
      this.#client.readyState === WebSocket.CONNECTING
    ) {
      this.#client.close(closeCode, code);
    }
  }

  #send(message) {
    if (this.#client.readyState === WebSocket.OPEN) {
      this.#client.send(JSON.stringify(message));
    }
  }
}
