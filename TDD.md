# Callover — Cause List Matcher
## Technical Design Document v1.0

> **Purpose of this file.** This document is the *complete* specification. An AI coding
> assistant given only this file plus `fixtures/` must be able to build the entire
> application and verify it. There are no external references, no "see the wiki", no
> assumed context. Where a decision was made, the reasoning is recorded so it is not
> silently reversed later.

---

## 0. One-paragraph summary

A single-page web application that takes a court cause list PDF, a list of a law firm's
advocates, and optionally the firm's case register, and reports **which of the firm's
matters are listed today** — surviving misspelt advocate names, Tamil transliteration
drift, wrong or missing initials, and OCR noise. It runs entirely in the browser. No
server, no LLM, no network calls at run time. The output is a set of exportable lists
grouped by advocate, by court, and by case.

**The problem it solves:** a matter listed under `R.GANESAN` when the register says
`E. Ganesh` is invisible to a text search, nobody appears, and the client suffers. A
naive substring search for `GANESH` across a real 642-page Madras HC list returns 44
hits, of which one is correct. This tool returns 1 auto-accepted and 2 to confirm.

---

## 1. Non-negotiable constraints

| # | Constraint | Why |
|---|---|---|
| C1 | **No network at run time.** All processing local. | Cause lists and case registers are privileged material. Also makes the tool usable in a court complex with no signal. |
| C2 | **No LLM, no ML model** in the matching path. | Must be deterministic, auditable, and identical across runs. A firm has to be able to explain why a match was made. |
| C3 | **No automated fetching from eCourts / court portals.** | Three independent blockers: browser CORS prevents it outright; the portals are captcha-gated; and a law firm's own tooling defeating a government access control is an unacceptable professional risk. The app instead deep-links the user to the correct page for manual download. |
| C4 | **Never silently discard a candidate.** | A wrongly shown row costs a glance. A wrongly dropped row costs an appearance. The asymmetry is total. |
| C5 | **Overlap is intentional.** If advocates A and B both appear on one matter, it appears under A *and* under B. | Requested explicitly. Safety over tidiness. |
| C6 | Single HTML file, openable with a double-click. | Advocates and clerks must not need an installer, a terminal, or an IT department. |

### 1.1 On C3 — what "official" means in the output

Every result carries a `source` field:

- `"official"` — the PDF was downloaded by the user directly from a court portal, and
  they ticked the "downloaded from official portal" box on that file.
- `"uploaded"` — any other file.

The app **cannot verify** this and must not pretend to. It records what the user asserts.
The UI wording is "Marked as official by user", never "Verified official".

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  index.html   (single file, ~5000 lines, no build step)      │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  INPUT     │  │  EXTRACT   │  │  MATCH     │             │
│  │  panel     │─▶│  pdf.js    │─▶│  engine    │──┐          │
│  │            │  │  +tesseract│  │  (§4)      │  │          │
│  └────────────┘  └────────────┘  └────────────┘  │          │
│         ▲                                         ▼          │
│  ┌────────────┐                            ┌────────────┐   │
│  │ SheetJS    │                            │  RESULTS   │   │
│  │ xlsx/csv   │                            │  4 views   │   │
│  └────────────┘                            └────────────┘   │
│                                                   │          │
│                                                   ▼          │
│                                            ┌────────────┐   │
│                                            │  EXPORT    │   │
│                                            │  xlsx/csv  │   │
│                                            └────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Vendored libraries

All three are vendored into `vendor/` and committed. **No CDN at run time** (C1).

| Library | Version | Purpose | Licence |
|---|---|---|---|
| `pdf.js` | 4.x | PDF text extraction with per-glyph x/y | Apache-2.0 |
| `SheetJS` (xlsx) | 0.20.x community | Read/write xlsx, csv | Apache-2.0 |
| `tesseract.js` | 5.x | OCR fallback for scanned pages | Apache-2.0 |
| `eng.traineddata` | tessdata_fast | English OCR model (~2 MB) | Apache-2.0 |

`tesseract.js` and the traineddata are **lazy-loaded from `vendor/` only when a scanned
page is detected**, so a text-only run never pays the cost.

### 2.2 Module layout inside the single file

Each module is a plain object literal in its own `<script>` block, in this order.
The build script (§9.2) concatenates `src/*.js` into `index.html` in exactly this order.

```
src/00-config.js      thresholds, fold rules, keyboard maps
src/10-normalise.js   §4.1  text/name/case-number normalisation
src/20-distance.js    §4.2  levenshtein, jaro-winkler, token set
src/30-initials.js    §4.3  initials comparison state machine
src/40-score.js       §4.4  name scoring + classification
src/50-extract.js     §5    PDF -> pages -> lines -> blocks
src/60-engine.js      §6    the five-signal matching pass
src/70-io.js          §7    advocate/case file parsing, export
src/80-ui.js          §8    rendering, state, events
src/90-tests.js       §10   the in-app self-test runner
```

---

## 3. Data model

```js
/** One advocate the firm is searching for. */
Advocate = {
  id:        string,      // stable, generated
  name:      string,      // as typed by the firm, e.g. "E. Ganesh"
  enrolment: string|null, // optional, e.g. "MS/1234/2005"
  role:      string|null, // free text, e.g. "Senior"
  parsed:    ParsedName   // memoised, see §4.1
}

/** One matter from the firm's register (optional input). */
RegisterCase = {
  id: string,
  diaryNo: string,        // "B208"
  caseType: string,       // "CC"
  caseNo: string,         // "212"
  year: string,           // "2026"
  caseKey: string,        // normalised, "CC/212/2026"  — see §4.5
  cnr: string|null,       // "TNCH01-000212-2026"
  court: string,
  causeTitle: string,
  partyName: string,
  mobile: string,
  counselFor: string,
  attendedBy: string,
  nextDate: string,
  nextStage: string,
  remarks: string,
  raw: object             // every original column, preserved verbatim
}

/** One item block scraped out of a cause list PDF. */
ListedItem = {
  id: string,
  sourceFile: string,
  sourceIsOfficial: boolean,
  page: number,
  court: string|null,     // from page header
  hall: string|null,      // "COURT NO. 01" -> "01"
  coram: string|null,
  listType: string|null,  // "MOTION LIST" from the page footer
  itemNo: string|null,
  caseNumbers: string[],  // raw, may be several (AND-linked)
  caseKeys: string[],     // normalised
  petitioner: string,
  respondent: string,
  counselPetitioner: string[],  // above the ------ divider
  counselRespondent: string[],  // below it
  allNames: string[],           // union, deduped
  ocrPages: number[],           // which pages of this block were OCR'd
  rawText: string               // for the evidence pane
}

/** One row of an adjournment notice. Carries no parties and no advocates -
    identification comes entirely from the case number (§6.6). */
RepostedItem = {
  id: string,
  sourceFile: string,
  serial: string,          // "5."
  caseCellRaw: string,     // "R.P.468 to 476/2022, R.P.350 and 351/2023"
  caseKeys: string[],      // expanded, §4.6a
  originalDate: string|null, // the hearing date being vacated, from the preamble
  repostedTo: string|null,   // "2026-09-15"
  repostedTime: string|null, // "3.00 pm"
  dateConfidence: "ruled"|"inferred",  // §5.8
  page: number
}

/** One result row. */
Match = {
  id: string,
  item: ListedItem,
  advocate: Advocate|null,      // null for case-number-only matches
  registerCase: RegisterCase|null,
  tier: "auto"|"review"|"weak",
  confidence: number,           // 0..1
  signals: Signal[],            // every signal that fired, for the evidence pane
  matchedText: string,          // the exact string in the PDF that matched
  side: "petitioner"|"respondent"|"unknown",
  confirmed: boolean|null       // user decision; null = untouched
}

Signal = {
  kind: "caseNumber"|"cnr"|"advocateName"|"partyName"|"enrolment"|"cluster",
  weight: number,
  detail: string,       // human sentence: "Krishnamurthy -> Krishnamoorthi (OO fold)"
  score: number
}

/** Everything needed to decide a confirm question WITHOUT leaving the card.
    Built for every Match, not only reviewed ones — the same object powers the
    evidence drawer on accepted rows. See §7.2. */
Evidence = {
  rows: EvidenceRow[],        // the side-by-side comparison, ordered by §7.2.2
  colleagues: string[],       // other firm advocates printed on the same item
  registerHit: boolean,       // is this case number/CNR in the firm's register at all
  registerDiary: string|null, // "B208" when registerHit
  pdfExcerpt: string,         // verbatim lines from the PDF, for the excerpt pane
  highlightSpans: [number,number][], // char ranges in pdfExcerpt to mark
  page: number,
  wasOCR: boolean,
  decisiveField: string|null  // which row settles it, e.g. "caseNumber"
}

EvidenceRow = {
  field: string,              // "Advocate", "Case number", "Cause title", "Parties", "Side"
  inList: string,             // what the cause list printed
  inRegister: string|null,    // what the firm's register holds; null if not supplied
  verdict: "agree"|"differ"|"absent"|"unknown",
  note: string|null           // "one initial differs — E and R are keyboard neighbours"
}
```

---

## 4. The matching engine — full specification

> This section is the heart of the application. It is specified to the level of
> literal constants because the behaviour must be reproducible.

### 4.1 Normalisation

```js
const TITLE_RE = /\b(M\/S|MS|MR|MRS|MISS|THIRU|TMT|SELVI|SHRI|SRI|SMT|DR|ADV|
                    ADVOCATE|LEARNED|COUNSEL|SENIOR|SR|PROF)\b/g;
const ROLE_RE  = /\b(FOR|APPEARING|ON BEHALF OF|TAKES NOTICE|ACCEPTS NOTICE|GP|SPP|
                    SGP|AGP|PP|SC|ASG|AAG|GOVERNMENT PLEADER|PUBLIC PROSECUTOR|
                    STANDING COUNSEL|AMICUS|CURIAE|PARTY IN PERSON|PIP)\b/g;
```

**`splitName(raw) -> ParsedName`**

1. Unicode NFD, strip combining marks, uppercase.
2. Strip a leading `M/S.` — a chambers prefix, not part of the name.
3. Remove `TITLE_RE` and `ROLE_RE` matches.
4. Remove respondent markers: `/\bR-?\d+\b|\bD-?\d+\b|\bP-?\d+\b/`.
5. Keep `[A-Z. ]` only; split on `[.\s]+`.
6. Tokens of length 1 → `initials[]`. Tokens of length ≥2 → `core[]`.

> **Why initials and core are separated rather than concatenated:** in the real
> Madras HC list, the core name `BALAJI` appears with **19 distinct initial sets**,
> `SARAVANAN` with 17, `GANESH` with 11. Collapsing initials into the name merges
> nineteen different advocates into one. Discarding initials entirely does the same.
> They must be compared *separately*, with different rules. This is the single most
> important design decision in the engine.

**`foldIndic(s) -> string`** — the transliteration skeleton.

Applied in this exact order (longest digraphs first, or `KSH` would be eaten by `SH`):

