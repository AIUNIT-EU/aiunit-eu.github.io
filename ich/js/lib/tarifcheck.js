// Tarifcheck – Client. Sendet NUR anonymisierte Eckdaten an den eigenen Server
// (supabase/functions/tarifcheck). Namen, Vertragsnummern und Notizen verlassen das Gerät nie.

export const NOT_COMPARABLE = new Set(['Wasser', 'Miete / Wohnen']);

// Aus der Bezeichnung nur den Vertragstyp ableiten (z. B. „Kfz-Versicherung Golf“ -> „Kfz-Versicherung“),
// damit keine persönlichen Zusätze übertragen werden.
const TYPES = [
  'Kfz-Versicherung', 'Motorradversicherung', 'Haftpflichtversicherung', 'Hausratversicherung', 'Wohngebäudeversicherung',
  'Rechtsschutzversicherung', 'Berufsunfähigkeitsversicherung', 'Krankenzusatzversicherung', 'Zahnzusatzversicherung',
  'Risikolebensversicherung', 'Unfallversicherung', 'Reiseversicherung', 'Tierhalterhaftpflicht',
  'Strom', 'Gas', 'Fernwärme', 'Internet', 'DSL', 'Glasfaser', 'Mobilfunk', 'Festnetz', 'Streaming', 'Fitnessstudio',
  'Zeitung', 'Magazin', 'Kredit', 'Girokonto', 'Kreditkarte',
];

export function productTypeOf(contract) {
  const text = `${contract.name || ''}`.toLowerCase();
  const hit = TYPES.find(t => text.includes(t.toLowerCase()));
  if (hit) return hit;
  if (/kfz|auto/.test(text)) return 'Kfz-Versicherung';
  if (/handy|sim/.test(text)) return 'Mobilfunk';
  return contract.category || 'Sonstiges';
}

export function buildPayload(contract, postalCode) {
  return {
    category: contract.category,
    productType: productTypeOf(contract),
    currentProvider: contract.provider || '',
    cost: typeof contract.cost === 'number' ? contract.cost : null,
    interval: contract.interval || 'monatlich',
    usage: contract.usage || '',
    postalCode: postalCode || '',
    termEnd: contract.termEnd || '',
  };
}

// Lesbare Darstellung dessen, was gesendet wird (für die Einwilligung)
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function describePayload(p) {
  return [
    ['Kategorie', p.category],
    ['Vertragsart', p.productType],
    ['Aktueller Anbieter', p.currentProvider],
    ['Beitrag', p.cost !== null ? `${eur.format(p.cost)} ${p.interval}` : ''],
    ['Verbrauch / Leistung', p.usage],
    ['Postleitzahl', p.postalCode],
    ['Laufzeitende', p.termEnd ? p.termEnd.split('-').reverse().join('.') : ''],
  ].filter(([, v]) => v);
}

export async function requestCheck(config, payload, { timeoutMs = 150000, fetchImpl = fetch } = {}) {
  if (!config?.endpoint || !config?.token) throw new Error('Tarifcheck ist noch nicht eingerichtet (Einstellungen).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Zeitüberschreitung: Der Vergleich hat zu lange gedauert.' : 'Server nicht erreichbar. Internetverbindung und Adresse prüfen.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new Error(data?.error || `Fehler ${res.status}`);
  if (!data || !['bleiben', 'wechseln', 'unklar'].includes(data.recommendation)) throw new Error('Unerwartete Antwort vom Server.');
  return data;
}
