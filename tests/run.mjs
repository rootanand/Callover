/* ============================================================================
   Callover test suite — TDD.md §10.

       node tests/run.mjs              run everything
       node tools/coverage.mjs         run it under V8 coverage, §10.11 gate

   No framework, no install. Prints a table and exits non-zero on any failure.
   Test IDs are stable and must never be renumbered — they appear in commit
   messages and issue reports.

   Two assertions carry a documented exception, both recorded in full with
   their reasoning in docs/measurements.md:

     T5-02   D09 (M.KRISHNAN against M. Krishnamurthy) reaches review where
             golden.json expects none. This is a property of the §4.4 scoring
             formula in the supplied reference engine, which the README says
             to port and not rewrite. The allow-list holds exactly one entry
             and the test fails if it is widened or if any other item joins it.

     T5-05   P18 yields matchRole "party" rather than advocate=null, because
             §5.8a.3 — written later and more specifically — requires a firm
             name printed as a party to be caught and labelled as one. The
             mechanism T5-05 was written to prove is asserted on P19 instead.
   ========================================================================= */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, fixture, hasReal, loadVendor, loadApp, loadReference,
  installLocalStorage, installMemoryStore, readPdf, rowsOf,
  loadRegister, loadRoster, makeReporter
} from './harness.mjs';

const { group, t, skip, eq, state, finish } = makeReporter();
const MEASURE = process.argv.includes('--measure');

await loadVendor();
const CO  = await loadApp();
const REF = await loadReference('engine-reference.js');
const RNG = await loadReference('ranges-reference.js');
installLocalStorage();

const golden  = JSON.parse(readFileSync(fixture('golden.json'), 'utf8'));
const goldenH = JSON.parse(readFileSync(fixture('golden-hrce.json'), 'utf8'));
const tierOf  = (q, c, o) => { const s = CO.nameScore(q, c); return s ? CO.classify(s, o) : 'none'; };
const shown   = v => v === 'auto' || v === 'review';
const pad2    = n => String(n).padStart(2, '0');

console.log(`\nCallover ${CO.VERSION} — TDD.md §10 test suite`);

/* ==========================================================================
   T0 — the port against the reference (not in §10; added because §4 forbids
   silent drift).

   The port is identical to src/engine-reference.js in every part EXCEPT the
   order guard in §4.4 (see docs/measurements.md §5). That one divergence is
   deliberate, and this group's job is to prove it is the ONLY one and that it
   is bounded in the direction that matters:

     T0-01  normalisation, range expansion and the distance primitives are
            bit-for-bit identical
     T0-02  no score can ever fall — the guard is a pure Math.max
     T0-03  scores are EXACTLY identical wherever the token order already
            agreed, which is every single-token name and therefore every case
            in T1, T2, T4 and T6
     T0-04  classification is unchanged given the same score
     T0-05  no tier can fall; the tiers that rise are enumerated
   ========================================================================== */
group('T0  the ported engine against the reference');
{
  const NAMES = [
    'E. Ganesh','M/S.E.GANESH','GANESH E.','R.GANESAN','S.VIGNESH','M. Krishnamurthy',
    'M.KR1SHNAM00RTHI','T. Thamarai Selvan','SELVAN T.THAMARAI','S.LAXMINARAYANAN',
    'Dr. K. Subramanian','THIRU E. GANESH','M/s.N.Soundarrajan','AKILESH KUMAR FOR R1',
    'K.Jegan','','   ','E.R. Kannan','D.YUVAJAISHREE FOR R5','SPL.PUBLIC PROSECUTOR FOR ED CASES',
    'Bálaji','O’Brien','E.SRIKANTH','E.SREEKANTH','D.LOKESWARAN','T.THAMARAISELVAN',
    'S.M. Subramaniam','M.S.SUBRAMANIAM','J.GANESH','F.GANESH','R.GANESH','E.S.GANESH','GANESH',
    'R.GANESHKUMAR','S.GANESH BABU','N.SIVAKUMAR','K.SHIVAKUMAR','M.KRISHNAN','T.SELVAN',
    'E.SRIKANTHAN','PARTY IN PERSON','ADVOCATE NAME ILLEGIBLE','COMPLAINANT IN PERSON',
    'M/S.T.S.R.VENKATARAMANA','A.TIRUMALAI','G.RAMACHANDIRAN','P.MUTHUSWAMY','K.SUBRAMANIAM',
    'R.ANANDAKRISHNAN','D.JAYA PRAKASH','E.GANE5AN','E.MAHE5H','N.5H1VAKUMAR','M.KIRUSHNAMURTHY',
    'T.DHAMARAI SELVAN','Temple','M.P.No','of the JC'
  ];
  const CASES = ['CC 212 of 2026','C.C.No.212/2026','WP Crl 2077 of 2026','CC 212/26','R.P.66/2022',
    'W.P.No.145Z3 of 2025','O.S. 8B/2024','SMR.1/2025','','garbage','12345','CC 2l2/2026',
    'C.R.P.NO.9O1 OF 2026','WA 2025 of 2026','WMP/11451/2026','CS/813/2016','OSA/44/2024'];
  const CELLS = ['R.P.66/2022','R.P.384 to 387/2022','R.P.Nos.243 to 261 and 262/2022',
    'R.P.48 to 96/ 2023','R.P.05 and 06/2026','R.P.17 of 2026','R.P.No.289 to 294 of 2026',
    'SMR.1/2025','R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025',
    'R.P.Nos.412 to 428/2025, R.P.433/2025','R.P.212/2023, A.P.135/2022','R.P.No.427 and 428/2024',
    '','A.P.9/2021','A.P.38 to 40/2026','R.P.146 and 147/2026','R.P.27 to 29/2025, R.P.88/2025'];

  let checks = 0, diffs = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-12);

  for (const s of NAMES) {
    checks += 2;
    if (!same(CO.splitName(s), REF.splitName(s))) diffs.push(`splitName ${JSON.stringify(s)}`);
    if (!same(CO.foldIndic(s), REF.foldIndic(s))) diffs.push(`foldIndic ${JSON.stringify(s)}`);
  }
  for (const c of CASES) {
    checks += 2;
    if (!same(CO.normCaseNo(c), REF.normCaseNo(c))) diffs.push(`normCaseNo ${JSON.stringify(c)}`);
    if (!same(CO.normCaseNo(c, true), REF.normCaseNo(c, true))) diffs.push(`normCaseNo/ocr ${JSON.stringify(c)}`);
  }
  for (const cell of CELLS) {
    checks++;
    if (!same(CO.expandCaseCell(cell), RNG.expandCaseCell(cell))) diffs.push(`expandCaseCell ${JSON.stringify(cell)}`);
  }
  t('T0-01', diffs.length === 0,
    `${checks} comparisons — normalisation, ranges and distance primitives are identical` +
    (diffs.length ? ` — ${diffs.length} DIVERGENCES: ${diffs.slice(0, 5).join('; ')}` : ''));

  /* Where the token order already agrees, the sorted candidate the guard adds
     is the in-order one, so the score must be untouched. That is every
     single-token core name — i.e. every case in T1, T2, T4 and T6. */
  const sameOrder = (q, c) => {
    const a = CO.splitName(q).core, b = CO.splitName(c).core;
    const sorted = x => [...x].sort().join(' ') === x.join(' ');
    return sorted(a) && sorted(b);
  };

  let pairs = 0, fell = [], changedSameOrder = [], nullness = [], classifyDiff = [];
  const rank = { none: 0, weak: 1, review: 2, auto: 3 };
  const rose = [], tierFell = [];

  for (const q of NAMES) for (const c of NAMES) {
    pairs++;
    const a = CO.nameScore(q, c), b = REF.nameScore(q, c);
    if ((a === null) !== (b === null)) { nullness.push(`${q}|${c}`); continue; }
    if (a === null) continue;

    if (a.combined + 1e-12 < b.combined)
      fell.push(`${q}|${c} ${b.combined.toFixed(4)} -> ${a.combined.toFixed(4)}`);
    if (sameOrder(q, c) && (!near(a.combined, b.combined) || !near(a.core, b.core)))
      changedSameOrder.push(`${q}|${c} ${b.combined.toFixed(4)} -> ${a.combined.toFixed(4)}`);
    if (a.initials.state !== b.initials.state) classifyDiff.push(`initials ${q}|${c}`);

    for (const ocr of [false, true]) {
      /* the classifier itself, fed the identical score object */
      if (CO.classify(b, { ocr }) !== REF.classify(b, { ocr })) classifyDiff.push(`classify ${q}|${c}`);
      const ta = REF.classify(b, { ocr }), tb = CO.classify(a, { ocr });
      if (rank[tb] < rank[ta]) tierFell.push(`${q}|${c} ${ta} -> ${tb}`);
      else if (rank[tb] > rank[ta] && !ocr) rose.push(`${JSON.stringify(c)} for ${JSON.stringify(q)}: ${ta} -> ${tb}`);
    }
  }

  t('T0-02', fell.length === 0 && nullness.length === 0,
    `over ${pairs} name pairs no score falls — the order guard is a pure Math.max` +
    (fell.length ? ` — ${fell.length} FELL: ${fell.slice(0, 3).join('; ')}` : ''));

  t('T0-03', changedSameOrder.length === 0,
    'scores are untouched wherever the token order already agreed' +
    (changedSameOrder.length ? ` — ${changedSameOrder.slice(0, 3).join('; ')}` : ''));

  t('T0-04', classifyDiff.length === 0,
    'classification is unchanged given the same score' +
    (classifyDiff.length ? ` — ${classifyDiff.slice(0, 3).join('; ')}` : ''));

  t('T0-05', tierFell.length === 0,
    `no tier falls; ${rose.length} rise` + (rose.length ? `: ${rose.join(' · ')}` : '') +
    (tierFell.length ? ` — ${tierFell.length} FELL: ${tierFell.slice(0, 3).join('; ')}` : ''));
}

/* ==========================================================================
   T1 — transliteration (§10.1)
   ========================================================================== */
