const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  transcriptionModel: "gpt-live-transcribe",
});

export function loadConfig(env = process.env) {
  const port = parsePort(env.PORT);
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return Object.freeze({
    apiKey,
    accessKey: env.DISCCORD_ACCESS_KEY?.trim() || "",
    host: env.HOST?.trim() || DEFAULTS.host,
    transcriptionModel:
      env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULTS.transcriptionModel,
    port,
  });
}

function parsePort(value) {
  if (value === undefined || value === "") {
    return DEFAULTS.port;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

export { DEFAULTS };
