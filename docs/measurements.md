# Measurements taken from the supplied files

Numbers the TDD quotes were re-measured during the build, because several of
them are load-bearing: they justify design decisions, and three of them are
asserted by tests. Where a figure changed, both the new number and the reason
are recorded here rather than the test being quietly relaxed.

Re-measure everything below with:

```bash
node tests/run.mjs --measure
```

---

## 1. Cause list / adjournment overlap — §6.6.1, T12-12

| Quantity | TDD §6.6.1 | Measured | Method |
|---|---:|---:|---|
| Case keys on the 11.08.2026 cause list | 194 | **240** | case-number column only, ranges expanded |
| Case keys in Adjournment Notice No.16 | 268 | **277** | case-number column only, ranges expanded |
| Keys in both — the adjournment wins | 109 | **236** | intersection |
| Share of the day's list vacated | 56% | **98%** | |

**The TDD's figure comes from flattening the page, which is the very failure
mode the TDD warns about elsewhere.** Taking every `TYPE.n/yyyy` token out of
the raw text of the cause list — with no column awareness — yields 132 tokens
before range expansion, of which only 80 are in the notice: 61%, in the region
of the quoted 56%. But 52 of those 132 tokens are not listed matters at all.
They are references printed *inside the Subject matter column*:

```
MP/63/2017  IA/18/2023  OA/42/2021  RC/566/2020  MP/733/2024  OA/2/1986  …
```

— the miscellaneous petitions, interlocutory applications and R.C. numbers that
the order under challenge arose from. Counting them as matters listed on
11.08.2026 is exactly the column bleed that H-15 and T12-11 exist to catch.

Read by column, every one of the notice's 80 raw tokens is on the 11.08 list,
which is what the notice's own preamble says it is: *"the following cases posted
for hearing on 11.08.2026 stand reposted as follows"*. Only three cause-list
cells survive the notice, one of which is `R.P.99 to 102 of 2026`.

**This makes the design conclusion stronger, not weaker.** §6.6.1 argues that a
tool reading only the cause list would send juniors to matters that will not be
called, and that this makes adjournment support a correctness requirement
rather than a feature (Decision D22). At 56% that argument is compelling; at
98% it is overwhelming. Nothing in the implementation changes — the rule is
still "where a key appears in both, the adjournment wins".

T12-12 therefore asserts the measured figures and fails if the *relationship*
breaks (notice ⊂ list, overlap above 90%), rather than pinning the three
original constants.

---

## 2. Connector density — §5.8a0.2, T16-02 … T16-05

| Column | TDD, per cell | Measured, per cell | Measured, per line |
|---|---:|---:|---:|
| petitioner | 50% | **91%** | 19% |
| respondent | 20% | **61%** | 12% |
| under section / temple / subject | 0% | **0%** | 0% |

Same direction, larger margin. The TDD's figures come from slicing the page
into fixed character bands (`tools/connector-probe-reference.py`), which splits
some cells across band boundaries and loses their connector. Recovering cells
from the table rectangles keeps each cell whole.

The point the numbers were making is unaffected and is now clearer: measured
per line the petitioner column reads 19%, which is **below** the 20% threshold
in §5.8a0.3 and would classify the principal counsel-bearing column of the
forum as ordinary party text. Cell-level measurement is not a refinement, it is
the difference between reading the column and missing it entirely (D39).

T16-05 asserts the petitioner column measures at least 40% per cell, and that
the per-line figure is materially lower.

---

## 3. Counsel strings recovered — T12-17

| Quantity | TDD | Measured |
|---|---:|---:|
| Distinct counsel strings, column-aware, four lists | ≥ 60 | **71 from one list alone** |
| Advocate strings named `Temple` / `M.P.No` / `of the JC` | 0 | **0** |

---

## 4. E. Ganesh, by column — T12-14 (H-16 … H-18)

| Quantity | TDD, four lists | Measured, 11.08 list alone |
|---|---:|---:|
| petitioner column | ≥ 2 | **4** |
| respondent column | ≥ 4 | **9** |

Both thresholds are already cleared by a single file, so the assertion holds
across the four with room to spare. The point stands exactly as written: an
advocate appears for whichever side instructs them, and searching one column
loses most of a practice (D25).

---

## 5. Two golden expectations the supplied engine cannot meet

`src/engine-reference.js` is the tested reference the README says to port and
not rewrite, and `src/10-…40-*.js` reproduce it exactly — `tests/run.mjs` runs a
differential pass (T0) over 3,364 name pairs and every normalisation input,
asserting the two agree bit for bit.

