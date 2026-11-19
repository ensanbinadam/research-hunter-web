(function () {
  'use strict';
  const KEY = 'research-hunter-web.v1.theme';
  const MODES = ['auto', 'light', 'dark'];
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let memoryMode = 'auto';
  const listeners = new Set();

  function get() {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (MODES.includes(stored)) return stored;
    } catch { /* Private mode or blocked storage falls back to in-memory preference. */ }
    return memoryMode;
  }

  function resolved(mode = get()) {
    if (mode === 'light' || mode === 'dark') return mode;
    return media && media.matches ? 'dark' : 'light';
  }

  function apply(mode = get()) {
    const effective = resolved(mode);
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = effective;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective === 'dark' ? '#091720' : '#0f2a3c');
    for (const fn of listeners) try { fn(mode, effective); } catch {}
    return effective;
  }

  function set(mode) {
    const next = MODES.includes(mode) ? mode : 'auto';
    memoryMode = next;
    try { window.localStorage.setItem(KEY, next); } catch {}
    apply(next);
    return next;
  }

  function cycle() {
    const current = get();
    return set(MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', () => { if (get() === 'auto') apply('auto'); });
  }

  apply(get());
  window.HunterTheme = { MODES, get, set, resolved, apply, cycle, subscribe };
})();
