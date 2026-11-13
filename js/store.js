// Datenhaltung und Regeln des Fahrtenbuchs.
// Alle Daten liegen nur im Browser-Speicher dieses Geräts (localStorage).
// Grundsatz: nichts wird gelöscht oder still überschrieben – jede Änderung landet im Protokoll.

import { isoDate } from './parser.js';

const KEY = 'fahrtenbuch-daten-v1';

export const ARTEN = {
  geschaeftlich: 'Geschäftlich',
  privat: 'Privat',
  arbeitsweg: 'Arbeitsweg',
};

export const KATEGORIEN = ['Tanken', 'Parken', 'Autowäsche', 'Maut', 'Werkstatt', 'Reifen', 'Sonstiges'];

export const TURNUS = { monatlich: 1, vierteljaehrlich: 3, jaehrlich: 12 };

export const FAHRT_FELDER = {
  datum: 'Datum', zeitStart: 'Abfahrt', zeitEnde: 'Ankunft', kmStart: 'km Start', kmEnde: 'km Ende', art: 'Fahrtart',
  ziel: 'Reiseziel', zweck: 'Reisezweck', partner: 'Geschäftspartner', route: 'Route/Umweg',
};
export const KOSTEN_FELDER = {
  datum: 'Datum', kategorie: 'Kategorie', betrag: 'Betrag', liter: 'Liter', km: 'km-Stand', bezahlt: 'Bezahlt',
  ort: 'Ort/Notiz', fahrtId: 'Fahrt',
};

export function leereDaten() {
  return {
    version: 1,
    fahrzeug: { bezeichnung: '', kennzeichen: '', kaufpreis: null, kaufdatum: '', nutzungsdauer: 6 },
    fixkosten: [],
    favoriten: [],
    fahrten: [],
    kosten: [],
    abschluesse: [], // { monat: 'YYYY-MM', am: ISO-Zeitstempel }
    belegZaehler: {}, // { '2026': 14 }
    einstellungen: { standardBezahlt: 'firma', letzteSicherung: null },
  };
}

export function laden() {
  try {
    const roh = localStorage.getItem(KEY);
    if (!roh) return leereDaten();
    return { ...leereDaten(), ...JSON.parse(roh) };
  } catch {
    return leereDaten();
  }
}

export function speichern(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function neueId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}

export const jetztIso = () => new Date().toISOString();
export const heuteIso = () => isoDate(new Date());
export const jetztZeit = () => new Date().toTimeString().slice(0, 5);

// ---------- Monatsabschluss ----------

export function monatGesperrt(db, datum) {
  return !!datum && db.abschluesse.some((a) => a.monat === datum.slice(0, 7));
}

export function monatAbschliessen(db, monat) {
  const offen = db.fahrten.find((f) => f.status === 'offen' && f.datum.slice(0, 7) <= monat);
  if (offen) throw new Error('In diesem Monat läuft noch eine offene Fahrt. Bitte erst beenden.');
  if (db.abschluesse.some((a) => a.monat === monat)) return;
  db.abschluesse.push({ monat, am: jetztIso() });
  db.abschluesse.sort((a, b) => a.monat.localeCompare(b.monat));
}

function sperrePruefen(db, ...daten) {
  for (const d of daten) {
    if (monatGesperrt(db, d)) throw new Error(`Der Monat ${d.slice(5, 7)}/${d.slice(0, 4)} ist abgeschlossen und kann nicht mehr geändert werden.`);
  }
}

// ---------- Protokoll-Helfer ----------

function eintrag(aktion, extra = {}) {
  return { am: jetztIso(), aktion, ...extra };
}

function aenderungenErmitteln(alt, neu, felder) {
  const liste = [];
  for (const k of Object.keys(felder)) {
    if (!(k in neu)) continue;
    const a = alt[k] ?? null, n = neu[k] ?? null;
    if (String(a ?? '') !== String(n ?? '')) liste.push({ feld: k, alt: a, neu: n });
  }
  return liste;
}

// ---------- Fahrten ----------

export const aktiveFahrten = (db) => db.fahrten.filter((f) => f.status !== 'storniert');
export const offeneFahrt = (db) => db.fahrten.find((f) => f.status === 'offen') || null;

