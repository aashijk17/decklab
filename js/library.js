// The track library: local files + their analysis. Files are only ever read
// in this browser tab; nothing is uploaded.

import { getTrack, putTrack } from './db.js';
import { readTags } from './tags.js';

// Bump when the analysis changes: older cached results are then re-analysed
// (hot cues and cue points are kept).
const ANALYSIS_VERSION = 2;
const AUDIO_EXT = /\.(mp3|wav|wave|flac|aac|m4a|mp4|ogg|oga|opus|aif|aiff)$/i;

export class Library extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.tracks = [];
    this.byId = new Map();
    this.queue = []; this.busy = false;
    this.worker = new Worker(new URL('./analysis/analysis-worker.js', import.meta.url));
    this.pending = new Map(); this.jobId = 0;
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.res(e.data); else p.rej(new Error(e.data.error));
    };
  }

  changed() { this.dispatchEvent(new Event('change')); }
  get(id) { return this.byId.get(id); }

  async addFiles(files) {
    let added = 0, skipped = 0;
    for (const file of files) {
      if (!(AUDIO_EXT.test(file.name) || (file.type || '').startsWith('audio/'))) { skipped++; continue; }
      const id = `${file.name}|${file.size}|${file.lastModified}`;
      if (this.byId.has(id)) continue;
      const tags = await readTags(file);
      const track = {
        id, file, title: tags.title, artist: tags.artist, duration: 0,
        bpm: 0, gridOffset: 0, key: '', camelot: '', wave: null,
        hotcues: new Array(8).fill(null), cue: 0, status: 'queued',
      };
      const cached = await getTrack(id);
      if (cached && cached.wave && cached.av === ANALYSIS_VERSION) {
        Object.assign(track, cached, { file, status: 'ready' });
        if (!track.hotcues) track.hotcues = new Array(8).fill(null);
      } else {
        if (cached) { track.hotcues = cached.hotcues || track.hotcues; track.cue = cached.cue || 0; }
        this.queue.push(track);
      }
      this.tracks.push(track); this.byId.set(id, track);
      added++;
      this.changed();
    }
    this.pump();
    return { added, skipped };
  }

  // Accepts a DataTransfer from a drop, including whole folders.
  async addFromDrop(dt) {
    const files = [];
    const walk = async (entry) => {
      if (entry.isFile) files.push(await new Promise((res, rej) => entry.file(res, rej)));
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const e of batch) await walk(e);
        }
      }
    };
    const entries = [...(dt.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
    if (entries.some(Boolean)) {
      for (const e of entries) { if (e) { try { await walk(e); } catch { /* skip unreadable */ } } }
    } else files.push(...dt.files);
    return this.addFiles(files);
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const track = this.queue.shift();
      await this.analyze(track);
    }
    this.busy = false;
  }

  async analyze(track) {
    track.status = 'analyzing'; this.changed();
    try {
      const buf = await this.engine.decode(track.file);
      track.duration = buf.duration;
      const n = buf.length, mono = new Float32Array(n), chs = buf.numberOfChannels;
      for (let c = 0; c < chs; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i];
      }
      if (chs > 1) for (let i = 0; i < n; i++) mono[i] /= chs;
      const id = ++this.jobId;
      const r = await new Promise((res, rej) => {
        this.pending.set(id, { res, rej });
        this.worker.postMessage({ id, mono, sampleRate: buf.sampleRate }, [mono.buffer]);
      });
      // Keep anything the user already corrected by hand while analysis ran.
      if (!track.bpm) track.bpm = r.bpm;
      track.gridOffset = track.gridOffset || r.gridOffset;
      track.key = r.key; track.camelot = r.camelot; track.wave = r.wave;
      track.status = 'ready'; track.av = ANALYSIS_VERSION;
      this.save(track);
    } catch (err) {
      track.status = 'error';
      track.error = /decod|EncodingError/i.test(String(err)) ? 'This browser cannot decode the file' : String(err.message || err);
    }
    this.changed();
  }

  save(track) {
    const { file, status, error, ...rec } = track;   // never store the audio itself
    putTrack(rec);
    this.changed();
  }
}