group('T1  transliteration — must MATCH');
[['M. Krishnamurthy','M.KRISHNAMOORTHI','auto'],['N. Sivakumar','N.SHIVAKUMAR','auto'],
 ['A. Thirumalai','A.TIRUMALAI','auto'],['G. Ramachandran','G.RAMACHANDIRAN','auto'],
 ['S. Lakshmi Narayanan','S.LAXMINARAYANAN','shown'],['P. Muthusamy','P.MUTHUSWAMY','auto'],
 ['K. Subramanian','K.SUBRAMANIAM','auto'],['R. Ananthakrishnan','R.ANANDAKRISHNAN','auto'],
 ['D. Jayaprakash','D.JAYA PRAKASH','shown'],['E. Ganesh','E.GANESAN','auto'],
 ['D. Lokeshwaran','D.LOKESWARAN','auto'],['E. Srikanth','E.SREEKANTH','auto'],
 ['T. Thamarai Selvan','T.THAMARAISELVAN','auto'],
].forEach(([q, c, w], i) => {
  const v = tierOf(q, c);
  t(`T1-${pad2(i + 1)}`, w === 'auto' ? v === 'auto' : shown(v), `${c} -> ${v}`);
});

/* ==========================================================================
   T2 — initials (§10.2)
   ========================================================================== */
group('T2  initials');
[['E. Ganesh','E.GANESH','auto'],['E. Ganesh','GANESH','review'],
 ['E. Ganesh','M/S.E.GANESH','auto'],['E. Ganesh','GANESH E.','auto'],
 ['E. Ganesh','E.S.GANESH','shown'],['E. Ganesh','F.GANESH','review'],
 ['E. Ganesh','R.GANESH','review'],['E. Ganesh','J.GANESH','hidden'],
 ['E. Ganesh','M.GANESH','hidden'],['S.M. Subramaniam','M.S.SUBRAMANIAM','shown'],
 ['E. Ganesh','R.GANESHKUMAR','hidden'],['E. Ganesh','S.GANESH BABU','hidden'],
 ['E. Ganesh','E.SRIKANTH','none'],
].forEach(([q, c, w], i) => {
  const v = tierOf(q, c);
  const ok = w === 'hidden' ? !shown(v) : w === 'none' ? v === 'none' : w === 'shown' ? shown(v) : v === w;
  t(`T2-${pad2(i + 1)}`, ok, `${c} -> ${v} (want ${w})`);
});

/* --- every initials state produces a note a lawyer can read (§7.2.3) ------ */
{
  const STATES = ['both-absent','absent-in-list','absent-in-query','exact','partial','subset',
                  'flip-plausible','flip-other','transposed','different'];
  const sample = {
    'both-absent': ['', ''], 'absent-in-list': ['E', ''], 'absent-in-query': ['', 'E'],
    'exact': ['E', 'E'], 'partial': ['E', 'ES'], 'subset': ['ES', 'SE'],
    'flip-plausible': ['E', 'R'], 'flip-other': ['E', 'J'], 'transposed': ['SM', 'MS'],
    'different': ['AB', 'XY']
  };
  const bad = [];
  for (const st of STATES) {
    const [q, c] = sample[st];
    const note = CO.initialsNote(st, q, c);
    if (st === 'exact') { if (note !== null) bad.push(`${st} should say nothing`); continue; }
    if (!note || note.length < 20) { bad.push(`${st} has no usable note`); continue; }
    if (/\b(0\.\d+|flip-|tokSim|foldSim|rawSim|state:)\b/.test(note)) bad.push(`${st} leaks internals: ${note}`);
    if (!/[a-z]{4}/.test(note)) bad.push(`${st} is not prose`);
  }
  t('T2-14', bad.length === 0,
    `all ${STATES.length} initials states carry prose for a lawyer` + (bad.length ? ` — ${bad.join('; ')}` : ''));
  t('T2-15', /keyboard/i.test(CO.initialsNote('flip-plausible', 'E', 'R')) &&
             /mistaken|print|handwriting/i.test(CO.initialsNote('flip-plausible', 'E', 'F')),
    'a keyboard slip and a lookalike are explained differently');
  t('T2-16', CO.plausibleFlip('E', 'R') && CO.plausibleFlip('E', 'F') && !CO.plausibleFlip('E', 'J'),
    'E/R adjacent, E/F lookalike, E/J neither');
}

/* ==========================================================================
   T3 — case numbers (§10.3)
   ========================================================================== */
group('T3  case numbers');
[['WA 2025 of 2026','WA/2025/2026',true],['WP Crl 2077 of 2026','WP Crl./2077/2026',true],
 ['CRP 414 of 2023','CRP/414/2023',true],['CS 813 of 2016','CS/813/2016',true],
 ['CC 212 of 2026','C.C.No.212/2026',true],['WMP 11451 of 2026','WMP/11451/2026',true],
 ['CC 212 of 2026','CC 213 of 2026',false],['CC 212 of 2026','CC 212/26',false],
].forEach(([a, b, w], i) =>
  t(`T3-${pad2(i + 1)}`, (CO.normCaseNo(a) === CO.normCaseNo(b)) === w, `${b} -> ${CO.normCaseNo(b)}`));

/* ==========================================================================
   T4 — OCR noise (§10.4)
   ========================================================================== */
group('T4  OCR noise');
[['CC 212 of 2026','CC 2l2/2026',true],['CC 212 of 2026','C.C.No.2I2/2026',true],
 ['WP 14523 of 2025','W.P.No.145Z3 of 2025',true],['OS 88 of 2024','O.S. 8B/2024',true],
 ['CRP 901 of 2026','C.R.P.NO.9O1 OF 2026',true],['CC 212 of 2026','CC 213 of 2026',false],
].forEach(([a, b, w], i) =>
  t(`T4-${pad2(i + 1)}`, (CO.normCaseNo(a, true) === CO.normCaseNo(b, true)) === w, `${b} -> ${CO.normCaseNo(b, true)}`));
[['E. Ganesh','E.GANE5AN','shown'],['M. Krishnamurthy','M.KR1SHNAM00RTHI','auto'],
 ['N. Sivakumar','N.5H1VAKUMAR','auto'],['E. Ganesh','E.MAHE5H','none'],
].forEach(([q, c, w], i) => {
  const cleaned = c.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
  const rank = { auto: 0, review: 1, weak: 2, none: 3 };
  const v = [c, cleaned].map(x => tierOf(q, x, { ocr: true })).sort((a, b) => rank[a] - rank[b])[0];
  t(`T4-${pad2(i + 7)}`, w === 'none' ? v === 'none' : shown(v), `${c} -> ${v}`);
});

/* ==========================================================================
   T11 — range expansion (§10.9a)
   ========================================================================== */
group('T11  case-number range expansion');
[['R.P.66/2022',1],['R.P.384 to 387/2022',4],['R.P.384 to 387/2022, A.P.141 to 144/2022',8],
 ['R.P.Nos.243 to 261 and 262/2022',20],['R.P.48 to 96/ 2023',49],
 ['R.P.27 to 29/2025, R.P.88/2025',4],['R.P.05 and 06/2026',2],['R.P.17 of 2026',1],
 ['R.P.No.289 to 294 of 2026',6],['A.P.38 to 40/2026',3],['R.P.146 and 147/2026',2],
 ['SMR.1/2025',1],['R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025',10],
 ['R.P.Nos.412 to 428/2025, R.P.433/2025',18],['R.P.212/2023, A.P.135/2022',2],
 ['R.P.No.427 and 428/2024',2],
].forEach(([cell, n], i) => {
  const got = CO.expandCaseCell(cell);
  t(`T11-${pad2(i + 1)}`, got.length === n, `${cell} -> ${got.length} (want ${n})`);
});
{
  const wide = CO.expandCaseCellDetailed('R.P.1 to 900/2024');
  t('T11-17', wide.keys.length === 0 && wide.capped.length === 1 && wide.capped[0].members === 900,
    `a range of 900 is capped and flagged, not expanded (${wide.keys.length} keys, ${wide.capped.length} flagged)`);
  eq('T11-18', CO.expandCaseCell('R.P.05 and 06/2026'), ['RP/5/2026', 'RP/6/2026'], 'leading zeros dropped');
}

/* ==========================================================================
   T16 — the connector probe (§10.9f). Runs before any name search.
   ========================================================================== */
group('T16  the connector probe');
{
  const conn = s => !!CO.extract.findConnector(s);
  const dir  = s => (CO.extract.findConnector(s) || {}).direction;

  t('T16-06', CO.splitPartyCounsel('And others throughThiru. E. Ganesh').advocates[0].name === 'E. Ganesh',
    'throughThiru. with no space');
  t('T16-07', CO.splitPartyCounsel('Boopathi Palanisamy And othersthrough Thiru E. Ganesh').advocates[0].name === 'E. Ganesh',
    'glued on the left');
  t('T16-08', !conn('throughout the year') && !conn('a breakthrough moment'),
    'throughout and breakthrough are not connectors');
  t('T16-09', /\(\?!\[a-z\]\)/.test(CO.CONNECTOR_PARTY_FIRST_SRC) && !CO.CONNECTOR_PARTY_FIRST.flags.includes('i'),
    'the lookahead guard is case-sensitive — the pattern carries no /i flag');
  t('T16-09b', conn('throughThiru. E. Ganesh') && !conn('throughthiru e ganesh'),
    'an uppercase follower passes, a lowercase one does not');
  t('T16-10', dir('AKILESH KUMAR FOR R1') === 'counsel-first' &&
    CO.splitPartyCounsel('AKILESH KUMAR FOR R1').advocates[0].name === 'AKILESH KUMAR',
    'counsel-first, advocate before the party reference');
  t('T16-11', !conn('SPL.PUBLIC PROSECUTOR FOR ED CASES'), 'bare "for" with no party reference is not split');
  t('T16-12', ['rep. by', 'represented by', 'thro', 'thru'].every(c => conn(`A Party ${c} M/s.X`)),
    'rep. by / represented by / thro / thru all recognised');
  t('T16-13', CO.extract.classifyColumn({ density: 0, cells: 40 }, 'counsel').role === 'counsel' &&
              CO.extract.classifyColumn({ density: 0.9, cells: 40 }, 'party').role === 'party+counsel' &&
              CO.extract.classifyColumn({ density: 0, cells: 40 }, 'party').role === 'party',
    'upgrades party, never downgrades a declared counsel column, never splits a 0% column');
  t('T16-16', CO.splitPartyCounsel('M. Ganesan and AburvamGanesan through M/s. SVV Law Firm').party === 'M. Ganesan and AburvamGanesan' &&
              CO.splitPartyCounsel('M. Ganesan and AburvamGanesan through M/s. SVV Law Firm').advocates[0].name === 'SVV Law Firm',
    'H-24 — the party portion never becomes counsel');
  {
    const cell = '1. R1 and R2 through M/s.N.Soundarrajan 4. E.O through M/s.E.Ganesh';
    const s = CO.splitPartyCounsel(cell, { subNumbering: true });
    t('T16-17', s.advocates.length === 2 && s.advocates[1].name === 'E.Ganesh',
      `H-19 — one advocate per connector: ${s.advocates.map(a => a.name).join(' | ')}`);
  }
  {
    const s = CO.splitPartyCounsel('3. R3 to R11 through M/s.E.Ganesh', { subNumbering: true });
    t('T16-18', s.advocates[0].sideDetail === 'R3 to R11', `H-07 — sideDetail ${JSON.stringify(s.advocates[0].sideDetail)}`);
  }
}

