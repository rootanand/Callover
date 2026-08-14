#!/usr/bin/env node
/* ============================================================================
   tools/build.mjs — TDD.md §9.2

       node tools/build.mjs            build index.html
       node tools/build.mjs --check    build in memory and fail if index.html
                                       on disk differs (what CI runs)

   Reads tools/shell.html and fills the region between <!--BUILD:START--> and
   <!--BUILD:END--> with, in order:

       1. pdf.js                          converted from ESM to a classic script
       2. the pdf.js worker source        parked in a text/plain block
       3. SheetJS, jsPDF, jspdf-autotable already UMD, inlined verbatim
       4. src/NN-*.js                     in filename order

   No bundler, no npm install, no build step for the user. index.html is
   committed so a chamber can download one file and open it (Decision D10).

   Two deviations from §9.2, both deliberate and both visible here:

   * The shell lives in tools/shell.html rather than being edited in place
     inside the generated index.html. §9.2 describes editing between the
     markers, which is impractical once the file is two megabytes of inlined
     library. The markers still exist and still delimit the generated region.

   * Vendor libraries are INLINED rather than referenced as <script src>.
     §9.2 says relative script tags; C6 and Decision D10 say one file, opened
     by double-click. A relative <script src> works from file://, but pdf.js 4
     ships ES modules only, and a module script from file:// is blocked by
     CORS. Inlining as classic scripts satisfies both, and vendor/ stays in the
     repository unmodified so the inlined copy can be diffed against the
     published release. OCR is the exception and is still loaded from vendor/
     on demand, exactly as §2.1 requires.
   ========================================================================= */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR = join(ROOT, 'vendor');
const SRC    = join(ROOT, 'src');
const OUT    = join(ROOT, 'index.html');
const SHELL  = join(ROOT, 'tools', 'shell.html');

const read = p => readFileSync(p, 'utf8');
const fail = m => { console.error('\nbuild failed: ' + m + '\n'); process.exit(1); };

/* --------------------------------------------------------------------------
   Two ways inlined code can break out of its <script> element, and the build
   refuses rather than escaping and hoping:

     1. "</script" anywhere ends the element, whatever it is quoted inside.

     2. "<!--" puts the tokenizer into script-data-escaped state. On its own
        that is harmless — "</script>" still closes the element. It only
        becomes dangerous when a "<script" follows before the matching "-->",
        because that reaches script-data-DOUBLE-escaped state, where
        "</script>" no longer closes anything.

   SheetJS carries five "<!--" string literals and no "<script" at all; jsPDF
   carries two "<script" and no "<!--". Neither combination is a hazard, so
   testing for either token alone would refuse a build that is perfectly safe.
   ----------------------------------------------------------------------- */
function assertInlinable(name, code) {
  if (/<\/script/i.test(code))
    fail(`${name} contains "</script", which would end the script element early.`);
  const re = /<!--/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const close = code.indexOf('-->', m.index);
    const region = code.slice(m.index, close < 0 ? code.length : close);
    if (/<script/i.test(region))
      fail(`${name} contains "<!--" followed by "<script" at offset ${m.index}, ` +
           'which reaches script-data-double-escaped state and cannot be inlined safely.');
  }
}

/* --------------------------------------------------------------------------
   ESM -> classic script.

   pdf.js 4.x publishes .mjs only. Two textual substitutions make the bundle
   loadable with a plain <script>, and both are asserted rather than assumed:

     * the single trailing `export{a as B, c as D};` becomes an assignment to
       a global of our choosing;
     * `import.meta.url` — module-only SYNTAX, so a parse error in a classic
       script — becomes "". It appears only inside branches guarded by
       `if (isNodeJS)`, which never run in a browser.

   Neither bundle has a top-level `import`, so nothing else needs touching.
   See vendor/README.md.
   ----------------------------------------------------------------------- */
function esmToGlobal(name, code, globalName) {
  const m = code.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) fail(`${name}: expected a single trailing export{...}; the published bundle has changed shape.`);
  if ((code.match(/export\s*\{/g) || []).length !== 1)
    fail(`${name}: expected exactly one export block.`);
  if (/(^|\n)\s*import\s+[^(]/.test(code))
    fail(`${name}: has a top-level import and cannot be flattened to a classic script.`);

  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(spec => {
    const parts = spec.split(/\s+as\s+/);
    const local = parts[0].trim();
    const exported = (parts[1] || parts[0]).trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(local) || !/^[A-Za-z_$][\w$]*$/.test(exported))
      fail(`${name}: unexpected export specifier ${JSON.stringify(spec)}.`);
    return `${exported}:${local}`;
  });

  let out = code.slice(0, m.index);
  const metas = (out.match(/import\.meta/g) || []).length;
  out = out.replace(/import\.meta\.url/g, '""').replace(/import\.meta/g, '({url:""})');
  if (/import\.meta/.test(out)) fail(`${name}: import.meta survived rewriting.`);

  return {
    code: `${out}\nglobalThis.${globalName} = {${pairs.join(',')}};\n`,
    exports: pairs.length, metasRewritten: metas
  };
}

