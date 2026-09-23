// Übersicht: das Wichtigste aus allen Bereichen auf einen Blick, klar nach Bereichen getrennt.

import { formatDE } from '../lib/dates.js';
import { impulseFor } from '../lib/impulses.js';
import { el, icon, euro } from '../ui/dom.js';
import { todayHint } from './extras.js';
import { dueContracts, monthlyTotal, editContract, openDetail } from './contracts.js';
import { activeMedications, latestLabs, valueText, FLAG_TEXT, setSection, editLab, scheduleText } from './health.js';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

function areaCard({ area, iconName, title, action, children }) {
  return el('section', { class: `area-card area-${area}` },
    el('header', { class: 'area-head' },
      el('span', { class: 'area-badge' }, icon(iconName)),
      el('h2', { text: title }),
      action || null),
    ...children);
}

const moreBtn = (label, onclick) => el('button', { class: 'link more', onclick }, label, icon('chevron-right'));

/**
 * Ermutigender Impuls des Tages (nur wenn eingeschaltet, R05). Nutzt keine Einträge.
 * Erscheint auf „Heute“ und im Tagebuch (Anweisung Tom); prefix hält die IDs je Ansicht eindeutig.
 */
export function impulseCard(ctx, rerender, prefix = '') {
  const p = ctx.prefs();
  const today = ctx.today();
  if (!p.impulses || p.impulseHidden === today) return null;
  const offset = p.impulseOffset?.date === today ? p.impulseOffset.n : 0;
  return el('aside', { class: 'impulse', id: `${prefix}impulse-card`, 'aria-label': 'Impuls des Tages' },
    icon('sparkles'),
    el('div', { class: 'impulse-body' },
      el('p', { class: 'impulse-text', text: impulseFor(today, offset) }),
      el('div', { class: 'impulse-actions' },
        el('button', { class: 'link', id: `${prefix}btn-impulse-next`, onclick: () => { ctx.setPref('impulseOffset', { date: today, n: offset + 1 }); rerender(); } }, 'Anderer Impuls'),
        el('button', { class: 'link', id: `${prefix}btn-impulse-hide`, onclick: () => { ctx.setPref('impulseHidden', today); rerender(); } }, 'Für heute ausblenden'))));
}

