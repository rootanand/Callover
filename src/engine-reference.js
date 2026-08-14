/* ============================================================
   CAUSE LIST MATCHER - core engine
   Pure functions, no DOM, no network. Tested in node, then
   embedded verbatim into the single-file SPA.
   ============================================================ */

/* ---------- 1. TEXT NORMALISATION ---------- */

const TITLE_RE = /\b(M\/S|MS|MR|MRS|MISS|THIRU|TMT|SELVI|SHRI|SRI|SMT|DR|ADV|ADVOCATE|LEARNED|COUNSEL|SENIOR|SR|PROF)\b/g;
const ROLE_RE  = /\b(FOR|APPEARING|ON BEHALF OF|TAKES NOTICE|ACCEPTS NOTICE|GP|SPP|SGP|AGP|PP|SC|ASG|AAG|GOVERNMENT PLEADER|PUBLIC PROSECUTOR|STANDING COUNSEL|AMICUS|CURIAE|PARTY IN PERSON|PIP)\b/g;

// OCR confusions, applied only inside the relevant slot
const OCR_TO_DIGIT = { O:'0', Q:'0', D:'0', I:'1', L:'1', '|':'1', Z:'2', S:'5', B:'8', G:'6', T:'7', A:'4' };
const OCR_TO_ALPHA = { '0':'O', '1':'I', '5':'S', '8':'B', '6':'G', '2':'Z', '4':'A', '7':'T' };

