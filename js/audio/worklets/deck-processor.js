// Deck playback engine. Runs on the audio thread (AudioWorklet).
//
// Holds the whole decoded track and plays it sample-accurately with:
//  - variable speed (plain resampling: speed and pitch change together), or
//  - key lock: a WSOLA time-stretcher (speed changes, pitch stays put)
//  - seamless loops, click-free seeks, position reports to the main thread.

const HS = 1024;     // stretch hop size in samples (~23 ms)
const SEEK = 224;    // WSOLA search window, +/- samples (~5 ms): small = tight beat timing
const CL = 128;      // correlation points
const CSTEP = 4;     // correlation stride
const XF = 96;       // crossfade length used for jumps when key lock is off
const JUMP_FADE = 64;

class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0;
    this.pos = 0; this.rate = 1; this.playing = false; this.gain = 0;
    this.keylock = false;
    this.loopOn = false; this.loopStart = 0; this.loopEnd = 0;
    this.seq = 0; this.blocks = 0;
    this.hopL = new Float32Array(HS); this.hopR = new Float32Array(HS);
    this.fade = new Float32Array(HS);
    for (let i = 0; i < HS; i++) this.fade[i] = 0.5 - 0.5 * Math.cos(Math.PI * i / HS);
    this.ref = new Float32Array(CL);
    this.xfPos = 0; this.xfLeft = 0;
    this.resetStretch();
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  resetStretch() { this.curA = -1; this.hopIdx = HS; this.jump = false; this.xfLeft = 0; }

  onMsg(m) {
    if (m.seq !== undefined) this.seq = m.seq;
    switch (m.type) {
      case 'load':
        this.L = m.L; this.R = m.R; this.len = m.L.length;
        this.pos = 0; this.playing = false; this.gain = 0; this.loopOn = false;
        this.resetStretch();
        break;
      case 'play':
        if (!this.L) break;
        if (this.gain === 0) this.resetStretch();
        this.playing = true;
        break;
      case 'pause': this.playing = false; break;
      case 'seek': this.jumpTo(m.pos); break;
      case 'jump': this.jumpTo(this.pos + m.delta); break;
      case 'rate': this.rate = m.rate; break;
      case 'keylock': this.keylock = m.on; this.resetStretch(); break;
      case 'loop': this.loopOn = m.on; this.loopStart = m.start; this.loopEnd = m.end; break;
    }
  }

  jumpTo(p) {
    if (!this.L) return;
    p = Math.max(0, Math.min(this.len - 1, p));
    if (this.playing && this.gain > 0) {
      if (this.keylock) {
        // Re-generate the next hop right away, crossfading from what is playing now.
        if (this.curA >= 0) this.curA += this.hopIdx - HS;
        this.hopIdx = HS; this.jump = true;
      } else {
        this.xfPos = this.pos; this.xfLeft = XF;
      }
    } else {
      this.resetStretch();
    }
    this.pos = p;
  }

  // Find the grain start near `center` that best continues the audio at `nat`.
  match(nat, center) {
    const L = this.L, len = this.len, ref = this.ref;
    for (let j = 0; j < CL; j++) { const k = nat + j * CSTEP; ref[j] = k >= 0 && k < len ? L[k] : 0; }
    let best = -Infinity, bestA = center;
    const lo = Math.max(0, center - SEEK), hi = Math.min(len - CL * CSTEP - 1, center + SEEK);
    for (let c = lo; c <= hi; c++) {
      let s = 0, e = 1e-9;
      for (let j = 0, k = c; j < CL; j++, k += CSTEP) { const v = L[k]; s += ref[j] * v; e += v * v; }
      const score = s / Math.sqrt(e);
      if (score > best) { best = score; bestA = c; }
    }
    return bestA;
  }

  genHop() {
    const L = this.L, R = this.R, len = this.len;
    const center = Math.round(this.pos);
    const nat = this.curA >= 0 ? this.curA + this.hopIdx : -1;
    let a, fadeLen = HS;
    if (nat < 0) a = center;
    else if (this.jump) { a = center; fadeLen = JUMP_FADE; }
    else if (Math.abs(this.rate - 1) < 1e-4 && Math.abs(nat - center) <= SEEK) a = nat;
    else a = this.match(nat, center);
    this.jump = false;
    const hl = this.hopL, hr = this.hopR, fade = this.fade;
    const blend = nat >= 0 && a !== nat;
    for (let i = 0; i < HS; i++) {
      const ia = a + i;
      let l = 0, r = 0;
      if (ia >= 0 && ia < len) { l = L[ia]; r = R[ia]; }
      if (blend && i < fadeLen) {
        const w = fadeLen === HS ? fade[i] : 0.5 - 0.5 * Math.cos(Math.PI * i / fadeLen);
        const k = nat + i;
        let nl = 0, nr = 0;
        if (k >= 0 && k < len) { nl = L[k]; nr = R[k]; }
        l = nl + (l - nl) * w; r = nr + (r - nr) * w;
      }
      hl[i] = l; hr[i] = r;
    }
    this.curA = a; this.hopIdx = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    if ((this.blocks++ & 3) === 0) {
      this.port.postMessage({ type: 'pos', pos: this.pos, t: currentTime, playing: this.playing, seq: this.seq });
    }
    const L = this.L, R = this.R;
    if (!L) return true;
    const len = this.len;
    for (let i = 0; i < n; i++) {
      const target = this.playing ? 1 : 0;
      if (this.gain !== target) {
        this.gain += target > this.gain ? 1 / 128 : -1 / 128;
        if (this.gain > 1) this.gain = 1; else if (this.gain < 0) this.gain = 0;
      }
      if (this.gain === 0 && !this.playing) { oL[i] = 0; oR[i] = 0; continue; }
      let l = 0, r = 0;
      if (this.keylock) {
        if (this.hopIdx >= HS) this.genHop();
        l = this.hopL[this.hopIdx]; r = this.hopR[this.hopIdx++];
      } else {
        const p = this.pos, k = p | 0, f = p - k;
        if (k >= 0 && k < len - 1) {
          l = L[k] + (L[k + 1] - L[k]) * f;
          r = R[k] + (R[k + 1] - R[k]) * f;
        }
        if (this.xfLeft > 0) {
          const g = this.xfLeft / XF, q = this.xfPos, k2 = q | 0, f2 = q - k2;
          if (k2 >= 0 && k2 < len - 1) {
            l = l * (1 - g) + (L[k2] + (L[k2 + 1] - L[k2]) * f2) * g;
            r = r * (1 - g) + (R[k2] + (R[k2 + 1] - R[k2]) * f2) * g;
          } else { l *= 1 - g; r *= 1 - g; }
          this.xfPos += this.rate; this.xfLeft--;
        }
      }
      oL[i] = l * this.gain; oR[i] = r * this.gain;
      this.pos += this.rate;
      if (this.loopOn && this.pos >= this.loopEnd) {
        const ll = this.loopEnd - this.loopStart;
        if (ll > 8) this.jumpTo(this.loopStart + ((this.pos - this.loopEnd) % ll));
      }
      if (this.pos >= len - 1) {
        this.pos = len - 1; this.playing = false; this.gain = 0;
        this.port.postMessage({ type: 'ended' });
      }
    }
    return true;
  }
}

registerProcessor('deck-processor', DeckProcessor);
