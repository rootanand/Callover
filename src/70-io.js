/* ============================================================================
   Callover — 70-io.js
   TDD.md §6.1-§6.2 (reading the firm's files), §6.7 (the chamber profile),
   §7.2.4 (remembered spellings), §7.3 (export).

   Everything here is local. Files are read by the browser from the user's own
   disk; nothing is transmitted, because there is nowhere for it to be sent.
   The only persistence is IndexedDB and one localStorage prefix, both listed
   in Settings and both erasable in one action (§8.1a).
   ========================================================================= */
;(function (CO) {
  'use strict';

  const XL = () => globalThis.XLSX;

  /* ======================================================================
     1.  READING TABLES  — §6.1, §6.2
     ================================================================== */

  /* One code path for csv, xlsx and tsv, so a firm's file works whatever it
     was saved as. Returns a rectangular array of strings. */
  function sheetToRows(data, kind) {
    const X = XL();
    if (!X) throw new Error('The spreadsheet reader was not loaded.');
    const wb = kind === 'string'
      ? X.read(data, { type: 'string', raw: false })
      : X.read(data, { type: 'array', raw: false, cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false })
      .map(r => r.map(c => (c == null ? '' : String(c).trim())));
  }

  const headerNorm = s => CO.upperClean(s).replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

  /* Score a header cell against a field's known spellings. Fuzzy, because
     firms label things their own way — "NAME OF THE ADVOCATE", "Bar Enrolment",
     "Adv. Name". */
  function headerScore(cell, patterns) {
    const h = headerNorm(cell);
    if (!h) return 0;
    let best = 0;
    for (const p of patterns) {
      const P = headerNorm(p);
      const s = Math.max(
        CO.ratio(h, P),
        CO.jaroWinkler(h, P),
        h === P ? 1 : 0,
        h.includes(P) && P.length >= 4 ? 0.9 : 0
      );
      if (s > best) best = s;
    }
    return best;
  }

  /* Map the header row onto our fields. Returns { map, headerRow, confidence }.
     The mapping is ALWAYS shown to the user and always overridable before the
     run (§6.1) — a silent mis-mapping is worse than no mapping. */
  /* Assign columns to fields by BEST PAIRING OVERALL, not field by field in
     declaration order.

     The old loop walked the spec in order and let each field claim the best
     column not already taken. Because caseType is declared before causeTitle,
     a register headed "Cause Title" had that column claimed by caseType — the
     two strings are similar enough to pass the threshold — and the real cause
     title was then left unmapped, disappearing from every confirm card.

     Scoring every (field, column) pair and taking them strongest-first means a
     column goes to the field that actually wants it most: "Cause Title" scores
     1.00 against causeTitle and about 0.79 against caseType, so causeTitle now
     wins it regardless of declaration order. */
  function detectColumns(rows, spec) {
    if (!rows.length) return { map: {}, headerRow: -1, scores: {} };
    const head = rows[0];
    const pairs = [];
    for (const [field, patterns] of Object.entries(spec))
      head.forEach((cell, i) => {
        const s = headerScore(cell, patterns);
        if (s >= CO.HEADER_MATCH_MIN) pairs.push({ field, i, s });
      });
    /* Strongest pairing first; ties keep declaration order so the result is
       stable for a given file rather than depending on object iteration. */
    pairs.sort((a, b) => b.s - a.s);

    const map = {}, scores = {}, usedCol = new Set();
    for (const p of pairs) {
      if (map[p.field] != null || usedCol.has(p.i)) continue;
      map[p.field] = p.i; scores[p.field] = p.s; usedCol.add(p.i);
    }
    return { map, headerRow: Object.keys(map).length ? 0 : -1, scores };
  }

  /* --- 1a. Advocates --------------------------------------------------- */

  function parseAdvocateRows(rows, override) {
    const det = detectColumns(rows, CO.ADVOCATE_HEADERS);
    const map = Object.assign({}, det.map, override || {});
    /* No header row detected — the first row already looks like data. Column A
       is the name (T8-03). */
    const headerRow = (map.name == null) ? -1 : det.headerRow;
    if (map.name == null) map.name = 0;

    const out = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[map.name] || '').trim();
      if (!name) continue;
      if (/^(s\.?\s*no\.?|sl\.?\s*no\.?|#)$/i.test(name)) continue;
      out.push(makeAdvocate(name,
        map.enrolment != null ? row[map.enrolment] : null,
        map.role != null ? row[map.role] : null));
    }
    return { advocates: dedupeAdvocates(out), mapping: map, scores: det.scores, headerRow };
  }

  let advSeq = 0;
  function makeAdvocate(name, enrolment, role) {
    return {
      id: 'adv' + (++advSeq).toString(36),
      name: String(name).trim(),
      enrolment: enrolment ? String(enrolment).trim() : null,
      role: role ? String(role).trim() : null,
      parsed: CO.splitName(name)
    };
  }

  function dedupeAdvocates(list) {
    const seen = new Set(), out = [];
    for (const a of list) {
      const k = CO.upperClean(a.name).replace(/[^A-Z]/g, '');
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(a);
    }
    return out;
  }

  /* A textarea or a .txt file: one advocate per line. */
  function parseAdvocateText(text) {
    const out = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      .filter(s => !/^(advocate|name|counsel)s?( name)?$/i.test(s))
      .map(s => {
        /* Tolerate "Name, enrolment, role" on one line. */
        const parts = s.split(/\s*[,\t;|]\s*/);
        return makeAdvocate(parts[0], parts[1] || null, parts[2] || null);
      });
    return { advocates: dedupeAdvocates(out), mapping: { name: 0 }, scores: {}, headerRow: -1 };
  }

  /* --- 1b. Case register ------------------------------------------------ */

  function parseRegisterRows(rows, override) {
    const det = detectColumns(rows, CO.REGISTER_HEADERS);
    const map = Object.assign({}, det.map, override || {});
    const head = rows[0] || [];
    const cases = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row.some(c => c)) continue;
      const get = f => (map[f] != null ? (row[map[f]] || '').trim() : '');

      /* Every original column is preserved verbatim, because the export
         echoes the firm's own schema back to them (§6.2, T8-05). */
      const raw = {};
      head.forEach((h, i) => { raw[h || `Column ${i + 1}`] = row[i] || ''; });

      const caseType = get('caseType'), caseNo = get('caseNo'), year = get('year');
      let caseKey = '';
      if (caseType && caseNo && year) caseKey = CO.caseKeyFromParts(caseType, caseNo, year);
      else {
        /* Some registers hold the whole number in one cell. */
        const whole = get('caseNo') || row.find(c => /\d{1,6}\s*[\/]\s*\d{4}/.test(c)) || '';
        if (whole) caseKey = CO.normCaseNo(whole);
      }
      if (!caseKey) continue;

      cases.push({
        id: 'rc' + r, diaryNo: get('diaryNo'), caseType, caseNo, year, caseKey,
        cnr: get('cnr') || null, court: get('court'), causeTitle: get('causeTitle'),
        partyName: get('partyName'), mobile: get('mobile'), counselFor: get('counselFor'),
        attendedBy: get('attendedBy'), nextDate: get('nextDate'), nextStage: get('nextStage'),
        remarks: get('remarks'), status: get('status'), reference: get('reference'),
        fees: get('fees'), date: get('date'), statusRemark: get('statusRemark'),
        raw
      });
    }
    return { cases, mapping: map, scores: det.scores, columns: head };
  }

  /* --- 1c. Files -------------------------------------------------------- */

  async function readAdvocateFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.txt')) return parseAdvocateText(await file.text());
    if (name.endsWith('.csv') || name.endsWith('.tsv'))
      return parseAdvocateRows(sheetToRows(await file.text(), 'string'));
    return parseAdvocateRows(sheetToRows(new Uint8Array(await file.arrayBuffer()), 'array'));
  }

  async function readRegisterFile(file) {
    const name = (file.name || '').toLowerCase();
    const rows = (name.endsWith('.csv') || name.endsWith('.tsv'))
      ? sheetToRows(await file.text(), 'string')
      : sheetToRows(new Uint8Array(await file.arrayBuffer()), 'array');
    const parsed = parseRegisterRows(rows);
    parsed.rowCount = parsed.cases.length;
    parsed.sourceFilename = file.name;
    parsed.uploadedAt = new Date().toISOString();
    return parsed;
  }

  /* ======================================================================
     2.  REGISTER STALENESS  — §6.7.2

     A stale register fails invisibly: fewer matches looks exactly like a quiet
     day. Callover never refuses to run on one. It refuses to let the user
     forget. (Decision D31.)
     ================================================================== */
  function registerAge(meta, now) {
    if (!meta || !meta.uploadedAt) return null;
    const days = Math.floor((( now || new Date()) - new Date(meta.uploadedAt)) / 86400000);
    const level = days >= CO.REGISTER_STALER_DAYS ? 'red'
                : days >= CO.REGISTER_STALE_DAYS ? 'amber' : 'ok';
    return {
      days, level, rowCount: meta.rowCount || 0,
      text: level === 'ok' ? null
        : `Your register was loaded ${days} days ago and has ${meta.rowCount || 0} matters. ` +
          `Matters filed since then cannot be matched by case number.`
    };
  }

  /* ======================================================================
     3.  THE CHAMBER PROFILE  — §6.7

     IndexedDB, not localStorage: a register of a few thousand matters exceeds
     the 5 MB ceiling, and localStorage fails by throwing mid-write, which can
     leave half a profile behind. (Decision D30.)
     ================================================================== */

  const store = {
    open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('No local storage available in this browser.'));
        const req = indexedDB.open(CO.STORE.DB_NAME, CO.STORE.DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CO.STORE.STORE_NAME))
            db.createObjectStore(CO.STORE.STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async put(key, value) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(CO.STORE.STORE_NAME, 'readwrite');
        tx.objectStore(CO.STORE.STORE_NAME).put(value, key);
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(CO.STORE.STORE_NAME, 'readonly');
        const r = tx.objectStore(CO.STORE.STORE_NAME).get(key);
        r.onsuccess = () => { db.close(); res(r.result == null ? null : r.result); };
        r.onerror = () => { db.close(); rej(r.error); };
      });
    },
    async keys() {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(CO.STORE.STORE_NAME, 'readonly');
        const r = tx.objectStore(CO.STORE.STORE_NAME).getAllKeys();
        r.onsuccess = () => { db.close(); res(r.result || []); };
        r.onerror = () => { db.close(); rej(r.error); };
      });
    },
    async clear() {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(CO.STORE.STORE_NAME, 'readwrite');
        tx.objectStore(CO.STORE.STORE_NAME).clear();
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      });
    }
  };

  const profile = {
    async save(p) {
      const rec = Object.assign({ version: 1 }, p, { savedAt: new Date().toISOString() });
      await store.put(CO.STORE.PROFILE_KEY, rec);
      return rec;
    },
    async load() { return store.get(CO.STORE.PROFILE_KEY); },

    /* Export and import as one JSON file. This is how a chamber sets up a
       second machine, or hands the profile to a junior, and it means the
       profile is never trapped inside one browser (§6.7.1). */
    toJSON(p) { return JSON.stringify(Object.assign({ callover: 'chamber-profile', version: 1 }, p), null, 2); },
    fromJSON(text) {
      const o = JSON.parse(text);
      if (!o || o.callover !== 'chamber-profile')
        throw new Error('That is not a Callover chamber profile file.');
      return o;
    },

    /* Erase must remove EVERY Callover key, and be verifiable by enumeration
       rather than by trust (T14-06). */
    async erase() {
      const removed = { indexedDB: [], localStorage: [] };
      try {
        removed.indexedDB = await store.keys();
        await store.clear();
      } catch { /* nothing stored yet */ }
      if (typeof localStorage !== 'undefined') {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith(CO.STORE.CONFIRM_PREFIX) || k === CO.STORE.SETTINGS_KEY)) {
            removed.localStorage.push(k);
            localStorage.removeItem(k);
          }
        }
      }
      return removed;
    },

    /* Enumerate what is stored, for the Settings panel. A claim about what is
       kept is only credible if the user can see the actual list (§8.1a). */
    async inventory() {
      const inv = { profile: null, ledger: null, confirmations: [] };
      try { inv.profile = await store.get(CO.STORE.PROFILE_KEY); } catch { /* none */ }
      try { inv.ledger = await store.get(CO.STORE.LEDGER_KEY); } catch { /* none */ }
      if (typeof localStorage !== 'undefined')
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(CO.STORE.CONFIRM_PREFIX))
            inv.confirmations.push({ key: k, value: localStorage.getItem(k) === 'true' });
        }
      return inv;
    }
  };

  /* §6.7.3 — the ledger. Off by default even when the profile is on, because
     it is the only structure that accumulates client data the user did not
     deliberately upload. Its absence degrades nothing. */
  const ledger = {
    async load() { return (await store.get(CO.STORE.LEDGER_KEY)) || []; },
    async save(entries) {
      const capped = entries.slice(-CO.LEDGER_CAP);
      await store.put(CO.STORE.LEDGER_KEY, capped);
      return capped;
    },
    async record(results) {
      const existing = await this.load();
      const byKey = new Map(existing.map(e => [e.caseKey, e]));
      for (const m of results.matches.concat(results.adjourned)) {
        for (const k of m.item.caseKeys || []) {
          const e = byKey.get(k) || {
            caseKey: k, causeTitle: '', parties: '', advocate: '', court: '', dates: []
          };
          e.causeTitle = e.causeTitle || [m.item.petitioner, m.item.respondent].filter(Boolean).join(' vs ');
          e.parties    = e.parties    || m.item.petitioner || '';
          e.advocate   = e.advocate   || (m.advocate ? m.advocate.name : '');
          e.court      = e.court      || m.item.court || '';
          const d = m.adjourned ? `reposted ${m.adjourned.repostedTo}` : (results.date || '');
          if (d && !e.dates.includes(d)) e.dates.push(d);
          byKey.set(k, e);
        }
      }
      return this.save([...byKey.values()]);
    },
    async erase() { await store.put(CO.STORE.LEDGER_KEY, []); return true; }
  };

  /* ======================================================================
     4.  REMEMBERED SPELLINGS  — §7.2.4

     localStorage holds confirmed spellings ONLY, all under one prefix. T10-04
     fails the build if a run writes any other key.
     ================================================================== */
  const memory = {
    all() {
      const out = {};
      if (typeof localStorage === 'undefined') return out;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CO.STORE.CONFIRM_PREFIX))
          out[k.slice(CO.STORE.CONFIRM_PREFIX.length)] = localStorage.getItem(k) === 'true';
      }
      return out;
    },
    set(key, yes) {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(CO.STORE.CONFIRM_PREFIX + key, yes ? 'true' : 'false');
    },
    /* A wrong Yes must be undoable (§7.2.4). */
    revoke(key) {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(CO.STORE.CONFIRM_PREFIX + key);
    }
  };

  /* ======================================================================
     5.  EXPORT  — §7.3
     ================================================================== */

  const tierLabel = { auto: 'Matched', review: 'To confirm', weak: 'Weak' };

  function matchRow(m, results, warning) {
    const it = m.item, rc = m.registerCase;
    const row = {
      Date: results.date || '',
      Court: it.court || '',
      Hall: it.hall || '',
      ItemNo: (it.itemNo || '') + (it.itemNoInherited ? ' (carried)' : ''),
      CaseNumber: (it.caseNumbers || []).join('; '),
      CauseTitle: [it.petitioner, it.respondent].filter(Boolean).join(' -Vs- '),
      Petitioner: it.petitioner || '',
      Respondent: it.respondent || '',
      FirmAdvocate: m.advocate ? m.advocate.name : (m.registerAdvocate || ''),
      PrintedName: m.matchedText || '',
      MatchRole: m.identifiedBy && m.identifiedBy !== 'name'
                   ? (m.identifiedBy === 'enrolment'
                       ? 'Matched on your enrolment number'
                       : 'Matched on the case number — no advocate name readable')
               : m.matchRole === 'counsel' ? 'Appearing as counsel'
               : m.matchRole === 'party'   ? 'A party to this matter — not counsel on it'
               : 'Found on the page, but not where counsel names sit',
      Side: m.side || '',
      SideDetail: m.sideDetail || '',
      Tier: tierLabel[m.tier] || m.tier,
      Confidence: m.confidence != null ? m.confidence.toFixed(3) : '',
      Signals: (m.signals || []).map(s => s.kind).join(', '),
      DiaryNo: rc ? (rc.diaryNo || '') : '',
      NextStage: rc ? (rc.nextStage || '') : '',
      Adjourned: m.adjourned ? 'YES — not being heard today' : '',
      RepostedTo: m.adjourned
        ? [m.adjourned.repostedTo, m.adjourned.repostedTime].filter(Boolean).join(' at ') +
          (m.adjourned.dateConfidence === 'inferred' ? ' (date inferred — confirm)' : '')
        : '',
      SourceFile: it.sourceFile || '',
      SourceMarkedOfficial: it.sourceIsOfficial ? 'Marked official by user' : 'Uploaded',
      PageNo: it.page || '',
      WasOCR: m.wasOCR ? 'picture-read' : 'text layer',
      RegisterWarning: warning || ''
    };
    /* Echo the firm's own register columns back, every one of them (T8-05).
       They are prefixed, so a register column called "Court" or "Date" cannot
       collide with ours — testing the UNPREFIXED name for a collision silently
       dropped exactly the five columns whose names we happen to share, which
       are the five a firm is most likely to look for. */
    if (rc && rc.raw) for (const [k, v] of Object.entries(rc.raw)) row['Register: ' + k] = v;
    return row;
  }

  function buildTables(results, staleWarning) {
    const warn = staleWarning && staleWarning.text ? staleWarning.text : '';
    const all = results.matches.concat(results.adjourned);
    const rows = all.map(m => matchRow(m, results, warn));

    const columns = [...CO.EXPORT_COLUMNS];
    for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);

    const byAdvocate = [];
    for (const b of results.views.byAdvocate)
      for (const m of b.matches)
        byAdvocate.push(Object.assign({ Advocate: b.advocate.name }, matchRow(m, results, warn)));

    const byCourt = [];
    for (const c of results.views.byCourt)
      for (const h of c.halls)
        for (const m of h.matches)
          byCourt.push(Object.assign({ Court: c.court, Hall: h.hall }, matchRow(m, results, warn)));

    const byCase = results.views.byCase.map(c => Object.assign({
      Advocates: c.advocates.join(', ')
    }, matchRow(c.matches[0], results, warn)));

    const adjourned = results.adjourned.map(m => matchRow(m, results, warn));
    for (const n of results.noticeOnly || [])
      adjourned.push({
        Date: results.date || '', CaseNumber: n.caseKey,
        CauseTitle: n.registerCase ? n.registerCase.causeTitle : (n.ledgerEntry ? n.ledgerEntry.causeTitle : ''),
        DiaryNo: n.registerCase ? n.registerCase.diaryNo : '',
        FirmAdvocate: n.registerCase ? n.registerCase.attendedBy : '',
        Adjourned: 'YES — not on any cause list you loaded',
        RepostedTo: [n.reposted.repostedTo, n.reposted.repostedTime].filter(Boolean).join(' at '),
        SourceFile: n.reposted.sourceFile, PageNo: n.reposted.page,
        Signals: 'identified from your ' + n.identifiedFrom,
        RegisterWarning: warn
      });

    const summary = [
      ['Callover', 'matters listed on ' + (results.date || 'the selected date')],
      ['Generated', new Date().toISOString()],
      ['Matched', results.counts.auto],
      ['To confirm', results.counts.review],
      ['Weak, hidden by default', results.counts.weak],
      ['Adjourned — NOT being heard', results.counts.adjourned],
      ['Courts involved', results.counts.courts],
      ['Pages read', results.counts.pages],
      ['Pages picture-read', results.counts.ocrPages],
      ['', ''],
      ['Nothing left this device.', 'No file was uploaded anywhere. Matching used fixed published rules, not a model.']
    ];
    if (warn) summary.splice(2, 0, ['REGISTER WARNING', warn]);
    for (const b of results.badPages)
      summary.push(['Page not read cleanly', `${b.file} page ${b.page} — ${b.why}`]);
    for (const n of results.notes) summary.push([n.level.toUpperCase(), n.text]);

    return { rows, columns, byAdvocate, byCourt, byCase, adjourned, summary };
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  const stamp = d => (d || new Date().toISOString().slice(0, 10)).replace(/-/g, '');

  const exporter = {
    csv(results, staleWarning) {
      const t = buildTables(results, staleWarning);
      const X = XL();
      const ws = X.utils.json_to_sheet(t.rows, { header: t.columns });
      const csv = X.utils.sheet_to_csv(ws);
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
               `callover-${stamp(results.date)}.csv`);
    },

    xlsx(results, staleWarning) {
      const t = buildTables(results, staleWarning);
      const X = XL();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(t.summary), 'Run summary');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(t.rows, { header: t.columns }), 'Consolidated');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(t.byAdvocate), 'By advocate');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(t.byCourt), 'By court');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(t.byCase), 'By case');
      if (t.adjourned.length)
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(t.adjourned), 'Adjourned');
      const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
      download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
               `callover-${stamp(results.date)}.xlsx`);
    },

    /* PDF is what actually gets carried into court and handed to a junior, so
       it is laid out as an attendance sheet rather than as a dump of the
       spreadsheet: what is adjourned first, then the morning by court and
       hall, then the questions still outstanding. */
    pdf(results, staleWarning, opts) {
      const t = buildTables(results, staleWarning);
      const J = globalThis.jspdf && globalThis.jspdf.jsPDF;
      if (!J) throw new Error('The PDF writer was not loaded.');
      const doc = new J({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const P = CO.PALETTE;
      const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const chamber = (opts && opts.chamberName) || '';
      let y = 44;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...rgb(P.ink));
      doc.text('CALLOVER', 40, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...rgb(P.muted));
      doc.text(`Matters listed on ${results.date || '—'}${chamber ? ' · ' + chamber : ''}`, 40, y + 15);
      doc.text('Nothing left this device. No file was uploaded anywhere.', W - 40, y + 15, { align: 'right' });
      y += 32;

      doc.setDrawColor(...rgb(P.rule)); doc.line(40, y, W - 40, y); y += 18;

      doc.setFontSize(11); doc.setTextColor(...rgb(P.ink));
      const c = results.counts;
      doc.text(`${c.auto} matched   ·   ${c.review} to confirm   ·   ${c.weak} weak (hidden)   ·   ` +
               `${c.adjourned} adjourned   ·   ${c.courts} court(s)   ·   ${c.pages} pages read`, 40, y);
      y += 20;

      if (staleWarning && staleWarning.text) {
        doc.setFillColor(...rgb(P.amber)); doc.rect(40, y - 10, W - 80, 22, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(staleWarning.text, 48, y + 4);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...rgb(P.ink));
        y += 30;
      }

      const table = (title, head, body, headColour) => {
        if (!body.length) return;
        doc.autoTable({
          head: [head], body, startY: y + 16,
          margin: { left: 40, right: 40 },
          styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: rgb(P.ink), lineColor: rgb(P.rule), lineWidth: 0.5 },
          headStyles: { fillColor: rgb(headColour || P.ink), textColor: [244, 241, 232], fontStyle: 'bold', fontSize: 7.5 },
          alternateRowStyles: { fillColor: [250, 247, 239] },
          didDrawPage: () => {
            doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...rgb(P.ink));
            doc.text(title, 40, doc.lastAutoTable ? y + 8 : y + 8);
          }
        });
        y = doc.lastAutoTable.finalY + 22;
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 44; }
      };

      /* Adjourned goes FIRST and stays visually distinct: these are the
         matters a junior must NOT be sent to (§6.6.1 rule 2). */
      if (t.adjourned.length)
        table('NOT BEING HEARD TODAY — adjourned', ['Case number', 'Cause title', 'Diary', 'Reposted to', 'Source'],
          t.adjourned.map(r => [r.CaseNumber, r.CauseTitle, r.DiaryNo, r.RepostedTo, r.SourceFile]), P.red);

      table('The morning, by court and hall', ['Court', 'Hall', 'Item', 'Case number', 'Cause title', 'Advocate', 'Role', 'Side'],
        t.byCourt.filter(r => r.Tier === 'Matched' || r.Tier === 'To confirm')
          .map(r => [r.Court, r.Hall, r.ItemNo, r.CaseNumber, r.CauseTitle, r.FirmAdvocate, r.MatchRole, r.Side]), P.green);

      table('By advocate', ['Advocate', 'Item', 'Case number', 'Cause title', 'Court', 'Role', 'Status'],
        t.byAdvocate.map(r => [r.Advocate, r.ItemNo, r.CaseNumber, r.CauseTitle, r.Court, r.MatchRole, r.Tier]));

      const toConfirm = results.matches.filter(m => m.tier === 'review');
      if (toConfirm.length)
        table('Still to confirm', ['Printed as', 'Your advocate', 'Case number', 'Cause title', 'Why it is uncertain'],
          toConfirm.map(m => [
            m.matchedText, m.advocate ? m.advocate.name : '—',
            (m.item.caseNumbers || []).join('; '),
            [m.item.petitioner, m.item.respondent].filter(Boolean).join(' -Vs- '),
            (m.evidence.rows.find(r => r.field === 'advocate') || {}).note || ''
          ]), P.amber);

      if (results.badPages.length)
        table('Pages that could not be read cleanly', ['File', 'Page', 'What went wrong'],
          results.badPages.map(b => [b.file, b.page, b.why]), P.amber);

      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(...rgb(P.muted));
        doc.text(`Callover · page ${i} of ${pages} · generated ${new Date().toLocaleString()}`,
                 W / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' });
      }
      doc.save(`callover-${stamp(results.date)}.pdf`);
    },

    print() { globalThis.print(); }
  };

  CO.io = {
    sheetToRows, headerScore, detectColumns,
    parseAdvocateRows, parseAdvocateText, parseRegisterRows,
    readAdvocateFile, readRegisterFile, makeAdvocate, dedupeAdvocates,
    registerAge, store, profile, ledger, memory,
    buildTables, matchRow, exporter, download
  };

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
