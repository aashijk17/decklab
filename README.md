# DeckLab — learn to DJ in your browser

A two-deck DJ mixing app that runs entirely in the browser. It is a static
site (HTML + CSS + vanilla JavaScript modules, no build step, no server), so
it can be hosted for free on GitHub Pages. All audio processing uses the Web
Audio API. Your music files are read locally by the browser and are **never
uploaded anywhere**.

## What's in it

| Area | Features |
| --- | --- |
| Library | Drag-and-drop / file picker / folder picker for MP3, WAV, FLAC, AAC/M4A. Title, artist, duration, BPM, key (plus Camelot code). Search and sort. Analysis is cached in IndexedDB. |
| Decks A + B | Play/pause, CDJ-style cue, elapsed/remaining time, scrolling zoomable waveform with beat grid, clickable overview, tempo slider (±8/16/50 %), key lock, nudge buttons. |
| BPM & sync | Automatic BPM, beat grid and key detection. Tap tempo, ÷2 / ×2, manual BPM entry, "grid here". SYNC (tempo + beat phase) and a beat-phase meter. |
| Mixer | Trim, 3-band EQ with kill switches, one-knob LP/HP filter, channel faders, crossfader (smooth / sharp curve), channel + master meters, clip light, master volume. |
| Effects | Echo (beat-synced), reverb, flanger, phaser per deck, each with on/off, wet amount and beat division. |
| Performance | 8 colour-coded hot cues per deck (saved per track), beat loops 1/4–32, manual loop in/out, halve/double, loop roll. |
| Recording | Records the master output; download as WAV or MP3; visible timer. |
| Learning | Learning mode (hover any control for an explanation), a "DJ basics" guide, and a keyboard cheat-sheet (`?`). |
| Spotify | Optional playlist import (metadata only) as a "Crate / To-Get" list; tracks you already have locally are marked **OWNED**. |

## Run it on your own computer

Browsers block audio worklets and modules on `file://` pages, so serve the
folder over HTTP. Any static server works; Python is already on most machines:

```bash
cd path/to/this/folder
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000/> in Chrome, Edge or Firefox.

## Deploy to GitHub Pages (step by step)

1. Create a free account at <https://github.com> if you don't have one.
2. Click **+ → New repository**. Give it a name (for example `decklab`), set
   it to **Public**, and click **Create repository**.
3. Upload the project. Either
   - **in the browser:** on the new repository page click **uploading an
     existing file**, drag in *everything inside this folder* (`index.html`,
     `css`, `js`, `README.md`, `.nojekyll`) and click **Commit changes**; or
   - **with git:**
     ```bash
     git init
     git add .
     git commit -m "DeckLab"
     git branch -M main
     git remote add origin https://github.com/YOUR-USERNAME/decklab.git
     git push -u origin main
     ```
4. In the repository go to **Settings → Pages**.
5. Under **Build and deployment → Source** choose **Deploy from a branch**.
   Pick branch **main**, folder **/ (root)**, and click **Save**.
6. Wait about a minute and refresh. The page shows your address:
   `https://YOUR-USERNAME.github.io/decklab/`
7. Open it. To update the site later, upload/push the changed files again.

`index.html` must stay at the top level of the repository.

## Spotify playlist import (optional)

Spotify does not allow its audio to be mixed by third-party apps, so this is
for **planning only**: import a playlist as a to-get list, and DeckLab ticks
off the tracks you already own.

1. Go to <https://developer.spotify.com/dashboard>, log in, and click
   **Create app**.
2. Name and description: anything. Under **Which API/SDKs are you planning
   to use?** tick **Web API**.
3. **Redirect URIs** — add your site address *exactly*, including the final
   slash, for example:
   - `https://YOUR-USERNAME.github.io/decklab/`
   - for local testing also add `http://127.0.0.1:8000/`
     (Spotify does not accept `localhost`; use the `127.0.0.1` form and open
     the app at that same address.)

   If you're unsure, open DeckLab → **Crate / To-Get** tab: it shows the exact
   address to paste.
4. Save, open the app's **Settings**, and copy the **Client ID**.
5. Open `js/config.js` and paste it:
   ```js
   export const SPOTIFY_CLIENT_ID = 'paste-your-client-id-here';
   ```
   The Client ID is not a secret (there is no client secret in this flow), so
   it is fine to commit it. Upload/push the changed file.
6. Reload DeckLab, open **Crate / To-Get**, click **Connect Spotify**, approve,
   and choose a playlist.

Good to know:

- Login uses the **Authorization Code flow with PKCE**; the token lives only
  in your browser's local storage. **Disconnect** removes it.
