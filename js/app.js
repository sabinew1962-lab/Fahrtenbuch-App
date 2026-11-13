import { parseEingabe, parseBeleg } from './parser.js';
import * as S from './store.js';

const { fmtD, fmtKm, zahlDe, zeitstempel } = S.format;
const VERSION = '1.0.0';

let db = S.laden();
let ansicht = 'start';
let kostenFilter = 'alle';
let zeitraum = S.heuteIso().slice(0, 4);

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n) => (n ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const prozent = (x) => `${Math.round(x * 100)} %`;
const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monatName = (m) => `${MONATSNAMEN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const kurzD = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const zahlAusFeld = (v) => {
  const s = String(v ?? '').replace(/[^\d]/g, '');
  return s === '' ? null : Number(s);
};

function speichernUndZeigen() {
  try {
    S.speichern(db);
  } catch (e) {
    toast('Speichern fehlgeschlagen: ' + e.message);
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
}

// ---------- Toast & Dialoge ----------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('zeigen');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zeigen'), 3200);
}

function dialogOeffnen(html, id = 'dialog') {
  const d = document.getElementById(id);
  d.innerHTML = html;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  return d;
}

function dialogSchliessen(id = 'dialog') {
  const d = document.getElementById(id);
  if (d.open) d.close();
}

// Kleine Rückfrage, optional mit Texteingabe. Liefert null bei Abbruch.
function frage({ titel, text = '', eingabe = false, platzhalter = '', ok = 'OK', gefahr = false }) {
  return new Promise((resolve) => {
    const d = dialogOeffnen(`
      <form method="dialog" class="frage">
        <h2>${esc(titel)}</h2>
        ${text ? `<p>${text}</p>` : ''}
        ${eingabe ? `<label>${esc(platzhalter)}<input name="antwort" required autocomplete="off"></label>` : ''}
        <div class="fehlerbox"></div>
        <div class="aktionen">
          <button type="button" class="knopf" data-abbruch>Abbrechen</button>
          <button type="submit" class="knopf ${gefahr ? 'gefahr' : 'primaer'}">${esc(ok)}</button>
        </div>
      </form>`, 'dialog2');
    const form = $('form', d);
    let erledigt = false;
    const fertig = (wert) => { if (erledigt) return; erledigt = true; dialogSchliessen('dialog2'); resolve(wert); };
    $('[data-abbruch]', d).onclick = () => fertig(null);
    d.oncancel = () => fertig(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (eingabe) {
        const v = form.antwort.value.trim();
        if (!v) { $('.fehlerbox', form).innerHTML = '<p>Bitte etwas eintragen.</p>'; return; }
        fertig(v);
      } else fertig(true);
    };
    if (eingabe) setTimeout(() => form.antwort.focus(), 50);
  });
}

// ---------- Datenlisten für Vorschläge ----------

function datenlistenAktualisieren() {
  for (const feld of ['ziel', 'zweck', 'partner']) {
    const werte = [...new Set(db.fahrten.map((f) => f[feld]).filter(Boolean))].slice(-60).reverse();
    $(`#dl-${feld}`).innerHTML = werte.map((w) => `<option value="${esc(w)}"></option>`).join('');
  }
}

// ---------- Navigation ----------

function navigieren(ziel) {
  ansicht = ziel;
  render();
  window.scrollTo(0, 0);
}

function render() {
  for (const b of $$('.navigation button')) {
    if (b.dataset.nav === ansicht) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  const el = $('#ansicht');
  if (ansicht === 'start') el.innerHTML = startAnsicht();
  else if (ansicht === 'fahrten') el.innerHTML = fahrtenAnsicht();
  else if (ansicht === 'kosten') el.innerHTML = kostenAnsicht();
  else if (ansicht === 'auswertung') el.innerHTML = auswertungAnsicht();
  else if (ansicht === 'mehr') el.innerHTML = mehrAnsicht();
  datenlistenAktualisieren();
  if (ansicht === 'start') startBinden();
  if (ansicht === 'mehr') mehrBinden();
  if (ansicht === 'auswertung') {
    const sel = $('#zeitraum');
    if (sel) sel.onchange = () => { zeitraum = sel.value; render(); };
  }
}

// ---------- Start ----------

const MIKRO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>';

function startAnsicht() {
  const offen = S.offeneFahrt(db);
  const luecken = S.lueckenFinden(db);
  const erstatten = S.offenZuErstatten(db);
  const monat = S.auswertung(db, S.heuteIso().slice(0, 7));
  const hinweise = [];

  if (offen) {
    const std = (Date.now() - new Date(offen.erfasstAm).getTime()) / 36e5;
    if (std > 12) hinweise.push(`<div class="hinweis fehler"><span><strong>Fahrt seit ${fmtD(offen.datum)} offen</strong>Ankunft vergessen?</span></div>`);
  }
  if (luecken.length) {
    hinweise.push(`<div class="hinweis warn"><span><strong>${luecken.length} ${luecken.length === 1 ? 'Unstimmigkeit' : 'Unstimmigkeiten'} im km-Verlauf</strong>Lücke oder Überschneidung prüfen</span><button class="knopf klein" data-action="nav" data-ziel="fahrten">Ansehen</button></div>`);
  }
  if (erstatten.length) {
    const summe = erstatten.reduce((s, k) => s + k.betrag, 0);
    hinweise.push(`<div class="hinweis info"><span><strong>Noch zu erstatten: ${euro(summe)}</strong>${erstatten.length} privat ausgelegte ${erstatten.length === 1 ? 'Ausgabe' : 'Ausgaben'}</span><button class="knopf klein" data-action="kosten-offen">Ansehen</button></div>`);
  }
  const anzahl = db.fahrten.length + db.kosten.length;
  const letzte = db.einstellungen.letzteSicherung;
  const tageSeit = letzte ? (Date.now() - new Date(letzte).getTime()) / 864e5 : Infinity;
  if (anzahl >= 3 && tageSeit > 14) {
    hinweise.push(`<div class="hinweis warn"><span><strong>${letzte ? `Letzte Sicherung vor ${Math.floor(tageSeit)} Tagen` : 'Noch keine Sicherung'}</strong>Deine Daten liegen nur auf diesem Handy.</span><button class="knopf klein" data-action="sicherung">Sichern</button></div>`);
  }

  const spracheMoeglich = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const kennz = db.fahrzeug.kennzeichen || db.fahrzeug.bezeichnung;

  return `
    <header class="kopf"><h1>Fahrtenbuch</h1><span class="unter">${esc(kennz || '')}</span></header>
    ${offen ? `
      <div class="laufend">
        <div class="titel">Fahrt läuft seit ${offen.zeitStart ? esc(offen.zeitStart) + ' Uhr' : fmtD(offen.datum)}</div>
        <div>Start ${fmtKm(offen.kmStart)} km${offen.ziel ? ' · ' + esc(offen.ziel) : ''}${offen.datum !== S.heuteIso() ? ' · ' + fmtD(offen.datum) : ''}</div>
        <button class="knopf" data-action="fahrt-beenden">Ankunft eintragen</button>
      </div>` : ''}
    ${hinweise.join('')}
    <div class="mikro-bereich">
      <button id="mikro" class="mikro" aria-label="Sprechen">${MIKRO_SVG}</button>
      <p id="mikro-status" class="mikro-status">${spracheMoeglich ? (offen ? 'Antippen und Ankunft einsprechen' : 'Antippen und Start oder Kosten einsprechen') : 'Spracherkennung hier nicht verfügbar: Tippe ins Feld und nutze das Mikrofon deiner Tastatur.'}</p>
      <p id="live" class="live"></p>
    </div>
    <form id="text-form" class="text-eingabe" autocomplete="off">
      <input id="text-eingabe" placeholder="…oder hier tippen bzw. diktieren" aria-label="Eingabe als Text">
      <button class="knopf primaer" type="submit">Los</button>
    </form>
    <div class="knopf-raster">
      <button class="knopf" data-action="nachholen">Fahrt nachholen</button>
      <button class="knopf" data-action="kosten-neu">Kosten erfassen</button>
      <button class="knopf" data-action="beleg-text">Belegtext einfügen</button>
      <button class="knopf" data-action="hilfe">Beispielsätze</button>
    </div>
    <p class="statistik">${monatName(S.heuteIso().slice(0, 7))}: ${fmtKm(monat.kmGesamt)} km${monat.kmGesamt ? ` · ${prozent(1 - monat.anteilPrivat - monat.anteilArbeitsweg)} geschäftlich` : ''}</p>`;
}

function startBinden() {
  $('#mikro').onclick = mikroKlick;
  $('#text-form').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#text-eingabe').value.trim();
    if (!t) { toast('Erst etwas eintippen oder diktieren.'); return; }
    $('#text-eingabe').value = '';
    verarbeiten(t, 'tippen');
  };
}

// ---------- Spracherkennung ----------

let erkennung = null;
let hoert = false;

