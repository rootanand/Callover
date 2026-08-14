/* ============================================================================
   tests/harness.mjs — the plumbing tests/run.mjs sits on.

   No framework and nothing to install. Loads the vendored libraries and the
   src modules exactly as the browser would, gives the engine a browser-shaped
   environment where it needs one, and provides the little assertion helpers.
   ========================================================================= */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const fixture = (...p) => join(ROOT, 'fixtures', ...p);
export const readFix = (...p) => readFileSync(fixture(...p));
export const hasReal = existsSync(join(ROOT, 'fixtures', 'real'));

/* --- the vendored libraries, loaded the way the browser loads them -------- */

export async function loadVendor() {
  /* pdf.js: node can import the pristine ESM straight from vendor/. The
     browser gets the same bytes, flattened to a classic script by
     tools/build.mjs — and T10-08/09 assert that flattening is faithful. */
  globalThis.pdfjsWorker = await import(pathToFileURL(join(ROOT, 'vendor', 'pdf.worker.min.mjs')).href);
  globalThis.pdfjsLib    = await import(pathToFileURL(join(ROOT, 'vendor', 'pdf.min.mjs')).href);

  /* SheetJS is UMD; in node it wants a module object to attach to. */
  const m = { exports: {} };
  new Function('module', 'exports',
    readFileSync(join(ROOT, 'vendor', 'xlsx.full.min.js'), 'utf8'))(m, m.exports);
  globalThis.XLSX = m.exports;
}

/* --- the application ----------------------------------------------------- */

/* Real imports rather than new Function, so V8 attributes coverage to the
   actual files (§10.11) and a stack trace names a real line. */
export async function loadApp() {
  const files = readdirSync(join(ROOT, 'src')).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
  for (const f of files) await import(pathToFileURL(join(ROOT, 'src', f)).href);
  return globalThis.Callover;
}

export async function loadReference(name) {
  const mod = await import(pathToFileURL(join(ROOT, 'src', name)).href);
  return mod.default || mod;
}

/* --- a browser-shaped environment, only where the code needs one ---------- */

/* localStorage, so the confirm-memory path can be exercised and, more to the
   point, so T10-04 can enumerate every key a full run writes. */
export function installLocalStorage() {
  const map = new Map();
  const ls = {
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    _map: map
  };
  globalThis.localStorage = ls;
  return ls;
}

/* An in-memory stand-in for the IndexedDB-backed store. The profile and ledger
   logic is what the tests are about; re-implementing IndexedDB would be
   testing the browser, not Callover. The real store is exercised by hand in
   the browser as part of M4. */
export function installMemoryStore(CO) {
  const mem = new Map();
  const real = { ...CO.io.store };
  Object.assign(CO.io.store, {
    open:  async () => ({}),
    put:   async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); return true; },
    get:   async k => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : null),
    keys:  async () => [...mem.keys()],
    clear: async () => { mem.clear(); return true; }
  });
  return { mem, restore: () => Object.assign(CO.io.store, real) };
}

/* --- reading a fixture PDF ----------------------------------------------- */

export async function readPdf(CO, relPath, opts) {
  const name = relPath.split('/').pop();
  return CO.extract.readDocument(
    { name, bytes: new Uint8Array(readFix(...relPath.split('/'))),
      official: true, typeOverride: (opts && opts.typeOverride) || 'auto' },
    { roster: (opts && opts.roster) || [], thorough: false });
}

/* --- parsing a fixture table --------------------------------------------- */

export function rowsOf(CO, relPath) {
  const p = fixture(...relPath.split('/'));
  return /\.(csv|tsv|txt)$/i.test(p)
    ? CO.io.sheetToRows(readFileSync(p, 'utf8'), 'string')
    : CO.io.sheetToRows(new Uint8Array(readFileSync(p)), 'array');
}

export function loadRegister(CO, relPath) {
  const parsed = CO.io.parseRegisterRows(rowsOf(CO, relPath));
  parsed.rowCount = parsed.cases.length;
  parsed.sourceFilename = relPath.split('/').pop();
  parsed.uploadedAt = new Date().toISOString();
  return parsed;
}

export function loadRoster(CO, relPath) {
  return CO.io.parseAdvocateRows(rowsOf(CO, relPath)).advocates;
}

/* --- assertions ---------------------------------------------------------- */

export function makeReporter() {
  const state = { pass: 0, fail: 0, skip: 0, bad: [], group: '', groups: [] };

  const group = title => {
    state.group = title;
    state.groups.push(title);
    console.log('\n' + title);
  };

  const t = (id, cond, detail = '') => {
    if (cond) { state.pass++; console.log(`  PASS  ${id}${detail ? '  ' + detail : ''}`); }
    else { state.fail++; state.bad.push(`${id}  ${detail}`); console.log(`  FAIL  ${id}${detail ? '  ' + detail : ''}`); }
    return !!cond;
  };

  const skip = (id, why) => {
    state.skip++;
    console.log(`  SKIP  ${id}  ${why}`);
  };

  const eq = (id, got, want, detail) =>
    t(id, JSON.stringify(got) === JSON.stringify(want),
      detail || `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

  const finish = () => {
    console.log('\n' + '='.repeat(72));
    console.log(`  ${state.pass} passed, ${state.fail} failed, ${state.skip} skipped`);
    if (state.fail) {
      console.log('\n  failures:');
      state.bad.forEach(b => console.log('    ' + b));
      console.log('');
      process.exit(1);
    }
    console.log('  all green\n');
  };

  return { group, t, skip, eq, state, finish };
}
