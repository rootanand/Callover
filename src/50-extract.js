/* ============================================================================
   Callover — 50-extract.js
   TDD.md §5. PDF -> pages -> geometry -> cells -> items.

   The whole of this file works on a PageModel, a plain object with no pdf.js
   in it:

     PageModel = {
       index, width, height, wasOCR,
       spans: [{x, y, w, text}],       // one text run, y is the baseline
       lines: [{y, spans, text}],      // spans grouped by baseline
       hSegs: [{y, x0, x1}],           // horizontal rules drawn on the page
       vSegs: [{x, y0, y1}],           // vertical rules
       text, charCount
     }

   Keeping pdf.js behind that boundary is what makes §5.8, §5.10, §5.8a0 and
   §5.8a testable in node against hand-built pages as well as against the four
   real HR&CE files. CO.pdfio below is the only part that knows about pdf.js.

   PDF user space has its origin at the BOTTOM LEFT and y increases upward, so
   "the row above" is the row with the LARGER y. Row arrays in this file are
   ordered top to bottom, i.e. by descending y.
   ========================================================================= */
;(function (CO) {
  'use strict';

  const X = CO.EXTRACT;

  /* ======================================================================
     1.  GEOMETRY HELPERS
     ================================================================== */

  /* Cluster near-identical coordinates into single boundaries. Ruled tables
     draw the same line several times, once per cell, and the copies differ by
     a fraction of a point. */
  function clusterCoords(values, tol) {
    if (!values.length) return [];
    const s = [...values].sort((a, b) => a - b);
    const groups = [[s[0]]];
    for (let i = 1; i < s.length; i++) {
      const g = groups[groups.length - 1];
      if (s[i] - g[g.length - 1] <= tol) g.push(s[i]); else groups.push([s[i]]);
    }
    return groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
  }

  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

  /* ======================================================================
     2.  RULED-TABLE GEOMETRY  — §5.8

     This is not an optimisation. It is the only correct way to read a
     vertically merged date cell, and reading one wrongly puts a firm in the
     wrong court on the wrong day. (Decision D21.)

     The mechanism, confirmed against Adjournment Notice No.16: a merge is a
     MISSING horizontal rule. Where rows 8 and 9 share one date cell, the rule
     between them is drawn across the serial and case-number columns and simply
     stops before the date column. So the test for "are these two cells one
     cell" is "does a horizontal segment actually span this column at this y".
     ================================================================== */

  /* Split a page into table regions. A region is a run of consecutive rows
     that share the same set of vertical boundaries — which is how a cause list
     and the reposting table appended below it, with a different column count,
     are told apart on the same page (§5.6, H-13). */
  function buildTables(page) {
    const tol = 2.5;
    const hs = page.hSegs.filter(s => Math.abs(s.x1 - s.x0) >= 8);
    const vs = page.vSegs.filter(s => Math.abs(s.y1 - s.y0) >= 4);
    if (hs.length < 2 || vs.length < 2) return [];

    const rowY = clusterCoords(hs.map(s => s.y), tol).sort((a, b) => b - a); // top -> bottom
    const allX = clusterCoords(vs.map(s => s.x), tol).sort((a, b) => a - b);
    if (rowY.length < 2 || allX.length < 2) return [];

    /* Which vertical boundaries are live in each row band? */
    const bands = [];
    for (let i = 0; i < rowY.length - 1; i++) {
      const top = rowY[i], bot = rowY[i + 1];
      if (top - bot < 3) continue;                      // a rule drawn twice
      const live = allX.filter(x =>
        vs.some(s => Math.abs(s.x - x) <= tol &&
                     overlap(Math.min(s.y0, s.y1), Math.max(s.y0, s.y1), bot, top) > (top - bot) * 0.5));
      if (live.length < 2) continue;
      bands.push({ top, bot, cols: live, key: live.map(v => v.toFixed(0)).join('|') });
    }
    if (!bands.length) return [];

    /* Consecutive bands with the same column set form one table. */
    const tables = [];
    for (const b of bands) {
      const last = tables[tables.length - 1];
      if (last && last.key === b.key && Math.abs(last.rows[last.rows.length - 1].bot - b.top) <= tol)
        last.rows.push(b);
      else tables.push({ key: b.key, colX: b.cols, rows: [b] });
    }

    /* Fill each table's cells, honouring vertical merges. */
    for (const t of tables) {
      t.top = t.rows[0].top;
      t.bot = t.rows[t.rows.length - 1].bot;
      t.nCols = t.colX.length - 1;
      t.cells = [];

      for (let r = 0; r < t.rows.length; r++) {
        const row = [];
        for (let c = 0; c < t.nCols; c++) {
          const x0 = t.colX[c], x1 = t.colX[c + 1];
          /* Is the rule below this cell actually drawn across this column? If
             not, the cell continues into the row beneath it. */
          const ruleBelow = hs.some(s =>
            Math.abs(s.y - t.rows[r].bot) <= tol &&
            overlap(Math.min(s.x0, s.x1), Math.max(s.x0, s.x1), x0, x1) > (x1 - x0) * 0.6);
          row.push({
            r, c, x0, x1, top: t.rows[r].top, bot: t.rows[r].bot,
            mergedDown: r < t.rows.length - 1 && !ruleBelow,
            owner: null, rowSpan: 1, text: '', spans: []
          });
        }
        t.cells.push(row);
      }

      /* Resolve merge groups: every cell points at the top cell of its group. */
      for (let c = 0; c < t.nCols; c++) {
        for (let r = 0; r < t.rows.length; r++) {
          const cell = t.cells[r][c];
          if (cell.owner) continue;
          cell.owner = cell;
          let rr = r;
          while (t.cells[rr][c].mergedDown && rr + 1 < t.rows.length) {
            rr++;
            t.cells[rr][c].owner = cell;
            cell.rowSpan++;
          }
          cell.bot = t.cells[rr][c].bot;
        }
      }

      /* Drop text into the cell that owns its position. */
      for (const sp of page.spans) {
        if (!sp.text || !sp.text.trim()) continue;
        if (sp.y > t.top + 1 || sp.y < t.bot - 1) continue;
        const r = t.rows.findIndex(b => sp.y <= b.top + 1 && sp.y > b.bot - 1);
        if (r < 0) continue;
        const mid = sp.x + Math.max(0, sp.w || 0) * 0.35;
        let c = -1;
        for (let k = 0; k < t.nCols; k++)
          if (mid >= t.colX[k] - 1 && mid < t.colX[k + 1] + 1) { c = k; break; }
        if (c < 0) continue;
        t.cells[r][c].owner.spans.push(sp);
      }

      for (const row of t.cells) for (const cell of row)
        if (cell.owner === cell) cell.text = joinSpans(cell.spans);
    }

    return tables.filter(t => t.rows.length >= 2 && t.nCols >= 2);
  }

  /* Join text runs into a readable string.

     pdf.js hands back a run per style change, and real lists break mid-word:
     "M/s.K.S" | "a" | "nkaran" are three runs of one name. Inserting a space
     between every run yields "M/s.K.S a nkaran", which scores as three
     meaningless tokens. So a space goes in only where the horizontal gap says
     one belongs. */
  function joinSpans(spans) {
    if (!spans || !spans.length) return '';
    const s = [...spans].sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let out = '', prev = null;
    for (const sp of s) {
      const t = sp.text;
      if (!t) continue;
      if (prev) {
        const newLine = Math.abs(prev.y - sp.y) > 1.5;
        const gap = sp.x - (prev.x + (prev.w || 0));
        if (newLine) out += ' ';
        else if (gap > 0.8 && !/\s$/.test(out) && !/^\s/.test(t)) out += ' ';
      }
      out += t;
      prev = sp;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /* ======================================================================
     3.  LINES AND COLUMNS WITHOUT RULES  — §5.1, §5.3
     ================================================================== */

  function groupLines(spans, tol) {
    tol = tol == null ? X.LINE_Y_TOL : tol;
    const sorted = [...spans].filter(s => s.text && s.text.trim()).sort((a, b) => b.y - a.y);
    const lines = [];
    for (const sp of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - sp.y) <= tol) { last.spans.push(sp); last.y = (last.y + sp.y) / 2; }
      else lines.push({ y: sp.y, spans: [sp] });
    }
    for (const ln of lines) {
      ln.spans.sort((a, b) => a.x - b.x);
      ln.text = joinSpans(ln.spans);
      ln.x0 = ln.spans[0].x;
    }
    return lines;
  }

  /* The advocate column is the rightmost cluster of x positions. Find it as the
     largest gap in the upper half of the x range.

     The real Madras HC list puts counsel at roughly x = 108mm of a 210mm page,
     i.e. 0.51. The fallback threshold of 0.55 is deliberately ABOVE that, so
     when detection fails the fallback errs towards scanning the whole line
     rather than slicing a name in half. */
  function counselColumnX(page) {
    /* Only runs that actually put ink on the page can define a column.
       pdf.js emits whitespace-only runs at arbitrary x, and on the synthetic
       corpus a single " " sitting at x=305 bridged the 277->346 gap and moved
       the boundary to 391, which sliced "T.THAMARAI SELVAN" in half and lost
       three of the four advocates on the item. */
    const inked = page.spans.filter(s => s.text && s.text.trim());
    const xs = inked.map(s => s.x).filter(x => x > page.width * 0.25).sort((a, b) => a - b);
    if (xs.length < 8) return page.width * X.COLUMN_FALLBACK;

    /* A column boundary is where SEVERAL runs begin, so cluster first and
       prefer clusters with more than one member. One stray run must not be
       able to define a column on its own. */
    const centres = clusterCoords(xs, 2.5);
    const weight = new Map(centres.map(c => [c, xs.filter(x => Math.abs(x - c) <= 2.5).length]));
    let cand = centres.filter(c => weight.get(c) >= 2);
    if (cand.length < 2) cand = centres;

    let bestGap = 0, bestAt = null;
    const lo = page.width * 0.35, hi = page.width * 0.85;
    for (let i = 1; i < cand.length; i++) {
      if (cand[i] < lo || cand[i] > hi) continue;
      const gap = cand[i] - cand[i - 1];
      if (gap > bestGap) { bestGap = gap; bestAt = cand[i]; }
    }
    if (bestAt == null || bestGap < page.width * 0.04) return page.width * X.COLUMN_FALLBACK;
    return bestAt - 2;
  }

  /* §5.4 — a right-column line that is not a name. */
  function isNoiseLine(text) {
    const t = (text || '').trim();
    if (!t) return true;
    if (CO.NOISE_DIVIDER.test(t)) return true;
    if (CO.NOISE_DIGITS.test(t)) return true;
    if (CO.NOISE_WORDS.test(t.toUpperCase())) return true;
    if (t.length > X.NAME_MAX_CHARS) return true;
    return false;
  }

  /* ======================================================================
     4.  DOCUMENT TYPE  — §5.6, §5.9

     Running the wrong extractor produces noise, not silence: applying the High
     Court right-column heuristic to an HR&CE list yields advocates named
     "Temple", "M.P.No" and "of the JC". So the type is settled before
     extraction, per file, and the user's choice always wins. (Decision D32.)
     ================================================================== */
  function detectDocType(sampleText) {
    const t = sampleText || '';
    const scores = CO.PROFILES.map(p => ({
      id: p.id, profile: p,
      hits: p.detect.filter(re => re.test(t)).length
    })).sort((a, b) => b.hits - a.hits);

    const best = scores[0], second = scores[1];
    if (!best || best.hits === 0)
      return { id: 'unknown', profile: null, confident: false,
               why: 'None of the known court or tribunal signatures appeared in the first two pages.' };
    if (second && second.hits === best.hits)
      return { id: best.id, profile: best.profile, confident: false,
               why: `This file matches both ${best.id} and ${second.id} equally well.` };
    return { id: best.id, profile: best.profile, confident: best.hits >= 2,
             why: best.hits >= 2
               ? `Matched ${best.hits} signatures for ${best.profile.label}.`
               : `Matched only one signature for ${best.profile.label}.` };
  }

  /* ======================================================================
     5.  THE CONNECTOR PROBE  — §5.8a0

     Runs BEFORE any advocate name is looked for (T16-01). It asks each column
     a structural question — "do your cells contain a party-to-advocate
     connector?" — rather than trusting a heading. Headings cannot be trusted:
     HR&CE labels its column "Petitioner and his Advocate's Name —
     Thiruvalargal", another forum will say "Party & Counsel", another nothing
     at all. The connector is the invariant. (Decision D37.)
     ================================================================== */

  function findConnector(cell) {
    const s = String(cell || '');
    const pf = CO.CONNECTOR_PARTY_FIRST.exec(s);
    if (pf) return { direction: 'party-first', index: pf.index, length: pf[0].length, token: pf[0] };
    const cf = CO.CONNECTOR_COUNSEL_FIRST.exec(s);
    if (cf) return { direction: 'counsel-first', index: cf.index, length: cf[0].length, token: cf[0] };
    return null;
  }

  /* Density over ASSEMBLED CELLS, never over physical lines. Party cells wrap
     across many lines and only one of them carries the connector: measured on
     the HR&CE lists the petitioner column reads 50% per cell against 10% per
     line. Line-level measurement under-reports five-fold and would classify
     the main counsel-bearing column as ordinary party text. (Decision D39.) */
  function probeColumn(cells) {
    let n = 0, pf = 0, cf = 0;
    for (const raw of cells) {
      const c = String(raw || '').trim();
      if (c.length < 4) continue;
      n++;
      if (CO.CONNECTOR_PARTY_FIRST.test(c)) pf++;
      else if (CO.CONNECTOR_COUNSEL_FIRST.test(c)) cf++;
    }
    if (!n) return { cells: 0, density: 0, direction: null, pf: 0, cf: 0 };
    const hit = Math.max(pf, cf);
    return {
      cells: n, density: hit / n, pf, cf,
      direction: pf >= cf && pf ? 'party-first' : cf ? 'counsel-first' : null
    };
  }

  /* The probe may UPGRADE a party column to party+counsel. It never downgrades
     a column a profile declared counsel-bearing, and a column with no
     connectors at all is never split whatever its heading says. */
  function classifyColumn(probe, declaredRole) {
    const role = declaredRole || 'party';
    if (CO.COUNSEL_BEARING_ROLES.includes(role))
      return { role, why: probe.density > 0
        ? `declared counsel-bearing; ${Math.round(probe.density * 100)}% of cells carry a connector`
        : 'declared counsel-bearing by the document profile' };
    if (role === 'index' || role === 'caseNumber' || role === 'extra')
      return { role, why: 'not a party column — never split' };
    if (probe.density >= CO.PROBE.MIN_DENSITY && probe.cells >= CO.PROBE.MIN_CELLS)
      return { role: 'party+counsel',
               why: `probe: ${Math.round(probe.density * 100)}% of cells carry a connector` };
    if (probe.density > 0)
      return { role, why: `probe: connectors present but sparse (${Math.round(probe.density * 100)}%)` };
    return { role, why: 'probe: no connectors' };
  }

  /* Split one party+counsel cell.

     A cell routinely carries SEVERAL counsel for different respondents:
     "1. R1 and R2 through M/s.N.Soundarrajan ... 4. E.O through M/s.E.Ganesh".
     Every connector occurrence is a separate advocate, and each keeps its own
     respondent numbering (§5.8a.2, H-19). */
  function splitPartyCounsel(cell, opts) {
    const text = String(cell || '').trim();
    const honor = (opts && opts.honorifics) || CO.HONORIFIC_RE;
    const wantSub = !!(opts && opts.subNumbering);
    const out = { party: text, advocates: [] };
    if (!text) return out;

    /* Every party-first connector in the cell, left to right. */
    const re = new RegExp(CO.CONNECTOR_PARTY_FIRST_SRC, 'g');
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }

    if (hits.length) {
      out.party = text.slice(0, hits[0].start).replace(/[\s.,]+$/, '').trim();
      for (let i = 0; i < hits.length; i++) {
        const from = hits[i].end;
        const to = i + 1 < hits.length ? hits[i + 1].start : text.length;
        let chunk = text.slice(from, to).trim();

        /* The tail before the NEXT connector belongs to the next party, not to
           this advocate. A respondent list numbers its entries, so cut at the
           next "2." / "3." marker where one exists. The dot is repeated
           because the real lists contain "3..The Madathipathi". */
        const nextItem = chunk.search(/\s\d{1,2}\s*\.+\s*(?=[A-Z])/);
        let trailing = '';
        if (nextItem > 0) { trailing = chunk.slice(nextItem); chunk = chunk.slice(0, nextItem); }

        const name = chunk.replace(honor, '').replace(/[\s.,]+$/, '').trim();
        if (name) {
          const before = text.slice(0, hits[i].start);
          out.advocates.push({
            name,
            sideDetail: wantSub ? respondentNumbering(before) : null,
            connector: text.slice(hits[i].start, hits[i].end),
            direction: 'party-first'
          });
        }
        if (trailing && i + 1 >= hits.length) out.tail = trailing.trim();
      }
      return out;
    }

    /* counsel-first: "AKILESH KUMAR FOR R1" — advocate before, party after. */
    const cf = CO.CONNECTOR_COUNSEL_FIRST.exec(text);
    if (cf) {
      const name = text.slice(0, cf.index).replace(honor, '').replace(/[\s.,]+$/, '').trim();
      out.party = text.slice(cf.index + cf[0].length).replace(/[\s.,]+$/, '').trim();
      if (name) out.advocates.push({
        name, sideDetail: wantSub ? respondentNumbering(text.slice(cf.index)) : null,
        connector: cf[0], direction: 'counsel-first'
      });
    }
    return out;
  }

  /* "3. R3 to R11 through M/s.E.Ganesh" -> "R3 to R11". Richer than the High
     Court divider and worth showing on the confirm card (§5.8a.2, H-07). */
  function respondentNumbering(before) {
    const seg = String(before || '').split(/\s(?=\d{1,2}\s*\.\s*)/).pop() || '';
    const range = seg.match(/\bR-?\d+\s*(?:to|and|&|,|-)\s*R?-?\d+/i);
    if (range) return range[0].replace(/\s+/g, ' ').trim();
    const list = seg.match(/\bR-?\d+(?:\s*(?:,|and|&)\s*R?-?\d+)*/i);
    if (list) return list[0].replace(/\s+/g, ' ').trim();
    const role = seg.match(/\b(?:E\.?O|J\.?C(?:\/E\.?O)?|Executive Officer|Joint Commissioner|Commissioner|Thakkar|Madathipathi|Chairman[^,]{0,30})\b/i);
    if (role) return role[0].trim();
    return null;
  }

  /* ======================================================================
     6.  PASS A — STRUCTURED EXTRACTION  — §5.8a, §5.10
     ================================================================== */

  let SEQ = 0;
  const nextId = p => `${p}${(++SEQ).toString(36)}`;

  function pageContext(page, carried) {
    const lines = page.lines;
    const ctx = { court: null, hall: null, coram: null, listType: null };
    const centred = lines.filter(ln => {
      const w = ln.spans.reduce((a, s) => a + (s.w || 0), 0);
      const mid = ln.x0 + w / 2;
      return Math.abs(mid - page.width / 2) < page.width * 0.12 && ln.text.length > 8;
    });
    if (centred.length) ctx.court = centred[0].text.trim();

    for (const ln of lines.slice(0, 14)) {
      const h = CO.HALL_RE.exec(ln.text);
      if (h && !ctx.hall) ctx.hall = h[1];
      if (!ctx.coram && CO.CORAM_RE.test(ln.text) && /CORAM|HON/i.test(ln.text))
        ctx.coram = ln.text.replace(/^\s*CORAM\s*:?\s*/i, '').trim();
    }
    for (const ln of lines.slice(-6)) {
      const l = CO.LISTTYPE_RE.exec(ln.text);
      if (l) { ctx.listType = l[1].trim(); break; }
    }
    /* Carried from the previous page where this one is a continuation. */
    if (carried) {
      if (!ctx.court || !/COURT|COMMISSION|TRIBUNAL|FORUM/i.test(ctx.court)) ctx.court = carried.court || ctx.court;
      ctx.hall = ctx.hall || carried.hall;
      ctx.coram = ctx.coram || carried.coram;
      ctx.listType = ctx.listType || carried.listType;
    }
    return ctx;
  }

  /* --- 6a. Ruled tables (HR&CE and any other forum with a drawn grid) --- */
  function passA_table(page, table, profile, roles, ctx, file) {
    const items = [], reposted = [];
    const isAdjournTable = roles.some(r => r.name === 'repostedTo') ||
      /reposted/i.test(headerTextOf(table));

    const dataRows = table.cells.slice(headerRowCount(table));

    /* The registry numbers a matter once and then leaves the serial cell blank
       on the continuation rows beneath it — R.P.66/2022 carries "1." and
       R.P.329/2022 below it carries nothing, while their temple and subject
       cells are drawn as one merged block across both. Reading the second row
       as unnumbered would lose the clerk's own reference, so a blank serial
       inherits the one above and is flagged as inherited rather than printed. */
    let lastSerial = null;

    for (let r = 0; r < dataRows.length; r++) {
      const row = dataRows[r];
      const cellText = c => {
        const cell = row[c];
        return cell ? (cell.owner === cell ? cell.text : cell.owner.text) : '';
      };
      const cellMerged = c => row[c] && row[c].owner !== row[c];

      const byRole = role => roles.map((x, i) => x.role === role ? i : -1).filter(i => i >= 0);
      const iCase  = byRole('caseNumber')[0];
      const iIndex = byRole('index')[0];
      const caseCell = iCase != null ? cellText(iCase) : '';
      if (!caseCell || !/\d/.test(caseCell)) continue;

      const exp = CO.expandCaseCellDetailed(caseCell);
      const printedSerial = iIndex != null ? (cellText(iIndex).match(/\d+/) || [''])[0] : String(r + 1);
      const serialInherited = !printedSerial && !!lastSerial;
      const serial = printedSerial || lastSerial || '';
      if (printedSerial) lastSerial = printedSerial;

      if (isAdjournTable) {
        const iDate = roles.findIndex(x => x.name === 'repostedTo' || x.role === 'extra');
        const dateCell = iDate >= 0 ? cellText(iDate) : '';
        const dm = CO.REPOST_DATE_RE.exec(dateCell);
        const tm = CO.REPOST_TIME_RE.exec(dateCell);
        reposted.push({
          id: nextId('rp'), sourceFile: file.name, sourceIsOfficial: !!file.official,
          serial, caseCellRaw: caseCell, caseKeys: exp.keys, cappedRanges: exp.capped,
          originalDate: null,
          repostedTo: dm ? `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}` : null,
          repostedTime: tm ? tm[1].trim() : null,
          /* A merged cell is a fact read off the page. Where the file has no
             rules at all we fall back to the nearest date and mark the row
             inferred, which forces it into the confirm queue (§5.8, D24). */
          dateConfidence: 'ruled',
          rawText: `${serial}. ${caseCell}  ->  ${dateCell}`,
          page: page.index
        });
        continue;
      }

      const item = {
        id: nextId('it'), sourceFile: file.name, sourceIsOfficial: !!file.official,
        page: page.index, court: ctx.court, hall: ctx.hall, coram: ctx.coram,
        listType: ctx.listType, itemNo: serial, itemNoInherited: serialInherited,
        caseNumbers: [caseCell], caseKeys: exp.keys, cappedRanges: exp.capped,
        petitioner: '', respondent: '',
        counselPetitioner: [], counselRespondent: [],
        allNames: [], namesWithRole: [], extra: {},
        ocrPages: page.wasOCR ? [page.index] : [],
        layoutConfidence: 'ok',
        rawText: row.map((c, i) => cellText(i)).filter(Boolean).join('  |  ')
      };

      roles.forEach((col, i) => {
        const txt = cellText(i);
        if (!txt) return;
        if (col.role === 'extra') { item.extra[col.label || col.name] = txt; return; }
        if (col.role === 'party' || col.role === 'party+counsel') {
          const side = col.side || (i === roles.findIndex(z => z.side === 'petitioner') ? 'petitioner' : null);
          if (col.role === 'party') {
            if (side === 'respondent') item.respondent = txt; else item.petitioner = txt;
            /* A party is still a finding — a partner's own litigation must be
               caught — it is simply not a counsel finding (§5.8a.3). */
            item.namesWithRole.push({ name: txt, matchRole: 'party', side, source: 'A', column: col.name });
            return;
          }
          const split = CO.splitPartyCounsel(txt, col);
          if (side === 'respondent') item.respondent = split.party; else item.petitioner = split.party;
          if (split.party)
            item.namesWithRole.push({ name: split.party, matchRole: 'party', side, source: 'A', column: col.name });
          for (const adv of split.advocates) {
            item.namesWithRole.push({
              name: adv.name, matchRole: 'counsel', side, source: 'A',
              column: col.name, sideDetail: adv.sideDetail,
              mergedCell: cellMerged(i)
            });
            (side === 'respondent' ? item.counselRespondent : item.counselPetitioner).push(adv.name);
          }
          return;
        }
        if (col.role === 'counsel') {
          for (const nm of txt.split(/\s{2,}|\n/).map(s => s.trim()).filter(s => s && !isNoiseLine(s)))
            item.namesWithRole.push({ name: nm, matchRole: 'counsel', side: 'unknown', source: 'A', column: col.name });
        }
      });

      item.allNames = [...new Set(item.namesWithRole.map(n => n.name))];
      items.push(item);
    }
    return { items, reposted };
  }

  const headerRowCount = t => (t.rows.length > 1 ? 1 : 0);
  const headerTextOf = t => (t.cells[0] || []).map(c => c.owner === c ? c.text : '').join(' ');

  /* --- 6b. High Court lists: no rules, columns from the x histogram --- */
  const isFooterLine = (text, y, page) =>
    CO.LISTTYPE_RE.test(text) || (y < page.height * 0.07 && /^\s*\d+\s*\/\s*\d+\b/.test(text));

  function passA_columns(page, ctx, file) {
    const colX = counselColumnX(page);
    const items = [];
    let cur = null, side = 'petitioner', seenVs = false;

    const flush = () => {
      if (!cur) return;
      cur.allNames = [...new Set(cur.namesWithRole.map(n => n.name))];
      cur.petitioner = cur.petitioner.replace(/\s+/g, ' ').trim();
      cur.respondent = cur.respondent.replace(/\s+/g, ' ').trim();
      if (!cur.respondent) {
        const parts = cur.petitioner.split(/\bVS\b/i);
        if (parts.length > 1) {
          cur.petitioner = parts[0].trim();
          cur.respondent = parts.slice(1).join(' ').trim();
        }
      }
      items.push(cur);
      cur = null;
    };

    for (const ln of page.lines) {
      const left  = joinSpans(ln.spans.filter(s => s.x <  colX)).trim();
      const right = joinSpans(ln.spans.filter(s => s.x >= colX)).trim();

      /* The footer closes the block; nothing below it belongs to a matter. */
      if (isFooterLine(ln.text, ln.y, page)) { flush(); continue; }

      const start = CO.ITEM_START_RE.exec(left || ln.text);
      if (start) {
        flush();
        side = 'petitioner'; seenVs = false;
        const caseRaw = start[2].replace(/\s+/g, '');
        const exp = CO.expandCaseCellDetailed(caseRaw);
        cur = {
          id: nextId('it'), sourceFile: file.name, sourceIsOfficial: !!file.official,
          page: page.index, court: ctx.court, hall: ctx.hall, coram: ctx.coram,
          listType: ctx.listType, itemNo: start[1], itemNoInherited: false,
          caseNumbers: [caseRaw], caseKeys: exp.keys.length ? exp.keys : [CO.normCaseNo(caseRaw)],
          cappedRanges: exp.capped,
          petitioner: left.slice(start[0].length).trim(), respondent: '',
          counselPetitioner: [], counselRespondent: [],
          allNames: [], namesWithRole: [], extra: {},
          ocrPages: page.wasOCR ? [page.index] : [],
          layoutConfidence: 'ok', rawText: ln.text,
          _yTop: ln.y, _yBot: ln.y
        };
        if (/\bVS\b/i.test(cur.petitioner)) seenVs = true;
      }

      if (!cur) continue;
      if (ln.text !== cur.rawText) cur.rawText += '\n' + ln.text;
      cur._yBot = Math.min(cur._yBot, ln.y);

      /* A continuation line beginning AND attaches more case numbers. */
      if (!start && /^AND\b/i.test(left) && /\d{4}/.test(left)) {
        for (const raw of CO.findCaseNumbers(left)) {
          cur.caseNumbers.push(raw);
          for (const k of CO.expandCaseCell(raw)) if (!cur.caseKeys.includes(k)) cur.caseKeys.push(k);
        }
      }

      if (left && !start && !CO.NOISE_DIVIDER.test(left)) {
        if (/^VS\b/i.test(left)) {
          seenVs = true;
          const tail = left.replace(/^VS\b\.?\s*/i, '').trim();
          if (tail) cur.respondent += (cur.respondent ? ' ' : '') + tail;
        } else if (seenVs) {
          cur.respondent += (cur.respondent ? ' ' : '') + left;
        } else {
          cur.petitioner += (cur.petitioner ? ' ' : '') + left;
        }
      }

      if (!right) continue;
      /* §4.8 — the divider separates petitioner counsel from respondent
         counsel. Side is RECORDED here and never used to narrow the search. */
      if (CO.DIVIDER_RE.test(right)) { side = 'respondent'; continue; }
      if (isNoiseLine(right)) continue;

      cur.namesWithRole.push({ name: right, matchRole: 'counsel', side, source: 'A', column: 'counsel' });
      (side === 'respondent' ? cur.counselRespondent : cur.counselPetitioner).push(right);
    }
    flush();
    return { items, reposted: [] };
  }

  /* --- 6c. Adjournment rows on a page with no usable rules --- */
  function passA_adjournLines(page, file) {
    const reposted = [];
    let lastDate = null, lastTime = null;
    for (const ln of page.lines) {
      const nums = CO.findCaseNumbers(ln.text);
      if (!nums.length) continue;
      const dm = CO.REPOST_DATE_RE.exec(ln.text);
      const tm = CO.REPOST_TIME_RE.exec(ln.text);
      if (dm) { lastDate = dm; lastTime = tm; }
      const cellRaw = nums.join(', ');
      const exp = CO.expandCaseCellDetailed(cellRaw);
      reposted.push({
        id: nextId('rp'), sourceFile: file.name, sourceIsOfficial: !!file.official,
        serial: (ln.text.match(/^\s*(\d{1,3})\s*\./) || ['', ''])[1],
        caseCellRaw: cellRaw, caseKeys: exp.keys, cappedRanges: exp.capped,
        originalDate: null,
        repostedTo: lastDate ? `${lastDate[3]}-${String(lastDate[2]).padStart(2, '0')}-${String(lastDate[1]).padStart(2, '0')}` : null,
        repostedTime: lastTime ? lastTime[1].trim() : null,
        /* No rules on this page, so the pairing of row to date is a guess.
           A guessed hearing date must never be presented as fact (D24). */
        dateConfidence: dm ? 'ruled' : 'inferred',
        rawText: ln.text, page: page.index
      });
    }
    return { items: [], reposted };
  }

  /* ======================================================================
     7.  PASS B — THE SWEEP  — §5.10

     Column recovery is inference, and inference fails. A page where it fails
     silently is the worst outcome this tool can produce, so every page is read
     twice by two methods that fail differently. Pass B knows nothing about
     structure and cannot be defeated by a column-detection failure, because it
     does not use columns. (Decision D26.)
     ================================================================== */

  /* Index the roster by the first letter of each core token, raw and folded.
     The head guard in §4.4 means a candidate can only match an advocate that
     shares a leading letter, so this prefilter is exact, not approximate — it
     never discards a name the scorer would have accepted, and it keeps the
     sweep affordable on a 642-page list. */
  function buildRosterIndex(roster) {
    const idx = new Map();
    for (const adv of roster) {
      const p = adv.parsed || (adv.parsed = CO.splitName(adv.name));
      const letters = new Set();
      for (const t of p.core) {
        if (t[0]) letters.add(t[0]);
        const f = CO.foldIndic(t)[0];
        if (f) letters.add(f);
      }
      for (const L of letters) {
        if (!idx.has(L)) idx.set(L, []);
        if (!idx.get(L).includes(adv)) idx.get(L).push(adv);
      }
    }
    idx.maxTokens = Math.max(2, ...roster.map(a =>
      (a.parsed || CO.splitName(a.name)).core.length + (a.parsed || CO.splitName(a.name)).initials.length + 1));
    return idx;
  }

  /* Every window of 1..maxTokens consecutive tokens in a fragment. Fragments
     are cut at the characters that never appear inside a name. */
  function candidateStrings(text, maxTokens) {
    const out = [];
    for (const frag of String(text || '').split(/[,;|]|\s{3,}|\d{3,}/)) {
      const toks = frag.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      for (let i = 0; i < toks.length; i++)
        for (let n = 1; n <= maxTokens && i + n <= toks.length; n++)
          out.push(toks.slice(i, i + n).join(' '));
    }
    return out;
  }

  function passB(page, roster, idx, opts) {
    const hits = [];
    const seen = new Set();
    const ocr = !!page.wasOCR;

    for (const ln of page.lines) {
      for (const cand of candidateStrings(ln.text, idx.maxTokens)) {
        const parsed = CO.splitName(cand);
        if (!parsed.core.length) continue;

        /* Prefilter: only advocates sharing a leading letter can pass §4.4. */
        const letters = new Set();
        for (const t of parsed.core) {
          if (t[0]) letters.add(t[0]);
          const f = CO.foldIndic(t)[0];
          if (f) letters.add(f);
        }
        const pool = new Set();
        for (const L of letters) for (const a of (idx.get(L) || [])) pool.add(a);
        if (!pool.size) continue;

        for (const adv of pool) {
          const sc = CO.nameScore(adv.name, cand);
          if (!sc) continue;
          const tier = CO.classify(sc, { ocr });
          if (tier === 'none') continue;
          const key = `${adv.id}|${cand.toUpperCase()}|${Math.round(ln.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            advocate: adv, printed: cand, score: sc, tier,
            page: page.index, y: ln.y, line: ln.text, source: 'B'
          });
        }
      }
    }

    /* Keep only the best window per (advocate, line): "E.GANESH" and
       "E.GANESH FOR" are one finding, not two. */
    const best = new Map();
    for (const h of hits) {
      const k = `${h.advocate.id}|${Math.round(h.y)}`;
      const cur = best.get(k);
      if (!cur || h.score.combined > cur.score.combined) best.set(k, h);
    }
    return [...best.values()];
  }

  /* ======================================================================
     8.  RECONCILIATION  — §5.10, §5.10.1
     ================================================================== */

  /* Which item on this page owns a given y? Used to attach a B-only hit to the
     matter it sits next to, so the confirm card still has a case number. */
  function itemAtY(items, y) {
    let best = null, bestGap = Infinity;
    for (const it of items) {
      if (it._yTop == null) continue;
      if (y <= it._yTop + 1 && y >= it._yBot - 1) return it;
      const gap = y > it._yTop ? y - it._yTop : it._yBot - y;
      if (gap < bestGap) { bestGap = gap; best = it; }
    }
    return bestGap <= 40 ? best : null;
  }

  /* The disagreement rate between the two passes is the most useful diagnostic
     in the system. A page whose layout was misread must never be reported as a
     page with no matches. (Decision D28.) */
  const flatten = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');

  /* A sweep hit records WHICH firm advocate it scored against, so the matcher
     does not attach one loose string to all of them. That reference is by
     NAME, not by object identity: the roster the matcher is handed need not be
     the same array of objects the extractor was given — a profile reloaded
     from storage, or a second run, produces equal advocates with fresh ids,
     and keying on the id would silently drop every sweep finding. */
  const advocateKey = adv => flatten(adv && adv.name);

  function reconcilePage(page, items, bHits) {
    /* Every name Pass A placed in a COUNSEL-BEARING column. Note this is the
       role test, never the column's name: for tribunal.hrce that means either
       party column, for causelist.hc the counsel column. (T15-01.) */
    const aNames = [];
    for (const it of items)
      for (const n of it.namesWithRole)
        if (n.source === 'A' && n.matchRole === 'counsel') aNames.push(flatten(n.name));

    /* Party text Pass A DID place, but as a party rather than as counsel.
       A firm name can legitimately be either, and the two mean different
       things: "E.R. Kannan through M/s.E.Ganesh" makes Ganesh counsel, while
       "E.Ganesh & anr -Vs- The Managing Director" makes him a party in his own
       matter. Both are real in the supplied data, both must be caught, and
       neither may be reported as the other. (§5.8a.3, Decision D35.)

       Without this, a name the sweep finds inside a party cell would be
       reported as "unplaced — the layout may not have been read correctly",
       which is simply untrue: the layout was read correctly and the name is a
       party. */
    const partyText = [];
    for (const it of items) {
      for (const s of [it.petitioner, it.respondent]) if (s) partyText.push({ it, flat: flatten(s) });
      for (const n of it.namesWithRole)
        if (n.source === 'A' && n.matchRole === 'party') partyText.push({ it, flat: flatten(n.name) });
    }

    const sameName = (a, b) => a && b && (a.includes(b) || b.includes(a));

    const bOnly = [], bAlso = [];
    for (const h of bHits) {
      const flat = flatten(h.printed);
      if (aNames.some(a => sameName(a, flat))) { bAlso.push(h); continue; }
      const inParty = partyText.find(p => p.flat.includes(flat) && flat.length >= 4);
      if (inParty) { h.placedAs = 'party'; h.placedIn = inParty.it; }
      bOnly.push(h);
    }

    /* If a page yields several B-only hits and no A hits at all, column
       detection failed on that page. Everything from it is capped at review
       and the page is named in "Pages I could not read cleanly", because
       silence about a failed page is the failure mode this exists to prevent.
       A hit the sweep found inside a party cell does not count towards this —
       the page was read correctly, the name is simply a party. */
    const trulyUnplaced = bOnly.filter(h => !h.placedAs);
    const low = trulyUnplaced.length >= X.LOW_CONF_MIN_BONLY && aNames.length === 0;
    page.layoutConfidence = low ? 'low' : 'ok';
    if (low) for (const it of items) it.layoutConfidence = 'low';

    /* Found by A and B both is the strongest state there is. */
    const bAlsoFlat = bAlso.map(h => flatten(h.printed));
    for (const it of items)
      for (const n of it.namesWithRole)
        if (n.source === 'A')
          n.confirmedByB = bAlsoFlat.some(f => sameName(f, flatten(n.name)));

    return { bOnly, bAlso, aHitCount: aNames.length, layoutConfidence: page.layoutConfidence };
  }

  /* ======================================================================
     9.  PDF I/O  — the only part that knows about pdf.js
     ================================================================== */

  const pdfio = {
    lib: null,

    /* Set by the UI at boot to a function returning a FRESH Worker, or left
       null when the page was opened from a folder and no worker can start.

       One worker per document, never a shared one: PDFDocumentProxy.destroy()
       tears down the worker it was given, so a second file handed the same
       port fails with "the worker is being destroyed" and the whole document
       is skipped. On a run that mixes a cause list with an adjournment notice
       that would silently lose every adjournment — the firm would be told to
       attend matters that had been vacated, which is precisely the failure
       §6.6.1 exists to prevent. */
    workerFactory: null,

    /* The browser build inlines pdf.js as a classic script and exposes it on
       globalThis; node imports the pristine ESM straight from vendor/. */
    async ensure() {
      if (this.lib) return this.lib;
      if (typeof globalThis.pdfjsLib !== 'undefined') { this.lib = globalThis.pdfjsLib; return this.lib; }
      throw new Error('pdf.js is not available on this page.');
    },

    async open(bytes) {
      const lib = await this.ensure();
      const opts = {
        data: bytes, isEvalSupported: false, useSystemFonts: false,
        disableFontFace: true, verbosity: 0
      };
      let worker = null;
      if (this.workerFactory) {
        try { worker = this.workerFactory(); } catch { worker = null; }
        if (worker) opts.worker = new lib.PDFWorker({ port: worker, name: 'callover' });
      }
      const doc = await lib.getDocument(opts).promise;
      doc._coWorker = worker;
      return doc;
    },

    /* Destroy the document AND the worker that served it. Both are wrapped:
       a failure to tidy up must never lose the results already extracted. */
    close(doc) {
      if (!doc) return;
      try { doc.destroy(); } catch { /* already gone */ }
      try { if (doc._coWorker) doc._coWorker.terminate(); } catch { /* already gone */ }
    },

    /* Walk the operator list and pull out every axis-aligned rectangle, then
       classify the thin ones as horizontal or vertical rules. Everything is
       kept in unrotated page space so it lines up with the text baselines. */
    async pageGeometry(page, lib) {
      const OPS = lib.OPS;
      const ol = await page.getOperatorList();
      const hSegs = [], vSegs = [];
      for (let i = 0; i < ol.fnArray.length; i++) {
        if (ol.fnArray[i] !== OPS.constructPath) continue;
        const a = ol.argsArray[i];
        const ops = a[0], args = a[1];
        if (!ops || !args) continue;
        let k = 0;
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const x = args[k], y = args[k + 1], w = args[k + 2], h = args[k + 3];
            k += 4;
            const ax = Math.abs(w), ah = Math.abs(h);
            const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w);
            const y0 = Math.min(y, y + h), y1 = Math.max(y, y + h);
            if (ah < 3 && ax >= 3) hSegs.push({ y: (y0 + y1) / 2, x0, x1 });
            else if (ax < 3 && ah >= 3) vSegs.push({ x: (x0 + x1) / 2, y0, y1 });
          }
          else if (op === OPS.moveTo || op === OPS.lineTo) k += 2;
          else if (op === OPS.curveTo) k += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
        }
      }
      return { hSegs, vSegs };
    },

    async readPage(doc, n, lib) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const spans = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        spans.push({ x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 0, text: it.str });
      }
      const { hSegs, vSegs } = await this.pageGeometry(page, lib);
      const model = {
        index: n, width: vp.width, height: vp.height, wasOCR: false,
        spans, hSegs, vSegs, _pdfPage: page
      };
      finishPage(model);
      return model;
    }
  };

  /* Complete a PageModel from its spans. Exported so tests can build a page
     from a text fixture and run the whole structural pipeline on it. */
  function finishPage(model) {
    model.lines = groupLines(model.spans);
    model.text = model.lines.map(l => l.text).join('\n');
    model.charCount = model.text.replace(/\s/g, '').length;
    return model;
  }

  /* §5.11 — how should this page be read? */
  function classifyPage(page) {
    if (page.charCount < X.OCR_MIN_CHARS) return 'ocr';
    if (page.hSegs.length >= 4 && page.vSegs.length >= 2) return 'ruled';
    return 'columns';
  }

  /* Thorough mode adds a third reading to any page that is not confidently
     understood. Roughly doubles processing time on affected pages, and that
     trade is accepted deliberately: a missed listing costs an appearance, a
     few extra seconds costs nothing. (Decision D29.) */
  function needsThorough(page, forced) {
    if (forced) return true;
    if (page.layoutConfidence === 'low') return true;
    if (page.charCount < X.THIN_TEXT_CHARS) return true;
    return false;
  }

  /* ======================================================================
     10.  OCR  — §5.2

     Lazy-loaded from vendor/ on first need only, so a text-only run never pays
     the 11 MB. Runs in tesseract.js's own Web Worker, so the UI thread is
     never blocked.

     OCR needs a Worker plus WebAssembly, neither of which can start from a
     bare file:// origin. When it cannot start we say so and name the pages
     affected (§8.7) — we never let a page fail quietly.
     ================================================================== */
  const ocr = {
    worker: null, state: 'idle', reason: null,

    unavailableReason() {
      if (typeof document === 'undefined') return 'Scanned-page reading needs a browser.';
      if (typeof Worker === 'undefined') return 'This browser has no Web Worker support.';
      if (typeof WebAssembly === 'undefined') return 'This browser has no WebAssembly support.';
      if (typeof location !== 'undefined' && location.protocol === 'file:')
        return 'Reading scanned pages needs the page to be served over http, not opened straight from a folder. ' +
               'Everything else — including all matching and every export — works exactly as it is.';
      return null;
    },

    /* §2.1 — the OCR engine is fetched from vendor/ ON FIRST NEED ONLY, so a
       text-only run never pays its eleven megabytes. This is a same-origin
       request for a file sitting beside index.html; it is the one thing
       Callover loads late, and it still leaves the device untouched. */
    loadEngine() {
      if (globalThis.Tesseract) return Promise.resolve(true);
      if (this._loading) return this._loading;
      this._loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/tesseract.min.js';
        s.onload = () => resolve(true);
        s.onerror = () => reject(new Error(
          'the offline text engine was not found in a vendor/ folder next to this page'));
        document.head.appendChild(s);
      });
      return this._loading;
    },

    /* SIMD has been baseline in every major browser since 2023, but the
       non-SIMD core is vendored too so an older device still works. */
    async simdSupported() {
      try {
        return WebAssembly.validate(new Uint8Array([
          0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11
        ]));
      } catch { return false; }
    },

    /* The paths in 00-config.js are relative, so the privacy tests can read
       them at a glance and see that nothing points off-origin. They have to be
       made absolute before tesseract sees them: its worker resolves corePath
       and langPath with importScripts and fetch from inside a blob worker,
       where a bare "vendor/..." has no base to resolve against and throws
       "The URL is invalid". Resolving here against the page keeps them
       same-origin and keeps the declaration honest. */
    abs(p) {
      try { return new URL(p, document.baseURI).href; } catch { return p; }
    },

    /* Never await an OCR promise without a bound. A terminated or wedged
       worker leaves its promise pending forever, and the run would sit on a
       progress bar that never moves. */
    withTimeout(promise, ms, what) {
      let timer;
      return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(
          () => reject(new Error(`${what} gave up after ${Math.round(ms / 1000)} seconds`)), ms); })
      ]);
    },

    /* The bound actually used around the engine, and it watches for SILENCE
       rather than counting down to a deadline. See the note on OCR_SILENCE_MS
       in 00-config.js: a single long timer is unreliable in a background tab,
       and a user who switches away mid-run would get no bound at all.

       Every reading comes from Date.now(), so a throttled or postponed
       interval can only delay detection — it can never fire early on a page
       that was quietly making progress. */
    _tick: 0,
    _pending: new Set(),

    watch(promise, what, hardMs) {
      const HARD = hardMs || CO.OCR_PAGE_TIMEOUT_MS;
      const t0 = Date.now();
      this._tick = t0;
      const self = this;

      return new Promise((resolve, reject) => {
        let settled = false;
        const stop = () => { settled = true; clearInterval(iv); self._pending.delete(abort); };

        /* The escape hatch that does not depend on a timer at all. A browser
           freezes timers in a tab that has been hidden a long while — measured
           here: a 4-second interval that had not run for 164 seconds — so
           neither the silence budget nor the hard ceiling can be relied on
           while nobody is looking. Cancelling is driven by the user, and a
           user who is looking at the page is a user whose timers are running. */
        const abort = why => { if (settled) return; stop(); reject(new Error(why)); };
        this._pending.add(abort);

        const iv = setInterval(() => {
          if (settled) return;
          const silent = Date.now() - self._tick, total = Date.now() - t0;
          if (silent >= CO.OCR_SILENCE_MS)
            abort(`${what} stopped responding — nothing for ${Math.round(silent / 1000)} seconds`);
          else if (total >= HARD)
            abort(`${what} gave up after ${Math.round(total / 1000)} seconds`);
        }, CO.OCR_WATCH_INTERVAL_MS);

        promise.then(v => { if (!settled) { stop(); resolve(v); } },
                     e => { if (!settled) { stop(); reject(e); } });
      });
    },

    /* Abandon whatever OCR is doing, now. Terminating the worker is what
       actually stops a wedged job; rejecting the pending promises is what
       releases the run loop that is awaiting it. */
    cancelAll(why) {
      const reason = why || 'Reading was stopped.';
      for (const abort of [...this._pending]) abort(reason);
      this._pending.clear();
      this.shutdown();
    },

    /* A promise that rejects the moment cancelAll fires, whatever OCR happens
       to be doing. Raced against readPage at the call site, so the run loop is
       released even when the wedge is somewhere readPage does not own — a
       canvas render that never completes in a frozen tab, say, which is not a
       tesseract call at all and cannot be bounded from inside. */
    cancelSignal() {
      const self = this;
      return new Promise((_, reject) => {
        const abort = why => { self._pending.delete(abort); reject(new Error(why)); };
        self._pending.add(abort);
      });
    },

    /* Where every progress event from the engine lands. It both feeds the
       progress panel and keeps the watchdog quiet, and it is stored on the
       object rather than captured at createWorker time — the logger is bound
       once for the worker's whole life, so a callback captured from the first
       page would leave every later page reporting nothing. */
    _onProgress: null,
    _log(m) {
      this._tick = Date.now();
      if (this._onProgress && m && m.status) this._onProgress(m);
    },

    async ensure(onProgress) {
      if (onProgress) this._onProgress = onProgress;
      if (this.worker) return this.worker;
      if (this.state === 'failed') return null;
      const why = this.unavailableReason();
      if (why) { this.state = 'failed'; this.reason = why; return null; }
      try {
        await this.loadEngine();
        const P = CO.OCR_PATHS;
        this.worker = await this.watch(globalThis.Tesseract.createWorker(P.langCode, 1, {
          workerPath: this.abs(P.worker),
          corePath: this.abs((await this.simdSupported()) ? P.coreSimd : P.core),
          langPath: this.abs(P.lang),
          cacheMethod: 'none',
          logger: m => this._log(m)
        }), 'Starting the offline text engine', CO.OCR_START_TIMEOUT_MS);
        this.state = 'ready';
        return this.worker;
      } catch (e) {
        this.state = 'failed';
        this.reason = 'The offline text engine could not start: ' + (e && e.message ? e.message : e);
        return null;
      }
    },

    /* Render at 2x, binarise, recognise, and hand back spans in PDF space so
       an OCR'd page is indistinguishable downstream from a text-layer one. */
    async readPage(pdfPage, pageHeight, onProgress) {
      let w = null;
      try { w = await this.ensure(onProgress); }
      catch (e) { this.state = 'failed'; this.reason = e.message; return null; }
      if (!w) return null;
      const scale = X.OCR_SCALE;
      const vp = pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < 176 ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);

      let res;
      try {
        res = await this.watch(w.recognize(canvas),
          `Picture-reading page ${pdfPage.pageNumber || ''}`.trim());
      } catch (e) {
        /* Give up on this page, not on the run. The page is reported by name
           in "Pages I could not read cleanly", and the worker is discarded
           because a wedged one will only wedge again. */
        this.reason = e.message + '. The rest of the file was read normally.';
        await this.shutdown();
        this.state = 'failed';
        return null;
      }
      const words = (res && res.data && res.data.words) || [];
      return words.filter(wd => wd.text && wd.text.trim()).map(wd => ({
        x: wd.bbox.x0 / scale,
        y: pageHeight - wd.bbox.y1 / scale,     // PDF origin is bottom-left
        w: (wd.bbox.x1 - wd.bbox.x0) / scale,
        h: (wd.bbox.y1 - wd.bbox.y0) / scale,
        text: wd.text, confidence: wd.confidence
      }));
    },

    async shutdown() {
      if (this.worker) { try { await this.worker.terminate(); } catch { /* nothing to do */ } }
      this.worker = null; this.state = 'idle';
    }
  };

  /* ======================================================================
     11.  ROLE ASSIGNMENT AND THE PIPELINE ORDER

     T16-01 asserts the probe runs BEFORE any advocate name is searched for,
     and that ordering is structural rather than incidental: roles have to be
     settled for the whole document before Pass A can know which cells are
     counsel-bearing, and Pass A has to run before reconciliation can say
     whether Pass B found something Pass A missed.
     ================================================================== */

  const looksLikeIndex   = c => /^\s*\d{1,4}\s*\.?\s*$/.test(c);
  const looksLikeCaseNo  = c => /\b[A-Z][A-Z.]{0,6}\s*\.?\s*(?:Nos?\.?\s*)?\d{1,6}\s*(?:\/|\s+of\s+)\s*\d{4}/i.test(c);
  const looksLikeDate    = c => CO.REPOST_DATE_RE.test(c);

  /* Assemble every cell of a column across the whole document, then probe it.
     Cells, not lines — see the note on Decision D39 in probeColumn. */
  function columnCells(tables, colIndex) {
    const out = [];
    for (const t of tables) {
      for (let r = headerRowCount(t); r < t.cells.length; r++) {
        const cell = t.cells[r][colIndex];
        if (!cell) continue;
        if (cell.owner !== cell) continue;      // only count a merged cell once
        if (cell.text) out.push(cell.text);
      }
    }
    return out;
  }

  /* Roles come from two places: declared in the profile, and discovered by the
     probe, which runs first and may upgrade a party column. A forum with no
     profile at all still works, because the probe finds its counsel-bearing
     columns from content alone (T16-14). */
  function assignRoles(tables, profile) {
    if (!tables.length) return { roles: [], probes: [] };
    const nCols = tables[0].nCols;
    const declared = profile && profile.columns && profile.columns.length === nCols
      ? profile.columns : null;
    const header = headerTextOf(tables[0]);
    const isReposting = /reposted/i.test(header);

    const roles = [], probes = [];
    for (let c = 0; c < nCols; c++) {
      const cells = columnCells(tables, c);
      const probe = probeColumn(cells);
      const base = declared ? declared[c] : inferColumn(c, nCols, cells, isReposting);
      const decided = classifyColumn(probe, base.role);
      roles.push(Object.assign({}, base, {
        role: decided.role,
        probed: decided.role !== base.role,
        direction: probe.direction
      }));
      probes.push({
        column: base.name, declaredRole: base.role, role: decided.role,
        cells: probe.cells, connectors: Math.max(probe.pf, probe.cf),
        density: probe.density, direction: probe.direction, why: decided.why
      });
    }
    return { roles, probes, fromProfile: !!declared };
  }

  function inferColumn(c, nCols, cells, isReposting) {
    const sample = cells.slice(0, 40);
    const frac = f => sample.length ? sample.filter(f).length / sample.length : 0;
    if (c === 0 && frac(looksLikeIndex) > 0.5) return { name: 'serial', role: 'index' };
    if (frac(looksLikeCaseNo) > 0.4) return { name: 'caseNo', role: 'caseNumber', expandRanges: true };
    if (isReposting && frac(looksLikeDate) > 0.4) return { name: 'repostedTo', role: 'extra', label: 'Reposted to' };
    if (frac(looksLikeDate) > 0.6) return { name: `col${c + 1}`, role: 'extra', label: 'Date' };
    /* Anything left that carries prose is a candidate party column; the probe
       decides whether it also carries counsel. */
    const side = c === 2 ? 'petitioner' : c === 3 ? 'respondent' : null;
    return { name: `col${c + 1}`, role: 'party', side, subNumbering: side === 'respondent' };
  }

  /* ------------------------------------------------------------------
     readDocument — one PDF, start to finish.
     ------------------------------------------------------------------ */
  async function readDocument(fileRec, opts) {
    opts = opts || {};
    const roster   = opts.roster || [];
    const thorough = opts.thorough !== false;
    const report   = opts.onProgress || (() => {});
    /* Checked between pages so a stopped run finishes with what it has read so
       far rather than throwing it away. Half a list is worth more than none. */
    const stopped  = opts.stopped || (() => false);
    const lib      = await pdfio.ensure();

    const result = {
      file: fileRec.name, official: !!fileRec.official,
      docType: null, profile: null, pages: [], items: [], reposted: [],
      probes: [], badPages: [], cappedRanges: [], ocrPages: [], notes: [],
      pageCount: 0, ocrUnavailable: null
    };

    let doc;
    try {
      doc = await pdfio.open(fileRec.bytes);
    } catch (e) {
      /* §8.7 — name the file, state what failed, carry on with the rest. */
      result.notes.push({ level: 'error', text:
        `${fileRec.name} could not be opened as a PDF (${e && e.message ? e.message : e}). No part of it was read.` });
      return result;
    }
    result.pageCount = doc.numPages;

    /* ---- phase 1: read every page, OCR the ones with no text layer ---- */
    for (let n = 1; n <= doc.numPages; n++) {
      if (stopped()) {
        result.notes.push({ level: 'warn', text:
          `${fileRec.name}: you stopped the run after page ${n - 1} of ${doc.numPages}. ` +
          'Everything read up to that point is below; the rest of the file was not searched.' });
        break;
      }
      let page;
      try {
        page = await pdfio.readPage(doc, n, lib);
      } catch (e) {
        result.notes.push({ level: 'error', text:
          `${fileRec.name} page ${n} could not be read (${e && e.message ? e.message : e}). The other pages were read normally.` });
        continue;
      }

      if (page.charCount < X.OCR_MIN_CHARS) {
        const spans = await Promise.race([
          ocr.readPage(page._pdfPage, page.height,
            m => report({ phase: 'ocr', file: fileRec.name, page: n, detail: m })),
          ocr.cancelSignal()
        ]).catch(() => null);
        if (spans) {
          page.spans = spans; page.wasOCR = true; finishPage(page);
          result.ocrPages.push(n);
        } else {
          result.ocrUnavailable = result.ocrUnavailable || ocr.reason;
          result.badPages.push({ page: n, why: 'no text layer, and scanned-page reading is unavailable', text: '' });
          result.notes.push({ level: 'warn', text:
            `${fileRec.name} page ${n} has no text layer and could not be picture-read, so anything on it was not searched. Results may be incomplete.` });
        }
      } else if (thorough && page.charCount < X.THIN_TEXT_CHARS) {
        /* §5.11 thorough mode: read a thin page a second way and merge, so a
           partly-broken text layer cannot hide a listing. */
        const spans = await Promise.race([
          ocr.readPage(page._pdfPage, page.height,
            m => report({ phase: 'ocr', file: fileRec.name, page: n, detail: m })),
          ocr.cancelSignal()
        ]).catch(() => null);
        if (spans && spans.length) {
          page.ocrSpans = spans;
          page.spans = page.spans.concat(spans);
          page.wasOCR = true; finishPage(page);
          result.ocrPages.push(n);
        }
      }

      result.pages.push(page);
      report({ phase: 'read', file: fileRec.name, page: n, of: doc.numPages });
      if (n % 8 === 0 && typeof requestAnimationFrame !== 'undefined')
        await new Promise(r => setTimeout(r, 0));      // keep the UI painting
    }

    /* ---- phase 2: settle the document type, per file ---- */
    const sample = result.pages.slice(0, 2).map(p => p.text).join('\n');
    const det = detectDocType(sample);
    const chosen = fileRec.typeOverride && fileRec.typeOverride !== 'auto'
      ? { id: fileRec.typeOverride, profile: CO.PROFILES.find(p => p.id === fileRec.typeOverride) || null,
          confident: true, why: 'Type chosen by you. No re-detection.' }
      : det;
    result.docType = chosen.id;
    result.detected = det;
    result.profile = chosen.profile;
    result.typeWhy = chosen.why;
    if (!chosen.confident && !fileRec.typeOverride)
      result.notes.push({ level: 'warn', text:
        `${fileRec.name}: ${chosen.why} It was read with the structure-blind sweep as well, and anything found is being asked about rather than accepted.` });

    /* ---- phase 3: geometry and the connector probe — still no names ---- */
    const allTables = [];
    for (const page of result.pages) {
      page.tables = buildTables(page);
      for (const t of page.tables) { t.page = page.index; allTables.push(t); }
    }
    const bySig = new Map();
    for (const t of allTables) {
      const sig = String(t.nCols) + ':' + (/reposted/i.test(headerTextOf(t)) ? 'rep' : 'main');
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(t);
    }
    const rolesFor = new Map();
    for (const [sig, group] of bySig) {
      const isRep = sig.endsWith(':rep');
      const prof = isRep ? CO.PROFILES.find(p => p.id === 'adjournment')
                         : (result.profile && result.profile.kind !== 'adjournment' ? result.profile : result.profile);
      const { roles, probes, fromProfile } = assignRoles(group, isRep ? null : prof);
      rolesFor.set(sig, roles);
      result.probes.push({ signature: sig, tables: group.length, fromProfile, columns: probes });
      if (isRep && group.length && result.docType !== 'adjournment')
        result.notes.push({ level: 'info', text:
          `${fileRec.name} carries a reposting table appended after the list. It was read as its own section.` });
    }

    /* ---- phase 4: Pass A, Pass B, reconcile ---- */
    const idx = buildRosterIndex(roster);
    let carried = null;
    for (const page of result.pages) {
      const ctx = pageContext(page, carried);
      carried = ctx;

      let a = { items: [], reposted: [] };
      if (page.tables.length) {
        for (const t of page.tables) {
          const sig = String(t.nCols) + ':' + (/reposted/i.test(headerTextOf(t)) ? 'rep' : 'main');
          const roles = rolesFor.get(sig) || [];
          const got = passA_table(page, t, result.profile, roles, ctx, fileRec);
          a.items = a.items.concat(got.items);
          a.reposted = a.reposted.concat(got.reposted);
        }
      } else if (result.docType === 'adjournment') {
        a = passA_adjournLines(page, fileRec);
      } else {
        a = passA_columns(page, ctx, fileRec);
      }

      /* Remember where each item sits so a sweep hit can be attached to it. */
      for (const it of a.items) {
        const ys = [];
        for (const t of page.tables)
          for (const row of t.cells)
            for (const cell of row) if (cell.text && it.rawText.includes(cell.text)) ys.push(cell.top, cell.bot);
        if (ys.length) { it._yTop = Math.max(...ys); it._yBot = Math.min(...ys); }
      }

      const b = roster.length ? passB(page, roster, idx) : [];
      const rec = reconcilePage(page, a.items, b);

      /* §5.10 — a B-only hit is never dropped and never auto-accepted. It is
         exactly the missed-listing case, and also exactly the false-positive
         case, and only a human can separate them. (Decision D27.)

         One entry per advocate per matter, keeping the strongest reading:
         a subject-matter cell that yields "Ganesh", "Ganesh." and "M/s.Ganesh"
         is one question to ask, not three (T13-10). */
      const bestPerHost = new Map();
      for (const h of rec.bOnly) {
        const host = itemAtY(a.items, h.y);
        const key = (host ? host.id : 'orphan:' + Math.round(h.y)) + '|' + h.advocate.id;
        const cur = bestPerHost.get(key);
        if (!cur || h.score.combined > cur.h.score.combined) bestPerHost.set(key, { h, host });
      }

      for (const { h, host } of bestPerHost.values()) {
        const asParty = h.placedAs === 'party';
        const entry = asParty ? {
          name: h.printed, matchRole: 'party', source: 'B',
          side: h.placedIn && flatten(h.placedIn.respondent).includes(flatten(h.printed))
                  ? 'respondent' : 'petitioner',
          column: 'parties', advocateId: h.advocate.id, advocateKey: advocateKey(h.advocate),
          tier: h.tier, score: h.score,
          why: 'printed as a party to this matter, not as counsel on it'
        } : {
          name: h.printed, matchRole: 'unplaced', side: 'unknown', source: 'B',
          column: null, advocateId: h.advocate.id, advocateKey: advocateKey(h.advocate),
          tier: h.tier, score: h.score,
          why: 'found on this page, but not in a column that carries advocate names — the layout may not have been read correctly'
        };
        if (host) {
          host.namesWithRole.push(entry);
          host.allNames = [...new Set(host.namesWithRole.map(n => n.name))];
        } else {
          a.items.push({
            id: nextId('it'), sourceFile: fileRec.name, sourceIsOfficial: !!fileRec.official,
            page: page.index, court: ctx.court, hall: ctx.hall, coram: ctx.coram,
            listType: ctx.listType, itemNo: null,
            caseNumbers: CO.findCaseNumbers(h.line), caseKeys: CO.expandCaseCell(h.line),
            cappedRanges: [], petitioner: '', respondent: '',
            counselPetitioner: [], counselRespondent: [],
            allNames: [h.printed], extra: {},
            namesWithRole: [entry],
            ocrPages: page.wasOCR ? [page.index] : [],
            layoutConfidence: page.layoutConfidence, rawText: h.line
          });
        }
      }

      if (page.layoutConfidence === 'low')
        result.badPages.push({ page: page.index, why: 'the columns on this page could not be separated', text: page.text.slice(0, 4000) });

      for (const it of a.items) {
        if (it.cappedRanges && it.cappedRanges.length) result.cappedRanges.push(...it.cappedRanges.map(c => ({ ...c, page: page.index })));
        result.items.push(it);
      }
      for (const rp of a.reposted) {
        if (rp.cappedRanges && rp.cappedRanges.length) result.cappedRanges.push(...rp.cappedRanges.map(c => ({ ...c, page: page.index })));
        result.reposted.push(rp);
      }
      report({ phase: 'match', file: fileRec.name, page: page.index, of: doc.numPages,
               items: result.items.length });
    }

    /* §5.10.1 — if more than a fifth of the file read badly, that is the first
       thing the user must be told, before any match is shown. */
    const lowPages = result.pages.filter(p => p.layoutConfidence === 'low').length;
    if (result.pages.length && lowPages / result.pages.length > X.LOW_CONF_FILE_PCT)
      result.notes.push({ level: 'error', text:
        `${fileRec.name}: ${lowPages} of ${result.pages.length} pages did not read cleanly. Treat these results as incomplete and check the pages listed below.` });

    if (result.cappedRanges.length)
      result.notes.push({ level: 'warn', text:
        `${fileRec.name}: ${result.cappedRanges.length} printed case-number range(s) were too wide to be real and were not expanded. They are listed in "how this file was read".` });

    /* Free the pdf.js page handles; the text we need is already in the model. */
    for (const p of result.pages) delete p._pdfPage;
    pdfio.close(doc);
    return result;
  }

  CO.extract = {
    clusterCoords, overlap, joinSpans, groupLines, counselColumnX, isNoiseLine,
    buildTables, headerRowCount, headerTextOf, isFooterLine,
    detectDocType, findConnector, probeColumn, classifyColumn, respondentNumbering,
    pageContext, passA_table, passA_columns, passA_adjournLines,
    buildRosterIndex, candidateStrings, passB, reconcilePage, itemAtY,
    finishPage, classifyPage, needsThorough, nextId,
    columnCells, assignRoles, inferColumn, readDocument, ocr
  };
  CO.splitPartyCounsel = splitPartyCounsel;
  CO.pdfio = pdfio;

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
