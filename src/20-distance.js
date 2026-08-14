/* ============================================================================
   Callover — 20-distance.js
   TDD.md §4.2. String distance. Pure, deterministic, no allocation surprises.

   These four functions are the hot loop: a 642-page cause list yields roughly
   10,000 distinct name strings, each scored against every firm advocate, and
   T6-05 requires the whole scoring pass to finish in under two seconds.
   ========================================================================= */
;(function (CO) {
  'use strict';

  /* Classic two-row dynamic programming, with an early exit once the best cell
     in a row already exceeds the cap. The cap is what keeps a 10,000 x 6
     comparison affordable — most pairs are wildly different and bail on the
     first or second row. */
  function levenshtein(a, b, cap) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    if (cap != null && Math.abs(la - lb) > cap) return cap + 1;

    let prev = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let best = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (cap != null && best > cap) return cap + 1;
      const t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  function ratio(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  /* Standard Jaro-Winkler, prefix scale 0.1, maximum prefix 4. Kept alongside
     the edit ratio because the two disagree usefully: Jaro-Winkler rewards a
     shared opening, which is exactly the part of a Tamil name transliteration
     leaves alone. */
  function jaroWinkler(s1, s2) {
    if (s1 === s2) return 1;
    const l1 = s1.length, l2 = s2.length;
    if (!l1 || !l2) return 0;

    const win = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
    const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
    let m = 0;
    for (let i = 0; i < l1; i++) {
      const lo = Math.max(0, i - win), hi = Math.min(i + win + 1, l2);
      for (let j = lo; j < hi; j++) {
        if (m2[j] || s1[i] !== s2[j]) continue;
        m1[i] = m2[j] = true; m++; break;
      }
    }
    if (!m) return 0;

    let k = 0, tr = 0;
    for (let i = 0; i < l1; i++) {
      if (!m1[i]) continue;
      while (!m2[k]) k++;
      if (s1[i] !== s2[k]) tr++;
      k++;
    }
    tr /= 2;

    const j = (m / l1 + m / l2 + (m - tr) / m) / 3;
    let p = 0;
    while (p < 4 && p < l1 && p < l2 && s1[p] === s2[p]) p++;
    return j + p * 0.1 * (1 - j);
  }

  /* Greedy best alignment over two token lists, order-independent, each pair
     scored on the better of its raw and folded similarity. Normalised by the
     longer list so a stray extra token costs something without being fatal. */
  function tokenSetScore(A, B) {
    if (!A.length || !B.length) return 0;
    const used = new Set();
    let tot = 0;
    for (const a of A) {
      let best = 0, bi = -1;
      B.forEach((b, i) => {
        if (used.has(i)) return;
        const s = Math.max(ratio(a, b), ratio(CO.foldIndic(a), CO.foldIndic(b)));
        if (s > best) { best = s; bi = i; }
      });
      if (bi >= 0) used.add(bi);
      tot += best;
    }
    return tot / Math.max(A.length, B.length);
  }

  CO.levenshtein   = levenshtein;
  CO.ratio         = ratio;
  CO.jaroWinkler   = jaroWinkler;
  CO.tokenSetScore = tokenSetScore;

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
