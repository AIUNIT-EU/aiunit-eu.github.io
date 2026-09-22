// Wird synchron im <head> geladen, damit das gewählte Farbthema ohne Aufflackern greift.
// Nur Darstellungs-Einstellungen, keine Nutzerdaten.
(function () {
  var BG = {
    standard: { light: '#f7f8fa', dark: '#10141c' },
    ocean: { light: '#eef5f3', dark: '#0e141d' },
    forest: { light: '#f4f3ec', dark: '#121711' },
    arctic: { light: '#edf2f9', dark: '#0f141c' },
    botanical: { light: '#f5f3ed', dark: '#151a16' }
  };
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('ich-prefs')) || {}; } catch (e) { /* optional */ }

  function apply(palette, mode) {
    var root = document.documentElement;
    if (!BG[palette]) palette = 'standard';
    root.setAttribute('data-palette', palette);
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    var dark = mode === 'dark' || (mode !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BG[palette][dark ? 'dark' : 'light']);
  }

  window.ICH_APPLY_THEME = apply;
  apply(prefs.palette, prefs.mode);
})();
