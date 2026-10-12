/**
 * Microphone capture via the Web Audio API. Feeds the visualizer (AnalyserNode)
 * and, for the local speech-to-text engine, a 16 kHz PCM stream.
 */
export class Microphone {
  readonly analyser: AnalyserNode;
  #timeData: Float32Array<ArrayBuffer>;

  private constructor(
    readonly stream: MediaStream,
    readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
  ) {
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    source.connect(this.analyser);
    this.#timeData = new Float32Array(this.analyser.fftSize);
  }

  static async open(): Promise<Microphone> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot access the microphone (a secure context such as localhost is required)');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const context = new AudioContext();
    // Without a user gesture (e.g. hands-free mode after a reload) this stays
    // suspended until the next click or key press; don't block on it.
    if (context.state === 'suspended') void context.resume();
    return new Microphone(stream, context, context.createMediaStreamSource(stream));
  }

  /** Current loudness as RMS in 0–1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.#timeData);
    let sum = 0;
    for (const v of this.#timeData) sum += v * v;
    return Math.sqrt(sum / this.#timeData.length);
  }

  /** Streams 16 kHz mono PCM16 chunks (~100 ms each). Returns a stop function. */
  async streamPcm16k(onChunk: (chunk: ArrayBuffer) => void): Promise<() => void> {
    await this.context.audioWorklet.addModule('/pcm-worklet.js');
    const node = new AudioWorkletNode(this.context, 'pcm-downsampler', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { targetRate: 16000 },
    });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
    this.source.connect(node);
    return () => {
      node.port.onmessage = null;
      this.source.disconnect(node);
    };
  }

  close(): void {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.context.close();
  }
}