```
KSH→X  CHH→S  SHH→S  THH→T
KH→K   GH→G   CH→S   TH→T   DH→D   PH→F
BH→B   JH→J   SH→S   ZH→L   NG→N   NY→N
OO→U   EE→I   AA→A   AI→I   AU→O   OU→O
W→V    Y→I    Z→S    Q→K    X→KS
```

Then: collapse runs of the same character (`/(.)\1+/ → $1`), then **delete all vowels**.

`GANESH → GNS`, `GANESAN → GNSN`, `KRISHNAMURTHY → KRSNMRT`,
`KRISHNAMOORTHI → KRSNMRT`.

### 4.2 String distance

- `levenshtein(a, b, cap)` — classic DP, two rows, early exit when the row minimum
  exceeds `cap`.
- `ratio(a,b) = 1 - lev(a,b) / max(len)`.
- `jaroWinkler(a,b)` — standard, prefix scale 0.1, max prefix 4.
- `tokenSetScore(A,B)` — greedy best-alignment over token lists, each pair scored as
  `max(ratio(a,b), ratio(fold(a), fold(b)))`, normalised by `max(|A|,|B|)`.

### 4.3 Initials comparison — the state machine

`initialsCompare(qInits, cInits) -> {state, score}`

| Order | Condition | state | score |
|---|---|---|---|
| 1 | both empty | `both-absent` | 0.50 |
| 2 | query has, list has none | `absent-in-list` | 0.45 |
| 3 | list has, query has none | `absent-in-query` | 0.45 |
| 4 | identical | `exact` | 1.00 |
| 5 | one is a prefix of the other (`E` vs `ES`) | `partial` | 0.80 |
| 6 | one is a set-subset of the other | `subset` | 0.75 |
| 7 | same length, exactly 1 char differs, **and** the pair is keyboard-adjacent or a lookalike | `flip-plausible` | 0.50 |
| 8 | same length, exactly 1 char differs, otherwise | `flip-other` | 0.12 |
| 9 | same multiset, different order (`SM` vs `MS`) | `transposed` | 0.70 |
| 10 | anything else | `different` | 0.15 |

**Keyboard adjacency** (QWERTY, used for typo detection):

```
A:QSZW  B:VGHN  C:XDFV  D:SERFCX E:WSDR  F:DRTGVC G:FTYHBV H:GYUJNB
I:UJKO  J:HUIKNM K:JIOLM L:KOP   M:NJK   N:BHJM   O:IKLP   P:OL
Q:WA    R:EDFT  S:AWEDXZ T:RFGY  U:YHJI  V:CFGB   W:QASE   X:ZSDC
Y:THGU  Z:ASX
```

**Lookalike pairs** (OCR / handwriting confusion):

```
B:8PR  D:OQ  E:F   G:6C  I:1JL  J:I  L:I1  M:N  N:MH  O:0DQ
P:RB   Q:OG  R:PB  S:5   U:V    V:UW W:V   Z:2
```

> **Why `flip-other` scores 0.12 and not 0.30:** at 0.30 the combined score for
> `E. Ganesh` vs `J.GANESH` reaches 0.734, which lands in the review tier. Searching
> the real cause list then surfaces `J.GANESH`, `M.GANESH`, `N.GANESH`, `A.GANESH` —
> four unrelated advocates in the confirm list, every day. At 0.12 they fall to the
> `weak` tier, which is hidden behind a toggle but still retrievable. This satisfies
> C4 without destroying usability. **Do not raise this constant without re-running
> T4-REAL.**

### 4.4 Name scoring

```js
function nameScore(query, candidate) {
  const q = splitName(query), c = splitName(candidate);
  if (!q.core.length || !c.core.length) return null;

  const qs = q.core.join(''), cs = c.core.join('');
  const rawSim  = max(ratio(qs,cs), jaroWinkler(qs,cs));
  const foldSim = max(ratio(fold(qs),fold(cs)), jaroWinkler(fold(qs),fold(cs)));
  const tokSim  = tokenSetScore(q.core, c.core);

  // HEAD GUARD — see note below
  const headOK = q.core.some(qt => c.core.some(ct =>
      qt[0] === ct[0] || fold(qt)[0] === fold(ct)[0] ));

  let core = 0.30*rawSim + 0.40*foldSim + 0.30*tokSim;
  if (!headOK) core *= 0.55;

  const ini = initialsCompare(q.initials, c.initials);
  const combined = core * (0.62 + 0.38 * ini.score);
  return { combined, core, rawSim, foldSim, tokSim, initials: ini };
}
```

> **Why the head guard exists.** Vowel-stripping makes `GANESH → GNS` and
> `VIGNESH → VGNS`, which score 0.75 on ratio — high enough to surface four unrelated
> `VIGNESH` advocates when searching for `E. Ganesh`. Transliteration never changes
> the leading consonant of a Tamil name, so requiring the first letter of *some* core
> token to agree (raw **or** folded, so `CHANDRAN`/`SHANDRAN` still works) removes
> this whole class of false positive at no cost to recall. Verified: it eliminated
> 5 false positives from the real-list run with zero loss.

### 4.5 Case number normalisation

```js
function normCaseNo(raw, ocr) {
  let s = upper(raw).replace(/\./g,'');
  s = s.replace(/\b(OF|NO|NOS|SL|CASE|YEAR)\b/g,' ')
       .replace(/NO(?=\d)/g,' ')
       .replace(/[^A-Z0-9]/g,' ').replace(/\s+/g,' ').trim();
  const m = s.match(/([A-Z0-9]{1,8})\s*([0-9OILSBGZQD]{1,7})\s*([0-9OILSBGZQD]{4})/);
  if (!m) return s;
  let [,typ,num,yr] = m;
  if (ocr) {                      // per-slot confusion folding
    num = mapChars(num, OCR_TO_DIGIT);   // O→0 I→1 L→1 S→5 B→8 G→6 Z→2 Q→0 D→0
    yr  = mapChars(yr,  OCR_TO_DIGIT);
    typ = mapChars(typ, OCR_TO_ALPHA);   // 0→O 1→I 5→S 8→B 6→G 2→Z
  }
  return `${typ}/${parseInt(num,10)}/${yr}`;
}
```

> Note the `.` strip happens **first**. An earlier version stripped non-alphanumerics
> before dots and turned `C.C.No.212/2026` into type `C`, silently failing to match
> `CC 212 of 2026`. Regression test T3-05 locks this.

### 4.6 Thresholds

```js
const T = { AUTO: 0.86, REVIEW: 0.68, WEAK: 0.58, CORE_GATE: 0.72 };
```

`classify(score, {ocr})`:

