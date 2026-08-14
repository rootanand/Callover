# vendor/ — every third-party byte Callover runs

TDD §2.1 and constraint **C1** require that Callover make **no network request at run
time**. Every library it uses therefore lives here, committed, at a pinned version. There
is no CDN reference anywhere in `index.html`, and test **T10-01** fails the build if one
appears.

This file records where each byte came from so a reviewer can re-fetch it and compare.
`node tools/vendor.mjs --verify` checks the working tree against the hashes below;
`node tools/vendor.mjs` re-downloads everything from the pinned URLs and refuses to
install a file whose hash does not match.

## Manifest

| File | Bytes | Package · version | Licence | SHA-256 |
|---|---:|---|---|---|
| `pdf.min.mjs` | 398,237 | `pdfjs-dist` 4.10.38 (legacy build) | Apache-2.0 | `44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72` |
| `pdf.worker.min.mjs` | 1,417,586 | `pdfjs-dist` 4.10.38 (legacy build) | Apache-2.0 | `bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d` |
| `xlsx.full.min.js` | 951,904 | SheetJS `xlsx` 0.20.3 community | Apache-2.0 | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |
| `jspdf.umd.min.js` | 365,730 | `jspdf` 2.5.2 | MIT | `85ba2cc3ff858a20fa49fe6e457bec863ea40b55a9f3725e58a940e62f6f61a4` |
| `jspdf.plugin.autotable.min.js` | 38,960 | `jspdf-autotable` 3.8.4 | MIT | `2223830cf9a1ec85af014cc71b37c1b1eb566f3d18b2ab8071e96af822c58bdb` |
| `tesseract.min.js` | 66,695 | `tesseract.js` 5.1.1 | Apache-2.0 | `a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8` |
| `tesseract-worker.min.js` | 123,724 | `tesseract.js` 5.1.1 (`dist/worker.min.js`) | Apache-2.0 | `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc` |
| `tesseract-core.wasm.js` | 4,734,777 | `tesseract.js-core` 5.1.1 | Apache-2.0 | `2b8c8c92b8788807061fb4bb16c5acdf000c149e100255f879f78d2c58ca9969` |
| `tesseract-core-simd.wasm.js` | 4,735,153 | `tesseract.js-core` 5.1.1 | Apache-2.0 | `63f232c4f7a97b04e52eb940202700b2c6239783a75d0ff0553274fac530cd5c` |
| `eng.traineddata.gz` | 1,984,273 | `tessdata_fast` 4.0.0, English | Apache-2.0 | `18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b` |

Full licence texts are in `licences/`. All ten files are permissively licensed and
redistributable; Callover itself is MIT (see `../LICENCE`).

## Sources

| Package | Fetched from |
|---|---|
| `pdfjs-dist` 4.10.38 | npm registry — `npm pack pdfjs-dist@4.10.38` |
| `xlsx` 0.20.3 | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — SheetJS moved distribution off npm at 0.20; the npm copy is frozen at 0.18.5 |
| `jspdf` 2.5.2 | npm registry — `npm pack jspdf@2.5.2` |
| `jspdf-autotable` 3.8.4 | npm registry — `npm pack jspdf-autotable@3.8.4` |
| `tesseract.js` 5.1.1 | npm registry — `npm pack tesseract.js@5.1.1` |
| `tesseract.js-core` 5.1.1 | npm registry — `npm pack tesseract.js-core@5.1.1` |
| `eng.traineddata.gz` | `https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz` — the host tesseract.js itself defaults to |

## Two notes on how these are used

### 1. pdf.js ships ES modules; `index.html` needs classic scripts

pdf.js 4.x publishes `.mjs` only. A browser refuses to load an ES module over `file://`
(module scripts are CORS-checked and a `file://` origin is opaque), which would break
**C6** — *openable with a double-click*. So `tools/build.mjs` converts the two bundles to
classic scripts while inlining them, by two textual substitutions that are asserted in
`tests/run.mjs` (T10-08, T10-09):

- the single trailing `export{…}` becomes an assignment to `globalThis.pdfjsLib` /
  `globalThis.pdfjsWorker`;
- `import.meta.url` — which appears only inside Node-only branches guarded by
  `if (isNodeJS)`, and is a *syntax* error in a classic script — becomes `""`.

Neither bundle has a top-level `import`, so nothing else needs touching. The files here
stay pristine, so you can diff the inlined copy against the published release.

### 2. OCR is loaded from this folder, never inlined

Per §2.1 the OCR engine is lazy-loaded **only when a scanned page is detected**, so a
text-only run never pays its 11 MB. That means OCR needs `vendor/` sitting next to
`index.html`, and needs the page served over `http(s)` — a Worker plus WebAssembly cannot
start from a bare `file://` origin in Chrome.

This is a real limit and the app states it rather than failing quietly: when a page has no
text layer and OCR cannot start, §8.7 requires the page number to be named and the run to
warn that results may be incomplete. Everything else — reading text-layer PDFs, the whole
matching engine, all four exports — works from a double-clicked `index.html` with no
`vendor/` folder at all, because those libraries are inlined.
