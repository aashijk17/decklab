// Track analysis, run in a Web Worker so the UI never freezes.
// Input:  { id, mono: Float32Array, sampleRate }
// Output: { id, ok, bpm, gridOffset, key, camelot, wave: { rate, low, mid, high } }
//
// Everything here is hand-written (no libraries):
//  - waveform: 3-band peak envelope (bass / mids / highs) at 150 points per second
//  - BPM: onset-strength envelope -> autocorrelation -> refinement at long lags
//  - beat grid: phase histogram of onsets at the detected tempo
//  - key: FFT chromagram matched against Krumhansl-Kessler key profiles

const WAVE_RATE = 150;

function computeWave(x, sr) {
  const n = Math.max(1, Math.floor((x.length / sr) * WAVE_RATE));
  const low = new Uint8Array(n), mid = new Uint8Array(n), high = new Uint8Array(n);
  const aL = 1 - Math.exp((-2 * Math.PI * 180) / sr), aM = 1 - Math.exp((-2 * Math.PI * 2500) / sr);
  const hop = sr / WAVE_RATE;
  let lp1 = 0, lp2 = 0;
  for (let p = 0; p < n; p++) {
    const s = Math.floor(p * hop), e = Math.min(x.length, Math.floor((p + 1) * hop));
    let pl = 0, pm = 0, ph = 0;
    for (let i = s; i < e; i++) {
      const v = x[i];
      lp1 += aL * (v - lp1); lp2 += aM * (v - lp2);
      const l = Math.abs(lp1), m = Math.abs(lp2 - lp1), h = Math.abs(v - lp2);
      if (l > pl) pl = l; if (m > pm) pm = m; if (h > ph) ph = h;
    }
    low[p] = Math.min(255, pl * 255 * 1.1);
    mid[p] = Math.min(255, pm * 255 * 1.5);
    high[p] = Math.min(255, ph * 255 * 2.2);
  }
  return { rate: WAVE_RATE, low, mid, high };
}

function decimate(x, sr) {
  const D = Math.max(1, Math.round(sr / 11025));
  const n = Math.floor(x.length / D), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < D; j++) s += x[i * D + j];
    y[i] = s / D;
  }
  return { y, sr: sr / D };
}

// ---------------------------------------------------------------- tempo
function detectTempo(y, sr) {
  const H = 32, fr = sr / H, N = Math.floor(y.length / H);
  if (N < fr * 6) return { bpm: 0, gridOffset: 0 };

  // Energy envelopes: full band and bass band (kick drums).
  const eF = new Float32Array(N), eL = new Float32Array(N);
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let lp = 0;
  for (let f = 0; f < N; f++) {
    let sF = 0, sL = 0;
    for (let i = 0; i < H; i++) {
      const v = y[f * H + i];
      lp += a * (v - lp); sF += v * v; sL += lp * lp;
    }
    eF[f] = Math.sqrt(sF / H); eL[f] = Math.sqrt(sL / H);
  }
  const W = 6;
  const smooth = (e) => {
    const out = new Float32Array(N);
    let acc = 0;
    for (let n = 0; n < N; n++) {
      acc += e[n]; if (n >= W) acc -= e[n - W];
      out[n] = Math.log(1 + (300 * acc) / W);
    }
    return out;
  };
  const sF = smooth(eF), sL = smooth(eL);
  // Onset strength: how sharply the energy rises.
  const on = new Float32Array(N);
  let mean = 0;
  for (let n = 2; n < N; n++) {
    on[n] = Math.max(0, sF[n] - sF[n - 2]) + 1.5 * Math.max(0, sL[n] - sL[n - 2]);
    mean += on[n];
  }
  mean /= N;
  if (mean < 1e-6) return { bpm: 0, gridOffset: 0 };
  const o = new Float32Array(N);
  for (let n = 0; n < N; n++) o[n] = on[n] - mean;

  const cache = new Map();
  const ac = (lag) => {
    if (lag < 1 || lag >= N - 1) return 0;
    let v = cache.get(lag);
    if (v === undefined) {
      let s = 0;
      for (let n = 0, m = N - lag; n < m; n++) s += o[n] * o[n + lag];
      v = s / (N - lag);
      cache.set(lag, v);
    }
    return v;
  };
  const acI = (x) => { const i = Math.floor(x), f = x - i; return ac(i) * (1 - f) + ac(i + 1) * f; };

  // Coarse search 60-200 BPM with a gentle preference for typical dance tempos.
  let best = -Infinity, bestBpm = 120;
  for (let bpm = 60; bpm <= 200; bpm += 0.25) {
    const L = (fr * 60) / bpm;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 124) / 0.55, 2));
    const score = (acI(L) + 0.5 * acI(2 * L) + 0.25 * acI(4 * L)) * prior;
    if (score > best) { best = score; bestBpm = bpm; }
  }

  // Refine the beat period by locating autocorrelation peaks at 1x, 2x, 4x ... 64x
  // the period: an error of a fraction of a frame at 64 beats is a tiny BPM error.
  const peakNear = (c, R) => {
    const c0 = Math.round(c);
    let bi = c0, bv = -Infinity;
    for (let l = c0 - R; l <= c0 + R; l++) { const v = ac(l); if (v > bv) { bv = v; bi = l; } }
    if (bi === c0 - R || bi === c0 + R || bv <= 0) return null;
    const y0 = ac(bi - 1), y1 = bv, y2 = ac(bi + 1);
    const d = y0 - 2 * y1 + y2;
    return bi + (d < 0 ? (0.5 * (y0 - y2)) / d : 0);
  };
  let L = (fr * 60) / bestBpm;
  for (const k of [1, 2, 4, 8, 16, 32, 64]) {
    if (k * L > N / 3) break;
    const p = peakNear(k * L, 3);
    if (p == null) break;
    L = p / k;
  }
  let bpm = (fr * 60) / L;
  if (Math.abs(bpm - Math.round(bpm)) < 0.06) bpm = Math.round(bpm);
  else if (Math.abs(bpm * 2 - Math.round(bpm * 2)) < 0.06) bpm = Math.round(bpm * 2) / 2;
  else bpm = Math.round(bpm * 100) / 100;

  // Beat phase: fold every onset into one beat period and find where they pile up.
  const P = (fr * 60) / bpm, nb = Math.max(8, Math.round(P));
  const hist = new Float64Array(nb);
  for (let n = 0; n < N; n++) {
    if (on[n] <= 0) continue;
    const ph = n / P;
    hist[Math.min(nb - 1, Math.floor((ph - Math.floor(ph)) * nb))] += on[n];
  }
  let bb = 0, bv = -1;
  for (let b = 0; b < nb; b++) {
    const v = hist[(b + nb - 1) % nb] + 2 * hist[b] + hist[(b + 1) % nb];
    if (v > bv) { bv = v; bb = b; }
  }
  const beatSec = 60 / bpm;
  // The onset detector answers slightly after the true attack; compensate.
  let off = (((bb + 0.5) / nb) * P * H) / sr - ONSET_LATENCY;
  off = ((off % beatSec) + beatSec) % beatSec;
  return { bpm, gridOffset: off };
}
const ONSET_LATENCY = 0.004;

