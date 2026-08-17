/* ============================================================================
   Callover — 00-config.js
   Thresholds, fold rules, document profiles, portal links, keyboard maps.

   Everything a non-developer might reasonably need to change lives here, and
   nowhere else. TDD.md §4.6 (thresholds), §5.8a (profiles), §6.4 (portals).

   The constants in this file are load-bearing. Several of them were arrived at
   by running the engine against a real 642-page Madras High Court cause list;
   the comment above each one records what happens if it moves. Please do not
   "tidy" them without re-running the test suite.
   ========================================================================= */
;(function (CO) {
  'use strict';

  CO.VERSION = '1.0.0';

  /* ---------------------------------------------------------------- §4.6
     Tiering thresholds.

     AUTO      accept without asking
     REVIEW    show as a confirm card
     WEAK      keep, but hide behind the "show weak matches" toggle (C4)
     CORE_GATE the core-name score below which nothing is considered at all
  */
  CO.T = { AUTO: 0.86, REVIEW: 0.68, WEAK: 0.58, CORE_GATE: 0.72 };

  /* OCR pages get looser thresholds because character noise depresses every
     similarity measure. Bounded, and applied only to pages that actually went
     through OCR — tracked per page in ListedItem.ocrPages. */
  CO.OCR_SLACK = { TIER: 0.04, GATE: 0.06 };

  /* ---------------------------------------------------------------- §4.1
     Titles and role words are stripped before a name is compared. */
  CO.TITLE_RE = /\b(M\/S|MESSRS|MS|MR|MRS|MISS|THIRU|TMT|SELVI|SHRI|SRI|SMT|DR|ADV|ADVOCATE|LEARNED|COUNSEL|SENIOR|SR|PROF)\b/g;

  /* An opener that is BOTH a salutation and a plausible set of initials.

     "MR.ELAVARASAN" may be Mr. Elavarasan, or it may be M.R. Elavarasan with
     the dots dropped — and a registry does both. Read only as a salutation,
     the initials are thrown away and a firm's own M.R. Elavarasan falls from a
     certain match to a question.

     So the name is read BOTH ways and the better reading wins (§4.4). That can
     only ever help: the initials reading wins only when the firm advocate's
     initials really are those letters, so an unrelated name cannot be lifted by
     it. Every one of these is two or three letters — longer salutations like
     THIRU are never plausible initials and are not listed. */
  CO.AMBIGUOUS_OPENER = /^(MR|MS|DR|SR|MRS)\.?\s*(?=[A-Z])/;
  CO.ROLE_RE  = /\b(FOR|APPEARING|ON BEHALF OF|TAKES NOTICE|ACCEPTS NOTICE|GP|SPP|SGP|AGP|PP|SC|ASG|AAG|GOVERNMENT PLEADER|PUBLIC PROSECUTOR|STANDING COUNSEL|AMICUS|CURIAE|PARTY IN PERSON|PIP)\b/g;

  /* Structural words that separate or enumerate PARTIES. They are punctuation
     in disguise, never part of anybody's name, and they arrive inside name
     cells all the time — "1.E.O against", "V.Chandra And 5 others".

     "AGAINST" is the tribunal's "-Vs-", and it was the worst offender: it
     folds to GNST against GANESH's GNS and was being offered as a candidate
     for E. Ganesh on five separate rows. Stripping it leaves those cells with
     no core token at all, so they are never scored (§4.4 returns null). */
  CO.PARTY_SEP_RE = /\b(AGAINST|VERSUS|VS|V\/S|AND OTHERS|AND ANOTHER|OTHERS|ANOTHER|ANR|ORS|AND)\b/g;

  /* ---------------------------------------------------------------- §4.1
     Transliteration folding. ORDER MATTERS: longest digraphs first, or KSH
     would be eaten by SH. Applied left to right, then doubled letters are
     collapsed, then all vowels are deleted. */
  CO.FOLD_RULES = [
    ['KSH','X'], ['CHH','S'], ['SHH','S'], ['THH','T'],
    ['KH','K'],  ['GH','G'],  ['CH','S'],  ['TH','T'], ['DH','D'], ['PH','F'],
    ['BH','B'],  ['JH','J'],  ['SH','S'],  ['ZH','L'], ['NG','N'], ['NY','N'],
    ['OO','U'],  ['EE','I'],  ['AA','A'],  ['AI','I'], ['AU','O'], ['OU','O'],
    ['W','V'],   ['Y','I'],   ['Z','S'],   ['Q','K'],  ['X','KS']
  ];

  /* ---------------------------------------------------------------- §4.5
     OCR character confusions, folded per slot: digits in the number and year
     slots, letters in the case-type slot. Never applied across slots. */
  CO.OCR_TO_DIGIT = { O:'0', Q:'0', D:'0', I:'1', L:'1', '|':'1', Z:'2', S:'5', B:'8', G:'6', T:'7', A:'4' };
  CO.OCR_TO_ALPHA = { '0':'O', '1':'I', '5':'S', '8':'B', '6':'G', '2':'Z', '4':'A', '7':'T' };

  /* ---------------------------------------------------------------- §4.3
     QWERTY neighbours, for detecting a registry typist's slip. */
  CO.KEY_ADJ = {
    A:'QSZW', B:'VGHN', C:'XDFV', D:'SERFCX', E:'WSDR', F:'DRTGVC',
    G:'FTYHBV', H:'GYUJNB', I:'UJKO', J:'HUIKNM', K:'JIOLM', L:'KOP',
    M:'NJK', N:'BHJM', O:'IKLP', P:'OL', Q:'WA', R:'EDFT', S:'AWEDXZ',
    T:'RFGY', U:'YHJI', V:'CFGB', W:'QASE', X:'ZSDC', Y:'THGU', Z:'ASX'
  };

  /* Visually confusable initials — OCR and handwriting. */
  CO.LOOKALIKE = {
    B:'8PR', D:'OQ', E:'F', G:'6C', I:'1JL', J:'I', L:'I1',
    M:'N', N:'MH', O:'0DQ', P:'RB', Q:'OG', R:'PB', S:'5',
    U:'V', V:'UW', W:'V', Z:'2'
  };

  /* ---------------------------------------------------------------- §4.3
     Initials-comparison scores. Read the state machine in 30-initials.js
     alongside this table.

     flip-other is 0.12 and NOT 0.30. At 0.30 the combined score for
     "E. Ganesh" against "J.GANESH" reaches 0.734, which lands in the review
     tier — and the real Madras list then puts J.GANESH, M.GANESH, N.GANESH
     and A.GANESH in the confirm queue every single morning. At 0.12 they fall
     to weak, which is hidden but retrievable, satisfying C4 without destroying
     usability. Do not raise this without re-running T6. (Decision D2.) */
  CO.INITIALS_SCORE = {
    'both-absent':     0.50,
    'absent-in-list':  0.45,
    'absent-in-query': 0.45,
    'exact':           1.00,
    'partial':         0.80,
    'subset':          0.75,
    'flip-plausible':  0.50,
    'flip-other':      0.12,
    'transposed':      0.70,
    'different':       0.15
  };

  /* ---------------------------------------------------------------- §4.4
     Name-score mixing weights, and the head-guard penalty.

     HEAD_PENALTY exists because vowel-stripping makes GANESH -> GNS and
     VIGNESH -> VGNS, which score 0.75 on ratio. Transliteration never changes
     the leading consonant of a Tamil name, so requiring the first letter of
     some core token to agree (raw or folded, so CHANDRAN/SHANDRAN still works)
     removes that whole class of false positive at no cost to recall.
     Verified: eliminated 5 false positives on the real list with zero loss. */
  CO.SCORE_MIX = { RAW: 0.30, FOLD: 0.40, TOKEN: 0.30, HEAD_PENALTY: 0.55 };

  /* combined = core * (INITIALS_FLOOR + INITIALS_SPAN * initialsScore).
     Core must be strong; initials modulate, they never rescue. */
  CO.SCORE_INITIALS = { FLOOR: 0.62, SPAN: 0.38 };

  /* ---------------------------------------------------------------- §4.7
     The five signals. Weights feed the noisy-OR confidence; the tier is the
     maximum tier any single signal reached, never a sum. (Decision D5.) */
  CO.SIGNAL_WEIGHT = {
    caseNumber:   1.00,   // the firm knows its own case numbers  -> immediate auto
    cnr:          1.00,   // nationally unique                    -> immediate auto
    enrolment:    0.95,   // bar number printed on the item       -> immediate auto
    partyName:    0.70,   // promotes weak->review, review->auto
    cluster:      0.65    // two firm advocates on one item       -> promotes review->auto
    // advocateName carries no fixed weight: it uses the §4.4 score itself.
  };

  /* A register party / cause title must reach this to fire the partyName
     signal. Below it the parties are simply different matters. */
  CO.PARTY_MATCH_MIN = 0.80;

  /* Finding a register entry BY its parties, when the register has no
     case-number column at all, is a weaker move than the signal above and is
     held to a higher bar — plus a margin over the runner-up, because half a
     cause list ends "-Vs- The State" and an ambiguous party match is worth
     nothing at all. */
  CO.PARTY_FALLBACK_MIN    = 0.88;
  CO.PARTY_FALLBACK_MARGIN = 0.05;

  /* ---------------------------------------------------------------- §4.6a
     Range expansion. A misparse of a page number as a range must not generate
     an unbounded key set; anything wider than this is flagged, not expanded. */
  CO.RANGE_CAP = 500;

  /* ---------------------------------------------------------------- §5
     Extraction constants. */
  CO.EXTRACT = {
    OCR_MIN_CHARS:     40,    // §5.1 a page below this has no usable text layer
    THIN_TEXT_CHARS:   200,   // §5.11 above the OCR threshold but still suspicious
    LINE_Y_TOL:        2.0,   // §5.1 pdf units; items within this share a line
    COLUMN_FALLBACK:   0.55,  // §5.3 deliberately above the real 0.51 so the
                              //      fallback errs towards scanning the whole line
    NAME_MAX_CHARS:    45,    // §5.4 a right-column line longer than this is prose
    LOW_CONF_MIN_BONLY: 3,    // §5.10.1 B-only hits needed to call a page bad
    LOW_CONF_FILE_PCT: 0.20,  // §5.10.1 flag the whole file above this share
    OCR_SCALE:         2.0    // §5.2 render scale before binarising
  };

  /* §5.4 — a right-column line that matches any of these is not a name. */
  CO.NOISE_DIVIDER = /^-+$/;
  CO.NOISE_DIGITS  = /\d{4,}/;
  CO.NOISE_WORDS   = /\b(ROAD|STREET|NAGAR|PIN|DT:|VIDE|NOTICE|FILED|ORDERED|EX-PARTE|ISSUES FRAMED|W\/S|TAPAL|UNSERVED|UNCLAIMED|MEMO)\b/;

  /* §4.8 / §5.4 — the line that divides petitioner counsel from respondent. */
  CO.DIVIDER_RE = /^\s*-{6,}\s*$/;

  /* §5.4 — a new item block starts here. */
  CO.ITEM_START_RE = /^\s*(\d{1,4})\s+.*?([A-Z][A-Z.\s]{0,12}\/\s*\d{1,6}\s*\/\s*\d{4})/;

  /* §5.5 — page context. */
  CO.HALL_RE      = /COURT\s*(?:HALL|NO\.?)\s*[:\-]?\s*([0-9IVX]+)/i;
  CO.CORAM_RE     = /(HON'BLE|HON’BLE|\.J\s*$|\bJ\.\s*$)/;
  CO.LISTTYPE_RE  = /\(\d{2}\/\d{2}\/\d{4}\)\s*-\s*(.+LIST)/i;

  /* ------------------------------------------------------------- §5.8a0.1
     The connector probe vocabulary.

     TRAP, and the reason these are built rather than written as literals:
     real lists glue the connector to the next word — "throughThiru. E. Ganesh"
     and "And othersthrough Thiru E. Ganesh" both appear in the supplied HR&CE
     files. So there are no \b anchors. Instead a negative lookbehind excludes
     the English words that legitimately embed "through", and a lookahead
     rejects a following LOWERCASE letter so "throughout" is excluded while a
     glued proper noun is not.

     That lookahead MUST stay case-sensitive. The Python reference expresses
     this as the inline island (?-i:(?![a-z])); JavaScript has no inline
     modifier groups, so the pattern carries no /i flag at all and every
     literal is spelled as an explicit [Aa]-style class instead. Add /i here
     and [a-z] starts matching uppercase too, which silently rejects
     "throughThiru" — the exact regression T16-09 exists to catch. */
  const ci = s => s.replace(/[A-Za-z]/g, c => '[' + c.toUpperCase() + c.toLowerCase() + ']');
  CO._ci = ci;

  const PARTY_FIRST_ALTS = [
    ci('represented') + '\\s*(?:' + ci('by') + '|' + ci('through') + ')',
    ci('rep') + '\\.?\\s*(?:' + ci('by') + '|' + ci('through') + ')',
    ci('thr') + '(?:' + ci('ough') + '|' + ci('u') + '|' + ci('o') + ')',
    ci('thorugh'), ci('throuh'), ci('thruogh')
  ];
  CO.CONNECTOR_PARTY_FIRST_SRC =
    '(?<!' + ci('break') + ')(?<!' + ci('walk') + ')(?<!' + ci('fall') + ')(?<!' + ci('see') + ')' +
    '(?:' + PARTY_FIRST_ALTS.join('|') + ')' +
    '(?![a-z])';                      /* <- deliberately case-sensitive. See above. */
  CO.CONNECTOR_PARTY_FIRST = new RegExp(CO.CONNECTOR_PARTY_FIRST_SRC);

  /* "for" is a connector only when a party REFERENCE follows it. Bare "for" is
     far too common: "SPL.PUBLIC PROSECUTOR FOR ED CASES" is a role
     description, not a split point. */
  CO.CONNECTOR_COUNSEL_FIRST = /\b(?:for|on\s+behalf\s+of|appearing\s+for)\s+(?=R-?\d|D-?\d|P-?\d|A-?\d|the\s+(?:petitioner|respondent|appellant|plaintiff|defendant|complainant)|petitioner|respondent|appellant|plaintiff|defendant|complainant)/i;

  CO.HONORIFIC_RE = /^(?:M\/s|Messrs|Thiru|Tmt|Selvi|Shri|Sri|Smt|Dr|Mr|Mrs|Adv|Advocate)\.?\s*/i;

  /* §5.8a0.3 — a column is upgraded to party+counsel at this density or above.
     Density is measured over ASSEMBLED CELLS, never over physical lines:
     measured on the HR&CE lists the petitioner column reads 50% per cell and
     only 10% per line, because party cells wrap and just one wrapped line
     carries the connector. Line-level measurement under-reports five-fold and
     would classify the main counsel-bearing column as ordinary party text.
     (Decision D39.) */
  CO.PROBE = { MIN_DENSITY: 0.20, MIN_CELLS: 8 };

  /* ------------------------------------------------------------- §5.8a
     DOCUMENT PROFILES — a declarative column map per forum.

     Adding a court or tribunal means adding an entry here. It must never mean
     writing a parser, and no code anywhere may test for a column NAMED
     "counsel": counsel-bearing is the ROLE test, role in {counsel,
     party+counsel}. HR&CE has no counsel column at all — the advocate is
     printed inside the party cell after a connector — and an earlier draft
     that tested the name would have buried an entire tribunal practice in the
     confirm queue. (Decision D33, test T15-01.)

     Roles: index | caseNumber | party | counsel | party+counsel | extra
  */
  CO.COUNSEL_BEARING_ROLES = ['counsel', 'party+counsel'];

  CO.PROFILES = [
    {
      id: 'tribunal.hrce',
      label: 'HR&CE Commissioner — tribunal cause list',
      kind: 'causelist',
      detect: [
        /Before the Commissioner,?\s*HR\s*&\s*CE/i,
        /HR\s*&\s*CE\s*Admn\.?\s*Department/i,
        /Petitioner and his\s*Advocate.?s Name/i,
        /Thiruvalargal/i
      ],
      columns: [
        { name: 'serial',     role: 'index' },
        { name: 'caseNo',     role: 'caseNumber', expandRanges: true },
        { name: 'petitioner', role: 'party+counsel', side: 'petitioner',
          honorifics: /^(?:M\/s|Thiru|Tmt|Selvi|Dr|Mr)\.?\s*/i },
        { name: 'respondent', role: 'party+counsel', side: 'respondent',
          honorifics: /^(?:M\/s|Thiru|Tmt|Selvi|Dr|Mr)\.?\s*/i, subNumbering: true },
        { name: 'underSec',   role: 'extra', label: 'Under Section' },
        { name: 'temple',     role: 'extra', label: 'Temple' },
        { name: 'subject',    role: 'extra', label: 'Subject matter' }
      ]
    },
    {
      id: 'causelist.hc',
      label: 'High Court cause list',
      kind: 'causelist',
      detect: [ /HIGH COURT OF JUDICATURE/i, /COURT\s*NO\.?\s*\d+/i, /HON'?’?BLE/i ],
      columns: [
        { name: 'item',    role: 'index' },
        { name: 'caseNo',  role: 'caseNumber', expandRanges: true },
        { name: 'parties', role: 'party' },
        { name: 'counsel', role: 'counsel', counselMode: 'whole-cell',
          sideFrom: 'divider', divider: /^-{6,}$/ }
      ]
    },
    {
      id: 'adjournment',
      label: 'Adjournment notice',
      kind: 'adjournment',
      detect: [
        /Adjournment\s*Notice\s*No\.?/i,
        /stand\s+reposted\s+as\s+follows/i,
        /are\s+hereby\s+reposted\s+as\s+follows/i
      ],
      columns: [
        { name: 'serial',    role: 'index' },
        { name: 'caseNo',    role: 'caseNumber', expandRanges: true },
        { name: 'repostedTo', role: 'extra', label: 'Reposted to' }
      ]
    }
  ];

  /* The dropdown offered on every file row (§5.9). The user's choice always
     wins and there is no re-detection after an override. */
  CO.DOC_TYPES = [
    { id: 'auto',           label: 'Auto-detect' },
    { id: 'causelist.hc',   label: 'High Court list' },
    { id: 'tribunal.hrce',  label: 'Tribunal list' },
    { id: 'adjournment',    label: 'Adjournment notice' }
  ];

  /* §5.6 — the preamble that introduces a reposting table appended to the end
     of an ordinary cause list. Such a section is parsed separately. */
  CO.ADJOURN_SECTION_RE = /Note\s*:-?\s*Please take notice|stand\s+reposted\s+as\s+follows|are\s+hereby\s+reposted\s+as\s+follows/i;

  /* §5.8 — the date and time a matter is reposted to. */
  CO.REPOST_DATE_RE = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/;
  CO.REPOST_TIME_RE = /(\d{1,2}[.:]\d{2}\s*(?:a\.?m|p\.?m)\.?)/i;

  /* ---------------------------------------------------------------- §6.1
     Advocate-file column detection. Best fuzzy header match wins; the mapping
     is always shown and always overridable before the run. */
  CO.ADVOCATE_HEADERS = {
    name:      ['advocate', 'name', 'counsel', 'advocate name', 'name of the advocate'],
    enrolment: ['enrol', 'enrolment', 'enrollment', 'bar', 'bar council', 'reg no', 'bar enrolment', 'enrolment no'],
    role:      ['role', 'designation', 'type']
  };
  CO.HEADER_MATCH_MIN = 0.75;

  /* §6.2 — the firm's register schema. Every original column is preserved in
     RegisterCase.raw regardless; these are the ones the engine reads. */
  /* What the file pickers offer. Kept here, and kept in step with what the
     parsers genuinely handle, because an `accept` list is a real restriction:
     a format missing from it cannot be chosen in the dialog at all, however
     well the code behind would have read it.

     SheetJS reads all of these, and both parsers were already tested against
     every one — .xlsm and .ods worked perfectly while being silently
     unselectable, and the register handles a delimited .txt. Verified in T20. */
  CO.ACCEPT_ADVOCATES = '.txt,.csv,.tsv,.xlsx,.xlsm,.xls,.ods';
  CO.ACCEPT_REGISTER  = '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods';

  CO.REGISTER_HEADERS = {
    diaryNo:    ['diaryno', 'diary no', 'diary'],
    caseType:   ['casetype', 'case type', 'type'],
    caseNo:     ['caseno', 'case no', 'case number', 'number'],
    year:       ['year'],
    court:      ['court', 'forum'],
    causeTitle: ['causetitle', 'cause title', 'title'],
    counselFor: ['counselfor', 'counsel for', 'appearing for', 'side'],
    partyName:  ['partyname', 'party name', 'party', 'client'],
    mobile:     ['mobile', 'phone', 'contact'],
    reference:  ['reference', 'referred by'],
    status:     ['status'],
    date:       ['date', 'filing date'],
    fees:       ['fees', 'fee'],
    remarks:    ['remarks', 'remark'],
    attendedBy: ['attendedby', 'attended by', 'advocate'],
    nextDate:   ['nextdate', 'next date'],
    nextStage:  ['nextstage', 'next stage', 'stage'],
    statusRemark: ['statusremark', 'status remark'],
    cnr:        ['cnr', 'cnr number', 'cnr no']
  };

  /* ---------------------------------------------------------------- §6.4
     Portal deep links. These OPEN IN A NEW TAB — Callover never fetches them
     (C3: CORS blocks it, the portals are captcha-gated, and a law firm's own
     tooling defeating a government access control is an unacceptable
     professional risk).

     These URLs are expected to drift. This array is the single place to fix
     one, and it is deliberately plain enough for a non-developer to edit. */
  CO.PORTALS = [
    { label: 'Madras High Court',  url: 'https://www.mhc.tn.gov.in/judis/causelist',
      note: 'Principal seat and Madurai bench' },
    { label: 'TN District Courts', url: 'https://districts.ecourts.gov.in/tamilnadu',
      note: 'District and subordinate courts' },
    { label: 'eCourts Services',   url: 'https://services.ecourts.gov.in/ecourtindia_v6/',
      note: 'All India, case status and cause lists' },
    { label: 'Consumer — e-Jagriti', url: 'https://e-jagriti.gov.in/',
      note: 'District, State and National consumer commissions' }
  ];

  /* ---------------------------------------------------------------- §6.7
     Chamber profile storage.

     IndexedDB, not localStorage: a register of a few thousand matters exceeds
     the 5 MB localStorage ceiling, and localStorage fails by throwing
     mid-write, which can leave a half-saved profile behind. (Decision D30.) */
  CO.STORE = {
    DB_NAME:       'callover-profile',
    DB_VERSION:    1,
    STORE_NAME:    'profile',
    PROFILE_KEY:   'chamber',
    LEDGER_KEY:    'ledger',
    /* localStorage holds confirmed spellings ONLY, all under this one prefix.
       T10-04 fails the build if a run writes any other key. */
    CONFIRM_PREFIX: 'callover:confirm:',
    SETTINGS_KEY:   'callover:settings'
  };

  /* §6.7.2 — a stale register fails invisibly: fewer matches looks exactly
     like a quiet day. So it is warned about at 14 days and again at 45, and
     the warning is carried into every export. Callover never refuses to run on
     a stale register; it refuses to let the user forget. (Decision D31.) */
  CO.REGISTER_STALE_DAYS  = 14;
  CO.REGISTER_STALER_DAYS = 45;

  /* §6.7.3 — the ledger is the only structure that accumulates client data the
     user did not deliberately upload, so it is a separate opt-in and capped. */
  CO.LEDGER_CAP = 5000;

  /* ---------------------------------------------------------------- §7.2.2
     Confirm-card row order: most decisive field first, so the eye lands on the
     fact that settles it. Next stage is context and always sits last. */
  CO.EVIDENCE_ROW_ORDER = [
    'caseNumber', 'cnr', 'causeTitle', 'parties', 'advocate', 'side', 'nextStage'
  ];
  CO.EVIDENCE_ROW_LABEL = {
    caseNumber: 'Case number', cnr: 'CNR', causeTitle: 'Cause title',
    parties: 'Parties', advocate: 'Advocate', side: 'Side',
    nextStage: 'Next stage', temple: 'Temple', underSec: 'Under section',
    subject: 'Subject matter', where: 'Where found'
  };

  /* ---------------------------------------------------------------- §7.3
     Export columns, in this order, for every format.

     §7.3 fixes the first list. Four more are added because later sections
     require them to travel with the data:

       MatchRole        §5.8a.3 / D35 — "the confirm card and every export
                        state which it is", because "you are appearing" and
                        "you are being sued" are not interchangeable
       SideDetail       §5.8a.2 — which respondents an advocate acts for
       Adjourned,
       RepostedTo       §6.6.1 — the new date and time, prominently
       RegisterWarning  §6.7.2 / T14-05 — the staleness warning must appear in
                        the exported file, not only on screen. It is a column
                        rather than a preamble so the file still round-trips
                        as ordinary CSV.

     Every original register column is appended after these, so the export
     echoes the firm's own schema straight back (T8-05). */
  CO.EXPORT_COLUMNS = [
    'Date', 'Court', 'Hall', 'ItemNo', 'CaseNumber', 'CauseTitle', 'Petitioner',
    'Respondent', 'FirmAdvocate', 'PrintedName', 'MatchRole', 'Side', 'SideDetail',
    'Tier', 'Confidence', 'Signals', 'DiaryNo', 'NextStage', 'Adjourned',
    'RepostedTo', 'SourceFile', 'SourceMarkedOfficial', 'PageNo', 'WasOCR',
    'RegisterWarning'
  ];

  /* ---------------------------------------------------------------- §8.6
     Keyboard map for the confirm queue. */
  CO.KEYS = {
    accept: ['y', 'Y'],
    reject: ['n', 'N'],
    next:   ['ArrowDown', 'j'],
    prev:   ['ArrowUp', 'k'],
    help:   ['?']
  };

  /* §8.1 palette — shared with The Forensic Brief so the family resemblance is
     deliberate. Mirrored here so exports and the PDF can use the same values. */
  CO.PALETTE = {
    cream: '#F4F1E8', ink: '#23211E', red: '#8A2B2B', muted: '#6E6A62',
    green: '#2F6B4F', amber: '#9A6B10', rule: '#DDD8CA', panel: '#FFFDF8'
  };

  /* §8.1a wording rules. These words are unfalsifiable and read as marketing
     where a specific checkable fact is available. T10-06 fails the build if any
     of them appears in the source. (Decision D17.) */
  CO.BANNED_WORDS = ['bank-grade', 'military-grade', 'enterprise security', 'secure by design'];

  /* Where OCR is loaded from, lazily, on first need only (§2.1).
     These stay RELATIVE so it is obvious at a glance that nothing points off
     this origin; they are resolved against the page before tesseract sees
     them, because its worker cannot resolve a bare path. */
  CO.OCR_PATHS = {
    worker:   'vendor/tesseract-worker.min.js',
    coreSimd: 'vendor/tesseract-core-simd.wasm.js',
    core:     'vendor/tesseract-core.wasm.js',
    lang:     'vendor/',
    langCode: 'eng'
  };

  /* How long one page may spend in OCR before Callover gives up on it.

     A wedged worker is worse than a failed one: without this the whole run
     hangs on a progress bar that never moves, and §8.7 requires a page that
     could not be read to be NAMED, not to swallow the run.

     Deliberately generous. Measured: a dense A4 landscape HR&CE table at 2x
     takes 128 seconds on this machine. Timing out a page that would have
     succeeded loses a listing, and a missed listing costs an appearance — so
     the budget is set well above the worst case actually observed, and the
     progress panel reports what OCR is doing so a slow page never reads as a
     hang.

     SILENCE is the one that actually does the work. A single long deadline is
     unreliable: a browser throttles long timers hard in a background tab, and
     a user who switches away mid-run gets no timeout at all — observed, with a
     300-second deadline still unfired after 370 seconds in a hidden tab. So
     the watchdog instead fires when the engine has said NOTHING for this long,
     it re-arms every few seconds, and it compares wall-clock readings rather
     than trusting the timer to be punctual. Throttling can then delay
     detection but can never cause a false alarm, and "slow but working" is
     told apart from "wedged" — which a fixed deadline cannot do at all. */
  CO.OCR_PAGE_TIMEOUT_MS  = 300000;   // absolute ceiling for one page
  CO.OCR_SILENCE_MS       = 90000;    // no word from the engine for this long
  CO.OCR_START_TIMEOUT_MS = 90000;    // ceiling for starting the engine
  CO.OCR_WATCH_INTERVAL_MS = 4000;    // how often the watchdog looks

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
