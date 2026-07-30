import { Pcm16Resampler } from "./pcm.js";

class DisccordPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const configuredRate = options.processorOptions?.targetSampleRate || 24000;
    const durationMs = options.processorOptions?.chunkDurationMs || 100;

    this.resampler = new Pcm16Resampler({
      sourceSampleRate: sampleRate,
      targetSampleRate: configuredRate,
      chunkDurationMs: durationMs,
    });
  }

  process(inputs) {
    for (const chunk of this.resampler.push(inputs[0])) {
      const buffer = chunk.buffer;
      this.port.postMessage({ type: "audio", buffer }, [buffer]);
    }

    return true;
  }
}

registerProcessor("disccord-pcm-capture", DisccordPcmCaptureProcessor);