- New Spotify apps start in *development mode*: only Spotify accounts you
  list under the app's **User Management** can log in, and Spotify may place
  further requirements on the app owner's account. Spotify also limits which
  playlists a development-mode app may read (your own playlists work best).
  If a playlist can't be read, DeckLab shows a message and keeps working.
- Matching against your local files is fuzzy on artist + title (it ignores
  case, accents, "feat." and bracketed mix names). It reads tags or, failing
  that, an `Artist - Title.mp3` file name.

## Keyboard shortcuts

Press **?** in the app for the full cheat-sheet.

| | Deck A | Deck B |
| --- | --- | --- |
| Play / pause | `W` | `I` |
| Cue (hold = preview) | `Q` | `U` |
| Sync | `E` | `O` |
| Nudge − / + (hold) | `A` / `S` | `J` / `K` |
| Hot cues 1–8 | `1`–`8` | `Shift`+`1`–`8` or numpad |
| Delete hot cue | `Alt`+`1`–`8` | `Alt`+`Shift`+`1`–`8` |
| Loop in / out | `D` / `F` | `L` / `;` |
| Reloop / exit | `V` | `'` |
| 4-beat auto loop | `R` | `P` |
| Loop halve / double | `T` / `G` | `[` / `]` |
| Kill low / mid / high | `Z` `X` `C` | `N` `M` `,` |

Mixer and library: `←` / `→` crossfader, `Space` centre crossfader, `↑` / `↓`
select a track, `Shift`+`←` / `→` load it to deck A / B, `Esc` close overlays.

## Project structure

```
index.html                     page layout
css/style.css                  all styling
js/config.js                   <-- the only file you edit (Spotify Client ID)
js/main.js                     start-up, drag & drop, recording buttons, frame loop
js/library.js                  local files, analysis queue
js/db.js                       IndexedDB cache (analysis, hot cues)
js/tags.js                     ID3 / FLAC tag reader + file-name fallback
js/spotify.js                  PKCE login, playlist fetch, fuzzy matching
js/recorder.js                 WAV / MP3 export
js/analysis/analysis-worker.js BPM, beat grid, key and waveform (Web Worker)
js/audio/engine.js             audio graph: channels, EQ, filter, crossfader, master
js/audio/deck.js               deck logic: transport, tempo, sync, cues, loops
js/audio/fx.js                 echo, reverb, flanger, phaser
js/audio/worklets/             audio-thread code: deck player + key lock, recorder
js/ui/                         deck, mixer, waveform, library, shortcut and learning UI
```

## Libraries used (and why)

Only one, and it is loaded on demand:

- **[lamejs](https://github.com/zhuker/lamejs) 1.2.1** — a JavaScript port of
  the LAME MP3 encoder. Browsers can decode MP3 but cannot encode it, so this
  is needed for the MP3 download. It is fetched from the jsDelivr CDN only
  when you click **MP3**; if you are offline, the WAV download still works.
  The library is old but stable and by far the most widely used client-side
  MP3 encoder.

Everything else is written from scratch with no dependencies, which keeps the
site a plain static folder:

- **BPM / beat grid** — onset-strength envelope → autocorrelation → refinement
  at multiples of the beat period → phase histogram for the grid.
- **Key** — FFT chromagram matched against Krumhansl–Kessler key profiles,
  shown as a note name and Camelot code.
- **Key lock** — a WSOLA time-stretcher inside an AudioWorklet.
- **Tags** — a small ID3v2 / FLAC Vorbis-comment parser.

## Limitations worth knowing

- **Detection is an estimate.** BPM is very reliable on music with a steady
  beat; it can land on half/double time (fix with ÷2 / ×2) and is unreliable
  on music with a drifting tempo (live drums). Key detection is right or a
  close neighbour most of the time, not always. Use TAP, BPM… and GRID◆ to
  correct a track — corrections are saved.
- **Key lock is a simple stretcher.** It holds the pitch well for normal
  tempo changes (±8 %), but drum hits can shift by a few milliseconds and
  large stretches sound grainy. Turn it off when beatmatching by ear demands
  the tightest timing.
- **The library list is per session.** Browsers can't keep access to your
  files between visits, so add your music folder again when you come back;
  the cached analysis, hot cues and cue points reappear instantly.
- **File formats depend on the browser.** MP3, WAV, FLAC and AAC/M4A decode
  in current Chrome, Edge and Firefox. DRM-protected files cannot be played.
- **Recordings are held in memory** (about 10 MB per minute) until you
  download them, so very long recordings need plenty of RAM.
- **No headphone cueing.** There is a single stereo output; pre-listening on
  headphones needs a multi-channel sound card and isn't implemented.
- **Spotify import only reads playlists you own or collaborate on.** Spotify
  returns "Forbidden" for playlists you merely follow; DeckLab lists those
  last, labelled "followed". To import one, add its tracks to a playlist of
  your own in Spotify first.