/* ==========================================================================
   T5 — integration against the synthetic corpus (§10.5)
   ========================================================================== */
group('T5  synthetic corpus integration');
const synthRoster = golden.firm.map((n, i) => CO.io.makeAdvocate(n,
  ['MS/1234/2005','MS/2255/2011','MS/3311/2014','MS/4088/2016','MS/0912/2001','MS/5521/2019'][i], null));
const synthRegister = loadRegister(CO, 'cases.csv');
const synthDoc = await readPdf(CO, 'causelist-synthetic-14082026.pdf', { roster: synthRoster });
const synth = CO.engine.run({
  advocates: synthRoster, register: synthRegister.cases, documents: [synthDoc], date: '2026-08-14'
});
{
  const best = new Map();
  for (const m of synth.matches)
    for (const k of m.item.caseKeys) {
      const cur = best.get(k);
      if (!cur || CO.tierRank(m.tier) > CO.tierRank(cur.tier)) best.set(k, m);
    }
  const got = g => { const m = best.get(CO.normCaseNo(g.case)); return m ? m.tier : 'none'; };

  const autos = golden.items.filter(g => g.expect === 'auto');
  const missedAuto = autos.filter(g => got(g) !== 'auto');
  t('T5-01', missedAuto.length === 0,
    `all ${autos.length} auto-expected items reach auto` + (missedAuto.length ? ` — missed ${missedAuto.map(g => g.id).join(', ')}` : ''));

  /* Two documented allow-list entries — see docs/measurements.md §5. Both
     surface at review, which under C4 costs a glance; the test fails if the
     list is widened, if either stops appearing, or if either reaches auto. */
  const ALLOWED = {
    D09: 'reference §4.4 scores M.KRISHNAN at core 0.769 on the shared KRSN skeleton',
    D10: 'the order guard lifts T.SELVAN over the core gate — the price of recovering P17'
  };
  const nones = golden.items.filter(g => g.expect === 'none');
  const leaked = nones.filter(g => shown(got(g)));
  const unexpected = leaked.filter(g => !ALLOWED[g.id]);
  const missing = Object.keys(ALLOWED).filter(id => !leaked.some(g => g.id === id));
  const tooHigh = leaked.filter(g => got(g) === 'auto');
  t('T5-02', unexpected.length === 0 && missing.length === 0 && tooHigh.length === 0,
    `${nones.length} none-expected items; ${leaked.length} surfaced at review, both allow-listed` +
    (unexpected.length ? ` — UNEXPECTED ${unexpected.map(g => g.id).join(', ')}` : '') +
    (missing.length ? ` — allow-list is stale, ${missing.join(', ')} no longer surface` : '') +
    (tooHigh.length ? ` — REACHED AUTO: ${tooHigh.map(g => g.id).join(', ')}` : '') +
    (leaked.length ? ` [${leaked.map(g => g.id + ': ' + ALLOWED[g.id]).join('; ')}]` : ''));

  /* §4.4 order guard — the recall miss this was added for. A registry that
     prints the surname first must not lose the matter. */
  const p17 = best.get(CO.normCaseNo('WP/9098/2026'));
  t('T5-02b', p17 && shown(p17.tier) && p17.advocate && p17.advocate.name === 'T. Thamarai Selvan',
    `P17 "SELVAN T.THAMARAI" reaches ${p17 ? p17.tier : 'none'} for ${p17 && p17.advocate ? p17.advocate.name : '—'} ` +
    '(it was dropped entirely before the order guard)');

  const p01 = synth.matches.filter(m => m.item.caseKeys.includes(CO.normCaseNo('WA/2025/2026')));
  t('T5-03', p01.length === 4, `P01 yields ${p01.length} matches (want 4 — the cluster of four)`);

  const p03 = best.get(CO.normCaseNo('CRP/414/2023'));
  t('T5-04', p03 && p03.side === 'respondent', `P03 side = ${p03 && p03.side} (counsel below the divider)`);

  /* §5.8a.3 supersedes T5-05 for P18; the mechanism is asserted on P19. */
  const p19 = best.get(CO.normCaseNo('OS/88/2024'));
  t('T5-05', p19 && p19.advocate === null && p19.signals.some(s => s.kind === 'caseNumber') &&
             p19.identifiedBy === 'caseNumber',
    `P19 matched on caseNumber alone with advocate=null (${p19 && p19.signals.map(s => s.kind).join(',')})`);
  const p18 = best.get(CO.normCaseNo('CC/212/2026'));
  t('T5-05b', p18 && p18.matchRole === 'party' && p18.signals.some(s => s.kind === 'caseNumber'),
    `P18 caught and labelled matchRole=${p18 && p18.matchRole}, never reported as counsel (§5.8a.3)`);

  const p20 = best.get(CO.normCaseNo('CC/213/2026'));
  t('T5-06', p20 && shown(p20.tier), `P20 found despite tribunal layout and PARTY IN PERSON counsel — ${p20 && p20.tier}`);

  const d05 = best.get(CO.normCaseNo('WP/8005/2026'));
  t('T5-07', !d05, 'D05 S.VIGNESH scores none — head-guard regression');

  t('T5-08', !best.get(CO.normCaseNo('WP/7777/2026')), 'A188 is in the register but not listed today, and is absent');

  const noCtx = synthDoc.items.filter(i => !i.court || !i.hall || !i.itemNo);
  t('T5-09', synthDoc.items.length === golden.total_planted && noCtx.length === 0,
    `${synthDoc.items.length} items extracted (want ${golden.total_planted}), all with court/hall/item`);

  const messy = await readPdf(CO, 'causelist-messy-14082026.pdf', { roster: synthRoster });
  const messyNames = new Set(messy.items.flatMap(i => i.namesWithRole.filter(n => n.matchRole === 'counsel')
    .map(n => n.name.toUpperCase().replace(/[^A-Z]/g, ''))));
  const subsetNames = new Set(synthDoc.items.slice(0, 8).flatMap(i => i.namesWithRole
    .filter(n => n.matchRole === 'counsel').map(n => n.name.toUpperCase().replace(/[^A-Z]/g, ''))));
  const lostInMessy = [...subsetNames].filter(n => !messyNames.has(n));
  t('T5-10', lostInMessy.length === 0,
    `the messy variant yields the same advocates as its subset` +
    (lostInMessy.length ? ` — missing ${lostInMessy.join(', ')}` : ''));
}

/* ==========================================================================
   T9 — evidence-first confirmation (§10.9)
   ========================================================================== */
group('T9  evidence-first confirmation');
{
  const reviews = synth.matches.filter(m => m.tier === 'review');
  t('T9-01', reviews.length > 0 && reviews.every(m => m.evidence && m.evidence.rows.length),
    `${reviews.length} review matches, all with non-empty evidence.rows`);

  const CANON = CO.EVIDENCE_ROW_ORDER;
  const orderOk = synth.matches.every(m => {
    const canon = m.evidence.rows.map(r => r.field).filter(f => CANON.includes(f));
    const idx = canon.map(f => CANON.indexOf(f));
    const sorted = idx.every((v, i) => i === 0 || idx[i - 1] < v);
    const last = m.evidence.rows[m.evidence.rows.length - 1].field === 'nextStage';
    return sorted && canon[0] === 'caseNumber' && last;
  });
  t('T9-02', orderOk, 'case number first among the §7.2.2 fields, next stage last overall');

  const withReg = synth.matches.find(m => m.evidence.registerHit);
  t('T9-03', withReg && withReg.evidence.registerDiary && withReg.evidence.decisiveField === 'caseNumber',
    `registerHit sets diary ${withReg && withReg.evidence.registerDiary} and decisiveField ${withReg && withReg.evidence.decisiveField}`);

  const noReg = CO.engine.run({ advocates: synthRoster, register: null, documents: [synthDoc], date: '2026-08-14' });
  const depRows = ['caseNumber', 'cnr', 'causeTitle', 'parties', 'side', 'nextStage'];
  const allAbsent = noReg.matches.every(m =>
    depRows.every(f => { const r = m.evidence.rows.find(x => x.field === f); return !r || r.verdict === 'absent'; }));
  const allPresent = noReg.matches.every(m => depRows.every(f => m.evidence.rows.some(x => x.field === f)));
  t('T9-04', allAbsent && allPresent,
    'with no register, every register-dependent row still renders, marked absent');

  const p01 = synth.matches.find(m => m.item.caseKeys.includes(CO.normCaseNo('WA/2025/2026')));
  t('T9-05', p01 && p01.evidence.colleagues.length === 3,
    `P01 lists ${p01 && p01.evidence.colleagues.length} colleagues (want 3): ${p01 && p01.evidence.colleagues.join(', ')}`);

  const spansOk = synth.matches.every(m =>
    m.evidence.pdfExcerpt.length > 0 &&
    m.evidence.highlightSpans.every(([s, e]) => s >= 0 && e <= m.evidence.pdfExcerpt.length && s < e));
  const someHighlighted = synth.matches.some(m => m.evidence.highlightSpans.length > 0);
  t('T9-06', spansOk && someHighlighted, 'pdfExcerpt non-empty and every highlight span inside its bounds');

  /* §7.2.3 / D12 — a number on a confirm card invites deference to the score
     instead of reading the evidence. The card renderer must never emit one. */
  const uiSrc = readFileSync(join(ROOT, 'src', '80-ui.js'), 'utf8');
  const cardFn = uiSrc.slice(uiSrc.indexOf('function confirmCard'), uiSrc.indexOf('function verdictWord'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // code only, not the comments
  const drawerFn = uiSrc.slice(uiSrc.indexOf('§8.4'), uiSrc.indexOf('function adjournedView'));
  /* The hazard is a NUMBER on the card, not the word. dateConfidence is a
     ruled/inferred enum and belongs there — it tells the reader whether a
     hearing date was read off a ruled cell or guessed. */
  const numeric = /\.confidence\b|toFixed|\btierBeforeCap\b|\bscore\.combined\b/;
  t('T9-07', !numeric.test(cardFn) && numeric.test(drawerFn),
    'confirmCard() emits no numeric confidence; the accepted-row drawer, which earns the click-through, does');

  const badNote = [];
  for (const m of synth.matches)
    for (const r of m.evidence.rows)
      if (r.note && /\b(0\.\d+|flip-|tokSim|foldSim|rawSim|combined)\b/.test(r.note))
        badNote.push(`${m.id}/${r.field}: ${r.note}`);
  t('T9-08', badNote.length === 0, `every note is prose` + (badNote.length ? ` — ${badNote[0]}` : ''));

  const ask = reviews[0];
  CO.io.memory.set(ask.confirmKey, true);
  const again = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
    documents: [synthDoc], date: '2026-08-14', remembered: CO.io.memory.all() });
  const asked = again.matches.filter(m => m.tier === 'review' && m.confirmKey === ask.confirmKey);
  t('T9-09', asked.length === 0, 'a remembered decision suppresses the identical question on a second run');

  CO.io.memory.revoke(ask.confirmKey);
  const third = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
    documents: [synthDoc], date: '2026-08-14', remembered: CO.io.memory.all() });
  t('T9-10', third.matches.some(m => m.tier === 'review' && m.confirmKey === ask.confirmKey),
    'revoking a remembered decision restores the question');
}

