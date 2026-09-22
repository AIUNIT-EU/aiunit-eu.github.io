// Links zum Selbst-Vergleichen, je nach Vertragsart. Nur Adressen, die beim Erstellen erreichbar waren
// (Stand 2026-09-22, geprüft per Abruf). Verivox blockiert automatische Prüfungen, daher nur die Startseite.

const P = {
  kfz: { label: 'Check24 – Kfz-Versicherung', url: 'https://www.check24.de/kfz-versicherung/' },
  haftpflicht: { label: 'Check24 – Privathaftpflicht', url: 'https://www.check24.de/privathaftpflicht/' },
  hausrat: { label: 'Check24 – Hausratversicherung', url: 'https://www.check24.de/hausratversicherung/' },
  versicherungen: { label: 'Check24 – Versicherungen', url: 'https://versicherungen.check24.de/' },
  strom: { label: 'Check24 – Strom', url: 'https://www.check24.de/strom/' },
  gas: { label: 'Check24 – Gas', url: 'https://www.check24.de/gas/' },
  dsl: { label: 'Check24 – DSL / Internet', url: 'https://www.check24.de/dsl/' },
  handy: { label: 'Check24 – Handytarife', url: 'https://handytarife.check24.de/' },
  kredit: { label: 'Check24 – Kredit', url: 'https://www.check24.de/kredit/' },
  verivox: { label: 'Verivox', url: 'https://www.verivox.de/' },
};

const search = q => ({ label: `Websuche: ${q}`, url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}` });

export function comparisonLinks(contract) {
  const text = `${contract.name || ''} ${contract.usage || ''}`.toLowerCase();
  const has = (...words) => words.some(w => text.includes(w));
  const links = [];
  switch (contract.category) {
    case 'Versicherung':
      if (has('kfz', 'auto', 'fahrzeug', 'motorrad')) links.push(P.kfz);
      if (has('haftpflicht')) links.push(P.haftpflicht);
      if (has('hausrat')) links.push(P.hausrat);
      links.push(P.versicherungen, P.verivox);
      break;
    case 'Strom / Gas / Energie':
      links.push(...(has('gas') ? [P.gas] : []), P.strom, P.verivox);
      break;
    case 'Telefon / Internet / Mobilfunk':
      links.push(...(has('handy', 'mobil', 'sim') ? [P.handy, P.dsl] : [P.dsl, P.handy]), P.verivox);
      break;
    case 'Kredit / Finanzen':
      links.push(P.kredit, P.verivox);
      break;
    case 'Wasser':
    case 'Miete / Wohnen':
      return []; // kein Anbieterwechsel möglich
    default:
      break;
  }
  const topic = (contract.name || contract.category || '').trim();
  if (topic) links.push(search(`${topic} Tarif Vergleich`));
  return links.filter((l, i, arr) => arr.findIndex(x => x.url === l.url) === i);
}
