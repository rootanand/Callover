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

## 5. Where the engine departs from the supplied reference

`src/engine-reference.js` is the tested reference the README says to port and
not rewrite. `src/10-` … `src/60-*.js` reproduce it exactly **except for one
deliberate change, the order guard in §4.4**, described in 5b below.
`tests/run.mjs` runs a differential pass (T0) over 3,364 name pairs and every
normalisation input, proving that divergence is the only one and that it is
bounded in the safe direction:

| | |
|---|---|
| T0-01 | normalisation, range expansion and the distance primitives are bit-for-bit identical |
| T0-02 | no score can ever fall — the guard is a pure `Math.max` |
| T0-03 | scores are exactly identical wherever the token order already agreed |
| T0-04 | classification is unchanged given the same score |
| T0-05 | no tier can fall; the four that rise are enumerated in the test output |

### D09 — `M.KRISHNAN` against `M. Krishnamurthy`: expected `none`, scores `review`

| | |
|---|---|
| core | 0.769 (gate is 0.72) |
| combined | 0.769 (review threshold is 0.68) |
| why | The consonant skeletons are `KRSNMRT` and `KRSNN`. Jaro-Winkler rewards the seven-character shared opening heavily, so `foldSim` reaches 0.85 despite the names differing by five characters. |

This is a precision miss and it costs one glance on a confirm card. Constraint
C4 states the asymmetry deliberately: *a wrongly shown row costs a glance, a
wrongly dropped row costs an appearance*, so this is the survivable direction of
error. It is allow-listed by name in **T5-02**, which fails if the list is
widened, if D09 stops surfacing, or if it ever reaches `auto`.

### 5b. P17 — `SELVAN T.THAMARAI` against `T. Thamarai Selvan`

Before the order guard this scored **`none`** where `fixtures/golden.json`
expects `review`: the matter was dropped entirely.

| | |
|---|---|
| core | 0.57 against a gate of 0.72 |
| why | `rawSim` and `foldSim` compare the core tokens **concatenated in order**, and this name is printed with its parts reversed. `tokenSetScore` recognises it perfectly at 1.00, but carries only 0.30 of the mix against 0.70 for the two order-sensitive measures. |

Under C4 this is the expensive direction — the matter is not merely shown
wrongly, it is lost. §10.5 does not assert it (T5-01 covers only `auto` items
and T5-02 only `none` items), so the suite was green either way, which is
exactly why it needed writing down.

**The fix, now applied.** `rawSim` and `foldSim` are each taken as the better of
the in-order and the token-sorted comparison. Because it is a `Math.max` over an
additional candidate:

- no score can fall, so nothing that matched before can stop matching;
- for a single-token core name the sorted form *is* the in-order form, so it is
  a no-op for every case in T1, T2, T4 and T6.

Measured over **16,276 pairs** — the reference corpus plus every distinct string
the extractor pulled from the synthetic corpus and all four real HR&CE files —
2,074 scores rose, **none fell**, and exactly five tiers changed:

| Pair | Before | After | Verdict |
|---|---|---|---|
| `SELVAN T.THAMARAI` / `T. Thamarai Selvan` | none | **auto** | P17 recovered. Both core tokens and the initial match exactly; only the order differs. |
| `T.SELVAN` / `T. Thamarai Selvan` | none | **review** | D10. The cost, and it is a fair question to ask: the initial matches and `Selvan` is one of the two core tokens. |
| `S.Vijaya Ganesh` / `E. Ganesh` | none | weak | hidden behind the toggle |
| `G.Selvam` / `T. Thamarai Selvan` | none | weak | hidden behind the toggle |
| `E. Ganesh` / `S.Vijaya Ganesh` | none | weak | hidden behind the toggle |

**The real HR&CE data is entirely unchanged.** Across the 11.08 and 04.08 lists
plus Adjournment Notice No.16, the attending set is the same fifteen matters and
the same two confirm questions before and after.

So the whole price is D10 joining D09 in the confirm queue: one extra card, one
glance, against a matter recovered from being silently dropped. That is the
trade C4 asks for in as many words. D10 is allow-listed by name in T5-02 and
T5-02b asserts P17 now lands.

**The caution that held this back still stands for anything further.** §4.3 and
§4.4 set their constants by measurement against a real 642-page list, and D2 and
D3 say so explicitly. This change was adopted because T0 can prove it is
monotone — no score falls, no tier falls, and same-order names are untouched —
which is a property a reviewer can check without the real list. **A change that
cannot be proved monotone should wait for a T6 run**, which needs a real Madras
HC cause list in `fixtures/real/` (§10.6 — CI skips T6 when it is absent).

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

---

## 7. A party is not corroborating evidence — T18

Reported from real use: **"V. Kavi Ganesan" was being shown as a confirmed match
for "E. Ganesh"**, on the strength of being a *party* whose name looks a little
like his. Two separate faults fed it.

### The name score was never the problem

| | |
|---|---|
| `E. Ganesh` vs `V. Kavi Ganesan` | core 0.747, combined **0.497** → `none` |

It does not place at all on its own. Everything that follows is about what was
added on top.

### Fault 1 — the cluster signal was promoting parties

§4.7's cluster promotes `review` → `auto` when two or more firm advocates appear
on one item, and it was counting and promoting hits of **any** role. But D7's
reasoning is precisely that **chambers are printed together** — a fact about
counsel columns. Two *parties* resembling two firm advocates is coincidence, not
corroboration.

Measured across the four HR&CE lists, that alone was manufacturing four
confirmed matches out of nothing:

| Printed, as a party | Promoted to auto for |
|---|---|
| `Ganesan` | E. Ganesh |
| `Balagandhi (a)` | A. Balaguru |
| `4.C.Chandrasekar` | V. Chandrasekar |
| `V.Chandra And 5 others` | V. Chandrasekar |

The cluster now counts and promotes **counsel only**, on both sides of the rule.

### Fault 2 — a party on the name alone could still reach `review`

With the cluster fixed, nine name-only party matches remained in the confirm
queue, none of them real. Party cells are full of ordinary personal names, so a
chance resemblance is common, and nine false questions a day is how a confirm
queue stops being read.

A party match whose **only** evidence is the name is now held to the weak tier.

### Why this does not lose a partner's own litigation

That case — the one §5.8a.3 exists to protect — is identified by the **case
number in the firm's own register**, which is decisive by itself (D6). Both
planted instances carry a `caseNumber` signal and are untouched:

| | Signals | Tier |
|---|---|---|
| P18 `CC/212/2026` — `E.GANESAN` | advocateName, **caseNumber**, partyName | `auto` |
| P20 `CC/213/2026` — `E.GANESH` | advocateName, **caseNumber**, partyName | `auto` |

The cap bites only where the sole evidence is that a stranger's name looks a
little like an advocate's. And nothing is discarded — weak is retained and one
toggle away (C4, D4).

### This is a deliberate departure from §5.8a.3

That section says counsel and party *"both tier normally"*. They no longer do:
an uncorroborated party is capped. The departure honours the section's stated
**intent** — that a partner's own litigation must still be caught, which it is,
at `auto`, via the register — while removing the side effect it did not
anticipate, which was strangers' names filling the confirm queue.

T18 holds all of it: the reported pair scores `none`; no cluster signal ever
attaches to a party; every name-only party match sits at weak and none is
dropped; both partner-as-party matters still reach `auto` on their case number;
and the cluster still promotes counsel, with P01's four-advocate cluster intact.
