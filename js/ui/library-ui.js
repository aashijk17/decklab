// Bottom browser: the local Library table and the Spotify "Crate / To-Get" list.

import { fmtTime } from './controls.js';
import * as spotify from '../spotify.js';

export const DRAG_TYPE = 'application/x-decklab-track';
const LS_CRATE = 'decklab.crate';

function compatible(a, b) {      // Camelot wheel neighbours
  const pa = /^(\d+)([AB])$/.exec(a || ''), pb = /^(\d+)([AB])$/.exec(b || '');
  if (!pa || !pb) return false;
  const na = +pa[1], nb = +pb[1];
  if (na === nb) return true;
  return pa[2] === pb[2] && ((na % 12) + 1 === nb || (nb % 12) + 1 === na);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export class LibraryUI {
  constructor(app) {
    this.app = app; this.lib = app.library;
    this.sort = { key: null, dir: 1 }; this.filter = ''; this.selected = null; this.dirty = false;
    this.tbody = document.querySelector('#libTable tbody');
    this.crateEl = document.getElementById('panel-crate');
    try { this.crate = JSON.parse(localStorage.getItem(LS_CRATE)) || null; } catch { this.crate = null; }
    this.playlists = null; this.user = ''; this.crateBusy = '';

    this.lib.addEventListener('change', () => this.invalidate());
    document.getElementById('search').addEventListener('input', (e) => { this.filter = e.target.value.toLowerCase(); this.invalidate(); });
    document.querySelectorAll('#libTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 };
      this.invalidate();
    }));
    const fi = document.getElementById('fileInput'), di = document.getElementById('dirInput');
    document.getElementById('addFiles').addEventListener('click', () => fi.click());
    document.getElementById('addFolder').addEventListener('click', () => di.click());
    for (const inp of [fi, di]) inp.addEventListener('change', () => { app.addFiles([...inp.files]); inp.value = ''; });

    document.querySelectorAll('.br-bar .tab').forEach((tab) => tab.addEventListener('click', () => this.showTab(tab.dataset.tab)));
    this.render(); this.renderCrate();
  }

  showTab(name) {
    document.querySelectorAll('.br-bar .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.getElementById('panel-lib').classList.toggle('hidden', name !== 'lib');
    this.crateEl.classList.toggle('hidden', name !== 'crate');
    document.getElementById('libTools').style.visibility = name === 'lib' ? '' : 'hidden';
    if (name === 'crate' && spotify.loggedIn() && !this.playlists) this.loadPlaylists();
  }

  invalidate() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; this.render(); this.renderCrate(); });
  }

  visible() {
    let list = this.lib.tracks;
    if (this.filter) {
      list = list.filter((t) => `${t.title} ${t.artist} ${t.key} ${t.camelot}`.toLowerCase().includes(this.filter));
    }
    const { key, dir } = this.sort;
    if (key) {
      const val = (t) => (key === 'camelot' ? (parseInt(t.camelot, 10) || 99) * 2 + (/B$/.test(t.camelot) ? 1 : 0) : t[key]);
      list = [...list].sort((a, b) => {
        const x = val(a), y = val(b);
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
      });
    }
    return list;
  }

  moveSelection(d) {
    const list = this.visible();
    if (!list.length) return;
    let i = list.findIndex((t) => t.id === this.selected) + d;
    i = Math.max(0, Math.min(list.length - 1, i));
    this.selected = list[i].id; this.render();
    const row = this.tbody.children[i];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  render() {
    const { decks } = this.app.engine, list = this.visible();
    const refs = ['A', 'B'].map((id) => decks[id].track).filter(Boolean);
    document.getElementById('libCount').textContent = this.lib.tracks.length ? `(${this.lib.tracks.length})` : '';
    document.getElementById('libEmpty').classList.toggle('hidden', this.lib.tracks.length > 0);
    document.getElementById('libTable').classList.toggle('hidden', this.lib.tracks.length === 0);
    const frag = document.createDocumentFragment();
    for (const t of list) {
      const tr = el('tr');
      tr.draggable = true;
      if (t.id === this.selected) tr.classList.add('sel');
      if (decks.A.track === t) tr.classList.add('onA');
      if (decks.B.track === t) tr.classList.add('onB');
      const load = el('td', 'c-load');
      for (const id of ['A', 'B']) {
        const b = el('button', `ld ${id.toLowerCase()}`, id);
        b.title = `Load to deck ${id}`;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.app.loadToDeck(t.id, id); });
        load.append(b, ' ');
      }
      const bpm = el('td', 'num');
      if (t.status === 'ready') bpm.textContent = t.bpm ? (+t.bpm).toFixed(1) : '–';
      else bpm.append(el('span', `st${t.status === 'error' ? ' err' : ''}`, t.status === 'error' ? 'error' : t.status === 'analyzing' ? 'analysing…' : 'queued'));
      if (t.status === 'error') tr.title = t.error || '';
      const key = el('td', 'keytag');
      if (t.camelot) {
        key.append(el('b', '', t.camelot), t.key);
        if (refs.some((r) => r !== t && compatible(r.camelot, t.camelot))) { key.classList.add('match'); key.title = 'Harmonically compatible with a loaded deck'; }
      }
      tr.append(load, el('td', '', t.title), el('td', '', t.artist), el('td', 'num', t.duration ? fmtTime(t.duration, false) : ''), bpm, key);
      tr.addEventListener('click', () => { this.selected = t.id; this.render(); });
      tr.addEventListener('dblclick', () => {
        const target = !decks.A.loaded || (!decks.A.playing && decks.B.playing) ? 'A' : !decks.B.playing ? 'B' : 'A';
        this.app.loadToDeck(t.id, target);
      });
      tr.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.setData('text/plain', t.title);
        e.dataTransfer.effectAllowed = 'copy';
      });
      frag.append(tr);
    }
    this.tbody.replaceChildren(frag);
  }

  // ---------------------------------------------------------------- crate
  saveCrate() {
    try { localStorage.setItem(LS_CRATE, JSON.stringify(this.crate)); } catch { /* storage full: keep in memory */ }
  }

  async loadPlaylists() {
    this.crateBusy = 'Loading your playlists…'; this.renderCrate();
    try {
      const [lists, who] = await Promise.all([spotify.playlists(), spotify.me()]);
      this.user = who.name;
      // Spotify only lets apps like this read playlists you own or collaborate on.
      for (const p of lists) p.mine = !who.id || !p.ownerId || p.ownerId === who.id || p.collaborative;
      this.playlists = [...lists.filter((p) => p.mine), ...lists.filter((p) => !p.mine)];
      this.crateBusy = '';
    } catch (e) {
      this.playlists = null; this.crateBusy = '';
      this.app.toast(`Spotify: ${e.message}`, 'err');
    }
    this.renderCrate();
  }

  async pickPlaylist(id) {
    const pl = (this.playlists || []).find((p) => p.id === id);
    if (!pl) return;
    this.crateBusy = `Loading “${pl.name}”…`; this.renderCrate();
    try {
      const tracks = await spotify.playlistTracks(id);
      this.crate = { id, name: pl.name, tracks };
      this.saveCrate();
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        this.app.toast(`Spotify won't let this app read “${pl.name}” — it only allows playlists you own or collaborate on. Tip: in Spotify, add its tracks to a playlist of your own, then import that.`, 'err');
      } else this.app.toast(`Could not load that playlist: ${e.message}`, 'err');
    }
    this.crateBusy = ''; this.renderCrate();
  }

  renderCrate() {
    const root = this.crateEl, frag = document.createDocumentFragment();
    const bar = el('div', 'crate-bar');
    const tracks = (this.crate && this.crate.tracks) || [];
    document.getElementById('crateCount').textContent = tracks.length ? `(${tracks.length})` : '';

    if (!spotify.configured()) {
      const note = el('div', 'crate-note');
      note.innerHTML = `<b>Spotify import is not set up yet.</b><br>
        1. Create a free app at <b>developer.spotify.com/dashboard</b>.<br>
        2. Add this exact Redirect URI to the app: <code></code><br>
        3. Paste the app's Client ID into <code>js/config.js</code> and reload.<br>
        The README has the full step-by-step. Spotify is only used to list playlist tracks for planning — its audio cannot be mixed.`;
      note.querySelector('code').textContent = spotify.redirectUri;
      frag.append(note);
    } else if (!spotify.loggedIn()) {
      const b = el('button', 'btn', 'Connect Spotify');
      b.addEventListener('click', () => spotify.login().catch((e) => this.app.toast(e.message, 'err')));
      bar.append(b, el('span', 'who', 'Imports playlist track lists only (title, artist, artwork). No audio.'));
      frag.append(bar);
    } else {
      const sel = el('select');
      sel.append(new Option(this.playlists ? 'Choose a playlist…' : 'Playlists not loaded', ''));
      for (const p of this.playlists || []) {
        const label = p.count != null ? `${p.name} (${p.count})` : p.name;
        sel.append(new Option(p.mine ? label : `${label} — followed, Spotify may block it`, p.id));
      }
      if (this.crate && (this.playlists || []).some((p) => p.id === this.crate.id)) sel.value = this.crate.id;
      sel.addEventListener('change', () => sel.value && this.pickPlaylist(sel.value));
      const refresh = el('button', 'btn sm', 'Reload playlists');
      refresh.addEventListener('click', () => this.loadPlaylists());
      const out = el('button', 'btn sm', 'Disconnect');
      out.addEventListener('click', () => { spotify.logout(); this.playlists = null; this.renderCrate(); });
      bar.append(sel, refresh, out, el('span', 'who', this.crateBusy || (this.user ? `Connected as ${this.user}` : 'Connected')));
      frag.append(bar);
    }

    if (tracks.length) {
      const owned = tracks.filter((t) => this.lib.tracks.some((l) => spotify.matches(t, l))).length;
      frag.append(el('div', 'crate-note', `“${this.crate.name}” — ${owned} of ${tracks.length} tracks owned. These are Spotify listings for planning — they have no audio, so a TO GET track can't go on a deck. Get the track as a file (MP3, WAV, FLAC, M4A), drop the file anywhere on this page, and it turns OWNED and can be dragged onto a deck.`));
      for (const t of tracks) {
        const row = el('div', 'ct');
        if (t.art) { const img = el('img'); img.src = t.art; img.loading = 'lazy'; img.alt = ''; row.append(img); }
        else row.append(el('div', 'noart'));
        const local = this.lib.tracks.find((l) => spotify.matches(t, l));
        const have = !!local;
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          if (local) {
            e.dataTransfer.setData(DRAG_TYPE, local.id); e.dataTransfer.setData('text/plain', local.title);
            e.dataTransfer.effectAllowed = 'copy';
          } else {
            e.preventDefault();
            this.app.toast(`“${t.title}” is only a Spotify listing — Spotify audio can't be mixed. Add the track as an audio file (drop the file on this page), then drag it from the Library onto a deck.`);
          }
        });
        const link = el('div');
        if (t.url) { const a = el('a', '', 'Open in Spotify'); a.href = t.url; a.target = '_blank'; a.rel = 'noopener'; link.append(a); }
        row.append(el('div', 't', t.title), el('div', 'ar', t.artist || 'Unknown artist'),
          el('div', 'num', t.durationMs ? fmtTime(t.durationMs / 1000, false) : ''), link,
          el('div', `own${have ? ' yes' : ''}`, have ? 'OWNED' : 'TO GET'));
        frag.append(row);
      }
    } else if (spotify.configured() && spotify.loggedIn() && !this.crateBusy) {
      frag.append(el('div', 'crate-note', 'Pick a playlist above to build your to-get list.'));
    }
    root.replaceChildren(frag);
  }
}
