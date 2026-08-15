/* ============================================================================
   Callover — 40-score.js
   TDD.md §4.4 (name scoring) and §4.6 (classification into tiers).
   ========================================================================= */
;(function (CO) {
  'use strict';

  /* Score one firm advocate against one printed string.
     Returns null when either side has no core name to compare — a cell reading
     only "FOR R13" or "PARTY IN PERSON" is not a name and must not be scored. */
  function nameScore(query, candidate) {
    const q = CO.splitName(query), c = CO.splitName(candidate);
    if (!q.core.length || !c.core.length) return null;

    const qCoreStr = q.core.join(' '), cCoreStr = c.core.join(' ');
    const qFlat = qCoreStr.replace(/ /g, ''), cFlat = cCoreStr.replace(/ /g, '');

    /* ORDER GUARD.

       rawSim and foldSim compare the core tokens CONCATENATED, so they are
       order-sensitive, and between them they carry 0.70 of the mix against
       0.30 for the order-independent tokenSetScore. A registry that prints
       "SELVAN T.THAMARAI" for "T. Thamarai Selvan" — surname first, which is a
       routine convention — therefore scored 0.57 and fell below the 0.72 core
       gate, and the matter was dropped. Under C4 that is the expensive
       direction of error: a wrongly shown row costs a glance, a wrongly
       dropped row costs an appearance.

       So each measure is taken as the better of the in-order and the
       token-sorted comparison. This is a pure Math.max over an additional
       candidate, so NO SCORE CAN EVER FALL and nothing that matched before can
       stop matching. For a single-token core name the sorted form is the
       in-order form, which is every case in T1, T2, T4 and T6.

       Measured over 16,276 pairs — the reference corpus plus every distinct
       string extracted from the synthetic corpus and all four real HR&CE
       files — it changes five tiers: it recovers P17, it promotes D10
       ("T.SELVAN" against "T. Thamarai Selvan") from none to review, and it
       moves three unrelated names into the hidden weak tier. See
       docs/measurements.md §5. T0 asserts the divergence from
       src/engine-reference.js is exactly this and nothing else. */
    const qSort = [...q.core].sort().join(' '), cSort = [...c.core].sort().join(' ');
    const qSortFlat = qSort.replace(/ /g, ''), cSortFlat = cSort.replace(/ /g, '');
    const best2 = (a1, b1, a2, b2) => Math.max(
      CO.ratio(a1, b1), CO.jaroWinkler(a1, b1),
      CO.ratio(a2, b2), CO.jaroWinkler(a2, b2));

    const qFold = CO.foldIndic(qCoreStr), cFold = CO.foldIndic(cCoreStr);
    const qFoldSort = CO.foldIndic(qSort), cFoldSort = CO.foldIndic(cSort);

    const rawSim  = best2(qFlat, cFlat, qSortFlat, cSortFlat);
    const foldSim = qFold && cFold
      ? best2(qFold, cFold, qFoldSort || qFold, cFoldSort || cFold)
      : 0;

    /* A join or a split — "Thamarai Selvan" against "Thamaraiselvan" — is not
       a mismatch, so token alignment must not be penalised for differing token
       counts alone. Taking the better of the aligned and the flattened score
       handles both shapes without a special case. */
    const tokSim = Math.max(CO.tokenSetScore(q.core, c.core), CO.ratio(qFlat, cFlat));

    /* HEAD GUARD. Vowel-stripping makes GANESH -> GNS and VIGNESH -> VGNS,
       which score 0.75 on ratio — high enough to surface four unrelated
       VIGNESH advocates when searching for E. Ganesh. Transliteration never
       changes the leading consonant of a Tamil name, so requiring the first
       letter of SOME core token to agree, raw or folded (so CHANDRAN against
       SHANDRAN still works), removes that whole class of false positive at no
       cost to recall. Verified on the real list: 5 false positives gone, zero
       true matches lost. (Decision D3, regression T5-07 / T6-03.)

       THE FOLDED COMPARISON ONLY APPLIES WHEN BOTH TOKENS BEGIN THE SAME WAY —
       both on a consonant, or both on a vowel.

       Folding deletes vowels, INCLUDING A LEADING ONE, and that is not a
       transliteration equivalence: a name that starts with a vowel is a
       different name from one that starts with a consonant. Without this,
       AGAINST folds to GNST against GANESH's GNS, the leading A simply
       vanishes, G meets G and the guard never fires — scoring the English word
       "against" at 0.94 fold similarity and surfacing it as a candidate for
       E. Ganesh. The rule D3 is actually reaching for is that the leading
       SOUND is preserved, and a dropped initial vowel changes it. */
    const vowelHead = s => /^[AEIOU]/.test(s);
    const headOK = q.core.some(qt => c.core.some(ct => {
      if (qt[0] === ct[0]) return true;
      if (vowelHead(qt) !== vowelHead(ct)) return false;
      return (CO.foldIndic(qt)[0] || '') === (CO.foldIndic(ct)[0] || '');
    }));

    const M = CO.SCORE_MIX;
    let core = M.RAW * rawSim + M.FOLD * foldSim + M.TOKEN * tokSim;
    if (!headOK) core *= M.HEAD_PENALTY;

    const ini = CO.initialsCompare(q.initials, c.initials);

    /* Core must be strong. Initials modulate, they do not rescue. */
    const combined = core * (CO.SCORE_INITIALS.FLOOR + CO.SCORE_INITIALS.SPAN * ini.score);

    return {
      combined, core, rawSim, foldSim, tokSim, headOK,
      initials: ini, qFold, cFold, qCore: qCoreStr, cCore: cCoreStr
    };
  }

  /* §4.6 — turn a score into a tier.

     Note the two gates are different in kind. CORE_GATE asks "is this the same
     name at all"; the AUTO threshold asks "am I sure enough not to ask". A
     high combined score cannot buy its way past a weak core, and auto
     additionally requires the initials to be exact or a clean prefix — because
     a confident-looking score on a flipped initial is precisely the case that
     puts the wrong advocate in the wrong court. */
  function classify(sc, opts) {
    if (!sc) return 'none';
    const ocr    = !!(opts && opts.ocr);
    const slack  = ocr ? CO.OCR_SLACK.TIER : 0;
    const gate   = CO.T.CORE_GATE - (ocr ? CO.OCR_SLACK.GATE : 0);

    if (sc.core < gate) return 'none';

    if (sc.combined >= CO.T.AUTO - slack &&
        (sc.initials.state === 'exact' || sc.initials.state === 'partial')) return 'auto';

    if (sc.combined >= CO.T.REVIEW - slack) return 'review';

    /* weak is kept and retrievable, hidden only behind a toggle, so the
       confirm list stays short. Nothing is ever silently discarded. (C4, D4.) */
    if (sc.combined >= CO.T.WEAK - slack) return 'weak';

    return 'none';
  }

  const TIER_RANK = { auto: 3, review: 2, weak: 1, none: 0 };
  const RANK_TIER = { 3: 'auto', 2: 'review', 1: 'weak', 0: 'none' };

  const tierRank = t => TIER_RANK[t] || 0;
  const maxTier  = (a, b) => RANK_TIER[Math.max(tierRank(a), tierRank(b))];
  const capTier  = (t, ceiling) => RANK_TIER[Math.min(tierRank(t), tierRank(ceiling))];

  /* Score a firm roster against one printed string; returns every advocate
     that reached at least `weak`, best first. Used by both extraction passes. */
  function scoreRoster(roster, printed, opts) {
    const out = [];
    for (const adv of roster) {
      const sc = nameScore(adv.name, printed);
      if (!sc) continue;
      const tier = classify(sc, opts);
      if (tier === 'none') continue;
      out.push({ advocate: adv, score: sc, tier, printed });
    }
    out.sort((a, b) => b.score.combined - a.score.combined);
    return out;
  }

  CO.nameScore   = nameScore;
  CO.classify    = classify;
  CO.tierRank    = tierRank;
  CO.maxTier     = maxTier;
  CO.capTier     = capTier;
  CO.scoreRoster = scoreRoster;

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