function mikroKlick() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('Spracherkennung wird hier nicht unterstützt. Nutze das Mikrofon deiner Tastatur.');
    $('#text-eingabe').focus();
    return;
  }
  if (hoert) { erkennung.stop(); return; }
  erkennung = new SR();
  erkennung.lang = 'de-DE';
  erkennung.interimResults = true;
  erkennung.continuous = false;
  erkennung.maxAlternatives = 1;
  let endgueltig = '';
  const status = (t) => { const s = $('#mikro-status'); if (s) s.textContent = t; };
  erkennung.onstart = () => {
    hoert = true;
    $('#mikro')?.classList.add('hoert');
    status('Ich höre zu… (zum Beenden nochmal tippen)');
    if (navigator.vibrate) navigator.vibrate(30);
  };
  erkennung.onresult = (e) => {
    let zwischen = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) endgueltig += r[0].transcript + ' ';
      else zwischen += r[0].transcript;
    }
    const live = $('#live');
    if (live) live.textContent = (endgueltig + zwischen).trim();
  };
  erkennung.onerror = (e) => {
    const texte = {
      'not-allowed': 'Bitte erlaube den Mikrofon-Zugriff (Schloss-Symbol in der Adresszeile).',
      'service-not-allowed': 'Bitte erlaube den Mikrofon-Zugriff.',
      'no-speech': 'Ich habe nichts gehört. Nochmal versuchen?',
      'network': 'Die Spracherkennung braucht Internet. Tippe stattdessen ins Feld.',
      'audio-capture': 'Kein Mikrofon gefunden.',
      'aborted': '',
    };
    const t = texte[e.error] ?? `Spracherkennung: ${e.error}`;
    if (t) toast(t);
  };
  erkennung.onend = () => {
    hoert = false;
    $('#mikro')?.classList.remove('hoert');
    status('Antippen und sprechen');
    const live = $('#live'); if (live) live.textContent = '';
    if (endgueltig.trim()) verarbeiten(endgueltig.trim(), 'sprache');
  };
  try { erkennung.start(); } catch (e) { toast('Spracherkennung konnte nicht starten.'); }
}

// ---------- Eingabe auswerten ----------

function verarbeiten(text, quelle) {
  const r = parseEingabe(text, { favoriten: db.favoriten });
  if (r.typ === 'kosten') { kostenFormular({ vorlage: r, text, quelle }); return; }

  const offen = S.offeneFahrt(db);
  let modus = r.modus;
  if (modus === 'auto') modus = offen ? 'ende' : 'start';
  if (modus === 'ende' && r.kmEnde == null && r.kmStart != null) { r.kmEnde = r.kmStart; r.kmStart = null; }

  if (modus === 'ende') {
    if (offen && (!r.datum || r.datum >= offen.datum)) {
      fahrtFormular({ modus: 'ende', fahrt: offen, vorlage: r, text, quelle });
    } else {
      fahrtFormular({ modus: 'komplett', vorlage: { ...r, kmStart: r.kmStart ?? S.letzterKmStand(db) }, text, quelle });
    }
    return;
  }
  if (modus === 'start') {
    fahrtFormular({ modus: 'start', vorlage: { ...r, kmStart: r.kmStart ?? S.letzterKmStand(db) }, text, quelle });
    return;
  }
  fahrtFormular({ modus: 'komplett', vorlage: r, text, quelle });
}

// ---------- Fahrt-Formular ----------

const TITEL = { start: 'Fahrt starten', ende: 'Ankunft eintragen', komplett: 'Fahrt nachtragen', bearbeiten: 'Fahrt korrigieren' };

