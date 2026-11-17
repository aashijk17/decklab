// Canvas waveforms: the big scrolling view (playhead fixed in the centre)
// and the small whole-track overview on each deck.

import { PAD_COLORS } from './deck-ui.js';

const BANDS = [['low', '#1f63ff', 1.0], ['mid', '#ff9a26', 0.9], ['high', '#f4f7ff', 0.75]];

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

export class WaveView {
  constructor(canvas, deck, color) {
    this.canvas = canvas; this.deck = deck; this.color = color;
    this.pps = 150;    // pixels per second of real time
    // Drag the waveform to scrub through the track.
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); lastX = e.clientX; });
    canvas.addEventListener('pointermove', (e) => {
      if (!canvas.hasPointerCapture(e.pointerId) || !deck.loaded) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      if (dx) deck.seek(deck.pos - (dx / this.pps) * (1 + deck.tempo));
    });
  }

  draw() {
    const { g, w, h } = fit(this.canvas);
    const d = this.deck, t = d.track, mid = h / 2;
    g.clearRect(0, 0, w, h);
    g.fillStyle = this.color; g.fillRect(0, 0, 3, h);
    if (!t) {
      g.fillStyle = '#56616e'; g.font = '12px system-ui'; g.textAlign = 'center';
      g.fillText(`Deck ${d.id} — drag a track here`, w / 2, mid + 4);
      return;
    }
    // The time axis is real time, so two beat-matched decks have beat lines
    // that are spaced identically on screen even if their BPMs differ.
    const pos = d.pos, spp = (1 + d.tempo) / this.pps;
    const xOf = (sec) => (sec - pos) / spp + w / 2;

    const lp = d.loop;
    if (lp.in != null && lp.out != null) {
      g.fillStyle = lp.on ? '#37e07a38' : '#ffffff14';
      g.fillRect(xOf(lp.in), 0, (lp.out - lp.in) / spp, h);
    }

    const wave = t.wave;
    if (wave) {
      const n = wave.low.length, step = spp * wave.rate;      // data points per pixel
      const c = pos * wave.rate;
      const i0 = Math.max(0, Math.floor(c - (w / 2) * step)), i1 = Math.min(n - 1, Math.ceil(c + (w / 2) * step));
      const bw = Math.max(1, 1 / step) + 0.3;
      for (const [band, col, sc] of BANDS) {
        const arr = wave[band];
        g.fillStyle = col; g.beginPath();
        for (let i = i0; i <= i1; i++) {
          const a = (arr[i] / 255) * mid * sc;
          if (a < 0.4) continue;
          g.rect((i - c) / step + w / 2, mid - a, bw, a * 2);
        }
        g.fill();
      }
    } else {
      g.fillStyle = '#56616e'; g.font = '12px system-ui'; g.textAlign = 'center';
      g.fillText(t.status === 'error' ? 'Analysis failed' : 'Analysing waveform…', w / 2, 14);
    }

    // beat grid
    if (d.bpm) {
      const bl = d.beatLen, t0 = pos - (w / 2) * spp, t1 = pos + (w / 2) * spp;
      for (let k = Math.ceil((t0 - d.grid) / bl); ; k++) {
        const bt = d.grid + k * bl;
        if (bt > t1) break;
        if (bt < 0) continue;
        const x = Math.round(xOf(bt)), bar = ((k % 4) + 4) % 4 === 0;
        g.fillStyle = bar ? '#ffffffcc' : '#ffffff55';
        g.fillRect(x, 0, 1, bar ? h : 8); if (!bar) g.fillRect(x, h - 8, 1, 8);
      }
    }

    // cue + hot cues
    const marker = (sec, col, label) => {
      const x = xOf(sec);
      if (x < -20 || x > w + 20) return;
      g.fillStyle = col; g.fillRect(x - 1, 0, 2, h);
      g.fillRect(x, 0, 13, 12);
      g.fillStyle = '#000'; g.font = 'bold 9px system-ui'; g.textAlign = 'center';
      g.fillText(label, x + 6.5, 9);
    };
    marker(d.cue, '#ffb300', 'C');
    (t.hotcues || []).forEach((hc, i) => { if (hc != null) marker(hc, PAD_COLORS[i], String(i + 1)); });

    // playhead
    g.fillStyle = '#ff3d52'; g.fillRect(w / 2 - 1, 0, 2, h);
  }
}

export class Overview {
  constructor(canvas, deck, color) {
    this.canvas = canvas; this.deck = deck; this.color = color;
    this.cache = document.createElement('canvas'); this.cacheKey = null;
  }

  render(w, h, wave) {
    const dpr = window.devicePixelRatio || 1;
    this.cache.width = Math.round(w * dpr); this.cache.height = Math.round(h * dpr);
    const g = this.cache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = wave.low.length, per = n / w, mid = h / 2;
    for (const [band, col, sc] of BANDS) {
      const arr = wave[band];
      g.fillStyle = col; g.beginPath();
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let i = Math.floor(x * per), e = Math.min(n, Math.ceil((x + 1) * per)); i < e; i++) if (arr[i] > m) m = arr[i];
        const a = (m / 255) * mid * sc;
        g.rect(x, mid - a, 1, Math.max(1, a * 2));
      }
      g.fill();
    }
  }

  draw() {
    const { g, w, h } = fit(this.canvas);
    const d = this.deck, t = d.track;
    g.clearRect(0, 0, w, h);
    if (!t || !d.duration) return;
    const wave = t.wave;
    if (wave) {
      const key = `${t.id}|${w}|${h}|${wave.low.length}`;
      if (key !== this.cacheKey) { this.render(w, h, wave); this.cacheKey = key; }
      g.drawImage(this.cache, 0, 0, w, h);
    }
    const xOf = (sec) => (sec / d.duration) * w;
    const px = xOf(d.pos);
    g.fillStyle = '#000000a0'; g.fillRect(0, 0, px, h);
    const lp = d.loop;
    if (lp.in != null && lp.out != null) {
      g.fillStyle = lp.on ? '#37e07a66' : '#ffffff30';
      g.fillRect(xOf(lp.in), 0, Math.max(2, xOf(lp.out) - xOf(lp.in)), h);
    }
    g.fillStyle = '#ffb300'; g.fillRect(xOf(d.cue) - 1, h - 8, 2, 8);
    (t.hotcues || []).forEach((hc, i) => {
      if (hc == null) return;
      g.fillStyle = PAD_COLORS[i]; g.fillRect(xOf(hc) - 1, 0, 3, 9);
    });
    g.fillStyle = '#fff'; g.fillRect(px - 1, 0, 2, h);
  }
}
