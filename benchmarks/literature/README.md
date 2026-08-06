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

The runner starts an isolated local server and headless browser. It records
validation/render time, heap use, rendered node/link counts, north/south order,
rail and rung alignment, interaction ordering, half-plane violations,
supplementary-label direction, nucleotide collisions, viewport escape,
non-finite geometry, browser errors, cancellations, and visible ghost nodes.
It also saves representative screenshots.

## Recorded run on this branch

The main report is
[`results/branch-9168f63.json`](results/branch-9168f63.json). It executed 235
renders (all 113 cases twice with 20-nt context, plus nine stratified
full-context cases) in Chrome headless.

Stable behavior:

- 235/235 renders completed; no fatal errors or cancellations.
- No browser errors or non-finite SVG coordinates.
- No missing nucleotides/base-pair links or visible terminal ghost nodes.
- No rail order reversals, north/south inversions, inward supplementary labels,
  structured half-plane violations, or nodes outside the SVG viewport.
- Cropped-context rails remained separated and horizontal; the median render
  promise time was 256.9 ms, p95 was 376.6 ms, and the maximum was 412.3 ms.
- The second cropped pass was 1.04× the first-pass median in the main run.

Problems found:

1. **Full-context auto-fit becomes unreadable.** Five stratified Meyer cases
   from 546 to 2,684 nt were scaled until the 45-unit interaction-track gap was
   only 0.36–1.69 screen pixels. Nucleotides become sub-pixel even though the
   model-space rails remain aligned. The 2,684-nt case took 9.32 s for the
   render promise and 10.29 s through the observation window. Cropping avoids
   this failure.
2. **Nucleotide collisions are common in force-directed context.** The visual
   collision detector flagged 103/113 unique cropped cases, and 102 repeated
   the finding in both passes. Flagged cropped renders had a median of three
   overlapping nucleotide pairs. These predominantly occur in unconstrained
   tails in the intermolecular-only Meyer annotations. The full Coronel-Tellez
   example and both HIV kissing-loop stems also retain visible crowding.
3. **The HIV kissing-loop stems are topologically correct but crowded.** Both
   molecules stay on the correct side of the horizontal kissing helix, yet
   their seven-base-pair stems and labels remain tightly packed. This is a
   useful pseudoknot regression case that was absent from the original suite.
4. **Repeated rendering retains heap after quiescence.** The separate
   [`results/memory-audit.json`](results/memory-audit.json) rendered all 113
   cropped cases twice, cleared the final SVG, waited ten seconds for D3 force
   timers, and forced garbage collection twice. DOM size returned from 527 to
   16 nodes, but used JS heap remained 32,529,449 bytes above the post-load
   baseline. This is evidence of retained JavaScript state and warrants a heap
   snapshot investigation before calling the issue's exact owner.

The benchmark reports observations; it does not alter biological annotations
or silently repair failing layouts.
