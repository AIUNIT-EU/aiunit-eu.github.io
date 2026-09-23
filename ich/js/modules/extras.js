// Anzeige „Zusatzfunktionen“ (Teil E): Stand des automatischen Mitladens unter Mehr und einmalig auf „Heute“.
// Das Laden selbst steckt in js/lib/assets.js.

import * as assets from '../lib/assets.js';
import { el, icon } from '../ui/dom.js';

const mb = n => `${Math.round(n / 1048576)} MB`;

function statusText(g) {
  switch (g.status) {
    case 'ready': return 'bereit, auch offline';
    case 'loading': return `wird geladen … ${Math.floor((g.loaded / g.bytes) * 100)} % von ${mb(g.bytes)}`;
    case 'waitWifi': return `wartet auf WLAN (${mb(g.bytes - g.loaded)})`;
    case 'noSpace': return `nicht genug Speicherplatz frei (${mb(g.bytes - g.loaded)} nötig)`;
    case 'offline': return 'keine Verbindung, geht beim nächsten Online-Sein weiter';
    case 'error': return 'Laden fehlgeschlagen';
    default: return 'wird vorbereitet …';
  }
}

function groupRow(g) {
  const action = g.status === 'waitWifi'
    ? el('button', { type: 'button', class: 'secondary small', id: `btn-extras-force-${g.id}`, onclick: () => assets.start({ force: true }) }, 'Jetzt trotzdem laden')
    : g.status === 'error' || g.status === 'noSpace' || g.status === 'offline'
      ? el('button', { type: 'button', class: 'secondary small', id: `btn-extras-retry-${g.id}`, onclick: () => assets.start() }, 'Erneut versuchen')
      : null;
  return el('li', { class: `extras-row extras-${g.status}`, 'data-group': g.id },
    icon(g.status === 'ready' ? 'circle-check' : g.status === 'loading' ? 'loader-circle' : g.status === 'unknown' ? 'loader-circle' : 'info'),
    el('span', { class: 'list-text' },
      el('span', { class: 'list-title', text: g.label }),
      el('span', { class: 'muted small extras-status', text: statusText(g) })),
    g.status === 'loading' ? el('progress', { class: 'extras-progress', max: String(g.bytes), value: String(g.loaded) }) : null,
    action);
}

function listNodes() {
  const groups = assets.snapshot();
  if (!groups.length) return [el('p', { class: 'muted small', text: 'Wird vorbereitet …' })];
  return [el('ul', { class: 'extras-list' }, groups.map(groupRow))];
}

/** Abschnitt unter „Mehr“. */
export function section() {
  return el('section', { class: 'more-section', 'aria-labelledby': 'more-extras' },
    el('h2', { id: 'more-extras' }, icon('sparkles'), 'Zusatzfunktionen'),
    el('p', { class: 'muted small', text: 'Die App lädt die Erkennungsdaten automatisch von ihrer eigenen Adresse. Danach laufen Texterkennung und Sprachumwandlung nur auf diesem Gerät, auch offline.' }),
    el('div', { id: 'extras-list' }, ...listNodes()),
    assets.metered() ? el('p', { class: 'muted small', text: 'Du bist über mobile Daten verbunden oder der Datensparmodus ist an. Große Daten werden deshalb erst im WLAN geladen.' }) : null);
}

/** Einmaliger, dezenter Hinweis auf „Heute“, solange das erste Laden läuft. */
export function todayHint(ctx) {
  if (ctx.prefs().extrasHintDone) return null;
  const groups = assets.snapshot();
  if (!groups.length) return null;
  if (assets.allReady()) { ctx.setPref('extrasHintDone', true); return null; }
  const loading = groups.some(g => g.status === 'loading');
  const waiting = groups.find(g => g.status === 'waitWifi' || g.status === 'noSpace');
  if (!loading && !waiting) return null;
  const text = loading
    ? `Zusatzfunktionen werden im Hintergrund geladen (${Math.floor(assets.progress() * 100)} %). Du kannst die App normal benutzen.`
    : `${waiting.label}: ${statusText(waiting)}. Details unter Mehr → Zusatzfunktionen.`;
  return el('p', { class: 'extras-hint small muted', id: 'extras-hint', role: 'status' }, icon('download'), text);
}

/** Anzeige an Ort und Stelle aktualisieren (ohne die ganze Ansicht neu aufzubauen). */
export function refresh(ctx) {
  const list = document.getElementById('extras-list');
  if (list) list.replaceChildren(...listNodes());
  const hint = document.getElementById('extras-hint');
  if (hint) {
    const next = todayHint(ctx);
    if (next) hint.replaceWith(next);
    else hint.remove();
  } else {
    const qa = document.querySelector('#tab-overview:not([hidden]) .quick-actions');
    const next = qa && todayHint(ctx);
    if (next) qa.after(next);
  }
}
