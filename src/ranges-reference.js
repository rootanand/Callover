/* HRCE case-number range expansion.
   "R.P.384 to 387/2022"  ->  RP/384/2022 .. RP/387/2022
   Tested against every range string found in the four real HRCE files. */

const TYPE = '(?:[A-Z]{1,4}(?:\\.[A-Z]){0,3}\\.?|SMR|S\\.M\\.R\\.?|R\\.C\\.?|I\\.A\\.?|O\\.A\\.?|M\\.P\\.?)';

function cleanType(t){ return t.replace(/[^A-Z]/g,''); }

/** Expand one cause-list case cell into canonical keys. */
function expandCaseCell(raw){
  if(!raw) return [];
  let s = String(raw).toUpperCase()
    .replace(/\u00A0/g,' ')
    .replace(/\bNOS?\b\.?/g,' ')        // "R.P.Nos.243" -> "R.P. 243"
    .replace(/\bOF\b/g,'/')             // "R.P.17 of 2026" -> "R.P.17/2026"
    .replace(/\s*\/\s*/g,'/')           // "R.P.48 to 96/ 2023"
    .replace(/\s+/g,' ')
    .trim();

  const out = [];
  // Walk the string, tracking the most recent case-type prefix.
  // Segments are separated by commas; within a segment ranges use "to"/"-"
  // and enumerations use "and"/"&"/",".
  const segs = s.split(/,/);
  let lastType = null;

  for(let seg of segs){
    seg = seg.trim(); if(!seg) continue;

    // pull the type if this segment declares one
    const tm = seg.match(new RegExp('^(' + TYPE + ')\\s*'));
    let type = lastType;
    if(tm && /[A-Z]/.test(tm[1])){
      const t = cleanType(tm[1]);
      if(t){ type = t; seg = seg.slice(tm[0].length); }
    }
    if(!type) continue;
    lastType = type;

    // year is the trailing /YYYY  (may be absent -> inherit later)
    const ym = seg.match(/\/\s*(\d{4})\s*$/);
    let year = ym ? ym[1] : null;
    if(ym) seg = seg.slice(0, ym.index);

    // Split remaining into numeric tokens and range operators
    // e.g. "384 to 387"  |  "243 to 261 and 262"  |  "05 and 06"  |  "289 to 294"
    const parts = seg.split(/\s*(?:AND|&)\s*/);
    for(const part of parts){
      const p = part.trim(); if(!p) continue;
      const range = p.match(/^(\d+)\s*(?:TO|-|–|—)\s*(\d+)$/);
      if(range){
        const a = parseInt(range[1],10), b = parseInt(range[2],10);
        if(b >= a && (b-a) <= 500){
          for(let n=a;n<=b;n++) out.push({type, num:n, year});
        }
        continue;
      }
      const single = p.match(/^(\d+)$/);
      if(single){ out.push({type, num:parseInt(single[1],10), year}); continue; }
      // "R.P.103 to 121/2026" already handled; catch embedded type+num
      const tn = p.match(new RegExp('^(' + TYPE + ')\\s*(\\d+)$'));
      if(tn){ const t=cleanType(tn[1]); if(t){lastType=t;} out.push({type:t||type, num:parseInt(tn[2],10), year}); }
    }
  }

  // back-fill missing years from the nearest following entry that has one
  for(let i=out.length-1, y=null; i>=0; i--){
    if(out[i].year) y = out[i].year; else out[i].year = y;
  }
  return out.filter(e=>e.year).map(e=>`${e.type}/${e.num}/${e.year}`);
}

module.exports = { expandCaseCell };

/* ---------------- self-test ---------------- */
if(require.main === module){
  const CASES = [
    ['R.P.66/2022',                                   ['RP/66/2022']],
    ['R.P.66/2022, R.P.329/2022',                     ['RP/66/2022','RP/329/2022']],
    ['R.P.384 to 387/2022',                           ['RP/384/2022','RP/385/2022','RP/386/2022','RP/387/2022']],
    ['R.P.384 to 387/2022, A.P.141 to 144/2022',      ['RP/384/2022','RP/385/2022','RP/386/2022','RP/387/2022',
                                                       'AP/141/2022','AP/142/2022','AP/143/2022','AP/144/2022']],
    ['R.P.Nos.243 to 261 and 262/2022',               null],   // 20 keys, checked by count
    ['R.P.48 to 96/ 2023',                            null],   // 49 keys
    ['R.P.27 to 29/2025, R.P.88/2025',                ['RP/27/2025','RP/28/2025','RP/29/2025','RP/88/2025']],
    ['R.P.05 and 06/2026',                            ['RP/5/2026','RP/6/2026']],
    ['R.P.17 of 2026',                                ['RP/17/2026']],
    ['R.P.No.289 to 294 of 2026',                     ['RP/289/2026','RP/290/2026','RP/291/2026','RP/292/2026','RP/293/2026','RP/294/2026']],
    ['A.P.38 to 40/2026',                             ['AP/38/2026','AP/39/2026','AP/40/2026']],
    ['R.P.146 and 147/2026',                          ['RP/146/2026','RP/147/2026']],
    ['SMR.1/2025',                                    ['SMR/1/2025']],
    ['R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025', null], // 6+3+1=10
    ['R.P.Nos.412 to 428/2025, R.P.433/2025',         null],   // 17+1=18
    ['A.P.9/2021',                                    ['AP/9/2021']],
    ['R.P.212/2023, A.P.135/2022',                    ['RP/212/2023','AP/135/2022']],
    ['R.P.No.427 and 428/2024',                       ['RP/427/2024','RP/428/2024']],
  ];
  const EXPECT_COUNT = {
    'R.P.Nos.243 to 261 and 262/2022': 20,
    'R.P.48 to 96/ 2023': 49,
    'R.P.109 to 114/2025, R.P.125 to 127/2025, R.P.220/2025': 10,
    'R.P.Nos.412 to 428/2025, R.P.433/2025': 18,
  };
  let pass=0, fail=0;
  const pad=(s,n)=>String(s).padEnd(n).slice(0,n);
  console.log(pad('CELL AS PRINTED',56)+pad('GOT',7)+pad('WANT',7)+'RESULT');
  console.log('-'.repeat(96));
  for(const [cell, want] of CASES){
    const got = expandCaseCell(cell);
    let ok;
    if(want){ ok = JSON.stringify(got)===JSON.stringify(want); }
    else { ok = got.length === EXPECT_COUNT[cell]; }
    ok?pass++:fail++;
    const wc = want ? want.length : EXPECT_COUNT[cell];
    console.log(pad(cell,56)+pad(got.length,7)+pad(wc,7)+(ok?'ok':'FAIL  '+got.slice(0,6).join(' ')));
  }
  console.log('-'.repeat(96));
  console.log(`${pass}/${pass+fail} passed`);
  console.log('\nsample expansion of "R.P.Nos.243 to 261 and 262/2022":');
  console.log('  ', expandCaseCell('R.P.Nos.243 to 261 and 262/2022').join(' '));
}
