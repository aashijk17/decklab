// One deck: wraps the playback worklet and holds all transport state
// (tempo, cue, hot cues, loops, sync). Times are in seconds unless noted.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const frac = (x) => x - Math.floor(x);

export class Deck {
  constructor(ctx, id, output) {
    this.ctx = ctx; this.id = id; this.sr = ctx.sampleRate;
    this.node = new AudioWorkletNode(ctx, 'deck-processor', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    });
    this.node.connect(output);
    this.node.port.onmessage = (e) => this.onMsg(e.data);
    this.track = null; this.len = 0;
    this.playing = false; this.cuePreview = false;
    this.tempo = 0; this.range = 0.08; this.nudge = 0; this.keylock = false;
    this.cue = 0;
    this.loop = { in: null, out: null, on: false };
    this.roll = null;
    this.sync = false;
    this.seq = 0;
    this.rep = { pos: 0, t: 0, playing: false };
    this.disp = 0; this.lastTick = 0;
    this.onSave = null;   // called when track data (cues, bpm) should be persisted
  }

  // ---------- plumbing ----------
  cmd(m, transfer) { m.seq = ++this.seq; this.node.port.postMessage(m, transfer || []); }

  onMsg(m) {
    if (m.type === 'pos') {
      if (m.seq === this.seq) this.rep = { pos: m.pos, t: m.t, playing: m.playing };
    } else if (m.type === 'ended') {
      this.playing = false; this.cuePreview = false;
      this.rep = { pos: this.len - 1, t: this.ctx.currentTime, playing: false };
    }
  }

  rawPos() {
    let p = this.rep.pos;
    if (this.rep.playing) p += (this.ctx.currentTime - this.rep.t) * this.sr * this.rate;
    const lp = this.loop;
    if (lp.on && lp.out > lp.in) {
      const a = lp.in * this.sr, b = lp.out * this.sr;
      if (p >= b) p = a + ((p - b) % (b - a));
    }
    return clamp(p, 0, Math.max(0, this.len - 1));
  }

  // Called once per animation frame: smooths the reported position for display.
  tick(now) {
    const raw = this.rawPos();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.playing) { this.disp = raw; return; }
    this.disp += this.rate * dt * this.sr;
    const err = raw - this.disp;
    if (Math.abs(err) > 0.015 * this.sr) this.disp = raw; else this.disp += err * 0.2;
  }

  // ---------- getters ----------
  get loaded() { return !!this.track; }
  get duration() { return this.len / this.sr; }
  get pos() { return this.disp / this.sr; }
  get rate() { return (1 + this.tempo) * (1 + this.nudge); }
  get bpm() { return (this.track && this.track.bpm) || 0; }
  get effBpm() { return this.bpm * (1 + this.tempo); }
  get beatLen() { return this.bpm ? 60 / this.bpm : 0; }
  get grid() { return (this.track && this.track.gridOffset) || 0; }
  beatPos(sec = this.pos) { return this.bpm ? (sec - this.grid) / this.beatLen : 0; }
  nearestBeat(sec = this.pos) {
    return this.bpm ? this.grid + Math.round(this.beatPos(sec)) * this.beatLen : sec;
  }
  save() { if (this.track && this.onSave) this.onSave(this.track); }

  // ---------- loading ----------
  load(track, audioBuffer) {
    const L = audioBuffer.getChannelData(0).slice();
    const R = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1).slice() : L.slice();
    this.len = L.length;
    this.cmd({ type: 'load', L, R }, [L.buffer, R.buffer]);
    this.track = track;
    this.playing = false; this.cuePreview = false; this.roll = null;
    this.loop = { in: null, out: null, on: false };
    if (!track.hotcues) track.hotcues = new Array(8).fill(null);
    this.cue = track.cue || 0;
    this.rep = { pos: 0, t: this.ctx.currentTime, playing: false };
    this.disp = 0;
    this.pushRate();
    this.node.port.postMessage({ type: 'keylock', on: this.keylock });
    if (this.cue > 0) this.seek(this.cue);
  }

  // ---------- transport ----------
  play() {
    if (!this.loaded || this.playing) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    const p = this.rawPos();
    this.playing = true;
    this.cmd({ type: 'play' });
    this.rep = { pos: p, t: this.ctx.currentTime, playing: true };
    // A synced deck drops in on the beat of the deck that is already playing.
    if (this.sync && this.other && !this.cuePreview) this.alignPhase(this.other);
  }

  pause() {
    if (!this.playing) return;
    const p = this.rawPos();
    this.playing = false; this.cuePreview = false;
    this.cmd({ type: 'pause' });
    this.rep = { pos: p, t: this.ctx.currentTime, playing: false };
  }

  toggle() {
    if (this.cuePreview) { this.cuePreview = false; return; }  // keep playing after cue-hold
    if (this.playing) this.pause(); else this.play();
  }

  seek(sec) {
    if (!this.loaded) return;
    const p = clamp(sec * this.sr, 0, this.len - 1);
    const lp = this.loop;
    if (lp.on && !this.roll && (sec < lp.in - 0.001 || sec >= lp.out)) this.setLoop(lp.in, lp.out, false);
    this.cmd({ type: 'seek', pos: p });
    this.rep = { pos: p, t: this.ctx.currentTime, playing: this.playing };
    this.disp = p;
  }

  jumpBy(sec) {
    if (!this.loaded) return;
    const d = sec * this.sr;
    const p = clamp(this.rawPos() + d, 0, this.len - 1);
    this.cmd({ type: 'jump', delta: d });
    this.rep = { pos: p, t: this.ctx.currentTime, playing: this.playing };
    this.disp = p;
  }

  // CDJ-style cue: while playing -> back to cue and stop. While paused on the
  // cue point -> preview for as long as the button is held. Paused elsewhere ->
  // move the cue point here.
  cueDown() {
    if (!this.loaded) return;
    if (this.playing && !this.cuePreview) { this.pause(); this.seek(this.cue); }
    else if (!this.playing) {
      if (Math.abs(this.rawPos() / this.sr - this.cue) < 0.012) { this.cuePreview = true; this.play(); }
      else { this.cue = this.rawPos() / this.sr; this.track.cue = this.cue; this.save(); }
    }
  }

  cueUp() {
    if (this.cuePreview) { this.pause(); this.seek(this.cue); }
  }

  // ---------- tempo ----------
  pushRate() { this.node.port.postMessage({ type: 'rate', rate: this.rate }); }
  setTempo(t, fromSync = false) {
    this.tempo = clamp(t, -this.range, this.range);
    if (!fromSync) this.sync = false;
    this.pushRate();
  }
  setRange(r) { this.range = r; this.setTempo(this.tempo, true); }
  setNudge(n) { this.nudge = n; this.pushRate(); }
  setKeylock(on) { this.keylock = on; this.node.port.postMessage({ type: 'keylock', on }); }

  setBpm(bpm) {
    if (!this.track || !(bpm > 20 && bpm < 400)) return;
    this.track.bpm = Math.round(bpm * 100) / 100;
    this.save();
  }

  // Slide the beat grid so a beat sits exactly at the current position.
  setGridHere() {
    if (!this.bpm) return;
    const bl = this.beatLen;
    this.track.gridOffset = ((this.pos % bl) + bl) % bl;
    this.save();
  }

  // ---------- sync ----------
  syncTempoFor(other) {
    let r = other.effBpm / this.bpm;
    if (r > 1.42) r /= 2; else if (r < 0.71) r *= 2;   // treat half/double time as the same tempo
    return r - 1;
  }

  // In beats, -0.5..0.5; positive = other is ahead. `raw` uses the unsmoothed
  // engine position (most accurate, used when actually moving the deck).
  phaseOffsetTo(other, raw = false) {
    const a = raw ? this.rawPos() / this.sr : this.pos, b = raw ? other.rawPos() / other.sr : other.pos;
    let d = frac(other.beatPos(b)) - frac(this.beatPos(a));
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    return d;
  }

  alignPhase(other) {
    if (!this.bpm || !other.bpm || !other.playing) return;
    let d = this.phaseOffsetTo(other, true) * this.beatLen;
    // Can't jump to before the start (or past the end): go one beat the other way.
    const p = this.rawPos() / this.sr;
    if (p + d < 0) d += this.beatLen; else if (p + d > this.duration - 0.05) d -= this.beatLen;
    this.jumpBy(d);
  }

  // Match tempo to the other deck and line the beats up. Returns false if impossible.
  syncTo(other) {
    if (!this.bpm || !other.loaded || !other.bpm) return false;
    const t = this.syncTempoFor(other);
    if (Math.abs(t) > this.range) {
      const r = [0.08, 0.16, 0.5].find((x) => Math.abs(t) <= x);
      if (!r) return false;
      this.range = r;
    }
    this.setTempo(t, true);
    this.sync = true;
    this.alignPhase(other);
    return true;
  }

  // ---------- hot cues ----------
  hotcue(i, del = false) {
    if (!this.loaded) return;
    const hc = this.track.hotcues;
    if (del) { hc[i] = null; this.save(); return; }
    if (hc[i] == null) { hc[i] = this.rawPos() / this.sr; this.save(); }
    else this.seek(hc[i]);
  }

  // ---------- loops ----------
  setLoop(a, b, on) {
    this.loop = { in: a, out: b, on: !!on };
    this.node.port.postMessage({
      type: 'loop', on: !!on && b > a, start: (a || 0) * this.sr, end: (b || 0) * this.sr,
    });
  }

  get loopBeats() {
    const lp = this.loop;
    return lp.in != null && lp.out != null && this.bpm ? (lp.out - lp.in) / this.beatLen : 0;
  }

  autoLoop(beats) {
    if (!this.loaded || !this.bpm) return;
    const lp = this.loop;
    if (lp.on && Math.abs(this.loopBeats - beats) < 1e-3) { this.setLoop(lp.in, lp.out, false); return; }
    const len = beats * this.beatLen;
    if (lp.on) { this.setLoop(lp.in, lp.in + len, true); return; }
    // Quantize: start the loop on the nearest beat so it stays on the grid.
    let start = this.nearestBeat();
    if (start > this.pos + 0.05 && beats < 1) start = this.pos;
    start = Math.max(0, start);
    this.setLoop(start, start + len, true);
  }

  loopIn() { if (this.loaded) this.setLoop(this.pos, null, false); }
  loopOut() {
    const lp = this.loop;
    if (this.loaded && lp.in != null && this.pos > lp.in + 0.01) this.setLoop(lp.in, this.pos, true);
  }
  loopToggle() {
    const lp = this.loop;
    if (lp.in == null || lp.out == null) return;
    if (lp.on) this.setLoop(lp.in, lp.out, false);
    else { this.seek(lp.in); this.setLoop(lp.in, lp.out, true); }
  }
  loopScale(f) {
    const lp = this.loop;
    if (lp.in == null || lp.out == null) return;
    const min = this.bpm ? this.beatLen / 32 : 0.01;
    const len = clamp((lp.out - lp.in) * f, min, this.duration);
    this.setLoop(lp.in, lp.in + len, lp.on);
  }

  // Loop roll: loop while held; on release, jump to where the track would have
  // been if it had kept playing ("slip").
  rollStart(beats) {
    if (!this.loaded || !this.bpm || this.roll) return;
    this.roll = { t0: this.ctx.currentTime, pos0: this.pos, prev: { ...this.loop }, wasPlaying: this.playing };
    this.setLoop(this.pos, this.pos + beats * this.beatLen, true);
  }
  rollEnd() {
    if (!this.roll) return;
    const r = this.roll;
    const target = r.wasPlaying ? r.pos0 + (this.ctx.currentTime - r.t0) * this.rate : r.pos0;
    this.setLoop(r.prev.in, r.prev.out, false);
    this.roll = null;
    this.seek(Math.min(target, this.duration - 0.05));
  }
}
