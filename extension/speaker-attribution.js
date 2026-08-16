const DEFAULT_LOOKBACK_MS = 5_500;
const DEFAULT_RETENTION_MS = 12_000;
const MAX_CANDIDATES = 2;

export class SpeakerAttributionTracker {
  #lookbackMs;
  #retentionMs;
  #samples = [];

  constructor({
    lookbackMs = DEFAULT_LOOKBACK_MS,
    retentionMs = DEFAULT_RETENTION_MS,
  } = {}) {
    this.#lookbackMs = lookbackMs;
    this.#retentionMs = retentionMs;
  }

  reset() {
    this.#samples = [];
  }

  addSample(speakers, at = Date.now()) {
    const normalized = normalizeSpeakers(speakers);
    if (!Number.isFinite(at)) {
      return;
    }
    this.#samples.push({ at, speakers: normalized });
    this.#samples = this.#samples.filter(
      (sample) => sample.at >= at - this.#retentionMs,
    );
  }

  attribute(at = Date.now()) {
    const relevant = this.#samples.filter(
      (sample) => sample.at >= at - this.#lookbackMs && sample.at <= at,
    );
    const scores = new Map();

    for (let index = 0; index < relevant.length; index += 1) {
      const sample = relevant[index];
      const nextAt = relevant[index + 1]?.at ?? at;
      const duration = Math.max(1, Math.min(nextAt - sample.at, 500));
      for (const speaker of sample.speakers) {
        scores.set(speaker, (scores.get(speaker) || 0) + duration);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) {
      return { speaker: "", speakerCandidates: [] };
    }

    const [first, second] = ranked;
    const candidates =
      !second || first[1] >= second[1] * 1.8
        ? [first[0]]
        : ranked.slice(0, MAX_CANDIDATES).map(([speaker]) => speaker);

    return {
      speaker: candidates.join(" or "),
      speakerCandidates: candidates,
    };
  }
}

export function normalizeSpeakers(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((speaker) =>
          typeof speaker === "string" ? speaker.trim().slice(0, 80) : "",
        )
        .filter(Boolean),
    ),
  ];
}