/* ------------------------------------------------------------------------ */
const parts = [];
const log = [];
const scriptBlock = (label, code) => {
  assertInlinable(label, code);
  parts.push(`<!-- ${label} -->\n<script>\n${code}\n</script>`);
  log.push([label, code.length]);
};

/* 1 + 2. pdf.js and its worker */
const pdfRaw = read(join(VENDOR, 'pdf.min.mjs'));
const pdfConv = esmToGlobal('pdf.min.mjs', pdfRaw, 'pdfjsLib');
scriptBlock('pdfjs-dist 4.10.38 (Apache-2.0) — ESM flattened to a classic script', pdfConv.code);

const workerRaw = read(join(VENDOR, 'pdf.worker.min.mjs'));
const workerConv = esmToGlobal('pdf.worker.min.mjs', workerRaw, 'pdfjsWorker');
assertInlinable('pdf.worker.min.mjs', workerConv.code);
parts.push(
  '<!-- pdfjs-dist worker (Apache-2.0). Parked as text, not executed here.\n' +
  '     Over http(s) it becomes a real Worker via a blob URL so parsing never\n' +
  '     blocks the UI thread; opened from a folder, where a browser will not\n' +
  '     start a worker from an opaque origin, it is evaluated on the main\n' +
  '     thread instead. Either way nothing is fetched. See 80-ui.js boot(). -->\n' +
  `<script id="callover-pdf-worker" type="text/plain">\n${workerConv.code}\n</script>`);
log.push(['pdf.worker.min.mjs (as text)', workerConv.code.length]);

/* 3. The UMD bundles, verbatim */
for (const [file, label] of [
  ['xlsx.full.min.js',              'SheetJS 0.20.3 (Apache-2.0)'],
  ['jspdf.umd.min.js',              'jsPDF 2.5.2 (MIT)'],
  ['jspdf.plugin.autotable.min.js', 'jspdf-autotable 3.8.4 (MIT)']
]) {
  const p = join(VENDOR, file);
  if (!existsSync(p)) fail(`vendor/${file} is missing. Run: node tools/vendor.mjs`);
  scriptBlock(`${label} — vendor/${file}`, read(p));
}

/* 4. The application.

   src/*.js in filename order, restricted to the numbered modules. The two
   *-reference.js files stay in src/ as the provenance of the port and as the
   fixtures for the differential test (T0); they are not part of the app. */
const modules = readdirSync(SRC).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
if (!modules.length) fail('no src/NN-*.js modules found.');
const app = modules.map(f => `/* ===== src/${f} ===== */\n${read(join(SRC, f))}`).join('\n');
scriptBlock(`Callover — ${modules.join(', ')}`, app);

/* ------------------------------------------------------------------------ */
const shell = read(SHELL);
const START = '<!--BUILD:START-->', END = '<!--BUILD:END-->';
const a = shell.indexOf(START), b = shell.indexOf(END);
if (a < 0 || b < 0) fail('tools/shell.html is missing the BUILD:START / BUILD:END markers.');

const html = shell.slice(0, a + START.length) + '\n' + parts.join('\n\n') + '\n' + shell.slice(b);

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) fail('index.html has not been built. Run: node tools/build.mjs');
  if (read(OUT) !== html) fail('index.html is stale — src/, vendor/ or the shell changed after it was built.\n' +
                               '                Run: node tools/build.mjs');
  console.log('\nindex.html is up to date.\n');
  process.exit(0);
}

writeFileSync(OUT, html);

const kb = n => (n / 1024).toFixed(0).padStart(6) + ' KB';
console.log('\nindex.html built\n');
for (const [label, len] of log) console.log(`  ${kb(len)}  ${label}`);
console.log(`  ${'-'.repeat(6)}`);
console.log(`  ${kb(html.length)}  index.html total`);
console.log(`\n  pdf.js: ${pdfConv.exports} exports rebound, ` +
            `${pdfConv.metasRewritten} import.meta rewritten`);
console.log(`  worker: ${workerConv.exports} export rebound\n`);