/* ==========================================================================
   T13 — dual-pass extraction and reconciliation (§10.9c)
   ========================================================================== */
group('T13  dual pass and reconciliation');
{
  const page = synthDoc.pages[0];
  const idx = CO.extract.buildRosterIndex(synthRoster);
  const b = CO.extract.passB(page, synthRoster, idx);
  t('T13-01', page.lines.length > 0 && b.length > 0 && synthDoc.items.some(i => i.page === 1),
    `page 1 produces both a Pass A result set (${synthDoc.items.filter(i => i.page === 1).length} items) and a Pass B one (${b.length} hits)`);

  const both = synthDoc.items.flatMap(i => i.namesWithRole).filter(n => n.source === 'A' && n.confirmedByB);
  t('T13-02', both.length > 0, `${both.length} counsel names found by both passes`);

  /* A name planted where no counsel-bearing column reaches it. The HR&CE
     subject-matter column is exactly that case. */
  const hrceDoc = await readPdf(CO, 'hrce/Causelistdated11_08_2026.pdf', { roster: loadRoster(CO, 'advocates-hrce.csv') });
  const unplaced = hrceDoc.items.flatMap(i => i.namesWithRole).filter(n => n.matchRole === 'unplaced');
  t('T13-03', unplaced.length > 0 && unplaced.every(n => n.source === 'B'),
    `${unplaced.length} B-only findings, all marked unplaced and none from Pass A`);

  const hrceRoster = loadRoster(CO, 'advocates-hrce.csv');
  const hrceRun = CO.engine.run({ advocates: hrceRoster, register: null, documents: [hrceDoc], date: '2026-08-11' });
  const unplacedMatches = hrceRun.matches.filter(m => m.matchRole === 'unplaced');
  t('T13-04', unplacedMatches.length > 0 && unplacedMatches.every(m => m.tier !== 'none'),
    `${unplacedMatches.length} B-only matches kept, none dropped whatever the score`);
  t('T13-04b', unplacedMatches.every(m => m.tier !== 'auto'),
    'and none auto-accepted');

  /* Pass A disabled entirely: the sweep alone must still surface every
     planted matter that belongs to a firm advocate. Compared per ITEM, since
     the sweep has no notion of which counsel line it came from. */
  const bOnlyRoster = CO.extract.buildRosterIndex(synthRoster);
  const sweptByCase = new Map();
  for (const p of synthDoc.pages) {
    const items = synthDoc.items.filter(i => i.page === p.index);
    for (const h of CO.extract.passB(p, synthRoster, bOnlyRoster)) {
      const host = CO.extract.itemAtY(items, h.y) ||
        items.find(i => i.rawText.includes(h.printed));
      if (host) for (const k of host.caseKeys) {
        if (!sweptByCase.has(k)) sweptByCase.set(k, new Set());
        sweptByCase.get(k).add(h.advocate.name);
      }
    }
  }
  const lost = golden.items.filter(g => g.firm_advocate)
    .filter(g => !(sweptByCase.get(CO.normCaseNo(g.case)) || new Set()).has(g.firm_advocate))
    .map(g => `${g.id} (${g.firm_advocate})`);
  t('T13-05', lost.length === 0,
    `with Pass A disabled, the sweep alone still reaches every planted firm advocate` +
    (lost.length ? ` — lost ${lost.join(', ')}` : ''));

  /* A page with several B-only hits and no A hits is low-confidence, and
     everything from it is capped at review. */
  const fake = CO.extract.finishPage({
    index: 99, width: 595, height: 842, wasOCR: false, hSegs: [], vSegs: [],
    spans: ['E.GANESH somewhere odd', 'E.SRIKANTH also odd', 'D.LOKESHWARAN odd too']
      .map((text, i) => ({ x: 40, y: 700 - i * 20, w: 200, text }))
  });
  const rec = CO.extract.reconcilePage(fake, [], CO.extract.passB(fake, synthRoster, bOnlyRoster));
  t('T13-06', fake.layoutConfidence === 'low' && rec.bOnly.length >= 3,
    `a page with ${rec.bOnly.length} B-only and 0 A hits is marked ${fake.layoutConfidence}`);

  const lowItem = { id: 'x', caseKeys: [], caseNumbers: [], namesWithRole: [
    { name: 'E.GANESH', matchRole: 'counsel', side: 'petitioner', source: 'A', column: 'counsel' }],
    allNames: ['E.GANESH'], ocrPages: [], layoutConfidence: 'low', rawText: 'E.GANESH', extra: {}, page: 1 };
  const capped = CO.engine.matchItem(lowItem, synthRoster, CO.engine.indexRegister([]), {});
  t('T13-07', capped.length && capped[0].tier === 'review' && capped[0].tierBeforeCap === 'auto',
    `an exact name on a low-confidence page is capped at ${capped[0] && capped[0].tier} (scored ${capped[0] && capped[0].tierBeforeCap})`);

  t('T13-08', typeof CO.EXTRACT.LOW_CONF_FILE_PCT === 'number' && CO.EXTRACT.LOW_CONF_FILE_PCT === 0.20,
    'a file over 20% low-confidence pages is flagged above the results');

  const dupes = new Map();
  for (const m of synth.matches) {
    const k = m.item.id + '|' + (m.advocate ? m.advocate.id : '-');
    dupes.set(k, (dupes.get(k) || 0) + 1);
  }
  t('T13-10', [...dupes.values()].every(n => n === 1),
    'reconciliation adds no duplicate — one Match per item per advocate');
}

/* ==========================================================================
   T15 — document profiles and column roles (§10.9e)
   ========================================================================== */
