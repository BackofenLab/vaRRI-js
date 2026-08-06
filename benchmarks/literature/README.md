# Literature interaction benchmark

This directory contains a reproducible browser benchmark for the linear vaRRI
layout. It is intentionally separate from the public example gallery.

## Curated inputs

[`tests/fixtures/literature-interactions.json`](../../tests/fixtures/literature-interactions.json)
contains 113 literature-derived cases:

- 109 bacterial sRNA–mRNA interactions from the author-deposited Meyer dataset
  used by Zhang et al. (2023);
- the two literature reproductions already present in `examples.js`, imported
  programmatically so their inputs cannot silently diverge; and
- two HIV-1 DIS kissing-loop homodimers, with polymer sequences from RCSB PDB
  entries 1XPF and 1XPE and crossing loop interactions encoded with square
  brackets.

Every case contains source IDs, evidence scope, the original source notation,
the normalized vaRRI input, and expected length/pair counts. The top-level
`sources` object provides full citations, DOI/PMCID/PDB links, the Zenodo file
name, source checksums, access date, and the license identifier reported by
Zenodo.

The Meyer dataset explicitly omits intramolecular base-pair annotations. Dots
outside its annotated interaction sites therefore mean "not annotated in this
dataset", not "experimentally unpaired". The fixture generator never infers
missing pairs.

Primary references:

- Zhang H, Li S, Dai N, et al. *LinearCoFold and LinearCoPartition: linear-time
  algorithms for secondary structure prediction of interacting RNA molecules.*
  Nucleic Acids Research 51 (2023), e94.
  https://doi.org/10.1093/nar/gkad664
- Author-deposited data for that paper, Zenodo record 8153422.
  https://doi.org/10.5281/zenodo.8153422
- Lai D, Meyer IM. *A comprehensive comparison of general RNA–RNA interaction
  prediction methods.* Nucleic Acids Research 44 (2016), e61.
  https://doi.org/10.1093/nar/gkv1477
- Ennifar E, Dumas P. *Polymorphism of bulged-out residues in HIV-1 RNA DIS
  kissing complex and structure comparison with solution studies.* Journal of
  Molecular Biology 356 (2006), 771–782.
  https://doi.org/10.1016/j.jmb.2005.12.022
- RCSB PDB 1XPF and 1XPE.
  https://doi.org/10.2210/pdb1xpf/pdb and
  https://doi.org/10.2210/pdb1xpe/pdb

## Rebuilding the fixture

Download `data.zip` from Zenodo record 8153422 and extract
`Meyer_dataset.csv`, then run:

```bash
node benchmarks/literature/build-fixtures.js /path/to/Meyer_dataset.csv
npm test -- --runInBand
```

Generation stops on any row-count, CSV-width, sequence-length,
interaction-coordinate, notation, bracket-balance, pair-count, or
canonical/G–U complementarity mismatch. The unit test validates all 113
normalized inputs through `vaRRI.validate()`.

## Running the browser campaign

Chrome or Chromium is required:

```bash
node benchmarks/literature/run-browser-benchmark.mjs \
  --cropped-repeats=2 \
  --full-repeats=1 \
  --cropped-context=20 \
  --settle-ms=650
```

Use `--case-ids=id-1,id-2` for a focused run. The diagnostic
`--linear-layout=false` override renders the same fixtures with Fornac's
primary layout only; it accepts exactly `true` or `false`.

The runner starts an isolated local server and headless browser. It records
validation/render time, heap use, rendered node/link counts, north/south order,
rail and rung alignment, interaction ordering, half-plane violations,
supplementary-label direction, exact nucleotide collision pairs, longest
visible links, viewport escape, minimum-readable-view activation, non-finite
geometry, browser errors, cancellations, and visible ghost nodes. It also
saves representative screenshots.

## Recorded validation after the layout repair

The pre-repair baseline remains in
[`results/branch-9168f63.json`](results/branch-9168f63.json). It showed
nucleotide collisions in 103/113 unique cropped cases, five collapsed
full-context rail gaps, and crowded HIV kissing-loop stems.

The final evidence is split by display mode:

- [`results/linear-layout-final-cropped.json`](results/linear-layout-final-cropped.json)
  renders all 113 cases with 20-nt context.
- [`results/linear-layout-final-full.json`](results/linear-layout-final-full.json)
  renders nine stratified full-context cases, including a 2,684-nt interaction.

Representative final images are stored in
[`results/final-screenshots/`](results/final-screenshots/), including the
Coronel-Téllez input supplied for Issue 59 and both structured HIV controls.

Results:

- 113/113 cropped renders and 9/9 full-context renders completed with zero
  detected geometry or browser problems.
- No nucleotide collisions, rail/rung deviations, ordering errors,
  half-plane violations, inward supplementary nodes, missing nodes/links,
  non-finite coordinates, visible ghosts, cancellations, or browser errors.
- Cropped median render-promise time was 252.5 ms, p95 was 298.1 ms, and the
  maximum was 344.1 ms.
- Long full-context inputs no longer shrink the interaction into sub-pixel
  geometry. A 0.1 minimum view scale keeps the rail gap at about 3.8 screen
  pixels, centres the RRI, and intentionally leaves remote tails accessible by
  pan/zoom. Inputs that fit remain fully visible and use Fornac's normal fit.
- The longest 2,684-nt case remains expensive (about 7–9 seconds depending on
  the run), so cropping is still recommended for interactive work.

The separate [`results/memory-audit.json`](results/memory-audit.json) records
the earlier repeated-render heap audit. Memory ownership is independent of the
geometry repair and was not reclassified by these layout checks.

The benchmark reports observations; it does not alter biological annotations
or silently repair failing layouts.