function stripDiacritics(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function upperClean(raw){
  let s = stripDiacritics(String(raw||'')).toUpperCase();
  s = s.replace(/\u2019|\u2018|`/g, "'");
  return s;
}

/** Split a raw advocate string into initials + core name tokens. */
function splitName(raw){
  let s = upperClean(raw);
  s = s.replace(/^M\/S\.?\s*/,'');
  s = s.replace(TITLE_RE,' ');
  s = s.replace(ROLE_RE,' ');
  s = s.replace(/\bR-?\d+\b|\bD-?\d+\b|\bP-?\d+\b/g,' ');   // R1, D8, P-2 markers
  s = s.replace(/[^A-Z. ]/g,' ');
  const toks = s.split(/[.\s]+/).filter(Boolean);
  const initials = toks.filter(t=>t.length===1);
  const core     = toks.filter(t=>t.length>1);
  return { initials, core, raw:String(raw||'').trim() };
}

/** Tamil / Indic transliteration folding -> consonant skeleton. */
const FOLD_RULES = [
  ['KSH','X'],['CHH','S'],['SHH','S'],['THH','T'],
  ['KH','K'],['GH','G'],['CH','S'],['TH','T'],['DH','D'],['PH','F'],
  ['BH','B'],['JH','J'],['SH','S'],['ZH','L'],['NG','N'],['NY','N'],
  ['OO','U'],['EE','I'],['AA','A'],['AI','I'],['AU','O'],['OU','O'],
  ['W','V'],['Y','I'],['Z','S'],['Q','K'],['X','KS']
];
function foldIndic(s){
  let t = upperClean(s).replace(/[^A-Z]/g,'');
  for(const [a,b] of FOLD_RULES) t = t.split(a).join(b);
  t = t.replace(/(.)\1+/g,'$1');          // collapse doubles
  t = t.replace(/[AEIOU]/g,'');           // consonant skeleton
  return t;
}

/** Canonical case number. ocr=true folds char confusions per slot. */
function normCaseNo(raw, ocr){
  let s = upperClean(raw).replace(/\./g,'');
  s = s.replace(/\b(OF|NO|NOS|SL|CASE|YEAR)\b/g,' ');
  s = s.replace(/NO(?=\d)/g,' ');
  s = s.replace(/[^A-Z0-9]/g,' ').replace(/\s+/g,' ').trim();
  const m = s.match(/([A-Z0-9]{1,8})\s*([0-9OILSBGZQD]{1,7})\s*([0-9OILSBGZQD]{4})/);
  if(!m) return s;
  let [,typ,num,yr] = m;
  if(ocr){
    num = [...num].map(c=>OCR_TO_DIGIT[c]??c).join('');
    yr  = [...yr ].map(c=>OCR_TO_DIGIT[c]??c).join('');
    typ = [...typ].map(c=>OCR_TO_ALPHA[c]??c).join('');
  }
  const n = parseInt(num,10);
  if(!isNaN(n)) num = String(n);
  return `${typ}/${num}/${yr}`;
}

/* ---------- 2. STRING DISTANCE ---------- */

function levenshtein(a,b,cap){
  if(a===b) return 0;
  const la=a.length, lb=b.length;
  if(!la) return lb; if(!lb) return la;
  if(cap!=null && Math.abs(la-lb)>cap) return cap+1;
  let prev=new Array(lb+1), cur=new Array(lb+1);
  for(let j=0;j<=lb;j++) prev[j]=j;
  for(let i=1;i<=la;i++){
    cur[0]=i; let best=cur[0];
    const ca=a.charCodeAt(i-1);
    for(let j=1;j<=lb;j++){
      const cost = ca===b.charCodeAt(j-1)?0:1;
      cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost);
      if(cur[j]<best) best=cur[j];
    }
    if(cap!=null && best>cap) return cap+1;
    const t=prev; prev=cur; cur=t;
  }
  return prev[lb];
}

function ratio(a,b){
  if(!a && !b) return 1;
  if(!a || !b) return 0;
  const d = levenshtein(a,b);
  return 1 - d/Math.max(a.length,b.length);
}

function jaroWinkler(s1,s2){
  if(s1===s2) return 1;
  const l1=s1.length,l2=s2.length;
  if(!l1||!l2) return 0;
  const win=Math.max(0,Math.floor(Math.max(l1,l2)/2)-1);
  const m1=new Array(l1).fill(false), m2=new Array(l2).fill(false);
  let m=0;
  for(let i=0;i<l1;i++){
    const lo=Math.max(0,i-win), hi=Math.min(i+win+1,l2);
    for(let j=lo;j<hi;j++){
      if(m2[j]||s1[i]!==s2[j]) continue;
      m1[i]=m2[j]=true; m++; break;
    }
  }
  if(!m) return 0;
  let k=0,tr=0;
  for(let i=0;i<l1;i++){
    if(!m1[i]) continue;
    while(!m2[k]) k++;
    if(s1[i]!==s2[k]) tr++;
    k++;
  }
  tr/=2;
  const j=(m/l1 + m/l2 + (m-tr)/m)/3;
  let p=0;
  while(p<4 && p<l1 && p<l2 && s1[p]===s2[p]) p++;
  return j + p*0.1*(1-j);
}

/** Best alignment of two token lists (order-independent). */
function tokenSetScore(A,B){
  if(!A.length || !B.length) return 0;
  const used=new Set(); let tot=0;
  for(const a of A){
    let best=0,bi=-1;
    B.forEach((b,i)=>{
      if(used.has(i)) return;
      const s=Math.max(ratio(a,b), ratio(foldIndic(a),foldIndic(b)));
      if(s>best){best=s;bi=i;}
    });
    if(bi>=0) used.add(bi);
    tot+=best;
  }
  return tot/Math.max(A.length,B.length);
}

/* ---------- 3. INITIALS ---------- */

// Keyboard neighbours + visually/phonetically confusable initials
const KEY_ADJ = {
  A:'QSZW', B:'VGHN', C:'XDFV', D:'SERFCX', E:'WSDR', F:'DRTGVC',
  G:'FTYHBV', H:'GYUJNB', I:'UJKO', J:'HUIKNM', K:'JIOLM', L:'KOP',
  M:'NJK', N:'BHJM', O:'IKLP', P:'OL', Q:'WA', R:'EDFT', S:'AWEDXZ',
  T:'RFGY', U:'YHJI', V:'CFGB', W:'QASE', X:'ZSDC', Y:'THGU', Z:'ASX'
};
const LOOKALIKE = { B:'8PR', D:'OQ', E:'F', G:'6C', I:'1JL', J:'I', L:'I1',
                    M:'N', N:'MH', O:'0DQ', P:'RB', Q:'OG', R:'PB', S:'5',
                    U:'V', V:'UW', W:'V', Z:'2' };

function initialsCompare(qInits, cInits){
  const q=qInits.join(''), c=cInits.join('');
  if(!q && !c) return {state:'both-absent', score:0.5};
  if(q && !c)  return {state:'absent-in-list', score:0.45};
  if(!q && c)  return {state:'absent-in-query', score:0.45};
  if(q===c)    return {state:'exact', score:1.0};
  // one is a subset/prefix of the other: "E" vs "E.S", "ML" vs "M"
  if(q.startsWith(c) || c.startsWith(q)) return {state:'partial', score:0.8};
  if([...q].every(ch=>c.includes(ch)) || [...c].every(ch=>q.includes(ch)))
    return {state:'subset', score:0.75};
  // same length, single character differs -> possible typo/flip
  if(q.length===c.length){
    let diff=[], i;
    for(i=0;i<q.length;i++) if(q[i]!==c[i]) diff.push(i);
    if(diff.length===1){
      const a=q[diff[0]], b=c[diff[0]];
      const near = (KEY_ADJ[a]||'').includes(b) || (LOOKALIKE[a]||'').includes(b)
                || (KEY_ADJ[b]||'').includes(a) || (LOOKALIKE[b]||'').includes(a);
      return near ? {state:'flip-plausible', score:0.5}
                  : {state:'flip-other',     score:0.12};
    }
    // transposed initials: "SM" vs "MS"
    if([...q].sort().join('')===[...c].sort().join(''))
      return {state:'transposed', score:0.7};
  }
  return {state:'different', score:0.15};
}

/* ---------- 4. ADVOCATE NAME SCORE ---------- */

function nameScore(query, candidate){
  const q=splitName(query), c=splitName(candidate);
  if(!q.core.length || !c.core.length) return null;

  const qCoreStr=q.core.join(' '), cCoreStr=c.core.join(' ');
  const qFold=foldIndic(qCoreStr), cFold=foldIndic(cCoreStr);

  const rawSim  = Math.max(ratio(qCoreStr.replace(/ /g,''), cCoreStr.replace(/ /g,'')),
                           jaroWinkler(qCoreStr.replace(/ /g,''), cCoreStr.replace(/ /g,'')));
  const foldSim = qFold && cFold ? Math.max(ratio(qFold,cFold), jaroWinkler(qFold,cFold)) : 0;
  // A join/split ("Thamarai Selvan" vs "Thamaraiselvan") is not a mismatch, so
  // token alignment must not be penalised for differing token counts alone.
  const tokSim  = Math.max(
      tokenSetScore(q.core, c.core),
      ratio(qCoreStr.replace(/ /g,''), cCoreStr.replace(/ /g,''))
  );

  // First-letter guard. Transliteration never changes the leading sound,
  // so GANESH/VIGNESH must not survive vowel-stripping as a near-match.
  const headOK = q.core.some(qt => c.core.some(ct =>
        qt[0]===ct[0] || (foldIndic(qt)[0]||'')===(foldIndic(ct)[0]||'')));

  // core similarity: the gate
  let core = 0.30*rawSim + 0.40*foldSim + 0.30*tokSim;
  if(!headOK) core *= 0.55;

  const ini = initialsCompare(q.initials, c.initials);

  // Core must be strong. Initials modulate, they do not rescue.
  let combined = core * (0.62 + 0.38*ini.score);

  return {
    combined, core, rawSim, foldSim, tokSim,
    initials: ini, qFold, cFold,
    qCore:qCoreStr, cCore:cCoreStr
  };
}

/* ---------- 5. THRESHOLDS ---------- */
const T = { AUTO:0.86, REVIEW:0.68, WEAK:0.58, CORE_GATE:0.72 };

function classify(sc, opts){
  if(!sc) return 'none';
  const gate = (opts&&opts.ocr) ? T.CORE_GATE-0.06 : T.CORE_GATE;
  if(sc.core < gate) return 'none';
  const auto = (opts&&opts.ocr) ? T.AUTO-0.04 : T.AUTO;
  if(sc.combined >= auto && (sc.initials.state==='exact'||sc.initials.state==='partial'))
    return 'auto';
  if(sc.combined >= (opts&&opts.ocr ? T.REVIEW-0.04 : T.REVIEW)) return 'review';
  // 'weak' is kept and retrievable, but hidden behind a toggle so the
  // confirm list stays short. Nothing is ever silently discarded.
  if(sc.combined >= (opts&&opts.ocr ? T.WEAK-0.04 : T.WEAK)) return 'weak';
  return 'none';
}

if(typeof module!=='undefined') module.exports={
  splitName, foldIndic, normCaseNo, nameScore, classify, initialsCompare,
  ratio, jaroWinkler, tokenSetScore, levenshtein, T
};