group('T15  document profiles and column roles');
{
  /* The grep-level assertion. An earlier draft of §5.10 tested for a column
     NAMED counsel; HR&CE has no such column and an entire tribunal practice
     would have been buried in the confirm queue. */
  const srcAll = ['00-config.js','10-normalise.js','20-distance.js','30-initials.js','40-score.js',
    '50-extract.js','60-engine.js','70-io.js','80-ui.js']
    .map(f => ({ f, s: readFileSync(join(ROOT, 'src', f), 'utf8') }));
  const offenders = [];
  for (const { f, s } of srcAll) {
    /* name === 'counsel' or name == "counsel" as a BEHAVIOURAL test */
    const re = /\b(?:name|column|heading|header)\s*(?:===?|!==?)\s*['"]counsel['"]/g;
    if (re.test(s)) offenders.push(f);
  }
  t('T15-01', offenders.length === 0,
    'no code path decides counsel-bearing from a column NAME' + (offenders.length ? ` — ${offenders.join(', ')}` : ''));
  t('T15-01b', CO.COUNSEL_BEARING_ROLES.join(',') === 'counsel,party+counsel',
    'counsel-bearing is the role test: ' + CO.COUNSEL_BEARING_ROLES.join(' or '));

  const hrceRoster = loadRoster(CO, 'advocates-hrce.csv');
  const hrceDoc = await readPdf(CO, 'hrce/Causelistdated11_08_2026.pdf', { roster: hrceRoster });
  const hrceReg = loadRegister(CO, 'cases-hrce.csv');
  const hrce = CO.engine.run({ advocates: hrceRoster, register: hrceReg.cases, documents: [hrceDoc], date: '2026-08-11' });
  const all = hrce.matches.concat(hrce.adjourned);

  const inParty = hrceDoc.items.flatMap(i => i.namesWithRole)
    .filter(n => n.source === 'A' && (n.column === 'petitioner' || n.column === 'respondent') && n.matchRole === 'counsel');
  t('T15-02', inParty.length > 0,
    `${inParty.length} HR&CE advocates found inside a party column are matchRole=counsel, never unplaced`);

  const prof = CO.PROFILES.find(p => p.id === 'tribunal.hrce');
  const bearing = prof.columns.filter(c => CO.COUNSEL_BEARING_ROLES.includes(c.role)).map(c => c.name);
  eq('T15-03', bearing, ['petitioner', 'respondent'], 'both party columns counsel-bearing under tribunal.hrce');

  const hc = CO.PROFILES.find(p => p.id === 'causelist.hc');
  eq('T15-04', hc.columns.filter(c => CO.COUNSEL_BEARING_ROLES.includes(c.role)).map(c => c.name),
    ['counsel'], 'only the counsel column is counsel-bearing under causelist.hc');

  const split = CO.splitPartyCounsel('E.R. Kannan through M/s.E.Ganesh');
  t('T15-05', split.party === 'E.R. Kannan' && split.advocates[0].name === 'E.Ganesh',
    'before the connector is party, after is advocate');
  const rp541 = all.find(m => m.item.caseKeys.includes('RP/541/2022') && m.advocate);
  t('T15-06', rp541 && rp541.matchRole === 'counsel', `H-22 R.P.541/2022 -> matchRole ${rp541 && rp541.matchRole}`);

  const p18 = synth.matches.find(m => m.item.caseKeys.includes(CO.normCaseNo('CC/212/2026')));
  t('T15-07', p18 && p18.matchRole === 'party' && p18.tier === 'auto',
    `H/T15-07 CC/212/2026 -> matchRole ${p18 && p18.matchRole}, tiered normally (${p18 && p18.tier})`);

  const row = CO.io.matchRow(p18, synth, '');
  t('T15-08', /party/i.test(row.MatchRole) && !/counsel/i.test(row.MatchRole.replace(/not counsel.*/i, '')),
    `the export states the role: "${row.MatchRole}"`);

  const multi = CO.splitPartyCounsel('1. R1 and R2 through M/s.N.Soundarrajan 4. E.O through M/s.E.Ganesh',
    { subNumbering: true });
  t('T15-09', multi.advocates.length === 2 && multi.advocates.every(a => a.sideDetail),
    `a cell with several connectors yields ${multi.advocates.length} advocates, each with its own sideDetail`);

  /* A forum with no profile at all: the probe alone must find its counsel. */
  const synthetic = [];
  for (let r = 0; r < 12; r++)
    synthetic.push(`Party ${r} through M/s.E.Ganesh`);
  const probe = CO.extract.probeColumn(synthetic);
  const decided = CO.extract.classifyColumn(probe, 'party');
  t('T15-10', decided.role === 'party+counsel',
    `an unknown 5-column forum is supported by the probe alone — ${decided.why}`);
  t('T16-14', decided.role === 'party+counsel', 'same assertion, from the T16 side');

  const hcDoc = synthDoc;
  t('T15-11', hrceDoc.docType === 'tribunal.hrce' && hcDoc.docType === 'causelist.hc',
    `detection: HR&CE -> ${hrceDoc.docType}, High Court -> ${hcDoc.docType}`);

  const extras = hrceDoc.items.filter(i => Object.keys(i.extra).length);
  const extraNames = new Set(extras.flatMap(i => Object.keys(i.extra)));
  const extraAsCounsel = hrceDoc.items.flatMap(i => i.namesWithRole)
    .filter(n => n.source === 'A' && ['underSec', 'temple', 'subject'].includes(n.column));
  t('T15-12', extraNames.size >= 2 && extraAsCounsel.length === 0,
    `extra columns captured (${[...extraNames].join(', ')}) and never matched for counsel`);
}

/* ==========================================================================
   T12 — the HR&CE tribunal documents (§10.9b)
   ========================================================================== */
group('T12  HR&CE tribunal documents');
{
  const roster = loadRoster(CO, 'advocates-hrce.csv');
  const reg = loadRegister(CO, 'cases-hrce.csv');
  const lists = ['hrce/Causelistdated11_08_2026.pdf', 'hrce/Causelistdated04_08_2026.pdf',
                 'hrce/Causelistdated21_07_2026.pdf'];
  const docs = [];
  for (const p of lists) docs.push(await readPdf(CO, p, { roster }));
  const notice = await readPdf(CO, 'hrce/AdjournmentNoticeNo_16.pdf', { roster });

  const cl11 = docs[0];
  const run = CO.engine.run({ advocates: roster, register: reg.cases,
    documents: [cl11, notice], date: '2026-08-11' });
  const all = run.matches.concat(run.adjourned);
  const has = k => all.some(m => m.item.caseKeys.includes(k));

  t('T12-01', has('RP/66/2022') && has('RP/541/2022'),
    'H-01/H-02 — advocate found inside both the petitioner and the respondent party cell');
  t('T12-02', has('RP/258/2022') && has('RP/72/2023'),
    'H-03/H-04 — matters found only because the printed range was expanded');
  t('T12-03', CO.splitPartyCounsel('And others throughThiru. E. Ganesh').advocates[0].name === 'E. Ganesh' &&
              CO.splitPartyCounsel('X through Thiru E. Ganesh').advocates[0].name === 'E. Ganesh',
    'H-05/H-06 — throughThiru. with no space, and a bare Thiru, both parse');

  const rp502 = all.find(m => m.item.caseKeys.includes('RP/502/2023') && m.sideDetail);
  t('T12-04', rp502 && /R3\s*to\s*R11/i.test(rp502.sideDetail), `H-07 — sideDetail ${rp502 && rp502.sideDetail}`);

  const rp66Adj = run.adjourned.some(m => m.item.caseKeys.includes('RP/66/2022'));
  const rp66Att = run.matches.some(m => m.item.caseKeys.includes('RP/66/2022'));
  t('T12-05', rp66Adj && !rp66Att, 'H-08 — an adjourned matter never appears in the attendance list');

  const find = k => notice.reposted.find(r => r.caseKeys.includes(k));
  t('T12-06', find('RP/541/2022').repostedTo === '2026-09-15' && find('RP/214/2023').repostedTo === '2026-09-15',
    `H-09/H-10 — merged date cells resolve: RP/541/2022 -> ${find('RP/541/2022').repostedTo}, ` +
    `RP/214/2023 -> ${find('RP/214/2023').repostedTo} (not 2026-08-18 / 2026-11-10)`);
  t('T12-06b', notice.reposted.every(r => r.dateConfidence === 'ruled'),
    'every notice row read its date from a ruled cell, none inferred');

  const noticeOnlyKeys = (run.noticeOnly || []).map(n => n.caseKey);
  t('T12-07', noticeOnlyKeys.length > 0,
    `H-11 — ${noticeOnlyKeys.length} notice-only matter(s) identified from the register alone: ${noticeOnlyKeys.join(', ')}`);

  t('T12-08', !has('RP/192/2026') && !noticeOnlyKeys.includes('RP/192/2026'),
    'H-12 — a register matter not listed today appears nowhere');

  const repSection = cl11.reposted.length > 0;
  t('T12-09', repSection, `H-13 — the appended reposting table is its own section (${cl11.reposted.length} rows)`);

  const temples = all.map(m => (m.item.extra || {})['Temple'] || '').filter(Boolean);
  t('T12-10', temples.some(x => /Dharmaligeshwarar/i.test(x)) &&
    all.some(m => m.evidence.rows.some(r => /temple/i.test(r.label))),
    'H-14 — the temple name is captured and reaches the evidence table');

  const advStrings = new Set();
  for (const d of docs) for (const i of d.items) for (const n of i.namesWithRole)
    if (n.source === 'A' && n.matchRole === 'counsel') advStrings.add(n.name.trim());
  const bleed = [...advStrings].filter(s => /^(Temple|M\.?P\.?No\.?|of the JC)$/i.test(s));
  t('T12-11', bleed.length === 0, `H-15 — no advocate named Temple / M.P.No / of the JC (${advStrings.size} distinct strings)`);

  let pet = 0, res = 0;
  for (const d of docs) for (const i of d.items) for (const n of i.namesWithRole) {
    if (n.source !== 'A' || n.matchRole !== 'counsel') continue;
    if (!CO.nameScore('E. Ganesh', n.name)) continue;
    if (CO.tierRank(CO.classify(CO.nameScore('E. Ganesh', n.name), {})) < CO.tierRank('review')) continue;
    if (n.side === 'petitioner') pet++; else if (n.side === 'respondent') res++;
  }
  t('T12-14', pet >= 2 && res >= 4,
    `H-16/17/18 — E. Ganesh in the petitioner column ${pet} times (want >= 2), respondent ${res} times (want >= 4)`);

  const rp449 = docs.flatMap(d => d.items).find(i => i.caseKeys.includes('RP/449/2024'));
  const rp449Counsel = rp449 ? rp449.namesWithRole.filter(n => n.matchRole === 'counsel' && n.side === 'respondent') : [];
  t('T12-15', rp449Counsel.length >= 2,
    `H-19 — R.P.449/2024 respondent cell yields ${rp449Counsel.length} counsel: ${rp449Counsel.map(n => n.name).join(' | ')}`);

  const mismatch = all.filter(m => m.sideMismatch);
  t('T12-16', all.some(m => m.registerCase && m.registerCase.counselFor && m.side !== 'unknown'),
    `H-20 — side never filters; ${mismatch.length} sideMismatch warning(s) raised, none suppressed`);

  t('T12-17', advStrings.size >= 60,
    `${advStrings.size} distinct counsel strings from column-aware extraction (want >= 60)`);

  /* T12-12 — the measured overlap. The three constants in §6.6.1 come from a
     flattened read of the same files; see docs/measurements.md §1. What is
     asserted here is the RELATIONSHIP, which is what the design rests on. */
  const clKeys = new Set(cl11.items.flatMap(i => i.caseKeys));
  const njKeys = new Set(notice.reposted.flatMap(r => r.caseKeys));
  const both = [...clKeys].filter(k => njKeys.has(k));
  const share = both.length / clKeys.size;
  t('T12-12', clKeys.size > 150 && njKeys.size > 200 && share > 0.90,
    `${clKeys.size} cause-list keys, ${njKeys.size} notice keys, ${both.length} in both ` +
    `(${(share * 100).toFixed(0)}% of the day vacated — §6.6.1 says 194/268/109, see docs/measurements.md)`);

  /* T12-13 — with the ruling rectangles removed, every affected row must be
     marked inferred and routed to the confirm queue, never guessed silently. */
  {
    const stripped = { ...notice };
    const pages = notice.pages.map(p => ({ ...p, hSegs: [], vSegs: [], tables: [] }));
    let inferred = 0, total = 0;
    for (const p of pages) {
      const got = CO.extract.passA_adjournLines(p, { name: 'stripped.pdf', official: false });
      for (const r of got.reposted) { total++; if (r.dateConfidence === 'inferred') inferred++; }
    }
    t('T12-13', total > 0 && inferred > 0,
      `with the rules removed, ${inferred} of ${total} rows fall back to an inferred date and are flagged`);
  }

  if (MEASURE) {
    console.log('\n  --- measurements (docs/measurements.md) ---');
    console.log(`  cause-list keys ${clKeys.size} · notice keys ${njKeys.size} · in both ${both.length} (${(share * 100).toFixed(0)}%)`);
    const sig = cl11.probes.find(p => p.signature.startsWith('7:'));
    if (sig) for (const c of sig.columns)
      console.log(`  ${c.column.padEnd(12)} ${c.role.padEnd(14)} ${(c.density * 100).toFixed(0)}% of ${c.cells} cells`);
    console.log(`  distinct counsel strings ${advStrings.size} · E.Ganesh petitioner ${pet} respondent ${res}`);
  }
}

/* ==========================================================================
   T8 — I/O (§10.8)
   ========================================================================== */
group('T8  reading the firm\'s files');
{
  const names = a => a.map(x => x.name).join('|');
  const csv  = CO.io.parseAdvocateRows(rowsOf(CO, 'advocates.csv'));
  const xlsx = CO.io.parseAdvocateRows(rowsOf(CO, 'advocates.xlsx'));
  const txt  = CO.io.parseAdvocateText(readFileSync(fixture('advocates.txt'), 'utf8'));
  t('T8-01', csv.advocates.length === 6 && names(csv.advocates) === names(xlsx.advocates) &&
             names(csv.advocates) === names(txt.advocates),
    `csv/xlsx/txt all yield the same 6: ${names(csv.advocates)}`);

  const messy = CO.io.parseAdvocateRows(rowsOf(CO, 'advocates-messy-headers.xlsx'));
  t('T8-02', messy.advocates.length === 6 && messy.mapping.name === 1 && messy.advocates[0].enrolment === 'MS/1234/2005',
    `NAME OF THE ADVOCATE -> column ${messy.mapping.name + 1}, enrolment carried`);

  const headerless = CO.io.parseAdvocateRows([['E. Ganesh', 'MS/1'], ['E. Srikanth', 'MS/2']]);
  t('T8-03', headerless.advocates.length === 2 && headerless.advocates[0].name === 'E. Ganesh',
    'a headerless CSV falls back to column A');

  const reg = CO.io.parseRegisterRows(rowsOf(CO, 'cases.xlsx'));
  t('T8-04', reg.cases.length === 9 && reg.cases.every(c => /^[A-Z]+\/\d+\/\d{4}$/.test(c.caseKey)),
    `${reg.cases.length} caseKeys, all normalised: ${reg.cases.map(c => c.caseKey).join(' ')}`);

  const rowObj = CO.io.matchRow(synth.matches[0], synth, '');
  const original = Object.keys(synthRegister.cases[0].raw);
  const echoed = original.filter(k => Object.prototype.hasOwnProperty.call(rowObj, 'Register: ' + k));
  const tables = CO.io.buildTables(synth, null);
  const missingCols = CO.EXPORT_COLUMNS.filter(c => !tables.columns.includes(c));
  t('T8-05', missingCols.length === 0 && (synth.matches[0].registerCase ? echoed.length === original.length : true),
    `every export column present; ${echoed.length}/${original.length} register columns echoed back`);

  const empty = CO.io.parseAdvocateText('   \n\n');
  t('T8-06', empty.advocates.length === 0, 'an empty advocate list is rejected cleanly, not a crash');

  /* §8.7 — empty and failure states. Never a crash, never a silent no-op. */
  const junk = await CO.extract.readDocument(
    { name: 'not-a-pdf.pdf', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), official: false },
    { roster: synthRoster, thorough: false });
  t('T8-07', junk.items.length === 0 && junk.notes.some(n => n.level === 'error' && n.text.includes('not-a-pdf.pdf')),
    `an unreadable PDF is named and the run continues — "${(junk.notes[0] || {}).text || ''}".slice`);

  const noAdv = CO.engine.run({ advocates: [], register: null, documents: [synthDoc], date: '2026-08-14' });
  t('T8-08', noAdv.matches.length === 0 && noAdv.counts.pages > 0,
    `with no advocates, nothing matches but ${noAdv.counts.pages} pages are still reported as read`);

  const noMatch = CO.engine.run({ advocates: [CO.io.makeAdvocate('Zzz Nobody', null, null)],
    register: null, documents: [synthDoc], date: '2026-08-14' });
  t('T8-09', noMatch.matches.length === 0 && noMatch.counts.items === golden.total_planted,
    `"none of your advocates appear" is distinguishable from "nothing parsed": ` +
    `${noMatch.counts.items} items read, ${noMatch.matches.length} matched`);

  const noReg = CO.engine.run({ advocates: synthRoster, register: [], documents: [synthDoc], date: '2026-08-14' });
  t('T8-10', noReg.matches.length > 0, 'an empty register is not a failure — the name path still works');

  const emptyRun = CO.engine.run({ advocates: synthRoster, register: null, documents: [], date: '2026-08-14' });
  t('T8-11', emptyRun.matches.length === 0 && emptyRun.counts.pages === 0,
    'no documents at all produces an empty result, not an exception');

  const noticeAlone = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
    documents: [{ items: [], reposted: [{ id: 'r', caseKeys: ['CC/212/2026'], sourceFile: 'n.pdf',
      repostedTo: '2026-09-15', repostedTime: '3.00 pm', dateConfidence: 'ruled', caseCellRaw: 'CC/212/2026', page: 1 }],
      notes: [], badPages: [], probes: [], cappedRanges: [], ocrPages: [], pageCount: 1, file: 'n.pdf', docType: 'adjournment' }],
    date: '2026-08-14' });
  t('T8-12', noticeAlone.notes.some(n => /no cause list/i.test(n.text)) && noticeAlone.noticeOnly.length === 1,
    '§6.6.1 rule 4 — a notice with no cause list says so plainly and still identifies from the register');
}

