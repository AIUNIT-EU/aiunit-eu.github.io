// Ermutigende Impulse und Reflexionsfragen (R05, IMP-01 bis IMP-03). Nur lokal, keine Auswertung von Einträgen.
// Ton laut Gesamtidee: kein Zwang zu guter Laune, keine Schuldgefühle, keine Heilsversprechen.
// Status der Texte: Entwurf – Tom prüft sie vor der Abnahme (IMP-02).

export const IMPULSES = [
  'Es muss nicht alles heute gelöst werden.',
  'Ein kleiner Schritt ist auch ein Schritt.',
  'Du darfst langsamer sein, als du es von dir erwartest.',
  'Was heute gut genug ist, darf gut genug bleiben.',
  'Pausen sind Teil der Arbeit, nicht ihr Gegenteil.',
  'Du musst nicht jeden Gedanken zu Ende denken.',
  'Nicht jeder Tag muss ein guter Tag sein.',
  'Es ist in Ordnung, um Hilfe zu bitten.',
  'Schwere Tage dürfen schwer sein.',
  'Heute reicht es, einfach dran zu bleiben.',
  'Fortschritt sieht von innen oft kleiner aus, als er ist.',
  'Manches wird leichter, wenn man es aufschreibt.',
  'Du darfst Nein sagen, auch zu dir selbst.',
  'Ein unerledigter Punkt macht dich nicht weniger wert.',
  'Atme einmal tief durch, bevor du weitermachst.',
  'Sprich heute mit dir so, wie du mit einem guten Freund sprechen würdest.',
  'Nicht alles, was dringend wirkt, ist wichtig.',
  'Heute darf etwas liegen bleiben.',
  'Du bist nicht dafür zuständig, alles zu tragen.',
  'Ein ruhiger Moment zählt auch.',
  'Gefühle dürfen da sein, sie müssen nicht bleiben.',
  'Du kannst neu anfangen, jederzeit am Tag.',
  'Was dir gestern schwerfiel, darf heute anders sein.',
  'Genug geschlafen ist manchmal der beste Plan.',
  'Wer sich selbst ernst nimmt, darf auch über sich lachen.',
  'Es gibt keinen richtigen Zeitpunkt, nur den nächsten.',
  'Kleine Routinen tragen durch große Wochen.',
  'Du musst heute niemandem etwas beweisen.',
  'Ein Spaziergang löst nicht alles, aber manches.',
  'Unsicherheit heißt nicht, dass du falsch liegst.',
  'Freundlich zu dir zu sein ist keine Schwäche.',
  'Was du heute schaffst, reicht für heute.',
  'Du darfst stolz auf etwas Kleines sein.',
  'Auch Umwege gehören zum Weg.',
  'Nicht jede Frage braucht heute eine Antwort.',
  'Ein Glas Wasser, ein Fenster auf, ein neuer Blick.',
  'Du bist mehr als deine To-do-Liste.',
  'Manchmal ist Durchhalten die ganze Leistung.',
  'Es ist erlaubt, Pläne zu ändern.',
  'Was gut lief, darf auch notiert werden.',
  'Du kannst Schweres anerkennen, ohne dich darin zu verlieren.',
  'Eine Sache nach der anderen.',
  'Heute ist ein neuer Versuch, kein neuer Test.',
  'Wer müde ist, braucht Ruhe, keine Vorwürfe.',
  'Nicht perfekt ist oft genau richtig.',
  'Ein Gespräch kann leichter machen, was allein schwer wiegt.',
  'Du musst nicht alles verstehen, um weiterzugehen.',
  'Dankbarkeit muss nicht groß sein, um zu zählen.',
  'Etwas Gutes für dich zu tun, braucht keinen Grund.',
  'Es ist okay, wenn heute nur Alltag ist.',
  'Neugier ist ein guter Begleiter.',
  'Du darfst dir Zeit lassen.',
  'Was sich nicht ändern lässt, darf leiser werden.',
  'Ein freundlicher Gedanke kostet nichts.',
  'Wenn du den Weg gerade nicht siehst, reicht der nächste Schritt.',
  'Heute darf leicht sein.',
  'Was zählt, ist nicht, wie schnell, sondern dass du weitergehst.',
  'Grenzen zu setzen ist eine Form von Fürsorge.',
  'Manchmal ist der nächste Schritt einfach: kurz hinsetzen.',
  'Du hast schon viel geschafft, auch wenn es niemand gesehen hat.',
];

export const QUESTIONS = [
  'Was wäre ein kleiner, machbarer nächster Schritt?',
  'Was hat dir heute gutgetan, auch wenn es klein war?',
  'Was möchtest du morgen anders machen – und was genauso?',
  'Worüber hast du dich heute gefreut?',
  'Was kannst du heute loslassen?',
  'Wofür bist du gerade dankbar?',
  'Was würdest du einem Freund in dieser Lage raten?',
  'Was liegt in deiner Hand, und was nicht?',
  'Was hat dich heute Kraft gekostet, und was hat dir Kraft gegeben?',
  'Was brauchst du gerade am meisten?',
  'Welche Kleinigkeit könnte deinen Tag morgen leichter machen?',
  'Was hast du heute gelernt, über dich oder andere?',
  'Worauf freust du dich in den nächsten Tagen?',
  'Wenn der Tag eine Überschrift hätte, welche wäre es?',
  'Was möchtest du dir selbst gerade sagen?',
  'Wem möchtest du heute oder morgen etwas Gutes sagen?',
  'Was hat heute besser geklappt, als du dachtest?',
  'Was darf warten?',
  'Welcher Moment heute war ruhig?',
  'Was würde „gut genug“ für morgen bedeuten?',
  'Was davon kannst du heute beeinflussen, und sei es nur ein kleines Stück?',
  'Was hat dir in einer ähnlichen Lage schon einmal geholfen?',
  'Wer könnte dir dabei helfen, und wie könntest du fragen?',
  'Woran würdest du merken, dass es ein kleines bisschen besser geworden ist?',
];

// Tag seit 1970 (lokales Datum 'YYYY-MM-DD'), damit die Auswahl pro Kalendertag gleich bleibt
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// Mischt die Reihenfolge fest (gleich auf jedem Gerät), damit aufeinanderfolgende Tage nicht ähnlich klingen
const STEP = 37; // teilerfremd zu IMPULSES.length (60) und QUESTIONS.length (24)

/** Impuls des Tages; offset > 0 für „Anderer Impuls“. Nie zweimal derselbe an zwei aufeinanderfolgenden Tagen. */
export function impulseFor(iso, offset = 0) {
  const n = IMPULSES.length;
  return IMPULSES[(((dayNumber(iso) + offset) * STEP) % n + n) % n];
}

/** Reflexionsfrage; wechselt je Eintrag (seed z. B. Anzahl der Einträge heute). */
export function questionFor(iso, seed = 0) {
  const n = QUESTIONS.length;
  return QUESTIONS[(((dayNumber(iso) + seed) * STEP) % n + n) % n];
}
