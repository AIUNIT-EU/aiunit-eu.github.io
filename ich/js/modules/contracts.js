// M2 – Verträge, Versicherungen und Abos (module: 'contract') inkl. M5 KI-Tarifcheck

import { nextDeadline, monthlyCost, INTERVALS } from '../lib/contract-logic.js';
import { formatDE, addDays } from '../lib/dates.js';
import { buildICS } from '../lib/ics.js';
import { comparisonLinks } from '../lib/compare-links.js';
import { buildPayload, describePayload, requestCheck, NOT_COMPARABLE } from '../lib/tarifcheck.js';
import { openForm, openSheet } from '../ui/form.js';
import { docsFor, docList, openDocument, startScan, removeLinked, onDocumentSaved } from './documents.js';
import { el, icon, downloadFile, euro } from '../ui/dom.js';

export const CATEGORIES = [
  'Versicherung',
  'Strom / Gas / Energie',
  'Wasser',
  'Telefon / Internet / Mobilfunk',
  'Abo / Streaming',
  'Miete / Wohnen',
  'Kredit / Finanzen',
  'Mitgliedschaft',
  'Sonstiges',
];

const FIELDS = [
  { name: 'category', label: 'Kategorie', type: 'select', options: CATEGORIES, required: true },
  { name: 'name', label: 'Bezeichnung', required: true, hint: 'z. B. Kfz-Versicherung Golf, Strom Wohnung',
    suggest: ['Kfz-Versicherung', 'Haftpflichtversicherung', 'Hausratversicherung', 'Wohngebäudeversicherung', 'Rechtsschutzversicherung',
      'Berufsunfähigkeitsversicherung', 'Krankenzusatzversicherung', 'Zahnzusatzversicherung', 'Risikolebensversicherung',
      'Strom', 'Gas', 'Wasser', 'Internet', 'Mobilfunk', 'Streaming', 'Fitnessstudio', 'Zeitung / Magazin'] },
  { name: 'provider', label: 'Anbieter' },
  { name: 'contractNo', label: 'Vertrags- / Kundennummer', more: true },
  { name: 'cost', label: 'Beitrag in €', type: 'number', inline: true },
  { name: 'interval', label: 'Zahlweise', type: 'select', options: Object.keys(INTERVALS), default: 'monatlich', inline: true },
  { name: 'start', label: 'Vertragsbeginn', type: 'date', inline: true, more: true },
  { name: 'minTermMonths', label: 'Mindestlaufzeit (Monate)', type: 'number', inline: true, more: true },
  { name: 'termEnd', label: 'Laufzeitende (letzter Vertragstag)', type: 'date',
    hint: 'Kfz-Versicherung meist 31.12. Unbekannt? Dann unter „Weitere Angaben“ Beginn und Mindestlaufzeit eintragen.' },
  { name: 'renewalMonths', label: 'Verlängerung (Monate)', type: 'number', default: 12, inline: true },
  { name: 'noticeValue', label: 'Kündigungsfrist', type: 'number', default: 1, inline: true },
  { name: 'noticeUnit', label: 'Einheit', type: 'select', options: ['Monate', 'Wochen', 'Tage'], inline: true },
  { name: 'remindDays', label: 'Erinnern (Tage vor Frist)', type: 'number', default: 30, inline: true,
    hint: 'Verlängerung 0 = Vertrag endet automatisch.' },
  { name: 'usage', label: 'Verbrauch / Leistungsumfang', more: true,
    hint: 'z. B. 2.500 kWh/Jahr, Vollkasko SF 12 mit 150 € SB, 100 Mbit/s – je genauer, desto besser der Tarifcheck' },
  { name: 'notes', label: 'Notizen (bleiben privat)', type: 'textarea', more: true },
];

function validate(d) {
  for (const k of ['cost', 'minTermMonths', 'renewalMonths', 'noticeValue', 'remindDays']) {
    if (d[k] !== null && d[k] < 0) throw new Error('Negative Werte sind nicht erlaubt.');
  }
  if (!d.termEnd && d.minTermMonths && !d.start) throw new Error('Für die Mindestlaufzeit bitte auch den Vertragsbeginn angeben.');
  if (d.renewalMonths === null) d.renewalMonths = 0;
  if (d.noticeValue === null) d.noticeValue = 0;
  if (d.remindDays === null) d.remindDays = 30;
}

