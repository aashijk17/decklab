// Small reusable controls: rotary knob and linear fader. Both work on a
// normalised 0..1 value. Drag to move, double-click to reset, wheel to nudge.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function makeKnob({ label = '', value = 0.5, def = value, size = 36, bipolar = false, onChange, tip, cls = '' }) {
  const el = document.createElement('div');
  el.className = `knob-wrap ${cls}`;
  el.innerHTML = `<div class="knob${bipolar ? ' bipolar' : ''}" style="--s:${size}px"><div class="knob-dial"><i></i></div></div>${label ? `<label>${label}</label>` : ''}`;
  if (tip) el.dataset.tip = tip;
  const knob = el.firstChild, dial = knob.firstChild;
  let v = value;
  const set = (nv, fire = true) => {
    v = clamp01(nv);
    dial.style.transform = `rotate(${-135 + v * 270}deg)`;
    knob.style.setProperty('--v', v);
    if (fire && onChange) onChange(v);
  };
  let sy = 0, sv = 0;
  knob.addEventListener('pointerdown', (e) => {
    knob.setPointerCapture(e.pointerId); sy = e.clientY; sv = v; e.preventDefault();
  });
  knob.addEventListener('pointermove', (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    set(sv + ((sy - e.clientY) / 140) * (e.shiftKey ? 0.25 : 1));
  });
  knob.addEventListener('dblclick', () => set(def));
  knob.addEventListener('wheel', (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * 0.03); }, { passive: false });
  set(value, false);
  return { el, set, get: () => v };
}

export function makeFader({ vertical = true, value = 0.5, def = value, mark = false, onChange, tip, cls = '' }) {
  const el = document.createElement('div');
  el.className = `fader ${vertical ? 'v' : 'h'} ${cls}`;
  el.innerHTML = `<div class="ftrack"></div>${mark ? '<div class="fmark"></div>' : ''}<div class="fthumb"></div>`;
  if (tip) el.dataset.tip = tip;
  let v = value;
  const set = (nv, fire = true) => {
    v = clamp01(nv);
    el.style.setProperty('--v', v);
    if (fire && onChange) onChange(v);
  };
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top - 8) / (r.height - 16) : (e.clientX - r.left - 8) / (r.width - 16);
  };
  let grab = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId); e.preventDefault();
    // Grabbing the cap keeps its offset; clicking the track jumps there.
    const pv = fromEvent(e);
    grab = e.target.classList.contains('fthumb') ? pv - v : 0;
    set(pv - grab);
  });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(fromEvent(e) - grab); });
  el.addEventListener('dblclick', () => set(def));
  set(value, false);
  return { el, set, get: () => v };
}

// Cheap DOM helpers that only touch the DOM when something actually changed.
export const setText = (el, s) => { if (el._s !== s) { el._s = s; el.textContent = s; } };
export const setClass = (el, c, on) => {
  const k = '_c_' + c; on = !!on;
  if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); }
};
export const fmtTime = (s, tenths = true) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = s - m * 60;
  return tenths ? `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
};
