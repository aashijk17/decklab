// Per-deck effects rack: echo, reverb, flanger, phaser.
// Every effect is a parallel "send": output = dry + wet * effect(input).
// Switching an effect off only closes its send, so echo/reverb tails ring out.

const TC = 0.015;

function impulse(ctx, seconds = 2.4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
  }
  return buf;
}

export const FX_NAMES = ['echo', 'reverb', 'flanger', 'phaser'];

export class FxRack {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 120;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
    this.state = {};
    this.fx = {};
    for (const name of FX_NAMES) {
      this.state[name] = { on: false, wet: 0.5, div: 1 };
      const send = ctx.createGain(); send.gain.value = 0;
      const wet = ctx.createGain(); wet.gain.value = 0.5;
      this.input.connect(send);
      wet.connect(this.output);
      this.fx[name] = { send, wet };
    }

    // Echo: delay line with filtered feedback.
    {
      const f = this.fx.echo;
      f.delay = ctx.createDelay(4);
      f.fb = ctx.createGain(); f.fb.gain.value = 0.55;
      f.tone = ctx.createBiquadFilter(); f.tone.type = 'lowpass'; f.tone.frequency.value = 3800;
      f.send.connect(f.delay); f.delay.connect(f.wet);
      f.delay.connect(f.tone); f.tone.connect(f.fb); f.fb.connect(f.delay);
    }
    // Reverb: convolution with a generated noise-decay impulse response.
    {
      const f = this.fx.reverb;
      f.conv = ctx.createConvolver(); f.conv.buffer = impulse(ctx);
      f.send.connect(f.conv); f.conv.connect(f.wet);
    }
    // Flanger: very short delay swept by an LFO, with feedback.
    {
      const f = this.fx.flanger;
      f.delay = ctx.createDelay(0.05); f.delay.delayTime.value = 0.005;
      f.fb = ctx.createGain(); f.fb.gain.value = 0.6;
      f.lfo = ctx.createOscillator(); f.lfo.type = 'sine';
      f.depth = ctx.createGain(); f.depth.gain.value = 0.002;
      f.lfo.connect(f.depth); f.depth.connect(f.delay.delayTime); f.lfo.start();
      f.send.connect(f.delay); f.delay.connect(f.wet);
      f.delay.connect(f.fb); f.fb.connect(f.delay);
    }
    // Phaser: chain of all-pass filters swept by an LFO.
    {
      const f = this.fx.phaser;
      f.stages = [];
      f.lfo = ctx.createOscillator(); f.lfo.type = 'sine';
      f.depth = ctx.createGain(); f.depth.gain.value = 700;
      f.lfo.connect(f.depth); f.lfo.start();
      let node = f.send;
      for (let i = 0; i < 4; i++) {
        const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 1000; ap.Q.value = 0.6;
        f.depth.connect(ap.frequency);
        node.connect(ap); node = ap; f.stages.push(ap);
      }
      node.connect(f.wet);
    }
    this.retime();
  }

  setOn(name, on) {
    this.state[name].on = on;
    this.fx[name].send.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, TC);
  }

  setWet(name, v) {
    this.state[name].wet = v;
    this.fx[name].wet.gain.setTargetAtTime(v, this.ctx.currentTime, TC);
  }

  setDiv(name, div) { this.state[name].div = div; this.retime(); }

  setBpm(bpm) {
    if (!bpm || Math.abs(bpm - this.bpm) < 0.005) return;
    this.bpm = bpm; this.retime();
  }

  retime() {
    const t = this.ctx.currentTime, beat = 60 / this.bpm;
    this.fx.echo.delay.delayTime.setTargetAtTime(Math.min(3.9, beat * this.state.echo.div), t, 0.03);
    // LFO sweeps: one full cycle every (division x 4) beats.
    this.fx.flanger.lfo.frequency.setTargetAtTime(1 / (beat * 4 * this.state.flanger.div), t, TC);
    this.fx.phaser.lfo.frequency.setTargetAtTime(1 / (beat * 4 * this.state.phaser.div), t, TC);
  }
}