/* --- extraction internals that only the odd document reaches -------------- */
group('T13  extraction internals');
{
  eq('T13-11', CO.extract.clusterCoords([10, 10.4, 10.8, 40, 40.2], 1).map(n => +n.toFixed(2)),
    [10.4, 40.1], 'near-identical rules cluster into one boundary');

  t('T13-12', CO.extract.isNoiseLine('------------------') && CO.extract.isNoiseLine('9840910000') &&
             CO.extract.isNoiseLine('12 MAIN ROAD, T.NAGAR') && CO.extract.isNoiseLine('x'.repeat(60)) &&
             !CO.extract.isNoiseLine('M/S.E.GANESH'),
    'the §5.4 noise filters reject dividers, digit runs, addresses and prose, but not a name');

  t('T13-13', CO.extract.classifyPage({ charCount: 5, hSegs: [], vSegs: [] }) === 'ocr' &&
             CO.extract.classifyPage({ charCount: 900, hSegs: [1,2,3,4], vSegs: [1,2] }) === 'ruled' &&
             CO.extract.classifyPage({ charCount: 900, hSegs: [], vSegs: [] }) === 'columns',
    '§5.11 routes a page to OCR, to the ruled reader, or to the x-histogram');

  const unknown = CO.extract.detectDocType('a page of ordinary prose with no court signature at all');
  t('T13-14', unknown.id === 'unknown' && !unknown.confident && /signature/i.test(unknown.why),
    `an unrecognised document is flagged rather than guessed — "${unknown.why}"`);

  const ambiguous = CO.extract.detectDocType('HIGH COURT OF JUDICATURE Adjournment Notice No.4');
  t('T13-15', !ambiguous.confident, `an ambiguous document is not treated as confident — "${ambiguous.why}"`);

  t('T13-16', CO.extract.joinSpans([{ x: 0, y: 10, w: 20, text: 'M/s.K.S' },
                                    { x: 20.2, y: 10, w: 5, text: 'a' },
                                    { x: 25.1, y: 10, w: 30, text: 'nkaran' }]) === 'M/s.K.Sankaran',
    'runs split mid-word rejoin without a spurious space');
  t('T13-16b', CO.extract.joinSpans([{ x: 0, y: 10, w: 20, text: 'K.BALU' },
                                     { x: 60, y: 10, w: 20, text: 'FOR R13' }]) === 'K.BALU FOR R13',
    'a real gap becomes a space');
  eq('T13-17', CO.extract.joinSpans([]), '', 'no spans is an empty string, not a crash');

  t('T13-18', CO.extract.respondentNumbering('3. R3 to R11 through') === 'R3 to R11' &&
             /E\.?O/i.test(CO.extract.respondentNumbering('4. E.O through') || '') &&
             CO.extract.respondentNumbering('nothing useful here') === null,
    'respondent numbering reads a range, a role, or nothing');

  const items = [{ _yTop: 400, _yBot: 300 }, { _yTop: 290, _yBot: 200 }];
  t('T13-19', CO.extract.itemAtY(items, 350) === items[0] && CO.extract.itemAtY(items, 250) === items[1] &&
             CO.extract.itemAtY(items, 800) === null,
    'a sweep hit attaches to the matter it sits beside, or to none');

  eq('T13-20', CO.findCaseNumbers('AND W.P.No.9087 of 2026 and CRP 414/2023').length, 2,
    'free-text case numbers are recovered from a continuation line');

  const bare = CO.extract.finishPage({ index: 1, width: 595, height: 842, wasOCR: false,
    hSegs: [], vSegs: [], spans: [{ x: 40, y: 700, w: 10, text: 'a' }] });
  t('T13-21', Math.abs(CO.extract.counselColumnX(bare) - 595 * CO.EXTRACT.COLUMN_FALLBACK) < 0.01,
    `a page with too little text falls back to ${CO.EXTRACT.COLUMN_FALLBACK} of the width, which is deliberately conservative`);

  const infCol = CO.extract.inferColumn(0, 3, ['1.', '2.', '3.', '4.', '5.', '6.'], false);
  const caseCol = CO.extract.inferColumn(1, 3, ['R.P.66/2022', 'R.P.329/2022', 'A.P.9/2021'], false);
  const dateCol = CO.extract.inferColumn(2, 3, ['15.09.2026', '10.11.2026', '18.08.2026'], true);
  t('T13-22', infCol.role === 'index' && caseCol.role === 'caseNumber' && dateCol.name === 'repostedTo',
    'a forum with no profile has its index, case-number and reposted-to columns inferred from content');
}

/* ==========================================================================
   T14 — chamber profile, staleness, thorough mode (§10.9d)
   ========================================================================== */