export function letzterKmStand(db) {
  let max = null;
  for (const f of aktiveFahrten(db)) {
    const k = f.kmEnde ?? f.kmStart;
    if (k != null && (max === null || k > max)) max = k;
  }
  return max;
}

function fahrtNormalisieren(d) {
  const zahl = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
  return {
    datum: d.datum || heuteIso(),
    zeitStart: d.zeitStart || '',
    zeitEnde: d.zeitEnde || '',
    kmStart: zahl(d.kmStart),
    kmEnde: zahl(d.kmEnde),
    art: d.art || 'geschaeftlich',
    ziel: (d.ziel || '').trim(),
    zweck: (d.zweck || '').trim(),
    partner: (d.partner || '').trim(),
    route: (d.route || '').trim(),
  };
}

export function fahrtFehler(db, d, { modus, id } = {}) {
  const f = fahrtNormalisieren(d);
  const fehler = [];
  if (f.kmStart == null) fehler.push('km-Stand bei Start fehlt.');
  if (modus !== 'start' && f.kmEnde == null) fehler.push('km-Stand bei Ankunft fehlt.');
  if (f.kmStart != null && f.kmEnde != null && f.kmEnde <= f.kmStart) fehler.push('km Ende muss größer sein als km Start.');
  if (f.datum > heuteIso()) fehler.push('Das Datum liegt in der Zukunft.');
  if (monatGesperrt(db, f.datum)) fehler.push('Dieser Monat ist abgeschlossen.');
  if (modus === 'start') {
    const offen = offeneFahrt(db);
    if (offen && offen.id !== id) fehler.push('Es läuft noch eine andere Fahrt. Bitte die erst beenden.');
  }
  return fehler;
}

export function fahrtWarnungen(db, d, { id } = {}) {
  const f = fahrtNormalisieren(d);
  const w = [];
  if (f.art === 'geschaeftlich') {
    if (!f.ziel) w.push('Reiseziel fehlt (Pflicht bei Geschäftsfahrten).');
    if (!f.zweck) w.push('Reisezweck fehlt (Pflicht bei Geschäftsfahrten).');
    if (!f.partner) w.push('Geschäftspartner fehlt (Pflicht, falls du jemanden besucht hast).');
  }
  if (f.kmStart != null && f.kmEnde != null && f.kmEnde - f.kmStart > 1500) w.push(`Ungewöhnlich lange Fahrt: ${f.kmEnde - f.kmStart} km. Zahlen prüfen?`);
  const andere = aktiveFahrten(db).filter((x) => x.id !== id);
  const ende = f.kmEnde ?? f.kmStart;
  if (f.kmStart != null) {
    for (const x of andere) {
      const xEnde = x.kmEnde ?? x.kmStart;
      if (f.kmStart < xEnde && ende > x.kmStart) {
        w.push(`Überschneidet sich mit der Fahrt vom ${fmtD(x.datum)} (${fmtKm(x.kmStart)}–${fmtKm(xEnde)}).`);
        break;
      }
    }
    const vorher = andere.filter((x) => (x.kmEnde ?? x.kmStart) <= f.kmStart).sort((a, b) => (b.kmEnde ?? b.kmStart) - (a.kmEnde ?? a.kmStart))[0];
    if (vorher && vorher.kmEnde != null && vorher.kmEnde < f.kmStart) w.push(`Lücke: ${fmtKm(f.kmStart - vorher.kmEnde)} km seit der Fahrt vom ${fmtD(vorher.datum)}.`);
    if (vorher && vorher.datum > f.datum) w.push(`Datum passt nicht: Die Fahrt mit niedrigerem km-Stand ist vom ${fmtD(vorher.datum)}.`);
    const nachher = andere.filter((x) => x.kmStart >= ende).sort((a, b) => a.kmStart - b.kmStart)[0];
    if (nachher && f.kmEnde != null && nachher.kmStart > f.kmEnde) w.push(`Lücke: ${fmtKm(nachher.kmStart - f.kmEnde)} km bis zur Fahrt vom ${fmtD(nachher.datum)}.`);
    if (nachher && nachher.datum < f.datum) w.push(`Datum passt nicht: Die Fahrt mit höherem km-Stand ist vom ${fmtD(nachher.datum)}.`);
  }
  return w;
}

