// Keyboard control. Keys are matched by physical position (event.code), so
// the layout works the same on QWERTY, AZERTY, etc.

const NUDGE = 0.04;

export const CHEATSHEET = [
  ['Deck A — left hand', [
    ['W', 'Play / pause'], ['Q', 'Cue (hold to preview)'], ['E', 'Sync'],
    ['A / S', 'Nudge slower / faster (hold)'],
    ['1 – 8', 'Hot cues: set, or jump if set'], ['Alt + 1 – 8', 'Delete hot cue'],
    ['D / F', 'Loop in / loop out'], ['V', 'Reloop / exit loop'],
    ['R', '4-beat auto loop on/off'], ['T / G', 'Loop halve / double'],
    ['Z  X  C', 'Kill low / mid / high EQ'],
  ]],
  ['Deck B — right hand', [
    ['I', 'Play / pause'], ['U', 'Cue (hold to preview)'], ['O', 'Sync'],
    ['J / K', 'Nudge slower / faster (hold)'],
    ['Shift + 1 – 8', 'Hot cues (numpad 1 – 8 also works)'], ['Alt + Shift + 1 – 8', 'Delete hot cue'],
    ['L / ;', 'Loop in / loop out'], ["'", 'Reloop / exit loop'],
    ['P', '4-beat auto loop on/off'], ['[ / ]', 'Loop halve / double'],
    ['N  M  ,', 'Kill low / mid / high EQ'],
  ]],
  ['Mixer & library', [
    ['← / →', 'Crossfader towards A / B'], ['Space', 'Crossfader to centre'],
    ['↑ / ↓', 'Select track in library'],
    ['Shift + ← / →', 'Load selected track to deck A / B'],
    ['?', 'Show / hide this cheat-sheet'], ['Esc', 'Close overlays'],
  ]],
];

export function cheatsheetHtml() {
  return `<h2>Keyboard shortcuts</h2><div class="sc-grid">${CHEATSHEET.map(([title, rows]) => `
    <div><h3>${title}</h3><table>${rows.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}</table></div>`).join('')}</div>`;
}

export function initShortcuts(app) {
  const { A, B } = app.deckUIs, mx = app.mixerUI;
  const deckKeys = (ui, id, k) => ({
    [k.play]: [() => ui.deck.toggle()],
    [k.cue]: [() => ui.deck.cueDown(), () => ui.deck.cueUp()],
    [k.sync]: [() => ui.toggleSync()],
    [k.nudgeDn]: [() => ui.deck.setNudge(-NUDGE), () => ui.deck.setNudge(0)],
    [k.nudgeUp]: [() => ui.deck.setNudge(NUDGE), () => ui.deck.setNudge(0)],
    [k.loopIn]: [() => ui.deck.loopIn()],
    [k.loopOut]: [() => ui.deck.loopOut()],
    [k.reloop]: [() => ui.deck.loopToggle()],
    [k.auto]: [() => ui.deck.autoLoop(4)],
    [k.half]: [() => ui.deck.loopScale(0.5)],
    [k.dbl]: [() => ui.deck.loopScale(2)],
    [k.kLow]: [() => mx.toggleKill(id, 'low')],
    [k.kMid]: [() => mx.toggleKill(id, 'mid')],
    [k.kHigh]: [() => mx.toggleKill(id, 'high')],
  });
  const map = {
    ...deckKeys(A, 'A', {
      play: 'KeyW', cue: 'KeyQ', sync: 'KeyE', nudgeDn: 'KeyA', nudgeUp: 'KeyS', loopIn: 'KeyD', loopOut: 'KeyF',
      reloop: 'KeyV', auto: 'KeyR', half: 'KeyT', dbl: 'KeyG', kLow: 'KeyZ', kMid: 'KeyX', kHigh: 'KeyC',
    }),
    ...deckKeys(B, 'B', {
      play: 'KeyI', cue: 'KeyU', sync: 'KeyO', nudgeDn: 'KeyJ', nudgeUp: 'KeyK', loopIn: 'KeyL', loopOut: 'Semicolon',
      reloop: 'Quote', auto: 'KeyP', half: 'BracketLeft', dbl: 'BracketRight', kLow: 'KeyN', kMid: 'KeyM', kHigh: 'Comma',
    }),
  };

  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { app.closeModal(); if (typing(e)) e.target.blur(); return; }
    if (typing(e)) return;
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) { e.preventDefault(); app.toggleCheatsheet(); return; }

    let m = /^Digit([1-8])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      if (!e.repeat) (e.shiftKey ? B : A).deck.hotcue(+m[1] - 1, e.altKey);
      return;
    }
    m = /^Numpad([1-8])$/.exec(e.code);
    if (m) { e.preventDefault(); if (!e.repeat) B.deck.hotcue(+m[1] - 1, e.altKey); return; }
    if (e.altKey) return;

    switch (e.code) {
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) { if (!e.repeat) app.loadSelected('A'); } else mx.nudgeXf(-0.04);
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) { if (!e.repeat) app.loadSelected('B'); } else mx.nudgeXf(0.04);
        return;
      case 'ArrowUp': e.preventDefault(); app.libraryUI.moveSelection(-1); return;
      case 'ArrowDown': e.preventDefault(); app.libraryUI.moveSelection(1); return;
      case 'Space': e.preventDefault(); mx.xf.set(0.5); return;
    }
    const a = map[e.code];
    if (a && !e.shiftKey) { e.preventDefault(); if (!e.repeat) a[0](); }
  });

  window.addEventListener('keyup', (e) => {
    const a = map[e.code];
    if (a && a[1]) a[1]();
  });
  // Never leave a nudge or cue-preview stuck if the window loses focus mid-press.
  window.addEventListener('blur', () => { for (const ui of [A, B]) { ui.deck.setNudge(0); ui.deck.cueUp(); } });
}
