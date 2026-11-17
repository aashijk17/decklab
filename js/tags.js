// Minimal tag reader: title + artist from ID3v2 (MP3) and Vorbis comments
// (FLAC), with a fallback that guesses "Artist - Title" from the file name.

function decodeText(bytes, enc) {
  const label = enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'iso-8859-1';
  try { return new TextDecoder(label).decode(bytes).replace(/\0+$/g, '').split('\0')[0].trim(); } catch { return ''; }
}
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function id3(b) {
  const out = {};
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
  const ver = b[3], end = Math.min(b.length, 10 + synchsafe(b, 6));
  let o = 10;
  while (o + (ver === 2 ? 6 : 10) <= end) {
    let id, size, hdr;
    if (ver === 2) { id = String.fromCharCode(b[o], b[o + 1], b[o + 2]); size = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]; hdr = 6; }
    else { id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); size = ver === 4 ? synchsafe(b, o + 4) : be32(b, o + 4); hdr = 10; }
    if (!size || !/^[A-Z0-9]+$/.test(id)) break;
    const body = b.subarray(o + hdr, Math.min(end, o + hdr + size));
    if (id === 'TIT2' || id === 'TT2') out.title = decodeText(body.subarray(1), body[0]);
    if (id === 'TPE1' || id === 'TP1') out.artist = decodeText(body.subarray(1), body[0]);
    if (out.title && out.artist) break;
    o += hdr + size;
  }
  return out;
}

function flac(b) {
  const out = {};
  if (b.length < 8 || b[0] !== 0x66 || b[1] !== 0x4c || b[2] !== 0x61 || b[3] !== 0x43) return out;
  let o = 4;
  while (o + 4 <= b.length) {
    const last = b[o] & 0x80, type = b[o] & 0x7f, size = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    o += 4;
    if (type === 4 && o + size <= b.length) {
      let p = o + 4 + le32(b, o);
      const n = le32(b, p); p += 4;
      const dec = new TextDecoder();
      for (let i = 0; i < n && p + 4 <= o + size; i++) {
        const len = le32(b, p); p += 4;
        const s = dec.decode(b.subarray(p, p + len)); p += len;
        const eq = s.indexOf('=');
        const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
        if (k === 'TITLE') out.title = v; else if (k === 'ARTIST') out.artist = v;
      }
      break;
    }
    if (last) break;
    o += size;
  }
  return out;
}

export function fromFilename(name) {
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\s*\d{1,3}[\s.\-)]+(?=\S)/, '').trim();
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { artist: '', title: base || name };
}

export async function readTags(file) {
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size = Math.min(10 + synchsafe(head, 6), 8 << 20);
      tags = id3(new Uint8Array(await file.slice(0, size).arrayBuffer()));
    } else if (head[0] === 0x66 && head[1] === 0x4c) {
      tags = flac(new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer()));
    }
  } catch { /* unreadable tags are fine */ }
  const guess = fromFilename(file.name);
  return { title: tags.title || guess.title, artist: tags.artist || guess.artist };
}