export function fahrtAnlegen(db, d, { modus, quelle, text } = {}) {
  const fehler = fahrtFehler(db, d, { modus });
  if (fehler.length) throw new Error(fehler.join(' '));
  const f = fahrtNormalisieren(d);
  const jetzt = jetztIso();
  const fahrt = {
    id: neueId(),
    ...f,
    status: modus === 'start' ? 'offen' : 'abgeschlossen',
    erfasstAm: jetzt,
    nachtrag: f.datum < heuteIso(),
    quelle: quelle || 'tippen',
    historie: [eintrag('angelegt', { text: text || undefined })],
  };
  if (modus === 'start') fahrt.kmEnde = null;
  db.fahrten.push(fahrt);
  return fahrt;
}

export function fahrtBeenden(db, id, d, { text } = {}) {
  const fahrt = db.fahrten.find((x) => x.id === id);
  if (!fahrt || fahrt.status !== 'offen') throw new Error('Keine offene Fahrt gefunden.');
  const fehler = fahrtFehler(db, { ...fahrt, ...d }, { id });
  if (fehler.length) throw new Error(fehler.join(' '));
  const neu = fahrtNormalisieren({ ...fahrt, ...d });
  const aenderungen = aenderungenErmitteln(fahrt, neu, FAHRT_FELDER).filter((a) => a.feld !== 'kmEnde' && a.feld !== 'zeitEnde');
  Object.assign(fahrt, neu, { status: 'abgeschlossen', beendetAm: jetztIso() });
  fahrt.historie.push(eintrag('beendet', { text: text || undefined, aenderungen: aenderungen.length ? aenderungen : undefined }));
  return fahrt;
}

export function fahrtAendern(db, id, d, grund) {
  const fahrt = db.fahrten.find((x) => x.id === id);
  if (!fahrt) throw new Error('Fahrt nicht gefunden.');
  if (fahrt.status === 'storniert') throw new Error('Stornierte Fahrten können nicht geändert werden.');
  sperrePruefen(db, fahrt.datum, d.datum || fahrt.datum);
  const modus = fahrt.status === 'offen' ? 'start' : undefined;
  const fehler = fahrtFehler(db, { ...fahrt, ...d }, { modus, id });
  if (fehler.length) throw new Error(fehler.join(' '));
  const neu = fahrtNormalisieren({ ...fahrt, ...d });
  if (modus === 'start') neu.kmEnde = null;
  const aenderungen = aenderungenErmitteln(fahrt, neu, FAHRT_FELDER);
  if (!aenderungen.length) return fahrt;
  Object.assign(fahrt, neu);
  fahrt.historie.push(eintrag('geaendert', { aenderungen, grund: grund || undefined }));
  return fahrt;
}

export function fahrtStornieren(db, id, grund) {
  const fahrt = db.fahrten.find((x) => x.id === id);
  if (!fahrt) throw new Error('Fahrt nicht gefunden.');
  if (!grund || !grund.trim()) throw new Error('Bitte einen Grund für die Stornierung angeben.');
  sperrePruefen(db, fahrt.datum);
  fahrt.status = 'storniert';
  fahrt.historie.push(eintrag('storniert', { grund: grund.trim() }));
}

// Lücken und Überschneidungen über alle abgeschlossenen Fahrten (sortiert nach km)
export function lueckenFinden(db) {
  const fs = aktiveFahrten(db).filter((f) => f.kmEnde != null).sort((a, b) => a.kmStart - b.kmStart);
  const liste = [];
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1], b = fs[i];
    if (b.kmStart > a.kmEnde) liste.push({ typ: 'luecke', von: a.kmEnde, bis: b.kmStart, nachFahrt: a, vorFahrt: b });
    else if (b.kmStart < a.kmEnde) liste.push({ typ: 'ueberschneidung', von: b.kmStart, bis: a.kmEnde, nachFahrt: a, vorFahrt: b });
  }
  return liste;
}

