// Mixer panel: per-channel trim, 3-band EQ with kills, filter, faders, VU
// meters and the crossfader.

import { makeKnob, makeFader, setClass } from './controls.js';

const TIPS = {
  trim: 'Trim / gain: sets how loud this track enters the mixer. Use it to make both tracks peak at about the same height on the level meters before you blend them.',
  high: 'HIGH EQ: hi-hats, cymbals and "air". Turn left to cut. The small button underneath is a kill switch (removes the band completely).',
  mid: 'MID EQ: vocals, synths and melodies. Cutting mids makes room when two melodies clash.',
  low: 'LOW EQ: kick drum and bassline. Golden rule: only ONE track should have its bass up at a time. When blending, cut the incoming track\'s bass, then swap the two bass knobs at the start of a phrase.',
  filter: 'Filter: centre = off. Turn LEFT for a low-pass (muffles the highs, like music heard through a wall), turn RIGHT for a high-pass (removes the bass, leaving a thin sound). Sweeping it is an easy, great-sounding transition tool.',
  fader: 'Channel fader: the volume of this deck in the mix. Bring it up to introduce a track, pull it down to take it out.',
  vu: 'Channel level meter (before the fader). Keep peaks in the yellow; constant red means the trim is too high.',
  xf: 'Crossfader: slides the mix between deck A (left) and deck B (right). In the middle you hear both. Double-click to centre.',
  curve: 'Crossfader curve. SMOOTH: gradual blend, best for long transitions. SHARP: both decks are at full volume almost the whole way, for quick cuts and scratching.',
  master: 'Master volume: the overall loudness of everything you hear (and record).',
};

const meterFrac = (peak) => {
  const db = 20 * Math.log10(Math.max(peak, 1e-5));
  return Math.max(0, Math.min(1, (db + 42) / 48));      // 0 dB sits at 0.875
};

export class MixerUI {
  constructor(root, app) {
    this.root = root; this.app = app; this.engine = app.engine;
    this.kills = { A: {}, B: {} };
    this.vu = {}; this.vuVal = { A: 0, B: 0 }; this.mVal = [0, 0]; this.clipUntil = 0;
    this.build();
  }

  build() {
    const eng = this.engine, s = this.app.settings;
    const strip = (id) => {
      const ch = eng.channels[id];
      const el = document.createElement('div');
      el.className = `strip ${id}`;
      el.append(makeKnob({ label: 'Trim', value: 0.5, bipolar: true, size: 32, tip: TIPS.trim, onChange: (v) => ch.setTrim(v) }).el);
      for (const [band, label] of [['high', 'High'], ['mid', 'Mid'], ['low', 'Low']]) {
        const row = document.createElement('div'); row.className = 'eqk';
        const kill = document.createElement('button');
        kill.className = 'kill'; kill.textContent = 'K'; kill.title = `Kill ${band}`;
        kill.addEventListener('click', () => this.toggleKill(id, band));
        this.kills[id][band] = kill;
        row.append(makeKnob({ label, value: 0.5, bipolar: true, tip: TIPS[band], onChange: (v) => ch.setEq(band, v) }).el, kill);
        el.append(row);
      }
      el.append(makeKnob({ label: 'Filter', value: 0.5, bipolar: true, tip: TIPS.filter, onChange: (v) => ch.setFilter(v) }).el);
      return el;
    };
    const center = document.createElement('div'); center.className = 'mx-center';
    const vu = (id) => {
      const v = document.createElement('div'); v.className = 'vu'; v.dataset.tip = TIPS.vu;
      v.innerHTML = '<i></i>'; this.vu[id] = v.firstChild; return v;
    };
    const fader = (id) => makeFader({ value: 0.85, def: 0.85, tip: TIPS.fader, onChange: (v) => eng.channels[id].setFader(v) });
    this.faders = { A: fader('A'), B: fader('B') };
    eng.channels.A.setFader(0.85); eng.channels.B.setFader(0.85);
    center.append(this.faders.A.el, vu('A'), vu('B'), this.faders.B.el);

    const xfw = document.createElement('div'); xfw.className = 'xfwrap';
    this.xf = makeFader({
      vertical: false, value: 0.5, def: 0.5, mark: true, tip: TIPS.xf,
      onChange: (v) => eng.setCrossfader(v),
    });
    this.curveBtn = document.createElement('button');
    this.curveBtn.className = 'btn xs'; this.curveBtn.dataset.tip = TIPS.curve;
    this.curveBtn.addEventListener('click', () => this.setCurve(eng.xfCurve === 'smooth' ? 'sharp' : 'smooth'));
    const a = document.createElement('b'); a.textContent = 'A';
    const b = document.createElement('b'); b.textContent = 'B';
    xfw.append(a, this.xf.el, b, this.curveBtn);

    this.root.append(strip('A'), center, strip('B'), xfw);
    this.setCurve(s.xfCurve || 'smooth', false);

    // master knob lives in the top bar
    this.master = makeKnob({
      label: 'Master', value: s.master ?? 0.75, def: 0.75, size: 30, cls: 'master-knob', tip: TIPS.master,
      onChange: (v) => { eng.setMaster(v); s.master = v; this.app.saveSettings(); },
    });
    eng.setMaster(this.master.get());
    document.getElementById('masterGroup').prepend(this.master.el);
    this.mm = [document.getElementById('mmL'), document.getElementById('mmR')];
    this.clip = document.getElementById('clipLed');
  }

  setCurve(curve, save = true) {
    this.engine.setCrossfader(this.engine.xfPos, curve);
    this.curveBtn.textContent = curve === 'smooth' ? 'SMOOTH' : 'SHARP';
    this.app.settings.xfCurve = curve;
    if (save) this.app.saveSettings();
  }

  toggleKill(id, band) {
    const ch = this.engine.channels[id], on = !ch.kill[band];
    ch.setKill(band, on);
    this.kills[id][band].classList.toggle('on', on);
  }

  nudgeXf(d) { this.xf.set(this.xf.get() + d); }

  update(now) {
    for (const id of ['A', 'B']) {
      const f = meterFrac(this.engine.channels[id].level());
      this.vuVal[id] = Math.max(f, this.vuVal[id] - 0.02);
      this.vu[id].style.setProperty('--v', this.vuVal[id].toFixed(3));
    }
    const lv = this.engine.masterLevels();
    lv.forEach((p, i) => {
      this.mVal[i] = Math.max(meterFrac(p), this.mVal[i] - 0.02);
      this.mm[i].style.setProperty('--v', this.mVal[i].toFixed(3));
      if (p >= 0.999) this.clipUntil = now + 1200;
    });
    setClass(this.clip, 'on', now < this.clipUntil);
  }
}
