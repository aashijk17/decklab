// Mix recorder. Audio arrives from the recorder worklet as interleaved
// 16-bit stereo chunks; we keep them in memory and build a file on demand.

const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';

export class Recorder {
  constructor(engine) {
    this.node = engine.recNode; this.sr = engine.ctx.sampleRate;
    this.chunks = []; this.frames = 0; this.recording = false; this.take = null;
    this.node.port.onmessage = (e) => {
      this.chunks.push(e.data); this.frames += e.data.length / 2;
    };
  }

  get elapsed() { return this.frames / this.sr; }

  start() {
    this.chunks = []; this.frames = 0; this.take = null; this.recording = true;
    this.node.port.postMessage({ rec: true });
  }

  stop() {
    this.recording = false;
    this.node.port.postMessage({ rec: false });
    // The worklet flushes its last partial chunk asynchronously; give it a moment.
    return new Promise((res) => setTimeout(() => {
      this.take = { chunks: this.chunks, frames: this.frames };
      res(this.take);
    }, 120));
  }

  wavBlob() {
    const { chunks, frames } = this.take, bytes = frames * 4;
    const h = new DataView(new ArrayBuffer(44));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
    h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 2, true);
    h.setUint32(24, this.sr, true); h.setUint32(28, this.sr * 4, true);
    h.setUint16(32, 4, true); h.setUint16(34, 16, true); str(36, 'data'); h.setUint32(40, bytes, true);
    return new Blob([h.buffer, ...chunks], { type: 'audio/wav' });
  }

  async mp3Blob(onProgress) {
    if (!window.lamejs) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = LAME_URL; s.onload = res;
        s.onerror = () => rej(new Error('Could not load the MP3 encoder (are you offline?). The WAV download still works.'));
        document.head.append(s);
      });
    }
    const enc = new window.lamejs.Mp3Encoder(2, this.sr, 192);
    const out = [], { chunks } = this.take;
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c], n = ch.length / 2;
      const l = new Int16Array(n), r = new Int16Array(n);
      for (let i = 0; i < n; i++) { l[i] = ch[i * 2]; r[i] = ch[i * 2 + 1]; }
      const buf = enc.encodeBuffer(l, r);
      if (buf.length) out.push(new Uint8Array(buf));
      if (c % 20 === 0) {            // yield so the page stays responsive
        if (onProgress) onProgress(c / chunks.length);
        await new Promise((res) => setTimeout(res));
      }
    }
    const end = enc.flush();
    if (end.length) out.push(new Uint8Array(end));
    return new Blob(out, { type: 'audio/mpeg' });
  }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
