// Parser: macht aus gesprochenem/getipptem Text bzw. aus Belegtext strukturierte Felder.
// Läuft komplett lokal, keine Daten verlassen das Gerät.

// ---------- Datums-Helfer ----------

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

export function fromIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDatum(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function gueltigesDatum(y, m, d) {
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null;
}

// Datum ohne Jahr: liegt es in der Zukunft, ist das Vorjahr gemeint.
function datumOhneJahr(m, d, heute) {
  let x = gueltigesDatum(heute.getFullYear(), m, d);
  if (!x) return null;
  if (x > heute) x = gueltigesDatum(heute.getFullYear() - 1, m, d);
  return x;
}

const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONATE_ALT = { jänner: 1, maerz: 3, marz: 3, sept: 9, okt: 10, nov: 11, dez: 12 };

const L = '(?<![\\p{L}\\d])'; // Wortanfang (auch für Umlaute)
const R = '(?![\\p{L}\\d])';  // Wortende

// ---------- Zahlwörter ----------

const EINER = { null: 0, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const ZEHNER = { zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const KLEIN = { ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };

function zahlwoerter(t) {
  const zehner = Object.keys(ZEHNER).join('|');
  t = t.replace(new RegExp(`${L}(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(${zehner})${R}`, 'gu'),
    (_, a, b) => String(KLEIN[a] + ZEHNER[b]));
  t = t.replace(new RegExp(`${L}(${zehner})${R}`, 'gu'), (_, a) => String(ZEHNER[a]));
  t = t.replace(new RegExp(`${L}(${Object.keys(EINER).join('|')})${R}`, 'gu'), (_, a) => String(EINER[a]));
  return t;
}

// ---------- Normalisierung ----------

function normalisieren(text) {
  let t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  t = t.replace(/€/g, ' euro ').replace(new RegExp(`${L}(eur|euros)${R}`, 'gu'), 'euro');
  t = t.replace(/kilometer-?stand|km-stand|km stand|tacho-?stand|tacho/g, ' km ');
  t = t.replace(new RegExp(`${L}(kilometer|kilometern)${R}`, 'gu'), 'km');
  t = zahlwoerter(t);
  return t;
}

// Tausender-Gruppen zusammenziehen: "45.230" / "45 230" -> "45230"
function tausender(t) {
  return t.replace(/(?<![\d,.])(\d{1,3})((?:[.\s]\d{3})+)(?!\d|[.,]\d)/g,
    (_, a, b) => a + b.replace(/[.\s]/g, ''));
}

function betragZuZahl(s) {
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{3}$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

// ---------- Datum aus Text ----------

function datumFinden(t, heute) {
  let datum = null;
  const weg = (m) => { t = t.replace(m, ' '); };

  // 12.11.2026 / 12.11.26 / 12.11.
  let m = t.match(/(?:am\s+)?(?<![\d.,])(\d{1,2})\.(\d{1,2})(?!\d)(?:\.(\d{4}|\d{2})(?!\d))?\.?/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let x = null;
    if (m[3]) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      x = gueltigesDatum(y, mo, d);
    } else if (mo >= 1 && mo <= 12) {
      x = datumOhneJahr(mo, d, heute);
    }
    if (x) { datum = x; weg(m[0]); }
  }

  // 5. november (2026)
  if (!datum) {
    const namen = [...MONATE, ...Object.keys(MONATE_ALT)].join('|');
    m = t.match(new RegExp(`(?:am\\s+)?(\\d{1,2})\\.?\\s+(${namen})${R}(?:\\s+(\\d{4}))?`, 'u'));
    if (m) {
      const mo = MONATE.indexOf(m[2]) + 1 || MONATE_ALT[m[2]];
      const x = m[3] ? gueltigesDatum(+m[3], mo, +m[1]) : datumOhneJahr(mo, +m[1], heute);
      if (x) { datum = x; weg(m[0]); }
    }
  }

  // vorgestern / gestern / heute
  if (!datum) {
    for (const [wort, tage] of [['vorgestern', -2], ['gestern', -1], ['heute', 0]]) {
      const r = new RegExp(`${L}${wort}${R}`, 'u');
      if (r.test(t)) { datum = addDays(heute, tage); t = t.replace(r, ' '); break; }
    }
  }

  // vor 3 tagen
  if (!datum) {
    m = t.match(/vor\s+(\d{1,2})\s+tag(?:en)?/);
    if (m) { datum = addDays(heute, -m[1]); weg(m[0]); }
  }

  // (am / letzten) dienstag
  if (!datum) {
    m = t.match(new RegExp(`(?:(letzten|letzter|vergangenen|vergangener|am)\\s+)?(${WOCHENTAGE.join('|')})${R}`, 'u'));
    if (m) {
      const wd = WOCHENTAGE.indexOf(m[2]);
      let diff = (heute.getDay() - wd + 7) % 7;
      if (diff === 0 && m[1] && m[1] !== 'am') diff = 7;
      datum = addDays(heute, -diff);
      weg(m[0]);
    }
  }

  return { datum: datum ? isoDate(datum) : null, rest: t };
}

// ---------- Uhrzeiten ----------

function zeitenFinden(t) {
  const zeiten = [];
  const pad = (h, mi) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const ok = (h, mi) => h <= 23 && mi <= 59;
  // 8:15 (Uhr) oder um 8.15
  t = t.replace(/(?:um\s+)?(?<![\d.,])(\d{1,2}):(\d{2})(?!\d)(?:\s*uhr)?/g, (all, h, mi) => {
    if (!ok(+h, +mi)) return all;
    zeiten.push(pad(+h, +mi)); return ' ';
  });
  t = t.replace(/um\s+(\d{1,2})\.(\d{2})(?!\d)(?:\s*uhr)?/g, (all, h, mi) => {
    if (!ok(+h, +mi)) return all;
    zeiten.push(pad(+h, +mi)); return ' ';
  });
  // 8 uhr 15 / 8 uhr
  t = t.replace(/(?:um\s+)?(?<![\d.,])(\d{1,2})\s*uhr(?:\s+(\d{1,2})(?!\d))?/g, (all, h, mi) => {
    if (!ok(+h, +(mi || 0))) return all;
    zeiten.push(pad(+h, +(mi || 0))); return ' ';
  });
  return { zeiten, rest: t };
}

// ---------- Wort-Listen ----------

const KOSTEN_KATEGORIEN = [
  ['Tanken', ['getankt', 'tanken', 'tankstelle', 'tank', 'tankfüllung', 'diesel', 'benzin', 'super', 'sprit', 'e10', 'e5', 'aufgetankt', 'vollgetankt', 'strom', 'geladen', 'laden', 'ladesäule']],
  ['Parken', ['parken', 'parkhaus', 'parkgebühr', 'parkgebühren', 'parkticket', 'parkschein', 'geparkt', 'parkplatz', 'tiefgarage', 'parkuhr']],
  ['Autowäsche', ['autowäsche', 'wäsche', 'waschanlage', 'waschstraße', 'gewaschen', 'waschen', 'staubsauger', 'innenreinigung']],
  ['Maut', ['maut', 'vignette', 'mautgebühr', 'fähre']],
  ['Werkstatt', ['werkstatt', 'inspektion', 'reparatur', 'tüv', 'hu', 'au', 'ölwechsel', 'service', 'wartung', 'scheibenwischer', 'zubehör']],
  ['Reifen', ['reifen', 'reifenwechsel', 'räder', 'winterreifen', 'sommerreifen', 'radwechsel']],
];

const KOSTEN_SIGNAL = ['euro', 'cent', 'ausgabe', 'kosten', 'beleg', 'quittung', 'bezahlt', 'gezahlt'];

const ZWECK_WOERTER = ['beratung', 'workshop', 'schulung', 'training', 'termin', 'kundentermin', 'meeting', 'besprechung',
  'vortrag', 'seminar', 'webinar', 'coaching', 'präsentation', 'akquise', 'einkauf', 'büromaterial', 'bank', 'post',
  'messe', 'netzwerktreffen', 'netzwerken', 'networking', 'veranstaltung', 'konferenz', 'kongress', 'abholung', 'lieferung',
  'erstgespräch', 'angebot', 'vertragsunterzeichnung', 'aufnahme', 'dreh', 'fotoshooting', 'steuerberater', 'steuerberatung',
  'interview', 'fortbildung', 'weiterbildung', 'kurs', 'vorstellung', 'pitch', 'audit', 'besuch', 'kundenbesuch'];

const PARTNER_PRAEFIX = ['kunde', 'kundin', 'firma', 'frau', 'herr', 'familie', 'praxis', 'kanzlei', 'agentur', 'büro', 'dr', 'dr.'];

const FUELL = new Set(['start', 'starte', 'gestartet', 'abfahrt', 'losfahrt', 'losgefahren', 'los', 'fahre', 'fahrt', 'beginn', 'ende',
  'ankunft', 'angekommen', 'ankommen', 'stopp', 'stop', 'km', 'und', 'dann', 'ich', 'bin', 'war', 'habe', 'hab', 'mit', 'dem', 'den',
  'das', 'die', 'der', 'auto', 'wagen', 'stand', 'privat', 'privatfahrt', 'private', 'geschäftlich', 'geschäftsfahrt', 'dienstfahrt',
  'dienstlich', 'arbeitsweg', 'pendeln', 'jetzt', 'gerade', 'eben', 'bitte', 'ok', 'okay', 'also', 'ähm', 'äh', 'hm', 'ja', 'neue',
  'neuer', 'eintragen', 'nachtragen', 'nachtrag', 'gefahren', 'erreicht', 'da', 'zurück', 'wieder', 'euro', 'cent', 'bezahlt',
  'gezahlt', 'ausgelegt', 'firmenkarte', 'geschäftskarte', 'liter', 'beleg', 'quittung', 'kosten', 'ausgabe', 'uhr', 'um', 'am',
  'es', 'ging', 'geht', 'wir', 'sind', 'heim', 'nachhause', 'hause']);

const KLEINWOERTER = new Set(['und', 'bei', 'für', 'der', 'die', 'das', 'von', 'zu', 'zum', 'zur', 'im', 'am', 'an', 'in', 'auf', 'mit', 'über']);
const SPEZIAL = { ki: 'KI', gmbh: 'GmbH', ag: 'AG', kg: 'KG', ug: 'UG', ihk: 'IHK', hwk: 'HWK', dr: 'Dr.', 'dr.': 'Dr.', ev: 'e.V.', 'e.v.': 'e.V.' };

function tokens(t) {
  return t.split(/[^\p{L}\d.]+/u).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
}

function enthaeltWort(t, liste) {
  const ws = new Set(tokens(t));
  return liste.some((w) => ws.has(w));
}

function enthaeltPhrase(t, phrasen) {
  const s = ' ' + tokens(t).join(' ') + ' ';
  return phrasen.some((p) => s.includes(' ' + p + ' '));
}

export function schoen(s) {
  if (!s) return '';
  return s.trim().split(/\s+/).map((w, i) => {
    if (SPEZIAL[w]) return SPEZIAL[w];
    if (i > 0 && KLEINWOERTER.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// ---------- Fahrten ----------

function artFinden(t) {
  if (enthaeltWort(t, ['privat', 'privatfahrt', 'private', 'privates'])) return 'privat';
  if (enthaeltWort(t, ['arbeitsweg', 'pendeln', 'pendelfahrt']) || enthaeltPhrase(t, ['zur arbeit', 'ins büro', 'zum büro', 'zur arbeitsstätte', 'von der arbeit'])) return 'arbeitsweg';
  if (enthaeltWort(t, ['geschäftlich', 'geschäftsfahrt', 'dienstfahrt', 'dienstlich'])) return 'geschaeftlich';
  return null;
}

const START_WOERTER = ['start', 'starte', 'gestartet', 'abfahrt', 'losfahrt', 'losgefahren', 'los', 'beginn', 'anfang', 'anfangs'];
const ENDE_WOERTER = ['ende', 'ankunft', 'angekommen', 'ankommen', 'stopp', 'stop', 'endstand', 'zurück', 'erreicht', 'schluss'];

function kmZahlenZuordnen(t) {
  const funde = [];
  const r = /(?<![\d,.])(\d{2,7})(?!\d|[.,]\d)/g;
  let m, letzteEnde = 0;
  while ((m = r.exec(t))) {
    const davor = tokens(t.slice(letzteEnde, m.index)).slice(-4);
    let rolle = null;
    if (davor.some((w) => ENDE_WOERTER.includes(w))) rolle = 'ende';
    else if (davor.some((w) => START_WOERTER.includes(w))) rolle = 'start';
    funde.push({ wert: +m[1], rolle, index: m.index, laenge: m[0].length });
    letzteEnde = m.index + m[0].length;
  }
  return funde;
}

function textFelder(t) {
  // Satzzeichen-Segmente: Komma/Punkt/Semikolon beenden ein Feld
  const segmente = [];
  for (const teil of t.split(/[,;]|\.(?=\s|$)/)) {
    const ws = tokens(teil).filter((w) => !/^\d+([.,]\d+)?$/.test(w));
    let aktuell = { rolle: 'frei', woerter: [] };
    const abschliessen = () => { if (aktuell.woerter.length) segmente.push(aktuell); };
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const naechstes = ws[i + 1];
      let neu = null, behalten = false;
      if (['nach', 'richtung', 'ziel', 'in'].includes(w)) neu = 'ziel';
      else if (['zu', 'zur', 'zum'].includes(w)) neu = PARTNER_PRAEFIX.includes(naechstes) ? 'partner' : 'ziel';
      else if (['bei', 'partner', 'geschäftspartner', 'ansprechpartner'].includes(w)) neu = 'partner';
      else if (PARTNER_PRAEFIX.includes(w) && aktuell.rolle !== 'partner') { neu = 'partner'; behalten = true; }
      else if (['zweck', 'wegen', 'für', 'grund', 'anlass', 'thema'].includes(w)) neu = 'zweck';
      else if (['über', 'via', 'umweg', 'route'].includes(w)) neu = 'route';
      else if (w === 'von' && aktuell.rolle === 'frei' && !aktuell.woerter.length) neu = 'von';
      if (neu) {
        abschliessen();
        aktuell = { rolle: neu, woerter: behalten ? [w] : [] };
        continue;
      }
      if (FUELL.has(w)) continue;
      aktuell.woerter.push(w);
    }
    abschliessen();
  }

  const felder = { ziel: '', zweck: '', partner: '', route: '', von: '' };
  const frei = [];
  for (const s of segmente) {
    let ws = s.woerter;
    // Zweck-Wort im Segment? -> ab da ist es der Zweck
    if (s.rolle !== 'zweck' && !felder.zweck) {
      const idx = ws.findIndex((w) => ZWECK_WOERTER.includes(w));
      if (idx >= 0) {
        felder.zweck = ws.slice(idx).join(' ');
        ws = ws.slice(0, idx);
      }
    }
    if (!ws.length) continue;
    const text = ws.join(' ');
    if (s.rolle === 'frei') frei.push(text);
    else if (!felder[s.rolle]) felder[s.rolle] = text;
    else felder[s.rolle] += ' ' + text;
  }
  for (const text of frei) {
    if (!felder.ziel) felder.ziel = text;
    else if (!felder.zweck) felder.zweck = text;
    else if (!felder.partner) felder.partner = text;
    else felder.zweck += ' ' + text;
  }
  if (felder.von) felder.route = [`von ${felder.von}`, felder.route].filter(Boolean).join(', ');
  return {
    ziel: schoen(felder.ziel),
    zweck: schoen(felder.zweck),
    partner: schoen(felder.partner),
    route: felder.route ? felder.route.charAt(0).toUpperCase() + felder.route.slice(1) : '',
  };
}

// ---------- Kosten ----------

function betraegeFinden(t) {
  const betraege = [];
  t = t.replace(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*euro(?:\s+(?:und\s+)?(\d{1,2})(?!\d)(?:\s*cent)?)?/g,
    (_, zahl, cent) => {
      let b = betragZuZahl(zahl);
      if (cent && Number.isInteger(b)) b += +cent / 100;
      betraege.push(Math.round(b * 100) / 100);
      return ' ';
    });
  return { betraege, rest: t };
}

function literFinden(t) {
  let liter = null;
  t = t.replace(/(\d+(?:[.,]\d{1,3})?)\s*(?:liter|ltr|l)(?![\p{L}])/u, (_, z) => {
    liter = Number(z.replace(',', '.'));
    return ' ';
  });
  return { liter, rest: t };
}

function kategorieFinden(t) {
  for (const [kat, woerter] of KOSTEN_KATEGORIEN) if (enthaeltWort(t, woerter)) return kat;
  if (enthaeltWort(t, ['versicherung'])) return 'Sonstiges';
  return null;
}

function bezahltFinden(t) {
  if (enthaeltWort(t, ['privat', 'ausgelegt', 'vorgestreckt', 'bar']) || enthaeltPhrase(t, ['eigene karte', 'selbst bezahlt', 'aus eigener tasche', 'privat bezahlt'])) return 'privat';
  if (enthaeltWort(t, ['firmenkarte', 'geschäftskarte', 'firmenkonto', 'tankkarte']) || enthaeltPhrase(t, ['firma bezahlt', 'geschäftlich bezahlt', 'über die firma'])) return 'firma';
  return null;
}

// ---------- Haupt-Einstieg ----------

/**
 * Wertet einen gesprochenen oder getippten Satz aus.
 * @param {string} text
 * @param {{heute?: Date, favoriten?: Array<{kurz:string, ziel?:string, zweck?:string, partner?:string, art?:string}>}} opt
 */
export function parseEingabe(text, opt = {}) {
  const heute = opt.heute || new Date();
  let t = normalisieren(text);
  const roh = t;

  const d = datumFinden(t, heute); t = d.rest;
  const z = zeitenFinden(t); t = z.rest;
  const b = betraegeFinden(t); t = b.rest;
  const l = literFinden(t); t = l.rest;
  t = tausender(t);

  const kategorie = kategorieFinden(roh);
  const istKosten = kategorie !== null || b.betraege.length > 0 || enthaeltWort(roh, KOSTEN_SIGNAL);

  if (istKosten) {
    const kmFunde = kmZahlenZuordnen(t).filter((f) => f.wert >= 1000);
    let rest = t;
    for (const f of kmFunde) rest = rest.replace(String(f.wert), ' ');
    const alleKatWoerter = KOSTEN_KATEGORIEN.flatMap(([, w]) => w);
    const notizWoerter = tokens(rest).filter((w) => !FUELL.has(w) && !alleKatWoerter.includes(w) && !/^\d/.test(w)
      && !['in', 'bei', 'an', 'der', 'für', 'getankt', 'tankstelle', 'privat', 'karte', 'firma', 'eigene', 'selbst', 'vorgestreckt', 'bar', 'tasche', 'eigener', 'aus', 'über', 'zahlung'].includes(w));
    return {
      typ: 'kosten',
      datum: d.datum,
      kategorie: kategorie || 'Sonstiges',
      betrag: b.betraege.length ? b.betraege[0] : null,
      liter: l.liter,
      km: kmFunde.length ? kmFunde[0].wert : null,
      bezahlt: bezahltFinden(roh),
      ort: schoen(notizWoerter.join(' ')),
    };
  }

  // Fahrt
  const funde = kmZahlenZuordnen(t).filter((f) => f.wert >= 10);
  let kmStart = null, kmEnde = null;
  for (const f of funde) {
    if (f.rolle === 'start' && kmStart === null) kmStart = f.wert;
    else if (f.rolle === 'ende' && kmEnde === null) kmEnde = f.wert;
  }
  for (const f of funde) {
    if (f.rolle) continue;
    if (kmStart === null && kmEnde === null && funde.length >= 2) kmStart = f.wert;
    else if (kmStart !== null && kmEnde === null) kmEnde = f.wert;
    else if (kmEnde !== null && kmStart === null) kmStart = f.wert;
    else if (kmStart === null) kmStart = f.wert;
  }
  // nur eine Zahl ohne Start/Ende-Wort: App entscheidet anhand der offenen Fahrt
  let modus;
  const hatStartWort = enthaeltWort(roh, START_WOERTER);
  const hatEndeWort = enthaeltWort(roh, ENDE_WOERTER);
  if (kmStart !== null && kmEnde !== null) modus = 'komplett';
  else if (kmEnde !== null || (hatEndeWort && !hatStartWort)) modus = 'ende';
  else if (hatStartWort) modus = 'start';
  else modus = 'auto';
  if (modus === 'ende' && kmEnde === null && kmStart !== null) { kmEnde = kmStart; kmStart = null; }

  let rest = t;
  for (const f of funde) rest = rest.replace(String(f.wert), ' ');
  const felder = textFelder(rest);

  const ergebnis = {
    typ: 'fahrt',
    modus,
    datum: d.datum,
    zeitStart: z.zeiten[0] || null,
    zeitEnde: z.zeiten[1] || null,
    kmStart,
    kmEnde,
    art: artFinden(roh),
    ...felder,
  };

  // Favoriten: Kurzwort im Satz -> leere Felder auffüllen
  for (const fav of opt.favoriten || []) {
    const kurz = (fav.kurz || '').toLowerCase().trim();
    if (!kurz) continue;
    if (enthaeltPhrase(roh, [kurz]) || tokens(roh).includes(kurz)) {
      for (const k of ['ziel', 'zweck', 'partner']) {
        const passt = !ergebnis[k] || ergebnis[k].toLowerCase() === kurz;
        if (fav[k] && passt) ergebnis[k] = fav[k];
      }
      if (fav.art && !ergebnis.art) ergebnis.art = fav.art;
      if (fav.route && !ergebnis.route) ergebnis.route = fav.route;
      // Kurzwort nicht doppelt in anderen Feldern stehen lassen
      for (const k of ['ziel', 'zweck', 'partner']) {
        if (ergebnis[k] && ergebnis[k].toLowerCase() === kurz && fav[k] === undefined) ergebnis[k] = '';
      }
      break;
    }
  }
  return ergebnis;
}

// ---------- Belegtext (z. B. aus Google Lens kopiert) ----------

export function parseBeleg(text, opt = {}) {
  const heute = opt.heute || new Date();
  const zeilen = String(text || '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const klein = zeilen.map((z) => z.toLowerCase());
  const alles = klein.join('\n');

  // Datum
  let datum = null;
  let m = alles.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const x = gueltigesDatum(y, +m[2], +m[1]);
    if (x) datum = isoDate(x);
  } else if ((m = alles.match(/(\d{4})-(\d{2})-(\d{2})/))) {
    const x = gueltigesDatum(+m[1], +m[2], +m[3]);
    if (x) datum = isoDate(x);
  }

  // Liter
  let liter = null;
  m = alles.match(/(\d{1,3}[.,]\d{2,3})\s*(?:l|ltr|liter)(?![\p{L}])/u);
  if (m) liter = Number(m[1].replace(',', '.'));

  // Betrag: Summen-Zeilen bevorzugen
  const betragRe = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})(?![\d])/g;
  const ohneDatum = (z) => z.replace(/(?<!\d)\d{1,2}[./]\d{1,2}[./](\d{4}|\d{2})(?!\d)/g, ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ');
  const summenWoerter = /(summe|gesamt|total|zu zahlen|zahlbetrag|betrag|endbetrag|brutto|ec[- ]?karte|girocard|kartenzahlung|bar\b|visa|mastercard)/;
  let kandidaten = [];
  klein.forEach((z, i) => {
    if (!summenWoerter.test(z)) return;
    const quellen = [ohneDatum(z), ohneDatum(klein[i + 1] || '')];
    for (const q of quellen) {
      const treffer = [...q.matchAll(betragRe)].map((x) => betragZuZahl(x[1].includes(',') ? x[1] : x[1].replace('.', ',')));
      if (treffer.length) { kandidaten.push(...treffer); break; }
    }
  });
  if (!kandidaten.length) {
    kandidaten = [...ohneDatum(alles).matchAll(betragRe)]
      .filter((x) => !/(\/\s*l|je\s*l|eur\/l|€\/l)/.test(ohneDatum(alles).slice(x.index, x.index + 14)))
      .map((x) => betragZuZahl(x[1].includes(',') ? x[1] : x[1].replace('.', ',')));
  }
  const betrag = kandidaten.length ? Math.max(...kandidaten) : null;

  // Kategorie
  let kategorie = null;
  if (/(super|diesel|e10|e5|benzin|kraftstoff|zapfs|säule|saeule|aral|shell|esso|jet\b|totalenergies|avia|agip|omv|orlen|star tank|hem\b|bft|tankstelle|liter|ladestrom|kwh)/.test(alles) || liter) kategorie = 'Tanken';
  else if (/(park|apcoa|contipark|q-park|easypark)/.test(alles)) kategorie = 'Parken';
  else if (/(wasch|wäsche|car ?wash)/.test(alles)) kategorie = 'Autowäsche';
  else if (/(maut|vignette|asfinag|toll)/.test(alles)) kategorie = 'Maut';
  else if (/(reifen)/.test(alles)) kategorie = 'Reifen';
  else if (/(werkstatt|inspektion|kfz|autohaus|atu|ölwechsel)/.test(alles)) kategorie = 'Werkstatt';

  const ort = (zeilen.find((z) => /\p{L}{3,}/u.test(z)) || '').slice(0, 40);

  return {
    typ: 'kosten',
    datum: datum && datum <= isoDate(heute) ? datum : datum,
    kategorie: kategorie || 'Sonstiges',
    betrag,
    liter,
    km: null,
    bezahlt: null,
    ort,
  };
}