function fahrtFormular({ modus, fahrt = null, vorlage = {}, text = '', quelle = 'tippen' }) {
  const heute = S.heuteIso();
  const v = vorlage;
  let w;
  if (modus === 'ende') {
    w = { ...fahrt };
    for (const k of ['ziel', 'zweck', 'partner', 'route', 'art']) if (v[k]) w[k] = v[k];
    w.kmEnde = v.kmEnde ?? null;
    w.zeitEnde = v.zeitEnde || (v.datum && v.datum !== heute ? '' : S.jetztZeit());
  } else if (modus === 'bearbeiten') {
    w = { ...fahrt };
  } else {
    const datum = v.datum || heute;
    w = {
      datum,
      zeitStart: v.zeitStart || (modus === 'start' && datum === heute ? S.jetztZeit() : ''),
      zeitEnde: v.zeitEnde || '',
      kmStart: v.kmStart ?? null,
      kmEnde: v.kmEnde ?? null,
      art: v.art || 'geschaeftlich',
      ziel: v.ziel || '', zweck: v.zweck || '', partner: v.partner || '', route: v.route || '',
    };
  }
  if (w.art === 'arbeitsweg' && !w.ziel) w.ziel = 'Wohnung – Arbeitsstätte';
  const formModus = modus === 'start' || (modus === 'bearbeiten' && fahrt.status === 'offen') ? 'start' : 'voll';

  const d = dialogOeffnen(`
    <form id="fahrt-form" data-modus="${formModus}" data-art="${esc(w.art)}" autocomplete="off" novalidate>
      <h2>${TITEL[modus]}</h2>
      ${text ? `<p class="verstanden">Verstanden: <em>„${esc(text)}“</em></p>` : ''}
      <div class="wahl" role="radiogroup" aria-label="Fahrtart">
        ${Object.entries(S.ARTEN).map(([k, l]) => `<label><input type="radio" name="art" value="${k}" ${w.art === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <div class="raster-3">
        <label>Datum<input type="date" name="datum" value="${esc(w.datum)}" max="${heute}" ${modus === 'ende' ? 'readonly' : ''}></label>
        <label>Abfahrt<input type="time" name="zeitStart" value="${esc(w.zeitStart)}"></label>
        <label class="nur-ende">Ankunft<input type="time" name="zeitEnde" value="${esc(w.zeitEnde)}"></label>
      </div>
      <div class="raster-2">
        <label>km Start<input name="kmStart" inputmode="numeric" value="${w.kmStart ?? ''}" ${modus === 'ende' ? 'readonly' : ''}></label>
        <label class="nur-ende">km Ende<input name="kmEnde" inputmode="numeric" value="${w.kmEnde ?? ''}"></label>
      </div>
      <p class="km-diff"></p>
      <label class="nur-arbeitsweg">Reiseziel<input name="ziel" list="dl-ziel" value="${esc(w.ziel)}"></label>
      <label class="nur-geschaeftlich">Reisezweck<input name="zweck" list="dl-zweck" value="${esc(w.zweck)}"></label>
      <label class="nur-geschaeftlich">Geschäftspartner<input name="partner" list="dl-partner" value="${esc(w.partner)}"></label>
      <label class="nur-geschaeftlich">Route / Umweg <span class="optional">(nur bei Abweichung)</span><input name="route" value="${esc(w.route)}"></label>
      ${modus === 'bearbeiten' ? '<label>Grund der Korrektur<input name="grund" placeholder="z. B. Zahlendreher beim km-Stand"></label>' : ''}
      <div class="warnungen" aria-live="polite"></div>
      <div class="fehlerbox" aria-live="assertive"></div>
      <div class="aktionen">
        <button type="button" class="knopf" data-abbruch>Abbrechen</button>
        <button type="submit" class="knopf primaer">${modus === 'start' ? 'Fahrt starten' : 'Speichern'}</button>
      </div>
    </form>`);

  const form = $('#fahrt-form', d);
  const daten = () => {
    const fd = new FormData(form);
    return {
      datum: fd.get('datum'),
      zeitStart: fd.get('zeitStart') || '',
      zeitEnde: formModus === 'start' ? '' : fd.get('zeitEnde') || '',
      kmStart: zahlAusFeld(fd.get('kmStart')),
      kmEnde: formModus === 'start' ? null : zahlAusFeld(fd.get('kmEnde')),
      art: fd.get('art'),
      ziel: fd.get('ziel') || '',
      zweck: fd.get('art') === 'geschaeftlich' ? fd.get('zweck') || '' : '',
      partner: fd.get('art') === 'geschaeftlich' ? fd.get('partner') || '' : '',
      route: fd.get('art') === 'geschaeftlich' ? fd.get('route') || '' : '',
    };
  };
  const pruefen = () => {
    const x = daten();
    form.dataset.art = x.art;
    if (x.art === 'arbeitsweg' && !form.ziel.value) form.ziel.value = 'Wohnung – Arbeitsstätte';
    const diff = x.kmStart != null && x.kmEnde != null ? x.kmEnde - x.kmStart : null;
    $('.km-diff', form).textContent = diff != null && diff > 0 ? `= ${fmtKm(diff)} km` : '';
    const ws = S.fahrtWarnungen(db, x, { id: fahrt?.id });
    if (x.art !== 'geschaeftlich') ws.splice(0, ws.length, ...ws.filter((m) => !m.includes('Pflicht')));
    $('.warnungen', form).innerHTML = ws.map((m) => `<p>${esc(m)}</p>`).join('');
    $('.fehlerbox', form).innerHTML = '';
  };
  form.addEventListener('input', pruefen);
  form.addEventListener('change', pruefen);
  pruefen();
  $('[data-abbruch]', form).onclick = () => dialogSchliessen();

  form.onsubmit = (e) => {
    e.preventDefault();
    const x = daten();
    try {
      if (modus === 'start') {
        S.fahrtAnlegen(db, x, { modus: 'start', quelle, text });
        toast('Gute Fahrt! Start gespeichert.');
      } else if (modus === 'komplett') {
        S.fahrtAnlegen(db, x, { modus: 'komplett', quelle, text });
        toast(x.datum < S.heuteIso() ? 'Fahrt nachgetragen.' : 'Fahrt gespeichert.');
      } else if (modus === 'ende') {
        S.fahrtBeenden(db, fahrt.id, x, { text });
        toast(`Angekommen: ${fmtKm(x.kmEnde - x.kmStart)} km gespeichert.`);
      } else if (modus === 'bearbeiten') {
        S.fahrtAendern(db, fahrt.id, x, form.grund?.value.trim());
        toast('Korrektur gespeichert und protokolliert.');
      }
      dialogSchliessen();
      speichernUndZeigen();
    } catch (err) {
      $('.fehlerbox', form).innerHTML = `<p>${esc(err.message)}</p>`;
      $('.fehlerbox', form).scrollIntoView({ block: 'nearest' });
    }
  };
}

// ---------- Kosten-Formular ----------

function kostenFormular({ kosten = null, vorlage = {}, text = '', quelle = 'tippen' }) {
  const heute = S.heuteIso();
  const offen = S.offeneFahrt(db);
  const v = kosten ? { ...kosten } : {
    datum: vorlage.datum || heute,
    kategorie: vorlage.kategorie || 'Tanken',
    betrag: vorlage.betrag ?? '',
    liter: vorlage.liter ?? '',
    km: vorlage.km ?? '',
    bezahlt: vorlage.bezahlt || db.einstellungen.standardBezahlt || 'firma',
    ort: vorlage.ort || '',
    fahrtId: null,
  };
  if (!kosten && offen && v.kategorie === 'Parken' && (!vorlage.datum || vorlage.datum === offen.datum)) v.fahrtId = offen.id;

  const fahrtenAuswahl = S.aktiveFahrten(db).slice().sort((a, b) => b.kmStart - a.kmStart).slice(0, 25);
  const d = dialogOeffnen(`
    <form id="kosten-form" autocomplete="off" novalidate>
      <h2>${kosten ? `Ausgabe ${esc(kosten.nr)} korrigieren` : 'Kosten erfassen'}</h2>
      ${text ? `<p class="verstanden">${quelle === 'beleg' ? 'Aus dem Belegtext gelesen.' : `Verstanden: <em>„${esc(text)}“</em>`}</p>` : ''}
      <div class="wahl" role="radiogroup" aria-label="Kategorie">
        ${S.KATEGORIEN.map((k) => `<label><input type="radio" name="kategorie" value="${k}" ${v.kategorie === k ? 'checked' : ''}><span>${k}</span></label>`).join('')}
      </div>
      <div class="raster-2">
        <label>Datum<input type="date" name="datum" value="${esc(v.datum)}" max="${heute}"></label>
        <label>Betrag in €<input name="betrag" inputmode="decimal" value="${v.betrag !== '' && v.betrag != null ? zahlDe(v.betrag) : ''}"></label>
      </div>
      <div class="raster-2 nur-tanken">
        <label>Liter <span class="optional">(optional)</span><input name="liter" inputmode="decimal" value="${v.liter !== '' && v.liter != null ? zahlDe(v.liter) : ''}"></label>
        <label>km-Stand <span class="optional">(optional)</span><input name="km" inputmode="numeric" value="${v.km ?? ''}"></label>
      </div>
      <label>Bezahlt</label>
      <div class="wahl" role="radiogroup" aria-label="Bezahlt">
        <label><input type="radio" name="bezahlt" value="firma" ${v.bezahlt !== 'privat' ? 'checked' : ''}><span>Firma</span></label>
        <label><input type="radio" name="bezahlt" value="privat" ${v.bezahlt === 'privat' ? 'checked' : ''}><span>Privat ausgelegt</span></label>
      </div>
      <label>Ort / Anbieter / Notiz<input name="ort" value="${esc(v.ort)}"></label>
      <label>Zu Fahrt <span class="optional">(optional)</span>
        <select name="fahrtId">
          <option value="">– keine –</option>
          ${fahrtenAuswahl.map((f) => `<option value="${f.id}" ${v.fahrtId === f.id ? 'selected' : ''}>${fmtD(f.datum)} · ${esc(f.ziel || S.ARTEN[f.art])}${f.status === 'offen' ? ' (läuft)' : ''}</option>`).join('')}
        </select>
      </label>
      ${kosten ? '<label>Grund der Korrektur<input name="grund" placeholder="z. B. Betrag falsch verstanden"></label>' : ''}
      <div class="warnungen"></div>
      <div class="fehlerbox" aria-live="assertive"></div>
      <div class="aktionen">
        <button type="button" class="knopf" data-abbruch>Abbrechen</button>
        <button type="submit" class="knopf primaer">${kosten ? 'Speichern' : 'Speichern & Nummer holen'}</button>
      </div>
    </form>`);

  const form = $('#kosten-form', d);
  const daten = () => {
    const fd = new FormData(form);
    const kat = fd.get('kategorie');
    return {
      datum: fd.get('datum'),
      kategorie: kat,
      betrag: String(fd.get('betrag') || '').replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'),
      liter: kat === 'Tanken' ? String(fd.get('liter') || '').replace(',', '.') : '',
      km: kat === 'Tanken' ? zahlAusFeld(fd.get('km')) : null,
      bezahlt: fd.get('bezahlt'),
      ort: fd.get('ort') || '',
      fahrtId: fd.get('fahrtId') || null,
    };
  };
  const pruefen = () => {
    const x = daten();
    $('.nur-tanken', form).style.display = x.kategorie === 'Tanken' ? '' : 'none';
    const ws = [];
    if (x.kategorie === 'Tanken' && x.km) {
      const letzter = S.letzterKmStand(db);
      if (letzter && x.km > letzter + 50 && !S.offeneFahrt(db)) ws.push(`km-Stand ${fmtKm(x.km)} liegt über der letzten Fahrt (${fmtKm(letzter)}). Fehlt eine Fahrt?`);
    }
    if (x.datum < S.heuteIso()) ws.push('Wird als Nachtrag gespeichert (Erfassungsdatum heute).');
    $('.warnungen', form).innerHTML = ws.map((m) => `<p>${esc(m)}</p>`).join('');
    $('.fehlerbox', form).innerHTML = '';
  };
  form.addEventListener('input', pruefen);
  form.addEventListener('change', pruefen);
  pruefen();
  $('[data-abbruch]', form).onclick = () => dialogSchliessen();

  form.onsubmit = (e) => {
    e.preventDefault();
    const x = daten();
    try {
      if (kosten) {
        S.kostenAendern(db, kosten.id, x, form.grund?.value.trim());
        dialogSchliessen();
        toast('Korrektur gespeichert und protokolliert.');
        speichernUndZeigen();
      } else {
        const k = S.kostenAnlegen(db, x, { quelle, text: quelle === 'beleg' ? undefined : text });
        speichernUndZeigen();
        belegnummerZeigen(k);
      }
    } catch (err) {
      $('.fehlerbox', form).innerHTML = `<p>${esc(err.message)}</p>`;
      $('.fehlerbox', form).scrollIntoView({ block: 'nearest' });
    }
  };
}

function belegnummerZeigen(k) {
  const d = dialogOeffnen(`
    <h2>Gespeichert</h2>
    <p>Schreib diese Nummer auf den Beleg:</p>
    <div class="belegnummer">${esc(k.nr)}</div>
    <table class="details">
      <tr><th>Kategorie</th><td>${esc(k.kategorie)}</td></tr>
      <tr><th>Datum</th><td>${fmtD(k.datum)}</td></tr>
      <tr><th>Betrag</th><td>${euro(k.betrag)}</td></tr>
      <tr><th>Bezahlt</th><td>${k.bezahlt === 'privat' ? 'privat ausgelegt' : 'Firma'}</td></tr>
    </table>
    <div class="aktionen"><button class="knopf primaer" data-ok>Erledigt</button></div>`);
  $('[data-ok]', d).onclick = () => dialogSchliessen();
}

function belegTextDialog() {
  const d = dialogOeffnen(`
    <form id="beleg-form">
      <h2>Belegtext einfügen</h2>
      <p class="kleingedruckt" style="margin-top:0">So geht's: Kamera öffnen → Google Lens → Beleg anvisieren → „Text“ → „Alles kopieren“. Dann hier einfügen. Das Foto wird nicht gespeichert, nur die erkannten Werte.</p>
      <label>Text vom Beleg<textarea name="text" placeholder="ARAL Tankstelle&#10;Super E10 42,35 l&#10;Summe EUR 75,76&#10;12.11.2026"></textarea></label>
      <div class="fehlerbox"></div>
      <div class="aktionen">
        <button type="button" class="knopf" data-abbruch>Abbrechen</button>
        <button type="submit" class="knopf primaer">Auslesen</button>
      </div>
    </form>`);
  const form = $('#beleg-form', d);
  $('[data-abbruch]', form).onclick = () => dialogSchliessen();
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = form.text.value.trim();
    if (!t) { $('.fehlerbox', form).innerHTML = '<p>Erst den Belegtext einfügen.</p>'; return; }
    const r = parseBeleg(t);
    kostenFormular({ vorlage: r, text: t, quelle: 'beleg' });
  };
  setTimeout(() => form.text.focus(), 50);
}

function hilfeDialog() {
  const d = dialogOeffnen(`
    <h2>Beispielsätze</h2>
    <h3>Unterwegs</h3>
    <p class="verstanden"><em>„Start 45.230 zu Kundin Meier nach Köln, Beratung“</em></p>
    <p class="verstanden"><em>„Ankunft 45.310“</em> oder nur <em>„45.310“</em></p>
    <p class="verstanden"><em>„Start 45.400 privat“</em> · <em>„Start 45.500 zur Arbeit“</em></p>
    <h3>Nachholen</h3>
    <p class="verstanden"><em>„Gestern Start 45.100, Ende 45.180, Bonn, Workshop bei Firma Lehmann“</em></p>
    <p class="verstanden"><em>„Am Dienstag von 8 Uhr bis 9:30 Uhr 44.900 bis 44.980 Düsseldorf Messe“</em></p>
    <p class="verstanden"><em>„Am 5. November 44.000 bis 44.050 privat“</em></p>
    <h3>Kosten</h3>
    <p class="verstanden"><em>„Getankt 45 Liter 82,50 Euro km 45.300 privat bezahlt“</em></p>
    <p class="verstanden"><em>„Parken 6 Euro Köln“</em> · <em>„Gestern Autowäsche 15 Euro Firmenkarte“</em></p>
    <p class="kleingedruckt">Tipp: Lege unter „Mehr → Favoriten“ Kurzwörter an. Dann reicht <em>„Start 45.230 Meier“</em> und Ziel, Zweck und Partner werden ausgefüllt. Vor dem Speichern siehst du immer alles zur Kontrolle.</p>
    <div class="aktionen"><button class="knopf primaer" data-ok>Alles klar</button></div>`);
  $('[data-ok]', d).onclick = () => dialogSchliessen();
}

// ---------- Fahrten-Liste ----------

function fahrtZeile(f) {
  const km = f.kmEnde != null ? `${fmtKm(f.kmEnde - f.kmStart)} km` : 'läuft';
  const titel = f.art === 'privat' ? 'Privatfahrt' : (f.ziel || S.ARTEN[f.art]);
  const unter = f.art === 'geschaeftlich' ? [f.zweck, f.partner].filter(Boolean).join(' · ') : '';
  const aenderungen = f.historie.filter((h) => h.aktion === 'geaendert').length;
  const marken = [
    `<span class="marke ${f.art}">${S.ARTEN[f.art]}</span>`,
    f.status === 'offen' ? '<span class="marke warn">läuft</span>' : '',
    f.status === 'storniert' ? '<span class="marke fehler">storniert</span>' : '',
    f.nachtrag ? `<span class="marke neutral">nachgetragen ${kurzD(f.erfasstAm.slice(0, 10))}</span>` : '',
    aenderungen ? `<span class="marke neutral">${aenderungen}× korrigiert</span>` : '',
  ].join('');
  return `
    <button class="eintrag ${f.status === 'storniert' ? 'storniert' : ''}" data-action="fahrt-detail" data-id="${f.id}">
      <div class="e-kopf"><span>${kurzD(f.datum)} ${esc(titel)}</span><span>${km}</span></div>
      ${unter ? `<div class="e-unter">${esc(unter)}</div>` : ''}
      <div class="e-meta">${fmtKm(f.kmStart)} – ${f.kmEnde != null ? fmtKm(f.kmEnde) : '…'} ${marken}</div>
    </button>`;
}

function fahrtenAnsicht() {
  if (!db.fahrten.length) {
    return `<header class="kopf"><h1>Fahrten</h1></header>
      <div class="leer"><p>Noch keine Fahrten.</p><button class="knopf primaer" data-action="nav" data-ziel="start">Erste Fahrt einsprechen</button></div>`;
  }
  const luecken = S.lueckenFinden(db);
  const lueckeNach = new Map(luecken.map((l) => [l.vorFahrt.id, l]));
  const sortiert = db.fahrten.slice().sort((a, b) => b.datum.localeCompare(a.datum) || b.kmStart - a.kmStart);
  const gruppen = new Map();
  for (const f of sortiert) {
    const m = f.datum.slice(0, 7);
    if (!gruppen.has(m)) gruppen.set(m, []);
    gruppen.get(m).push(f);
  }
  let html = `<header class="kopf"><h1>Fahrten</h1><button class="knopf klein" data-action="nachholen">+ Nachtragen</button></header>`;
  for (const [m, fs] of gruppen) {
    const gesperrt = S.monatGesperrt(db, m + '-01');
    const summe = fs.filter((f) => f.status === 'abgeschlossen').reduce((s, f) => s + f.kmEnde - f.kmStart, 0);
    html += `<div class="monat-kopf"><span>${monatName(m)}${gesperrt ? ' · abgeschlossen' : ''}</span><span>${fmtKm(summe)} km</span></div><div class="liste">`;
    for (const f of fs) {
      html += fahrtZeile(f);
      const l = lueckeNach.get(f.id);
      if (l) {
        html += l.typ === 'luecke'
          ? `<div class="luecke"><span>Lücke ${fmtKm(l.von)} → ${fmtKm(l.bis)} (${fmtKm(l.bis - l.von)} km)</span><button class="knopf klein" data-action="luecke-fuellen" data-von="${l.von}" data-bis="${l.bis}" data-datum="${l.nachFahrt.datum}">Nachtragen</button></div>`
          : `<div class="luecke"><span>Überschneidung ${fmtKm(l.von)} – ${fmtKm(l.bis)}: km-Stände prüfen</span></div>`;
      }
    }
    html += '</div>';
  }
  return html;
}

function protokollHtml(eintrag, felder) {
  return eintrag.historie.map((h) => {
    const wann = zeitstempel(h.am);
    const aktion = { angelegt: 'angelegt', beendet: 'beendet', geaendert: 'korrigiert', storniert: 'storniert', erstattet: `als erstattet markiert (${fmtD(h.datum)})`, 'erstattung-zurueckgenommen': 'Erstattung zurückgenommen' }[h.aktion] || h.aktion;
    const aend = (h.aenderungen || []).map((a) => `${felder[a.feld] || a.feld}: ${esc(wertText(a.feld, a.alt))} → ${esc(wertText(a.feld, a.neu))}`).join('; ');
    return `<p><strong>${wann}</strong> ${aktion}${h.text ? ` · „${esc(h.text)}“` : ''}${aend ? `<br>${aend}` : ''}${h.grund ? `<br>Grund: ${esc(h.grund)}` : ''}</p>`;
  }).join('');
}

function wertText(feld, w) {
  if (w == null || w === '') return '–';
  if (feld === 'datum') return fmtD(w);
  if (feld === 'art') return S.ARTEN[w] || w;
  if (feld === 'kmStart' || feld === 'kmEnde' || feld === 'km') return fmtKm(w);
  if (feld === 'betrag') return euro(w);
  if (feld === 'bezahlt') return w === 'privat' ? 'privat ausgelegt' : 'Firma';
  if (feld === 'fahrtId') { const f = db.fahrten.find((x) => x.id === w); return f ? `${fmtD(f.datum)} ${f.ziel}` : '–'; }
  return String(w);
}

function fahrtDetail(id) {
  const f = db.fahrten.find((x) => x.id === id);
  if (!f) return;
  const gesperrt = S.monatGesperrt(db, f.datum);
  const zeilen = [
    ['Datum', fmtD(f.datum)], ['Zeit', [f.zeitStart, f.zeitEnde].filter(Boolean).join(' – ')],
    ['km', `${fmtKm(f.kmStart)} – ${f.kmEnde != null ? fmtKm(f.kmEnde) : '…'}${f.kmEnde != null ? ` (${fmtKm(f.kmEnde - f.kmStart)} km)` : ''}`],
    ['Fahrtart', S.ARTEN[f.art]], ['Reiseziel', f.ziel], ['Reisezweck', f.zweck], ['Geschäftspartner', f.partner], ['Route/Umweg', f.route],
    ['Erfasst am', zeitstempel(f.erfasstAm) + (f.nachtrag ? ' (Nachtrag)' : '')],
  ].filter(([, w]) => w);
  const parken = db.kosten.filter((k) => k.fahrtId === f.id && k.status !== 'storniert');
  const d = dialogOeffnen(`
    <h2>Fahrt vom ${fmtD(f.datum)} ${f.status === 'storniert' ? '<span class="marke fehler">storniert</span>' : ''}</h2>
    <table class="details">${zeilen.map(([l, w]) => `<tr><th>${l}</th><td>${esc(w)}</td></tr>`).join('')}</table>
    ${parken.length ? `<p class="kleingedruckt">Zugeordnete Kosten: ${parken.map((k) => `${esc(k.nr)} ${esc(k.kategorie)} ${euro(k.betrag)}`).join(', ')}</p>` : ''}
    <h3>Protokoll</h3>
    <div class="protokoll">${protokollHtml(f, S.FAHRT_FELDER)}</div>
    ${gesperrt ? '<p class="hinweis info">Der Monat ist abgeschlossen: keine Änderungen mehr möglich.</p>' : ''}
    <div class="aktionen">
      <button class="knopf" data-ok>Schließen</button>
      ${f.status === 'offen' ? '<button class="knopf primaer" data-beenden>Ankunft</button>' : ''}
      ${f.status !== 'storniert' && !gesperrt ? '<button class="knopf" data-bearbeiten>Korrigieren</button><button class="knopf gefahr" data-storno>Stornieren</button>' : ''}
    </div>`);
  $('[data-ok]', d).onclick = () => dialogSchliessen();
  const b = $('[data-beenden]', d); if (b) b.onclick = () => fahrtFormular({ modus: 'ende', fahrt: f });
  const k = $('[data-bearbeiten]', d); if (k) k.onclick = () => fahrtFormular({ modus: 'bearbeiten', fahrt: f });
  const s = $('[data-storno]', d);
  if (s) s.onclick = async () => {
    const grund = await frage({ titel: 'Fahrt stornieren?', text: 'Die Fahrt bleibt sichtbar (durchgestrichen) und im Protokoll. Sie zählt aber nicht mehr mit.', eingabe: true, platzhalter: 'Grund', ok: 'Stornieren', gefahr: true });
    if (!grund) return;
    try { S.fahrtStornieren(db, f.id, grund); dialogSchliessen(); toast('Fahrt storniert.'); speichernUndZeigen(); } catch (e) { toast(e.message); }
  };
}

// ---------- Kosten-Liste ----------

function kostenAnsicht() {
  const offen = S.offenZuErstatten(db);
  const liste = (kostenFilter === 'offen' ? offen : db.kosten).slice().sort((a, b) => b.datum.localeCompare(a.datum) || b.nr.localeCompare(a.nr));
  let html = `
    <header class="kopf"><h1>Kosten</h1><button class="knopf klein" data-action="kosten-neu">+ Erfassen</button></header>
    <div class="wahl" role="radiogroup" aria-label="Filter">
      <label><input type="radio" name="kfilter" value="alle" data-action="kfilter" ${kostenFilter === 'alle' ? 'checked' : ''}><span>Alle</span></label>
      <label><input type="radio" name="kfilter" value="offen" data-action="kfilter" ${kostenFilter === 'offen' ? 'checked' : ''}><span>Zu erstatten (${offen.length})</span></label>
    </div>`;
  if (kostenFilter === 'offen' && offen.length) {
    html += `<div class="hinweis info"><span><strong>Offen: ${euro(offen.reduce((s, k) => s + k.betrag, 0))}</strong>Privat ausgelegt, noch nicht erstattet</span><button class="knopf klein" data-action="alle-erstattet">Alle erstattet</button></div>`;
  }
  if (!liste.length) return html + `<div class="leer"><p>${kostenFilter === 'offen' ? 'Nichts offen. Prima!' : 'Noch keine Kosten erfasst.'}</p></div>`;
  const gruppen = new Map();
  for (const k of liste) {
    const m = k.datum.slice(0, 7);
    if (!gruppen.has(m)) gruppen.set(m, []);
    gruppen.get(m).push(k);
  }
  for (const [m, ks] of gruppen) {
    const summe = ks.filter((k) => k.status !== 'storniert').reduce((s, k) => s + k.betrag, 0);
    html += `<div class="monat-kopf"><span>${monatName(m)}${S.monatGesperrt(db, m + '-01') ? ' · abgeschlossen' : ''}</span><span>${euro(summe)}</span></div><div class="liste">`;
    for (const k of ks) {
      const meta = [k.liter ? `${zahlDe(k.liter)} l` : '', k.km ? `km ${fmtKm(k.km)}` : '', k.ort].filter(Boolean).join(' · ');
      const marke = k.status === 'storniert' ? '<span class="marke fehler">storniert</span>'
        : k.bezahlt === 'privat' ? (k.erstattetAm ? `<span class="marke geschaeftlich">erstattet ${kurzD(k.erstattetAm)}</span>` : '<span class="marke warn">privat · offen</span>')
          : '<span class="marke neutral">Firma</span>';
      html += `
        <button class="eintrag ${k.status === 'storniert' ? 'storniert' : ''}" data-action="kosten-detail" data-id="${k.id}">
          <div class="e-kopf"><span>${kurzD(k.datum)} ${esc(k.kategorie)}</span><span>${euro(k.betrag)}</span></div>
          ${meta ? `<div class="e-unter">${esc(meta)}</div>` : ''}
          <div class="e-meta"><strong>${esc(k.nr)}</strong> ${marke} ${k.nachtrag ? '<span class="marke neutral">nachgetragen</span>' : ''}</div>
        </button>`;
    }
    html += '</div>';
  }
  return html;
}

function kostenDetail(id) {
  const k = db.kosten.find((x) => x.id === id);
  if (!k) return;
  const gesperrt = S.monatGesperrt(db, k.datum);
  const fahrt = k.fahrtId ? db.fahrten.find((f) => f.id === k.fahrtId) : null;
  const zeilen = [
    ['Beleg-Nr.', k.nr], ['Datum', fmtD(k.datum)], ['Kategorie', k.kategorie], ['Betrag', euro(k.betrag)],
    ['Liter', k.liter ? `${zahlDe(k.liter)} l (${zahlDe(k.betrag / k.liter, 3)} €/l)` : ''], ['km-Stand', k.km ? fmtKm(k.km) : ''],
    ['Bezahlt', k.bezahlt === 'privat' ? `privat ausgelegt${k.erstattetAm ? `, erstattet am ${fmtD(k.erstattetAm)}` : ', noch offen'}` : 'Firma'],
    ['Ort/Notiz', k.ort], ['Fahrt', fahrt ? `${fmtD(fahrt.datum)} ${fahrt.ziel}` : ''], ['Erfasst am', zeitstempel(k.erfasstAm) + (k.nachtrag ? ' (Nachtrag)' : '')],
  ].filter(([, w]) => w);
  const aktiv = k.status !== 'storniert';
  const d = dialogOeffnen(`
    <h2>Ausgabe ${esc(k.nr)} ${aktiv ? '' : '<span class="marke fehler">storniert</span>'}</h2>
    <table class="details">${zeilen.map(([l, w]) => `<tr><th>${l}</th><td>${esc(w)}</td></tr>`).join('')}</table>
    <h3>Protokoll</h3>
    <div class="protokoll">${protokollHtml(k, S.KOSTEN_FELDER)}</div>
    ${gesperrt ? '<p class="hinweis info">Der Monat ist abgeschlossen: Betrag und Daten sind gesperrt. Die Erstattung kannst du trotzdem noch vermerken.</p>' : ''}
    <div class="knopf-reihe">
      ${aktiv && k.bezahlt === 'privat' && !k.erstattetAm ? '<button class="knopf primaer" data-erstattet>Als erstattet markieren</button>' : ''}
      ${aktiv && k.erstattetAm ? '<button class="knopf klein" data-zurueck>Erstattung zurücknehmen</button>' : ''}
    </div>
    <div class="aktionen">
      <button class="knopf" data-ok>Schließen</button>
      ${aktiv && !gesperrt ? '<button class="knopf" data-bearbeiten>Korrigieren</button><button class="knopf gefahr" data-storno>Stornieren</button>' : ''}
    </div>`);
  $('[data-ok]', d).onclick = () => dialogSchliessen();
  const e = $('[data-erstattet]', d);
  if (e) e.onclick = () => { S.kostenErstattet(db, k.id); speichernUndZeigen(); kostenDetail(k.id); toast('Als erstattet markiert.'); };
  const z = $('[data-zurueck]', d);
  if (z) z.onclick = () => { S.kostenErstattungZuruecknehmen(db, k.id); speichernUndZeigen(); kostenDetail(k.id); };
  const b = $('[data-bearbeiten]', d); if (b) b.onclick = () => kostenFormular({ kosten: k });
  const s = $('[data-storno]', d);
  if (s) s.onclick = async () => {
    const grund = await frage({ titel: `${k.nr} stornieren?`, text: 'Die Nummer bleibt vergeben und die Ausgabe sichtbar (durchgestrichen). Sie zählt aber nicht mehr mit.', eingabe: true, platzhalter: 'Grund', ok: 'Stornieren', gefahr: true });
    if (!grund) return;
    try { S.kostenStornieren(db, k.id, grund); dialogSchliessen(); toast('Ausgabe storniert.'); speichernUndZeigen(); } catch (err) { toast(err.message); }
  };
}

// ---------- Auswertung ----------

function auswertungAnsicht() {
  const { monate, jahre } = S.zeitraeume(db);
  if (!jahre.includes(zeitraum) && !monate.includes(zeitraum)) zeitraum = jahre[0];
  const a = S.auswertung(db, zeitraum);
  const optionen = jahre.map((j) => `<option value="${j}" ${zeitraum === j ? 'selected' : ''}>Jahr ${j}</option>`
    + monate.filter((m) => m.startsWith(j)).map((m) => `<option value="${m}" ${zeitraum === m ? 'selected' : ''}>&nbsp;&nbsp;${monatName(m)}</option>`).join('')).join('');
  const aktMonat = S.heuteIso().slice(0, 7);
  const abschlussMonate = monate.filter((m) => m < aktMonat);

  return `
    <header class="kopf"><h1>Auswertung</h1></header>
    <label>Zeitraum<select id="zeitraum">${optionen}</select></label>
    <div class="kacheln">
      <div class="kachel"><div class="l">km gesamt</div><div class="w">${fmtKm(a.kmGesamt)}</div></div>
      <div class="kachel"><div class="l">Fahrten</div><div class="w">${a.fahrtenAnzahl}</div></div>
      <div class="kachel"><div class="l">geschäftlich</div><div class="w">${fmtKm(a.km.geschaeftlich)}</div></div>
      <div class="kachel"><div class="l">privat · Arbeitsweg</div><div class="w">${fmtKm(a.km.privat)} · ${fmtKm(a.km.arbeitsweg)}</div></div>
    </div>
    <div class="karte">
      <table class="summen">
        ${S.KATEGORIEN.filter((k) => a.nachKategorie[k]).map((k) => `<tr><td>${k}</td><td>${euro(a.nachKategorie[k])}</td></tr>`).join('')}
        <tr><td>Fixkosten (anteilig)</td><td>${euro(a.fix)}</td></tr>
        <tr><td>Abschreibung (AfA)</td><td>${euro(a.afa)}</td></tr>
        <tr class="gesamt"><td>Gesamtkosten</td><td>${euro(a.gesamt)}</td></tr>
      </table>
    </div>
    <div class="kacheln">
      <div class="kachel akzent"><div class="l">Privatanteil (${prozent(a.anteilPrivat)})</div><div class="w">${euro(a.kostenPrivat)}</div></div>
      <div class="kachel akzent"><div class="l">Arbeitsweg (${prozent(a.anteilArbeitsweg)})</div><div class="w">${euro(a.kostenArbeitsweg)}</div></div>
      <div class="kachel"><div class="l">Kosten pro km</div><div class="w">${a.kmGesamt ? zahlDe(a.proKm) + ' €' : '–'}</div></div>
      <div class="kachel"><div class="l">Verbrauch</div><div class="w">${a.verbrauch ? zahlDe(a.verbrauch, 1) + ' l/100' : '–'}</div></div>
    </div>
    ${!db.fahrzeug.kaufpreis || !db.fixkosten.length ? `<p class="hinweis warn"><span>Für einen vollständigen Privatanteil fehlen noch ${!db.fahrzeug.kaufpreis ? 'Kaufpreis/Kaufdatum' : ''}${!db.fahrzeug.kaufpreis && !db.fixkosten.length ? ' und ' : ''}${!db.fixkosten.length ? 'Fixkosten' : ''}.</span><button class="knopf klein" data-action="nav" data-ziel="mehr">Eintragen</button></p>` : ''}
    <div class="knopf-reihe">
      <button class="knopf" data-action="drucken" data-zeitraum="${zeitraum}">Bericht / PDF</button>
      <button class="knopf" data-action="csv-fahrten" data-zeitraum="${zeitraum}">CSV Fahrten</button>
      <button class="knopf" data-action="csv-kosten" data-zeitraum="${zeitraum}">CSV Kosten</button>
    </div>
    <h3>Monatsabschluss</h3>
    <p class="kleingedruckt" style="margin-top:0">Ein abgeschlossener Monat lässt sich nicht mehr ändern. Speichere danach das PDF als festen Stand.</p>
    ${abschlussMonate.length ? `<div class="liste">${abschlussMonate.map((m) => {
      const ab = db.abschluesse.find((x) => x.monat === m);
      return `<div class="eintrag" style="cursor:default"><div class="e-kopf"><span>${monatName(m)}</span>
        ${ab ? `<button class="knopf klein" data-action="drucken" data-zeitraum="${m}">PDF</button>` : `<button class="knopf klein primaer" data-action="abschliessen" data-monat="${m}">Abschließen</button>`}</div>
        <div class="e-meta">${ab ? `abgeschlossen am ${zeitstempel(ab.am)}` : 'offen'}</div></div>`;
    }).join('')}</div>` : '<p class="kleingedruckt">Sobald ein Monat vorbei ist, kannst du ihn hier abschließen.</p>'}
    <p class="kleingedruckt">Privatanteil = Gesamtkosten × Privat-km ÷ Gesamt-km (Fahrtenbuchmethode). Fixkosten und AfA werden monatsgenau verteilt${S.fahrtenbuchBeginn(db) ? `, gerechnet ab Beginn des Fahrtenbuchs (${monatName(S.fahrtenbuchBeginn(db))})` : ''}. Das ist eine Rechenhilfe, keine Steuerberatung: Bitte lass die Werte von deiner Steuerberatung prüfen.</p>`;
}

async function monatAbschliessenKlick(monat) {
  const luecken = S.lueckenFinden(db).filter((l) => l.nachFahrt.datum.startsWith(monat) || l.vorFahrt.datum.startsWith(monat));
  const ok = await frage({
    titel: `${monatName(monat)} abschließen?`,
    text: `Danach kannst du Fahrten und Kosten aus diesem Monat nicht mehr ändern oder nachtragen.${luecken.length ? `<br><br><strong>Achtung:</strong> Es gibt noch ${luecken.length} Unstimmigkeit(en) im km-Verlauf.` : ''}`,
    ok: 'Abschließen',
  });
  if (!ok) return;
  try {
    S.monatAbschliessen(db, monat);
    speichernUndZeigen();
    toast('Monat abgeschlossen. Jetzt am besten das PDF speichern.');
    setTimeout(() => berichtDrucken(monat), 400);
  } catch (e) { toast(e.message); }
}

// ---------- Bericht (Druck / PDF) ----------

function berichtDrucken(zr) {
  const monate = S.monateImZeitraum(zr);
  const im = (datum) => monate.includes(datum.slice(0, 7));
  const a = S.auswertung(db, zr);
  const fz = db.fahrzeug;
  const fahrten = db.fahrten.filter((f) => im(f.datum)).sort((x, y) => x.kmStart - y.kmStart || x.datum.localeCompare(y.datum));
  const kosten = db.kosten.filter((k) => im(k.datum)).sort((x, y) => x.nr.localeCompare(y.nr));
  const titel = zr.length === 7 ? monatName(zr) : `Jahr ${zr}`;
  const abschluss = zr.length === 7 ? db.abschluesse.find((x) => x.monat === zr) : null;
  const protokoll = [...fahrten.map((f) => ['Fahrt ' + fmtD(f.datum), f, S.FAHRT_FELDER]), ...kosten.map((k) => [k.nr, k, S.KOSTEN_FELDER])]
    .flatMap(([was, e, felder]) => e.historie.filter((h) => h.aktion === 'geaendert' || h.aktion === 'storniert').map((h) => ({ was, h, felder })));

  $('#druck').innerHTML = `
    <h1>Fahrtenbuch · ${esc(titel)}</h1>
    <div class="meta">Fahrzeug: ${esc(fz.bezeichnung || '–')} · Kennzeichen: ${esc(fz.kennzeichen || '–')} · erstellt am ${zeitstempel(S.jetztIso())}
      ${abschluss ? ` · Monat abgeschlossen am ${zeitstempel(abschluss.am)}` : ''}</div>
    <h2>Fahrten</h2>
    <table>
      <tr><th>Datum</th><th>Zeit</th><th>km Start</th><th>km Ende</th><th>km</th><th>Art</th><th>Reiseziel</th><th>Reisezweck</th><th>Geschäftspartner</th><th>Route/Umweg</th><th>Erfasst</th></tr>
      ${fahrten.map((f) => `<tr class="${f.status === 'storniert' ? 'storniert' : ''}">
        <td>${fmtD(f.datum)}</td><td>${esc([f.zeitStart, f.zeitEnde].filter(Boolean).join('–'))}</td>
        <td class="z">${fmtKm(f.kmStart)}</td><td class="z">${fmtKm(f.kmEnde)}</td><td class="z">${f.kmEnde != null ? fmtKm(f.kmEnde - f.kmStart) : 'offen'}</td>
        <td>${S.ARTEN[f.art]}</td><td>${esc(f.ziel)}</td><td>${esc(f.zweck)}</td><td>${esc(f.partner)}</td><td>${esc(f.route)}</td>
        <td>${zeitstempel(f.erfasstAm)}${f.nachtrag ? ' (Nachtrag)' : ''}${f.status === 'storniert' ? ' storniert' : ''}</td></tr>`).join('')}
    </table>
    <h2>Kosten</h2>
    <table>
      <tr><th>Beleg-Nr.</th><th>Datum</th><th>Kategorie</th><th>Betrag</th><th>Liter</th><th>km-Stand</th><th>Bezahlt</th><th>Ort/Notiz</th><th>Erfasst</th></tr>
      ${kosten.map((k) => `<tr class="${k.status === 'storniert' ? 'storniert' : ''}">
        <td>${esc(k.nr)}</td><td>${fmtD(k.datum)}</td><td>${esc(k.kategorie)}</td><td class="z">${euro(k.betrag)}</td>
        <td class="z">${k.liter ? zahlDe(k.liter) : ''}</td><td class="z">${k.km ? fmtKm(k.km) : ''}</td>
        <td>${k.bezahlt === 'privat' ? `privat${k.erstattetAm ? ', erstattet ' + fmtD(k.erstattetAm) : ', offen'}` : 'Firma'}</td>
        <td>${esc(k.ort)}</td><td>${zeitstempel(k.erfasstAm)}${k.status === 'storniert' ? ' storniert' : ''}</td></tr>`).join('')}
    </table>
    <h2>Zusammenfassung</h2>
    <table style="width:auto">
      <tr><td>km gesamt</td><td class="z">${fmtKm(a.kmGesamt)}</td></tr>
      <tr><td>davon geschäftlich / privat / Arbeitsweg</td><td class="z">${fmtKm(a.km.geschaeftlich)} / ${fmtKm(a.km.privat)} / ${fmtKm(a.km.arbeitsweg)}</td></tr>
      <tr><td>Laufende Kosten</td><td class="z">${euro(a.laufend)}</td></tr>
      <tr><td>Fixkosten (anteilig)</td><td class="z">${euro(a.fix)}</td></tr>
      <tr><td>AfA</td><td class="z">${euro(a.afa)}</td></tr>
      <tr><td><strong>Gesamtkosten</strong></td><td class="z"><strong>${euro(a.gesamt)}</strong></td></tr>
      <tr><td>Privatanteil (${prozent(a.anteilPrivat)})</td><td class="z">${euro(a.kostenPrivat)}</td></tr>
      <tr><td>Anteil Arbeitsweg (${prozent(a.anteilArbeitsweg)})</td><td class="z">${euro(a.kostenArbeitsweg)}</td></tr>
    </table>
    <h2>Änderungsprotokoll</h2>
    ${protokoll.length ? `<table><tr><th>Eintrag</th><th>Zeitpunkt</th><th>Aktion</th><th>Änderung</th><th>Grund</th></tr>
      ${protokoll.map(({ was, h, felder }) => `<tr><td>${esc(was)}</td><td>${zeitstempel(h.am)}</td><td>${h.aktion === 'storniert' ? 'storniert' : 'korrigiert'}</td>
        <td>${(h.aenderungen || []).map((x) => `${felder[x.feld] || x.feld}: ${esc(wertText(x.feld, x.alt))} → ${esc(wertText(x.feld, x.neu))}`).join('<br>')}</td><td>${esc(h.grund || '')}</td></tr>`).join('')}</table>`
      : '<p>Keine Korrekturen oder Stornierungen in diesem Zeitraum.</p>'}
    <p class="fuss">Erstellt mit der Fahrtenbuch-App ${VERSION}. Alle Einträge enthalten den Zeitpunkt der Erfassung, Nachträge sind gekennzeichnet, Korrekturen werden protokolliert.</p>`;
  window.print();
}

// ---------- Mehr / Einstellungen ----------

function mehrAnsicht() {
  const fz = db.fahrzeug;
  const afaJahr = fz.kaufpreis && fz.nutzungsdauer ? fz.kaufpreis / fz.nutzungsdauer : 0;
  let afaEnde = '';
  if (fz.kaufdatum && fz.nutzungsdauer) {
    const [y, m] = fz.kaufdatum.split('-').map(Number);
    const e = new Date(y + Number(fz.nutzungsdauer), m - 2, 1);
    afaEnde = `${String(e.getMonth() + 1).padStart(2, '0')}/${e.getFullYear()}`;
  }
  const letzte = db.einstellungen.letzteSicherung;
  return `
    <header class="kopf"><h1>Mehr</h1><span class="unter">Version ${VERSION}</span></header>

    <h3>Fahrzeug</h3>
    <form id="fahrzeug-form" class="karte" autocomplete="off">
      <div class="raster-2">
        <label>Bezeichnung<input name="bezeichnung" value="${esc(fz.bezeichnung)}" placeholder="VW Golf"></label>
        <label>Kennzeichen<input name="kennzeichen" value="${esc(fz.kennzeichen)}" placeholder="K-SD 123"></label>
      </div>
      <div class="raster-2">
        <label>Kaufpreis €<input name="kaufpreis" inputmode="decimal" value="${fz.kaufpreis != null ? Number(fz.kaufpreis).toLocaleString('de-DE') : ''}"></label>
        <label>Kaufdatum<input type="date" name="kaufdatum" value="${esc(fz.kaufdatum)}"></label>
        <label>Nutzungsdauer (Jahre)<input name="nutzungsdauer" inputmode="numeric" value="${fz.nutzungsdauer ?? 6}"></label>
      </div>
      <p class="kleingedruckt" style="margin-top:0">Kaufpreis netto, wenn du vorsteuerabzugsberechtigt bist. Für Pkw gelten in der Regel 6 Jahre Nutzungsdauer.${afaJahr ? ` AfA: ${euro(afaJahr)} pro Jahr${afaEnde ? `, bis ${afaEnde}` : ''}.` : ''}</p>
      <button class="knopf primaer" type="submit">Fahrzeug speichern</button>
    </form>

    <h3>Fixkosten</h3>
    <div class="liste">
      ${db.fixkosten.map((f) => `<div class="eintrag" style="cursor:default"><div class="e-kopf"><span>${esc(f.bezeichnung)}</span><span>${euro(f.betrag)} ${{ monatlich: 'mtl.', vierteljaehrlich: 'vierteljährl.', jaehrlich: 'jährl.' }[f.turnus]}</span></div>
        <div class="e-meta">${f.ab ? `ab ${f.ab.slice(5)}/${f.ab.slice(0, 4)}` : ''} ${f.bis ? `bis ${f.bis.slice(5)}/${f.bis.slice(0, 4)}` : ''} <button class="knopf klein gefahr" data-action="fix-loeschen" data-id="${f.id}">Entfernen</button></div></div>`).join('') || '<div class="eintrag" style="cursor:default"><span class="e-unter">Noch keine Fixkosten, z. B. Versicherung oder Kfz-Steuer.</span></div>'}
    </div>
    <form id="fix-form" class="karte" style="margin-top:8px" autocomplete="off">
      <div class="raster-2">
        <label>Bezeichnung<input name="bezeichnung" list="dl-fix" placeholder="Kfz-Versicherung" required></label>
        <label>Betrag €<input name="betrag" inputmode="decimal" required></label>
      </div>
      <datalist id="dl-fix"><option value="Kfz-Versicherung"><option value="Kfz-Steuer"><option value="ADAC / Schutzbrief"><option value="Garage / Stellplatz"><option value="Finanzierungszinsen"></datalist>
      <label>Turnus<select name="turnus"><option value="jaehrlich">jährlich</option><option value="vierteljaehrlich">vierteljährlich</option><option value="monatlich">monatlich</option></select></label>
      <div class="raster-2">
        <label>ab Monat <span class="optional">(opt.)</span><input type="month" name="ab"></label>
        <label>bis Monat <span class="optional">(opt.)</span><input type="month" name="bis"></label>
      </div>
      <button class="knopf" type="submit">+ Fixkosten hinzufügen</button>
    </form>

    <h3>Favoriten (Kurzwörter)</h3>
    <p class="kleingedruckt" style="margin-top:0">Sagst du das Kurzwort, füllt die App Ziel, Zweck und Partner aus.</p>
    <div class="liste">
      ${db.favoriten.map((f) => `<div class="eintrag" style="cursor:default"><div class="e-kopf"><span>„${esc(f.kurz)}“</span><button class="knopf klein gefahr" data-action="fav-loeschen" data-id="${f.id}">Entfernen</button></div>
        <div class="e-unter">${esc([f.ziel, f.zweck, f.partner].filter(Boolean).join(' · '))}</div></div>`).join('') || '<div class="eintrag" style="cursor:default"><span class="e-unter">Noch keine Favoriten.</span></div>'}
    </div>
    <form id="fav-form" class="karte" style="margin-top:8px" autocomplete="off">
      <div class="raster-2">
        <label>Kurzwort<input name="kurz" placeholder="Meier" required></label>
        <label>Reiseziel<input name="ziel" list="dl-ziel" placeholder="Köln, Hauptstr. 5"></label>
        <label>Reisezweck<input name="zweck" list="dl-zweck" placeholder="Beratung"></label>
        <label>Geschäftspartner<input name="partner" list="dl-partner" placeholder="Kundin Meier"></label>
      </div>
      <button class="knopf" type="submit">+ Favorit hinzufügen</button>
    </form>

    <h3>Voreinstellung Kosten</h3>
    <div class="wahl" role="radiogroup" aria-label="Standard bezahlt">
      <label><input type="radio" name="standardBezahlt" value="firma" data-action="std-bezahlt" ${db.einstellungen.standardBezahlt !== 'privat' ? 'checked' : ''}><span>Firma bezahlt</span></label>
      <label><input type="radio" name="standardBezahlt" value="privat" data-action="std-bezahlt" ${db.einstellungen.standardBezahlt === 'privat' ? 'checked' : ''}><span>Privat ausgelegt</span></label>
    </div>

    <h3>Daten sichern</h3>
    <div class="karte">
      <p>Deine Daten liegen nur auf diesem Handy, in diesem Browser. Lade regelmäßig eine Sicherung herunter (z. B. in Google Drive oder per Mail an dich).</p>
      <p class="kleingedruckt">${letzte ? `Letzte Sicherung: ${zeitstempel(letzte)}` : 'Noch keine Sicherung erstellt.'} · <span id="speicher-status"></span></p>
      <div class="knopf-reihe">
        <button class="knopf primaer" data-action="sicherung">Sicherung herunterladen</button>
        <label class="knopf" style="margin:0;color:var(--text)">Sicherung einspielen<input type="file" id="restore" accept=".json,application/json" style="display:none"></label>
      </div>
    </div>

    <h3>Datenschutz und Hinweise</h3>
    <div class="karte kleingedruckt" style="margin-top:0">
      <p>Die App speichert nichts auf einem Server. Für die Spracheingabe nutzt Chrome die Google-Spracherkennung, dabei wird das Gesprochene an Google übertragen. Alternativ kannst du über die Tastatur diktieren (Gboard mit Offline-Sprachpaket).</p>
      <p>Die Auswertung ist eine Rechenhilfe, keine Steuerberatung. Ob dein Fahrtenbuch vom Finanzamt anerkannt wird, kläre bitte mit deiner Steuerberatung.</p>
    </div>`;
}

function mehrBinden() {
  $('#fahrzeug-form').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const preis = String(f.kaufpreis.value).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    db.fahrzeug = {
      bezeichnung: f.bezeichnung.value.trim(),
      kennzeichen: f.kennzeichen.value.trim().toUpperCase(),
      kaufpreis: preis ? Number(preis) : null,
      kaufdatum: f.kaufdatum.value,
      nutzungsdauer: Number(f.nutzungsdauer.value) || 6,
    };
    speichernUndZeigen();
    toast('Fahrzeug gespeichert.');
  };
  $('#fix-form').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const betrag = Number(String(f.betrag.value).replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!betrag) { toast('Bitte einen Betrag eintragen.'); return; }
    db.fixkosten.push({ id: S.neueId(), bezeichnung: f.bezeichnung.value.trim(), betrag, turnus: f.turnus.value, ab: f.ab.value, bis: f.bis.value });
    speichernUndZeigen();
    toast('Fixkosten hinzugefügt.');
  };
  $('#fav-form').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    db.favoriten.push({ id: S.neueId(), kurz: f.kurz.value.trim().toLowerCase(), ziel: f.ziel.value.trim(), zweck: f.zweck.value.trim(), partner: f.partner.value.trim() });
    speichernUndZeigen();
    toast('Favorit hinzugefügt.');
  };
  $('#restore').onchange = async (e) => {
    const datei = e.target.files[0];
    if (!datei) return;
    try {
      const neu = S.sicherungLesen(await datei.text());
      const ok = await frage({ titel: 'Sicherung einspielen?', text: `Die Sicherung enthält ${neu.fahrten.length} Fahrten und ${neu.kosten.length} Ausgaben. <strong>Alle aktuellen Daten auf diesem Gerät werden ersetzt.</strong>`, ok: 'Ersetzen', gefahr: true });
      if (!ok) return;
      db = neu;
      speichernUndZeigen();
      toast('Sicherung eingespielt.');
    } catch (err) {
      toast('Fehler: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
  const st = $('#speicher-status');
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((p) => { st.textContent = p ? 'Speicher ist dauerhaft geschützt' : 'Speicher nicht dauerhaft geschützt: App auf den Startbildschirm legen hilft'; });
  }
}

// ---------- Dateien herunterladen ----------

function herunterladen(name, inhalt, typ) {
  const blob = new Blob([inhalt], { type: typ });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function sicherungHerunterladen() {
  const jetzt = new Date();
  const stempel = `${S.heuteIso()}_${String(jetzt.getHours()).padStart(2, '0')}${String(jetzt.getMinutes()).padStart(2, '0')}`;
  herunterladen(`fahrtenbuch-sicherung_${stempel}.json`, S.sicherungErstellen(db), 'application/json');
  db.einstellungen.letzteSicherung = S.jetztIso();
  speichernUndZeigen();
  toast('Sicherung heruntergeladen.');
}

// ---------- Klicks (Event-Delegation) ----------

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { navigieren(nav.dataset.nav); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'nav') { dialogSchliessen(); navigieren(el.dataset.ziel); }
  else if (a === 'fahrt-beenden') { const o = S.offeneFahrt(db); if (o) fahrtFormular({ modus: 'ende', fahrt: o }); }
  else if (a === 'nachholen') fahrtFormular({ modus: 'komplett', vorlage: { datum: S.heuteIso(), kmStart: S.letzterKmStand(db) } });
  else if (a === 'kosten-neu') kostenFormular({});
  else if (a === 'beleg-text') belegTextDialog();
  else if (a === 'hilfe') hilfeDialog();
  else if (a === 'kosten-offen') { kostenFilter = 'offen'; navigieren('kosten'); }
  else if (a === 'kfilter') { kostenFilter = el.value; render(); }
  else if (a === 'fahrt-detail') fahrtDetail(el.dataset.id);
  else if (a === 'kosten-detail') kostenDetail(el.dataset.id);
  else if (a === 'luecke-fuellen') fahrtFormular({ modus: 'komplett', vorlage: { datum: el.dataset.datum, kmStart: +el.dataset.von, kmEnde: +el.dataset.bis, art: 'privat' } });
  else if (a === 'alle-erstattet') {
    const ok = await frage({ titel: 'Alle als erstattet markieren?', text: `${S.offenZuErstatten(db).length} Ausgaben werden mit dem heutigen Datum als erstattet vermerkt.`, ok: 'Ja, erstattet' });
    if (!ok) return;
    for (const k of S.offenZuErstatten(db)) S.kostenErstattet(db, k.id);
    speichernUndZeigen();
    toast('Erstattung vermerkt.');
  }
  else if (a === 'drucken') berichtDrucken(el.dataset.zeitraum);
  else if (a === 'csv-fahrten') herunterladen(`fahrtenbuch-fahrten_${el.dataset.zeitraum}.csv`, S.fahrtenCsv(db, el.dataset.zeitraum), 'text/csv;charset=utf-8');
  else if (a === 'csv-kosten') herunterladen(`fahrtenbuch-kosten_${el.dataset.zeitraum}.csv`, S.kostenCsv(db, el.dataset.zeitraum), 'text/csv;charset=utf-8');
  else if (a === 'abschliessen') monatAbschliessenKlick(el.dataset.monat);
  else if (a === 'sicherung') sicherungHerunterladen();
  else if (a === 'std-bezahlt') { db.einstellungen.standardBezahlt = el.value; speichernUndZeigen(); }
  else if (a === 'fix-loeschen') {
    const f = db.fixkosten.find((x) => x.id === el.dataset.id);
    if (f && await frage({ titel: `„${f.bezeichnung}“ entfernen?`, text: 'Die Fixkosten fallen dann auch aus früheren Auswertungen heraus. Wenn sie nur ab jetzt wegfallen, trag lieber ein „bis“-Datum ein.', ok: 'Entfernen', gefahr: true })) {
      db.fixkosten = db.fixkosten.filter((x) => x.id !== f.id); speichernUndZeigen();
    }
  }
  else if (a === 'fav-loeschen') { db.favoriten = db.favoriten.filter((x) => x.id !== el.dataset.id); speichernUndZeigen(); }
});

// Dialog bei Klick auf den Hintergrund schließen
for (const id of ['dialog', 'dialog2']) {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target.id !== id) return;
    const r = e.target.getBoundingClientRect();
    const draussen = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (draussen) dialogSchliessen(id);
  });
}

// Andere Tabs/Fenster: Daten neu laden
window.addEventListener('storage', () => { db = S.laden(); render(); });
window.addEventListener('afterprint', () => { $('#druck').innerHTML = ''; });

// ---------- Start ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