// ---------------------------------------------------------------- key
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0, h = len >> 1; j < h; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + h] * cr - im[i + j + h] * ci, vi = re[i + j + h] * ci + im[i + j + h] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + h] = ur - vr; im[i + j + h] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CAM_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAM_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function corr(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let s = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; da += x * x; db += y * y; }
  return s / Math.sqrt(da * db + 1e-12);
}

function detectKey(y, sr) {
  const N = 8192;
  if (y.length < N * 2) return { key: '', camelot: '' };
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const kMin = Math.ceil((55 * N) / sr), kMax = Math.min(N / 2 - 1, Math.floor((2000 * N) / sr));
  const pc = new Int8Array(kMax + 1), wt = new Float32Array(kMax + 1);
  for (let k = kMin; k <= kMax; k++) {
    const pitch = 69 + 12 * Math.log2((k * sr) / N / 440), near = Math.round(pitch);
    pc[k] = ((near % 12) + 12) % 12;
    wt[k] = Math.pow(Math.cos((pitch - near) * Math.PI), 2);
  }
  const chroma = new Float64Array(12), re = new Float32Array(N), im = new Float32Array(N);
  const frames = Math.floor(y.length / N);
  const stride = Math.max(1, Math.floor(frames / 400));   // cap work on very long files
  for (let f = 0; f < frames; f += stride) {
    for (let i = 0; i < N; i++) { re[i] = y[f * N + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = kMin; k <= kMax; k++) chroma[pc[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]) * wt[k];
  }
  let best = -2, tonic = 0, minor = false;
  const rot = new Float64Array(12);
  for (let t = 0; t < 12; t++) {
    for (let i = 0; i < 12; i++) rot[i] = chroma[(i + t) % 12];
    const cM = corr(rot, MAJOR), cm = corr(rot, MINOR);
    if (cM > best) { best = cM; tonic = t; minor = false; }
    if (cm > best) { best = cm; tonic = t; minor = true; }
  }
  return {
    key: NAMES[tonic] + (minor ? 'm' : ''),
    camelot: (minor ? CAM_MIN[tonic] + 'A' : CAM_MAJ[tonic] + 'B'),
  };
}

function analyze(mono, sampleRate) {
  const wave = computeWave(mono, sampleRate);
  const dec = decimate(mono, sampleRate);
  return { wave, ...detectTempo(dec.y, dec.sr), ...detectKey(dec.y, dec.sr) };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof module === 'undefined') {
  self.onmessage = (e) => {
    const { id, mono, sampleRate } = e.data;
    try {
      const r = analyze(mono, sampleRate);
      self.postMessage({ id, ok: true, ...r }, [r.wave.low.buffer, r.wave.mid.buffer, r.wave.high.buffer]);
    } catch (err) {
      self.postMessage({ id, ok: false, error: String(err && err.message || err) });
    }
  };
}
if (typeof module !== 'undefined') module.exports = { analyze };
