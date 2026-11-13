// Tests für den Sprach-/Beleg-Parser. Ausführen mit: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEingabe, parseBeleg } from '../js/parser.js';

const heute = new Date(2026, 10, 13); // Freitag, 13.11.2026
const p = (t, opt = {}) => parseEingabe(t, { heute, ...opt });

test('Start mit Ziel, Partner und Zweck', () => {
  const r = p('Start 45.230, zu Kundin Meier nach Köln, Beratung');
  assert.equal(r.typ, 'fahrt');
  assert.equal(r.modus, 'start');
  assert.equal(r.kmStart, 45230);
  assert.equal(r.kmEnde, null);
  assert.equal(r.ziel, 'Köln');
  assert.equal(r.partner, 'Kundin Meier');
  assert.equal(r.zweck, 'Beratung');
  assert.equal(r.datum, null);
});

test('Start ohne Satzzeichen (so liefert es die Spracherkennung)', () => {
  const r = p('start 45230 nach köln beratung bei firma lehmann');
  assert.equal(r.kmStart, 45230);
  assert.equal(r.ziel, 'Köln');
  assert.equal(r.zweck, 'Beratung');
  assert.equal(r.partner, 'Firma Lehmann');
});

test('Ankunft', () => {
  const r = p('Ankunft 45.310');
  assert.equal(r.modus, 'ende');
  assert.equal(r.kmEnde, 45310);
  assert.equal(r.kmStart, null);
});

test('Nur eine Zahl -> App entscheidet', () => {
  const r = p('45 310');
  assert.equal(r.modus, 'auto');
  assert.equal(r.kmStart, 45310);
});

test('Nachtrag gestern komplett', () => {
  const r = p('Gestern Start 45.100, Ende 45.180, Bonn, Workshop bei Firma Lehmann');
  assert.equal(r.datum, '2026-11-12');
  assert.equal(r.modus, 'komplett');
  assert.equal(r.kmStart, 45100);
  assert.equal(r.kmEnde, 45180);
  assert.equal(r.ziel, 'Bonn');
  assert.equal(r.zweck, 'Workshop');
  assert.equal(r.partner, 'Firma Lehmann');
});

test('Nachtrag mit Wochentag', () => {
  assert.equal(p('am Dienstag Start 45000 Ende 45050 privat').datum, '2026-11-10');
  assert.equal(p('letzten Freitag 44000 bis 44100 privat').datum, '2026-11-06');
  assert.equal(p('Freitag 44000 bis 44100 privat').datum, '2026-11-13');
});

test('Nachtrag mit Monatsname und Datum', () => {
  assert.equal(p('am 5. November von 44.900 bis 44.980 nach Düsseldorf').datum, '2026-11-05');
  assert.equal(p('5.11. Start 44900 Ende 44980').datum, '2026-11-05');
  assert.equal(p('am 20.12. Start 30000 Ende 30100').datum, '2025-12-20'); // Zukunft -> Vorjahr
  assert.equal(p('am 3.1.2026 Start 30000 Ende 30100').datum, '2026-01-03');
});

test('Zwei Zahlen ohne Schlüsselwörter -> Start und Ende', () => {
  const r = p('vorgestern 44900 44980 Düsseldorf Messe');
  assert.equal(r.datum, '2026-11-11');
  assert.equal(r.kmStart, 44900);
  assert.equal(r.kmEnde, 44980);
  assert.equal(r.ziel, 'Düsseldorf');
  assert.equal(r.zweck, 'Messe');
});

test('Fahrtart', () => {
  assert.equal(p('start 45000 privat').art, 'privat');
  assert.equal(p('start 45000 zur arbeit').art, 'arbeitsweg');
  assert.equal(p('start 45000 arbeitsweg').art, 'arbeitsweg');
  assert.equal(p('start 45000 nach köln').art, null);
});

test('Uhrzeiten', () => {
  const r = p('gestern von 8:15 bis 9:30 Uhr Start 45100 Ende 45180 Bonn');
  assert.equal(r.zeitStart, '08:15');
  assert.equal(r.zeitEnde, '09:30');
  assert.equal(r.kmStart, 45100);
  assert.equal(r.kmEnde, 45180);
});