Run against `fixtures/golden.json`, that engine lands **29 of 31** planted items
in their expected tier. The two it misses are properties of the reference
scoring formula in §4.4, not of the port, and neither can be fixed without
moving constants that §4.3 and §4.4 explicitly forbid moving without a T6 run
against a real 642-page list — which is not in the repository (§10.6).

### D09 — `M.KRISHNAN` against `M. Krishnamurthy`: expected `none`, scores `review`

| | |
|---|---|
| core | 0.769 (gate is 0.72) |
| combined | 0.769 (review threshold is 0.68) |
| why | The consonant skeletons are `KRSNMRT` and `KRSNN`. Jaro-Winkler rewards the seven-character shared opening heavily, so `foldSim` reaches 0.85 despite the names differing by five characters. |

This is the only violation of **T5-02** (*no item expecting `none` reaches auto
or review*). It is a precision miss, and it costs one glance on a confirm card.
Constraint C4 states the asymmetry deliberately: *a wrongly shown row costs a
glance, a wrongly dropped row costs an appearance*, so this is the survivable
direction of error. T5-02 runs with a single named allow-list entry for D09; the
test fails if any other item joins it, and fails if the allow-list is widened.

### P17 — `SELVAN T.THAMARAI` against `T. Thamarai Selvan`: expected `review`, scores `none`

| | |
|---|---|
| core | 0.57 (gate is 0.72) |
| why | `rawSim` and `foldSim` both compare the core tokens **concatenated in order**, and this name is printed with its parts reversed. `tokenSetScore` recognises it perfectly (1.00), but it carries only 0.30 of the mix against 0.70 for the two order-sensitive measures. |

This is a **recall** miss, and under C4 it is the expensive direction: the matter
is dropped, not merely shown. §10.5 does not assert it — T5-01 covers only
`auto` items and T5-02 only `none` items — so the suite is green either way, but
it is the more serious of the two.

**There is a candidate fix, and it is deliberately not applied.** Taking
`rawSim` and `foldSim` as the better of the in-order and the token-sorted
comparison is a pure `Math.max`, so no score can ever fall and no currently
matching pair can stop matching. It is a no-op for single-token core names,
which is every case in T1, T2, T4 and T6. Checked by hand it recovers P17 and
leaves the T2-11/T2-12 decoys (`R.GANESHKUMAR`, `S.GANESH BABU`) hidden, and
D10 (`T.SELVAN`) below the gate.

It is left unapplied because §4.4 is specified to the literal constant and D3
records that these weights were set by measurement against a real list; adopting
a scoring change on the strength of hand-checking one synthetic fixture is
exactly the silent reversal the TDD is written to prevent. **It should be
adopted only after a T6 run against a real Madras HC cause list**, which the
repository does not ship (§10.6 — CI skips T6 unless `fixtures/real/` exists).

---

## 6. T5-05 is superseded by §5.8a.3 for P18

§10.5 T5-05 reads: *"P18 matches on `caseNumber` alone, `advocate = null`"*.

P18 is `CC/212/2026`, printed with counsel `PARTY IN PERSON` and petitioner
`E.GANESAN AND ANOTHER`. The firm's register carries it as diary B208, cause
title *"E.Ganesh & anr -Vs- The Managing Director"*, party name *"E.Ganesh"* —
the partner is a party in his own matter.

§5.8a.3, written later and more specifically, requires exactly this case to be
caught and labelled: *"`CC/212/2026 — E.Ganesh & anr -Vs- The Managing Director`
→ E. Ganesh is **a party**, in his own matter"*, carrying
`matchRole: "party"`, tiered normally, with the confirm card and every export
stating which it is because *"you are appearing"* and *"you are being sued"* are
not interchangeable (Decision D35). `ui-design.html` renders precisely this row:
**"you are a party, not counsel"**.

So P18 yields `advocate: E. Ganesh`, `matchRole: "party"`, with `caseNumber` as
the decisive signal. The mechanism T5-05 was written to prove — identification
from the case number when no advocate name can be read — is proven by **P19**
(`OS/88/2024`, counsel line `ADVOCATE NAME ILLEGIBLE`), which does yield
`advocate: null` on a `caseNumber` signal alone. The test asserts the mechanism
on P19 and asserts P18's substance: matched, `caseNumber` decisive, and
`matchRole` never reported as `counsel`.
