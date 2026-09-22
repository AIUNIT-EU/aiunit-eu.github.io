// Verlaufsdiagramm für einen Laborwert (eine Serie) als SVG, ohne externe Bibliothek.
// Gestaltungsregeln aus dem dataviz-Skill: 2px-Linie, Punkte r=4 mit 2px Flächenring,
// Referenzbereich als 10%-Fläche, feine durchgezogene Gitterlinien, Endwert direkt beschriftet,
// Fadenkreuz + Tooltip bei Zeiger und Tastatur. Die Werteliste („Verlauf“) bleibt die Tabellenansicht.

import { daysBetween, formatDE } from '../lib/dates.js';
import { num } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340, H = 150;
const M = { top: 10, right: 46, bottom: 22, left: 36 };

function s(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function niceStep(range, count) {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

export function yTicks(lo, hi, count = 3) {
  if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const step = niceStep(hi - lo, count);
  // Erste Marke <= lo, letzte Marke >= hi, damit alle Werte innerhalb der Achse liegen
  let v = Math.floor(lo / step) * step;
  const ticks = [Number(v.toFixed(10))];
  while (v < hi - step * 1e-9) {
    v += step;
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

const shortDate = iso => formatDE(iso).replace(/\.(\d{2})(\d{2})$/, '.$2');

/**
 * entries: Laborwerte eines Parameters (beliebige Reihenfolge), je { date, value, unit, refLow, refHigh }
 */
export function lineChart(entries, { name, unit, refLow, refHigh, flagText }) {
  const data = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const n = data.length;
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom;

  const span = daysBetween(data[0].date, data[n - 1].date);
  const xOf = i => M.left + (span > 0 ? daysBetween(data[0].date, data[i].date) / span : (n > 1 ? i / (n - 1) : 0.5)) * pw;

  const values = data.map(d => d.value);
  const lo0 = Math.min(...values, refLow ?? Infinity);
  const hi0 = Math.max(...values, refHigh ?? -Infinity);
  const pad = (hi0 - lo0) * 0.08;
  const ticks = yTicks(lo0 - pad, hi0 + pad);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const yOf = v => M.top + (1 - (v - yMin) / (yMax - yMin)) * ph;

  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0',
    'aria-label': `Verlauf ${name}: ${n} Werte vom ${formatDE(data[0].date)} bis ${formatDE(data[n - 1].date)}, zuletzt ${num.format(values[n - 1])}${unit ? ` ${unit}` : ''}. Mit den Pfeiltasten durch die Werte gehen.`,
  });

  // Referenzbereich
  if (refLow != null || refHigh != null) {
    const top = yOf(refHigh ?? yMax), bottom = yOf(refLow ?? yMin);
    svg.append(s('rect', { class: 'band', x: M.left, y: top, width: pw, height: Math.max(0, bottom - top) }));
    if (bottom - top > 14) svg.append(s('text', { class: 'band-label', x: M.left + 4, y: top + 11 }, 'Referenz'));
  }

  // Gitter + Achsenbeschriftung
  for (const t of ticks) {
    const y = Math.round(yOf(t)) + 0.5;
    svg.append(s('line', { class: 'grid', x1: M.left, x2: M.left + pw, y1: y, y2: y }));
    svg.append(s('text', { class: 'tick', x: M.left - 6, y: y + 3.5, 'text-anchor': 'end' }, num.format(t)));
  }
  svg.append(s('text', { class: 'tick', x: M.left, y: H - 6, 'text-anchor': 'start' }, shortDate(data[0].date)));
  if (n > 1 && span > 0) svg.append(s('text', { class: 'tick', x: M.left + pw, y: H - 6, 'text-anchor': 'end' }, shortDate(data[n - 1].date)));

  // Linie + Punkte
  const pts = data.map((d, i) => [xOf(i), yOf(d.value)]);
  svg.append(s('path', { class: 'series', d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') }));
  const isOut = d => (d.refLow != null && d.value < d.refLow) || (d.refHigh != null && d.value > d.refHigh);
  const dots = data.map((d, i) => {
    const c = s('circle', { class: `pt${isOut(d) ? ' out' : ''}`, cx: pts[i][0], cy: pts[i][1], r: isOut(d) ? 5 : 4 });
    svg.append(c);
    return c;
  });

  // Endwert direkt beschriften
  const [lx, ly] = pts[n - 1];
  svg.append(s('text', { class: 'end-label', x: lx + 8, y: Math.min(Math.max(ly + 4, M.top + 8), M.top + ph) }, num.format(values[n - 1])));

  // Interaktion: Fadenkreuz + Tooltip (Zeiger und Tastatur)
  const cross = s('line', { class: 'crosshair', y1: M.top, y2: M.top + ph, visibility: 'hidden' });
  const hit = s('rect', { class: 'hit', x: M.left - 8, y: 0, width: pw + 16, height: H });
  svg.append(cross, hit);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  tip.setAttribute('aria-live', 'polite');
  wrap.append(svg, tip);

  let active = -1;
  function show(i) {
    active = i;
    const d = data[i];
    const [x] = pts[i];
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    dots.forEach((c, j) => c.classList.toggle('active', j === i));
    const strong = document.createElement('strong');
    strong.textContent = `${num.format(d.value)}${d.unit ? ` ${d.unit}` : ''}`;
    const flag = flagText?.(d);
    tip.replaceChildren(strong, `${formatDE(d.date)}${flag ? ` · ${flag}` : ''}`);
    tip.hidden = false;
    // Tooltip neben das Fadenkreuz legen, ohne die Achse zu verdecken oder die Karte zu verlassen
    const wrapW = wrap.clientWidth, tipW = tip.offsetWidth, xPx = (x / W) * wrapW, gap = 10;
    const leftAxis = (M.left / W) * wrapW;
    let left = xPx + gap;
    if (left + tipW > wrapW) left = xPx - gap - tipW;
    left = Math.max(Math.min(left, wrapW - tipW), Math.min(leftAxis, wrapW - tipW), 0);
    tip.style.left = `${left}px`;
  }
  function hide() {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach(c => c.classList.remove('active'));
    tip.hidden = true;
  }
  function nearest(evt) {
    const r = svg.getBoundingClientRect();
    const x = ((evt.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach(([px], i) => { if (Math.abs(px - x) < Math.abs(pts[best][0] - x)) best = i; });
    return best;
  }
  hit.addEventListener('pointermove', e => show(nearest(e)));
  hit.addEventListener('pointerdown', e => show(nearest(e)));
  hit.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(n - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { show(Math.max(0, (active < 0 ? n : active) - 1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(Math.min(n - 1, active + 1)); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });
  return wrap;
}
