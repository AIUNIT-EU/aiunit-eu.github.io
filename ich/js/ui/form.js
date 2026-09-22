// Generisches Eingabeformular in einem <dialog>, genutzt von allen Modulen.
//
// fields: [{ name, label, type: 'text'|'textarea'|'number'|'date'|'time'|'password'|'select', options, required,
//            default, suggest: [..] (Vorschlagsliste), inline: true (nebeneinander), hint,
//            more: true (optional, unter „Weitere Angaben“ eingeklappt; geöffnet, sobald ein Wert vorhanden ist) }]

let counter = 0;

export function parseNumber(raw) {
  const v = String(raw).trim();
  if (!v) return null;
  const normalized = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function buildInput(f, value) {
  let el;
  if (f.type === 'select') {
    el = document.createElement('select');
    for (const opt of f.options) {
      const o = document.createElement('option');
      if (typeof opt === 'object') { o.value = opt.value; o.textContent = opt.label; } else { o.value = o.textContent = opt; }
      el.append(o);
    }
  } else if (f.type === 'textarea') {
    el = document.createElement('textarea');
    el.rows = 3;
  } else {
    el = document.createElement('input');
    el.type = f.type === 'date' || f.type === 'time' || f.type === 'password' ? f.type : 'text';
    if (f.autocomplete) el.autocomplete = f.autocomplete;
    if (f.type === 'number') el.inputMode = 'decimal';
  }
  el.name = f.name;
  if (f.required) el.required = true;
  if (f.suggest?.length) {
    const id = `dl-${++counter}`;
    const dl = document.createElement('datalist');
    dl.id = id;
    for (const s of f.suggest) { const o = document.createElement('option'); o.value = s; dl.append(o); }
    el.setAttribute('list', id);
    el._datalist = dl;
  }
  const v = value ?? f.default ?? '';
  // Auswahlfelder ohne Wert behalten die erste Option als Vorauswahl
  if (f.type === 'select' && v === '') return el;
  el.value = f.type === 'number' && typeof v === 'number' ? String(v).replace('.', ',') : v;
  return el;
}

/**
 * Öffnet das Formular. onSave(data) darf einen Fehler werfen, der dann angezeigt wird.
 */
export function openForm({ title, fields, values = {}, onSave, onDelete, note, before = [], submitLabel = 'Speichern', deleteConfirm = 'Diesen Eintrag endgültig löschen?' }) {
  const dlg = document.getElementById('editor');
  const form = document.createElement('form');
  form.className = 'editor-form';
  form.noValidate = true;

  const h = document.createElement('h2');
  h.textContent = title;
  form.append(h);
  if (note) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = note;
    form.append(p);
  }
  form.append(...before.filter(Boolean)); // z. B. Vorschau eines Befunds beim Abtippen

  // Schrittweise Angaben (Master-Prompt 11): optionale Felder eingeklappt, nie Pflichtfelder
  const moreFields = fields.filter(f => f.more && !f.required);
  let moreBox = null;
  if (moreFields.length) {
    moreBox = document.createElement('details');
    moreBox.className = 'more-fields';
    moreBox.open = moreFields.some(f => values[f.name] !== undefined && values[f.name] !== null && values[f.name] !== '');
    const summary = document.createElement('summary');
    summary.textContent = 'Weitere Angaben (optional)';
    moreBox.append(summary);
  }

  let row = null;
  let rowTarget = null;
  for (const f of fields) {
    const target = f.more && !f.required && moreBox ? moreBox : form;
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : '');
    const input = buildInput(f, values[f.name]);
    label.append(input);
    if (input._datalist) label.append(input._datalist);
    if (f.hint) {
      const s = document.createElement('span');
      s.className = 'hint';
      s.textContent = f.hint;
      label.append(s);
    }
    if (f.inline) {
      if (!row || rowTarget !== target) { row = document.createElement('div'); row.className = 'inline-row'; rowTarget = target; target.append(row); }
      row.append(label);
    } else {
      row = null;
      target.append(label);
    }
  }
  if (moreBox) form.append(moreBox);

  const error = document.createElement('p');
  error.className = 'error';
  error.setAttribute('role', 'alert');

  const bar = document.createElement('div');
  bar.className = 'editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Abbrechen';
  cancel.onclick = () => dlg.close();
  bar.append(cancel);
  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = 'Löschen';
    del.onclick = async () => {
      if (!confirm(deleteConfirm)) return;
      await onDelete();
      dlg.close();
    };
    bar.append(del);
  }
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = submitLabel;
  bar.append(save);
  form.append(error, bar);

  form.onsubmit = async e => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const raw = form.elements[f.name].value;
      if (f.required && !String(raw).trim()) { error.textContent = `Bitte „${f.label}“ ausfüllen.`; return; }
      if (f.type === 'number') {
        const n = parseNumber(raw);
        if (Number.isNaN(n)) { error.textContent = `„${f.label}“ ist keine gültige Zahl.`; return; }
        data[f.name] = n;
      } else {
        data[f.name] = f.type === 'password' ? (raw || null) : (String(raw).trim() || null);
      }
    }
    try {
      save.disabled = true;
      await onSave(data);
      dlg.close();
    } catch (err) {
      error.textContent = err.message || 'Speichern fehlgeschlagen.';
    } finally {
      save.disabled = false;
    }
  };

  dlg.replaceChildren(form);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  form.querySelector('input, select, textarea')?.focus();
}

export function closeForm() {
  const dlg = document.getElementById('editor');
  if (dlg?.open) dlg.close();
  dlg?.replaceChildren();
}

/**
 * Allgemeine Ansicht im selben Dialog (Details, Ergebnisse, Hinweise).
 * body: Array von Nodes, actions: Array von Buttons (Schließen wird automatisch ergänzt).
 */
export function openSheet({ title, subtitle, body = [], actions = [], closeLabel = null }) {
  const dlg = document.getElementById('editor');
  const wrap = document.createElement('div');
  wrap.className = 'sheet';
  const head = document.createElement('div');
  head.className = 'sheet-head';
  const titles = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  titles.append(h);
  if (subtitle) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = subtitle;
    titles.append(p);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'icon-btn sheet-close';
  x.setAttribute('aria-label', 'Schließen');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#i-x');
  svg.append(use);
  x.append(svg);
  x.onclick = () => dlg.close();
  head.append(titles, x);
  const content = document.createElement('div');
  content.className = 'sheet-body';
  content.append(...body.filter(Boolean));
  const bar = document.createElement('div');
  bar.className = 'editor-actions sheet-actions';
  if (closeLabel) {
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = closeLabel;
    close.onclick = () => dlg.close();
    bar.append(close);
  }
  bar.append(...actions.filter(Boolean));
  wrap.append(head, content);
  if (bar.childElementCount) wrap.append(bar);
  dlg.replaceChildren(wrap);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  return { close: () => dlg.close(), dialog: dlg };
}
