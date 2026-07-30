import WebSocket from "ws";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";

export class OpenAIRealtimeTranscriber {
  #apiKey;
  #config;
  #socket;
  #onEvent;
  #onClose;
  #transcriptionModel;

  constructor({
    apiKey,
    transcriptionModel,
    transcriptionConfig,
    onEvent,
    onClose,
  }) {
    this.#apiKey = apiKey;
    this.#transcriptionModel = transcriptionModel;
    this.#config = transcriptionConfig;
    this.#onEvent = onEvent;
    this.#onClose = onClose;
  }

  connect() {
    if (this.#socket) {
      throw new Error("The OpenAI session has already been started.");
    }

    const url = new URL(OPENAI_REALTIME_URL);
    url.searchParams.set("intent", "transcription");

    this.#socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
      },
    });

    this.#socket.on("open", () => {
      this.#socket.send(JSON.stringify(this.#sessionUpdate()));
    });

    this.#socket.on("message", (data) => {
      try {
        this.#onEvent(JSON.parse(data.toString()));
      } catch (error) {
        this.#onEvent({
          type: "error",
          error: {
            code: "invalid_openai_event",
            message: error.message,
          },
        });
      }
    });

    this.#socket.on("error", (error) => {
      this.#onEvent({
        type: "error",
        error: {
          code: "openai_connection_error",
          message: error.message,
        },
      });
    });

    this.#socket.on("close", (code, reason) => {
      this.#onClose?.(code, reason.toString());
    });
  }

  appendAudio(pcmBuffer) {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.#socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: pcmBuffer.toString("base64"),
      }),
    );
    return true;
  }

  commitAudio() {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.#socket.send(
      JSON.stringify({
        type: "input_audio_buffer.commit",
      }),
    );
    return true;
  }

  close() {
    if (
      this.#socket &&
      this.#socket.readyState !== WebSocket.CLOSING &&
      this.#socket.readyState !== WebSocket.CLOSED
    ) {
      this.#socket.close(1000, "Disccord session ended");
    }
  }

  #sessionUpdate() {
    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            transcription: {
              model: this.#transcriptionModel,
              delay: "low",
              ...this.#config,
            },
            turn_detection: null,
          },
        },
      },
    };
  }
}