1. If `core < CORE_GATE` (minus 0.06 when the page was OCR'd) → `none`.
2. If `combined ≥ AUTO` (minus 0.04 if OCR) **and** initials state is `exact` or
   `partial` → `auto`.
3. Else if `combined ≥ REVIEW` (minus 0.04 if OCR) → `review`.
4. Else if `combined ≥ WEAK` (minus 0.04 if OCR) → `weak`.
5. Else → `none`.

> OCR pages get looser thresholds because character noise depresses every similarity
> measure. The looseness is bounded and applied only to pages that actually went
> through OCR — tracked per page in `ListedItem.ocrPages`.

### 4.6a Case-number range expansion (tribunal lists)

Tribunal lists group matters, and a single cell can carry dozens of case numbers:

```
R.P.384 to 387/2022                                    ->  4 keys
R.P.Nos.243 to 261 and 262/2022                        -> 20 keys
R.P.48 to 96/ 2023                                     -> 49 keys
R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025 -> 10 keys
R.P.05 and 06/2026                                     ->  2 keys
R.P.No.289 to 294 of 2026                              ->  6 keys
```

**Every cell must be expanded to individual keys before matching.** Treating
`R.P.48 to 96/2023` as one opaque string loses 48 of the firm's 49 possible matters.
This is the single highest-yield feature for tribunal practice.

`expandCaseCell(raw) -> string[]`

1. Uppercase; normalise `\u00A0`; strip `Nos.`/`No.`; map the word `OF` to `/`;
   collapse whitespace around `/` (lists really do print `R.P.48 to 96/ 2023`).
2. Split on commas into segments. A segment may declare a new type
   (`A.P.141 to 144/2022`) or inherit the previous one (`R.P.125 to 127/2025`).
3. Trailing `/YYYY` is the year; if absent, inherit from the next segment that has one
   (back-fill, because the year is printed once at the end of the cell).
4. Within a segment, split on `AND`/`&`; each part is either `n TO m` (expand
   inclusive) or a single `n`.
5. **Cap any single range at 500 members.** A misparse of a page number as a range must
   not generate an unbounded key set.

Reference implementation and its 18 real-world cases are in `src/engine-reference.js`.

### 4.7 The five signals and how they combine

A `ListedItem` is matched against the firm by evaluating every signal that applies.
**Signals are evidence, not a sum.** The rule is:

```
tier = max(tier from any single signal)
confidence = 1 - Π(1 - signalScore_i)     // noisy-OR
```

| Signal | Weight | Fires when | Effect |
|---|---|---|---|
| `caseNumber` | 1.00 | `item.caseKeys ∩ register.caseKey ≠ ∅` | **Immediate `auto`.** The firm knows its own case numbers. |
| `cnr` | 1.00 | CNR string matches | **Immediate `auto`.** |
| `enrolment` | 0.95 | Enrolment number appears in the item text | Immediate `auto` |
| `advocateName` | per §4.4 | any name in `item.allNames` scores ≥ WEAK. **`allNames` is the union of every counsel on every side** — petitioner and respondent columns for tribunal lists, above and below the divider for High Court lists | tier per `classify()` |
| `partyName` | 0.70 | register party/cause title fuzzy-matches item parties ≥ 0.80 | promotes `weak`→`review`, `review`→`auto` |
| `cluster` | 0.65 | **two or more distinct firm advocates** score ≥ REVIEW within the same item | promotes `review`→`auto` |

> **The cluster signal, and why it earns its place.** In the real list, `E.SRIKANTH`
> appears alongside `E.GANESH` in 2 of his 3 items, and `D.LOKESHWARAN` and
> `T.THAMARAI SELVAN` join them in one. Chambers are listed together. So if a firm
> supplies its *whole* advocate list, a block containing two of them is near-certain
> even when one name is mangled. This turns the firm's own roster into a
> disambiguator, which is why the UI should encourage entering everyone, not just
> the arguing counsel.

### 4.8 Side determination — recorded, never used to filter

**Side is descriptive output, not a search filter.** Callover scans every side of every
matter and records which one the advocate was found on. It must never narrow the search
to one side, however the firm's register describes their usual role.

Within an item block, the line matching `/^-{6,}$/` divides petitioner-side counsel
(above) from respondent-side counsel (below). Set `Match.side` accordingly. If no
divider is present, `side = "unknown"`.

For tribunal lists, side comes from which party column the name was found in, and
`sideDetail` records the respondent numbering (`R3 to R11`) where printed.

Cross-check against `RegisterCase.counselFor` when available and raise a
`sideMismatch` warning if they disagree — it usually means the wrong case matched. The
warning is shown on the confirm card; it never suppresses the match, because a firm's
role can legitimately change between rounds.

---

## 5. PDF extraction

### 5.1 Text layer first

For each page, `page.getTextContent()` gives items with a transform matrix.

1. Group items into lines by rounded `y` (tolerance 2.0 units).
2. Sort each line's items by `x`.
3. Record each item's `x` so columns can be recovered.
4. Emit `{ y, spans: [{x, text}], text }`.

**Scan detection:** if a page yields `< 40` characters of text layer, treat it as
scanned and route it to OCR. Record the page number in `ocrPages`.

### 5.2 OCR fallback

Lazy-load `tesseract.js` from `vendor/` on first need. Render the page to a canvas at
2× scale, binarise, feed to Tesseract with `eng`. Reconstruct lines from Tesseract's
word bounding boxes using the same y-grouping.

Show a progress bar. Never block the UI thread — run in a Web Worker.

### 5.3 Column detection

The advocate column is the rightmost cluster of x-positions. Compute a histogram of
span `x` values across the page; the advocate column starts at the largest gap in the
upper half of the x range. Fall back to `x > 0.55 * pageWidth` if detection fails.

> The real Madras HC list places counsel at roughly x = 108mm of a 210mm page, i.e.
> 0.51. The fallback threshold of 0.55 is deliberately *above* that so the fallback
> is conservative — better to miss the column and scan the whole line than to slice
> a name in half.

### 5.4 Block segmentation

A new item block starts at a line matching:

```js
/^\s*(\d{1,4})\s+.*?([A-Z][A-Z.\s]{0,12}\/\s*\d{1,6}\s*\/\s*\d{4})/
```

Continuation lines beginning `AND` attach additional case numbers to the current block.
The block ends at the next item start or the page footer.

**Noise filters** — a right-column line is *not* a name if it:
- matches `/^-+$/` (divider)
- contains 4+ consecutive digits (dates, phone, USR numbers)
- matches `/\b(ROAD|STREET|NAGAR|PIN|DT:|VIDE|NOTICE|FILED|ORDERED|EX-PARTE|
  ISSUES FRAMED|W\/S|TAPAL|UNSERVED|UNCLAIMED|MEMO)\b/`
- is longer than 45 characters

### 5.5 Page context

- **Court name** — first centred line of the page, or carried from the previous page.
- **Hall** — `/COURT\s*(?:HALL|NO\.?)\s*[:\-]?\s*([0-9IVX]+)/`
- **Coram** — lines ending `.J` or containing `HON'BLE`.
- **List type** — page footer, `/\(\d{2}\/\d{2}\/\d{4}\)\s*-\s*(.+LIST)/`.

---

### 5.6 Document types

A dropped PDF is classified before parsing. One file may contain **several sections of
different types** — the HRCE cause lists carry adjournment tables appended after the
list, introduced by *"Note :- Please take notice that the following cases posted for
hearing on ... stand reposted as follows"*. Sections are detected and parsed separately.

| Type | Detected by | Yields |
|---|---|---|
| `causelist.hc` | Court name header, `COURT NO.`, coram lines ending `.J` | `ListedItem[]` |
| `causelist.tribunal` | `Before the Commissioner`, `Cause List`, a 7-column ruled table | `ListedItem[]` |
| `adjournment` | `Adjournment Notice No.`, `stand reposted as follows`, `are hereby reposted as follows` | `RepostedItem[]` |
| `unknown` | none of the above | flagged to the user; raw text still searched for advocate names |

### 5.7 Tribunal (HRCE) cause list extraction

Structurally different from High Court lists and **must not be parsed by flattening the
page**. Verified failure: flattening merges the advocate column into the subject-matter
column and yields `Temple`, `M.P.No`, `of the JC` as advocate names.

Columns, left to right: `S.No | Case No | Petitioner and Advocate | Respondent and
Advocate | Under Sec | Temple | Subject matter`. The formal column map is the
`tribunal.hrce` profile in §5.8a.1. **Both party columns are counsel-bearing** — there is
no separate advocate column in this forum, and any rule that looks for one will find
nothing.

1. **Recover column x-bands from the table rectangles** (§5.8), not from text position.
2. **Advocates are embedded inside the party cells**, after a connector. Split each
   party cell on `/\b(?:through|thorugh|throuh)\b/i` — the misspellings are in the real
   documents — then strip a leading `M/s.`, `Thiru`, `Thiru.`, `Tmt.`, `Dr.`.
   Note `throughThiru. E. Ganesh` appears with no space; the connector regex must not
   require one.

   **Both party columns must be scanned, always.** An advocate appears for whichever
   side instructs them, and the same advocate routinely appears on opposite sides in
   different matters. Measured across the four supplied HRCE lists, `E. Ganesh` appears
   **twice in the petitioner column and four times in the respondent column** — he acts
   for the department in some matters and against it in others. Searching only the
   petitioner column, or assuming a firm has a fixed side, loses the majority of their
   work. The same rule applies to High Court lists: counsel above **and** below the
   divider are both scanned (§4.8).

   A single respondent cell frequently carries several counsel for different respondents
   (`1. R1 and R2 through M/s.N.Soundarrajan ... 4. E.O through M/s.E.Ganesh`). Every
   `through` occurrence in the cell is a separate advocate, and each keeps its own
   respondent numbering.
3. **Respondent sub-numbering** (`3. R3 to R11 through M/s.E.Ganesh`) records *which*
   respondents the advocate acts for. Capture it into `Match.sideDetail` — richer than
   the High Court divider and worth showing on the confirm card.
4. `Under Sec`, `Temple` and `Subject matter` are captured into `ListedItem.extra` and
   surfaced in the evidence table for tribunal matters, because a temple name is often
   how the firm actually recognises the file.

### 5.8 Ruled-table geometry and merged cells

Both HRCE document families draw their tables as filled rectangles (1,811 in the sample
adjournment notice). **Cell geometry must be recovered from those rectangles**, via
pdf.js `getOperatorList()`, and not inferred from text alignment.

This is not an optimisation. It is the only correct way to read a **vertically merged
date cell**, and reading one wrongly puts a firm in the wrong court on the wrong day:

```
  5.  R.P.468 to 476/2022, R.P.350 and 351/2023    15.09.2026 @
  6.  R.P.541/2022                                   3.00 pm      <- same merged cell
  7.  R.P.48 to 96/ 2023                           10.11.2026 @
  8.  R.P.214/2023                                              <- no date on this line
  9.  R.P.502/2023                                 15.09.2026 @  <- cell spans rows 8-9
```

Row 8 carries no date token at all. Naive top-down inheritance assigns it 10.11.2026
from row 7. **The correct answer is 15.09.2026**, because the merged cell drawn around
rows 8 and 9 contains that date. Only the rectangle geometry reveals this.

**Fallback when a file has no ruling rectangles:** do not guess. Assign by nearest date
cell and mark every such row `dateConfidence: "inferred"`, which forces it into the
confirm queue (§7.2) with the ambiguity stated. A guessed hearing date must never be
presented as fact.

### 5.8a0 The connector probe — run before any name is searched for

**"Party *through* Advocate" is a convention across Indian courts and tribunals, not an
HR&CE quirk.** So Callover does not wait to be told which columns hold advocates. Before
a single firm name is looked for, it asks each column a simpler, structural question:

> *Do your cells contain a party-to-advocate connector?*

A column that answers yes carries **both** party and advocate and must be split. This is
a first-level probe: it discovers counsel-bearing columns in forums nobody has written a
profile for, and it verifies the ones that have.

#### 5.8a0.1 Connector vocabulary and direction

Connectors have a **direction**, and getting it backwards inverts party and advocate.

| Direction | Connectors | Shape |
|---|---|---|
| `party-first` | `through`, `thro`, `thro'`, `thru`, `throuh`, `thorugh`, `thruogh`, `represented by`, `represented through`, `rep. by`, `rep by` | party **before**, advocate **after** |
| `counsel-first` | `for`, `on behalf of`, `appearing for` — **only when a party reference follows**: `R\d`, `D\d`, `P\d`, or the words petitioner / respondent / appellant / plaintiff / defendant / complainant | advocate **before**, party reference **after** |

Both occur in the supplied data:

```
E.R. Kannan through M/s.E.Ganesh   -> party E.R. Kannan,  advocate E. Ganesh
AKILESH KUMAR FOR R1               -> advocate Akilesh Kumar, acting for R1
```

The `counsel-first` guard matters: bare `for` is far too common to treat as a connector.
`SPL.PUBLIC PROSECUTOR FOR ED CASES` is a role description, not a split point.

#### 5.8a0.2 Two implementation traps, both found in real data

**Trap 1 — connectors are glued to adjacent words.** The lists really contain
`throughThiru. E. Ganesh` and `And othersthrough Thiru E. Ganesh`. A `\b`-anchored
pattern misses both. Drop the word boundaries and instead guard with a negative
lookbehind for `break|walk|fall|see` and a lookahead rejecting a following **lowercase**
letter, so `throughout` and `breakthrough` are excluded while glued proper nouns are not.

The lookahead must be **case-sensitive even though the pattern is case-insensitive** —
under `IGNORECASE`, `[a-z]` also matches `A-Z`, which silently rejects
`throughThiru`. Use an inline island: `(?-i:(?![a-z]))`. Verified 9/9 against the real
strings; without the island, 8/9.

**Trap 2 — measure density per cell, not per line.** Party cells wrap across many
physical lines and only one carries the connector. Measured on the HR&CE lists:

| Column | Density per line | Density per **cell** | Verdict |
|---|---|---|---|
| petitioner | 10% | **50%** | counsel-bearing |
| respondent | 5% | **20%** | counsel-bearing |
| temple / subject / under-sec | 0% | 0% | not counsel-bearing |

Line-level measurement under-reports roughly five-fold and would classify the petitioner
column as ordinary party text. **Row blocks must be assembled before probing.**

#### 5.8a0.3 The rule

For each column, over assembled cells:

```
density = cells containing a connector / non-empty cells
role    = "party+counsel"  if density >= 0.20 and cells >= 8
        = declared role     otherwise
```

- The probe may **upgrade** a `party` column to `party+counsel`; it never downgrades a
  column a profile declared counsel-bearing.
- A column with 0% density is never split, whatever its heading says.
- Dominant direction is recorded per column and used for the split.
- The probe result is shown in the "how this file was read" panel, so a wrong reading is
  visible rather than silent.

#### 5.8a0.4 Why a probe rather than a header rule

Headings cannot be trusted. HR&CE labels the column *"Petitioner and his Advocate's Name
— Thiruvalargal"*; another forum will say *"Party & Counsel"*, another nothing at all.
The connector is the invariant, and it is a property of the content rather than the
label.

### 5.8a Document profiles — where counsel actually lives

> **This section exists because an earlier draft of §5.10 said a Pass A hit is confident
> when the name sits "in a counsel column". HRCE lists have no counsel column.** The
> advocate is printed *inside* the party cell, after a connector. Taken literally, that
> wording would have marked every HRCE advocate as sweep-only and buried an entire
> tribunal practice in the confirm queue. Column roles are declared per document type;
> no code may test for a column literally named "counsel".

A **document profile** is a declarative column map. Adding a new court or tribunal means
adding a profile, not writing a parser.

```js
DocumentProfile = {
  id, label, detect: RegExp[],
  columns: [ { name, role, ...options } ]
}
```

**Column roles** — the only vocabulary the extractor understands:

| Role | Meaning | Counsel-bearing? |
|---|---|---|
| `index` | serial or item number | no |
| `caseNumber` | case numbers; `expandRanges` triggers §4.6a | no |
| `party` | party names only | no |
| `counsel` | counsel only — the whole cell is advocate names | **yes** |
| `party+counsel` | **party and advocate in one cell**, separated by a connector | **yes** |
| `extra` | captured, shown in evidence, never matched for counsel | no |

**A column is counsel-bearing if its role is `counsel` or `party+counsel`.** That is the
test, everywhere. Never the column's name, and never its heading text.

Roles come from two places: declared in the profile, and **discovered by the connector
probe of §5.8a0**, which runs first and may upgrade a `party` column. A forum with no
profile at all still works, because the probe finds its counsel-bearing columns from
content alone.

#### 5.8a.1 Profile: `tribunal.hrce` — HR&CE Commissioner

A first-class, named profile. This forum is a major share of the practice Callover is
built for, and it is not a variation on the High Court layout — it is a different shape.

```js
{ id: "tribunal.hrce",
  label: "HR&CE Commissioner — tribunal cause list",
  detect: [ /Before the Commissioner,\s*HR&CE/i,
            /HR&CE\s*Admn\.?\s*Department/i,
            /Petitioner and his\s*Advocate.s Name/i,
            /Thiruvalargal/i ],
  columns: [
    { name:"serial",     role:"index" },
    { name:"caseNo",     role:"caseNumber",   expandRanges:true },
    { name:"petitioner", role:"party+counsel", side:"petitioner",
                         connector:/\b(?:through|thorugh|throuh)\b/i,
                         honorifics:/^(?:M\/s|Thiru|Tmt|Selvi|Dr|Mr)\.?\s*/i },
    { name:"respondent", role:"party+counsel", side:"respondent",
                         connector:/\b(?:through|thorugh|throuh)\b/i,
                         honorifics:/^(?:M\/s|Thiru|Tmt|Selvi|Dr|Mr)\.?\s*/i,
                         subNumbering:true },
    { name:"underSec",   role:"extra", label:"Under Section" },
    { name:"temple",     role:"extra", label:"Temple" },
    { name:"subject",    role:"extra", label:"Subject matter" }
  ] }
```

**Both party columns are counsel-bearing.** Measured: `E. Ganesh` appears twice in the
petitioner column and four times in the respondent column across the four supplied
lists. Neither column may be treated as secondary.

`subNumbering: true` records which respondents an advocate acts for
(`3. R3 to R11 through M/s.E.Ganesh` → `sideDetail: "R3 to R11"`), and a cell yields one
advocate per connector occurrence.

#### 5.8a.2 Profile: `causelist.hc` — High Court

```js
{ id: "causelist.hc",
  label: "High Court cause list",
  detect: [ /HIGH COURT OF JUDICATURE/i, /COURT\s*NO\.?\s*\d+/i, /HON'BLE/i ],
  columns: [
    { name:"item",    role:"index" },
    { name:"caseNo",  role:"caseNumber", expandRanges:true },
    { name:"parties", role:"party" },
    { name:"counsel", role:"counsel", counselMode:"whole-cell",
                      sideFrom:"divider", divider:/^-{6,}$/ }
  ] }
```

Here the counsel column carries nothing but advocate names, and side comes from position
relative to the divider rather than from which column the name sat in.

#### 5.8a.3 Counsel or party? — they are different findings

Within a `party+counsel` cell, text **before** the connector is the party and text
**after** it is the advocate. A firm name can legitimately appear as either, and the two
mean different things:

- `R.P.541/2022 — E.R. Kannan through M/s.E.Ganesh` → E. Ganesh is **counsel**.
- `CC/212/2026 — E.Ganesh & anr -Vs- The Managing Director` → E. Ganesh is **a party**,
  in his own matter.

Both are real in the supplied data. Every `Match` therefore carries:

```
matchRole: "counsel" | "party" | "unplaced"
```

`counsel` and `party` both tier normally — a partner's own litigation is still something
the chamber must attend. But the confirm card and every export state which it is, because
*"you are appearing"* and *"you are being sued"* are not interchangeable. `unplaced` is
the §5.10 sweep-only case.

### 5.9 Document type: detected, shown, overridable

Running the wrong extractor produces noise, not silence. Verified: applying the High
Court right-column heuristic to an HRCE list yields advocates named `Temple`, `M.P.No`
and `of the JC`. So type must be settled **before** extraction, per file.

1. **Auto-detect** from the first two pages using the §5.6 signatures.
2. **Show the result on the file row** as an editable dropdown, pre-filled with the
   detection: `High Court list · Tribunal list · Adjournment notice · Auto-detect`.
3. **The user's choice always wins.** No re-detection after an override.
4. A batch may mix types freely — detection and override are per file, never global.
5. If detection is uncertain, the dropdown opens on `Auto-detect` with a note naming
   what was ambiguous, and the file is parsed with the dual pass of §5.10 alone.

Only the selected type's extractor runs. Matching a High Court layout against a tribunal
document is never attempted, because the noise it generates is indistinguishable from
signal by the time it reaches the confirm queue.

### 5.10 Dual-pass extraction — structured, then sweep

Column recovery is inference, and inference fails. A page where it fails silently is the
worst outcome this tool can produce, so **every page is read twice, by two methods that
fail differently.**

**Pass A — structured.** The extractor for the file's document profile (§5.8a). Produces
`ListedItem`s with columns, sides, item numbers and case numbers resolved. Names found in
a **counsel-bearing column** — which for `tribunal.hrce` means *either party column*, and
for `causelist.hc` means the counsel column — carry **full confidence** and enter the
normal tiering of §4.6.

**Pass B — sweep.** Independently, every text run on the page — every row, every column,
headers, footers, marginal notes, remarks, addresses, the subject-matter column — is
scanned for the firm's advocate names using the same §4.4 scorer. Pass B knows nothing
about structure. It cannot be defeated by a column-detection failure because it does not
use columns.

**Reconciliation.** The two passes are then compared:

| Found by | Meaning | Treatment |
|---|---|---|
| A and B | Structured extraction worked and the name sits in a **counsel-bearing column** — role `counsel` or `party+counsel` per the file's profile (§5.8a) | Normal tier (§4.6). The strongest state. |
| A only | Name recovered from a cell that the sweep's run-splitting merged | Normal tier |
| **B only** | **The name is on the page but in no counsel-bearing column of the file's profile** — a subject-matter cell, a remarks line, a footer, or a page whose columns could not be separated | **Always surfaced for confirmation**, `matchRole: "unplaced"`, never auto-accepted, never dropped. Reason shown: *"found on this page, but not in a column that carries advocate names — the layout may not have been read correctly."* |

A `B only` hit is exactly the case the user is worried about: `Ganesh` printed somewhere
the parser did not look. It is never discarded (C4), and never silently promoted either,
because the same sweep will also catch `Ganesh` inside a temple name or a party's
father's name.

#### 5.10.1 Reconciliation as a health check on the page

The disagreement rate is itself the most useful diagnostic in the system.

- If a page yields several `B only` hits and few or no `A` hits, **column detection
  failed on that page.** Mark the page `layoutConfidence: "low"`.
- Every result from a low-confidence page is capped at `review` regardless of score, and
  the page is listed in a **Pages I could not read cleanly** panel with a link to the
  raw text.
- If more than 20% of a file's pages are low-confidence, the file is flagged at the top
  of the results, before any match is shown.

Silence about a failed page is the failure mode this clause exists to prevent.

### 5.11 Page classification and thorough mode

Per page, before extraction:

| Signal | Route |
|---|---|
| Text layer ≥ 40 chars **and** ruling rectangles present | Ruled-table extraction (§5.8) — the most reliable |
| Text layer ≥ 40 chars, no rectangles | Column extraction from the x-histogram (§5.3) |
| Text layer < 40 chars | OCR (§5.2), then treat as above |

**Thorough mode.** A toggle, default **on**, that adds a third reading to any page that
is not confidently understood:

- automatically for every page marked `layoutConfidence: "low"` (§5.10.1), every page
  with `dateConfidence: "inferred"` (§5.8), and every page whose text layer is thin
  (< 200 chars) even if above the OCR threshold;
- for **every** page when the user forces it on.

The page is rasterised and OCR'd **in addition to** the text layer, and the two readings
are merged: any advocate or case number found by either is kept, with agreement raising
confidence and disagreement routed to the confirm queue showing both readings.

This roughly doubles processing time on affected pages. That trade is accepted
deliberately: a missed listing costs an appearance, and a few extra seconds costs
nothing. The UI states the trade in one line rather than hiding it — *"Thorough mode:
reads difficult pages twice. Slower, and it catches more."*

## 6. Inputs

### 6.1 Advocates

Accepted: textarea (one per line), `.txt`, `.csv`, `.xlsx`.

**Column auto-detection** — score each header against these patterns, take the best:

| Field | Header patterns (case-insensitive, fuzzy ≥ 0.75) |
|---|---|
| name | `advocate`, `name`, `counsel`, `advocate name`, `name of the advocate` |
| enrolment | `enrol`, `enrolment`, `enrollment`, `bar`, `bar council`, `reg no` |
| role | `role`, `designation`, `type` |

If no header row is detected (first row looks like data), assume column A is the name.
Always show the detected mapping and let the user override before running.

### 6.2 Case register

Accepted: `.csv`, `.xlsx`. Auto-detect against the firm's existing schema:

`DiaryNo, CaseType, CaseNo, Year, Court, CauseTitle, CounselFor, PartyName, Mobile,
Reference, Status, Date, Fees, Remarks, AttendedBy, NextDate, NextStage, StatusRemark, CNR`

Build `caseKey` via `normCaseNo(CaseType + "/" + CaseNo + "/" + Year)`.
Preserve every original column in `raw` — the export echoes them back.

### 6.3 Cause lists

One or many PDFs. Per file, a checkbox: **"I downloaded this from the official court
portal"** → sets `sourceIsOfficial`.

### 6.4 Portal deep links

A panel of links the user clicks to fetch lists manually. These **open in a new tab**;
the app never fetches them.

| Court | URL |
|---|---|
| Madras HC (principal + Madurai) | `https://www.mhc.tn.gov.in/judis/causelist` |
| District courts (TN) | `https://districts.ecourts.gov.in/tamilnadu` |
| eCourts services | `https://services.ecourts.gov.in/ecourtindia_v6/` |
| Consumer commissions | `https://e-jagriti.gov.in/` |

> These URLs must be verified at build time and are expected to drift. Keep them in
> `src/00-config.js` as a single editable array so a non-developer can fix one.

---

### 6.6 Adjournment notices, and why no database is needed

An adjournment notice carries **case numbers and new dates, nothing else** — no parties,
no advocates, no cause titles. Taken alone it cannot tell a firm which rows are theirs.

It does not have to. Identification comes from three sources already present, in order
of strength. **None requires server-side persistence.**

| # | Source | How it identifies | Availability |
|---|---|---|---|
| 1 | The firm's case register | Direct key match against `RegisterCase.caseKey` | Whenever Step 2 is supplied — the register *is* the database, handed over fresh each run |
| 2 | **A cause list for the same date, in the same session** | The list carries full parties and advocates; join on `caseKey` | Whenever both files are dropped together, which is the normal case |
| 3 | The optional local ledger (§6.7) | Recall from prior runs | Opt-in |

**Source 2 is the important one and must be implemented.** In the sample data, the
11.08.2026 HRCE cause list and Adjournment Notice No.16 refer to the same day. Joining
them in-session recovers everything the notice omits:

```
adjournment:  R.P.541/2022                      -> reposted 15.09.2026
cause list :  R.P.541/2022  E.R. Kannan through M/s.E.Ganesh
              vs J.C. Chennai Division-2 · Dharmaligeshwarar Temple, Nanganallur
result     :  "Your matter R.P.541/2022 (E.R. Kannan) is NOT being heard today.
               Reposted to 15 September 2026 at 3.00 pm."
```

#### 6.6.1 Adjournment supersedes the cause list — a correctness requirement

Measured on the supplied files: **109 of the 194 case keys on the 11.08.2026 cause list
appear in the adjournment notice dated 10.08.2026.** Fifty-six percent of the day's list
was vacated the evening before.

A tool that reads only the cause list therefore tells the firm to prepare bundles and
send juniors for matters that will not be called. **This makes adjournment support a
correctness requirement, not a feature.**

Rules:

1. When a `caseKey` appears in both a cause list and an adjournment notice covering the
   same original date, **the adjournment wins**.
2. Such matters render in a distinct **Adjourned** section, never in the day's
   attendance list, and never in the "matters listed today" count.
3. The row states the new date and time prominently, and links to the cause list entry
   for the detail.
4. If an adjournment notice is loaded whose original date does not match any loaded
   cause list, say so plainly rather than silently applying it.
5. Where `dateConfidence` is `"inferred"` (§5.8), the new date goes to the confirm queue
   with the ambiguity spelled out — never presented as settled.

### 6.7 The chamber profile — remembering the firm, locally

Chambers do not change their advocates daily. Retyping six names every morning is the
kind of friction that ends adoption in a fortnight. So Callover can remember, on the
device, in a single structure called the **chamber profile**.

```js
ChamberProfile = {
  version: 1,
  chamberName: string,          // free text, shown so shared machines are obvious
  advocates: Advocate[],        // the roster
  register: {
    cases: RegisterCase[],
    uploadedAt: ISOdate,
    sourceFilename: string,
    rowCount: number
  } | null,
  confirmations: { [hash]: boolean },   // §7.2.4 remembered spellings
  ledger: LedgerEntry[] | null,         // §6.7.3, separate opt-in
  savedAt: ISOdate
}
```

Stored in **IndexedDB** under `callover-profile`, not `localStorage` — a register of a
few thousand matters exceeds the 5 MB `localStorage` ceiling, and IndexedDB fails
gracefully where `localStorage` throws mid-write and corrupts.

#### 6.7.1 Rules

- **Opt-in.** A single checkbox, *"Remember this chamber on this device"*, off until
  ticked. Ticking it states plainly what is stored and where.
- **Everything is editable in place.** Add or remove an advocate without re-uploading.
- **Export and import as one JSON file.** This is how a chamber sets up a second machine,
  or how the clerk hands the profile to a junior. It also means the profile is never
  trapped in one browser.
- **Erase in one action**, from Settings, with a confirmation.
- **Shared-machine warning.** If a profile exists and the browser is in private mode, or
  a different profile was loaded within the hour, say so before loading.

#### 6.7.2 Registers go stale — and that is dangerous

The roster is stable; **the case register is not.** New matters are filed weekly. A
six-week-old register silently loses every recent filing, and the failure is invisible:
the app reports fewer matches and looks like it is working.

Therefore:

- The register's **upload date and row count are shown permanently** beside it, never
  hidden behind a settings page.
- After **14 days**, an amber banner: *"Your register was loaded 21 days ago and has 412
  matters. Matters filed since then cannot be matched by case number."*
- After **45 days**, the banner turns red and the run summary carries the same warning,
  so it appears on any exported result.
- Callover never refuses to run on a stale register. It refuses to let the user forget.

#### 6.7.3 The ledger — a separate, smaller opt-in

Distinct from the register, and switched on separately. The ledger is what Callover has
**seen**, accumulated from previous runs: case key, cause title, parties, advocate,
court, and each date it was listed or reposted.

Its one job is to identify matters in an adjournment notice when no matching cause list
was loaded (§6.6, source 3), and to report *"this matter has now been adjourned three
times."*

- Off by default, even when the profile is on. It is the only structure that accumulates
  client data the user did not deliberately upload.
- Capped at 5,000 matters, oldest evicted first.
- Viewable as a table, exportable, erasable independently of the profile.
- Its absence degrades nothing — sources 1 and 2 of §6.6 remain the primary paths.

#### 6.7.4 What this does not change

The profile lives on the device and is covered by §8.1a without exception. Nothing is
transmitted; there is still no account and no server. The privacy band gains one line
naming the profile, because a claim that omits stored data is not a true claim:

> *Saved on this device only: your advocate list, your register, and the spellings you
> confirmed. Nothing is sent anywhere. Erase it all from Settings.*

## 7. Output## 7. Output

### 7.1 Four views

1. **By advocate** — one section per firm advocate; their matters listed. A matter
   with two firm advocates appears in **both** sections (C5).
2. **By court / hall** — grouped by court then hall, ordered by item number. This is
   the view a junior uses to plan the morning.
3. **By case** — one row per matter, with **all** matched firm advocates listed
   together in one cell.
4. **Consolidated** — flat table, every column, for export.
5. **Adjourned** — matters of the firm's that were listed but have been reposted.
   Shown separately and prominently (§6.6.1). Columns: case number, cause title,
   original date, **new date and time**, source notice, confidence.

### 7.2 Confirm queue — evidence-first

> **This is a load-bearing requirement, not a nicety.** Asking *"is R.GANESH your
> E. Ganesh?"* with nothing else on screen forces the advocate to decide on the single
> weakest signal available. The app already knows the cause title, both parties, the
> case number, the court, the item, the side of the divider, and — when the register
> was supplied — whether that case number is one of the firm's at all. Withholding
> that turns a two-second certainty into a coin-flip. **Every confirm card must carry
> its full `Evidence` object inline. No click-through, no drawer, no "show details".**

#### 7.2.1 Card anatomy

Each `review` row renders as a card containing, in this order:

1. **The question** — one line: *Is `R.GANESH` your `E. Ganesh`?*
2. **The decisive banner**, when `evidence.registerHit` is true — a full-width green
   bar: *This case number is already in your register — diary B208.* When this fires,
   the name question is close to irrelevant and the card must say so.
3. **The comparison table** — two columns, `IN TODAY'S LIST` against `IN YOUR REGISTER`,
   one row per `EvidenceRow`, each marked agree / differs / not in register.
4. **The colleague line**, when `evidence.colleagues` is non-empty: *E.Srikanth is also
   printed on this item — also one of yours.*
5. **The PDF excerpt** — the verbatim lines, with `highlightSpans` marked.
6. **Provenance** — file, page, text-layer or OCR, official or uploaded.
7. **Yes / No**, keyboard-bound to `Y` and `N`.

#### 7.2.2 Row order

Ordered by how decisive each field is, so the eye lands on the settling fact first:

| Order | Field | Populated from |
|---|---|---|
| 1 | Case number | `item.caseNumbers` vs `registerCase.caseKey` |
| 2 | CNR | `item` text vs `registerCase.cnr` |
| 3 | Cause title | `item.petitioner + " vs " + item.respondent` vs `registerCase.causeTitle` |
| 4 | Parties | `item.petitioner`, `item.respondent` vs `registerCase.partyName` |
| 5 | Advocate | the printed string vs the firm advocate's name |
| 6 | Side | divider position vs `registerCase.counselFor` |
| 7 | Next stage | `registerCase.nextStage` — context, never a signal |

Rows whose `inRegister` is `null` (no register supplied) still render, marked
`absent`, so the advocate can see *what the app could not check*. Silently omitting
them would misrepresent the strength of the evidence.

#### 7.2.3 Wording rules

- `note` must be written for a lawyer, not a developer. *"one initial differs — E and R
  sit next to each other on a keyboard"*, never *"initials state: flip-plausible, 0.50"*.
- Never state a numeric confidence on a confirm card. It invites the advocate to defer
  to the number instead of reading the evidence. Numbers belong in the export and the
  evidence drawer on accepted rows.
- When `decisiveField` is set, the card leads with it and visually demotes the rest.

#### 7.2.4 Memory

A decision writes to `localStorage` keyed by
`hash(firmAdvocateName + "|" + normalisedPrintedName)`, so the same spelling is never
asked about twice. Remembered decisions are listed in a **Settings → Remembered
spellings** panel and can be revoked individually — a wrong Yes must be undoable.

#### 7.2.5 Weak tier

A **"show weak matches"** toggle reveals the `weak` tier (C4). Weak cards render with
the identical evidence layout; only the ordering and the default visibility differ.

### 7.3 Export columns

```
Date, Court, Hall, ItemNo, CaseNumber, CauseTitle, Petitioner, Respondent,
FirmAdvocate, PrintedName, Side, Tier, Confidence, Signals, DiaryNo, NextStage,
SourceFile, SourceMarkedOfficial, PageNo, WasOCR
```

Formats: `.xlsx` (one sheet per view) and `.csv` (consolidated only).

---

## 8. UI specification

See `ui-design.html` for the rendered mock.

### 8.1 Identity

**Name:** Callover. A callover is the court session where the bench goes through the
list, calls each matter and fixes what happens next — which is exactly what the app
does to today's list.

**No icon.** The product is a wordmark only, set in the display serif. This is
deliberate: the app is credited to an existing publication which has its own mark, and
two logos competing in one header reads as clutter.

**Attribution.** *Powered by The Forensic Brief* appears **only in the footer**, at the
very bottom of the page, with that publication's own logo and wordmark. It must not
appear in the app bar, in the results, or in exports.

**Palette** — shared with The Forensic Brief so the family resemblance is deliberate:

| Token | Value | Use |
|---|---|---|
| Cream | `#F4F1E8` | page background |
| Ink | `#23211E` | text, app bar, wordmark |
| Seal red | `#8A2B2B` | the run button, confirm queue, anything urgent |
| Muted | `#6E6A62` | secondary text, captions |
| Court green | `#2F6B4F` | matched, agree, decisive banner |
| Amber | `#9A6B10` | needs confirmation |
| Rule | `#DDD8CA` | borders and dividers |

**Type:** display serif for headings and the wordmark; a humanist sans at 16px minimum
for body — the users read this on a phone in a corridor; monospace for case numbers,
item numbers and anything that must align.

### 8.1a Privacy is the offering — how it is stated

Locality is not an implementation detail to be mentioned in a footer. It is the reason a
firm will put a file containing **client names, phone numbers and fee entries** into a
web page at all. It must be visible without being shouted.

**Four placements, and no more.** Repetition past this point reads as protesting too much.

| # | Placement | Content |
|---|---|---|
| 1 | App bar pill | `● NOTHING LEAVES THIS DEVICE` — small, green, permanent |
| 2 | Privacy band, directly under the app bar | The headline claim, three specifics, and the verification invitation |
| 3 | Inline at Step 2 and Step 3 | A short reassurance placed exactly where the anxiety occurs — at the moment of handing over a file |
| 4 | "How Callover can promise this" panel, above Export | The mechanism, in plain questions and answers, including the limits |

#### The headline claim

> **Nothing you open here leaves this device.**

Then, one sentence naming what is actually at stake: *your case register carries client
names, phone numbers and fee entries; Callover reads it inside your browser and sends it
nowhere — because there is nowhere for it to be sent.*

#### The three specifics

- **No upload.** Files are opened by the browser itself, the way a document opens on a
  desk. No copy is transmitted.
- **No account.** No sign-in, no email, no licence key. Nobody, including the authors,
  has any record that the tool was used.
- **Saved on this device only, if you ask for it.** Your advocate list, your register and
  the spellings you confirmed. Nothing is transmitted. Erase it all from Settings.
- **No server.** There is nothing at the other end to store anything.

#### The verification invitation — the most important line on the page

> **Disconnect from the internet and run it.** It works exactly the same — which is only
> possible because nothing was ever being sent.

A claim the user can falsify in ten seconds is worth more than any badge, certificate or
policy link. It must be prominent and it must remain true: **if a future feature breaks
offline operation, this line comes down first, and the feature is reconsidered.**

#### Wording rules

- Never use the words **"secure"**, **"bank-grade"**, **"military-grade"**, **"enterprise
  security"**, or a padlock as the whole message. They are unfalsifiable and read as
  marketing. State the specific, checkable fact instead.
- Never claim encryption the app does not perform.
- The word "upload" appears in the file picker, so Step 3 must disambiguate it:
  *"Uploaded here means uploaded into this page, not to the internet."*
- State the limits in the same breath as the promise. The export is an ordinary file on
  the user's disk and its safety passes to them; the app cannot reach court portals.
  Naming a limit is what makes the rest believable.

#### Honesty constraints

These are testable and non-negotiable:

- The page may fetch **nothing** at run time. Fonts, libraries and OCR data are all
  vendored (C1, §2.1). A single external font request would make the privacy band a lie.
- `localStorage` holds confirmed spellings only. It must be listed in the panel, and be
  viewable and deletable from Settings (§7.2.4).
- No analytics, no telemetry, no error reporting, no beacons. Not now, not later.
- The Forensic Brief attribution in the footer is a **plain hyperlink**. No tracking
  pixel, no script, no referrer beacon.

### 8.2 Page structure

```
┌─ App bar: CALLOVER wordmark · date · Run · privacy pill ─┐
├─ PRIVACY BAND  §8.1a — claim, specifics, verify invite   │
├─ Step 1  Advocates    [textarea | file] + detected table │
├─ Step 2  Case register (optional)  [file] + column map   │
├─ Step 3  Cause lists  [drop zone, multi-file, official?] │
├─ Portal links panel (collapsed by default)               │
├─ ── RUN ──                                               │
├─ Progress: pages parsed / OCR'd / candidates scored      │
├─ Summary strip: N matched · M to confirm · K weak hidden │
├─ CONFIRM QUEUE  — evidence-first cards, §7.2             │
├─ Tabs: By advocate | By court | By case | All            │
├─ "How Callover can promise this" panel  §8.1a            │
├─ Export: xlsx | csv | print                              │
└─ Footer: powered by The Forensic Brief + logo            │
```

### 8.3 The confirm queue is the primary surface

When `review` matches exist, the confirm queue sits **above** the results tabs and is
the first thing on screen after the summary. Rationale: an unconfirmed match is the
only thing in the app that can still cause a missed appearance. Accepted matches can
wait; questions cannot.

Each card follows §7.2.1 exactly. The comparison table is the largest element on the
card — larger than the question line — because that is what the decision rests on.

### 8.4 Evidence drawer on accepted rows

Clicking any **accepted** result row opens a drawer with the same `Evidence` object,
plus the signal list and numeric confidence. Accepted rows earn the click-through;
confirm cards do not (§7.2).

### 8.5 Results views

Four tabs per §7.1. In *By advocate*, a matter carrying two firm advocates appears in
both sections, each marked *also under [name]* so the duplication reads as intentional
rather than as a bug (C5).

### 8.6 Accessibility and input

- Confirm queue fully keyboard-driven: `Y` accept, `N` reject, `↑`/`↓` move, `?` help.
- Minimum 16px body text; 44px minimum touch targets.
- The comparison table collapses to stacked pairs below 700px, never to a horizontal
  scroll — an advocate on a phone must not have to swipe to see the register column.
- All state changes announced to screen readers via a polite live region.

### 8.7 Empty and failure states

| State | Behaviour |
|---|---|
| No advocates entered | Run disabled, inline hint. Never a crash or a silent no-op. |
| No matches at all | Explicit reassurance: *"None of your advocates appear in these lists."* plus the count of pages actually read, so the user can tell the difference between *nothing listed* and *nothing parsed*. |
| PDF unreadable | Name the file, state the page range that failed, continue with the rest. |
| Page yielded no text and OCR is unavailable | Flag the page number and warn that results may be incomplete. Never fail silently. |

## 9. Repository

### 9.1 Structure

```
callover/
├── README.md
├── TDD.md                     ← this file
├── LICENCE                    (MIT)
├── index.html                 ← the built artefact, committed
├── src/
│   ├── 00-config.js … 90-tests.js
├── vendor/
│   ├── pdf.min.js  pdf.worker.min.js
│   ├── xlsx.full.min.js
│   ├── tesseract.min.js  worker.min.js  eng.traineddata
├── fixtures/
│   ├── advocates.csv .xlsx .txt
│   ├── advocates-messy-headers.xlsx
│   ├── cases.csv .xlsx
│   ├── causelist-synthetic-14082026.pdf
│   ├── causelist-messy-14082026.pdf
│   └── golden.json
├── tests/
│   ├── run.mjs                ← node test runner, no framework
│   ├── unit/                  ← §10.1–10.4
│   └── integration/           ← §10.5
├── tools/
│   ├── build.mjs              ← concatenates src/ → index.html
│   └── build_corpus.py        ← regenerates fixtures/ + golden.json
└── .github/workflows/ci.yml
```

### 9.2 Build

`node tools/build.mjs` reads `src/*.js` in filename order, inlines them into
`index.html` between `<!--BUILD:START-->` and `<!--BUILD:END-->`, and inlines
`vendor/` as `<script src>` tags with relative paths. **No bundler, no npm install
required to run.** `index.html` is committed so a user can download one file.

### 9.3 CI

```yaml
on: [push, pull_request]
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4   # node 20
      - run: node tests/run.mjs        # must exit 0
      - run: node tools/build.mjs && git diff --exit-code index.html
```

The second step fails the build if `index.html` was not rebuilt after a `src/` change.

### 9.4 Milestones

| Milestone | Contents | Exit criterion |
|---|---|---|
| **M1 Engine** | §4 in full + unit tests T1–T3 | All unit tests green |
| **M2 Extraction** | §5 + synthetic corpus integration | T5 green on synthetic PDF |
| **M3 Real data** | Tuning against real Madras HC lists | T6 green; precision ≥ 0.95, recall = 1.00 |
| **M4 UI** | §8 | Manual walkthrough on phone + desktop |
| **M5 OCR** | §5.2 | T7 green on rasterised fixtures |
| **M6 Release** | README, licence, GitHub Pages demo | Someone else can use it without asking a question |

---

## 10. Test suite specification

> The runner is `node tests/run.mjs`. No framework. It prints a table and exits
> non-zero on any failure. Every test below has a stable ID; **never renumber them** —
> the IDs appear in commit messages and issue reports.

### 10.1 T1 — Transliteration (must MATCH)

| ID | Query | Printed | Expect |
|---|---|---|---|
| T1-01 | M. Krishnamurthy | M.KRISHNAMOORTHI | auto |
| T1-02 | N. Sivakumar | N.SHIVAKUMAR | auto |
| T1-03 | A. Thirumalai | A.TIRUMALAI | auto |
| T1-04 | G. Ramachandran | G.RAMACHANDIRAN | auto |
| T1-05 | S. Lakshmi Narayanan | S.LAXMINARAYANAN | ≥ review |
| T1-06 | P. Muthusamy | P.MUTHUSWAMY | auto |
| T1-07 | K. Subramanian | K.SUBRAMANIAM | auto |
| T1-08 | R. Ananthakrishnan | R.ANANDAKRISHNAN | auto |
| T1-09 | D. Jayaprakash | D.JAYA PRAKASH | ≥ review |
| T1-10 | E. Ganesh | E.GANESAN | auto |
| T1-11 | D. Lokeshwaran | D.LOKESWARAN | auto |
| T1-12 | E. Srikanth | E.SREEKANTH | auto |
| T1-13 | T. Thamarai Selvan | T.THAMARAISELVAN | auto |

### 10.2 T2 — Initials

| ID | Query | Printed | Expected state | Expected tier |
|---|---|---|---|---|
| T2-01 | E. Ganesh | E.GANESH | exact | auto |
| T2-02 | E. Ganesh | GANESH | absent-in-list | review |
| T2-03 | E. Ganesh | M/S.E.GANESH | exact | auto |
| T2-04 | E. Ganesh | GANESH E. | exact | auto |
| T2-05 | E. Ganesh | E.S.GANESH | partial | ≥ review |
| T2-06 | E. Ganesh | F.GANESH | flip-plausible | review |
| T2-07 | E. Ganesh | R.GANESH | flip-plausible | review |
| T2-08 | E. Ganesh | J.GANESH | flip-other | **weak** (hidden) |
| T2-09 | E. Ganesh | M.GANESH | flip-other | **weak** (hidden) |
| T2-10 | S.M. Subramaniam | M.S.SUBRAMANIAM | subset/transposed | review |
| T2-11 | E. Ganesh | R.GANESHKUMAR | — | not in confirm list |
| T2-12 | E. Ganesh | S.GANESH BABU | — | not in confirm list |
| T2-13 | E. Ganesh | E.SRIKANTH | — | none |

### 10.3 T3 — Case numbers

| ID | Register | Printed | Match? |
|---|---|---|---|
| T3-01 | WA 2025 of 2026 | WA/2025/2026 | yes |
| T3-02 | WP Crl 2077 of 2026 | WP Crl./2077/2026 | yes |
| T3-03 | CRP 414 of 2023 | CRP/414/2023 | yes |
| T3-04 | CS 813 of 2016 | CS/813/2016 | yes |
| T3-05 | CC 212 of 2026 | C.C.No.212/2026 | yes ← dot-strip regression |
| T3-06 | WMP 11451 of 2026 | WMP/11451/2026 | yes |
| T3-07 | CC 212 of 2026 | CC 213 of 2026 | **no** |
| T3-08 | CC 212 of 2026 | CC 212/26 | **no** (2-digit year rejected) |

### 10.4 T4 — OCR noise (`ocr: true`)

| ID | Register | OCR output | Expect |
|---|---|---|---|
| T4-01 | CC 212 of 2026 | `CC 2l2/2026` | match |
| T4-02 | CC 212 of 2026 | `C.C.No.2I2/2026` | match |
| T4-03 | WP 14523 of 2025 | `W.P.No.145Z3 of 2025` | match |
| T4-04 | OS 88 of 2024 | `O.S. 8B/2024` | match |
| T4-05 | CRP 901 of 2026 | `C.R.P.NO.9O1 OF 2026` | match |
| T4-06 | CC 212 of 2026 | `CC 213 of 2026` | **no match** |
| T4-07 | E. Ganesh | `E.GANE5AN` | ≥ review |
| T4-08 | M. Krishnamurthy | `M.KR1SHNAM00RTHI` | auto |
| T4-09 | N. Sivakumar | `N.5H1VAKUMAR` | auto |
| T4-10 | E. Ganesh | `E.MAHE5H` | none |

### 10.5 T5 — Integration against the synthetic corpus

Input: `fixtures/causelist-synthetic-14082026.pdf` + `advocates.csv` + `cases.csv`.
Compare against `fixtures/golden.json`, which contains 31 planted items:
**13 auto, 9 review, 4 weak, 5 none.**

| ID | Assertion |
|---|---|
| T5-01 | Every item with `expect: auto` appears in the auto tier |
| T5-02 | No item with `expect: none` appears in auto or review |
| T5-03 | P01 yields **four** matches (cluster of four firm advocates on one item) |
| T5-04 | P03 sets `side = "respondent"` (counsel below the divider) |
| T5-05 | P18 matches on `caseNumber` alone, `advocate = null` |
| T5-06 | P20 is found despite tribunal layout and `PARTY IN PERSON` counsel |
| T5-07 | D05 (`S.VIGNESH`) scores `none` — head-guard regression |
| T5-08 | Item `A188` in the register is **absent** from results (not listed today) |
| T5-09 | Court/hall/item number correctly extracted for all 31 |
| T5-10 | `causelist-messy-14082026.pdf` yields the same firm advocates as its subset |

### 10.6 T6 — Real-data regression

Input: a real Madras HC cause list (642 pages, ~10,000 distinct name strings),
firm = `E. Ganesh` only.

| ID | Assertion |
|---|---|
| T6-01 | Exactly **1** auto match: `E.GANESH` |
| T6-02 | Confirm list (review tier) has **≤ 5** entries |
| T6-03 | `S.VIGNESH`, `R.VIGNESH`, `D.VIGNESH` are **not** in auto or review |
| T6-04 | Full run completes in **< 60 s** on a mid-range laptop |
| T6-05 | Name scoring pass alone completes in **< 2 s** |
| T6-06 | Peak memory < 1 GB |

> Real cause lists cannot be committed (size, and they are public documents whose
> redistribution is not our call). CI runs T6 only when `fixtures/real/` is present;
> otherwise it skips with a notice. Developers fetch their own.

### 10.7 T7 — OCR pipeline

Rasterise `causelist-synthetic-14082026.pdf` to 200 dpi PNGs, rebuild a scanned PDF,
run end-to-end.

| ID | Assertion |
|---|---|
| T7-01 | Scan detection flags every page |
| T7-02 | ≥ 80% of `expect: auto` items still reach auto or review |
| T7-03 | No `expect: none` item reaches auto |
| T7-04 | `ocrPages` is populated on every result |

### 10.8 T8 — I/O

| ID | Assertion |
|---|---|
| T8-01 | `advocates.csv`, `.xlsx`, `.txt` all yield the same 6 advocates |
| T8-02 | `advocates-messy-headers.xlsx` maps `NAME OF THE ADVOCATE` → name |
| T8-03 | A headerless CSV falls back to column A |
| T8-04 | `cases.xlsx` builds 9 `caseKey`s, all normalised |
| T8-05 | Export round-trips: every input column present in the consolidated sheet |
| T8-06 | An empty advocate list is rejected with a clear message, not a crash |

### 10.9 T9 — Evidence-first confirmation (§7.2)

| ID | Assertion |
|---|---|
| T9-01 | Every `review` Match carries a non-empty `evidence.rows` |
| T9-02 | Rows are ordered per §7.2.2 — case number first, next stage last |
| T9-03 | When the register holds the case number, `registerHit` is true, `registerDiary` is populated, and `decisiveField === "caseNumber"` |
| T9-04 | When no register was supplied, every register-dependent row renders with `verdict: "absent"` rather than being omitted |
| T9-05 | P01 confirm card lists 3 colleagues in `evidence.colleagues` |
| T9-06 | `pdfExcerpt` is non-empty and `highlightSpans` fall inside its bounds |
| T9-07 | No confirm card exposes a numeric confidence (§7.2.3) |
| T9-08 | Every `note` is prose — fails if it matches `/\b(0\.\d+|flip-|tokSim|foldSim)\b/` |
| T9-09 | A remembered decision suppresses the identical question on a second run |
| T9-10 | Revoking a remembered decision restores the question |

### 10.9a T11 — Case-number range expansion (§4.6a)

Every case is a string that appears verbatim in the supplied HRCE documents.

| ID | Printed cell | Expect |
|---|---|---|
| T11-01 | `R.P.66/2022` | 1 key |
| T11-02 | `R.P.384 to 387/2022` | 4 keys |
| T11-03 | `R.P.384 to 387/2022, A.P.141 to 144/2022` | 8 keys, two types |
| T11-04 | `R.P.Nos.243 to 261 and 262/2022` | 20 keys |
| T11-05 | `R.P.48 to 96/ 2023` | 49 keys (note the space before the year) |
| T11-06 | `R.P.27 to 29/2025, R.P.88/2025` | 4 keys |
| T11-07 | `R.P.05 and 06/2026` | `RP/5/2026`, `RP/6/2026` — leading zeros dropped |
| T11-08 | `R.P.17 of 2026` | 1 key — the word `of` as separator |
| T11-09 | `R.P.No.289 to 294 of 2026` | 6 keys |
| T11-10 | `R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025` | 10 keys, type inherited across commas |
| T11-11 | `R.P.Nos.412 to 428/2025, R.P.433/2025` | 18 keys |
| T11-12 | `R.P.212/2023, A.P.135/2022` | 2 keys, different years |
| T11-13 | `SMR.1/2025` | 1 key, dotless type |
| T11-14 | A range of 900 | capped, flagged, not expanded (§4.6a step 5) |

### 10.9b T12 — HRCE tribunal documents

Run against `fixtures/hrce/` with `advocates-hrce.csv` and `cases-hrce.csv`.
Assertions H-01 … H-15 are enumerated in `fixtures/golden-hrce.json`.

| ID | Assertion |
|---|---|
| T12-01 | H-01, H-02 — advocate found inside both petitioner and respondent party cells |
| T12-02 | H-03, H-04 — matters found **only** because the printed range was expanded |
| T12-03 | H-05, H-06 — `throughThiru.` with no space, and bare `Thiru`, both parse |
| T12-04 | H-07 — `sideDetail` captures `R3 to R11` |
| T12-05 | H-08 — an adjourned matter never appears in the attendance list |
| T12-06 | **H-09, H-10 — merged date cells resolve correctly.** Row 6 takes 15.09.2026, not 18.08.2026; row 8 takes 15.09.2026, not 10.11.2026 |
| T12-07 | H-11 — a notice-only matter is identified from the register with no cause list present |
| T12-08 | H-12 — a register matter not listed today appears nowhere |
| T12-09 | H-13 — the appended reposting table inside a cause list PDF is detected as its own section |
| T12-10 | H-14 — temple name reaches the evidence table |
| T12-11 | **H-15 — no extracted advocate equals `Temple`, `M.P.No` or `of the JC`.** Column-bleed regression: these are what flattening the page produces |
| T12-14 | **H-16, H-17, H-18 — both party columns scanned.** E. Ganesh must be found at least twice in the petitioner column and four times in the respondent column across the four supplied lists. Fails if either side is skipped |
| T12-15 | H-19 — a respondent cell with multiple counsel yields one advocate per `through`, each retaining its own respondent numbering |
| T12-16 | H-20 — a register `CounselFor` of `Petitioner` does not suppress a respondent-side match; the hit is kept and a `sideMismatch` warning is raised |
| T12-17 | Column-aware extraction yields ≥ 60 distinct advocate strings from the four lists; flattening yields noise and must not be used |
| T12-12 | Measured overlap holds: 194 cause-list keys, 268 notice keys, 109 in both |
| T12-13 | With ruling rectangles removed from a copy of the file, every affected row is marked `dateConfidence: "inferred"` and routed to the confirm queue |

### 10.9c T13 — Dual-pass extraction and reconciliation (§5.10)

| ID | Assertion |
|---|---|
| T13-01 | Every page produces both a Pass A and a Pass B result set |
| T13-02 | A name in a counsel column is found by both passes and tiers normally |
| T13-03 | A name planted in the subject-matter column is found by **B only** and routed to the confirm queue — never auto-accepted |
| T13-04 | A `B only` hit is never dropped, whatever its score (C4) |
| T13-05 | A page with Pass A disabled still yields every planted advocate via Pass B |
| T13-06 | A page with ≥3 `B only` and 0 `A` hits is marked `layoutConfidence: "low"` |
| T13-07 | Results from a low-confidence page are capped at `review` regardless of score |
| T13-08 | A file with >20% low-confidence pages is flagged above the results |
| T13-09 | The "Pages I could not read cleanly" panel lists every such page with its raw text |
| T13-10 | Reconciliation adds no duplicate: a name found by both passes yields one Match |

### 10.9d T14 — Chamber profile and thorough mode (§5.11, §6.7)

| ID | Assertion |
|---|---|
| T14-01 | With the profile off, nothing is written to IndexedDB during a full run |
| T14-02 | Profile round-trips: save, reload the page, roster and register restored intact |
| T14-03 | Export then import on a clean browser reproduces the profile exactly |
| T14-04 | A register older than 14 days raises the amber banner; older than 45, the red one |
| T14-05 | The stale-register warning appears in the exported file, not only on screen |
| T14-06 | Erase removes every Callover key from IndexedDB and localStorage, verified by enumeration |
| T14-07 | A 4,000-matter register saves and loads without exceeding storage quota |
| T14-08 | The ledger stays empty while its own switch is off, even with the profile on |
| T14-09 | Thorough mode engages automatically on low-confidence, inferred-date and thin-text pages |
| T14-10 | With thorough mode forced on, a page whose text layer was deliberately corrupted still yields the planted advocates via OCR |
| T14-11 | Where text-layer and OCR readings disagree, both are shown on the confirm card |
| T14-12 | Document type override sticks: a file forced to `Tribunal list` is never re-detected |
| T14-13 | Forcing the wrong type produces no `Temple` / `M.P.No` style artefacts in the confident tier — they appear as `B only` at most |

### 10.9e T15 — Document profiles and column roles (§5.8a)

The first three exist because an earlier draft of §5.10 would have failed them.

| ID | Assertion |
|---|---|
| T15-01 | **No code path tests for a column named `counsel`.** Confidence is derived from `role ∈ {counsel, party+counsel}` — grep-level assertion over `src/` |
| T15-02 | **Every HRCE advocate found in a party column is `matchRole: "counsel"` at full confidence, never `unplaced`.** Regression for the buried-tribunal-practice bug |
| T15-03 | Under `tribunal.hrce`, both `petitioner` and `respondent` are counsel-bearing; disabling either loses known matters (H-16, H-17) |
| T15-04 | Under `causelist.hc`, only the `counsel` column is counsel-bearing; a name in `parties` yields `matchRole: "party"`, not `"counsel"` |
| T15-05 | `party+counsel` split: text before the connector is party, after is advocate |
| T15-06 | `R.P.541/2022` (`E.R. Kannan through M/s.E.Ganesh`) → `matchRole: "counsel"` |
| T15-07 | `CC/212/2026` (`E.Ganesh & anr -Vs- ...`) → `matchRole: "party"`, still tiered normally |
| T15-08 | Confirm card and export both state `matchRole`; "appearing" and "a party" are never conflated |
| T15-09 | A respondent cell with several connectors yields one advocate per connector, each with its own `sideDetail` |
| T15-10 | A new forum can be supported by adding a profile only — no change to the extractor — proven by loading a synthetic 5-column profile |
| T15-11 | `tribunal.hrce` detection fires on all four supplied HRCE files and on none of the High Court files |
| T15-12 | `extra` columns (Under Section, Temple, Subject matter) are captured and shown in evidence but never matched for counsel |

### 10.9f T16 — The connector probe (§5.8a0)

| ID | Assertion |
|---|---|
| T16-01 | Probe runs **before** any advocate name is searched for — ordering assertion on the pipeline |
| T16-02 | HR&CE petitioner column: cell-level density ≈ 50%, classified `party+counsel` |
| T16-03 | HR&CE respondent column: cell-level density ≈ 20%, classified `party+counsel` |
| T16-04 | HR&CE temple, subject and under-section columns: 0% density, never split |
| T16-05 | **Cell-level density is used, not line-level.** Fails if the petitioner column measures below 40% |
| T16-06 | `throughThiru. E. Ganesh` splits correctly — glued connector |
| T16-07 | `And othersthrough Thiru E. Ganesh` splits correctly — glued on the left |
| T16-08 | `throughout` and `breakthrough` are **not** treated as connectors |
| T16-09 | **The lookahead guard is case-sensitive.** With `IGNORECASE` applied to it, T16-06 fails — regression for the `(?-i:(?![a-z]))` island |
| T16-10 | `AKILESH KUMAR FOR R1` → direction `counsel-first`, advocate before, party reference after |
| T16-11 | `SPL.PUBLIC PROSECUTOR FOR ED CASES` is **not** split — bare `for` with no party reference |
| T16-12 | `rep. by`, `represented by`, `thro`, `thru` all recognised |
| T16-13 | The probe may upgrade `party` to `party+counsel`; it never downgrades a declared counsel column |
| T16-14 | A synthetic list from an unknown forum, with no profile, still yields counsel from its party column via the probe alone |
| T16-15 | Probe results appear in the "how this file was read" panel |

### 10.10 T10 — Privacy claims are true (§8.1a)

These tests exist because the privacy band is a factual claim. If it stops being
accurate, the build must fail rather than the page mislead.

| ID | Assertion |
|---|---|
| T10-01 | `index.html` contains no `http://` or `https://` resource reference except the Forensic Brief footer link and the court portal deep links |
| T10-02 | No `<link rel="stylesheet">` or `@import` pointing off-origin — fonts must be vendored or system |
| T10-03 | Running the full pipeline with the network stubbed to throw on any request completes normally |
| T10-04 | `localStorage` keys written during a full run are confined to the `callover:confirm:` prefix |
| T10-05 | No `navigator.sendBeacon`, `fetch`, `XMLHttpRequest` or `WebSocket` call reachable from the run path |
| T10-06 | Source contains none of: "bank-grade", "military-grade", "enterprise security", "secure by design" (§8.1a wording rules) |
| T10-07 | The Settings panel lists every stored confirmation and deletion removes it |

### 10.11 Coverage gate

Statement coverage ≥ 90% on `src/10-` … `src/60-` (the engine). The UI layer is
exempt. Measured with `node --experimental-test-coverage`.

---

## 11. Decisions log

Recorded so they are not silently undone.

| # | Decision | Rationale |
|---|---|---|
| D1 | Initials compared separately from the core name | 19 distinct initials share `BALAJI` in one real list |
| D2 | `flip-other` = 0.12 | At 0.30 the daily confirm list fills with unrelated advocates |
| D3 | Head guard on the core token | Kills the `GANESH`/`VIGNESH` vowel-strip collision |
| D4 | Three tiers, not two | C4 requires nothing be discarded; a hidden `weak` tier satisfies it without noise |
| D5 | Noisy-OR, not a weighted sum | Independent signals should reinforce, and a strong case-number match must not be diluted by a weak name |
| D6 | Case number is the primary key, name is the safety net | The firm knows its own case numbers exactly |
| D7 | Cluster signal uses the whole firm roster | Chambers are printed together; verified in real data |
| D8 | Manual PDF download, deep links only | CORS + captcha + professional risk (C3) |
| D9 | Vendored libraries, no CDN | C1; also means the tool still works in 2031 |
| D10 | `index.html` committed, not just built | A user must be able to download one file and open it |
| D11 | Confirm cards carry full evidence inline, never behind a click | The app knows the case number, parties and cause title; hiding them forces a decision on the weakest signal (the name) alone |
| D12 | No numeric confidence on confirm cards | A number invites deference to the score instead of reading the evidence |
| D13 | Register-dependent rows render as `absent`, never omitted | The advocate must be able to see what the app *could not* check |
| D14 | Callover has no icon; attribution sits only in the footer | Two marks in one header is clutter, and the publication's mark carries its own unrelated meaning |
| D15 | Privacy stated in four fixed placements, not everywhere | The register holds privileged client data; locality is the offering. But repetition past four reads as protesting too much |
| D16 | "Disconnect and run it" invitation over any security badge | A claim the user can falsify in ten seconds beats an unfalsifiable one they must trust |
| D17 | The words "secure", "bank-grade", "military-grade" are banned in the UI | Unfalsifiable, and they signal marketing where a specific checkable fact is available |
| D18 | Limits stated alongside the promise | Naming what the app cannot protect is what makes the rest credible |
| D19 | Zero run-time network requests, enforced by T10 | One external font request would make the privacy band untrue |
| D20 | Case-number ranges expanded to individual keys | `R.P.48 to 96/2023` is 49 matters; treating it as one string loses 48 |
| D21 | Cell geometry read from table rectangles, not text alignment | The only correct way to resolve a vertically merged date cell; a wrong hearing date is the worst output this tool can produce |
| D22 | Adjournment notices supersede cause lists | 109 of 194 keys on the sample 11.08.2026 list were vacated. Without this, Callover sends juniors to matters that will not be called |
| D23 | No server-side database; identification via register, same-session cause list, or opt-in local ledger | The register the user uploads each run *is* the database. Persistence would break §8.1a for no gain |
| D24 | Inferred dates go to the confirm queue, never presented as fact | A guessed hearing date is indistinguishable from a correct one until the day it is wrong |
| D25 | Every side of every matter is scanned; side is recorded, never used to filter | Measured: E. Ganesh appears on both sides in the same four documents. Filtering by a firm's "usual" side loses most of their work |
| D26 | Every page read twice — structured pass plus a structure-blind sweep | Column recovery is inference and inference fails silently. Two methods that fail differently cannot fail together quietly |
| D27 | `B only` hits always go to the confirm queue — never auto-accepted, never dropped | They are exactly the missed-listing case, and also exactly the false-positive case. Only a human can separate them |
| D28 | Pass disagreement is a page health signal, surfaced to the user | A page whose layout was misread must never be reported as a page with no matches |
| D29 | Thorough mode on by default for difficult pages | A missed listing costs an appearance; a few seconds costs nothing. The trade is stated, not hidden |
| D30 | Chamber profile in IndexedDB, opt-in, exportable | Retyping the roster daily ends adoption. A register exceeds the localStorage ceiling, and localStorage fails destructively |
| D31 | Register staleness warned at 14 and 45 days, and carried into exports | A stale register fails invisibly — fewer matches looks identical to a quiet day |
| D32 | Document type chosen per file, auto-detected but overridable | Running the wrong extractor produces noise, not silence, and noise is indistinguishable from signal downstream |
| D33 | Counsel-bearing is a declared **column role**, never a column name | HRCE has no counsel column — the advocate sits inside the party cell. An earlier draft tested for the name and would have buried an entire tribunal practice in the confirm queue |
| D34 | `tribunal.hrce` is a first-class named profile, not a variant of the High Court reader | It is a different table shape, and it is a major share of the practice this tool is built for |
| D35 | `matchRole` distinguishes counsel from party | A partner's own litigation must still be caught, but "you are appearing" and "you are a party" are not interchangeable on a confirm card |
| D36 | New forums are added as declarative profiles | The extractor should never grow a branch per court |
| D37 | The connector probe runs before any name search, as a first-level structural detector | "Party through Advocate" is a convention across Indian courts. Discovering counsel-bearing columns from content means an unwritten forum still works |
| D38 | Connectors carry a direction; `for` is a connector only before a party reference | `X through Y` and `Y FOR R1` are inverses. Getting it backwards swaps party and advocate |
| D39 | Connector density measured per assembled cell, never per line | Measured: 50% per cell against 10% per line on the same column. Line-level measurement misclassifies the main counsel column as ordinary text |
| D40 | The connector-guard lookahead is case-sensitive inside a case-insensitive pattern | Under IGNORECASE, `[a-z]` matches uppercase, which silently rejects `throughThiru` — a real string in the supplied lists |

---

## 12. Out of scope for v1

Stated so nobody plans around them: multi-day/date-range runs; supplementary and
revised list diffing; Tamil-script cause lists (Latin only for now); direct
integration with the firm's case management system; any server component; any
automated portal fetching (permanently out — C3).

---

## 13. Glossary

**Cause list** — the daily schedule of matters a court will hear.
**CNR** — Case Number Record, a 16-character nationally unique case identifier.
**Coram** — the judge(s) sitting.
**Divider** — the `------------------` line separating petitioner from respondent counsel.
**Item number** — the position of a matter on the day's board.
**M/S.** — prefix denoting a chambers rather than an individual.
**Tier** — `auto` (accepted), `review` (confirm queue), `weak` (hidden but retrievable).