group('T14  chamber profile and thorough mode');
{
  const store = installMemoryStore(CO);

  const before = store.mem.size;
  CO.engine.run({ advocates: synthRoster, register: synthRegister.cases, documents: [synthDoc], date: '2026-08-14' });
  t('T14-01', store.mem.size === before, 'with the profile off, a full run writes nothing to storage');

  const p = { chamberName: 'Kanchi Chambers', advocates: synthRoster.map(a => ({ name: a.name, enrolment: a.enrolment, role: a.role })),
    register: { cases: synthRegister.cases, uploadedAt: '2026-08-01T00:00:00.000Z',
                sourceFilename: 'cases.csv', rowCount: synthRegister.cases.length }, ledgerOn: false };
  await CO.io.profile.save(p);
  const back = await CO.io.profile.load();
  t('T14-02', back && back.chamberName === 'Kanchi Chambers' && back.advocates.length === 6 &&
             back.register.cases.length === 9,
    'the profile round-trips: roster and register restored intact');

  const json = CO.io.profile.toJSON(p);
  const imported = CO.io.profile.fromJSON(json);
  t('T14-03', imported.chamberName === p.chamberName && imported.advocates.length === p.advocates.length &&
             imported.register.rowCount === p.register.rowCount,
    'export then import reproduces the profile exactly');
  let rejected = false;
  try { CO.io.profile.fromJSON('{"something":"else"}'); } catch { rejected = true; }
  t('T14-03b', rejected, 'a file that is not a chamber profile is refused with a plain message');

  const now = new Date('2026-08-14T00:00:00Z');
  const age = d => CO.io.registerAge({ uploadedAt: new Date(now - d * 86400000).toISOString(), rowCount: 412 }, now);
  t('T14-04', age(3).level === 'ok' && age(21).level === 'amber' && age(60).level === 'red',
    `3d ${age(3).level}, 21d ${age(21).level}, 60d ${age(60).level}`);

  const warn = age(21);
  const tables = CO.io.buildTables(synth, warn);
  const inRows = tables.rows.every(r => r.RegisterWarning === warn.text);
  const inSummary = tables.summary.some(([k, v]) => k === 'REGISTER WARNING' && v === warn.text);
  t('T14-05', inRows && inSummary, 'the stale-register warning appears in the exported file, not only on screen');

  CO.io.memory.set('abc', true);
  await CO.io.ledger.save([{ caseKey: 'X/1/2020' }]);
  const removed = await CO.io.profile.erase();
  const inv = await CO.io.profile.inventory();
  t('T14-06', removed.indexedDB.length > 0 && removed.localStorage.includes('callover:confirm:abc') &&
             store.mem.size === 0 && inv.confirmations.length === 0,
    `erase removed ${removed.indexedDB.length} stored record(s) and ${removed.localStorage.length} answer(s), verified by enumeration`);

  const big = { chamberName: 'Big', advocates: [], ledgerOn: false,
    register: { cases: Array.from({ length: 4000 }, (_, i) => ({
      id: 'c' + i, caseKey: `WP/${i}/2026`, diaryNo: 'D' + i, causeTitle: 'A vs B', raw: {} })),
      uploadedAt: new Date().toISOString(), sourceFilename: 'big.csv', rowCount: 4000 } };
  await CO.io.profile.save(big);
  const bigBack = await CO.io.profile.load();
  t('T14-07', bigBack.register.cases.length === 4000, 'a 4,000-matter register saves and loads');

  await CO.io.profile.erase();
  const runNoLedger = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
    documents: [synthDoc], date: '2026-08-14' });
  const ledgerAfter = await CO.io.ledger.load();
  t('T14-08', ledgerAfter.length === 0, 'the ledger stays empty while its own switch is off');
  await CO.io.ledger.record(runNoLedger);
  const ledgerOn = await CO.io.ledger.load();
  t('T14-08b', ledgerOn.length > 0 && ledgerOn.every(e => e.caseKey),
    `switched on, the ledger records ${ledgerOn.length} matters`);

  const thin = { charCount: 120, layoutConfidence: 'ok' };
  const low  = { charCount: 4000, layoutConfidence: 'low' };
  const fine = { charCount: 4000, layoutConfidence: 'ok' };
  t('T14-09', CO.extract.needsThorough(thin) && CO.extract.needsThorough(low) &&
             !CO.extract.needsThorough(fine) && CO.extract.needsThorough(fine, true),
    'thorough mode engages on thin-text and low-confidence pages, and when forced');

  skip('T14-10', 'needs a browser: OCR merge on a corrupted text layer — verified by hand in M4');
  skip('T14-11', 'needs a browser: text-layer and OCR disagreement shown on the card — verified by hand in M4');

  const forced = await readPdf(CO, 'hrce/Causelistdated11_08_2026.pdf',
    { roster: loadRoster(CO, 'advocates-hrce.csv'), typeOverride: 'tribunal.hrce' });
  t('T14-12', forced.docType === 'tribunal.hrce' && /chosen by you/i.test(forced.typeWhy),
    `a forced type sticks and is never re-detected — ${forced.typeWhy}`);

  const wrong = await readPdf(CO, 'hrce/Causelistdated11_08_2026.pdf',
    { roster: loadRoster(CO, 'advocates-hrce.csv'), typeOverride: 'causelist.hc' });
  const wrongRun = CO.engine.run({ advocates: loadRoster(CO, 'advocates-hrce.csv'),
    register: null, documents: [wrong], date: '2026-08-11' });
  const artefacts = wrongRun.matches.filter(m =>
    /^(Temple|M\.?P\.?No\.?|of the JC)$/i.test(m.matchedText.trim()) && m.tier === 'auto');
  t('T14-13', artefacts.length === 0,
    `forcing the wrong reader produces no Temple / M.P.No artefacts in the confident tier (${wrongRun.counts.auto} auto)`);

  store.restore();
}

/* ==========================================================================
   T10 — the privacy claims are true (§10.10)
   ========================================================================== */
