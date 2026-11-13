// Tests für Regeln, Protokoll und Auswertung. Ausführen mit: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import { isoDate } from '../js/parser.js';

const gestern = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDate(d); })();

test('Start und Ankunft, Nachtrag-Kennzeichen', () => {
  const db = S.leereDaten();
  const f = S.fahrtAnlegen(db, { kmStart: 45230, ziel: 'Köln', zweck: 'Beratung', partner: 'Meier' }, { modus: 'start' });
  assert.equal(f.status, 'offen');
  assert.equal(f.nachtrag, false);
  assert.throws(() => S.fahrtAnlegen(db, { kmStart: 45300 }, { modus: 'start' }), /andere Fahrt/);
  S.fahrtBeenden(db, f.id, { kmEnde: 45310 });
  assert.equal(f.status, 'abgeschlossen');
  assert.equal(S.letzterKmStand(db), 45310);
  const n = S.fahrtAnlegen(db, { datum: gestern, kmStart: 45100, kmEnde: 45180, art: 'privat' }, { modus: 'komplett' });
  assert.equal(n.nachtrag, true);
});

test('km Ende muss größer als Start sein', () => {
  const db = S.leereDaten();
  assert.throws(() => S.fahrtAnlegen(db, { kmStart: 100, kmEnde: 90 }, { modus: 'komplett' }), /größer/);
});

test('Lücken und Überschneidungen', () => {
  const db = S.leereDaten();
  S.fahrtAnlegen(db, { datum: '2026-11-01', kmStart: 1000, kmEnde: 1100, art: 'privat' }, { modus: 'komplett' });
  S.fahrtAnlegen(db, { datum: '2026-11-02', kmStart: 1150, kmEnde: 1200, art: 'privat' }, { modus: 'komplett' });
  S.fahrtAnlegen(db, { datum: '2026-11-03', kmStart: 1190, kmEnde: 1250, art: 'privat' }, { modus: 'komplett' });
  const l = S.lueckenFinden(db);
  assert.equal(l.length, 2);
  assert.equal(l[0].typ, 'luecke');
  assert.equal(l[0].bis - l[0].von, 50);
  assert.equal(l[1].typ, 'ueberschneidung');
  const w = S.fahrtWarnungen(db, { datum: '2026-11-04', kmStart: 1300, kmEnde: 1350, art: 'privat' });
  assert.ok(w.some((x) => x.includes('Lücke: 50')));
});

test('Korrektur wird protokolliert, Storno braucht Grund', () => {
  const db = S.leereDaten();
  const f = S.fahrtAnlegen(db, { datum: '2026-11-01', kmStart: 1000, kmEnde: 1100, art: 'privat' }, { modus: 'komplett' });
  S.fahrtAendern(db, f.id, { kmEnde: 1010 }, 'Zahlendreher');
  const h = f.historie.at(-1);
  assert.equal(h.aktion, 'geaendert');
  assert.deepEqual(h.aenderungen, [{ feld: 'kmEnde', alt: 1100, neu: 1010 }]);
  assert.equal(h.grund, 'Zahlendreher');
  assert.throws(() => S.fahrtStornieren(db, f.id, ''), /Grund/);
  S.fahrtStornieren(db, f.id, 'doppelt erfasst');
  assert.equal(f.status, 'storniert');
  assert.equal(db.fahrten.length, 1); // nichts gelöscht
});

test('Belegnummern lückenlos, Storno behält Nummer', () => {
  const db = S.leereDaten();
  const a = S.kostenAnlegen(db, { datum: '2026-11-01', kategorie: 'Tanken', betrag: 80 });
  const b = S.kostenAnlegen(db, { datum: '2026-11-02', kategorie: 'Parken', betrag: 6 });
  S.kostenStornieren(db, b.id, 'falsch');
  const c = S.kostenAnlegen(db, { datum: '2026-11-03', kategorie: 'Autowäsche', betrag: 15 });
  assert.deepEqual([a.nr, b.nr, c.nr], ['B-2026-001', 'B-2026-002', 'B-2026-003']);
  const d = S.kostenAnlegen(db, { datum: '2025-12-30', kategorie: 'Parken', betrag: 4 });
  assert.equal(d.nr, 'B-2025-001');
});

