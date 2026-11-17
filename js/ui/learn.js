// Learning mode: hover any control to get a plain-English explanation,
// plus a short "DJ basics" guide.

export function initLearn(app) {
  const tip = document.getElementById('tip'), btn = document.getElementById('learnBtn');
  let current = null;

  const apply = () => {
    const on = !!app.settings.learn;
    document.body.classList.toggle('learn', on);
    btn.classList.toggle('on', on);
    btn.lastElementChild.textContent = `Learning mode: ${on ? 'ON' : 'OFF'}`;
    if (!on) hide();
  };
  const hide = () => { tip.classList.add('hidden'); current = null; };
  const show = (target) => {
    current = target;
    tip.textContent = target.dataset.tip;
    tip.classList.remove('hidden');
    const r = target.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
    if (y + th > innerHeight - 6) y = r.top - th - 8;
    tip.style.left = `${Math.max(6, Math.min(innerWidth - tw - 6, x))}px`;
    tip.style.top = `${Math.max(6, y)}px`;
  };

  document.addEventListener('pointerover', (e) => {
    if (!app.settings.learn) return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === current) return;
    if (t) show(t); else hide();
  });
  document.addEventListener('pointerdown', hide);
  btn.addEventListener('click', () => { app.settings.learn = !app.settings.learn; app.saveSettings(); apply(); });
  apply();
}

export const GUIDE_HTML = `
<h2>DJ basics in five minutes</h2>
<div class="guide">
  <div><h3>1 · The goal</h3><p>A DJ mix moves from one track to the next without the dance floor noticing a gap. To do that, both tracks have to play at the <b>same tempo</b> with their <b>beats landing together</b> while you fade from one to the other.</p></div>
  <div><h3>2 · Beatmatching</h3><p>Play deck A. Load deck B and move its <b>tempo slider</b> until both BPM numbers match. Start B on a beat, then use <b>NUDGE</b> to push its beats exactly onto A's — watch the <b>phase meter</b> between the waveforms; centred and green means locked. <b>SYNC</b> does all of this for you while you learn.</p></div>
  <div><h3>3 · Phrasing</h3><p>Dance music changes every 16 or 32 beats (4 or 8 bars). Start the new track at the beginning of a phrase — when the old track's phrase also starts — and the mix feels natural. The bright lines in the waveform mark every 4th beat. Set a <b>hot cue</b> on the first beat of the track so you can launch it on time.</p></div>
  <div><h3>4 · EQ: one bassline at a time</h3><p>Two kick drums and two basslines together sound muddy and loud. Before blending, turn the incoming track's <b>LOW</b> knob down. Bring its fader up, then at a phrase change swap the bass: new track's LOW up, old track's LOW down. Then fade the old track out.</p></div>
  <div><h3>5 · Levels</h3><p>Use <b>TRIM</b> so both tracks reach the same height on the channel meters. Keep the master meter out of the red — if <b>CLIP</b> lights up, the recording will distort.</p></div>
  <div><h3>6 · Harmonic mixing</h3><p>Each track shows its key as a <b>Camelot code</b> like 8A. Tracks blend musically when the code is the same, one number up or down (8A → 7A / 9A), or the same number with the other letter (8A ↔ 8B). The library highlights keys that fit what's loaded.</p></div>
  <div><h3>7 · Loops, filter & FX</h3><p>A <b>beat loop</b> on the outgoing track's outro buys you time. Sweeping the <b>filter</b> on the outgoing track is the easiest good-sounding exit. A touch of <b>echo</b> on the last beat lets a track trail away instead of stopping dead.</p></div>
  <div><h3>8 · Practise</h3><p>Turn on <b>Learning mode</b> and hover over anything you don't recognise. Press <b>REC</b>, record a 3-track mix, and listen back — it's the fastest way to improve. Then try it again with SYNC off.</p></div>
</div>`;
