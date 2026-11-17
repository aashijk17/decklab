// Captures the master output on the audio thread and ships it to the main
// thread as interleaved 16-bit PCM chunks while recording is switched on.

const CHUNK = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rec = false;
    this.buf = new Int16Array(CHUNK * 2);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data.rec === false && this.rec) this.flush();
      this.rec = !!e.data.rec;
    };
  }

  flush() {
    if (!this.n) return;
    const chunk = this.buf.slice(0, this.n * 2);
    this.port.postMessage(chunk, [chunk.buffer]);
    this.n = 0;
  }

  process(inputs) {
    const inp = inputs[0];
    if (!this.rec || !inp || !inp.length) return true;
    const l = inp[0], r = inp[1] || inp[0];
    for (let i = 0; i < l.length; i++) {
      const a = Math.max(-1, Math.min(1, l[i])), b = Math.max(-1, Math.min(1, r[i]));
      this.buf[this.n * 2] = a < 0 ? a * 32768 : a * 32767;
      this.buf[this.n * 2 + 1] = b < 0 ? b * 32768 : b * 32767;
      if (++this.n === CHUNK) this.flush();
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