// ---------- Kosten ----------

export const aktiveKosten = (db) => db.kosten.filter((k) => k.status !== 'storniert');

function kostenNormalisieren(d) {
  const zahl = (v, stellen) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    if (Number.isNaN(n)) return null;
    const f = 10 ** stellen;
    return Math.round(n * f) / f;
  };
  return {
    datum: d.datum || heuteIso(),
    kategorie: KATEGORIEN.includes(d.kategorie) ? d.kategorie : 'Sonstiges',
    betrag: zahl(d.betrag, 2),
    liter: zahl(d.liter, 2),
    km: zahl(d.km, 0),
    bezahlt: d.bezahlt === 'privat' ? 'privat' : 'firma',
    ort: (d.ort || '').trim(),
    fahrtId: d.fahrtId || null,
  };
}

export function kostenFehler(db, d) {
  const k = kostenNormalisieren(d);
  const fehler = [];
  if (k.betrag == null || k.betrag <= 0) fehler.push('Betrag fehlt.');
  if (k.datum > heuteIso()) fehler.push('Das Datum liegt in der Zukunft.');
  if (monatGesperrt(db, k.datum)) fehler.push('Dieser Monat ist abgeschlossen.');
  return fehler;
}

export function kostenAnlegen(db, d, { quelle, text } = {}) {
  const fehler = kostenFehler(db, d);
  if (fehler.length) throw new Error(fehler.join(' '));
  const k = kostenNormalisieren(d);
  const jahr = k.datum.slice(0, 4);
  const lfd = (db.belegZaehler[jahr] || 0) + 1;
  db.belegZaehler[jahr] = lfd;
  const kosten = {
    id: neueId(),
    nr: `B-${jahr}-${String(lfd).padStart(3, '0')}`,
    ...k,
    status: 'aktiv',
    erstattetAm: null,
    erfasstAm: jetztIso(),
    nachtrag: k.datum < heuteIso(),
    quelle: quelle || 'tippen',
    historie: [eintrag('angelegt', { text: text || undefined })],
  };
  db.kosten.push(kosten);
  return kosten;
}

export function kostenAendern(db, id, d, grund) {
  const k = db.kosten.find((x) => x.id === id);
  if (!k) throw new Error('Ausgabe nicht gefunden.');
  if (k.status === 'storniert') throw new Error('Stornierte Ausgaben können nicht geändert werden.');
  sperrePruefen(db, k.datum, d.datum || k.datum);
  const neu = kostenNormalisieren({ ...k, ...d });
  if (neu.datum.slice(0, 4) !== k.datum.slice(0, 4)) throw new Error('Das Jahr kann nicht geändert werden (Belegnummer). Bitte stornieren und neu erfassen.');
  const fehler = kostenFehler(db, neu);
  if (fehler.length) throw new Error(fehler.join(' '));
  const aenderungen = aenderungenErmitteln(k, neu, KOSTEN_FELDER);
  if (!aenderungen.length) return k;
  Object.assign(k, neu);
  k.historie.push(eintrag('geaendert', { aenderungen, grund: grund || undefined }));
  return k;
}

export function kostenStornieren(db, id, grund) {
  const k = db.kosten.find((x) => x.id === id);
  if (!k) throw new Error('Ausgabe nicht gefunden.');
  if (!grund || !grund.trim()) throw new Error('Bitte einen Grund für die Stornierung angeben.');
  sperrePruefen(db, k.datum);
  k.status = 'storniert';
  k.historie.push(eintrag('storniert', { grund: grund.trim() }));
}

export function kostenErstattet(db, id, datum) {
  const k = db.kosten.find((x) => x.id === id);
  if (!k || k.bezahlt !== 'privat' || k.status === 'storniert') return;
  k.erstattetAm = datum || heuteIso();
  k.historie.push(eintrag('erstattet', { datum: k.erstattetAm }));
}

export function kostenErstattungZuruecknehmen(db, id) {
  const k = db.kosten.find((x) => x.id === id);
  if (!k || !k.erstattetAm) return;
  k.historie.push(eintrag('erstattung-zurueckgenommen', { datum: k.erstattetAm }));
  k.erstattetAm = null;
}