export function editContract(ctx, contract) {
  openForm({
    title: contract ? 'Vertrag bearbeiten' : 'Neuer Vertrag',
    fields: FIELDS,
    values: contract || {},
    note: 'Die Fristen werden aus deinen Angaben berechnet. Das ist keine Rechtsberatung.',
    onSave: async data => {
      validate(data);
      await ctx.save({ ...(contract || { module: 'contract' }), ...data });
      ctx.toast('Vertrag gespeichert');
    },
    onDelete: contract ? async () => { await removeLinked(contract.id); await ctx.remove(contract); } : null,
    deleteConfirm: contract && docsFor(ctx.records, 'contracts', contract.id).length
      ? `Diesen Vertrag und ${docsFor(ctx.records, 'contracts', contract.id).length} zugehörige(s) Dokument(e) endgültig löschen?`
      : undefined,
  });
}

// Verträge, deren Frist innerhalb der Erinnerungszeit liegt (für Banner und Übersicht)
export function dueContracts(records, today) {
  return records
    .filter(r => r.module === 'contract')
    .map(c => ({ c, info: nextDeadline(c, today) }))
    .filter(x => x.info.due)
    .sort((a, b) => a.info.daysLeft - b.info.daysLeft);
}

export function monthlyTotal(records, today) {
  return records.filter(r => r.module === 'contract')
    .filter(c => nextDeadline(c, today).status !== 'beendet')
    .reduce((s, c) => s + monthlyCost(c), 0);
}

// ---------- Kalender ----------

// Kalendertermine liegen außerhalb des Tresors und werden oft synchronisiert. Deshalb neutrale Titel
// ohne Vertragsdetails (docs/features/vertraege.md). Die Details stehen nur in der App.
const GENERIC = 'ICH Erinnerung';
const GENERIC_DESC = 'Eine Frist steht an. Details in der ICH-App.';

function calendarEvents(c, info, today) {
  const events = [];
  const remind = c.remindDays ?? 30;
  const target = info.status === 'aktiv' ? info.deadline : info.status === 'endet' ? info.termEnd : null;
  if (!target) return events;
  const reminder = addDays(target, -remind);
  if (reminder >= today && reminder < target) {
    events.push({ uid: `${c.id}-${target}-vorher@ich`, date: reminder, summary: GENERIC, description: GENERIC_DESC });
  }
  events.push({ uid: `${c.id}-${target}-frist@ich`, date: target, summary: `${GENERIC}: Frist heute`, description: GENERIC_DESC });
  return events;
}

function exportCalendar(ctx, items, filename) {
  const today = ctx.today();
  const events = items.flatMap(({ c, info }) => calendarEvents(c, info, today));
  if (!events.length) { ctx.toast('Keine Fristen für den Kalender vorhanden.'); return; }
  downloadFile(filename, buildICS(events), 'text/calendar');
  ctx.toast('Kalenderdatei erstellt. Die Termine heißen neutral „ICH Erinnerung“ und liegen außerhalb des Tresors.');
}

// ---------- Darstellung ----------

function statusText(info) {
  switch (info.status) {
    case 'aktiv': {
      const when = info.daysLeft === 0 ? 'heute' : `in ${info.daysLeft} ${info.daysLeft === 1 ? 'Tag' : 'Tagen'}`;
      return `Kündigen bis ${formatDE(info.deadline)} (${when}) · Laufzeit bis ${formatDE(info.termEnd)}`;
    }
    case 'endet': return `Endet am ${formatDE(info.termEnd)} (in ${info.daysLeft} Tagen), keine Kündigung nötig`;
    case 'beendet': return `Beendet am ${formatDE(info.termEnd)}`;
    default: return 'Frist unbekannt: Laufzeitende oder Beginn + Mindestlaufzeit eintragen';
  }
}

