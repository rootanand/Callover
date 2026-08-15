# Callover

**Find your chamber's matters in today's cause list — before the day starts.**

A *callover* is the court session where the bench goes through the list, calls each
matter and fixes what happens next. This tool does the same to today's list on your
behalf, and tells you which ones are yours.

### → **[How to use it](how-to-use.html)** — start here if you are going to use it

Open [`index.html`](index.html). That is the whole application: one file, no installer,
no account, no server. Double-clicking it works.

---

## A matter listed under `R.GANESAN` when your register says `E. Ganesh`

…is invisible to a text search. Nobody appears. The order reads *"None appears for the
petitioner."*

Searching a real 642-page Madras High Court cause list for `E. Ganesh`:

| Method | Results to wade through |
|---|---|
| Substring search for `GANESH` | 44 |
| Callover | **1 accepted + 2 to confirm** |

Nothing is discarded — weak candidates stay retrievable behind a toggle.

### What it survives

- Tamil transliteration drift — *Krishnamurthy / Krishnamoorthi*, *Lakshmi / Laxmi*
- Wrong, missing, extra, reordered or transposed initials
- Names joined or split — *Thamarai Selvan / Thamaraiselvan*, *Selvan T.Thamarai*
- Chambers prefixes — `M/S.E.GANESH`
- OCR noise on scanned lists — `E.GANE5AN`
- Case-number ranges — `R.P.48 to 96/2023` is **forty-nine matters**, not one
- Vertically merged date cells in adjournment notices, where the wrong reading puts you
  in the wrong court on the wrong day
- Any court layout: High Court, district, tribunal — and a forum nobody has written a
  profile for, because counsel-bearing columns are discovered from content

### What a cause list alone will not tell you

An adjournment notice carries case numbers and new dates and nothing else — no parties,
no advocates. Callover joins it to the cause list in the same session and to your
register, so the day's board reads:

> *Your matter R.P.541/2022 (E.R. Kannan) is **not** being heard today. Reposted to
> 15 September 2026 at 3.00 pm.*

On the supplied HR&CE files, **236 of the 240 case keys on the 11.08.2026 list were
vacated by the notice dated the evening before**. A tool that reads only the cause list
sends juniors to matters that will not be called. See
[`docs/measurements.md`](docs/measurements.md).

---

## Nothing you open leaves your device

Your case register carries client names, case numbers and phone numbers. Callover reads
it inside your browser and sends it nowhere — because there is nowhere for it to be sent.

- **No upload.** Files are opened by the browser itself. No copy is transmitted.
- **No account.** No sign-in, no email, no licence key. Nobody has any record you used it.
- **No server.** There is nothing at the other end to store anything.
- **No AI service.** The matching is fixed, published rules, so identical input always
  gives identical output and any match can be explained.

**Don't take our word for it — disconnect from the internet and run it.** It works
exactly the same, which is only possible because nothing was ever being sent.

Every third-party byte the page runs is committed in [`vendor/`](vendor/) at a pinned
version with a recorded SHA-256, and `node tools/vendor.mjs --verify` checks them.
Test **T10** fails the build if a single external reference appears in `index.html` or in
the tutorial.

### Two limits, stated plainly

**Reading scanned pages needs the page served over `http`.** The OCR engine is a Web
Worker plus WebAssembly, and a browser will not start either from a bare `file://`
origin. Everything else — all matching, every export, the whole confirm queue — works
from a double-clicked `index.html` with no folder beside it. When a page has no text
layer and OCR cannot start, Callover names the page and says results may be incomplete;
it never fails quietly.

```bash
python -m http.server 8901
```

**Picture-reading is slow, and you can always stop.** A dense A4 page takes upwards of
two minutes, so the progress panel says which page is being read and how far along it
is, and **Stop and keep what has been read** ends the run at once, keeps everything read
so far, and states which pages were skipped. Nobody should be trapped watching a bar
that is not moving — and a browser freezes timers in a tab you have left, so the escape
is a button, not a timeout.

