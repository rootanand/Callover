/* ============================================================================
   Callover — 80-ui.js
   TDD.md §8. Rendering, state and events.

   Two deliberate departures from the mock in ui-design.html, both requested:

     1. The privacy band moves from directly under the app bar to the foot of
        the page, immediately above the footer. The permanent green pill
        "NOTHING LEAVES THIS DEVICE" stays in the app bar, before the date, so
        the claim is made at first glance; the full statement — the three
        specifics and the "disconnect and run it" invitation — is read after
        the reader knows what the tool does. §8.1a's four placements are
        unchanged in number and in content.
     2. Export offers a PDF alongside Excel, CSV and Print, because that is the
        format a chamber actually circulates.

   Everything drawn from a PDF, a register or a filename is written with
   textContent, never innerHTML. A cause list is untrusted input arriving from
   a court website, and this is a tool for handling privileged material.
   ========================================================================= */
;(function (CO) {
  'use strict';
  if (typeof document === 'undefined') return;      // node: nothing to mount

  /* ---------------------------------------------------------------- DOM */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;             // literal markup only
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.appendChild(typeof kid === 'string' || typeof kid === 'number'
        ? document.createTextNode(String(kid)) : kid);
    }
    return n;
  }
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const $ = id => document.getElementById(id);

  function say(msg) {
    const live = $('callover-live');
    if (live) live.textContent = msg;
  }

  /* ---------------------------------------------------------------- state */
  const S = {
    date: new Date().toISOString().slice(0, 10),
    chamberName: '',
    remember: false,
    ledgerOn: false,
    advocateMode: 'text',
    advocateText: '',
    advocates: [],
    advocateMapping: null,
    register: null,
    files: [],
    thorough: true,
    showWeak: false,
    running: false,
    progress: null,
    results: null,
    tab: 'advocate',
    cursor: 0,
    openDrawer: null,
    profileLoaded: false,
    error: null
  };
  CO.state = S;

  /* ======================================================================
     APP BAR  — §8.2
     ================================================================== */
  function appBar() {
    return el('div', { class: 'appbar' },
      el('div', { class: 'in' },
        el('div', { class: 'wordmark' },
          el('span', { class: 'big', text: 'C' }), el('span', { class: 'sm', text: 'ALLOVER' }),
          el('small', { text: "Find your matters in today's list — before the day starts" })),
        el('div', { class: 'spacer' }),
        /* §8.1a placement 1 — small, green, permanent, and before the date. */
        el('span', { class: 'offline', title: 'Callover makes no network request while it runs.' },
          '● NOTHING LEAVES THIS DEVICE'),
        el('label', { class: 'datefield' },
          el('span', { text: '📅', 'aria-hidden': 'true' }),
          el('span', { class: 'vh', text: 'Date of the list' }),
          el('input', {
            type: 'date', value: S.date,
            onchange: e => { S.date = e.target.value; }
          })),
        el('button', { class: 'btn ghost sm', onclick: openSettings }, 'Settings'),
        el('button', {
          class: 'btn primary', id: 'co-run', onclick: run,
          disabled: !canRun() || S.running
        }, S.running ? 'Reading…' : 'Run callover')));
  }

  const canRun = () => S.advocates.length > 0 && S.files.length > 0;

  /* ======================================================================
     STEP 1 — ADVOCATES  — §6.1
     ================================================================== */
  function step1() {
    const bd = el('div', { class: 'bd' });

    if (S.profileLoaded && S.chamberName)
      bd.appendChild(el('div', { class: 'saved' },
        el('span', { class: 'ic', text: '✓' }),
        el('span', {}, el('b', { text: S.chamberName }),
          ` — ${S.advocates.length} advocate${S.advocates.length === 1 ? '' : 's'}, remembered on this device. Loaded automatically.`),
        el('button', { class: 'btn link', onclick: openSettings }, 'Manage')));

    bd.appendChild(el('div', { class: 'tabsm', role: 'tablist' },
      el('button', { class: S.advocateMode === 'text' ? 'on' : '', role: 'tab',
        'aria-selected': S.advocateMode === 'text',
        onclick: () => { S.advocateMode = 'text'; render(); } }, 'Type or paste'),
      el('button', { class: S.advocateMode === 'file' ? 'on' : '', role: 'tab',
        'aria-selected': S.advocateMode === 'file',
        onclick: () => { S.advocateMode = 'file'; render(); } }, 'Upload file')));

    if (S.advocateMode === 'text') {
      const ta = el('textarea', {
        'aria-label': 'One advocate per line',
        placeholder: 'E. Ganesh\nE. Srikanth\nD. Lokeshwaran',
        oninput: e => {
          S.advocateText = e.target.value;
          const p = CO.io.parseAdvocateText(S.advocateText);
          S.advocates = p.advocates;
          const btn = $('co-run'); if (btn) btn.disabled = !canRun() || S.running;
          const cnt = $('co-advcount');
          if (cnt) cnt.textContent = S.advocates.length
            ? `${S.advocates.length} advocate${S.advocates.length === 1 ? '' : 's'} read.` : '';
        }
      });
      ta.value = S.advocateText;
      bd.appendChild(ta);
      bd.appendChild(el('p', { class: 'hint', id: 'co-advcount' },
        S.advocates.length ? `${S.advocates.length} advocate${S.advocates.length === 1 ? '' : 's'} read.` : ''));
    } else {
      bd.appendChild(fileButton('.txt,.csv,.tsv,.xlsx,.xls', 'Choose an advocate list',
        async f => {
          try {
            const p = await CO.io.readAdvocateFile(f);
            S.advocates = p.advocates; S.advocateMapping = p;
            S.advocateText = p.advocates.map(a => a.name).join('\n');
            say(`${p.advocates.length} advocates read from ${f.name}.`);
          } catch (e) { S.error = `${f.name} could not be read: ${e.message}`; }
          render();
        }));
      if (S.advocateMapping) bd.appendChild(mappingTable(S.advocateMapping));
    }

    if (S.advocates.length)
      bd.appendChild(el('table', { style: 'margin-top:14px' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Advocate' }), el('th', { text: 'Enrolment' }), el('th', { text: 'Role' }), el('th', {}))),
        el('tbody', {}, S.advocates.map((a, i) => el('tr', {},
          el('td', { class: 'k', text: a.name }),
          el('td', { class: 'mono', text: a.enrolment || '—' }),
          el('td', { text: a.role || '—' }),
          el('td', {}, el('button', {
            class: 'btn link', 'aria-label': `Remove ${a.name}`,
            onclick: () => { S.advocates.splice(i, 1); S.advocateText = S.advocates.map(x => x.name).join('\n'); render(); }
          }, 'Remove')))))));

    bd.appendChild(el('p', { class: 'hint' },
      el('strong', { text: 'Enter everyone in the chamber, not just the arguing counsel.' },),
      ' Two of your names on the same matter is itself strong evidence — it rescues a match when one name is misspelt.'));

    return stepBox(1, 'Your advocates', 'REQUIRED', bd);
  }

  /* ======================================================================
     STEP 2 — CASE REGISTER  — §6.2, §6.7.2
     ================================================================== */
  function step2() {
    const bd = el('div', { class: 'bd' });
    const r = S.register;

    if (!r) {
      bd.appendChild(fileButton('.csv,.tsv,.xlsx,.xls', 'Choose your case register',
        async f => {
          try {
            S.register = await CO.io.readRegisterFile(f);
            say(`${S.register.cases.length} matters read from ${f.name}.`);
          } catch (e) { S.error = `${f.name} could not be read: ${e.message}`; }
          render();
        }));
    } else {
      bd.appendChild(el('div', { class: 'filerow' },
        el('span', { class: 'nm', text: r.sourceFilename || 'register' }),
        el('span', { style: 'font-size:13.5px;color:var(--muted)',
          text: `${r.cases.length} matters · ${r.cases.length} case numbers built` }),
        el('button', { class: 'btn ghost sm', onclick: () => { S.register = null; render(); } }, 'Remove')));

      bd.appendChild(el('p', { class: 'eyebrow', style: 'margin:15px 0 8px', text: 'COLUMNS DETECTED AUTOMATICALLY' }));
      const rows = [];
      const sample = r.cases[0] || {};
      const show = [
        ['CaseType / CaseNo / Year', 'case number', sample.caseKey],
        ['CNR', 'CNR', sample.cnr],
        ['CauseTitle', 'cause title', sample.causeTitle],
        ['DiaryNo', 'diary no', sample.diaryNo],
        ['CounselFor', 'your side', sample.counselFor],
        ['NextStage', 'next stage', sample.nextStage]
      ];
      for (const [col, as, ex] of show) {
        if (!ex) continue;
        rows.push(el('tr', {},
          el('td', { class: 'k', text: col }),
          el('td', {}, el('span', { class: 'mapped', text: as })),
          el('td', { class: 'mono', text: String(ex).slice(0, 60) })));
      }
      bd.appendChild(el('table', {},
        el('thead', {}, el('tr', {},
          el('th', { style: 'width:30%', text: 'Your column' }),
          el('th', { style: 'width:24%', text: 'Used as' }),
          el('th', { text: 'Example' }))),
        el('tbody', {}, rows)));

      bd.appendChild(el('p', { class: 'hint' },
        'Without this, every confirmation rests on the name alone. With it, most questions answer themselves.'));

      /* §6.7.2 — the register's age is shown permanently, never behind a
         settings page, because a stale register fails invisibly. */
      const age = CO.io.registerAge(r);
      if (age && age.text)
        bd.appendChild(el('div', { class: 'stale' + (age.level === 'red' ? ' red' : '') },
          el('span', { class: 'ic', text: '!' }),
          el('span', { text: age.text })));
      else if (age)
        bd.appendChild(el('p', { class: 'hint', text: `Loaded today · ${r.cases.length} matters.` }));
    }

    /* §8.1a placement 3 — reassurance exactly where the anxiety occurs. */
    bd.appendChild(el('div', { class: 'safe' },
      el('span', { class: 'ic', text: '●' }),
      el('span', {}, 'This is the file that matters. It holds ',
        el('b', { text: 'client names, phone numbers and fee entries' }),
        '. It is opened inside your browser and never transmitted, never cached on any server, never seen by anyone but you.')));

    return stepBox(2, 'Your case register', 'OPTIONAL — BUT IT CHANGES EVERYTHING', bd);
  }

  /* ======================================================================
     STEP 3 — CAUSE LISTS  — §6.3, §5.9, §5.11
     ================================================================== */
  function step3() {
    const bd = el('div', { class: 'bd' });

    const drop = el('div', { class: 'drop', tabindex: '0', role: 'button' },
      el('b', { text: 'Drop cause list PDFs here' }),
      'High Court, district courts, tribunals — any layout. Or click to choose.');
    const pick = el('input', { type: 'file', accept: '.pdf', multiple: true, class: 'vh',
      onchange: e => { addFiles([...e.target.files]); e.target.value = ''; } });
    drop.addEventListener('click', () => pick.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('over');
      addFiles([...e.dataTransfer.files].filter(f => /\.pdf$/i.test(f.name)));
    });
    bd.appendChild(drop); bd.appendChild(pick);

    if (S.files.length) {
      const list = el('div', { style: 'margin-top:14px' });
      S.files.forEach((f, i) => {
        const sel = el('select', {
          class: 'typesel' + (f.typeOverride === 'auto' ? ' auto' : ''),
          'aria-label': `How to read ${f.name}`,
          onchange: e => { f.typeOverride = e.target.value; render(); }
        }, CO.DOC_TYPES.map(t => el('option', { value: t.id, selected: f.typeOverride === t.id },
          t.id === 'auto' && f.detected
            ? `${labelFor(f.detected)} — detected ✓`
            : t.label)));

        list.appendChild(el('div', { class: 'filerow' },
          el('span', { class: 'nm', text: f.name }),
          el('span', { style: 'font-size:13px;color:var(--muted)', text: sizeText(f.size) }),
          sel,
          /* §6.3 / §1.1 — the app records what the user asserts. It cannot
             verify this and must not pretend to, so the wording is always
             "marked as official by you", never "verified". */
          el('label', { class: 'chk' },
            el('input', { type: 'checkbox', checked: f.official,
              onchange: e => { f.official = e.target.checked; } }),
            'I downloaded this from the official court portal'),
          el('button', { class: 'btn link', 'aria-label': `Remove ${f.name}`,
            onclick: () => { S.files.splice(i, 1); render(); } }, 'Remove')));
      });
      bd.appendChild(list);
      bd.appendChild(el('p', { class: 'hint' },
        'The type is detected for you and can be changed. Only that reader runs — matching a High Court layout against a tribunal list produces noise, not silence.'));
    }

    /* §5.11 — the trade is stated in one line rather than hidden. */
    bd.appendChild(el('label', { class: 'thorough' },
      el('input', { type: 'checkbox', checked: S.thorough,
        onchange: e => { S.thorough = e.target.checked; } }),
      el('span', {}, el('b', { text: 'Thorough reading.' }),
        ' Any page that is not read cleanly the first time is read again a second way, including by picture-reading. Slower on difficult files, and it catches more.')));

    bd.appendChild(el('div', { class: 'safe' },
      el('span', { class: 'ic', text: '●' }),
      el('span', {}, '“Uploaded” here means ', el('b', { text: 'uploaded into this page' }),
        ', not to the internet. Scanned pages are read by an offline text engine bundled with the app — the images never go to a cloud service.')));

    return stepBox(3, 'Cause list PDFs', 'REQUIRED · ANY COURT, ANY NUMBER', bd);
  }

  const labelFor = id => (CO.DOC_TYPES.find(t => t.id === id) || {}).label || id;
  const sizeText = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';

  async function addFiles(files) {
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      S.files.push({ id: 'f' + S.files.length, name: f.name, size: f.size, bytes,
                     official: false, typeOverride: 'auto', detected: null });
    }
    render();
    /* Detect the type straight away so the dropdown is pre-filled before the
       run, per §5.9 step 2. */
    for (const f of S.files) {
      if (f.detected || f.typeOverride !== 'auto') continue;
      try {
        const doc = await CO.pdfio.open(f.bytes);
        let sample = '';
        for (let n = 1; n <= Math.min(2, doc.numPages); n++) {
          const tc = await (await doc.getPage(n)).getTextContent();
          sample += tc.items.map(i => i.str).join(' ') + '\n';
        }
        CO.pdfio.close(doc);
        const det = CO.extract.detectDocType(sample);
        f.detected = det.id; f.detectConfident = det.confident; f.detectWhy = det.why;
      } catch (e) { f.detected = null; f.detectWhy = 'This file could not be opened: ' + e.message; }
    }
    render();
  }

  function stepBox(n, title, opt, body) {
    return el('div', { class: 'step' },
      el('div', { class: 'hd' },
        el('span', { class: 'n', text: String(n) }),
        el('h3', { text: title }),
        el('span', { class: 'opt', text: opt })),
      body);
  }

  function fileButton(accept, label, handler) {
    const inp = el('input', { type: 'file', accept, class: 'vh',
      onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) handler(f); } });
    const btn = el('button', { class: 'btn ghost', onclick: () => inp.click() }, label);
    return el('div', {}, btn, inp);
  }

  function mappingTable(p) {
    const rows = Object.entries(p.mapping || {}).map(([field, i]) =>
      el('tr', {}, el('td', { class: 'k', text: field }),
        el('td', {}, el('span', { class: 'mapped', text: 'column ' + (Number(i) + 1) })),
        el('td', { text: p.scores && p.scores[field] ? `matched ${(p.scores[field] * 100).toFixed(0)}%` : 'assumed' })));
    return el('div', {}, el('p', { class: 'eyebrow', style: 'margin:15px 0 8px', text: 'COLUMNS DETECTED' }),
      el('table', {}, el('tbody', {}, rows)));
  }

  /* ======================================================================
     PORTAL LINKS  — §6.4
     ================================================================== */
  function portals() {
    return el('details', { class: 'links' },
      el('summary', {}, el('h4', { style: 'display:inline', text: "Download today's lists from the courts" })),
      el('p', {}, 'These open the court’s own page in a new tab. You solve the picture-code there, download the PDF and drop it above. ',
        el('strong', { text: 'Callover never connects to the courts itself.' })),
      el('div', { class: 'linkgrid' }, CO.PORTALS.map(p =>
        el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow', title: p.note }, p.label))));
  }

  /* ======================================================================
     RUNNING  — §5, progress per §8.2
     ================================================================== */
  async function run() {
    if (!canRun() || S.running) return;
    S.running = true; S.error = null; S.results = null; S.progress = { pages: 0, of: 0, ocr: 0, items: 0, file: '', t0: Date.now() };
    render();
    say('Reading. This runs entirely on this device.');

    try {
      const docs = [];
      for (const f of S.files) {
        S.progress.file = f.name;
        const d = await CO.extract.readDocument(
          { name: f.name, bytes: f.bytes, official: f.official, typeOverride: f.typeOverride },
          {
            roster: S.advocates, thorough: S.thorough,
            onProgress: p => {
              if (p.phase === 'read') { S.progress.pages++; S.progress.of = p.of; }
              if (p.phase === 'ocr' && p.detail && p.detail.status === 'recognizing text') S.progress.ocrLive = p.page;
              if (p.phase === 'match') S.progress.items = p.items;
              paintProgress();
            }
          });
        d.ocrPages.forEach(() => S.progress.ocr++);
        docs.push(d);
      }

      S.results = CO.engine.run({
        advocates: S.advocates,
        register: S.register ? S.register.cases : null,
        documents: docs,
        date: S.date,
        remembered: CO.io.memory.all(),
        ledger: S.ledgerOn ? await CO.io.ledger.load() : null
      });
      S.results.registerMeta = S.register;
      S.results.staleWarning = S.register ? CO.io.registerAge(S.register) : null;

      if (S.ledgerOn) await CO.io.ledger.record(S.results);
      if (S.remember) await saveProfile();

      const c = S.results.counts;
      say(`Done. ${c.auto} matched, ${c.review} to confirm, ${c.adjourned} adjourned.`);
    } catch (e) {
      S.error = 'Something went wrong while reading: ' + (e && e.message ? e.message : e);
      say(S.error);
    } finally {
      S.running = false; S.cursor = 0;
      render();
      const q = $('co-confirm') || $('co-summary');
      if (q) q.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function paintProgress() {
    const p = S.progress; if (!p) return;
    const bar = $('co-bar'); if (bar && p.of) bar.style.width = Math.min(100, p.pages / p.of * 100) + '%';
    const set = (id, v) => { const n = $(id); if (n) n.textContent = String(v); };
    set('co-p-pages', p.pages); set('co-p-ocr', p.ocr); set('co-p-items', p.items);
    set('co-p-el', Math.round((Date.now() - p.t0) / 1000) + 's');
    const f = $('co-p-file'); if (f) f.textContent = p.file;
  }

  function progressPanel() {
    const p = S.progress;
    return el('div', { class: 'prog' },
      el('div', { style: 'display:flex;align-items:baseline;gap:12px;flex-wrap:wrap' },
        el('strong', { style: 'font-family:var(--display);font-size:17px' }, 'Reading ',
          el('span', { id: 'co-p-file', text: p.file })),
        el('span', { class: 'mono', style: 'font-size:12px;color:#B5B0A6;margin-left:auto',
          text: p.of ? `page ${p.pages} of ${p.of}` : 'opening…' })),
      el('div', { class: 'bar' }, el('i', { id: 'co-bar' })),
      el('div', { class: 'st' },
        el('span', {}, 'pages read ', el('b', { id: 'co-p-pages', text: String(p.pages) })),
        el('span', {}, 'picture-read ', el('b', { id: 'co-p-ocr', text: String(p.ocr) })),
        el('span', {}, 'items found ', el('b', { id: 'co-p-items', text: String(p.items) })),
        el('span', {}, 'elapsed ', el('b', { id: 'co-p-el', text: '0s' }))));
  }

  /* ======================================================================
     SUMMARY, DUAL PASS
     ================================================================== */
  function summary() {
    const c = S.results.counts;
    const card = (cls, v, l) => el('div', { class: 'sc ' + cls },
      el('div', { class: 'v', text: String(v) }), el('div', { class: 'l', text: l }));
    return el('div', { class: 'summary', id: 'co-summary' },
      card('a', c.auto, 'Matched — your matters'),
      card('r', c.review, 'Need your confirmation'),
      card('w', c.weak, 'Weak — hidden, retrievable'),
      card('j', c.adjourned, 'Adjourned — not today'),
      card('f', c.courts, 'Courts involved'));
  }

  function dualPass() {
    const R = S.results;
    let a = 0, b = 0;
    for (const m of R.matches.concat(R.adjourned)) (m.matchRole === 'unplaced' ? (b++) : (a++));

    const box = el('div', { class: 'dual' },
      el('h4', { text: 'Every page was read twice' }),
      el('p', { text: 'Once by column, and once ignoring columns entirely. Two readings that fail differently cannot both fail quietly.' }),
      el('div', { class: 'passes' },
        el('div', { class: 'pass' },
          el('div', { class: 'nm', text: 'READING 1 — BY COLUMN' }),
          el('div', { class: 'big', text: String(a) }),
          el('div', { class: 'd' }, 'Found in a column that carries advocate names. In High Court lists that is the counsel column; ',
            el('strong', { text: 'in HR&CE lists it is either party column' }),
            ', where the advocate is printed after “through”. Tiered normally.')),
        el('div', { class: 'pass b' },
          el('div', { class: 'nm', text: 'READING 2 — WHOLE PAGE, NO COLUMNS' }),
          el('div', { class: 'big', text: String(b) }),
          el('div', { class: 'd' }, 'Your names found ', el('strong', { text: 'somewhere else on the page' }),
            ' — a remarks line, a temple name, or a page whose columns would not separate. Could be a listing we would otherwise have missed. Always asked about, never guessed.'))));

    /* §5.8a0.3 — the probe result is shown, so a wrong reading is visible
       rather than silent. */
    const det = el('details');
    det.appendChild(el('summary', { text: 'See how each file was read' }));
    for (const p of R.probes) {
      det.appendChild(el('h4', { style: 'margin-top:14px;font-size:15px', text: p.file }));
      det.appendChild(el('p', { class: 'hint', text: `Read as: ${labelFor(p.docType)}. ${p.typeWhy || ''}` }));
      for (const sig of p.signatures) {
        det.appendChild(el('table', { class: 'probetable', style: 'margin-top:8px' },
          el('thead', {}, el('tr', {},
            el('th', { text: 'Column' }), el('th', { text: 'Role used' }),
            el('th', { text: 'Cells' }), el('th', { text: 'With a connector' }), el('th', { text: 'Why' }))),
          el('tbody', {}, sig.columns.map(c => el('tr', {},
            el('td', { class: 'k', text: c.column }),
            el('td', {}, el('span', { class: c.role === 'counsel' || c.role === 'party+counsel' ? 'mapped' : '', text: c.role })),
            el('td', { class: 'mono', text: String(c.cells) }),
            el('td', { class: 'mono', text: `${c.connectors} (${Math.round(c.density * 100)}%)` }),
            el('td', { text: c.why }))))));
      }
    }
    box.appendChild(det);

    if (R.badPages.length) {
      const bp = el('div', { class: 'badpages' },
        el('b', { text: `${R.badPages.length} page${R.badPages.length === 1 ? '' : 's'} could not be read cleanly.` }),
        ' Their layout did not come through, so anything found on them is being asked about rather than accepted.');
      const d2 = el('details');
      d2.appendChild(el('summary', { text: 'See those pages' }));
      for (const p of R.badPages) {
        d2.appendChild(el('p', { class: 'hint', text: `${p.file} — page ${p.page}: ${p.why}` }));
        if (p.text) d2.appendChild(el('div', { class: 'rawtext', text: p.text }));
      }
      bp.appendChild(d2);
      box.appendChild(bp);
    }

    if (R.cappedRanges && R.cappedRanges.length) {
      const d3 = el('details', { class: 'badpages' });
      d3.appendChild(el('summary', { text: `${R.cappedRanges.length} printed case-number range(s) were too wide to be real and were not expanded` }));
      for (const c of R.cappedRanges)
        d3.appendChild(el('p', { class: 'hint',
          text: `${c.file} page ${c.page}: ${c.type}.${c.from} to ${c.to}/${c.year || '?'} — ${c.members} matters. Read the page yourself.` }));
      box.appendChild(d3);
    }

    if (R.ocrUnavailable)
      box.appendChild(el('div', { class: 'badpages', text: 'Scanned pages: ' + R.ocrUnavailable }));

    return box;
  }

  /* ======================================================================
     CONFIRM QUEUE  — §7.2, §8.3

     The primary surface. An unconfirmed match is the only thing in the app
     that can still cause a missed appearance; accepted matches can wait,
     questions cannot.
     ================================================================== */
  function confirmQueue() {
    const R = S.results;
    const queue = R.matches.filter(m => m.tier === 'review' && m.confirmed == null);
    const weak  = R.matches.filter(m => m.tier === 'weak' && m.confirmed == null);
    if (!queue.length && !weak.length) return null;

    const box = el('div', { id: 'co-confirm' });
    if (queue.length) {
      box.appendChild(el('div', { class: 'cqhead' },
        el('h2', { text: 'Please confirm' }),
        el('span', { class: 'sub', text: 'Everything you need is on the card. Each answer is remembered.' }),
        el('span', { class: 'count', text: `${queue.length} QUESTION${queue.length === 1 ? '' : 'S'}` })));
      queue.forEach((m, i) => box.appendChild(confirmCard(m, i === S.cursor, false)));
    }

    /* §7.2.5 — weak cards use the identical evidence layout; only the
       ordering and the default visibility differ. Nothing is discarded. */
    box.appendChild(el('button', { class: 'hidden-toggle',
      onclick: () => { S.showWeak = !S.showWeak; render(); } },
      S.showWeak ? '▾ Hide weak matches'
        : `▸ Show ${weak.length} weak match${weak.length === 1 ? '' : 'es'} — unlikely, but nothing is ever discarded`));
    if (S.showWeak) weak.forEach(m => box.appendChild(confirmCard(m, false, true)));

    return box;
  }

  function confirmCard(m, focused, isWeak) {
    const ev = m.evidence;
    const card = el('div', { class: 'card' + (isWeak ? ' weak' : '') + (focused ? ' on' : ''),
      dataset: { matchId: m.id } });

    /* 1. The question. */
    card.appendChild(el('div', { class: 'q' },
      'Is ', el('code', { text: m.matchedText || '(no name read)' }),
      ' your ', el('code', { text: m.advocate ? m.advocate.name : (m.registerAdvocate || 'matter') }), '?'));

    /* 2. The decisive banner. When the case number is already in the register
          the name question is close to irrelevant, and the card says so. */
    if (ev.registerHit)
      card.appendChild(el('div', { class: 'decisive' },
        el('span', { class: 'ic', text: '✓' }),
        el('span', {}, 'This case number is already in your register — diary ',
          el('b', { text: ev.registerDiary || '—' }), '.'),
        el('span', { class: 'sub', text: 'The spelling of the name barely matters here. You are on record in this matter.' })));
    else if (m.identifiedBy !== 'name')
      card.appendChild(el('div', { class: 'decisive' },
        el('span', { class: 'ic', text: '✓' }),
        el('span', { text: m.identifiedBy === 'enrolment'
          ? 'Your enrolment number is printed on this item.'
          : 'This matter was identified by its number, not by a name. No advocate name on it could be read as one of yours.' }),
        el('span', { class: 'sub', text: 'The counsel line may be unreadable, or you may be appearing in person.' })));
    else if (m.matchRole === 'unplaced')
      card.appendChild(el('div', { class: 'decisive amber' },
        el('span', { class: 'ic', text: '!' }),
        el('span', { text: 'This page did not read cleanly. Your name is on it, but not where counsel normally sits.' }),
        el('span', { class: 'sub', text: 'Rather than drop it, we are asking. It may be a listing that would otherwise be missed.' })));
    else if (m.matchRole === 'party')
      card.appendChild(el('div', { class: 'decisive amber' },
        el('span', { class: 'ic', text: '!' }),
        el('span', { text: 'Your name is printed as a party to this matter, not as counsel on it.' }),
        el('span', { class: 'sub', text: '“You are appearing” and “you are a party” are not the same thing, so this is flagged rather than assumed.' })));

    if (m.adjourned)
      card.appendChild(el('div', { class: 'decisive amber' },
        el('span', { class: 'ic', text: '!' }),
        el('span', {}, 'This matter has been reposted to ',
          el('b', { text: m.adjourned.repostedTo || 'a date that could not be read' }),
          m.adjourned.repostedTime ? ' at ' + m.adjourned.repostedTime : '', '.'),
        m.adjourned.dateConfidence === 'inferred'
          ? el('span', { class: 'sub', text: 'That date was inferred from the position of the row, not read from a ruled cell. Check it against the notice before relying on it.' })
          : null));

    /* 3. The comparison table — the largest element on the card, because that
          is what the decision rests on. */
    card.appendChild(el('table', { class: 'cmp' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Field' }), el('th', { text: "In today's list" }),
        el('th', { text: 'In your register' }), el('th', {}, el('span', { class: 'vh', text: 'Verdict' })))),
      el('tbody', {}, ev.rows.map(r => {
        const hero = ev.decisiveField && r.field === ev.decisiveField;
        return el('tr', { class: hero ? 'hero' : '' },
          el('td', { class: 'f', text: r.label }),
          el('td', { class: 'val' },
            el('span', { class: 'm', text: r.inList || '—' }),
            r.note ? el('span', { class: 'note', text: r.note }) : null),
          el('td', { class: 'reg' + (r.inRegister == null ? ' dim' : '') },
            el('span', { class: 'm', text: r.inRegister == null ? 'Nothing to compare' : r.inRegister })),
          el('td', { class: 'v' }, el('span', { class: 'vd ' + r.verdict, text: verdictWord(r) })));
      }))));

    /* 4. Colleagues. */
    if (ev.colleagues.length)
      card.appendChild(el('div', { class: 'colleague' },
        el('span', { class: 'ic', text: '✓' }),
        el('span', {}, el('b', { text: ev.colleagues.join(', ') }),
          ev.colleagues.length === 1 ? ' is also printed on this item — also one of yours.'
                                     : ' are also printed on this item — also yours.')));
    else if (!ev.registerHit)
      card.appendChild(el('div', { class: 'colleague warn' },
        el('span', { class: 'ic', text: '!' }),
        el('span', {}, 'None of your other advocates appear on this item, and this case number is not in your register. ',
          el('strong', { text: 'If this is yours, it is a matter you may not have on your books.' }))));

    if (m.sideMismatch)
      card.appendChild(el('div', { class: 'colleague warn' },
        el('span', { class: 'ic', text: '!' }), el('span', { text: m.sideMismatch })));

    /* 5. The verbatim excerpt. */
    if (ev.pdfExcerpt)
      card.appendChild(el('div', { class: 'excerpt' },
        el('span', { class: 'eyebrow', text: 'VERBATIM FROM THE PDF' }),
        highlighted(ev.pdfExcerpt, ev.highlightSpans)));

    /* 6. Provenance. 7. Yes / No.
          No numeric confidence anywhere on this card — a number invites the
          advocate to defer to the score instead of reading the evidence
          (§7.2.3, Decision D12). */
    card.appendChild(el('div', { class: 'cardfoot' },
      el('div', { class: 'prov' },
        el('span', { text: `${m.item.sourceFile} · page ${m.item.page}` }),
        el('span', { text: `${m.item.court || 'court not stated'}${m.item.hall ? ' · hall ' + m.item.hall : ''}${m.item.itemNo ? ' · item ' + m.item.itemNo : ''}` }),
        el('span', { text: m.wasOCR ? 'picture-read' : 'text layer' }),
        el('span', { text: m.item.sourceIsOfficial ? 'marked as official by you' : 'uploaded' })),
      el('div', { class: 'acts' },
        el('button', { class: 'btn sm yes', onclick: () => decide(m, true) },
          'Yes, this is ours', el('span', { class: 'kbd', text: 'Y' })),
        el('button', { class: 'btn sm no', onclick: () => decide(m, false) },
          'No', el('span', { class: 'kbd', text: 'N' })))));

    return card;
  }

  function verdictWord(r) {
    if (r.verdict === 'agree') return 'AGREE';
    if (r.verdict === 'differ') return 'DIFFERS';
    if (r.field === 'caseNumber' && r.inRegister === 'Not in your register') return 'NO MATCH';
    return 'ABSENT';
  }

  function highlighted(text, spans) {
    const pre = el('pre');
    if (!spans || !spans.length) { pre.textContent = text; return pre; }
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [s, e] of sorted) {
      if (s < at || s > text.length) continue;
      pre.appendChild(document.createTextNode(text.slice(at, s)));
      pre.appendChild(el('mark', { text: text.slice(s, Math.min(e, text.length)) }));
      at = Math.min(e, text.length);
    }
    pre.appendChild(document.createTextNode(text.slice(at)));
    return pre;
  }

  function decide(m, yes) {
    m.confirmed = yes;
    if (m.confirmKey) CO.io.memory.set(m.confirmKey, yes);
    if (yes) m.tier = 'auto';
    else m.tier = 'none';
    S.results.matches = S.results.matches.filter(x => x.tier !== 'none');
    S.results.views = CO.engine.buildViews(S.results.matches, S.advocates);
    const c = S.results.counts;
    c.auto = S.results.matches.filter(x => x.tier === 'auto').length;
    c.review = S.results.matches.filter(x => x.tier === 'review').length;
    c.weak = S.results.matches.filter(x => x.tier === 'weak').length;
    say(yes ? 'Recorded as yours. You will not be asked about this spelling again.'
            : 'Recorded as not yours.');
    render();
  }

  /* ======================================================================
     RESULT VIEWS  — §7.1, §8.5
     ================================================================== */
  function results() {
    const R = S.results;
    const box = el('div');

    for (const n of R.notes)
      box.appendChild(el('div', { class: 'banner ' + (n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info'),
        text: n.text }));

    /* §6.6.1 — adjourned matters render in their own section, never in the
       day's attendance list and never in the "listed today" count. */
    if (R.adjourned.length || (R.noticeOnly && R.noticeOnly.length))
      box.appendChild(adjournedView());

    if (!R.matches.length) {
      box.appendChild(el('div', { class: 'empty' },
        el('b', { text: 'None of your advocates appear in these lists.' }),
        `Callover read ${R.counts.pages} page${R.counts.pages === 1 ? '' : 's'} and found ${R.counts.items} listed matters. ` +
        'That is the difference between nothing being listed and nothing being parsed — the pages were read.'));
      return box;
    }

    const tabs = [['advocate', 'By advocate'], ['court', 'By court'], ['case', 'By case'], ['all', 'Everything']];
    box.appendChild(el('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
      el('button', { class: S.tab === id ? 'on' : '', role: 'tab', 'aria-selected': S.tab === id,
        onclick: () => { S.tab = id; render(); } }, label))));

    if (S.tab === 'advocate') box.appendChild(byAdvocateView());
    if (S.tab === 'court')    box.appendChild(byCourtView());
    if (S.tab === 'case')     box.appendChild(byCaseView());
    if (S.tab === 'all')      box.appendChild(allView());
    return box;
  }

  const visible = m => m.tier === 'auto' || m.tier === 'review' || (S.showWeak && m.tier === 'weak');

  function byAdvocateView() {
    const wrap = el('div');
    for (const b of S.results.views.byAdvocate) {
      const ms = b.matches.filter(visible);
      if (!ms.length) continue;
      const block = el('div', { class: 'advblock' },
        el('div', { class: 'ah' },
          el('h4', { text: b.advocate.name }),
          b.advocate.enrolment ? el('span', { class: 'en', text: b.advocate.enrolment }) : null,
          el('span', { class: 'ct', text: `${ms.length} MATTER${ms.length === 1 ? '' : 'S'}` })));
      for (const m of ms) block.appendChild(matchRow(m, m.alsoUnder));
      wrap.appendChild(block);
    }
    if (S.results.views.orphans.length) {
      const block = el('div', { class: 'advblock' },
        el('div', { class: 'ah' },
          el('h4', { text: 'Matched by case number only' }),
          el('span', { class: 'en', text: 'no advocate name could be read' }),
          el('span', { class: 'ct', text: `${S.results.views.orphans.length} MATTERS` })));
      for (const m of S.results.views.orphans.filter(visible)) block.appendChild(matchRow(m));
      wrap.appendChild(block);
    }
    return wrap;
  }

  function byCourtView() {
    const wrap = el('div');
    for (const c of S.results.views.byCourt)
      for (const h of c.halls) {
        const ms = h.matches.filter(visible);
        if (!ms.length) continue;
        const block = el('div', { class: 'advblock' },
          el('div', { class: 'ah' },
            el('h4', { text: c.court }),
            el('span', { class: 'en', text: h.hall === '—' ? 'hall not stated' : 'Hall ' + h.hall }),
            el('span', { class: 'ct', text: `${ms.length} MATTER${ms.length === 1 ? '' : 'S'}` })));
        for (const m of ms) block.appendChild(matchRow(m));
        wrap.appendChild(block);
      }
    return wrap;
  }

  function byCaseView() {
    const wrap = el('div', { class: 'advblock' });
    wrap.appendChild(el('div', { class: 'ah' }, el('h4', { text: 'One row per matter' }),
      el('span', { class: 'en', text: 'every advocate of yours on it, together' })));
    for (const c of S.results.views.byCase) {
      const ms = c.matches.filter(visible);
      if (!ms.length) continue;
      wrap.appendChild(matchRow(ms[0], c.advocates.length > 1 ? c.advocates : null, c.advocates.join(', ')));
    }
    return wrap;
  }

  function allView() {
    const wrap = el('div', { class: 'advblock' });
    wrap.appendChild(el('div', { class: 'ah' }, el('h4', { text: 'Everything' }),
      el('span', { class: 'en', text: 'flat, in the order it was read' })));
    for (const m of S.results.matches.filter(visible)) wrap.appendChild(matchRow(m));
    return wrap;
  }

  function matchRow(m, alsoUnder, advocatesText) {
    const it = m.item;
    const loc = [];
    if (it.court) loc.push(it.court);
    if (it.hall) loc.push('Hall ' + it.hall);
    if (m.identifiedBy !== 'name') loc.push(m.identifiedBy === 'enrolment'
      ? 'matched on your enrolment number' : 'matched on the case number, no advocate name readable');
    else if (m.matchRole === 'counsel') loc.push('appearing' + (m.side !== 'unknown' ? ' · ' + m.side : '') + (m.sideDetail ? ', for ' + m.sideDetail : ''));
    else if (m.matchRole === 'party') loc.push('YOU ARE A PARTY, NOT COUNSEL');
    else if (m.matchRole === 'unplaced') loc.push('found outside the counsel column');
    if (m.registerCase && m.registerCase.diaryNo) loc.push('diary ' + m.registerCase.diaryNo);
    if (m.registerCase && m.registerCase.nextStage) loc.push('next stage: ' + m.registerCase.nextStage);
    if (advocatesText) loc.push(advocatesText);

    const right = el('div', {},
      el('span', { class: 'tier ' + m.tier, text: m.tier === 'auto' ? 'MATCHED' : m.tier === 'review' ? 'TO CONFIRM' : 'WEAK' }),
      alsoUnder && alsoUnder.length
        ? el('span', { class: 'dupe', text: 'also under ' + alsoUnder.join(', ') }) : null,
      m.matchRole === 'party' ? el('span', { class: 'dupe red', text: 'you are a party' }) : null,
      m.remembered ? el('span', { class: 'dupe', text: 'you confirmed this before' }) : null);

    const row = el('button', { class: 'row', type: 'button',
      onclick: () => { S.openDrawer = S.openDrawer === m.id ? null : m.id; render(); } },
      el('div', { class: 'item' }, it.itemNo ? el('span', {}, 'ITEM', el('b', { text: it.itemNo })) : el('span', { text: '—' })),
      el('div', {},
        el('div', { class: 'cn', text: (it.caseNumbers || []).join(', ') || '—' }),
        el('div', { class: 'tt', text: [it.petitioner, it.respondent].filter(Boolean).join(' — vs — ') }),
        el('div', { class: 'loc', text: loc.join(' · ') })),
      right);

    if (S.openDrawer !== m.id) return row;

    /* §8.4 — accepted rows earn the click-through. The drawer carries the same
       Evidence object, plus the signal list and the numeric confidence that
       the confirm card is forbidden to show. */
    const drawer = el('div', { class: 'drawer' },
      el('p', { class: 'eyebrow', text: 'WHY THIS MATCHED' }),
      el('table', {}, el('tbody', {}, m.signals.map(s => el('tr', {},
        el('td', { class: 'k', text: s.kind }),
        el('td', { text: s.detail }),
        el('td', { class: 'mono', text: s.score.toFixed(2) }))))),
      el('p', { class: 'hint', text: `Confidence ${(m.confidence * 100).toFixed(1)}% · read by pass ${m.foundBy}` +
        (m.confirmedByBothPasses ? ' and confirmed by the structure-blind sweep' : '') }),
      el('table', { class: 'cmp' }, el('tbody', {}, m.evidence.rows.map(r => el('tr', {},
        el('td', { class: 'f', text: r.label }),
        el('td', { class: 'val' }, el('span', { class: 'm', text: r.inList || '—' }),
          r.note ? el('span', { class: 'note', text: r.note }) : null),
        el('td', { class: 'reg', text: r.inRegister == null ? 'Nothing to compare' : r.inRegister }),
        el('td', { class: 'v' }, el('span', { class: 'vd ' + r.verdict, text: verdictWord(r) })))))),
      m.evidence.pdfExcerpt ? el('div', { class: 'excerpt' },
        el('span', { class: 'eyebrow', text: 'VERBATIM FROM THE PDF' }),
        highlighted(m.evidence.pdfExcerpt, m.evidence.highlightSpans)) : null);

    return el('div', {}, row, drawer);
  }

  function adjournedView() {
    const R = S.results;
    const rows = R.adjourned.filter(visible);
    const hidden = R.adjourned.length - rows.length;
    const block = el('div', { class: 'advblock', style: 'border-color:var(--red)' },
      el('div', { class: 'ah', style: 'background:var(--red-t)' },
        el('h4', { text: 'Not being heard today — adjourned' }),
        el('span', { class: 'en', text: 'these are NOT in the matched count, and no one should be sent to them' }),
        el('span', { class: 'ct', text: `${rows.length + (R.noticeOnly || []).length} MATTERS` })));

    for (const m of rows) {
      const a = m.adjourned;
      block.appendChild(el('div', { class: 'row', style: 'cursor:default' },
        el('div', { class: 'item' }, el('span', {}, 'ITEM', el('b', { text: m.item.itemNo || '—' }))),
        el('div', {},
          el('div', { class: 'cn', text: (m.item.caseNumbers || []).join(', ') }),
          el('div', { class: 'tt', text: [m.item.petitioner, m.item.respondent].filter(Boolean).join(' — vs — ') }),
          el('div', { class: 'loc', text: `${m.item.court || ''} · from ${a.sourceFile}` +
            (m.registerCase ? ' · diary ' + m.registerCase.diaryNo : '') })),
        el('div', { style: 'text-align:right' },
          el('div', { class: 'cn', style: 'color:var(--red)',
            text: a.repostedTo ? a.repostedTo + (a.repostedTime ? ' at ' + a.repostedTime : '') : 'date not read' }),
          a.dateConfidence === 'inferred'
            ? el('span', { class: 'dupe red', text: 'date inferred — confirm' })
            : el('span', { class: 'tier auto', text: 'FROM A RULED CELL' }))));
    }

    for (const n of (R.noticeOnly || [])) {
      const rc = n.registerCase || n.ledgerEntry || {};
      block.appendChild(el('div', { class: 'row', style: 'cursor:default' },
        el('div', { class: 'item' }, el('span', { text: '—' })),
        el('div', {},
          el('div', { class: 'cn', text: n.caseKey }),
          el('div', { class: 'tt', text: rc.causeTitle || 'Identified from your ' + n.identifiedFrom }),
          el('div', { class: 'loc', text: `Not on any cause list you loaded · identified from your ${n.identifiedFrom}` +
            (rc.diaryNo ? ' · diary ' + rc.diaryNo : '') })),
        el('div', { style: 'text-align:right' },
          el('div', { class: 'cn', style: 'color:var(--red)',
            text: n.reposted.repostedTo ? n.reposted.repostedTo + (n.reposted.repostedTime ? ' at ' + n.reposted.repostedTime : '') : 'date not read' }))));
    }

    /* Weak adjourned rows are hidden behind the same toggle as weak matches,
       and counted with them. Hidden, never discarded (C4). */
    if (hidden)
      block.appendChild(el('button', { class: 'hidden-toggle',
        onclick: () => { S.showWeak = !S.showWeak; render(); } },
        `▸ ${hidden} further adjourned matter${hidden === 1 ? '' : 's'} matched only weakly — show them`));

    return block;
  }

  /* ======================================================================
     "HOW CALLOVER CAN PROMISE THIS"  — §8.1a placement 4
     ================================================================== */
  function howSafe() {
    const qa = [
      ['Where does the matching happen?', 'Entirely inside your browser tab, in ordinary JavaScript. The same place a spreadsheet formula runs.'],
      ['Where do my files go?', 'Nowhere. The browser reads them from your disk into memory. When you close the tab, that memory is gone.'],
      ['Is any AI service involved?', 'None. The matching is fixed, published rules — not a model, not an API. Identical input always gives identical output.'],
      ['What is stored between visits?', 'Only what you asked to be stored: the spellings you confirmed, and — if you ticked the box — your roster and register. You can view and delete all of it in Settings.'],
      ['Does it need the internet at all?', 'Only to load the page the first time. After that, no — and you can save the page and work permanently offline.']
    ];
    return el('div', { class: 'howsafe' },
      el('h3', { text: 'How Callover can promise this' }),
      el('p', { text: 'Not a policy, and not a pledge to be taken on trust. It is a consequence of how the thing is built — and every line of it is open source, so you can check.' }),
      el('table', {}, el('tbody', {}, qa.map(([q, a]) =>
        el('tr', {}, el('td', { class: 'q', text: q }), el('td', { text: a }))))),
      /* §8.1a — naming a limit is what makes the rest believable. */
      el('p', { class: 'caveat' },
        el('b', { text: 'Said plainly, including the limits: ' }),
        'the exported Excel, CSV or PDF is an ordinary file on your machine, so from that point its safety is in your hands. ',
        'Callover cannot see the court portals — you fetch the lists yourself, which is a deliberate design choice, not a shortcoming. ',
        'And it cannot verify that a file really came from a court: where a list is marked official, that is your word, recorded as your word.'));
  }

  /* ======================================================================
     EXPORT  — §7.3 plus the requested PDF
     ================================================================== */
  function exportBar() {
    const R = S.results;
    const guard = fn => () => {
      try { fn(R, R.staleWarning, { chamberName: S.chamberName }); }
      catch (e) { S.error = 'Export failed: ' + e.message; render(); }
    };
    return el('div', { class: 'exportbar' },
      el('span', { class: 'lbl', text: 'Take it with you' }),
      el('button', { class: 'btn', onclick: guard(CO.io.exporter.xlsx) }, 'Excel — every view'),
      el('button', { class: 'btn', onclick: guard(CO.io.exporter.pdf) }, 'PDF'),
      el('button', { class: 'btn ghost', onclick: guard(CO.io.exporter.csv) }, 'CSV'),
      el('button', { class: 'btn ghost', onclick: () => CO.io.exporter.print() }, 'Print'),
      el('span', { class: 'note', text: 'Nothing left this device. No file was uploaded anywhere.' }));
  }

  /* ======================================================================
     PRIVACY BAND  — §8.1a placement 2, moved to the foot of the page
     ================================================================== */
  function privacyBand() {
    const lock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lock.setAttribute('class', 'lock'); lock.setAttribute('viewBox', '0 0 19 23');
    lock.setAttribute('aria-hidden', 'true');
    lock.innerHTML = '<path d="M4 9V6a5.5 5.5 0 0 1 11 0v3" stroke="#2F6B4F" stroke-width="2.2" ' +
      'stroke-linecap="round" fill="none"/><rect x="1.5" y="9" width="16" height="12.5" rx="2.5" ' +
      'fill="#2F6B4F"/><circle cx="9.5" cy="15.2" r="1.7" fill="#F4F1E8"/>';

    const spec = (b, s) => el('div', {}, el('b', { text: b }), el('span', { text: s }));

    return el('div', { class: 'privacy' }, el('div', { class: 'in' },
      el('div', { class: 'claim' }, lock, 'Nothing you open here leaves this device.'),
      el('p', { class: 'sub', text: 'Your case register carries client names, phone numbers and fee entries. Callover reads it inside your browser and sends it nowhere — because there is nowhere for it to be sent.' }),
      el('div', { class: 'specs' },
        spec('No upload', 'The PDFs and your register are opened by the browser itself, the way a document opens on your desk. No copy is transmitted.'),
        spec('No account', 'No sign-in, no email address, no licence key. Nobody — including us — has any record that you used it.'),
        spec('Saved on this device only, if you ask for it', 'Your advocate list, your register and the spellings you confirmed. Nothing is transmitted. Erase it all from Settings.'),
        spec('No server', 'There is nothing at the other end to store anything. Close the tab and nothing remains except the file you chose to export.')),
      /* The most important line on the page: a claim the reader can falsify in
         ten seconds is worth more than any badge. If a future feature breaks
         offline operation, this line comes down first and the feature is
         reconsidered. (Decision D16.) */
      el('div', { class: 'verify' },
        el('span', { class: 'ic', text: '→' }),
        el('span', {}, 'Don’t take our word for it. ',
          el('b', { text: 'Disconnect from the internet and run it.' }),
          ' It works exactly the same — which is only possible because nothing was ever being sent.'))));
  }

  /* ======================================================================
     FOOTER  — §8.1 attribution, footer only
     ================================================================== */
  function footer() {
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('width', '76'); mark.setAttribute('height', '62');
    mark.setAttribute('viewBox', '0 0 146 126');
    mark.setAttribute('aria-label', 'The Forensic Brief');
    mark.innerHTML = '<g transform="translate(5,3)"><path d="M23,17 h10 a7,7 0 0 1 7,7 v82 a7,7 0 0 1 -7,7 ' +
      'h-10 a7,7 0 0 1 -7,-7 v-82 a7,7 0 0 1 7,-7 z M19.5,65 a8.5,8.5 0 1 0 17.0,0 a8.5,8.5 0 1 0 -17.0,0 z ' +
      'M22.6,38 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z M22.6,92 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z ' +
      'M65,17 h10 a7,7 0 0 1 7,7 v82 a7,7 0 0 1 -7,7 h-10 a7,7 0 0 1 -7,-7 v-82 a7,7 0 0 1 7,-7 z ' +
      'M61.5,65 a8.5,8.5 0 1 0 17.0,0 a8.5,8.5 0 1 0 -17.0,0 z M64.6,29 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z ' +
      'M64.6,101 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z M107,17 h10 a7,7 0 0 1 7,7 v82 a7,7 0 0 1 -7,7 ' +
      'h-10 a7,7 0 0 1 -7,-7 v-82 a7,7 0 0 1 7,-7 z M103.5,65 a8.5,8.5 0 1 0 17.0,0 a8.5,8.5 0 1 0 -17.0,0 z ' +
      'M106.6,46 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z M106.6,84 a5.4,5.4 0 1 0 10.8,0 a5.4,5.4 0 1 0 -10.8,0 z" ' +
      'fill="#F4F1E8" fill-rule="evenodd"/><line x1="2" y1="65" x2="132" y2="65" stroke="#C4635B" stroke-width="3.6"/>' +
      '<path d="M133,65 l-10,-5.5 l0,11 z" fill="#C4635B"/></g>';

    return el('div', { class: 'sitefoot' }, el('div', { class: 'in' },
      el('div', { class: 'pw', text: 'POWERED BY' }),
      el('div', { class: 'fbmark' }, mark,
        el('div', { style: 'text-align:left' },
          el('div', { class: 'fbword' },
            el('span', { class: 'b', text: 'T' }), el('span', { class: 's', text: 'HE' }), ' ',
            el('span', { class: 'b', text: 'F' }), el('span', { class: 's', text: 'ORENSIC' }), ' ',
            el('span', { class: 'b', text: 'B' }), el('span', { class: 's', text: 'RIEF' })),
          /* A plain hyperlink. No tracking pixel, no script, no referrer
             beacon — the page carries meta referrer=no-referrer. (§8.1a.) */
          el('a', { class: 'fbtag', href: 'https://theforensicbrief.com',
            target: '_blank', rel: 'noopener noreferrer' }, 'theforensicbrief.com'))),
      el('div', { class: 'legal' },
        el('span', { text: 'Callover is free and open source · MIT' }),
        el('span', { text: 'Runs entirely in your browser · no upload · no account · no server' }),
        el('span', {}, el('a', { href: '#', onclick: e => { e.preventDefault(); openSettings(); } },
          'Saved on this device: roster, register, confirmed spellings — view or erase')),
        el('span', {}, el('a', { href: 'https://github.com/rootanand/Callover',
          target: '_blank', rel: 'noopener noreferrer' }, 'Source on GitHub')))));
  }

  /* ======================================================================
     SETTINGS  — §6.7.1, §7.2.4, T10-07, T14-06
     ================================================================== */
  async function openSettings() {
    const dlg = $('co-settings') || el('dialog', { id: 'co-settings' });
    clear(dlg);
    const inv = await CO.io.profile.inventory().catch(() => ({ profile: null, ledger: null, confirmations: [] }));

    const body = el('div', { class: 'db' });

    body.appendChild(el('div', { class: 'setrow' },
      el('h4', { text: 'Remember this chamber on this device' }),
      el('p', { text: 'Stores your advocate list, your case register and the spellings you have confirmed in this browser’s own storage on this computer. Nothing is transmitted. There is no account and no server.' }),
      el('label', { class: 'chk' },
        el('input', { type: 'checkbox', checked: S.remember,
          onchange: async e => { S.remember = e.target.checked; if (S.remember) await saveProfile(); render(); } }),
        'Remember'),
      el('div', { style: 'margin-top:8px' },
        el('label', {}, 'Chamber name ',
          el('input', { type: 'text', value: S.chamberName, placeholder: 'e.g. Kanchi Chambers',
            oninput: e => { S.chamberName = e.target.value; } })))));

    body.appendChild(el('div', { class: 'setrow' },
      el('h4', { text: 'Keep a ledger of what Callover has seen' }),
      el('p', { text: 'Separate from your register, and off by default. The ledger remembers case numbers, titles and dates from previous runs, so an adjournment notice can still be identified when no matching cause list is loaded. It is the only thing that accumulates client data you did not deliberately upload.' }),
      el('label', { class: 'chk' },
        el('input', { type: 'checkbox', checked: S.ledgerOn,
          onchange: e => { S.ledgerOn = e.target.checked; } }),
        `Keep a ledger${inv.ledger ? ` (${inv.ledger.length} matters remembered)` : ''}`),
      inv.ledger && inv.ledger.length
        ? el('button', { class: 'btn ghost sm', style: 'margin-left:10px',
            onclick: async () => { await CO.io.ledger.erase(); say('Ledger erased.'); openSettings(); } }, 'Erase the ledger')
        : null));

    /* T10-07 — the panel lists every stored confirmation, and deleting one
       removes it. A wrong Yes must be undoable. */
    const conf = el('div', { class: 'setrow' },
      el('h4', { text: 'Remembered spellings' }),
      el('p', { text: 'Every question you have already answered, so you are not asked twice. Revoke one and the question comes back.' }));
    if (!inv.confirmations.length) conf.appendChild(el('p', { class: 'hint', text: 'Nothing remembered yet.' }));
    else conf.appendChild(el('table', {}, el('tbody', {}, inv.confirmations.map(c =>
      el('tr', {},
        el('td', { class: 'mono', text: c.key.replace(CO.STORE.CONFIRM_PREFIX, '') }),
        el('td', { text: c.value ? 'Yes, ours' : 'No, not ours' }),
        el('td', {}, el('button', { class: 'btn link',
          onclick: () => { CO.io.memory.revoke(c.key.replace(CO.STORE.CONFIRM_PREFIX, '')); openSettings(); } },
          'Revoke')))))));
    body.appendChild(conf);

    body.appendChild(el('div', { class: 'setrow' },
      el('h4', { text: 'Move this chamber to another machine' }),
      el('p', { text: 'Export writes one JSON file you can carry on a stick or hand to a junior. Import reads it back. The profile is never trapped inside one browser.' }),
      el('button', { class: 'btn ghost sm', onclick: exportProfile }, 'Export profile'),
      ' ',
      el('label', { class: 'btn ghost sm', style: 'display:inline-flex;align-items:center' }, 'Import profile',
        el('input', { type: 'file', accept: '.json', class: 'vh',
          onchange: async e => {
            const f = e.target.files[0]; e.target.value = '';
            if (!f) return;
            try {
              const p = CO.io.profile.fromJSON(await f.text());
              applyProfile(p); await CO.io.profile.save(p);
              say('Profile imported.'); dlg.close(); render();
            } catch (err) { alert('That file could not be read as a chamber profile: ' + err.message); }
          } }))));

    body.appendChild(el('div', { class: 'setrow' },
      el('h4', { text: 'Erase everything stored on this device' }),
      el('p', { text: 'Removes the profile, the register, the ledger and every remembered spelling. It cannot be undone, and it affects only this browser on this computer.' }),
      el('button', { class: 'btn', style: 'background:var(--red);border-color:var(--red);color:#fff',
        onclick: async () => {
          if (!confirm('Erase the chamber profile, the register, the ledger and every remembered spelling from this browser? This cannot be undone.')) return;
          const removed = await CO.io.profile.erase();
          S.remember = false; S.profileLoaded = false; S.chamberName = '';
          say(`Erased ${removed.indexedDB.length} stored record(s) and ${removed.localStorage.length} remembered answer(s).`);
          dlg.close(); render();
        } }, 'Erase everything')));

    dlg.appendChild(el('div', { class: 'dh' }, el('h3', { text: 'Settings — what is stored on this device' })));
    dlg.appendChild(body);
    dlg.appendChild(el('div', { class: 'df' },
      el('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')));
    if (!dlg.isConnected) document.body.appendChild(dlg);
    dlg.showModal();
  }

  async function saveProfile() {
    await CO.io.profile.save({
      chamberName: S.chamberName,
      advocates: S.advocates.map(a => ({ id: a.id, name: a.name, enrolment: a.enrolment, role: a.role })),
      register: S.register ? {
        cases: S.register.cases, uploadedAt: S.register.uploadedAt,
        sourceFilename: S.register.sourceFilename, rowCount: S.register.cases.length
      } : null,
      ledgerOn: S.ledgerOn
    });
  }

  function applyProfile(p) {
    S.chamberName = p.chamberName || '';
    S.advocates = (p.advocates || []).map(a => CO.io.makeAdvocate(a.name, a.enrolment, a.role));
    S.advocateText = S.advocates.map(a => a.name).join('\n');
    S.register = p.register ? Object.assign({}, p.register) : null;
    S.ledgerOn = !!p.ledgerOn;
    S.remember = true;
    S.profileLoaded = true;
  }

  function exportProfile() {
    const json = CO.io.profile.toJSON({
      chamberName: S.chamberName,
      advocates: S.advocates.map(a => ({ name: a.name, enrolment: a.enrolment, role: a.role })),
      register: S.register ? {
        cases: S.register.cases, uploadedAt: S.register.uploadedAt,
        sourceFilename: S.register.sourceFilename, rowCount: S.register.cases.length
      } : null,
      confirmations: CO.io.memory.all(),
      ledgerOn: S.ledgerOn,
      savedAt: new Date().toISOString()
    });
    CO.io.download(new Blob([json], { type: 'application/json' }),
      `callover-chamber-${(S.chamberName || 'profile').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.json`);
  }

  /* ======================================================================
     KEYBOARD  — §8.6
     ================================================================== */
  function onKey(e) {
    if (!S.results) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (document.querySelector('dialog[open]')) return;

    const queue = S.results.matches.filter(m => m.tier === 'review' && m.confirmed == null);
    if (!queue.length) return;
    const cur = queue[Math.min(S.cursor, queue.length - 1)];

    if (CO.KEYS.accept.includes(e.key)) { e.preventDefault(); decide(cur, true); }
    else if (CO.KEYS.reject.includes(e.key)) { e.preventDefault(); decide(cur, false); }
    else if (CO.KEYS.next.includes(e.key)) {
      e.preventDefault(); S.cursor = Math.min(S.cursor + 1, queue.length - 1); render(); focusCursor();
    } else if (CO.KEYS.prev.includes(e.key)) {
      e.preventDefault(); S.cursor = Math.max(S.cursor - 1, 0); render(); focusCursor();
    } else if (CO.KEYS.help.includes(e.key)) {
      e.preventDefault();
      alert('Confirm queue keys\n\n  Y   yes, this matter is ours\n  N   no, it is not\n  ↓ or j   next question\n  ↑ or k   previous question\n  ?   this help');
    }
  }

  function focusCursor() {
    const cards = document.querySelectorAll('#co-confirm .card');
    const c = cards[S.cursor];
    if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ======================================================================
     RENDER
     ================================================================== */
  function render() {
    const root = $('callover-root');
    if (!root) return;
    const scroll = window.scrollY;
    clear(root);

    root.appendChild(appBar());

    const wrap = el('div', { class: 'wrap' });
    if (S.error) wrap.appendChild(el('div', { class: 'banner error', text: S.error }));

    if (!S.results || S.running) {
      wrap.appendChild(step1());
      wrap.appendChild(step2());
      wrap.appendChild(step3());
      wrap.appendChild(portals());
      wrap.appendChild(el('div', { class: 'runbar' },
        el('button', { class: 'btn primary', disabled: !canRun() || S.running, onclick: run },
          S.running ? 'Reading…' : 'Run callover'),
        !canRun() ? el('span', { class: 'hint',
          text: S.advocates.length ? 'Add at least one cause list PDF.' : 'Add at least one advocate.' }) : null));
      if (S.running) wrap.appendChild(progressPanel());
    } else {
      wrap.appendChild(el('div', { class: 'runbar' },
        el('button', { class: 'btn ghost', onclick: () => { S.results = null; render(); } }, '← Change the inputs'),
        el('button', { class: 'btn primary', onclick: run }, 'Run again')));
      wrap.appendChild(summary());
      if (S.results.staleWarning && S.results.staleWarning.text)
        wrap.appendChild(el('div', { class: 'banner ' + (S.results.staleWarning.level === 'red' ? 'error' : 'warn'),
          text: S.results.staleWarning.text + ' This warning is carried into anything you export.' }));
      wrap.appendChild(dualPass());
      const q = confirmQueue(); if (q) wrap.appendChild(q);
      wrap.appendChild(results());
      wrap.appendChild(howSafe());
      wrap.appendChild(exportBar());
    }

    root.appendChild(wrap);
    /* The two corrections: pill stays in the app bar, the band lands here. */
    root.appendChild(privacyBand());
    root.appendChild(footer());
    window.scrollTo(0, scroll);
  }
  CO.render = render;

  /* ======================================================================
     BOOT
     ================================================================== */

  /* pdf.js needs a worker. Over http(s) we hand it a real one built from the
     inlined worker source, so parsing never blocks the UI thread. Opened
     straight from a folder, a browser refuses to start a worker from an opaque
     origin, so the same source is evaluated on the main thread instead and
     pdf.js uses it as its message handler. Either way nothing is fetched, and
     C6 — openable with a double-click — survives. */
  function setupPdfWorker() {
    const lib = globalThis.pdfjsLib;
    const src = document.getElementById('callover-pdf-worker');
    if (!lib || !src) return 'none';
    const code = src.textContent;
    try {
      /* Probe first. Chrome throws synchronously when a blob worker is started
         from a file:// document, because the origin is opaque. */
      const probe = new Worker(URL.createObjectURL(
        new Blob(['self.postMessage(0)'], { type: 'text/javascript' })));
      probe.terminate();

      /* A blob URL of the worker source, reused for every worker we spawn.
         One worker per document — see the note on pdfio.workerFactory. */
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      CO.pdfio.workerFactory = () => new Worker(url);
      return 'worker';
    } catch (e) {
      /* Opened from a folder. Evaluate the worker source here instead; it
         registers globalThis.pdfjsWorker, which pdf.js uses as its message
         handler on the main thread. Slower, but it works offline from a
         double-click, which is constraint C6. */
      try { (0, eval)(code); CO.pdfio.workerFactory = null; return 'main-thread'; }
      catch (e2) { return 'none'; }
    }
  }

  async function boot() {
    CO.pdfMode = setupPdfWorker();
    try {
      const p = await CO.io.profile.load();
      if (p) { applyProfile(p); }
    } catch { /* no profile stored, or storage unavailable */ }
    render();
    document.addEventListener('keydown', onKey);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  CO.ui = { el, render, decide, openSettings, setupPdfWorker, state: S };

})(typeof globalThis !== 'undefined'
     ? (globalThis.Callover = globalThis.Callover || {})
     : (this.Callover = this.Callover || {}));

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Callover;