// Bezeichnungen nach docs/CONTRACT_COMPARISON.md (Behalten / Wechsel prüfen / Noch keine belastbare Empfehlung)
const REC = {
  wechseln: { icon: 'arrow-right-left', title: 'Wechsel prüfen', cls: 'rec-switch' },
  bleiben: { icon: 'circle-check', title: 'Behalten', cls: 'rec-stay' },
  unklar: { icon: 'info', title: 'Noch keine belastbare Empfehlung', cls: 'rec-unclear' },
};

function checkChip(check) {
  if (!check) return null;
  const r = REC[check.recommendation] || REC.unklar;
  const text = check.recommendation === 'wechseln' && check.savingsPerYear > 0
    ? `Wechsel prüfen: ca. ${euro.format(check.savingsPerYear)}/Jahr günstiger`
    : r.title;
  return el('span', { class: `chip ${r.cls}` }, icon(r.icon), text);
}

function link(url, label) {
  let safe = null;
  try { safe = new URL(url).protocol === 'https:' ? url : null; } catch { /* ungültig */ }
  if (!safe) return el('span', { text: label });
  return el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', class: 'ext-link' }, label, icon('external-link'));
}

function card(ctx, c, info) {
  const cost = c.cost ? `${euro.format(c.cost)} ${c.interval || ''}` : '';
  return el('button', {
    class: `entry contract card-button${info.due ? ' due' : ''}${info.status === 'beendet' ? ' ended' : ''}`,
    'aria-label': `${c.name}: Details öffnen`,
    onclick: () => openDetail(ctx, c.id),
  },
  el('span', { class: 'entry-meta' },
    el('strong', { class: 'contract-name', text: c.name }),
    el('span', { class: 'cost', text: cost })),
  c.provider ? el('span', { class: 'muted small block', text: c.provider }) : null,
  el('span', { class: 'contract-status block', text: statusText(info) }),
  c.lastCheck ? el('span', { class: 'block chip-row' }, checkChip(c.lastCheck)) : null,
  el('span', { class: 'chevron' }, icon('chevron-right')));
}

const SINGULAR = { Monate: 'Monat', Wochen: 'Woche', Tage: 'Tag' };
const unitLabel = (n, unit = 'Monate') => (n === 1 ? SINGULAR[unit] || unit : unit);

function fact(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return el('div', { class: 'fact' }, el('dt', { text: label }), el('dd', { text: String(value) }));
}

export function openDetail(ctx, id) {
  const c = ctx.records.find(r => r.id === id);
  if (!c) return;
  const info = nextDeadline(c, ctx.today());
  const perYear = monthlyCost(c) * 12;
  const comparable = !NOT_COMPARABLE.has(c.category);
  const links = comparisonLinks(c);

  const body = [
    el('div', { class: `status-box${info.due ? ' due' : ''}` }, icon(info.due ? 'triangle-alert' : 'calendar-plus'), statusText(info)),
    el('dl', { class: 'facts' },
      fact('Beitrag', c.cost ? `${euro.format(c.cost)} ${c.interval || ''}` : ''),
      fact('Kosten pro Jahr', perYear ? euro.format(perYear) : ''),
      fact('Vertragsbeginn', formatDE(c.start)),
      fact('Mindestlaufzeit', c.minTermMonths ? `${c.minTermMonths} ${unitLabel(c.minTermMonths)}` : ''),
      fact('Laufzeitende', formatDE(info.termEnd || c.termEnd)),
      fact('Verlängerung', c.renewalMonths ? `um ${c.renewalMonths} ${unitLabel(c.renewalMonths)}` : 'keine'),
      fact('Kündigungsfrist', c.noticeValue ? `${c.noticeValue} ${unitLabel(c.noticeValue, c.noticeUnit)}` : ''),
      fact('Verbrauch / Leistung', c.usage),
      fact('Vertragsnummer', c.contractNo),
      fact('Notizen', c.notes)),
    el('section', { class: 'check-section' },
      el('h3', {}, icon('sparkles'), 'Tarifcheck'),
      comparable
        ? (c.lastCheck ? resultView(c.lastCheck) : el('p', { class: 'muted small', text: 'Die KI sucht aktuelle Angebote im Web, vergleicht sie mit deinem Vertrag und empfiehlt dir, ob sich ein Wechsel lohnt. Alle Quellen kannst du selbst öffnen.' }))
        : el('p', { class: 'muted small', text: `Für „${c.category}“ gibt es in der Regel keinen Anbieterwechsel. Die App erfasst hier nur die Kosten.` }),
      comparable ? el('button', { class: 'primary wide', id: 'btn-check', onclick: () => startCheck(ctx, c.id) }, icon('sparkles'), c.lastCheck ? 'Erneut vergleichen' : 'Angebote vergleichen') : null,
      links.length ? el('details', { class: 'self-compare', open: !c.lastCheck },
        el('summary', { text: 'Selbst vergleichen' }),
        el('ul', { class: 'link-list' }, links.map(l => el('li', {}, link(l.url, l.label))))) : null),
    documentsSection(ctx, c),
  ];

  const actions = [
    el('button', { class: 'secondary', onclick: () => editContract(ctx, c) }, icon('pencil'), 'Bearbeiten'),
    (info.status === 'aktiv' || info.status === 'endet')
      ? el('button', { class: 'secondary', onclick: () => exportCalendar(ctx, [{ c, info }], `Frist-${c.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.ics`) }, icon('calendar-plus'), 'In Kalender')
      : null,
  ];
  openSheet({ title: c.name, subtitle: [c.provider, c.category].filter(Boolean).join(' · '), body, actions });
}