test('Umweg/Route', () => {
  const r = p('start 45000 nach köln über a3 wegen stau');
  assert.equal(r.ziel, 'Köln');
  assert.ok(r.route.toLowerCase().includes('a3'));
});

test('Favorit füllt Felder', () => {
  const favoriten = [{ kurz: 'meier', ziel: 'Köln, Hauptstr. 5', zweck: 'Beratung', partner: 'Kundin Meier' }];
  const r = p('Start 45230 Meier', { favoriten });
  assert.equal(r.ziel, 'Köln, Hauptstr. 5');
  assert.equal(r.partner, 'Kundin Meier');
  assert.equal(r.zweck, 'Beratung');
});

test('Zahlwörter', () => {
  const r = p('getankt fünfundvierzig liter zweiundachtzig euro fünfzig');
  assert.equal(r.liter, 45);
  assert.equal(r.betrag, 82.5);
});

// ---------- Kosten ----------

test('Tanken komplett', () => {
  const r = p('Getankt, 45 Liter, 82,50 Euro, km 45.300, privat bezahlt');
  assert.equal(r.typ, 'kosten');
  assert.equal(r.kategorie, 'Tanken');
  assert.equal(r.betrag, 82.5);
  assert.equal(r.liter, 45);
  assert.equal(r.km, 45300);
  assert.equal(r.bezahlt, 'privat');
});

test('Tanken mit Komma-Litern und Euro-Cent gesprochen', () => {
  const r = p('getankt 41,7 liter 76 euro 30 kilometerstand 45 812');
  assert.equal(r.liter, 41.7);
  assert.equal(r.betrag, 76.3);
  assert.equal(r.km, 45812);
});

test('Parken mit Ort', () => {
  const r = p('Parken 6 Euro Köln');
  assert.equal(r.kategorie, 'Parken');
  assert.equal(r.betrag, 6);
  assert.equal(r.ort, 'Köln');
  assert.equal(r.bezahlt, null);
});

test('Autowäsche nachgeholt', () => {
  const r = p('gestern Autowäsche 15 Euro Firmenkarte');
  assert.equal(r.kategorie, 'Autowäsche');
  assert.equal(r.betrag, 15);
  assert.equal(r.datum, '2026-11-12');
  assert.equal(r.bezahlt, 'firma');
});

test('Gestern getankt', () => {
  const r = p('Gestern getankt, 40 Liter, 71 Euro');
  assert.equal(r.datum, '2026-11-12');
  assert.equal(r.liter, 40);
  assert.equal(r.betrag, 71);
});

test('Werkstatt mit Tausenderbetrag', () => {
  const r = p('Inspektion 1.250,00 €');
  assert.equal(r.kategorie, 'Werkstatt');
  assert.equal(r.betrag, 1250);
});

// ---------- Belegtext ----------

test('Tankbeleg aus Lens', () => {
  const beleg = `ARAL Tankstelle
Kölner Str. 12
50667 Köln
Säule 4 Super E10
42,35 l x 1,789 EUR/l
EUR 75,76
Summe EUR 75,76
Girocard 75,76
Datum: 12.11.2026 14:32
MwSt 19% 12,10`;
  const r = parseBeleg(beleg, { heute });
  assert.equal(r.kategorie, 'Tanken');
  assert.equal(r.betrag, 75.76);
  assert.equal(r.liter, 42.35);
  assert.equal(r.datum, '2026-11-12');
  assert.equal(r.ort, 'ARAL Tankstelle');
});

test('Parkbeleg aus Lens', () => {
  const beleg = `Contipark Parkhaus Dom
Einfahrt 13.11.26 09:02
Ausfahrt 13.11.26 11:40
Parkdauer 2:38
Betrag 7,50 EUR`;
  const r = parseBeleg(beleg, { heute });
  assert.equal(r.kategorie, 'Parken');
  assert.equal(r.betrag, 7.5);
  assert.equal(r.datum, '2026-11-13');
});
