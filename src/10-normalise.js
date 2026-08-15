/* ============================================================================
   Callover — 10-normalise.js
   TDD.md §4.1 (names), §4.5 (case numbers), §4.6a (range expansion).

   Ported from src/engine-reference.js and src/ranges-reference.js, which are
   kept in the tree unchanged. tests/run.mjs runs a differential pass (T0)
   asserting this port and those references agree on every input, so a future
   "tidy-up" here cannot quietly change what the engine decides.
   ========================================================================= */
;(function (CO) {
  'use strict';

  /* ---------------------------------------------------------------- §4.1 */

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function upperClean(raw) {
    let s = stripDiacritics(String(raw || '')).toUpperCase();
    s = s.replace(/[\u2018\u2019`]/g, "'");
    return s;
  }

  /* Split a raw advocate string into initials and core name tokens.

     Initials and core are kept SEPARATE, and this is the single most important
     design decision in the engine. In the real Madras HC list the core name
     BALAJI appears with 19 distinct initial sets, SARAVANAN with 17, GANESH
     with 11. Concatenating initials into the name merges nineteen different
     advocates into one; discarding initials does exactly the same. They have
     to be compared separately, under different rules. (Decision D1.) */
  function splitName(raw) {
    let s = upperClean(raw);
    s = s.replace(/^M\/S\.?\s*/, '');          // a chambers prefix, not a name
    s = s.replace(CO.TITLE_RE, ' ');
    s = s.replace(CO.ROLE_RE, ' ');
    s = s.replace(CO.PARTY_SEP_RE, ' ');       // "against", "and others" — punctuation, not names
    s = s.replace(/\bR-?\d+\b|\bD-?\d+\b|\bP-?\d+\b/g, ' ');   // R1, D8, P-2 markers
    s = s.replace(/[^A-Z. ]/g, ' ');
    const toks = s.split(/[.\s]+/).filter(Boolean);
    return {
      initials: toks.filter(t => t.length === 1),
      core:     toks.filter(t => t.length > 1),
      raw:      String(raw || '').trim()
    };
  }

  /* Tamil / Indic transliteration skeleton.

     GANESH -> GNS, GANESAN -> GNSN, KRISHNAMURTHY -> KRSNMRT,
     KRISHNAMOORTHI -> KRSNMRT. */
  function foldIndic(s) {
    let t = upperClean(s).replace(/[^A-Z]/g, '');
    for (const [a, b] of CO.FOLD_RULES) t = t.split(a).join(b);
    t = t.replace(/(.)\1+/g, '$1');      // collapse doubled letters
    t = t.replace(/[AEIOU]/g, '');       // consonant skeleton
    return t;
  }

  /* ---------------------------------------------------------------- §4.5
     Canonical case number. ocr=true folds character confusions per slot.

     The dot strip happens FIRST. An earlier version stripped non-alphanumerics
     before dots and turned C.C.No.212/2026 into type "C", silently failing to
     match "CC 212 of 2026". Regression test T3-05 locks this. */
  function normCaseNo(raw, ocr) {
    let s = upperClean(raw).replace(/\./g, '');
    s = s.replace(/\b(OF|NO|NOS|SL|CASE|YEAR)\b/g, ' ');
    s = s.replace(/NO(?=\d)/g, ' ');
    s = s.replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = s.match(/([A-Z0-9]{1,8})\s*([0-9OILSBGZQD]{1,7})\s*([0-9OILSBGZQD]{4})/);
    if (!m) return s;
    let [, typ, num, yr] = m;
    if (ocr) {
      num = [...num].map(c => CO.OCR_TO_DIGIT[c] ?? c).join('');
      yr  = [...yr ].map(c => CO.OCR_TO_DIGIT[c] ?? c).join('');
      typ = [...typ].map(c => CO.OCR_TO_ALPHA[c] ?? c).join('');
    }
    const n = parseInt(num, 10);
    if (!isNaN(n)) num = String(n);
    return `${typ}/${num}/${yr}`;
  }

  /* §6.2 — build a register key from the firm's separate columns. */
  function caseKeyFromParts(type, no, year) {
    return normCaseNo(`${type || ''}/${no || ''}/${year || ''}`);
  }

  /* ---------------------------------------------------------------- §4.6a
     Range expansion.

     Tribunal lists group matters, and one cell can carry dozens of case
     numbers. "R.P.48 to 96/ 2023" is FORTY-NINE matters. Treating that cell as
     one opaque string loses 48 of the firm's 49 possible listings, which makes
     this the single highest-yield feature for tribunal practice. (Decision D20.) */

  const TYPE_SRC = '(?:[A-Z]{1,4}(?:\\.[A-Z]){0,3}\\.?|SMR|S\\.M\\.R\\.?|R\\.C\\.?|I\\.A\\.?|O\\.A\\.?|M\\.P\\.?)';
  const cleanType = t => t.replace(/[^A-Z]/g, '');

  /* Full result: the keys, plus any range that was refused for being absurdly
     wide. A misparse of a page number as a range must not generate an
     unbounded key set, and it must not do so SILENTLY either — the refused
     ranges are surfaced in the "how this file was read" panel. */
  function expandCaseCellDetailed(raw) {
    if (!raw) return { keys: [], capped: [] };

    let s = String(raw).toUpperCase()
      .replace(/\u00A0/g, ' ')
      .replace(/\bNOS?\b\.?/g, ' ')     // "R.P.Nos.243" -> "R.P. 243"
      .replace(/\bOF\b/g, '/')          // "R.P.17 of 2026" -> "R.P.17/2026"
      .replace(/\s*\/\s*/g, '/')        // "R.P.48 to 96/ 2023"
      .replace(/\s+/g, ' ')
      .trim();

    const out = [], capped = [];
    const segs = s.split(/,/);
    let lastType = null;

    for (let seg of segs) {
      seg = seg.trim();
      if (!seg) continue;

      /* A segment may declare its own type ("A.P.141 to 144/2022") or inherit
         the previous one ("R.P.125 to 127/2025"). */
      const tm = seg.match(new RegExp('^(' + TYPE_SRC + ')\\s*'));
      let type = lastType;
      if (tm && /[A-Z]/.test(tm[1])) {
        const t = cleanType(tm[1]);
        if (t) { type = t; seg = seg.slice(tm[0].length); }
      }
      if (!type) continue;
      lastType = type;

      /* The trailing /YYYY is the year. It may be absent, because the year is
         printed once at the end of the whole cell — back-filled below. */
      const ym = seg.match(/\/\s*(\d{4})\s*$/);
      let year = ym ? ym[1] : null;
      if (ym) seg = seg.slice(0, ym.index);

      for (const part of seg.split(/\s*(?:AND|&)\s*/)) {
        const p = part.trim();
        if (!p) continue;

        const range = p.match(/^(\d+)\s*(?:TO|-|\u2013|\u2014)\s*(\d+)$/);
        if (range) {
          const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
          if (b >= a) {
            if ((b - a + 1) <= CO.RANGE_CAP) {
              for (let n = a; n <= b; n++) out.push({ type, num: n, year });
            } else {
              capped.push({ type, from: a, to: b, year, members: b - a + 1 });
            }
          }
          continue;
        }

        const single = p.match(/^(\d+)$/);
        if (single) { out.push({ type, num: parseInt(single[1], 10), year }); continue; }

        const tn = p.match(new RegExp('^(' + TYPE_SRC + ')\\s*(\\d+)$'));
        if (tn) {
          const t = cleanType(tn[1]);
          if (t) lastType = t;
          out.push({ type: t || type, num: parseInt(tn[2], 10), year });
        }
      }
    }

    /* Back-fill missing years from the nearest FOLLOWING entry that has one. */
    for (let i = out.length - 1, y = null; i >= 0; i--) {
      if (out[i].year) y = out[i].year; else out[i].year = y;
    }
    for (let i = capped.length - 1; i >= 0; i--) {
      if (!capped[i].year && out.length) capped[i].year = out[out.length - 1].year;
    }

    return {
      keys: out.filter(e => e.year).map(e => `${e.type}/${e.num}/${e.year}`),
      capped
    };
  }

  function expandCaseCell(raw) { return expandCaseCellDetailed(raw).keys; }

  /* Pull every case-number-looking token out of a free line of text, for the
     sweep pass and for adjournment rows that are not in a ruled table. */
  function findCaseNumbers(text) {
    if (!text) return [];
    const out = [];
    const re = /\b([A-Z][A-Z.\s]{0,10}?)\s*\.?\s*(?:NOS?\.?)?\s*(\d{1,6}(?:\s*(?:TO|AND|&|,)\s*\d{1,6})*)\s*(?:\/|\s+OF\s+)\s*(\d{4})\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[0].trim());
    return out;
  }

  CO.stripDiacritics       = stripDiacritics;
  CO.upperClean            = upperClean;
  CO.splitName             = splitName;
  CO.foldIndic             = foldIndic;
  CO.normCaseNo            = normCaseNo;
  CO.caseKeyFromParts      = caseKeyFromParts;
  CO.expandCaseCell        = expandCaseCell;
  CO.expandCaseCellDetailed = expandCaseCellDetailed;
  CO.findCaseNumbers       = findCaseNumbers;

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
