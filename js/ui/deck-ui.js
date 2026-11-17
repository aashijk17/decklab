// Builds one deck panel and keeps it in sync with its Deck object.

import { makeKnob, makeFader, setText, setClass, fmtTime } from './controls.js';
import { FX_NAMES } from '../audio/fx.js';

export const PAD_COLORS = ['#ff3d5a', '#ff9a1f', '#ffe01f', '#37e07a', '#1fd6ff', '#4a7dff', '#b46bff', '#ff62d0'];
const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const ROLL_SIZES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
const RANGES = [0.08, 0.16, 0.5];
const NUDGE = 0.04;
const beatsLabel = (b) => (b >= 1 ? String(b) : `1/${Math.round(1 / b)}`);

const TIPS = {
  sync: 'SYNC matches this deck\'s tempo to the other deck and lines the beats up for you. Great for learning, but try beatmatching by ear with the tempo slider and NUDGE too!',
  cue: 'CUE: while playing, jumps back to the cue point and stops. While paused: sets the cue point here — or, if you are already on it, plays for as long as you hold the button (handy for checking your start point).',
  play: 'Play / pause this deck.',
  tap: 'Tap this button in time with the music (4+ taps) to set the BPM by hand if the detected value is wrong.',
  half: 'Halve the BPM. Use it when the detector found double the real tempo (e.g. 170 instead of 85).',
  dbl: 'Double the BPM. Use it when the detector found half the real tempo.',
  bpmedit: 'Type the exact BPM yourself.',
  grid: 'Move the beat grid so a beat line sits exactly at the current position. Pause on a kick drum, then press this if the white grid lines do not sit on the beats.',
  nudge: 'Pitch bend / nudge: briefly slows down or speeds up the deck while held. Use it to push the beats back in line with the other deck when they drift apart — this is the core of beatmatching by ear.',
  pads: 'Performance pads. HOT CUE: click an empty pad to store the current position, click again to jump there instantly, Shift+click (or right-click) to delete. BEAT LOOP: start a loop of that many beats. LOOP ROLL: loops only while held, then the track carries on where it would have been.',
  loop: 'Manual loop: press IN where the loop should start, OUT where it should end. RELOOP/EXIT leaves the loop or jumps back into the last one. ½ and ×2 change its length.',
  range: 'Range of the tempo slider: ±8% is precise for normal mixing, ±16% and ±50% are for bigger tempo changes.',
  tempo: 'Tempo slider: move DOWN to speed the track up, UP to slow it down (like real turntables/CDJs). Two tracks must run at the same BPM before their beats can stay together. Double-click to reset to 0%.',
  keylock: 'Key lock (master tempo): keeps the musical pitch the same when you change the tempo. Off = the track sounds higher/lower like a record played at the wrong speed.',
  overview: 'Whole-track overview. Click anywhere to jump there. Coloured ticks are your hot cues.',
  bpm: 'Current tempo in beats per minute (after the tempo slider). Underneath is the track\'s original BPM.',
  key: 'Musical key in Camelot notation. Tracks mix harmonically when the numbers are the same or one apart with the same letter (8A → 7A, 8A, 9A), or the same number with the other letter (8A ↔ 8B).',
  fx: {
    echo: 'Echo / delay: repeats the sound in time with the beat. Try switching it on for the last beat before a transition. The dropdown sets the repeat length in beats.',
    reverb: 'Reverb: adds the sound of a big room. Nice for washing a track out during a transition.',
    flanger: 'Flanger: a sweeping "jet plane" whoosh. The dropdown sets how many bars one sweep takes.',
    phaser: 'Phaser: a softer swirling sweep. The dropdown sets how many bars one sweep takes.',
  },
};

export class DeckUI {
  constructor(root, deck, app) {
    this.root = root; this.deck = deck; this.app = app;
    this.channel = app.engine.channels[deck.id];
    this.mode = 'hot';
    this.taps = [];
    this.loadingText = null;
    this.build();
  }

  $(s) { return this.root.querySelector(s); }

