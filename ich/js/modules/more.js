// „Mehr“ (Master-Prompt 11): alle Dokumente, Sicherung und Einstellungen an einem festen Ort.
// Keine eigenen Daten; nutzt die Module Dokumente, Gesundheit und Verträge.

import { APP_NAME, APP_VERSION } from '../config.js';
import { el, icon } from '../ui/dom.js';
import { docsFor, docList, openDocument } from './documents.js';
import { openHealthDoc } from './health.js';
import { openDetail } from './contracts.js';

function row({ id, iconName, title, meta, onclick }) {
  return el('li', {},
    el('button', { type: 'button', class: 'list-row', id, onclick },
      icon(iconName),
      el('span', { class: 'list-text' },
        el('span', { class: 'list-title', text: title }),
        meta ? el('span', { class: 'muted small', text: meta }) : null),
      icon('chevron-right')));
}

export function render(root, ctx) {
  const healthDocs = docsFor(ctx.records, 'health');
  const contractDocs = docsFor(ctx.records, 'contracts');
  const openContractDoc = id => {
    const doc = ctx.records.find(r => r.id === id);
    openDocument(id, { actions: doc?.linkedId ? [el('button', { type: 'button', class: 'secondary', onclick: () => { ctx.showTab('contracts'); openDetail(ctx, doc.linkedId); } }, 'Zum Vertrag')] : [] });
  };
  const status = ctx.backupStatus();

  root.replaceChildren(
    el('section', { class: 'more-section', 'aria-labelledby': 'more-docs' },
      el('h2', { id: 'more-docs' }, icon('file-text'), 'Dokumente'),
      healthDocs.length || contractDocs.length ? null
        : el('p', { class: 'muted', text: 'Noch keine Dokumente. Befunde scannst du unter Gesundheit → Befunde, Unterlagen zu einem Vertrag direkt im Vertrag.' }),
      healthDocs.length ? el('h3', { class: 'sub', text: `Befunde (${healthDocs.length})` }) : null,
      healthDocs.length ? docList(healthDocs, id => openHealthDoc(ctx, id)) : null,
      contractDocs.length ? el('h3', { class: 'sub', text: `Vertragsunterlagen (${contractDocs.length})` }) : null,
      contractDocs.length ? docList(contractDocs, openContractDoc) : null),
    el('section', { class: 'more-section', 'aria-labelledby': 'more-app' },
      el('h2', { id: 'more-app' }, icon('settings'), 'App'),
      el('ul', { class: 'list-group' },
        row({ id: 'btn-backup-row', iconName: status.due ? 'triangle-alert' : 'shield-check', title: 'Sicherung',
          meta: ctx.backupStatusText(), onclick: () => ctx.openSettings('backup') }),
        row({ id: 'btn-settings', iconName: 'settings', title: 'Einstellungen',
          meta: 'Erscheinungsbild, Sperre, Wiederherstellung, Tarifcheck', onclick: () => ctx.openSettings() }))),
    el('p', { class: 'muted small about', text: `${APP_NAME} ${APP_VERSION} · Alle Inhalte liegen verschlüsselt auf diesem Gerät.` }));
}
