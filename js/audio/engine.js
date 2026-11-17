// Audio graph:
//   deck worklet -> trim -> EQ low/mid/high -> filter (LP+HP) -> FX rack
//        -> [VU tap] -> channel fader -> crossfader gain -> master -> speakers
//                                                             \-> recorder

import { Deck } from './deck.js';
import { FxRack } from './fx.js';

const TC = 0.012;
const KILL_DB = -40;

function peak(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
  return p;
}

export class Channel {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.trim = ctx.createGain();
    const bq = (type, f, q) => {
      const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
      if (q) n.Q.value = q; return n;
    };
    this.eq = { low: bq('lowshelf', 220), mid: bq('peaking', 1000, 0.7), high: bq('highshelf', 3500) };
    this.eqDb = { low: 0, mid: 0, high: 0 };
    this.kill = { low: false, mid: false, high: false };
    this.lp = bq('lowpass', 22000, 0.707);
    this.hp = bq('highpass', 10, 0.707);
    this.fx = new FxRack(ctx);
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 1024;
    this.meterBuf = new Float32Array(1024);
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.input = this.trim;
    this.trim.connect(this.eq.low); this.eq.low.connect(this.eq.mid); this.eq.mid.connect(this.eq.high);
    this.eq.high.connect(this.lp); this.lp.connect(this.hp); this.hp.connect(this.fx.input);
    this.fx.output.connect(this.meter);
    this.fx.output.connect(this.fader); this.fader.connect(this.xf); this.xf.connect(dest);
  }

  p(param, v) { param.setTargetAtTime(v, this.ctx.currentTime, TC); }

  // All setters take normalised knob values.
  setTrim(v) { this.p(this.trim.gain, Math.pow(10, ((v - 0.5) * 24) / 20)); }       // -12..+12 dB
  setEq(band, v) {                                                                  // -26..+6 dB
    this.eqDb[band] = v < 0.5 ? -26 * (1 - v / 0.5) : 6 * ((v - 0.5) / 0.5);
    this.applyEq(band);
  }
  setKill(band, on) { this.kill[band] = on; this.applyEq(band); }
  applyEq(band) { this.p(this.eq[band].gain, this.kill[band] ? KILL_DB : this.eqDb[band]); }

  // One-knob filter: v in 0..1, centre = off, left = low-pass, right = high-pass.
  setFilter(v) {
    const x = (v - 0.5) * 2;
    let lp = 22000, hp = 10, q = 0.707;
    if (x < -0.03) { lp = 20000 * Math.pow(80 / 20000, -x); q = 1.4; }
    else if (x > 0.03) { hp = 20 * Math.pow(8000 / 20, x); q = 1.4; }
    this.p(this.lp.frequency, lp); this.p(this.hp.frequency, hp);
    this.p(this.lp.Q, x < -0.03 ? q : 0.707); this.p(this.hp.Q, x > 0.03 ? q : 0.707);
  }
  setFader(v) { this.p(this.fader.gain, v * v); }
  setXf(g) { this.p(this.xf.gain, g); }
  level() { return peak(this.meter, this.meterBuf); }
}

export class Engine {
  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    await ctx.audioWorklet.addModule(new URL('./worklets/deck-processor.js', import.meta.url));
    await ctx.audioWorklet.addModule(new URL('./worklets/recorder-processor.js', import.meta.url));

    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const split = ctx.createChannelSplitter(2);
    this.master.connect(split);
    this.mL = ctx.createAnalyser(); this.mR = ctx.createAnalyser();
    this.mL.fftSize = this.mR.fftSize = 1024;
    split.connect(this.mL, 0); split.connect(this.mR, 1);
    this.mBuf = new Float32Array(1024);

    this.recNode = new AudioWorkletNode(ctx, 'recorder-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit',
    });
    const mute = ctx.createGain(); mute.gain.value = 0;
    this.master.connect(this.recNode); this.recNode.connect(mute); mute.connect(ctx.destination);

    this.channels = { A: new Channel(ctx, this.master), B: new Channel(ctx, this.master) };
    this.decks = {
      A: new Deck(ctx, 'A', this.channels.A.input),
      B: new Deck(ctx, 'B', this.channels.B.input),
    };
    this.decks.A.other = this.decks.B; this.decks.B.other = this.decks.A;
    this.xfPos = 0.5; this.xfCurve = 'smooth';
    this.setCrossfader(0.5);
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  async decode(file) {
    const data = await file.arrayBuffer();
    return this.ctx.decodeAudioData(data);
  }

  setMaster(v) { this.master.gain.setTargetAtTime(v * v * 1.4, this.ctx.currentTime, TC); }

  setCrossfader(x, curve = this.xfCurve) {
    this.xfPos = x; this.xfCurve = curve;
    let a, b;
    if (curve === 'sharp') {           // both decks at full almost the whole way: for cuts
      a = Math.min(1, (1 - x) / 0.08); b = Math.min(1, x / 0.08);
    } else {                           // equal-power blend: for long smooth transitions
      a = Math.cos(x * Math.PI / 2); b = Math.sin(x * Math.PI / 2);
    }
    this.channels.A.setXf(a); this.channels.B.setXf(b);
  }

  masterLevels() { return [peak(this.mL, this.mBuf), peak(this.mR, this.mBuf)]; }
}
