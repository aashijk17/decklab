// Spotify playlist import (metadata only) using the Authorization Code flow
// with PKCE. There is no client secret and no server: the browser talks to
// Spotify directly. Spotify audio is never touched.

import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from './config.js';

const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-read-private playlist-read-collaborative';
const LS_TOKEN = 'decklab.spotify.token', LS_VERIFIER = 'decklab.spotify.verifier', LS_STATE = 'decklab.spotify.state';

export const clientId = (SPOTIFY_CLIENT_ID || '').trim();
export const redirectUri = (SPOTIFY_REDIRECT_URI || '').trim()
  || location.origin + location.pathname.replace(/index\.html$/, '');
export const configured = () => !!clientId;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function getToken() { try { return JSON.parse(localStorage.getItem(LS_TOKEN)); } catch { return null; } }
function setToken(t) {
  if (!t) return localStorage.removeItem(LS_TOKEN);
  localStorage.setItem(LS_TOKEN, JSON.stringify(t));
}
export const loggedIn = () => !!getToken();
export const logout = () => setToken(null);

export async function login() {
  if (!configured()) throw new Error('No Spotify Client ID set in js/config.js');
  if (!crypto.subtle) throw new Error('Spotify login needs HTTPS (or http://127.0.0.1 for local testing).');
  const verifier = rand(64), state = rand(12);
  localStorage.setItem(LS_VERIFIER, verifier); localStorage.setItem(LS_STATE, state);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
  });
  location.assign(`${AUTH}?${q}`);
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Spotify token error (${r.status})`);
  const old = getToken();
  setToken({
    access: j.access_token,
    refresh: j.refresh_token || (old && old.refresh),
    expires: Date.now() + (j.expires_in || 3600) * 1000 - 60000,
  });
}

// Call once on page load. Returns 'ok' after a completed login, an error
// message string if Spotify sent one back, or null if this was a normal load.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const clean = () => history.replaceState(null, '', location.pathname + location.hash);
  if (q.has('error')) { clean(); return `Spotify login was cancelled (${q.get('error')}).`; }
  if (q.get('state') !== localStorage.getItem(LS_STATE)) { clean(); return 'Spotify login failed (state mismatch). Please try again.'; }
  try {
    await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'),
      redirect_uri: redirectUri, code_verifier: localStorage.getItem(LS_VERIFIER) || '',
    });
    return 'ok';
  } catch (e) { return e.message; } finally {
    localStorage.removeItem(LS_VERIFIER); localStorage.removeItem(LS_STATE); clean();
  }
}

async function api(pathOrUrl, tries = 0) {
  let tok = getToken();
  if (!tok) throw new Error('Not connected to Spotify.');
  if (Date.now() > tok.expires) {
    if (!tok.refresh) { logout(); throw new Error('Spotify session expired — please connect again.'); }
    try { await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh }); }
    catch { logout(); throw new Error('Spotify session expired — please connect again.'); }
    tok = getToken();
  }
  const r = await fetch(pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl, {
    headers: { Authorization: `Bearer ${tok.access}` },
  });
  if (r.status === 401 && tries < 1) { tok.expires = 0; setToken(tok); return api(pathOrUrl, tries + 1); }
  if (r.status === 429 && tries < 3) {
    const wait = Math.min(10, parseInt(r.headers.get('Retry-After') || '2', 10) || 2);
    await new Promise((res) => setTimeout(res, wait * 1000));
    return api(pathOrUrl, tries + 1);
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error((j.error && j.error.message) || `Spotify API error (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function paged(first, max = 2000) {
  const out = [];
  let url = first;
  while (url && out.length < max) {
    const page = await api(url);
    out.push(...(page.items || []));
    url = page.next;
  }
  return out;
}

export async function me() {
  try { const j = await api('/me'); return j.display_name || j.id || ''; } catch { return ''; }
}

export async function playlists() {
  const items = await paged('/me/playlists?limit=50');
  return items.filter(Boolean).map((p) => ({
    id: p.id, name: p.name || '(untitled playlist)',
    // Spotify has renamed this field over time; accept either shape.
    count: (p.tracks && p.tracks.total) ?? (p.items && p.items.total) ?? null,
  }));
}

export async function playlistTracks(id) {
  // Newer API versions serve playlist contents from /items, older ones from
  // /tracks. Try the new one first and fall back.
  let items;
  try { items = await paged(`/playlists/${id}/items?limit=50`); }
  catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
    items = await paged(`/playlists/${id}/tracks?limit=50`);
  }
  const out = [];
  for (const it of items) {
    const t = it && (it.item || it.track);
    if (!t || !t.name || (t.type && t.type !== 'track')) continue;    // skip removed tracks / podcast episodes
    const imgs = (t.album && t.album.images) || [];
    out.push({
      id: t.id || t.uri || `${t.name}-${out.length}`,
      title: t.name,
      artist: (t.artists || []).map((a) => a && a.name).filter(Boolean).join(', '),
      album: (t.album && t.album.name) || '',
      art: imgs.length ? imgs[imgs.length - 1].url : '',
      url: (t.external_urls && t.external_urls.spotify) || (t.id ? `https://open.spotify.com/track/${t.id}` : ''),
      durationMs: t.duration_ms || 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- matching
const tokens = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/\b(feat|ft|featuring|original mix|extended mix|radio edit|remaster(ed)?)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function near(a, b) {       // equal, or one edit apart for longer words
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const coverage = (need, have) => (need.length ? need.filter((t) => have.some((h) => near(t, h))).length / need.length : 0);

// Does a local track look like this playlist track? Fuzzy on artist + title.
export function matches(crate, local) {
  const have = tokens(`${local.artist} ${local.title} ${local.file ? local.file.name.replace(/\.[^.]+$/, '') : ''}`);
  const title = tokens(crate.title.split(' - ')[0]);
  const artist = tokens((crate.artist || '').split(',')[0]);
  if (!title.length) return false;
  return coverage(title, have) >= 0.8 && (artist.length === 0 || coverage(artist, have) >= 0.5);
}
