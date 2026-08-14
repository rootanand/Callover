/* ============================================================================
   Callover — 30-initials.js
   TDD.md §4.3. The initials comparison state machine.

   Initials carry more discriminating power per character than any other part
   of an Indian advocate's name, and they are also the part a registry typist
   is most likely to get wrong. So they are compared on their own, by an
   ordered set of rules, and the ORDER MATTERS — rule 5 must be tried before
   rule 6, and rule 7 before rule 8, or "E" against "ES" is scored as a typo
   rather than as an abbreviation.

   Each state also carries a human sentence, because §7.2.3 forbids a confirm
   card from saying "initials state: flip-plausible, 0.50" to a lawyer. The
   card says "one initial differs — E and R sit next to each other on a
   keyboard" instead, and T9-08 fails the build if any note leaks a number or
   an internal state name.
   ========================================================================= */
;(function (CO) {
  'use strict';

  /* Is this single-character difference explainable? Two ways: the keys are
     adjacent on a QWERTY keyboard (a typist's slip), or the glyphs look alike
     (an OCR or handwriting confusion). Checked in both directions, because
     neither table is symmetric. */
  function plausibleFlip(a, b) {
    return (CO.KEY_ADJ[a]   || '').includes(b) ||
           (CO.LOOKALIKE[a] || '').includes(b) ||
           (CO.KEY_ADJ[b]   || '').includes(a) ||
           (CO.LOOKALIKE[b] || '').includes(a);
  }

  function initialsCompare(qInits, cInits) {
    const q = qInits.join(''), c = cInits.join('');
    const S = CO.INITIALS_SCORE;

    /* 1-3. One side or the other has nothing to compare. Not evidence against
       a match — plenty of registries print no initial at all — but not
       evidence for one either, so it sits just below neutral. */
    if (!q && !c) return { state: 'both-absent',     score: S['both-absent'] };
    if (q && !c)  return { state: 'absent-in-list',  score: S['absent-in-list'] };
    if (!q && c)  return { state: 'absent-in-query', score: S['absent-in-query'] };

    /* 4. Identical. */
    if (q === c) return { state: 'exact', score: S['exact'] };

    /* 5. One is a prefix of the other: "E" against "E.S". An advocate's full
       initials are routinely abbreviated to the first. */
    if (q.startsWith(c) || c.startsWith(q)) return { state: 'partial', score: S['partial'] };

    /* 6. One is a subset of the other in any order. */
    if ([...q].every(ch => c.includes(ch)) || [...c].every(ch => q.includes(ch)))
      return { state: 'subset', score: S['subset'] };

    if (q.length === c.length) {
      const diff = [];
      for (let i = 0; i < q.length; i++) if (q[i] !== c[i]) diff.push(i);

      /* 7 and 8. Exactly one character differs. Whether that is a near-certain
         typo or a different advocate entirely turns on whether the two
         characters are confusable — and the gap between the two scores is
         deliberately large. See the note on flip-other in 00-config.js. */
      if (diff.length === 1) {
        const a = q[diff[0]], b = c[diff[0]];
        return plausibleFlip(a, b)
          ? { state: 'flip-plausible', score: S['flip-plausible'] }
          : { state: 'flip-other',     score: S['flip-other'] };
      }

      /* 9. Same letters, different order: "SM" against "MS". */
      if ([...q].sort().join('') === [...c].sort().join(''))
        return { state: 'transposed', score: S['transposed'] };
    }

    /* 10. Anything else. */
    return { state: 'different', score: S['different'] };
  }

  /* §7.2.3 — the same finding, in the words a lawyer would use. `q` and `c`
     are the query and printed initial strings, for naming the actual letters.
     Returns null where there is nothing worth saying. */
  function initialsNote(state, q, c) {
    const one = s => (s || '').split('').join('.');
    switch (state) {
      case 'exact':
        return null;
      case 'both-absent':
        return 'Neither your list nor the registry printed an initial.';
      case 'absent-in-list':
        return 'The registry printed no initial at all, so there is nothing here to tell two advocates of this name apart.';
      case 'absent-in-query':
        return `The registry printed the initial ${one(c)}, which your list does not carry.`;
      case 'partial':
        return `Same opening initial. One list carries ${one(q)} and the other ${one(c)} — an abbreviation rather than a different name.`;
      case 'subset':
        return `The same initials appear on both sides, ${one(q)} against ${one(c)}, but not all of them.`;
      case 'flip-plausible': {
        const i = [...q].findIndex((ch, k) => ch !== c[k]);
        const a = q[i], b = c[i];
        const kb = (CO.KEY_ADJ[a] || '').includes(b) || (CO.KEY_ADJ[b] || '').includes(a);
        return kb
          ? `One initial differs. ${a} and ${b} sit next to each other on a keyboard — a likely slip by the registry typist.`
          : `One initial differs. ${a} and ${b} are easily mistaken for one another in print or in handwriting.`;
      }
      case 'flip-other': {
        const i = [...q].findIndex((ch, k) => ch !== c[k]);
        return `One initial differs, ${q[i]} against ${c[i]}, and the two are not easily confused. This is most likely a different advocate.`;
      }
      case 'transposed':
        return `The same initials in the other order — ${one(q)} against ${one(c)}.`;
      default:
        return `The initials do not correspond: ${one(q)} against ${one(c)}.`;
    }
  }

  CO.plausibleFlip   = plausibleFlip;
  CO.initialsCompare = initialsCompare;
  CO.initialsNote    = initialsNote;

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