export const offenZuErstatten = (db) => aktiveKosten(db).filter((k) => k.bezahlt === 'privat' && !k.erstattetAm);

// ---------- Auswertung ----------

export function monateImZeitraum(zeitraum) {
  // zeitraum: 'YYYY' oder 'YYYY-MM'
  if (zeitraum.length === 7) return [zeitraum];
  const jetzt = heuteIso().slice(0, 7);
  const monate = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `${zeitraum}-${String(m).padStart(2, '0')}`;
    if (mm > jetzt) break;
    monate.push(mm);
  }
  return monate;
}

export function afaProMonat(fahrzeug, monat) {
  const { kaufpreis, kaufdatum, nutzungsdauer } = fahrzeug;
  if (!kaufpreis || !kaufdatum || !nutzungsdauer) return 0;
  const start = kaufdatum.slice(0, 7);
  const [y, m] = start.split('-').map(Number);
  const endIdx = y * 12 + (m - 1) + nutzungsdauer * 12 - 1;
  const [my, mm] = monat.split('-').map(Number);
  const idx = my * 12 + (mm - 1);
  if (monat < start || idx > endIdx) return 0;
  return kaufpreis / (nutzungsdauer * 12);
}

export function fixkostenProMonat(db, monat) {
  let summe = 0;
  for (const f of db.fixkosten) {
    if (f.ab && monat < f.ab) continue;
    if (f.bis && monat > f.bis) continue;
    summe += (Number(f.betrag) || 0) / (TURNUS[f.turnus] || 12);
  }
  return summe;
}

export function fahrtenbuchBeginn(db) {
  const monate = aktiveFahrten(db).map((f) => f.datum.slice(0, 7)).sort();
  return monate[0] || null;
}

export function auswertung(db, zeitraum) {
  // Fixkosten und AfA erst ab dem ersten Fahrtenbuch-Monat, sonst verzerrt sich der Privatanteil
  const beginn = fahrtenbuchBeginn(db);
  const monate = monateImZeitraum(zeitraum).filter((m) => !beginn || m >= beginn);
  const imZeitraum = (datum) => monate.includes(datum.slice(0, 7));
  const fahrten = aktiveFahrten(db).filter((f) => f.status === 'abgeschlossen' && imZeitraum(f.datum));
  const km = { geschaeftlich: 0, privat: 0, arbeitsweg: 0 };
  for (const f of fahrten) km[f.art] = (km[f.art] || 0) + (f.kmEnde - f.kmStart);
  const kmGesamt = km.geschaeftlich + km.privat + km.arbeitsweg;

  const kosten = aktiveKosten(db).filter((k) => imZeitraum(k.datum));
  const nachKategorie = {};
  for (const kat of KATEGORIEN) nachKategorie[kat] = 0;
  for (const k of kosten) nachKategorie[k.kategorie] += k.betrag;
  const laufend = Object.values(nachKategorie).reduce((a, b) => a + b, 0);
  const fix = monate.reduce((s, m) => s + fixkostenProMonat(db, m), 0);
  const afa = monate.reduce((s, m) => s + afaProMonat(db.fahrzeug, m), 0);
  const gesamt = laufend + fix + afa;

  // Verbrauch aus Tankvorgängen mit km-Stand
  const tank = aktiveKosten(db).filter((k) => k.kategorie === 'Tanken' && k.km && k.liter).sort((a, b) => a.km - b.km);
  let liter = 0, strecke = 0;
  for (let i = 1; i < tank.length; i++) {
    if (!imZeitraum(tank[i].datum)) continue;
    liter += tank[i].liter;
    strecke += tank[i].km - tank[i - 1].km;
  }

  return {
    monate,
    fahrtenAnzahl: fahrten.length,
    km, kmGesamt,
    nachKategorie, laufend, fix, afa, gesamt,
    anteilPrivat: kmGesamt ? km.privat / kmGesamt : 0,
    anteilArbeitsweg: kmGesamt ? km.arbeitsweg / kmGesamt : 0,
    kostenPrivat: kmGesamt ? gesamt * km.privat / kmGesamt : 0,
    kostenArbeitsweg: kmGesamt ? gesamt * km.arbeitsweg / kmGesamt : 0,
    proKm: kmGesamt ? gesamt / kmGesamt : 0,
    verbrauch: strecke > 0 ? liter / strecke * 100 : null,
    offenErstattung: offenZuErstatten(db).reduce((s, k) => s + k.betrag, 0),
  };
}

