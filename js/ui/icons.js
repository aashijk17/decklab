// Inline SVG icons (hand-drawn paths, no icon library needed).

const svg = (name, body, filled = false) =>
  `<svg class="ic ic-${name}${filled ? ' f' : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const IC = {
  play: svg('play', '<path d="M7 4.2v15.6a.8.8 0 0 0 1.2.7l12.3-7.8a.8.8 0 0 0 0-1.4L8.200 3.500A.8.8 0 0 0 7 4.200z"/>', true),
  pause: svg('pause', '<rect x="5.500" y="4" width="4.500" height="16" rx="1.200"/><rect x="14" y="4" width="4.500" height="16" rx="1.200"/>', true),
  cue: svg('cue', '<path d="M6 21V4"/><path d="M6 5h11l-2.500 4 2.500 4H6"/>'),
  sync: svg('sync', '<path d="M20 5v5h-5"/><path d="M4 19v-5h5"/><path d="M19.400 10A8 8 0 0 0 5.200 8"/><path d="M4.600 14a8 8 0 0 0 14.200 2"/>'),
  rec: svg('rec', '<circle cx="12" cy="12" r="7"/>', true),
  loop: svg('loop', '<path d="M17 3l4 4-4 4"/><path d="M3 11V9.500A2.500 2.500 0 0 1 5.500 7H21"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v1.500a2.500 2.500 0 0 1-2.500 2.500H3"/>'),
  lock: svg('lock', '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  back: svg('back', '<path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/>'),
  fwd: svg('fwd', '<path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/>'),
  plus: svg('plus', '<path d="M12 5v14M5 12h14"/>'),
  minus: svg('minus', '<path d="M5 12h14"/>'),
  folder: svg('folder', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  music: svg('music', '<path d="M9 18V6l11-2v12"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>'),
  list: svg('list', '<path d="M4 6h10M4 11h10M4 16h6"/><path d="M17 9v8"/><circle cx="15.500" cy="17.500" r="1.800"/><path d="M17 9l3 1"/>'),
  cap: svg('cap', '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.500V16c2 2 10 2 12 0v-4.500"/><path d="M22 9v5"/>'),
  book: svg('book', '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13"/>'),
  keys: svg('keys', '<rect x="2.500" y="6" width="19" height="12" rx="2"/><path d="M6.500 10h.01M10 10h.01M13.500 10h.01M17 10h.01M7 14h10"/>'),
  download: svg('download', '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
  drop: svg('drop', '<path d="M12 3v11"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
};

// Adds the icon named in data-ic="…" to the start of each element.
export function decorate(root = document) {
  root.querySelectorAll('[data-ic]').forEach((el) => {
    const ic = IC[el.dataset.ic];
    if (ic && !el.querySelector(':scope > .ic')) el.insertAdjacentHTML('afterbegin', ic);
  });
}