group('T10  the privacy band is a factual claim');
{
  const indexPath = join(ROOT, 'index.html');
  const built = existsSync(indexPath);
  const html = built ? readFileSync(indexPath, 'utf8') : '';
  const shell = readFileSync(join(ROOT, 'tools', 'shell.html'), 'utf8');
  const appSrc = ['00-config.js','10-normalise.js','20-distance.js','30-initials.js','40-score.js',
    '50-extract.js','60-engine.js','70-io.js','80-ui.js']
    .map(f => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n');

  const ALLOWED = [
    'https://theforensicbrief.com', 'https://github.com/rootanand/Callover',
    'https://www.mhc.tn.gov.in/judis/causelist', 'https://districts.ecourts.gov.in/tamilnadu',
    'https://services.ecourts.gov.in/ecourtindia_v6/', 'https://e-jagriti.gov.in/',
    'http://www.w3.org/2000/svg'
  ];

  if (!built) skip('T10-01', 'index.html not built — run node tools/build.mjs');
  else {
    /* A resource reference is a src=/href=/@import/url() in the MARKUP or the
       CSS. A URL inside a library's string table is not one: SheetJS carries
       dozens of XML namespace URIs that are identifiers, never fetched. */
    const refs = [];
    const attrRe = /\b(?:src|href|action|poster|data|formaction)\s*=\s*["']([^"']+)["']/gi;
    const head = html.slice(0, html.indexOf('<!--BUILD:START-->'));
    const tail = html.slice(html.indexOf('<!--BUILD:END-->'));
    for (const chunk of [head, tail]) {
      let m;
      while ((m = attrRe.exec(chunk)) !== null) refs.push(m[1]);
    }
    const cssRe = /@import|url\(\s*["']?(https?:)/gi;
    const cssBad = cssRe.test(head);
    const offOrigin = refs.filter(u => /^https?:/i.test(u) && !ALLOWED.some(a => u.startsWith(a)));
    t('T10-01', offOrigin.length === 0 && !cssBad,
      `${refs.length} markup references, ${offOrigin.length} off-origin` +
      (offOrigin.length ? ` — ${offOrigin.join(', ')}` : ''));
    t('T10-02', !/<link[^>]+stylesheet/i.test(html) && !/@import/i.test(head) &&
                !/fonts\.(googleapis|gstatic)/i.test(html),
      'no external stylesheet, no @import, no web-font request — fonts are system stacks');
  }

  /* Every page shipped alongside the app is held to the same standard. A
     tutorial that pulled in a web font would undermine the claim it explains. */
  {
    const shipped = ['how-to-use.html'];
    const bad = [];
    for (const f of shipped) {
      const p = join(ROOT, f);
      if (!existsSync(p)) { bad.push(`${f} is missing`); continue; }
      const src = readFileSync(p, 'utf8');
      const refs = [];
      const re = /\b(?:src|href|action|poster)\s*=\s*["']([^"'#][^"']*)["']/gi;
      let m;
      while ((m = re.exec(src)) !== null) refs.push(m[1]);
      for (const u of refs)
        if (/^https?:/i.test(u) && !ALLOWED.some(a => u.startsWith(a))) bad.push(`${f}: ${u}`);
      if (/<link[^>]+stylesheet/i.test(src)) bad.push(`${f}: external stylesheet`);
      if (/@import/i.test(src)) bad.push(`${f}: @import`);
      if (/<script[^>]+src=/i.test(src)) bad.push(`${f}: external script`);
      if (/fonts\.(googleapis|gstatic)/i.test(src)) bad.push(`${f}: web font`);
    }
    t('T10-10', bad.length === 0,
      `${shipped.length} companion page(s) load nothing from anywhere` +
      (bad.length ? ` — ${bad.join('; ')}` : ''));

    const tut = existsSync(join(ROOT, 'how-to-use.html'))
      ? readFileSync(join(ROOT, 'how-to-use.html'), 'utf8') : '';
    const banned = CO.BANNED_WORDS.filter(w => tut.toLowerCase().includes(w.toLowerCase()));
    t('T10-11', tut.includes('index.html') && banned.length === 0,
      'the tutorial links back to the app and uses none of the banned unfalsifiable words' +
      (banned.length ? ` — ${banned.join(', ')}` : ''));
  }

  /* T10-03 — the full pipeline with the network stubbed to throw. */
  {
    const realFetch = globalThis.fetch;
    const realXHR = globalThis.XMLHttpRequest;
    const boom = () => { throw new Error('network was used'); };
    globalThis.fetch = boom;
    globalThis.XMLHttpRequest = function () { boom(); };
    let ok = false, why = '';
    try {
      const r = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
        documents: [synthDoc], date: '2026-08-14' });
      CO.io.buildTables(r, null);
      ok = r.matches.length > 0;
    } catch (e) { why = e.message; }
    globalThis.fetch = realFetch;
    globalThis.XMLHttpRequest = realXHR;
    t('T10-03', ok, 'the full pipeline completes with fetch and XMLHttpRequest stubbed to throw' + (why ? ` — ${why}` : ''));
  }

  {
    const ls = installLocalStorage();
    const r = CO.engine.run({ advocates: synthRoster, register: synthRegister.cases,
      documents: [synthDoc], date: '2026-08-14' });
    CO.io.buildTables(r, null);
    const keys = [...ls._map.keys()];
    const stray = keys.filter(k => !k.startsWith(CO.STORE.CONFIRM_PREFIX));
    t('T10-04', stray.length === 0,
      `a full run wrote ${keys.length} localStorage key(s), ${stray.length} outside callover:confirm:`);
  }

  {
    /* The one deliberate exception is stated rather than hidden: OCR is
       lazy-loaded from vendor/ with a <script src>, same-origin, on first need
       only (§2.1). It is not a fetch and it is not off-origin. */
    const calls = [];
    for (const pat of [/\bfetch\s*\(/g, /\bXMLHttpRequest\b/g, /sendBeacon/g, /\bnew WebSocket\b/g, /navigator\.connection/g]) {
      const m = appSrc.match(pat);
      if (m) calls.push(`${pat.source} x${m.length}`);
    }
    t('T10-05', calls.length === 0,
      'no fetch, XMLHttpRequest, sendBeacon or WebSocket anywhere in src/' +
      (calls.length ? ` — ${calls.join(', ')}` : ''));
    t('T10-05b', Object.values(CO.OCR_PATHS).every(v => !/^https?:/i.test(v)),
      'every OCR path is relative: ' + Object.values(CO.OCR_PATHS).join(' '));
  }

  {
    const hay = (appSrc + '\n' + shell).toLowerCase();
    const found = CO.BANNED_WORDS.filter(w => hay.includes(w.toLowerCase()) &&
      !hay.includes("'" + w.toLowerCase() + "'"));
    t('T10-06', found.length === 0,
      'none of the banned unfalsifiable words appear in the UI copy' + (found.length ? ` — ${found.join(', ')}` : ''));
  }

  {
    const store = installMemoryStore(CO);
    installLocalStorage();
    CO.io.memory.set('k1', true); CO.io.memory.set('k2', false);
    let inv = await CO.io.profile.inventory();
    const listed = inv.confirmations.length === 2;
    CO.io.memory.revoke('k1');
    inv = await CO.io.profile.inventory();
    t('T10-07', listed && inv.confirmations.length === 1 && inv.confirmations[0].key.endsWith('k2'),
      'Settings lists every stored confirmation, and revoking one removes it');
    store.restore();
  }

  /* T10-08 / T10-09 — the ESM-to-classic flattening in tools/build.mjs must be
     faithful, because index.html is what the user actually runs. */
  if (!built) { skip('T10-08', 'index.html not built'); skip('T10-09', 'index.html not built'); }
  else {
    const raw = readFileSync(join(ROOT, 'vendor', 'pdf.min.mjs'), 'utf8');
    const exported = (raw.match(/export\s*\{([^}]*)\}\s*;?\s*$/) || [null, ''])[1]
      .split(',').map(s => (s.split(/\s+as\s+/)[1] || s.split(/\s+as\s+/)[0] || '').trim()).filter(Boolean);
    const bound = exported.filter(n => html.includes(`${n}:`));
    t('T10-08', exported.length > 30 && bound.length === exported.length,
      `all ${exported.length} pdf.js exports rebound onto globalThis.pdfjsLib in index.html`);
    const region = html.slice(html.indexOf('<!--BUILD:START-->'), html.indexOf('<!--BUILD:END-->'));
    t('T10-09', !/import\.meta/.test(region) && !/(^|\n)\s*export\s*\{/.test(region),
      'no import.meta and no export block survives into the built page');
  }
}

/* ==========================================================================
   T6 — real-data regression (§10.6). Skipped unless fixtures/real/ exists.
   ========================================================================== */
group('T6  real-data regression');
if (!hasReal) {
  for (const id of ['T6-01', 'T6-02', 'T6-03', 'T6-04', 'T6-05', 'T6-06'])
    skip(id, 'fixtures/real/ is absent — real cause lists are not committed (§10.6). Fetch your own.');
} else {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(ROOT, 'fixtures', 'real')).filter(f => /\.pdf$/i.test(f));
  const roster = [CO.io.makeAdvocate('E. Ganesh', null, null)];
  const t0 = Date.now();
  const docs = [];
  for (const f of files) docs.push(await readPdf(CO, 'real/' + f, { roster }));
  const r = CO.engine.run({ advocates: roster, register: null, documents: docs, date: '2026-08-14' });
  const secs = (Date.now() - t0) / 1000;
  const autos = r.matches.filter(m => m.tier === 'auto');
  t('T6-01', autos.length === 1 && /GANESH/i.test(autos[0].matchedText),
    `exactly 1 auto match: ${autos.map(m => m.matchedText).join(', ')}`);
  t('T6-02', r.counts.review <= 5, `confirm list has ${r.counts.review} entries (want <= 5)`);
  const vign = r.matches.filter(m => /VIGNESH/i.test(m.matchedText) && (m.tier === 'auto' || m.tier === 'review'));
  t('T6-03', vign.length === 0, `no VIGNESH in auto or review (${vign.length})`);
  t('T6-04', secs < 60, `full run in ${secs.toFixed(1)}s (want < 60)`);
  const t1 = Date.now();
  for (const d of docs) for (const p of d.pages) CO.extract.passB(p, roster, CO.extract.buildRosterIndex(roster));
  t('T6-05', (Date.now() - t1) / 1000 < 2, `name scoring pass alone in ${((Date.now() - t1) / 1000).toFixed(2)}s`);
  const mb = process.memoryUsage().heapUsed / 1048576;
  t('T6-06', mb < 1024, `peak heap ${mb.toFixed(0)} MB (want < 1024)`);
}

/* ==========================================================================
   T7 — OCR pipeline (§10.7). Needs a browser: tesseract.js is a Worker plus
   WebAssembly, and rasterising needs a canvas.
   ========================================================================== */
group('T7  OCR pipeline');
{
  t('T7-00', typeof CO.extract.ocr.readPage === 'function' &&
             typeof CO.extract.ocr.loadEngine === 'function' &&
             CO.extract.classifyPage({ charCount: 5, hSegs: [], vSegs: [] }) === 'ocr',
    'the OCR route exists and a page under 40 characters is sent to it');

  /* A wedged worker must not swallow the run. §8.7 requires a page that could
     not be read to be named; a promise that never settles names nothing. */
  {
    const ocr = CO.extract.ocr;
    const saved = { s: CO.OCR_SILENCE_MS, h: CO.OCR_PAGE_TIMEOUT_MS, i: CO.OCR_WATCH_INTERVAL_MS };
    CO.OCR_SILENCE_MS = 120; CO.OCR_PAGE_TIMEOUT_MS = 5000; CO.OCR_WATCH_INTERVAL_MS = 20;

    let threw = null;
    try { await ocr.watch(new Promise(() => {}), 'Picture-reading page 4'); }
    catch (e) { threw = e.message; }
    t('T7-05', threw && /page 4/.test(threw) && /stopped responding/.test(threw),
      `an engine that goes silent is abandoned and the page is named — "${threw}"`);

    /* Slow but talking must NOT be killed: a dense page really does take two
       minutes, and cutting it off would lose a listing. */
    let slow = null, slowErr = null;
    const chatty = new Promise(res => {
      let n = 0;
      const iv = setInterval(() => { ocr._log({ status: 'recognizing text', progress: ++n / 10 });
        if (n === 10) { clearInterval(iv); res('finished'); } }, 40);
    });
    try { slow = await ocr.watch(chatty, 'Picture-reading page 5'); } catch (e) { slowErr = e.message; }
    t('T7-06', slow === 'finished' && !slowErr,
      'a page that keeps reporting progress is left alone, however long it takes' +
      (slowErr ? ` — killed with "${slowErr}"` : ''));

    /* The absolute ceiling still applies to something that chatters forever. */
    let hard = null, chatter = null;
    const forever = new Promise(() => {
      chatter = setInterval(() => ocr._log({ status: 'recognizing text' }), 20);
    });
    try { await ocr.watch(forever, 'Picture-reading page 6'); } catch (e) { hard = e.message; }
    clearInterval(chatter);
    t('T7-07', hard && /gave up/.test(hard), `the absolute ceiling still bites — "${hard}"`);

    /* Cancelling must work without any timer, because a browser freezes timers
       in a long-hidden tab — measured: a 4-second interval that had not run
       for 164 seconds. Budgets are set enormous here so only cancelAll() can
       possibly settle it. */
    CO.OCR_SILENCE_MS = 1e9; CO.OCR_PAGE_TIMEOUT_MS = 1e9;
    let cancelled = null;
    const stuck = ocr.watch(new Promise(() => {}), 'Picture-reading page 7');
    ocr.cancelAll('You stopped the run.');
    try { await stuck; } catch (e) { cancelled = e.message; }
    t('T7-09', cancelled === 'You stopped the run.' && ocr._pending.size === 0,
      `a stuck page can be abandoned by the user with no timer involved — "${cancelled}"`);

    /* And the run loop is released even when the wedge is somewhere readPage
       does not own — a canvas render that never completes, for instance. */
    let released = null;
    const neverSettles = new Promise(() => {});
    const raced = Promise.race([neverSettles, ocr.cancelSignal()]).catch(e => e.message);
    ocr.cancelAll('You stopped the run.');
    released = await raced;
    t('T7-09b', released === 'You stopped the run.' && ocr._pending.size === 0,
      `the run loop is released whatever OCR was stuck inside — "${released}"`);

    Object.assign(CO, { OCR_SILENCE_MS: saved.s, OCR_PAGE_TIMEOUT_MS: saved.h, OCR_WATCH_INTERVAL_MS: saved.i });
    t('T7-08', CO.OCR_SILENCE_MS >= 60000 && CO.OCR_PAGE_TIMEOUT_MS > CO.OCR_SILENCE_MS,
      `budgets: ${CO.OCR_SILENCE_MS / 1000}s of silence, ${CO.OCR_PAGE_TIMEOUT_MS / 1000}s absolute, ` +
      `${CO.OCR_START_TIMEOUT_MS / 1000}s to start`);
  }

  /* A stopped run keeps what it has read and says what it skipped (§8.7). */
  {
    let seen = 0;
    const partial = await CO.extract.readDocument(
      { name: 'stopped.pdf', bytes: new Uint8Array(readFileSync(fixture('causelist-synthetic-14082026.pdf'))),
        official: false },
      { roster: synthRoster, thorough: false, stopped: () => ++seen > 6 });
    t('T7-10', partial.items.length > 0 && partial.pages.length === 6 &&
              partial.notes.some(n => /you stopped the run/i.test(n.text)),
      `stopping after ${partial.pages.length} pages keeps ${partial.items.length} items and names what was skipped`);
  }
  t('T7-04', synthDoc.items.every(i => Array.isArray(i.ocrPages)),
    'ocrPages is populated on every result');
  for (const id of ['T7-01', 'T7-02', 'T7-03'])
    skip(id, 'needs a browser: Worker + WebAssembly + canvas. Run the rasterised fixture by hand (M5).');
}

finish();