test('Erstattung', () => {
  const db = S.leereDaten();
  const k = S.kostenAnlegen(db, { datum: '2026-11-01', kategorie: 'Tanken', betrag: 80, bezahlt: 'privat' });
  assert.equal(S.offenZuErstatten(db).length, 1);
  S.kostenErstattet(db, k.id, '2026-11-05');
  assert.equal(S.offenZuErstatten(db).length, 0);
  assert.equal(k.historie.at(-1).aktion, 'erstattet');
});

test('Monatsabschluss sperrt Änderungen und Nachträge', () => {
  const db = S.leereDaten();
  const f = S.fahrtAnlegen(db, { datum: '2026-10-10', kmStart: 1000, kmEnde: 1100, art: 'privat' }, { modus: 'komplett' });
  S.monatAbschliessen(db, '2026-10');
  assert.throws(() => S.fahrtAendern(db, f.id, { kmEnde: 1050 }), /abgeschlossen/);
  assert.throws(() => S.fahrtStornieren(db, f.id, 'x'), /abgeschlossen/);
  assert.throws(() => S.fahrtAnlegen(db, { datum: '2026-10-11', kmStart: 1100, kmEnde: 1200 }, { modus: 'komplett' }), /abgeschlossen/);
  assert.throws(() => S.kostenAnlegen(db, { datum: '2026-10-11', kategorie: 'Parken', betrag: 3 }), /abgeschlossen/);
});

test('Auswertung: AfA, Fixkosten, Privatanteil', () => {
  const db = S.leereDaten();
  db.fahrzeug = { bezeichnung: 'Test', kennzeichen: '', kaufpreis: 36000, kaufdatum: '2024-03-15', nutzungsdauer: 6 };
  db.fixkosten.push({ id: 'v', bezeichnung: 'Versicherung', betrag: 1200, turnus: 'jaehrlich', ab: '', bis: '' });
  S.fahrtAnlegen(db, { datum: '2026-01-10', kmStart: 1000, kmEnde: 1800, art: 'geschaeftlich', ziel: 'a', zweck: 'b' }, { modus: 'komplett' });
  S.fahrtAnlegen(db, { datum: '2026-01-11', kmStart: 1800, kmEnde: 2000, art: 'privat' }, { modus: 'komplett' });
  S.kostenAnlegen(db, { datum: '2026-01-12', kategorie: 'Tanken', betrag: 100 });
  const a = S.auswertung(db, '2026-01');
  assert.equal(a.kmGesamt, 1000);
  assert.equal(a.afa, 500); // 36000 / 72 Monate
  assert.equal(a.fix, 100); // 1200 / 12
  assert.equal(a.gesamt, 700);
  assert.equal(a.anteilPrivat, 0.2);
  assert.equal(a.kostenPrivat, 140);
  // AfA endet nach 72 Monaten (Feb 2030 ist der letzte Monat)
  assert.equal(S.afaProMonat(db.fahrzeug, '2030-02'), 500);
  assert.equal(S.afaProMonat(db.fahrzeug, '2030-03'), 0);
  assert.equal(S.afaProMonat(db.fahrzeug, '2024-02'), 0);
});

test('Jahresauswertung rechnet Fixkosten erst ab Fahrtenbuch-Beginn', () => {
  const db = S.leereDaten();
  db.fixkosten.push({ id: 'v', bezeichnung: 'Versicherung', betrag: 1200, turnus: 'jaehrlich', ab: '', bis: '' });
  S.fahrtAnlegen(db, { datum: '2025-11-10', kmStart: 1000, kmEnde: 1100, art: 'privat' }, { modus: 'komplett' });
  const a = S.auswertung(db, '2025');
  assert.deepEqual(a.monate, ['2025-11', '2025-12']);
  assert.equal(a.fix, 200);
});

test('CSV hat BOM und Semikolons', () => {
  const db = S.leereDaten();
  S.kostenAnlegen(db, { datum: '2026-11-01', kategorie: 'Tanken', betrag: 82.5, liter: 45, ort: 'Aral; Köln' });
  const csv = S.kostenCsv(db, '2026');
  assert.ok(csv.startsWith('﻿Beleg-Nr.;'));
  assert.ok(csv.includes('82,50'));
  assert.ok(csv.includes('"Aral; Köln"'));
});