onDocumentSaved('contracts', (doc, ctx) => { ctx.showTab('contracts'); openDetail(ctx, doc.linkedId); });

// Gescannte Dokumente zum Vertrag (Police, Rechnungen …). Sie werden nie an den Tarifcheck gesendet.
function documentsSection(ctx, c) {
  const docs = docsFor(ctx.records, 'contracts', c.id);
  const back = () => openDetail(ctx, c.id);
  return el('section', { class: 'doc-section' },
    el('h3', {}, icon('file-text'), 'Dokumente'),
    docs.length
      ? docList(docs, id => openDocument(id, { actions: [el('button', { type: 'button', class: 'secondary', onclick: back }, 'Zum Vertrag')] }))
      : el('p', { class: 'muted small', text: 'Police, Rechnungen oder Beitragsanpassungen einfach abfotografieren. Sie bleiben verschlüsselt auf diesem Gerät.' }),
    el('button', { class: 'secondary wide', id: 'btn-scan-contract', onclick: () => startScan({ area: 'contracts', linkedId: c.id }) },
      icon('camera'), 'Dokument scannen'));
}

// ---------- Tarifcheck ----------

export function resultView(r) {
  const rec = REC[r.recommendation] || REC.unklar;
  const max = Math.max(r.currentAnnualCost || 0, r.bestAnnualCost || 0);
  const bar = (label, value, cls) => value === null || value === undefined ? null
    : el('div', { class: 'cmp-row' },
      el('span', { class: 'cmp-label', text: label }),
      el('span', { class: 'cmp-track' }, el('span', { class: `cmp-bar ${cls}`, 'data-w': String(max ? Math.round((value / max) * 100) : 0) })),
      el('strong', { class: 'cmp-value', text: `${euro.format(value)}/Jahr` }));
  const node = el('div', { class: 'check-result' },
    el('div', { class: `rec-banner ${rec.cls}` }, icon(rec.icon),
      el('div', {},
        el('strong', { text: r.recommendation === 'wechseln' && r.savingsPerYear > 0 ? `${rec.title}: ca. ${euro.format(r.savingsPerYear)} pro Jahr günstiger` : rec.title }),
        r.summary ? el('p', { text: r.summary }) : null)),
    (r.currentAnnualCost != null || r.bestAnnualCost != null) ? el('div', { class: 'cmp' },
      bar('Dein Vertrag', r.currentAnnualCost, 'current'),
      bar('Bestes Angebot', r.bestAnnualCost, 'best')) : null,
    r.offers?.length ? el('ol', { class: 'offers' }, r.offers.map(o => el('li', { class: 'offer' },
      el('div', { class: 'offer-head' },
        el('strong', { text: [o.provider, o.tariff].filter(Boolean).join(' – ') }),
        el('span', { class: 'offer-price', text: o.annualCost != null ? `${euro.format(o.annualCost)}/Jahr` : 'Preis siehe Quelle' })),
      o.conditions ? el('p', { class: 'muted small', text: o.conditions }) : null,
      link(o.url, 'Angebot öffnen')))) : null,
    r.caveats?.length ? el('ul', { class: 'caveats' }, r.caveats.map(t => el('li', { text: t }))) : null,
    r.sources?.length ? el('details', {},
      el('summary', { text: `Alle geprüften Quellen (${r.sources.length})` }),
      el('ul', { class: 'link-list' }, r.sources.map(s => el('li', {}, link(s.url, s.title || s.url))))) : null,
    el('p', { class: 'muted small', text: `Stand: ${r.checkedAt ? new Date(r.checkedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–'} · Preise ohne Gewähr · keine Beratung` }));
  // Balkenbreiten per CSSOM setzen (CSP erlaubt keine Inline-Styles)
  node.querySelectorAll('.cmp-bar').forEach(b => { b.style.width = `${b.dataset.w}%`; });
  return node;
}

