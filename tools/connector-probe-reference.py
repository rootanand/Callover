#!/usr/bin/env python3
"""
FIRST-LEVEL STRUCTURAL PROBE.

Before any advocate name is scanned for, ask each column a simpler question:
"do your cells contain a party->advocate connector?"

If yes, the column carries BOTH party and advocate, and must be split.
This is a convention across Indian courts and tribunals, so it is detected
structurally rather than declared per forum.

Connectors have DIRECTION, which is the subtle part:
  party-first : "E.R. Kannan through M/s.E.Ganesh"   -> advocate AFTER
  counsel-first: "AKILESH KUMAR FOR R1"              -> advocate BEFORE
"""
import re, glob, collections

# ---- connector vocabulary -------------------------------------------------
# No \b: real lists glue the connector to adjacent words - "throughThiru. E. Ganesh",
# "And othersthrough Thiru E. Ganesh". A negative lookbehind excludes English words
# that legitimately embed "through".
PARTY_FIRST = re.compile(r"""(?<!break)(?<!walk)(?<!fall)(?<!see)(
      represented \s* (?:by|through)
    | rep\.? \s* (?:by|through)
    | thr(?:ough|ough|u|o)
    | thorugh | throuh | thruogh
)(?![a-z])""", re.I | re.X)

# "for" is only a connector when a party REFERENCE follows it
COUNSEL_FIRST = re.compile(r"""\b(?:for|on\s+behalf\s+of|appearing\s+for)\s+
    (?=R\d|D\d|P\d|A\d|R-\d|the\s+(?:petitioner|respondent|appellant|plaintiff|defendant|complainant)
      |petitioner|respondent|appellant|plaintiff|defendant|complainant)""", re.I | re.X)

HONORIFIC = re.compile(r'^(?:M/s|Messrs|Thiru|Tmt|Selvi|Shri|Sri|Smt|Dr|Mr|Mrs|Adv|Advocate)\.?\s*', re.I)

def probe(cells):
    """Return connector density + dominant direction for a list of cell strings."""
    n = pf = cf = 0
    for c in cells:
        c = c.strip()
        if len(c) < 4: continue
        n += 1
        if PARTY_FIRST.search(c):   pf += 1
        if COUNSEL_FIRST.search(c): cf += 1
    if not n: return dict(cells=0, density=0.0, direction=None, pf=0, cf=0)
    hit = max(pf, cf)
    return dict(cells=n, density=hit / n, pf=pf, cf=cf,
                direction=('party-first' if pf >= cf and pf else
                           'counsel-first' if cf else None))

def classify(p, declared_role='party'):
    """party+counsel if enough cells carry a connector."""
    if p['density'] >= 0.25 and p['cells'] >= 8:
        return 'party+counsel', 'probe: %d%% of cells carry a connector' % round(p['density']*100)
    if p['density'] > 0:
        return declared_role, 'probe: connectors present but sparse (%d%%)' % round(p['density']*100)
    return declared_role, 'probe: no connectors'

# ---- HRCE : 7 columns -----------------------------------------------------
HRCE_BANDS = [("serial",0,9),("caseNo",9,30),("petitioner",30,54),("respondent",54,78),
              ("underSec",78,84),("temple",84,110),("subject",110,999)]

def collect(files, bands):
    cols = collections.defaultdict(list)
    for f in files:
        for ln in open(f, encoding='utf-8', errors='ignore').read().split('\n'):
            for name, a, b in bands:
                if len(ln) > a:
                    seg = ln[a:b].strip()
                    if seg: cols[name].append(seg)
    return cols

print("=" * 90)
print("PROBE 1 — HR&CE tribunal lists (4 real files)")
print("=" * 90)
cols = collect(sorted(glob.glob('hrce/Causelist*.txt')), HRCE_BANDS)
print(f"{'COLUMN':<13}{'CELLS':>7}{'CONN':>7}{'DENSITY':>9}  {'DIRECTION':<14}{'ROLE ASSIGNED':<16}WHY")
print("-" * 90)
for name, _, _ in HRCE_BANDS:
    p = probe(cols[name]); role, why = classify(p)
    mark = ' <<<' if role == 'party+counsel' else ''
    print(f"{name:<13}{p['cells']:>7}{max(p['pf'],p['cf']):>7}{p['density']*100:>8.0f}%  "
          f"{str(p['direction'] or '-'):<14}{role:<16}{why}{mark}")

# ---- Madras HC : counsel column is pure names -----------------------------
MHC_BANDS = [("item",0,4),("caseNo",4,26),("parties",26,63),("counsel",63,999)]
print()
print("=" * 90)
print("PROBE 2 — Madras High Court list (642 pages)")
print("=" * 90)
cols2 = collect(['full.txt'], MHC_BANDS)
print(f"{'COLUMN':<13}{'CELLS':>7}{'CONN':>7}{'DENSITY':>9}  {'DIRECTION':<14}{'ROLE ASSIGNED':<16}WHY")
print("-" * 90)
for name, _, _ in MHC_BANDS:
    dec = 'counsel' if name == 'counsel' else 'party'
    p = probe(cols2[name]); role, why = classify(p, dec)
    print(f"{name:<13}{p['cells']:>7}{max(p['pf'],p['cf']):>7}{p['density']*100:>8.0f}%  "
          f"{str(p['direction'] or '-'):<14}{role:<16}{why}")

# ---- direction matters ----------------------------------------------------
print()
print("=" * 90)
print("PROBE 3 — split direction, on real strings")
print("=" * 90)
SAMPLES = [
 ("E.R. Kannan through M/s.E.Ganesh",                 "party-first"),
 ("1. J.C/E.O through M/s.E.Ganesh",                  "party-first"),
 ("And others throughThiru. E. Ganesh",               "party-first"),
 ("3. R3 to R11 through M/s.E.Ganesh",                "party-first"),
 ("M. Ganesan and AburvamGanesan through M/s. SVV Law Firm", "party-first"),
 ("Boopathi Palanisamy And othersthrough Thiru E. Ganesh",   "party-first"),
 ("AKILESH KUMAR FOR R1",                             "counsel-first"),
 ("D.YUVAJAISHREE FOR R5",                            "counsel-first"),
 ("M/S.E.GANESH R.PRABAKAR E.SRIKANTH FOR R13",       "counsel-first"),
 ("K.Jegan",                                          None),
 ("Sri Ramanathaswamy Temple, Rameshwaram.",          None),
]
def split(cell):
    m = PARTY_FIRST.search(cell)
    if m:
        party = cell[:m.start()].strip(' .,')
        adv   = HONORIFIC.sub('', cell[m.end():].strip()).strip(' .,')
        return 'party-first', party, adv
    m = COUNSEL_FIRST.search(cell)
    if m:
        adv   = HONORIFIC.sub('', cell[:m.start()].strip()).strip(' .,')
        party = cell[m.end():].strip(' .,')
        return 'counsel-first', party, adv
    return None, cell.strip(), None

ok = 0
print(f"{'CELL':<58}{'DIR':<15}{'PARTY':<26}ADVOCATE")
print("-" * 118)
for cell, want in SAMPLES:
    d, party, adv = split(cell)
    good = (d == want); ok += good
    print(f"{cell[:56]:<58}{str(d or '-'):<15}{str(party)[:24]:<26}{adv or '-'}{'' if good else '   <<< WRONG'}")
print("-" * 118)
print(f"{ok}/{len(SAMPLES)} directions correct")
