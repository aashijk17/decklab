// App bootstrap: creates the audio engine, builds the UI and runs the
// per-frame refresh loop.

import { Engine } from './audio/engine.js';
import { Library } from './library.js';
import { Recorder, download } from './recorder.js';
import { DeckUI } from './ui/deck-ui.js';
import { MixerUI } from './ui/mixer-ui.js';
import { WaveView, Overview } from './ui/waves.js';
import { LibraryUI, DRAG_TYPE } from './ui/library-ui.js';
import { initShortcuts, cheatsheetHtml } from './ui/shortcuts.js';
import { initLearn, GUIDE_HTML } from './ui/learn.js';
import { setText, setClass, fmtTime } from './ui/controls.js';
import { decorate } from './ui/icons.js';
import * as spotify from './spotify.js';

const LS_SETTINGS = 'decklab.settings';
const $ = (id) => document.getElementById(id);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg;
  $('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
}

async function start() {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}; } catch { /* first run */ }

  const engine = new Engine();
  try { await engine.init(); } catch (e) {
    document.body.innerHTML = `<div class="empty"><b>DeckLab could not start the audio engine.</b><span>${String(e.message || e)}<br>Use a current version of Chrome, Edge or Firefox, and open the page over http(s) — not as a file:// URL.</span></div>`;
    return;
  }
  const library = new Library(engine);
  const recorder = new Recorder(engine);
  const { decks } = engine;

  const app = {
    engine, library, settings, toast, deckUIs: {},
    saveSettings() {
      settings.decks = {};
      for (const id of ['A', 'B']) settings.decks[id] = { range: decks[id].range, keylock: decks[id].keylock };
      settings.zoom = waves.A.pps;
      try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch { /* ignore */ }
    },
    async loadToDeck(trackId, deckId) {
      const track = library.get(trackId), deck = decks[deckId], ui = app.deckUIs[deckId];
      if (!track) return;
      if (deck.playing) return toast(`Deck ${deckId} is playing — pause it before loading another track.`);
      if (track.status === 'error') return toast(`“${track.title}” can't be played: ${track.error}`, 'err');
      ui.setLoading(track.title);
      try {
        const buf = await engine.decode(track.file);
        if (!track.duration) track.duration = buf.duration;
        deck.sync = false;
        deck.load(track, buf);
      } catch {
        toast(`Could not decode “${track.title}”. This browser may not support the file format.`, 'err');
      }
      ui.setLoading(null);
      app.libraryUI.invalidate();
    },
    loadSelected(deckId) { if (app.libraryUI.selected) app.loadToDeck(app.libraryUI.selected, deckId); },
    async addFiles(files) {
      const r = await library.addFiles(files);
      if (!r.added && r.skipped) toast('No supported audio files found (MP3, WAV, FLAC, AAC/M4A).');
    },
    openModal(html, name) { $('modalBody').innerHTML = html; $('overlay').classList.remove('hidden'); app.modal = name; },
    closeModal() { $('overlay').classList.add('hidden'); app.modal = null; },
    toggleCheatsheet() { if (app.modal === 'keys') app.closeModal(); else app.openModal(cheatsheetHtml(), 'keys'); },
  };

  // ---------- restore deck settings ----------
  for (const id of ['A', 'B']) {
    const s = (settings.decks && settings.decks[id]) || {};
    if ([0.08, 0.16, 0.5].includes(s.range)) decks[id].range = s.range;
    decks[id].setKeylock(!!s.keylock);
    decks[id].onSave = (t) => library.save(t);
  }

  // ---------- build UI ----------
  const waves = {
    A: new WaveView($('waveA'), decks.A, '#22d3ee'),
    B: new WaveView($('waveB'), decks.B, '#f472b6'),
  };
  if ([75, 150, 300].includes(settings.zoom)) waves.A.pps = waves.B.pps = settings.zoom;
  app.deckUIs.A = new DeckUI($('deckA'), decks.A, app);
  app.deckUIs.B = new DeckUI($('deckB'), decks.B, app);
  const overviews = {
    A: new Overview(app.deckUIs.A.el.overview, decks.A),
    B: new Overview(app.deckUIs.B.el.overview, decks.B),
  };
  app.mixerUI = new MixerUI($('mixer'), app);
  app.libraryUI = new LibraryUI(app);
  decorate();
  initShortcuts(app);
  initLearn(app);

  const zoom = (f) => {
    const z = Math.max(75, Math.min(300, waves.A.pps * f));
    waves.A.pps = waves.B.pps = z; app.saveSettings();
  };
  $('zoomIn').addEventListener('click', () => zoom(2));
  $('zoomOut').addEventListener('click', () => zoom(0.5));

  // ---------- modals ----------
  $('helpBtn').addEventListener('click', () => app.toggleCheatsheet());
  $('guideBtn').addEventListener('click', () => app.openModal(GUIDE_HTML, 'guide'));
  $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay' || e.target.classList.contains('modal-x')) app.closeModal(); });

  // ---------- drag & drop ----------
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const isTrack = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE);
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (isFiles(e)) { dragDepth++; $('dropzone').classList.remove('hidden'); } });
  window.addEventListener('dragleave', (e) => { if (isFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.add('hidden'); } });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('dropzone').classList.add('hidden');
    const r = await library.addFromDrop(e.dataTransfer);
    if (!r.added && r.skipped) toast('No supported audio files found (MP3, WAV, FLAC, AAC/M4A).');
  });
  document.querySelectorAll('[data-deck]').forEach((zone) => {
    const id = zone.dataset.deck;
    zone.addEventListener('dragover', (e) => { if (isTrack(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('dragover'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      zone.classList.remove('dragover');
      const tid = e.dataTransfer.getData(DRAG_TYPE);
      if (tid) { e.preventDefault(); app.loadToDeck(tid, id); }
    });
  });

  // ---------- recording ----------
  const recBtn = $('recBtn'), recTime = $('recTime'), dlWav = $('dlWav'), dlMp3 = $('dlMp3');
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  recBtn.addEventListener('click', async () => {
    engine.resume();
    if (!recorder.recording) {
      recorder.start(); dlWav.disabled = dlMp3.disabled = true;
    } else {
      await recorder.stop();
      dlWav.disabled = dlMp3.disabled = recorder.take.frames === 0;
      toast(`Recorded ${fmtTime(recorder.elapsed, false)} — download it as WAV or MP3.`, 'ok');
    }
  });
  dlWav.addEventListener('click', () => download(recorder.wavBlob(), `decklab-mix-${stamp()}.wav`));
  dlMp3.addEventListener('click', async () => {
    dlMp3.disabled = true;
    try {
      const blob = await recorder.mp3Blob((p) => { dlMp3.lastElementChild.textContent = `${Math.round(p * 100)}%`; });
      download(blob, `decklab-mix-${stamp()}.mp3`);
    } catch (e) { toast(e.message, 'err'); }
    dlMp3.lastElementChild.textContent = 'MP3'; dlMp3.disabled = false;
  });
  window.addEventListener('beforeunload', (e) => { if (recorder.recording) { e.preventDefault(); e.returnValue = ''; } });

  // Browsers only allow sound after a click or key press.
  const unlock = () => engine.resume();
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);

  // ---------- Spotify redirect ----------
  spotify.handleRedirect().then((r) => {
    if (r === 'ok') { toast('Spotify connected.', 'ok'); app.libraryUI.showTab('crate'); }
    else if (r) toast(r, 'err');
  });

  // ---------- frame loop ----------
  const phDot = $('phDot'), phA = $('phInfoA'), phB = $('phInfoB');
  function frame(now) {
    for (const id of ['A', 'B']) decks[id].tick(now);
    // Sync follow: keep a synced deck's tempo glued to the other deck.
    for (const [d, o] of [[decks.A, decks.B], [decks.B, decks.A]]) {
      if (!d.sync) continue;
      if (!d.bpm || !o.loaded || !o.bpm) { d.sync = false; continue; }
      const t = d.syncTempoFor(o);
      if (Math.abs(t) > d.range) { d.sync = false; continue; }
      if (Math.abs(t - d.tempo) > 1e-6) d.setTempo(t, true);
    }
    for (const id of ['A', 'B']) { app.deckUIs[id].update(); waves[id].draw(); overviews[id].draw(); }
    app.mixerUI.update(now);

    const both = decks.A.bpm && decks.B.bpm;
    setText(phA, decks.A.bpm ? `A ${decks.A.effBpm.toFixed(2)} BPM` : '');
    setText(phB, decks.B.bpm ? `${both ? `Δ ${(decks.B.effBpm - decks.A.effBpm >= 0 ? '+' : '')}${(decks.B.effBpm - decks.A.effBpm).toFixed(2)} · ` : ''}B ${decks.B.effBpm.toFixed(2)} BPM` : '');
    if (both) {
      const off = decks.A.phaseOffsetTo(decks.B);
      phDot.style.left = `${50 + off * 96}%`;
      setClass(phDot, 'ok', Math.abs(off) < 0.035);
      setClass(phDot, 'live', decks.A.playing && decks.B.playing);
    } else { setClass(phDot, 'live', false); setClass(phDot, 'ok', false); }

    setClass(recBtn, 'on', recorder.recording);
    setClass(recTime, 'on', recorder.recording);
    setText(recBtn.lastElementChild, recorder.recording ? 'STOP' : 'REC');
    setText(recTime, fmtTime(recorder.elapsed, false).padStart(5, '0'));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.decklab = app;     // handy for debugging in the console
}

start();