function setupHint(ctx, c) {
  const links = comparisonLinks(c);
  openSheet({
    title: 'Tarifcheck einrichten',
    body: [
      el('p', { text: 'Für den automatischen Vergleich braucht die App einen eigenen kleinen Server (Supabase Edge Function), der die Websuche mit Claude ausführt. Die Anleitung steht im Projekt unter docs/CONTRACT_COMPARISON.md.' }),
      el('p', { class: 'muted small', text: 'Danach in den Einstellungen unter „Tarifcheck“ die Adresse und den Zugangsschlüssel eintragen.' }),
      links.length ? el('h3', { text: 'Bis dahin: selbst vergleichen' }) : null,
      links.length ? el('ul', { class: 'link-list' }, links.map(l => el('li', {}, link(l.url, l.label)))) : null,
    ],
    actions: [el('button', { class: 'secondary', onclick: () => openDetail(ctx, c.id) }, 'Zurück')],
  });
}

export function startCheck(ctx, id) {
  const c = ctx.records.find(r => r.id === id);
  const config = ctx.getConfig('tarifcheck');
  if (!config?.endpoint || !config?.token) { setupHint(ctx, c); return; }

  const plz = el('input', { type: 'text', inputmode: 'numeric', maxlength: '5', pattern: '\\d{5}', name: 'plz', autocomplete: 'postal-code' });
  plz.value = config.postalCode || '';
  const list = el('dl', { class: 'facts' });
  const renderList = () => list.replaceChildren(...describePayload(buildPayload(c, plz.value.trim())).map(([k, v]) => fact(k, v)));
  plz.addEventListener('input', renderList);
  renderList();
  const consent = el('input', { type: 'checkbox', name: 'consent' });
  const error = el('p', { class: 'error', role: 'alert' });

  const run = async () => {
    const postal = plz.value.trim();
    if (postal && !/^\d{5}$/.test(postal)) { error.textContent = 'Die PLZ muss aus 5 Ziffern bestehen.'; return; }
    if (!consent.checked) { error.textContent = 'Bitte bestätige, dass diese Angaben gesendet werden dürfen.'; return; }
    showLoading(c);
    try {
      const result = await requestCheck(config, buildPayload(c, postal));
      if (ctx.isLocked()) return; // während der Prüfung gesperrt: Ergebnis verwerfen
      const fresh = ctx.records.find(r => r.id === id) || c;
      await ctx.save({ ...fresh, lastCheck: result });
      openDetail(ctx, id);
      ctx.toast('Tarifcheck abgeschlossen');
    } catch (e) {
      if (ctx.isLocked()) return;
      openSheet({
        title: 'Tarifcheck fehlgeschlagen',
        body: [el('p', { class: 'error', text: e.message })],
        actions: [el('button', { class: 'secondary', onclick: () => openDetail(ctx, id) }, 'Zurück'),
          el('button', { class: 'primary', onclick: () => startCheck(ctx, id) }, 'Erneut versuchen')],
      });
    }
  };

  openSheet({
    title: 'Angebote vergleichen',
    subtitle: c.name,
    body: [
      el('p', { text: 'Die KI sucht aktuelle Angebote im Web und vergleicht sie mit deinem Vertrag. Dafür werden nur diese Angaben gesendet:' }),
      list,
      el('label', {}, 'Postleitzahl (optional, verbessert Strom-, Gas- und Kfz-Preise)', plz),
      el('p', { class: 'muted small', text: 'Nicht gesendet werden: Bezeichnung, Vertragsnummer, Notizen und alle anderen Daten der App. Empfänger: dein Tarifcheck-Server und Anthropic (Claude) für die Websuche. Nichts davon wird gespeichert.' }),
      el('label', { class: 'check-label' }, consent, 'Einverstanden, diese Angaben für den Vergleich zu senden'),
      error,
    ],
    actions: [el('button', { class: 'primary', id: 'btn-run-check', onclick: run }, icon('sparkles'), 'Jetzt vergleichen')],
    closeLabel: 'Abbrechen',
  });
}

