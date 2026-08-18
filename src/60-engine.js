/* ============================================================================
   Callover — 60-engine.js
   TDD.md §4.7 (the five signals), §4.8 (side), §6.6 (adjournments),
   §7.1 (views), §7.2 (evidence).

   Signals are EVIDENCE, NOT A SUM:

       tier       = the highest tier any single signal reached
       confidence = 1 - Π(1 - signalScore)          (noisy-OR)

   A weighted sum would let three weak signals outvote one certain one, and
   would let a mangled name dilute an exact case-number hit. Independent
   signals should reinforce each other instead. (Decision D5.)
   ========================================================================= */
;(function (CO) {
  'use strict';

  /* A small stable hash, for remembering a confirmed spelling (§7.2.4). */
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  const confirmKey = (firmName, printed) =>
    hash(CO.upperClean(firmName) + '|' + CO.splitName(printed).core.join(' ') + '|' + CO.splitName(printed).initials.join(''));

  const norm = s => CO.upperClean(s || '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  function textSim(a, b) {
    const A = norm(a), B = norm(b);
    if (!A || !B) return 0;
    return Math.max(CO.ratio(A, B), CO.jaroWinkler(A, B), CO.tokenSetScore(A.split(' '), B.split(' ')));
  }

  /* ======================================================================
     1.  THE REGISTER
     ================================================================== */
  function indexRegister(cases) {
    const byKey = new Map(), byCnr = new Map();
    for (const rc of cases || []) {
      if (rc.caseKey) { if (!byKey.has(rc.caseKey)) byKey.set(rc.caseKey, rc); }
      if (rc.cnr) byCnr.set(CO.upperClean(rc.cnr).replace(/[^A-Z0-9]/g, ''), rc);
    }
    return { byKey, byCnr, all: cases || [] };
  }

  /* ======================================================================
     2.  SIGNALS
     ================================================================== */

  function caseNumberSignal(item, reg) {
    for (const k of item.caseKeys || []) {
      const rc = reg.byKey.get(k);
      if (rc) return {
        kind: 'caseNumber', weight: CO.SIGNAL_WEIGHT.caseNumber, score: CO.SIGNAL_WEIGHT.caseNumber,
        registerCase: rc, matchedKey: k,
        detail: `Case number ${k} is in your register — diary ${rc.diaryNo || '(none)'}.`
      };
    }
    return null;
  }

  function cnrSignal(item, reg) {
    if (!reg.byCnr.size) return null;
    const flat = CO.upperClean(item.rawText || '').replace(/[^A-Z0-9]/g, '');
    for (const [cnr, rc] of reg.byCnr) {
      if (cnr.length >= 12 && flat.includes(cnr)) return {
        kind: 'cnr', weight: CO.SIGNAL_WEIGHT.cnr, score: CO.SIGNAL_WEIGHT.cnr,
        registerCase: rc, detail: `The CNR ${rc.cnr} printed on this item is in your register.`
      };
    }
    return null;
  }

  function enrolmentSignal(item, advocate) {
    if (!advocate || !advocate.enrolment) return null;
    const want = CO.upperClean(advocate.enrolment).replace(/[^A-Z0-9]/g, '');
    if (want.length < 5) return null;
    const flat = CO.upperClean(item.rawText || '').replace(/[^A-Z0-9]/g, '');
    if (!flat.includes(want)) return null;
    return {
      kind: 'enrolment', weight: CO.SIGNAL_WEIGHT.enrolment, score: CO.SIGNAL_WEIGHT.enrolment,
      detail: `Enrolment number ${advocate.enrolment} is printed on this item.`
    };
  }

  /* Find the register entry for an item by its parties, for registers that
     carry no case-number column.

     KEYLESS ROWS ONLY, and this is the point rather than an optimisation. If a
     register row HAS a case key and that key did not match, the miss is real
     evidence that this is not the firm's matter, and going looking for it by
     party text instead throws that evidence away. Measured: without this
     restriction, decoys D09 (M.KRISHNAN) and D10 (T.SELVAN) were promoted from
     review to auto, having found register entries whose cause titles merely
     ended "-Vs- The State" as half the list does.

     Held to a stricter threshold than the promoting signal, and required to be
     clearly better than the runner-up, because a party name is a much weaker
     handle than a case number and an ambiguous one is worth nothing. */
  function findRegisterByParties(item, reg) {
    let best = null, bestSim = 0, second = 0;
    for (const rc of reg.all) {
      if (rc.caseKey) continue;
      const sim = Math.max(
        textSim([item.petitioner, item.respondent].filter(Boolean).join(' vs '), rc.causeTitle),
        textSim(item.petitioner, rc.partyName),
        textSim(item.respondent, rc.partyName)
      );
      if (sim > bestSim) { second = bestSim; bestSim = sim; best = rc; }
      else if (sim > second) second = sim;
    }
    if (bestSim < CO.PARTY_FALLBACK_MIN) return null;
    if (bestSim - second < CO.PARTY_FALLBACK_MARGIN) return null;
    return best;
  }

  /* §4.7 — promotes weak->review and review->auto. Never fires on its own. */
  function partySignal(item, rc) {
    if (!rc) return null;
    const listed = [item.petitioner, item.respondent].filter(Boolean).join(' vs ');
    const best = Math.max(
      textSim(listed, rc.causeTitle),
      textSim(item.petitioner, rc.partyName),
      textSim(item.respondent, rc.partyName)
    );
    if (best < CO.PARTY_MATCH_MIN) return null;
    return {
      kind: 'partyName', weight: CO.SIGNAL_WEIGHT.partyName, score: CO.SIGNAL_WEIGHT.partyName,
      similarity: best,
      detail: `The parties on this item match your register entry for ${rc.partyName || rc.causeTitle}.`
    };
  }

  /* ======================================================================
     3.  ONE ITEM -> ITS MATCHES
     ================================================================== */

  function matchItem(item, roster, reg, opts) {
    const ocr = !!(item.ocrPages && item.ocrPages.length);
    const lowPage = item.layoutConfidence === 'low';

    const csig = caseNumberSignal(item, reg);
    const nsig = cnrSignal(item, reg);
    let   rc   = (csig && csig.registerCase) || (nsig && nsig.registerCase) || null;

    /* --- score every printed name against every firm advocate --- */
    const advKey = a => CO.upperClean(a && a.name).replace(/[^A-Z]/g, '');
    const perAdvocate = new Map();      // advocate.id -> best hit
    for (const printed of item.namesWithRole || []) {
      for (const adv of roster) {
        /* A sweep hit already knows which advocate it scored against; do not
           rescore it against a different one, or one loose string would attach
           to every name on the roster. Matched by name rather than by object
           identity — see the note on advocateKey in 50-extract.js. */
        const mine = printed.advocateKey
          ? printed.advocateKey === advKey(adv)
          : printed.advocateId === adv.id;
        if (printed.source === 'B' && (printed.advocateKey || printed.advocateId) && !mine) continue;

        const sc = printed.score && mine ? printed.score : CO.nameScore(adv.name, printed.name);
        if (!sc) continue;
        const tier = CO.classify(sc, { ocr });
        if (tier === 'none') continue;

        /* Where the register already identifies this matter by its case
           number, a weak sweep hit must not be allowed to name it. The sweep
           legitimately picks up fragments of subject-matter prose — "Against"
           scores weak against "E. Ganesh" on the consonant skeleton alone —
           and letting one of those define the match would print "found
           outside the counsel column" on a matter whose case number is
           sitting in the firm's own register. The honest reading is "matched
           by case number; no advocate name here could be read as one of
           yours". The hit itself is still kept on the item, so nothing is
           discarded (C4, T13-04). */
        if (printed.matchRole === 'unplaced' &&
            CO.tierRank(tier) < CO.tierRank('review') && (csig || nsig)) continue;

        /* A name Pass A placed in a column beats one the sweep found loose,
           even if the loose one scores higher: placement is evidence too. */
        const cur = perAdvocate.get(adv.id);
        const placed = p => p.matchRole !== 'unplaced';
        const wins = !cur ||
          (placed(printed) && !placed(cur.printed)) ||
          (placed(printed) === placed(cur.printed) && sc.combined > cur.score.combined);
        if (wins) perAdvocate.set(adv.id, { advocate: adv, printed, score: sc, tier });
      }
    }

    /* §4.7 cluster — two or more distinct firm advocates at review or better
       on one item. Chambers are printed together, so the firm's own roster
       becomes a disambiguator. Verified in the real list: E.SRIKANTH appears
       alongside E.GANESH in two of his three items. (Decision D7.)

       COUNSEL ONLY, and on both sides of the rule — a party hit neither counts
       towards a cluster nor is promoted by one.

       D7's reasoning is precisely that CHAMBERS ARE PRINTED TOGETHER, which is
       a fact about counsel columns and not about parties. Two party names that
       happen to resemble two firm advocates is coincidence, and treating it as
       corroboration promoted "V. Kavi Ganesan" into a confirmed match for
       E. Ganesh — along with "Balagandhi (a)" for A. Balaguru and
       "V.Chandra And 5 others" for V. Chandrasekar. A party still tiers
       normally on its own evidence (§5.8a.3), and a partner's own litigation
       is still caught, because what identifies that is the case number in the
       firm's register, which is decisive by itself (D6). */
    const strong = [...perAdvocate.values()].filter(h =>
      h.printed.matchRole === 'counsel' && CO.tierRank(h.tier) >= CO.tierRank('review'));
    const cluster = strong.length >= 2 ? {
      kind: 'cluster', weight: CO.SIGNAL_WEIGHT.cluster, score: CO.SIGNAL_WEIGHT.cluster,
      names: strong.map(h => h.advocate.name),
      detail: `${strong.length} of your advocates are printed on this item: ${strong.map(h => h.advocate.name).join(', ')}.`
    } : null;

    /* No case number and no CNR matched — but the firm may still hold this
       matter under a cause title or a party name, which is all some registers
       carry. Find it that way so §4.7's partyName signal can corroborate, and
       so the confirm card can show the register side at all.

       Deliberately only when a NAME already matched: partyName promotes, it
       never fires alone, so scanning for every item would cost a linear pass
       over the register per item and buy nothing. This keeps it to the handful
       of items that are already candidates. */
    if (!rc && perAdvocate.size) rc = findRegisterByParties(item, reg);
    const psig = partySignal(item, rc);

    const out = [];
    const mk = (advocate, hit) => {
      const signals = [];
      let tier = 'none';

      if (hit) {
        signals.push({
          kind: 'advocateName', weight: hit.score.combined, score: hit.score.combined,
          detail: `Printed as "${hit.printed.name}"; scored against ${advocate.name}.`,
          state: hit.score.initials.state, printed: hit.printed.name
        });
        tier = hit.tier;
      }

      /* MATTER-LEVEL EVIDENCE MAY NOT SETTLE A NAME-LEVEL QUESTION.

         The five signals answer two different questions, and conflating them
         is the single mistake behind every wrong attribution found so far:

           MATTER-level — is this item the firm's matter?
             caseNumber : this case number is in the firm's register
             cnr        : this CNR is in the firm's register
             partyName  : these parties match the firm's register entry

           NAME-level — is this printed string this advocate?
             advocateName : how the string scores against the roster
             enrolment    : this advocate's enrolment number is printed here
             cluster      : other firm advocates are printed alongside (D7)

         A case number in the register proves the matter is the firm's. It says
         nothing whatever about WHICH of the firm's advocates a barely-scoring
         string refers to. The same is true of a CNR, and of matching parties —
         they are all facts about the MATTER.

         Letting them promote a name attributed three real matters to the wrong
         person, each of which the register records against E. Ganesh:

           R.P.449/2024  "V. Sakthivel"  -> K. Sakthivel     name alone: weak
           R.P.538/2025  "Chandiramohan" -> V. Chandrasekar  name alone: weak
           A.P.32/2023   "Balamurugan"   -> A. Balaguru      name alone: weak

         "By advocate" is the view a clerk uses to decide who goes where, so
         the effect is sending the wrong junior to court.

         So matter-level evidence sets the tier of the MATTER — the entry with
         no advocate attached, the P19 path, or whoever the register records —
         and lifts a NAME only where the name has already earned review on its
         own. Nothing is lost by this: the matter is still caught, still at
         auto, and the unearned attribution becomes a question instead of a
         certainty. */
      const nameEarnedIt = !hit || CO.tierRank(hit.tier) >= CO.tierRank('review');

      if (csig) { signals.push(csig); if (nameEarnedIt) tier = CO.maxTier(tier, 'auto'); }
      if (nsig) { signals.push(nsig); if (nameEarnedIt) tier = CO.maxTier(tier, 'auto'); }

      /* Enrolment is NAME-level: an enrolment number identifies the person,
         not the matter, so it settles the attribution on its own. */
      const esig = enrolmentSignal(item, advocate);
      if (esig) { signals.push(esig); tier = CO.maxTier(tier, 'auto'); }

      if (psig) {
        signals.push(psig);
        if (nameEarnedIt) {
          if (tier === 'weak') tier = 'review';
          else if (tier === 'review') tier = 'auto';
        }
      }
      if (cluster && hit && hit.printed.matchRole === 'counsel') {
        signals.push(cluster);
        if (tier === 'review') tier = 'auto';
      }
      if (!signals.length) return null;

      /* Caps, applied after every promotion.

         A B-only hit is never auto-accepted however well it scores: it is
         exactly the missed-listing case AND exactly the false-positive case,
         and only a person can separate the two (D27). A page whose columns
         could not be separated is capped for the same reason (§5.10.1). */
      /* matchRole says WHERE the name was found — counsel, party, or nowhere
         a name belongs (§5.8a.3). identifiedBy says WHAT actually settled it,
         which is a different question and the one the user cares about most.

         Keeping them apart matters: a matter whose case number is in the
         firm's register but whose counsel line is unreadable has no name to
         place, so matchRole is "unplaced" by the §5.8a.3 vocabulary — but
         telling the user "found outside the counsel column, the layout may not
         have been read correctly" would be plainly wrong. It was identified by
         its case number, and that is what every surface says. */
      const matchRole = hit ? hit.printed.matchRole : 'unplaced';
      const identifiedBy = hit ? 'name'
        : csig ? 'caseNumber' : nsig ? 'cnr' : esig ? 'enrolment' : 'name';
      let capped = tier;
      if (hit && hit.printed.source === 'B' && hit.printed.matchRole === 'unplaced' && !csig && !nsig)
        capped = CO.capTier(capped, 'review');

      /* A sweep hit that merely sits NEAR a matter rather than inside it is
         not evidence about that matter — it belongs to a heading, a note, or a
         row that yielded no matter of its own. Kept, because C4 forbids
         dropping it, but held to the weak tier so it appears behind the toggle
         instead of as a question about the wrong case. */
      if (hit && hit.printed.nearOnly) capped = CO.capTier(capped, 'weak');

      /* A PARTY resembling one of the firm's advocates, on the name alone, is
         held to the weak tier.

         Party cells are full of ordinary personal names, so a chance
         resemblance is common — measured across the four HR&CE lists, the name
         path alone produced "V. Chandrakasan" and "V.Chandra And 5 others" for
         V. Chandrasekar, "Balagandhi (a)" for A. Balaguru and a bare "Ganesan"
         for E. Ganesh. Nine such questions a day, none of them real, is how a
         confirm queue stops being read.

         This does NOT lose a partner's own litigation, which is the case
         §5.8a.3 exists to protect. What identifies that is the case number in
         the firm's own register, and that is decisive by itself (D6) — both
         planted instances, P18 CC/212/2026 and P20 CC/213/2026, carry a
         caseNumber signal and stay at auto. The cap only bites where the ONLY
         evidence is that a stranger's name looks a little like an advocate's.

         Nothing is discarded either: weak is retained and one toggle away
         (C4, D4). See docs/measurements.md §7. */
      if (hit && hit.printed.matchRole === 'party' && !csig && !nsig && !esig)
        capped = CO.capTier(capped, 'weak');

      if (lowPage) capped = CO.capTier(capped, 'review');
      if (capped === 'none') return null;

      const confidence = 1 - signals.reduce((p, s) => p * (1 - Math.max(0, Math.min(1, s.score))), 1);

      /* §4.8 — side is recorded, never used to filter. A firm's role can
         legitimately change between rounds, so a disagreement is a warning on
         the card and never a suppression. (Decision D25, H-20.) */
      const side = hit ? (hit.printed.side || 'unknown') : 'unknown';
      let sideMismatch = null;
      if (rc && rc.counselFor && side !== 'unknown') {
        const wantsPet = /petition|appellant|plaintiff|complain/i.test(rc.counselFor);
        const wantsRes = /respond|defend/i.test(rc.counselFor);
        if ((wantsPet && side === 'respondent') || (wantsRes && side === 'petitioner'))
          sideMismatch = `Your register has you for the ${wantsPet ? 'petitioner' : 'respondent'} in this matter, but the list prints your name on the ${side} side. The match is kept — a role can change between rounds — but it is worth a look.`;
      }

      return {
        id: CO.extract.nextId('m'),
        item, advocate: advocate || null,
        registerCase: rc,
        registerAdvocate: rc ? (rc.attendedBy || null) : null,
        tier: capped, tierBeforeCap: tier, confidence, signals,
        matchedText: hit ? hit.printed.name : (item.caseNumbers[0] || ''),
        matchRole, identifiedBy, side, sideDetail: hit ? (hit.printed.sideDetail || null) : null,
        sideMismatch, foundBy: hit ? hit.printed.source : 'A',
        confirmedByBothPasses: hit ? !!hit.printed.confirmedByB : false,
        wasOCR: ocr, layoutConfidence: item.layoutConfidence || 'ok',
        confirmed: null,
        confirmKey: advocate && hit ? confirmKey(advocate.name, hit.printed.name) : null
      };
    };

    for (const hit of perAdvocate.values()) {
      const m = mk(hit.advocate, hit);
      if (m) out.push(m);
    }

    /* A matter identified by case number alone: the counsel line was
       unreadable, or the firm is a party in person. advocate stays null
       because no name was matched — the register says who handles it, and
       that is recorded separately (T5-05). */
    if (!out.length && (csig || nsig)) {
      const m = mk(null, null);
      if (m) out.push(m);
    }

    return out;
  }

  /* ======================================================================
     4.  EVIDENCE  — §7.2

     Every Match carries its full Evidence inline, not behind a click. Asking
     "is R.GANESH your E. Ganesh?" with nothing else on screen forces the
     advocate to decide on the single weakest signal available, when the app
     already knows the case number, both parties, the cause title, the court,
     the item, the side and whether that case number is one of the firm's at
     all. Withholding that turns a two-second certainty into a coin-flip.
     (Decision D11.)
     ================================================================== */

  const CANON_ROWS = CO.EVIDENCE_ROW_ORDER;

  function buildEvidence(match, reg, roster) {
    const it = match.item, rc = match.registerCase;
    const hasRegister = reg.all.length > 0;
    const rows = [];

    const row = (field, inList, inRegister, verdict, note) =>
      ({ field, label: CO.EVIDENCE_ROW_LABEL[field] || field, inList: inList || '', inRegister: inRegister == null ? null : inRegister, verdict, note: note || null });

    /* §5.10 — a sweep-only finding leads with what is actually uncertain. */
    if (match.matchRole === 'unplaced' && match.identifiedBy === 'name') {
      const where = it.extra && Object.keys(it.extra).length
        ? `Elsewhere on page ${it.page}, not in a column that carries advocate names`
        : `On page ${it.page}, but not in a column that carries advocate names`;
      rows.push(row('where', where, null, 'differ',
        'The columns on this page could not be separated confidently, so the reader cannot say this is a counsel entry. Rather than drop it, we are asking.'));
    }

    /* Rows whose value would come from the register still render when there is
       no register, marked absent. Silently omitting them would misrepresent
       the strength of the evidence: the advocate must be able to see what the
       app could NOT check, not just what it could. (Decision D13, T9-04.) */
    const noReg = 'No register was supplied, so this could not be checked.';

    /* 1. Case number — the most decisive field there is. */
    const listedCase = (it.caseNumbers || []).join(', ');
    if (rc && rc.caseKey && (it.caseKeys || []).includes(rc.caseKey))
      rows.push(row('caseNumber', listedCase, `${rc.caseKey} · diary ${rc.diaryNo || '—'}`, 'agree'));
    else if (hasRegister)
      rows.push(row('caseNumber', listedCase, 'Not in your register', 'absent'));
    else
      rows.push(row('caseNumber', listedCase, null, 'absent', noReg));

    /* 2. CNR */
    const cnrSig = match.signals.find(s => s.kind === 'cnr');
    if (rc && rc.cnr)
      rows.push(row('cnr', cnrSig ? rc.cnr : '—', rc.cnr, cnrSig ? 'agree' : 'unknown',
        cnrSig ? null : 'The list does not print a CNR for this item.'));
    else if (hasRegister)
      rows.push(row('cnr', '—', 'Not recorded', 'absent'));
    else
      rows.push(row('cnr', '—', null, 'absent', noReg));

    /* 3. Cause title */
    const listedTitle = [it.petitioner, it.respondent].filter(Boolean).join(' — vs — ');
    if (rc && rc.causeTitle) {
      const sim = textSim(listedTitle, rc.causeTitle);
      rows.push(row('causeTitle', listedTitle, rc.causeTitle, sim >= 0.80 ? 'agree' : 'differ',
        sim >= 0.80 ? null : 'The wording differs, which is common — registries abbreviate.'));
    } else rows.push(row('causeTitle', listedTitle, hasRegister ? 'Nothing to compare' : null,
      'absent', hasRegister ? null : noReg));

    /* 4. Parties */
    if (rc && rc.partyName) {
      const sim = Math.max(textSim(it.petitioner, rc.partyName), textSim(it.respondent, rc.partyName));
      rows.push(row('parties', listedTitle, rc.partyName, sim >= 0.80 ? 'agree' : 'differ'));
    } else rows.push(row('parties', listedTitle, hasRegister ? 'Nothing to compare' : null,
      'absent', hasRegister ? null : noReg));

    /* 5. Advocate — the weakest signal, deliberately not first. */
    if (match.advocate) {
      const sig = match.signals.find(s => s.kind === 'advocateName');
      const st = sig && sig.state;
      const q = CO.splitName(match.advocate.name), c = CO.splitName(match.matchedText);
      const note = st ? CO.initialsNote(st, q.initials.join(''), c.initials.join('')) : null;
      const exact = CO.upperClean(match.matchedText).replace(/[^A-Z]/g, '') ===
                    CO.upperClean(match.advocate.name).replace(/[^A-Z]/g, '');
      rows.push(row('advocate', match.matchedText, match.advocate.name,
        exact ? 'agree' : 'differ', note));
    } else {
      rows.push(row('advocate', (it.allNames || []).join(', ') || 'Not readable',
        rc && rc.attendedBy ? rc.attendedBy : null,
        'absent',
        'No advocate name on this item could be read as one of yours. It was identified by its case number.'));
    }

    /* 6. Side */
    const sideText = match.side === 'unknown' ? 'Not stated on the list'
      : match.matchRole === 'counsel' && it.extra && Object.keys(it.extra).length
        ? `${match.side} column${match.sideDetail ? `, for ${match.sideDetail}` : ''}`
        : `${match.side === 'respondent' ? 'Below' : 'Above'} the divider — ${match.side}` +
          (match.sideDetail ? `, marked ${match.sideDetail}` : '');
    rows.push(row('side', sideText, rc ? (rc.counselFor || 'Not recorded') : (hasRegister ? 'Nothing to compare' : null),
      match.sideMismatch ? 'differ' : (rc && rc.counselFor ? 'agree' : 'absent'),
      match.sideMismatch || (hasRegister ? null : noReg)));

    /* Tribunal extras. A temple name is often how the firm actually recognises
       the file, so it belongs in the evidence (§5.7 step 4, H-14). */
    for (const [k, v] of Object.entries(it.extra || {})) {
      if (!v) continue;
      rows.push(row(k.toLowerCase().replace(/[^a-z]/g, ''), v,
        rc && rc.remarks && textSim(rc.remarks, v) >= 0.7 ? rc.remarks : (hasRegister ? null : null),
        rc && rc.remarks && textSim(rc.remarks, v) >= 0.7 ? 'agree' : 'unknown'));
      rows[rows.length - 1].label = k;
    }

    /* 7. Next stage — context, never a signal, and therefore always last. */
    rows.push(row('nextStage', '—', rc ? (rc.nextStage || 'Not recorded') : (hasRegister ? 'Nothing to compare' : null),
      'absent', hasRegister ? null : noReg));

    /* Colleagues: other firm advocates printed on this same item (C5). */
    const colleagues = [];
    for (const n of it.namesWithRole || []) {
      for (const adv of roster) {
        if (match.advocate && adv.id === match.advocate.id) continue;
        const sc = CO.nameScore(adv.name, n.name);
        if (sc && CO.tierRank(CO.classify(sc, { ocr: match.wasOCR })) >= CO.tierRank('review'))
          if (!colleagues.includes(n.name)) colleagues.push(n.name);
      }
    }

    /* The verbatim excerpt, with the matched string marked. */
    const excerpt = it.rawText || '';
    const spans = [];
    if (match.matchedText) {
      let from = 0;
      const needle = match.matchedText;
      for (;;) {
        const i = excerpt.indexOf(needle, from);
        if (i < 0) break;
        spans.push([i, i + needle.length]);
        from = i + needle.length;
      }
    }

    const registerHit = !!(rc && rc.caseKey && (it.caseKeys || []).includes(rc.caseKey));
    let decisiveField = null;
    if (registerHit) decisiveField = 'caseNumber';
    else if (cnrSig) decisiveField = 'cnr';
    else if (match.matchRole === 'unplaced' && match.identifiedBy === 'name') decisiveField = 'where';

    return {
      rows, colleagues, registerHit,
      registerDiary: registerHit ? (rc.diaryNo || null) : null,
      pdfExcerpt: excerpt, highlightSpans: spans,
      page: it.page, wasOCR: match.wasOCR, decisiveField
    };
  }

  /* ======================================================================
     5.  ADJOURNMENTS  — §6.6, §6.6.1

     Measured on the supplied files, almost the whole of the 11.08.2026 list
     was vacated by the notice dated 10.08.2026 (see docs/measurements.md). A
     tool that reads only the cause list therefore tells the firm to prepare
     bundles and send juniors for matters that will not be called, which makes
     this a correctness requirement and not a feature. (Decision D22.)
     ================================================================== */

  function applyAdjournments(matches, reposted, reg, ledger) {
    const byKey = new Map();
    for (const rp of reposted)
      for (const k of rp.caseKeys || [])
        if (!byKey.has(k)) byKey.set(k, rp);

    const adjourned = [], attending = [];
    for (const m of matches) {
      let hit = null;
      for (const k of m.item.caseKeys || []) { hit = byKey.get(k); if (hit) break; }
      if (!hit) { attending.push(m); continue; }
      m.adjourned = hit;
      /* An inferred date is a guess, and a guessed hearing date is
         indistinguishable from a correct one until the day it is wrong. It
         goes to the confirm queue with the ambiguity spelled out. (D24.) */
      if (hit.dateConfidence === 'inferred') m.tier = CO.capTier(m.tier, 'review');
      adjourned.push(m);
    }

    /* §6.6 source 1 and 3 — a notice row the firm owns but which appears on no
       loaded cause list. Identified from the register, or from the opt-in
       local ledger, with no server anywhere in it (Decision D23). */
    const seen = new Set(matches.map(m => m.item.caseKeys.join('|')));
    const noticeOnly = [];
    for (const rp of reposted) {
      for (const k of rp.caseKeys || []) {
        const rc = reg.byKey.get(k);
        const led = !rc && ledger ? ledger.find(e => e.caseKey === k) : null;
        if (!rc && !led) continue;
        if ([...seen].some(s => s.split('|').includes(k))) continue;
        noticeOnly.push({
          id: CO.extract.nextId('no'), caseKey: k, reposted: rp,
          registerCase: rc || null, ledgerEntry: led || null,
          identifiedFrom: rc ? 'register' : 'ledger'
        });
        break;
      }
    }

    return { adjourned, attending, noticeOnly };
  }

  /* ======================================================================
     6.  VIEWS  — §7.1
     ================================================================== */

  function buildViews(matches, roster) {
    /* 1. By advocate. A matter carrying two firm advocates appears under BOTH,
          each marked "also under X", so the duplication reads as intentional
          rather than as a bug. Overlap is the point. (C5.) */
    const byAdvocate = roster.map(adv => ({
      advocate: adv,
      matches: matches.filter(m => m.advocate && m.advocate.id === adv.id)
    }));
    const unattributed = matches.filter(m => !m.advocate);
    for (const m of unattributed) {
      const owner = m.registerAdvocate &&
        byAdvocate.find(b => CO.tierRank(CO.classify(CO.nameScore(b.advocate.name, m.registerAdvocate) || null, {})) >= CO.tierRank('review'));
      (owner || { matches: [] }).matches.push(m);
      m.attributedVia = owner ? 'register' : null;
    }
    const orphans = unattributed.filter(m => !m.attributedVia);

    for (const block of byAdvocate)
      for (const m of block.matches) {
        m.alsoUnder = matches
          .filter(x => x !== m && x.item === m.item && x.advocate && (!m.advocate || x.advocate.id !== m.advocate.id))
          .map(x => x.advocate.name);
      }

    /* 2. By court and hall, ordered by item number — the view a junior uses to
          plan the morning. */
    const courts = new Map();
    for (const m of matches) {
      const court = m.item.court || 'Court not stated';
      const hall = m.item.hall || '—';
      if (!courts.has(court)) courts.set(court, new Map());
      const halls = courts.get(court);
      if (!halls.has(hall)) halls.set(hall, []);
      halls.get(hall).push(m);
    }
    const byCourt = [...courts].map(([court, halls]) => ({
      court,
      halls: [...halls].map(([hall, ms]) => ({
        hall, matches: ms.sort((a, b) => (parseInt(a.item.itemNo, 10) || 1e9) - (parseInt(b.item.itemNo, 10) || 1e9))
      })).sort((a, b) => String(a.hall).localeCompare(String(b.hall), undefined, { numeric: true }))
    })).sort((a, b) => a.court.localeCompare(b.court));

    /* 3. By case — one row per matter, all matched firm advocates in one cell. */
    const cases = new Map();
    for (const m of matches) {
      const k = m.item.id;
      if (!cases.has(k)) cases.set(k, { item: m.item, matches: [], advocates: [] });
      const c = cases.get(k);
      c.matches.push(m);
      if (m.advocate && !c.advocates.includes(m.advocate.name)) c.advocates.push(m.advocate.name);
    }
    const byCase = [...cases.values()];

    return { byAdvocate, byCourt, byCase, orphans, all: matches };
  }

  /* ======================================================================
     7.  RUN
     ================================================================== */

  function run(input) {
    const roster    = input.advocates || [];
    const reg       = indexRegister(input.register);
    const documents = input.documents || [];
    const remembered = input.remembered || {};
    const ledger    = input.ledger || null;

    const items = [], reposted = [], notes = [], badPages = [], probes = [], capped = [];
    let pageCount = 0, ocrPages = 0, ocrUnavailable = null;

    for (const d of documents) {
      items.push(...d.items);
      reposted.push(...d.reposted);
      notes.push(...d.notes.map(n => ({ ...n, file: d.file })));
      badPages.push(...d.badPages.map(b => ({ ...b, file: d.file })));
      probes.push({ file: d.file, docType: d.docType, typeWhy: d.typeWhy, signatures: d.probes });
      capped.push(...d.cappedRanges.map(c => ({ ...c, file: d.file })));
      pageCount += d.pageCount;
      ocrPages += d.ocrPages.length;
      ocrUnavailable = ocrUnavailable || d.ocrUnavailable;
    }

    let matches = [];
    for (const it of items) matches.push(...matchItem(it, roster, reg, input));

    /* §7.2.4 — a spelling the user has already ruled on is never asked about
       twice, and a wrong Yes must be undoable. */
    for (const m of matches) {
      if (!m.confirmKey) continue;
      if (Object.prototype.hasOwnProperty.call(remembered, m.confirmKey)) {
        m.confirmed = remembered[m.confirmKey];
        m.remembered = true;
        if (m.confirmed && m.tier === 'review') m.tier = 'auto';
        if (m.confirmed === false) m.tier = 'none';
      }
    }
    matches = matches.filter(m => m.tier !== 'none');

    for (const m of matches) m.evidence = buildEvidence(m, reg, roster);

    const { adjourned, attending, noticeOnly } = applyAdjournments(matches, reposted, reg, ledger);

    /* §6.6.1 rule 4 — an adjournment notice whose original date matches no
       loaded cause list is stated plainly, never applied silently. */
    if (reposted.length && !items.length)
      notes.push({ level: 'warn', text:
        'An adjournment notice was loaded but no cause list was. Matters can only be identified from your register, so anything not in it cannot be named.' });

    const views = buildViews(attending, roster);
    const tier = t => attending.filter(m => m.tier === t);
    const shown = m => m.tier === 'auto' || m.tier === 'review';

    return {
      matches: attending, adjourned, noticeOnly, views, reposted,
      register: reg, roster,
      counts: {
        auto: tier('auto').length,
        review: tier('review').length,
        weak: tier('weak').length,
        /* Weak adjourned rows are counted with the other weak matches, not
           here. A number on the summary strip has to mean the same thing
           everywhere: "matters of yours that will not be called today". A
           sweep fragment scoring weak against a subject-matter line is not
           one of those, and inflating the count with them would make the
           strip untrustworthy on exactly the figure it exists to convey. */
        adjourned: adjourned.filter(shown).length + (noticeOnly ? noticeOnly.length : 0),
        adjournedWeak: adjourned.filter(m => m.tier === 'weak').length,
        courts: new Set(attending.filter(shown).map(m => m.item.court)).size,
        items: items.length,
        pages: pageCount,
        ocrPages
      },
      notes, badPages, probes, cappedRanges: capped, ocrUnavailable,
      date: input.date || null
    };
  }

  CO.engine = {
    run, matchItem, buildEvidence, buildViews, applyAdjournments,
    indexRegister, caseNumberSignal, cnrSignal, enrolmentSignal, partySignal,
    textSim, hash, confirmKey, CANON_ROWS
  };

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
