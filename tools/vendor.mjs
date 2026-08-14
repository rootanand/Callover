#!/usr/bin/env node
/* Re-fetch and verify vendor/  —  TDD §2.1, constraint C1.
 *
 *   node tools/vendor.mjs --verify   hash the working tree against the manifest
 *   node tools/vendor.mjs            re-download from the pinned URLs and install,
 *                                    refusing any file whose hash does not match
 *
 * This is a development tool. It is the only part of the repository that touches the
 * network, and it never runs as part of the app, the build or the test suite.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR = join(ROOT, 'vendor');

/* Every vendored file, its pinned origin, and the hash it must have.
   `npm` entries are pulled with `npm pack <pkg>@<version>`; `url` entries are fetched
   directly. `from` is the path inside the extracted tarball. */
const MANIFEST = [
  { out:'pdf.min.mjs',                   npm:'pdfjs-dist@4.10.38',        from:'package/legacy/build/pdf.min.mjs',
    sha:'44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72', licence:'Apache-2.0' },
  { out:'pdf.worker.min.mjs',            npm:'pdfjs-dist@4.10.38',        from:'package/legacy/build/pdf.worker.min.mjs',
    sha:'bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d', licence:'Apache-2.0' },
  { out:'xlsx.full.min.js',              url:'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
    from:'package/dist/xlsx.full.min.js',
    sha:'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41', licence:'Apache-2.0' },
  { out:'jspdf.umd.min.js',              npm:'jspdf@2.5.2',               from:'package/dist/jspdf.umd.min.js',
    sha:'85ba2cc3ff858a20fa49fe6e457bec863ea40b55a9f3725e58a940e62f6f61a4', licence:'MIT' },
  { out:'jspdf.plugin.autotable.min.js', npm:'jspdf-autotable@3.8.4',     from:'package/dist/jspdf.plugin.autotable.min.js',
    sha:'2223830cf9a1ec85af014cc71b37c1b1eb566f3d18b2ab8071e96af822c58bdb', licence:'MIT' },
  { out:'tesseract.min.js',              npm:'tesseract.js@5.1.1',        from:'package/dist/tesseract.min.js',
    sha:'a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8', licence:'Apache-2.0' },
  { out:'tesseract-worker.min.js',       npm:'tesseract.js@5.1.1',        from:'package/dist/worker.min.js',
    sha:'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc', licence:'Apache-2.0' },
  { out:'tesseract-core.wasm.js',        npm:'tesseract.js-core@5.1.1',   from:'package/tesseract-core.wasm.js',
    sha:'2b8c8c92b8788807061fb4bb16c5acdf000c149e100255f879f78d2c58ca9969', licence:'Apache-2.0' },
  { out:'tesseract-core-simd.wasm.js',   npm:'tesseract.js-core@5.1.1',   from:'package/tesseract-core-simd.wasm.js',
    sha:'63f232c4f7a97b04e52eb940202700b2c6239783a75d0ff0553274fac530cd5c', licence:'Apache-2.0' },
  { out:'eng.traineddata.gz',            url:'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz',
    sha:'18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b', licence:'Apache-2.0' },
];

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function verify() {
  let bad = 0;
  for (const e of MANIFEST) {
    const p = join(VENDOR, e.out);
    if (!existsSync(p)) { console.log(`  MISSING  ${e.out}`); bad++; continue; }
    const got = sha256(readFileSync(p));
    if (got === e.sha) console.log(`  ok       ${e.out}`);
    else { console.log(`  MISMATCH ${e.out}\n           want ${e.sha}\n           got  ${got}`); bad++; }
  }
  return bad;
}

async function install() {
  const work = join(tmpdir(), `callover-vendor-${process.pid}`);
  mkdirSync(work, { recursive: true });
  mkdirSync(VENDOR, { recursive: true });
  const extracted = new Map();   // tarball path -> extraction dir

  const extract = tgz => {
    if (extracted.has(tgz)) return extracted.get(tgz);
    const dir = join(work, `x${extracted.size}`);
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'inherit' });
    extracted.set(tgz, dir);
    return dir;
  };

  try {
    for (const e of MANIFEST) {
      let bytes;
      if (e.npm) {
        const packed = join(work, `${e.npm.replace(/[@/]/g, '_')}.tgz`);
        if (!existsSync(packed)) {
          const out = execFileSync('npm', ['pack', e.npm, '--pack-destination', work, '--silent'],
                                   { encoding: 'utf8', shell: process.platform === 'win32' });
          const name = out.trim().split('\n').pop().trim();
          execFileSync(process.platform === 'win32' ? 'cmd' : 'mv',
            process.platform === 'win32' ? ['/c', 'move', '/y', join(work, name), packed] : [join(work, name), packed],
            { stdio: 'ignore' });
        }
        bytes = readFileSync(join(extract(packed), ...e.from.split('/')));
      } else if (e.from) {
        const tgz = join(work, e.out + '.src.tgz');
        if (!existsSync(tgz)) writeFileSync(tgz, Buffer.from(await (await fetch(e.url)).arrayBuffer()));
        bytes = readFileSync(join(extract(tgz), ...e.from.split('/')));
      } else {
        bytes = Buffer.from(await (await fetch(e.url)).arrayBuffer());
      }

      const got = sha256(bytes);
      if (got !== e.sha) {
        console.error(`REFUSED ${e.out}\n  expected ${e.sha}\n  received ${got}`);
        console.error('  The published artefact does not match the pinned hash. Nothing was written.');
        process.exitCode = 1;
        return;
      }
      writeFileSync(join(VENDOR, e.out), bytes);
      console.log(`  installed ${e.out.padEnd(30)} ${String(bytes.length).padStart(9)} bytes  ${e.licence}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (mode === '--verify') {
  console.log('\nvendor/ — verifying against the pinned manifest\n');
  const bad = verify();
  const extra = readdirSync(VENDOR).filter(f =>
    /\.(js|mjs|gz|wasm)$/.test(f) && !MANIFEST.some(e => e.out === f));
  if (extra.length) console.log(`\n  UNDECLARED FILES: ${extra.join(', ')}`);
  console.log(bad || extra.length ? `\n  ${bad + extra.length} problem(s)\n` : '\n  all ten files match\n');
  process.exit(bad || extra.length ? 1 : 0);
} else {
  console.log('\nvendor/ — re-fetching from pinned sources\n');
  await install();
  if (!process.exitCode) console.log('\n  done — run `node tools/build.mjs` to rebuild index.html\n');
}
