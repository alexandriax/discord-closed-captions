export class Pcm16Resampler {
  constructor({
    sourceSampleRate,
    targetSampleRate = 24000,
    chunkDurationMs = 100,
  }) {
    this.ratio = sourceSampleRate / targetSampleRate;
    this.chunkSize = Math.round(
      (targetSampleRate * chunkDurationMs) / 1000,
    );
    this.output = new Int16Array(this.chunkSize);
    this.outputIndex = 0;
    this.pending = new Float32Array(0);
    this.position = 0;
  }

  push(channels) {
    if (!channels?.length || channels[0].length === 0) {
      return [];
    }

    const mono = mixToMono(channels);
    const combined = new Float32Array(this.pending.length + mono.length);
    combined.set(this.pending);
    combined.set(mono, this.pending.length);

    const chunks = [];
    while (this.position + 1 < combined.length) {
      const leftIndex = Math.floor(this.position);
      const fraction = this.position - leftIndex;
      const sample =
        combined[leftIndex] +
        (combined[leftIndex + 1] - combined[leftIndex]) * fraction;

      this.output[this.outputIndex] = floatToPcm16(sample);
      this.outputIndex += 1;
      this.position += this.ratio;

      if (this.outputIndex === this.output.length) {
        chunks.push(this.output);
        this.output = new Int16Array(this.chunkSize);
        this.outputIndex = 0;
      }
    }

    const consumed = Math.floor(this.position);
    this.pending = combined.slice(consumed);
    this.position -= consumed;
    return chunks;
  }
}

export function mixToMono(channels) {
  if (channels.length === 1) {
    return channels[0];
  }

  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += channel[index] / channels.length;
    }
  }
  return mono;
}

export function floatToPcm16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