  build() {
    const id = this.deck.id;
    this.root.innerHTML = `
      <div class="deck-head">
        <div class="badge">${id}</div>
        <div class="tinfo"><div class="ttitle"></div><div class="tartist"></div></div>
        <div class="tkey" data-tip="${TIPS.key}"><b class="camelot">–</b><span class="keyname">KEY</span></div>
        <div class="tbpm" data-tip="${TIPS.bpm}"><b class="bpmval">–</b><span class="bpmorig">BPM</span></div>
        <div class="ttime"><b class="elapsed">0:00.0</b><span class="remain">-0:00.0</span></div>
      </div>
      <canvas class="overview" data-tip="${TIPS.overview}"></canvas>
      <div class="deck-body">
        <div class="transport">
          <div class="beatleds" data-tip="Beat counter: lights 1-2-3-4 with the beat. Dance music is built in groups of 4 beats (a bar)."><i></i><i></i><i></i><i></i></div>
          <button class="tbtn sync" data-tip="${TIPS.sync}">SYNC</button>
          <button class="tbtn cue" data-tip="${TIPS.cue}">CUE</button>
          <button class="tbtn play" data-tip="${TIPS.play}">▶❙❙</button>
        </div>
        <div class="deck-mid">
          <div class="row">
            <button class="btn xs tap" data-tip="${TIPS.tap}">TAP</button>
            <button class="btn xs half" data-tip="${TIPS.half}">÷2</button>
            <button class="btn xs dbl" data-tip="${TIPS.dbl}">×2</button>
            <button class="btn xs bpmedit" data-tip="${TIPS.bpmedit}">BPM…</button>
            <button class="btn xs gridhere" data-tip="${TIPS.grid}">GRID◆</button>
            <span class="sp"></span>
            <span class="lbl">NUDGE</span>
            <button class="btn xs nudgedn" data-tip="${TIPS.nudge}">◀ −</button>
            <button class="btn xs nudgeup" data-tip="${TIPS.nudge}">+ ▶</button>
          </div>
          <div class="padmodes" data-tip="${TIPS.pads}">
            <button data-mode="hot" class="active">HOT CUE</button>
            <button data-mode="loop">BEAT LOOP</button>
            <button data-mode="roll">LOOP ROLL</button>
          </div>
          <div class="pads" data-tip="${TIPS.pads}">${Array.from({ length: 8 }, (_, i) => `<button class="pad" data-i="${i}" style="--pc:${PAD_COLORS[i]}"></button>`).join('')}</div>
          <div class="row looprow" data-tip="${TIPS.loop}">
            <button class="btn xs lin">IN</button><button class="btn xs lout">OUT</button>
            <button class="btn xs lre">RELOOP / EXIT</button>
            <button class="btn xs lhalf">½</button><button class="btn xs ldbl">×2</button>
            <span class="loopinfo">NO LOOP</span>
          </div>
          <div class="fxrow"></div>
        </div>
        <div class="tempo-col">
          <button class="btn xs range" data-tip="${TIPS.range}">±8%</button>
          <div class="tempoval">0.00%</div>
          <button class="btn xs keylock" data-tip="${TIPS.keylock}">KEY LOCK</button>
        </div>
      </div>`;

    const d = this.deck, on = (sel, ev, fn) => this.$(sel).addEventListener(ev, fn);
    this.el = {};
    for (const c of ['ttitle', 'tartist', 'camelot', 'keyname', 'bpmval', 'bpmorig', 'elapsed', 'remain',
      'sync', 'cue', 'play', 'loopinfo', 'tempoval', 'range', 'keylock', 'lre', 'overview']) this.el[c] = this.$('.' + c);
    this.leds = [...this.root.querySelectorAll('.beatleds i')];
    this.pads = [...this.root.querySelectorAll('.pad')];

    // transport
    on('.play', 'click', () => d.toggle());
    const cueBtn = this.el.cue;
    cueBtn.addEventListener('pointerdown', (e) => { cueBtn.setPointerCapture(e.pointerId); d.cueDown(); });
    for (const ev of ['pointerup', 'pointercancel']) cueBtn.addEventListener(ev, () => d.cueUp());
    on('.sync', 'click', () => this.toggleSync());

    // bpm tools
    on('.tap', 'click', () => this.tap());
    on('.half', 'click', () => d.setBpm(d.bpm / 2));
    on('.dbl', 'click', () => d.setBpm(d.bpm * 2));
    on('.bpmedit', 'click', () => {
      if (!d.loaded) return;
      const v = parseFloat(prompt(`BPM for "${d.track.title}"`, d.bpm || ''));
      if (v) d.setBpm(v);
    });
    on('.gridhere', 'click', () => d.setGridHere());

    // nudge (hold)
    for (const [sel, dir] of [['.nudgedn', -1], ['.nudgeup', 1]]) {
      const b = this.$(sel);
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); d.setNudge(dir * NUDGE); });
      for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => d.setNudge(0));
    }

    // pads
    this.root.querySelectorAll('.padmodes button').forEach((b) => b.addEventListener('click', () => {
      this.mode = b.dataset.mode;
      this.root.querySelectorAll('.padmodes button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    this.pads.forEach((p, i) => {
      p.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        p.setPointerCapture(e.pointerId); this.padDown(i, e.shiftKey);
      });
      for (const ev of ['pointerup', 'pointercancel']) p.addEventListener(ev, () => this.padUp(i));
      p.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.mode === 'hot') d.hotcue(i, true); });
    });

    // loops
    on('.lin', 'click', () => d.loopIn());
    on('.lout', 'click', () => d.loopOut());
    on('.lre', 'click', () => d.loopToggle());
    on('.lhalf', 'click', () => d.loopScale(0.5));
    on('.ldbl', 'click', () => d.loopScale(2));

    // tempo
    const col = this.$('.tempo-col');
    this.tempoFader = makeFader({
      value: 0.5, def: 0.5, mark: true, tip: TIPS.tempo,
      onChange: (v) => d.setTempo((0.5 - v) * 2 * d.range),
    });
    col.insertBefore(this.tempoFader.el, this.el.tempoval);
    on('.range', 'click', () => {
      const r = RANGES[(RANGES.indexOf(d.range) + 1) % RANGES.length];
      d.setRange(r); this.app.saveSettings();
    });
    on('.keylock', 'click', () => { d.setKeylock(!d.keylock); this.app.saveSettings(); });

    // fx
    const fxrow = this.$('.fxrow');
    this.fxBtns = {};
    for (const name of FX_NAMES) {
      const u = document.createElement('div');
      u.className = 'fxu'; u.dataset.tip = TIPS.fx[name];
      const btn = document.createElement('button');
      btn.className = 'btn xs fxon'; btn.textContent = name.toUpperCase();
      btn.addEventListener('click', () => this.toggleFx(name));
      this.fxBtns[name] = btn;
      const body = document.createElement('div'); body.className = 'fxb';
      const knob = makeKnob({ value: 0.5, def: 0.5, size: 26, onChange: (v) => this.channel.fx.setWet(name, v) });
      knob.el.title = 'Wet / dry amount';
      body.append(knob.el);
      if (name === 'reverb') {
        body.insertAdjacentHTML('beforeend', '<span class="nodiv">wet</span>');
      } else {
        const sel = document.createElement('select');
        sel.title = 'Beat division';
        sel.innerHTML = [[0.25, '1/4'], [0.5, '1/2'], [1, '1'], [2, '2']].map(([v, l]) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${l}</option>`).join('');
        sel.addEventListener('change', () => { this.channel.fx.setDiv(name, parseFloat(sel.value)); sel.blur(); });
        body.append(sel);
      }
      u.append(btn, body); fxrow.append(u);
    }

    // overview seek
    const ov = this.el.overview;
    const seekAt = (e) => {
      const r = ov.getBoundingClientRect();
      if (d.loaded) d.seek(((e.clientX - r.left) / r.width) * d.duration);
    };
    ov.addEventListener('pointerdown', (e) => { ov.setPointerCapture(e.pointerId); seekAt(e); });
    ov.addEventListener('pointermove', (e) => { if (ov.hasPointerCapture(e.pointerId)) seekAt(e); });
  }

  // ---------- actions (also used by keyboard shortcuts) ----------
  toggleSync() {
    const d = this.deck, other = this.app.engine.decks[d.id === 'A' ? 'B' : 'A'];
    if (d.sync) { d.sync = false; return; }
    if (!d.loaded || !d.bpm) return this.app.toast('Load a track with a detected BPM first.');
    if (!other.loaded || !other.bpm) return this.app.toast(`Nothing to sync to — load a track on deck ${other.id}.`);
    if (!d.syncTo(other)) this.app.toast('The tempos are too far apart to sync.');
    this.app.saveSettings();
  }

  toggleFx(name) {
    const fx = this.channel.fx, on = !fx.state[name].on;
    fx.setOn(name, on);
    this.fxBtns[name].classList.toggle('on', on);
  }

  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 12) this.taps.shift();
    if (this.taps.length >= 4) {
      const span = this.taps[this.taps.length - 1] - this.taps[0];
      this.deck.setBpm(Math.round((60000 / (span / (this.taps.length - 1))) * 10) / 10);
    }
  }

  padDown(i, shift = false) {
    const d = this.deck;
    if (this.mode === 'hot') d.hotcue(i, shift);
    else if (this.mode === 'loop') d.autoLoop(LOOP_SIZES[i]);
    else d.rollStart(ROLL_SIZES[i]);
  }
  padUp() { if (this.deck.roll) this.deck.rollEnd(); }

  setLoading(text) { this.loadingText = text; }

  // ---------- per-frame refresh ----------
  update() {
    const d = this.deck, t = d.track, el = this.el;
    if (this.loadingText) {
      setText(el.ttitle, `Loading ${this.loadingText}…`); setText(el.tartist, 'Decoding audio');
    } else if (!t) {
      setText(el.ttitle, 'No track loaded'); setText(el.tartist, 'Drag a track here from the library below');
    } else {
      setText(el.ttitle, t.title); setText(el.tartist, t.artist || '—');
    }
    setText(el.camelot, (t && t.camelot) || '–');
    setText(el.keyname, (t && t.key) || 'KEY');
    setText(el.bpmval, d.bpm ? d.effBpm.toFixed(2) : (t && t.status === 'analyzing' ? '…' : '–'));
    setText(el.bpmorig, d.bpm ? `orig ${d.bpm}` : 'BPM');
    const pos = d.pos;
    setText(el.elapsed, fmtTime(pos));
    setText(el.remain, '-' + fmtTime(d.duration - pos));
    setClass(el.remain, 'warn', d.playing && d.duration - pos < 30);
    el.remain.style.color = d.playing && d.duration - pos < 30 ? 'var(--red)' : '';

    setClass(el.play, 'on', d.playing);
    setClass(el.cue, 'on', d.cuePreview);
    setClass(el.sync, 'on', d.sync);
    setClass(el.keylock, 'on', d.keylock);
    setText(el.range, `±${Math.round(d.range * 100)}%`);
    setText(el.tempoval, `${d.tempo >= 0 ? '+' : ''}${(d.tempo * 100).toFixed(2)}%`);
    const fv = 0.5 - d.tempo / (2 * d.range);
    if (Math.abs(fv - this.tempoFader.get()) > 1e-4) this.tempoFader.set(fv, false);

    // beat LEDs
    const beat = d.bpm && t ? ((Math.floor(d.beatPos(pos)) % 4) + 4) % 4 : -1;
    this.leds.forEach((l, i) => setClass(l, 'on', i === beat && d.loaded));

    // pads
    const hc = (t && t.hotcues) || [];
    this.pads.forEach((p, i) => {
      let label, set = false, act = false;
      if (this.mode === 'hot') {
        set = hc[i] != null; label = set ? fmtTime(hc[i], false) : String(i + 1);
      } else if (this.mode === 'loop') {
        label = beatsLabel(LOOP_SIZES[i]); act = d.loop.on && !d.roll && Math.abs(d.loopBeats - LOOP_SIZES[i]) < 1e-3;
      } else {
        label = beatsLabel(ROLL_SIZES[i]); act = !!d.roll && Math.abs(d.loopBeats - ROLL_SIZES[i]) < 1e-3;
      }
      setText(p, label); setClass(p, 'set', set); setClass(p, 'act', act);
    });

    // loop
    const lp = d.loop, has = lp.in != null && lp.out != null;
    setClass(el.lre, 'on', lp.on);
    setClass(el.loopinfo, 'on', lp.on);
    setText(el.loopinfo, has
      ? `LOOP ${d.bpm ? beatsLabel(Math.round(d.loopBeats * 32) / 32) + ' beats' : (lp.out - lp.in).toFixed(2) + 's'}`
      : lp.in != null ? 'IN set — press OUT' : 'NO LOOP');

    this.channel.fx.setBpm(d.effBpm || 120);
  }
}