function showLoading(c) {
  openSheet({
    title: 'Angebote werden geprüft …',
    subtitle: c.name,
    body: [el('div', { class: 'loading' }, icon('loader-circle'),
      el('p', { text: 'Die KI durchsucht das Web nach aktuellen Tarifen und prüft die Quellen. Das kann bis zu zwei Minuten dauern.' }))],
    closeLabel: 'Im Hintergrund weiter',
  });
}

// ---------- Liste ----------

export function render(root, ctx) {
  const today = ctx.today();
  const items = ctx.records
    .filter(r => r.module === 'contract')
    .map(c => ({ c, info: nextDeadline(c, today) }));

  const perMonth = monthlyTotal(ctx.records, today);
  const nodes = [
    el('div', { class: 'summary' },
      el('div', {}, el('span', { class: 'muted small', text: 'pro Monat' }), el('strong', { text: euro.format(perMonth) })),
      el('div', {}, el('span', { class: 'muted small', text: 'pro Jahr' }), el('strong', { text: euro.format(perMonth * 12) })),
      el('div', {}, el('span', { class: 'muted small', text: 'Verträge' }), el('strong', { text: String(items.length) }))),
    el('div', { class: 'toolbar' },
      el('button', { class: 'primary', id: 'btn-add-contract', onclick: () => editContract(ctx, null) }, icon('plus'), 'Vertrag'),
      items.length ? el('button', { class: 'secondary', onclick: () => exportCalendar(ctx, items, 'ICH-Fristen.ics') },
        icon('calendar-plus'), 'Alle Fristen in Kalender') : null),
  ];

  if (!items.length) {
    nodes.push(el('div', { class: 'empty-state' }, icon('file-text'),
      el('p', { text: 'Noch keine Verträge. Lege Versicherungen, Strom, Handy, Abos und alles andere mit Laufzeit an. Die App erinnert dich an Kündigungsfristen und prüft auf Wunsch, ob es günstigere Angebote gibt.' })));
    root.replaceChildren(...nodes);
    return;
  }

  const due = items.filter(x => x.info.due).sort((a, b) => a.info.daysLeft - b.info.daysLeft);
  if (due.length) nodes.push(el('h2', { class: 'day', text: 'Fristen demnächst' }), ...due.map(x => card(ctx, x.c, x.info)));

  const sortKey = x => x.info.deadline || x.info.termEnd || '9999';
  for (const cat of CATEGORIES) {
    const group = items.filter(x => (x.c.category || 'Sonstiges') === cat && !x.info.due)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    if (group.length) nodes.push(el('h2', { class: 'day', text: cat }), ...group.map(x => card(ctx, x.c, x.info)));
  }
  root.replaceChildren(...nodes);
}