export function zeitraeume(db) {
  const monate = new Set();
  for (const f of db.fahrten) monate.add(f.datum.slice(0, 7));
  for (const k of db.kosten) monate.add(k.datum.slice(0, 7));
  monate.add(heuteIso().slice(0, 7));
  const sortiert = [...monate].sort().reverse();
  const jahre = [...new Set(sortiert.map((m) => m.slice(0, 4)))];
  return { monate: sortiert, jahre };
}

// ---------- Export ----------

const fmtD = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const fmtKm = (n) => (n == null ? '' : Number(n).toLocaleString('de-DE'));
const zahlDe = (n, stellen = 2) => (n == null ? '' : Number(n).toFixed(stellen).replace('.', ','));
const zeitstempel = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '');

function csv(zeilen) {
  const zelle = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + zeilen.map((z) => z.map(zelle).join(';')).join('\r\n');
}

export function fahrtenCsv(db, zeitraum) {
  const monate = zeitraum ? monateImZeitraum(zeitraum) : null;
  const fs = db.fahrten.filter((f) => !monate || monate.includes(f.datum.slice(0, 7))).sort((a, b) => (a.kmStart - b.kmStart) || a.datum.localeCompare(b.datum));
  const zeilen = [['Datum', 'Abfahrt', 'Ankunft', 'km Start', 'km Ende', 'km', 'Fahrtart', 'Reiseziel', 'Reisezweck', 'Geschäftspartner', 'Route/Umweg', 'Status', 'Erfasst am', 'Nachtrag', 'Änderungen']];
  for (const f of fs) {
    zeilen.push([fmtD(f.datum), f.zeitStart, f.zeitEnde, f.kmStart, f.kmEnde ?? '', f.kmEnde != null ? f.kmEnde - f.kmStart : '', ARTEN[f.art], f.ziel, f.zweck, f.partner, f.route,
      f.status, zeitstempel(f.erfasstAm), f.nachtrag ? 'ja' : 'nein', f.historie.filter((h) => h.aktion === 'geaendert' || h.aktion === 'storniert').length]);
  }
  return csv(zeilen);
}

export function kostenCsv(db, zeitraum) {
  const monate = zeitraum ? monateImZeitraum(zeitraum) : null;
  const ks = db.kosten.filter((k) => !monate || monate.includes(k.datum.slice(0, 7))).sort((a, b) => a.nr.localeCompare(b.nr));
  const zeilen = [['Beleg-Nr.', 'Datum', 'Kategorie', 'Betrag EUR', 'Liter', 'km-Stand', 'Bezahlt', 'Erstattet am', 'Ort/Notiz', 'Status', 'Erfasst am', 'Nachtrag']];
  for (const k of ks) {
    zeilen.push([k.nr, fmtD(k.datum), k.kategorie, zahlDe(k.betrag), k.liter != null ? zahlDe(k.liter) : '', k.km ?? '', k.bezahlt === 'privat' ? 'privat ausgelegt' : 'Firma',
      fmtD(k.erstattetAm), k.ort, k.status, zeitstempel(k.erfasstAm), k.nachtrag ? 'ja' : 'nein']);
  }
  return csv(zeilen);
}

export function sicherungErstellen(db) {
  return JSON.stringify({ app: 'fahrtenbuch', version: 1, exportiertAm: jetztIso(), daten: db }, null, 2);
}

export function sicherungLesen(text) {
  const obj = JSON.parse(text);
  if (obj.app !== 'fahrtenbuch' || !obj.daten || !Array.isArray(obj.daten.fahrten)) throw new Error('Das ist keine Fahrtenbuch-Sicherung.');
  return { ...leereDaten(), ...obj.daten };
}

export const format = { fmtD, fmtKm, zahlDe, zeitstempel };
