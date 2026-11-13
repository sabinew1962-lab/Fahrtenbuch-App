---
tags:
  - fahrtenbuch
  - app
status: entwurf
erstellt_von: claude
created: 2026-11-13
---

# Fahrtenbuch-App

Fahrtenbuch für den Firmenwagen, das du auf dem Android-Handy per Sprache fütterst:
km-Stand beim Start und bei der Ankunft einsprechen, Fahrten nachholen, Kosten
(Tanken, Parken, Autowäsche …) erfassen und am Ende den Privatanteil ausrechnen.

**Alle Daten bleiben auf deinem Handy.** Im Repo liegt nur der Programmcode,
keine Fahrten und keine Kosten. Deshalb darf das Repo öffentlich sein (nötig für
kostenloses GitHub Pages).

## Funktionen

- Spracheingabe (Chrome-Spracherkennung) oder Tippen/Diktieren über die Tastatur
- Fahrt starten / Ankunft / komplett nachtragen (gestern, am Dienstag, am 5. November …)
- Fahrtart geschäftlich, privat, Arbeitsweg mit den jeweiligen Pflichtangaben
- Prüfung auf Lücken und Überschneidungen im km-Verlauf
- Nichts wird gelöscht: Korrekturen und Stornos landen mit Zeitstempel im Protokoll,
  Nachträge sind gekennzeichnet
- Monatsabschluss: Monat sperren und als PDF speichern
- Kosten mit fortlaufender Belegnummer (B-JJJJ-NNN) zum Aufschreiben auf den Papierbeleg,
  Belegtext aus Google Lens einfügen, „privat ausgelegt“ inkl. Erstattung
- Fixkosten und AfA, Auswertung mit Privatanteil (Fahrtenbuchmethode)
- Export als CSV und PDF, Sicherung/Wiederherstellung als JSON-Datei
- Funktioniert offline, lässt sich auf den Startbildschirm legen

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `css/app.css` | Gestaltung (hell/dunkel, Druckansicht) |
| `js/parser.js` | Versteht gesprochene Sätze und Belegtexte |
| `js/store.js` | Daten, Regeln, Protokoll, Auswertung, Export |
| `js/app.js` | Bildschirme und Bedienung |
| `sw.js` | Offline-Fähigkeit (bei Änderungen `CACHE` hochzählen) |
| `tests/` | Tests für den Parser: `node --test tests/*.test.mjs` |

## Lokal ausprobieren

```bash
python -m http.server 8080
```

Dann `http://localhost:8080` im Browser öffnen.

## Hinweis

Rechenhilfe, keine Steuerberatung. Ob das Fahrtenbuch vom Finanzamt anerkannt
wird, bitte mit der Steuerberatung klären.