---

## For developers

| File | What it is |
|---|---|
| [`TDD.md`](TDD.md) | Full technical design and test-suite spec. The source of truth. |
| [`docs/measurements.md`](docs/measurements.md) | Every figure re-measured from the supplied files, and the four places reality differed from the spec. **Read this before changing the engine.** |
| [`how-to-use.html`](how-to-use.html) | The user tutorial. Self-contained, loads nothing. |
| [`docs/ui-design.html`](docs/ui-design.html) | The original rendered UI mock. A reference, not the app. |
| `src/NN-*.js` | The application, in load order. Concatenated into `index.html` by the build. |
| `src/engine-reference.js`, `src/ranges-reference.js` | The tested reference engines the port came from. Not shipped; kept as provenance and as the fixtures for the differential test **T0**. |
| `vendor/` | Every third-party byte, pinned and hashed. See [`vendor/README.md`](vendor/README.md). |
| `fixtures/` | The 31-item synthetic corpus, four real HR&CE documents, advocates, registers, golden files. |
| `tools/shell.html` | The HTML skeleton and all the CSS. |

```bash
node tools/build.mjs           # rebuild index.html from tools/shell.html + src/ + vendor/
node tools/build.mjs --check   # fail if index.html is stale (what CI runs)
node tests/run.mjs             # the suite — TDD.md §10
node tests/run.mjs --measure   # and print the figures behind docs/measurements.md
node tools/coverage.mjs        # the §10.11 coverage gate
node tools/vendor.mjs --verify # check vendor/ against its pinned hashes
```

The suite is **205 assertions, no framework, nothing to install**. Eleven are skipped
and each says why: six are **T6**, the real-data regression, which needs a real cause
list you fetch yourself into `fixtures/real/` (§10.6 — a court's own document is not
ours to redistribute); five need a browser for Worker, WebAssembly or canvas.

Engine coverage is gated at 90% over `src/10-` … `src/60-`. `50-extract.js` sits lower
than its neighbours because the OCR block only runs in a browser.

The port is identical to `src/engine-reference.js` except for one deliberate change —
the order guard in §4.4 — and **T0 proves that divergence is the only one and that it is
monotone**: no score falls, no tier falls, and same-order names are untouched.

---

## Design commitments

These are not negotiable — see `TDD.md` §1 and §11.

1. **Nothing is silently discarded.** A wrongly shown row costs a glance; a wrongly
   dropped row costs an appearance. The asymmetry is total.
2. **Confirmation is evidence-first.** Every confirm card carries the case number, cause
   title, parties, side and colleagues inline, and never a numeric confidence. Never a
   click-through.
3. **Counsel-bearing is a column *role*, never a column *name*.** HR&CE lists have no
   counsel column at all — the advocate is printed inside the party cell after
   *"through"*. Code that looks for a column called "counsel" finds nothing and buries a
   whole tribunal practice.
4. **Every side of every matter is scanned.** Side is recorded, never used to filter.
   Measured on the supplied files, E. Ganesh appears on both sides in the same four
   documents.
5. **Every page is read twice** — once by column, once ignoring columns entirely. Two
   methods that fail differently cannot fail together quietly, and a page that could not
   be read is named rather than reported as a page with no matches.
6. **An adjournment supersedes the cause list.**
7. **No automated fetching from court portals.** Blocked by CORS, gated by captcha, and
   not something a law firm's own tooling should be doing. Callover deep-links you to
   the right page; you download and drop the file in.
8. **Deliberate overlap.** A matter with two of your advocates appears under both.

## Licence

MIT. Vendored libraries keep their own licences — Apache-2.0 and MIT, all recorded in
[`vendor/README.md`](vendor/README.md).

---

Powered by [The Forensic Brief](https://theforensicbrief.com)