export function render(root, ctx) {
  const today = ctx.today();
  const records = ctx.records;
  const now = new Date();

  // Verträge
  const due = dueContracts(records, today);
  const contractCount = records.filter(r => r.module === 'contract').length;
  const perMonth = monthlyTotal(records, today);
  const contractsCard = areaCard({
    area: 'contracts', iconName: 'file-text', title: 'Verträge',
    action: moreBtn('Alle', () => ctx.showTab('contracts')),
    children: contractCount ? [
      el('div', { class: 'stat-row' },
        el('div', { class: 'stat' }, el('span', { class: 'muted small', text: 'Fixkosten pro Monat' }), el('strong', { text: euro.format(perMonth) })),
        el('div', { class: 'stat' }, el('span', { class: 'muted small', text: 'Fristen in Sicht' }), el('strong', { text: String(due.length) }))),
      due.length
        ? el('ul', { class: 'mini-list' }, due.slice(0, 3).map(({ c, info }) => el('li', {},
          el('button', { class: 'mini-item', onclick: () => openDetail(ctx, c.id) },
            el('span', { class: 'mini-title', text: c.name }),
            el('span', { class: 'mini-meta due-text', text: `${info.deadline ? 'Kündigen' : 'Endet'} bis ${formatDE(info.deadline || info.termEnd)} · noch ${info.daysLeft} Tage` })))))
        : el('p', { class: 'muted small', text: 'Keine Kündigungsfristen in den nächsten Wochen.' }),
    ] : [
      el('p', { class: 'muted small', text: 'Erfasse Versicherungen, Strom, Handy und Abos. Die App erinnert dich an Fristen und prüft Tarife.' }),
      el('button', { class: 'secondary small', onclick: () => editContract(ctx, null) }, icon('plus'), 'Ersten Vertrag anlegen'),
    ],
  });

  // Gesundheit
  const meds = activeMedications(records, today);
  const labs = latestLabs(records);
  const flagged = labs.filter(x => x.flag === 'hoch' || x.flag === 'niedrig');
  const healthDocs = records.filter(r => r.module === 'document' && r.area === 'health').length;
  const healthCard = areaCard({
    area: 'health', iconName: 'heart-pulse', title: 'Gesundheit',
    action: moreBtn('Öffnen', () => ctx.showTab('health')),
    children: (meds.length || labs.length || healthDocs) ? [
      meds.length ? el('div', {},
        el('h3', { class: 'sub', text: 'Einnahme (morgens – mittags – abends – nachts)' }),
        el('ul', { class: 'mini-list' }, meds.slice(0, 5).map(m => el('li', { class: 'mini-row' },
          el('span', { class: 'mini-title', text: [m.name, m.strength].filter(Boolean).join(' ') }),
          el('span', { class: 'schedule', text: scheduleText(m) }))))) : null,
      labs.length ? el('div', {},
        el('h3', { class: 'sub', text: flagged.length ? `Blutwerte: ${flagged.length} außerhalb der Referenz` : 'Blutwerte im Referenzbereich' }),
        el('ul', { class: 'mini-list' }, (flagged.length ? flagged : labs).slice(0, 3).map(({ e, flag }) => el('li', {},
          el('button', { class: 'mini-item', onclick: () => { setSection('lab'); ctx.showTab('health'); } },
            el('span', { class: 'mini-title', text: e.parameter }),
            el('span', { class: `mini-meta${flag === 'hoch' || flag === 'niedrig' ? ' flag-out' : ''}`, text: `${valueText(e)}${flag && flag !== 'ok' ? ` · ${FLAG_TEXT[flag]}` : ''}` })))))) : null,
      healthDocs ? el('button', { class: 'mini-item', id: 'ov-health-docs', onclick: () => { setSection('docs'); ctx.showTab('health'); } },
        el('span', { class: 'mini-title', text: 'Befunde' }),
        el('span', { class: 'mini-meta', text: `${healthDocs} gespeichert` })) : null,
    ] : [
      el('p', { class: 'muted small', text: 'Trage Blutwerte, Medikamente und Supplements ein, um alles an einem Ort zu haben.' }),
      el('button', { class: 'secondary small', onclick: () => { setSection('lab'); ctx.showTab('health'); editLab(ctx, null); } }, icon('plus'), 'Laborwert eintragen'),
    ],
  });

  // Tagebuch
  const diary = records.filter(r => r.module === 'diary').sort((a, b) => (b.occurredAt || b.createdAt).localeCompare(a.occurredAt || a.createdAt));
  const last = diary[0];
  const diaryCard = areaCard({
    area: 'diary', iconName: 'notebook-pen', title: 'Tagebuch',
    action: moreBtn('Alle', () => ctx.showTab('diary')),
    children: [
      last ? el('div', { class: 'last-entry' },
        el('span', { class: 'muted small', text: `Zuletzt: ${new Date(last.occurredAt || last.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` }),
        el('p', { class: 'entry-text clamp', text: last.title || last.text || (last.audio ? `Sprachnotiz (${last.audio.durationSec} s)` : '') }))
        : el('p', { class: 'muted small', text: 'Noch keine Einträge.' }),
    ],
  });

  const backup = ctx.backupStatus();
  const ageDays = backup.created ? Math.floor((Date.now() - new Date(backup.created)) / 86400000) : 0;
  const age = ageDays === 0 ? 'von heute' : ageDays === 1 ? '1 Tag alt' : `${ageDays} Tage alt`;
  const backupLine = el('button', { class: `backup-line${backup.due ? ' due' : ''}`, id: 'backup-line', onclick: () => ctx.exportBackup() },
    icon(backup.due ? 'triangle-alert' : 'shield-check'),
    el('span', {},
      el('strong', { text: backup.created ? 'Sicherung' : 'Noch keine Sicherung' }),
      el('span', { class: 'small', text: backup.created
        ? ` · ${age}${backup.verified ? ', geprüft' : ', ungeprüft'}${backup.due ? ' · jetzt sichern' : ''}`
        : ' · jetzt erstellen' })));

  root.replaceChildren(...[ // leere Karten (null) auslassen, replaceChildren würde sonst „null“ anzeigen
    el('div', { class: 'hello' },
      el('p', { class: 'muted', text: now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) }),
      el('h2', { class: 'hello-title', text: greeting(now) })),
    el('div', { class: 'quick-actions' },
      el('button', { class: 'primary', id: 'qa-note', onclick: () => ctx.newDiaryEntry() }, icon('notebook-pen'), 'Neue Notiz'),
      el('button', { class: 'secondary', id: 'qa-record', onclick: () => ctx.startRecording() }, icon('mic'), 'Aufnahme starten')),
    todayHint(ctx),
    impulseCard(ctx, () => render(root, ctx)),
    backupLine,
    diaryCard, contractsCard, healthCard,
    el('p', { class: 'privacy-note' }, icon('shield-check'), 'Alle Daten liegen verschlüsselt nur auf diesem Gerät.'),
  ].filter(Boolean));
}
