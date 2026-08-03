import { timingSafeEqual } from "node:crypto";

const MAX_PROMPT_LENGTH = 500;
const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LENGTH = 80;
const MAX_LANGUAGES = 6;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z]{2})?$/;

export function parseStartMessage(raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    throw new ProtocolError("invalid_json", "The start message must be valid JSON.");
  }

  if (!message || message.type !== "start") {
    throw new ProtocolError(
      "start_required",
      'The first message must have type "start".',
    );
  }

  return {
    accessKey: typeof message.accessKey === "string" ? message.accessKey : "",
    config: sanitizeTranscriptionConfig(message.config),
  };
}

export function sanitizeTranscriptionConfig(value) {
  const config = value && typeof value === "object" ? value : {};
  const prompt = cleanSingleLine(config.prompt, MAX_PROMPT_LENGTH);

  const keywords = uniqueStrings(config.keywords, {
    maxItems: MAX_KEYWORDS,
    maxLength: MAX_KEYWORD_LENGTH,
  }).filter((keyword) => !/[<>\r\n]/.test(keyword));

  const languages = uniqueStrings(config.languages, {
    maxItems: MAX_LANGUAGES,
    maxLength: 8,
  })
    .map((language) => language.toLowerCase())
    .filter((language) => LANGUAGE_CODE.test(language));

  return {
    ...(prompt ? { prompt } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(languages.length ? { languages } : {}),
  };
}

export function isAccessKeyValid(expected, provided) {
  if (!expected) {
    return true;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided || "");

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function toClientEvent(event) {
  switch (event?.type) {
    case "session.created":
      return { type: "status", status: "connected" };
    case "session.updated":
      return { type: "status", status: "ready" };
    case "input_audio_buffer.speech_started":
      return {
        type: "speech",
        state: "started",
        itemId: event.item_id,
      };
    case "input_audio_buffer.speech_stopped":
      return {
        type: "speech",
        state: "stopped",
        itemId: event.item_id,
      };
    case "conversation.item.input_audio_transcription.delta":
      return {
        type: "caption",
        final: false,
        itemId: event.item_id,
        text: event.delta || "",
      };
    case "conversation.item.input_audio_transcription.completed":
      return {
        type: "caption",
        final: true,
        itemId: event.item_id,
        text: event.transcript || "",
      };
    case "conversation.item.input_audio_transcription.failed":
      return {
        type: "error",
        code: "transcription_failed",
        message:
          event.error?.message || "OpenAI could not transcribe this speech turn.",
      };
    case "error":
      return {
        type: "error",
        code: event.error?.code || "openai_error",
        message: event.error?.message || "The transcription service returned an error.",
      };
    default:
      return null;
  }
}

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function cleanSingleLine(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(value, { maxItems, maxLength }) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

