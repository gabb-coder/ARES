/**
 * AudioWorklet that downsamples microphone input to 16 kHz mono PCM16 and
 * posts ~100 ms chunks to the main thread for streaming to the local
 * speech-to-text server. Box-filter decimation is plenty for speech.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = options.processorOptions?.targetRate ?? 16000;
    this.ratio = sampleRate / target;
    this.chunkSize = Math.round(target / 10);
    this.out = new Int16Array(this.chunkSize);
    this.length = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.phase += 1;
      if (this.phase < this.ratio) continue;

      this.phase -= this.ratio;
      const s = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.out[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.length === this.chunkSize) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(this.chunkSize);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
