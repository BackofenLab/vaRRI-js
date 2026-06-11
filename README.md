# vaRRI-js

**Browser-only JavaScript port of [vaRRI](https://github.com/BackofenLab/vaRRI)**  
Visualise RNA–RNA interactions directly in the browser — no server, no command-line tools required.

> **Upstream version:** Based on the vaRRI Python source as of June 2026 (commit history at
> [BackofenLab/vaRRI](https://github.com/BackofenLab/vaRRI)).  
> This port does **not** include the RNAfold/RNAplfold structure-prediction steps, which require
> external command-line tools.

---

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Input Website](#input-website)
   - [Usage](#usage)
   - [Example Inputs](#example-inputs)
   - [Export](#export)
5. [JavaScript Library API](#javascript-library-api)
   - [Core Functions](#core-functions)
   - [Validation Helpers](#validation-helpers)
   - [Rendering & Modification Helpers](#rendering--modification-helpers)
   - [Export Helpers](#export-helpers)
   - [Utility Functions](#utility-functions)
6. [Input Format Reference](#input-format-reference)
7. [License](#license)

---

## Overview

vaRRI-js is a pure JavaScript rewrite of the Python vaRRI toolkit.  It takes
RNA secondary-structure and sequence strings in dot-bracket notation, renders
them with the [Fornac](https://github.com/ViennaRNA/fornac) library, and then
applies all of vaRRI's post-processing (coloring, highlighting, index labeling,
G-U basepair display, …).

**What is excluded compared to the original Python vaRRI:**

| Python feature | Status |
|---|---|
| RNAfold structure prediction | ✗ excluded (requires CLI tool) |
| RNAplfold accessibility prediction | ✗ excluded (requires CLI tool) |
| Playwright/headless-browser rendering | ✗ excluded — replaced by live browser DOM |
| FASTA file parsing from disk | ✗ excluded — use textarea input instead |
| PNG/SVG file output from CLI | ✓ replaced by in-browser download buttons |

---

## Project Structure

```
vaRRI-js/
├── index.html          # Input website
├── src/
│   └── vaRRI.js        # JavaScript library (main file)
├── fornac/
│   ├── d3.js           # D3.js v4 (vendored from upstream vaRRI)
│   ├── fornac.js       # Fornac library
│   └── fornac.css      # Fornac styles
└── README.md
```

---

## Quick Start

Clone the repository and open `index.html` directly in a browser — no build
step or server needed:

```bash
git clone https://github.com/BackofenLab/vaRRI-js.git
cd vaRRI-js
# simply open index.html in your browser, e.g.:
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

Or serve with any static HTTP server:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

To use the library in your own HTML page, include the dependencies in order:

```html
<link rel="stylesheet" href="fornac/fornac.css" />
<script src="fornac/d3.js"></script>
<script src="fornac/fornac.js"></script>
<script src="src/vaRRI.js"></script>
```

---

## Input Website

### Usage

1. **Open `index.html`** in a modern browser (Chrome, Firefox, Edge, Safari).
2. The page loads with a pre-filled 2-molecule example automatically.
3. Fill in or modify the fields in the left panel:

| Field | Description |
|---|---|
| **Structure** | Dot-bracket structure string. Separate two molecules with `&`. |
| **Sequence** | RNA sequence (IUPAC characters). Separate two molecules with `&`. |
| **Start index mol. 1/2** | The number assigned to the first nucleotide of each molecule. Defaults to 1. 0 is not valid; negative offsets are supported. |
| **Label interval** | Display an index label every N nucleotides. Default: 10. |
| **Coloring** | `strand` — mol. 1 in light blue, mol. 2 in golden yellow. `loop` — Fornac default base-type coloring. |
| **Highlighting** | `region` — highlight the entire intermolecular region. `basepairs` — highlight only the basepair nucleotides. `nothing` — no highlighting. |
| **Background highlighting** | `basepairs` — translucent red polygon around basepair stacks. `region` — translucent red polygon over the whole region. `nothing` — disabled. |
| **G-U basepairs as dashed lines** | When checked, G-U basepairs are drawn with a dashed stroke. |
| **Highlight subseq 1/2** | Comma-separated `start-end` ranges (using the same index space as Start index). Example: `3-8` or `3-8,15-20`. |

4. Click **▶ Visualise** to render.

### Example Inputs

Three built-in examples can be loaded with the buttons at the top of the panel:

| Button | Description |
|---|---|
| **2-molecule example** | A two-strand RNA interaction. Demonstrates strand coloring, region highlighting, and background basepair highlighting. |
| **1-molecule example** | A single RNA hairpin with Fornac default (loop) coloring. |
| **Pseudoknot** | A structure containing square-bracket pseudoknot notation `[…]`. |

### Export

After rendering, use the buttons in the export bar below the visualisation:

| Button | Description |
|---|---|
| **⬇ SVG** | Downloads a self-contained SVG file with embedded Fornac CSS. |
| **⬇ PNG** | Rasterises the SVG to a canvas (2× resolution) and downloads a PNG. |

---

## JavaScript Library API

Include `src/vaRRI.js` after the Fornac dependencies.  The library exposes a
single global object `vaRRI` with the following functions.

---

### Core Functions

#### `vaRRI.validate(args)` → `Object`

Validates all user-supplied input parameters and returns a normalised
`validated` dictionary ready for `vaRRI.render()`.

**Parameters (`args` object):**

| Property | Type | Default | Description |
|---|---|---|---|
| `structure` | `string` | *(required)* | Dot-bracket structure string. May contain `&` to separate two molecules. |
| `sequence` | `string` | *(required)* | RNA/DNA sequence (IUPAC characters). May contain `&`. |
| `startIndex1` | `string\|number` | `"1"` | Start index for molecule 1. |
| `startIndex2` | `string\|number` | `"1"` | Start index for molecule 2. |
| `labelInterval` | `string\|number` | `"10"` | Interval for displayed index labels. |
| `coloring` | `string` | `"strand"` | `"strand"` or `"loop"`. |
| `highlighting` | `string` | `"region"` | `"nothing"`, `"basepairs"`, or `"region"`. |
| `backgroundhighlighting` | `string` | `"basepairs"` | `"nothing"`, `"basepairs"`, or `"region"`. |
| `guBasepairs` | `boolean` | `true` | Show G-U basepairs as dashed lines. |
| `highlightSubseq1` | `string\|null` | `null` | Comma-separated `start-end` range(s) for molecule 1. |
| `highlightSubseq2` | `string\|null` | `null` | Comma-separated `start-end` range(s) for molecule 2. |

**Returns:** A validated parameter object.  
**Throws:** `Error` on any invalid input.

```javascript
const v = vaRRI.validate({
  structure: '..((((...))))...((...((...((..&............))...))...))..',
  sequence:  'ACGAUCAGAGAUCAGAGCAUACGACAGCAG&ACGAAAAAAAGAGCAUACGACAGCAG',
});
```

---

#### `vaRRI.render(containerId, v, options)` → `void`

Builds the Fornac visualisation and applies all vaRRI modifications.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `containerId` | `string` | The **id** of the DOM element that will host the Fornac SVG. The element must already exist in the DOM. |
| `v` | `Object` | Validated parameter dictionary from `vaRRI.validate()`. |
| `options` | `Object` | Optional settings (see below). |

**`options` properties:**

| Property | Type | Default | Description |
|---|---|---|---|
| `animation` | `boolean` | `false` | Enable Fornac force-layout animation. |
| `animationTimer` | `number` | `100` | Milliseconds to wait after animation before applying modifications. |
| `accessData` | `Object\|null` | `null` | Accessibility data: `{ nodeId: probability, … }`. |

```javascript
const container = document.getElementById('rna_ss');
container.innerHTML = '';

const v = vaRRI.validate({ structure: '((...))', sequence: 'GGGCCC' });
vaRRI.render('rna_ss', v);
```

---

### Validation Helpers

These functions are used internally by `validate()` but are also exported for
advanced use.

#### `vaRRI.checkStructureInputSimple(structure)` → `void`
Checks bracket balance for `()`, `[]`, `{}`, `<>`.  Throws `Error` on mismatch.

#### `vaRRI.validateSequenceInput(sequence)` → `string`
Validates IUPAC sequence characters.  Returns the sequence or throws `Error`.

#### `vaRRI.validateStructureInput(structure, sequence)` → `string`
Validates structure string and checks length parity with sequence.

#### `vaRRI.validateOffset(offsetStr)` → `number`
Parses and validates a start-index string.  Rejects `"0"`.

#### `vaRRI.validateHighlighting(value)` → `string`
Returns `value` if it is `"nothing"`, `"basepairs"`, or `"region"`.

#### `vaRRI.validateBackgroundhighlighting(value)` → `string`
Same as above for background highlighting.

#### `vaRRI.splitAtAmpersand(str)` → `[string, string]`
Splits a string at the first `&`.  Always returns two strings.

#### `vaRRI.findBasePairs(structure)` → `Array<[number, number]>`
Returns zero-based `[open, close]` index pairs for all matched brackets.

#### `vaRRI.formatStructure(structure)` → `Object`
Returns `{ structure1, structure2, structure, structure_dict }` after applying
the Fornac `&...` fix.

#### `vaRRI.formatSequence(sequence)` → `Object`
Returns `{ sequence1, sequence2, sequence, sequence_dict }` after applying
the Fornac `&...` fix.

#### `vaRRI.getMolecules(validated)` → `"1"|"2"`
Returns `"2"` if `validated.sequence2` is non-empty, otherwise `"1"`.

#### `vaRRI.getIndexDictionary(v)` → `Object.<number, [string, number]>`
Builds a Fornac-node-ID → `[sequenceId, position]` mapping that accounts for
gap nodes and RNA-style numbering (no zero).

#### `vaRRI.getSequenceIndices(seqId, offset, length)` → `Array<[string, number]>`
Produces `(seqId, index)` tuples starting at `offset`, skipping 0.

#### `vaRRI.parseSubsequences(input)` → `Array<[number, number]>|null`
Parses a comma-separated list of `"start-end"` strings into numeric pairs.

---

### Rendering & Modification Helpers

These functions directly manipulate the live DOM SVG produced by Fornac.  They
are called automatically by `render()` but can also be invoked individually for
fine-grained control.

#### `vaRRI.setLinksId()` → `void`
Parses Fornac tooltip text on `<line>` elements and assigns `start`/`end` attributes.

#### `vaRRI.setLabelsId()` → `void`
Assigns sequential `label_gnum` / `label_num` IDs to label elements.

#### `vaRRI.changeBackgroundColor(v)` → `void`
Colors all nucleotide circles using strand coloring (mol. 1 = lightblue, mol. 2 = #F4BB44).

#### `vaRRI.updateNodeToolTips(v)` → `void`
Updates `<title>` text of each node circle to show `seqId[position]`.

#### `vaRRI.updateLinkTooltips(v)` → `void`
Updates `<title>` text of each link line to show correct indices.

#### `vaRRI.setIndexLabels(v)` → `void`
Displays index labels at sequence boundaries, basepair region boundaries, and
every `labelInterval`-th position.

#### `vaRRI.highlightingRegion(v)` → `void`
Adds a red stroke to all nodes in the intermolecular basepair region.

#### `vaRRI.highlightingBasepairs(v)` → `void`
Adds a red stroke to individual intermolecular basepair nodes.

#### `vaRRI.backgroundhighlightingRegion(v)` → `void`
Draws a translucent red polyline over the entire intermolecular region.

#### `vaRRI.backgroundhighlightingBasepairs(v)` → `void`
Draws translucent red polylines around individual basepair stacks.

#### `vaRRI.visualiseBasepairStrength(v)` → `void`
Applies a dashed stroke to G-U basepair links.

#### `vaRRI.highlightSubsequence(v, seq)` → `void`
Draws a purple polyline or circle over the specified subsequence range.
`seq` is `"1"` or `"2"`.

#### `vaRRI.removeDummyNodes(sequence)` → `void`
Removes the Fornac gap nodes that separate two molecules.

#### `vaRRI.removeSecondLink()` → `void`
Removes duplicate basepair links (keeps only link where `start < end`).

#### `vaRRI.addStyleToNodes(nodeIds, style)` → `void`
Appends `style` to the `style` attribute of the specified node circles.

#### `vaRRI.polyline(indices, style)` → `void`
Draws an SVG polyline connecting the given Fornac node positions.

#### `vaRRI.addElement(elementType, attr)` → `void`
Inserts a new SVG element with the given attributes at the top of the Fornac plot group.

#### `vaRRI.getPositionOfNode(nodeId)` → `number[]`
Returns the `[x, y]` coordinates of a Fornac node by reading its `transform` attribute.

#### `vaRRI.setAttributeForElements(targetAttr, targetValue, setAttr, setValue)` → `void`
Sets an attribute on all elements matching `[targetAttr="targetValue"]`.

#### `vaRRI.visualiseAccessibility(accessData, lenSeq)` → `void`
Overlays coloured circles encoding accessibility probability.
`accessData` is `{ nodeId: probability }` with values in `[0, 1]`.
Nodes in sequence 1 (`index <= lenSeq`) are colored purple; sequence 2 nodes red.
Higher probability → lower opacity.

---

### Export Helpers

#### `vaRRI.downloadSVG(containerId, filename?)` → `void`
Downloads a self-contained SVG file.  Embedded Fornac CSS is included in a
`<style>` block so the file renders correctly when opened standalone.

**Parameters:**

| Parameter | Type | Default |
|---|---|---|
| `containerId` | `string` | *(required)* |
| `filename` | `string` | `"vaRRI_output.svg"` |

#### `vaRRI.downloadPNG(containerId, filename?, scale?)` → `void`
Rasterises the SVG to a `<canvas>` and triggers a PNG download.

| Parameter | Type | Default |
|---|---|---|
| `containerId` | `string` | *(required)* |
| `filename` | `string` | `"vaRRI_output.png"` |
| `scale` | `number` | `2` (retina quality) |

#### `vaRRI.buildSVGString(containerId)` → `string`
Returns the full SVG markup as a string without triggering a download.
Useful for programmatic use (e.g., posting to a server or displaying in another element).

---

### Utility Functions

#### `vaRRI.listIntermolNodes(struc, shift?)` → `Array<[number, string]>`
Identifies positions of intermolecular basepairs in a dot-bracket structure.
Returns sorted `[1-based index, bracket-char]` pairs.

#### `vaRRI.getIntermolBasepairRegion(structure1, structure2)` → `Array<[number, number]>`
Returns `[start, end]` ranges of the intermolecular basepair region for each structure.

#### `vaRRI.listIntermolPairs(v)` → `Array<[number, number]>`
Returns all intermolecular basepair `[open, close]` index pairs from the
combined structure.

#### `vaRRI.listBasepairs(struc)` → `Array<[number, number]>`
Parses basepairs from a `{position: bracket}` structure dictionary.

#### `vaRRI.sequenceColoring(seq1, seq2)` → `string[]`
Returns a color array: `"lightblue"` for each character of `seq1`,
`"#F4BB44"` for each character of `seq2`.

---

## Input Format Reference

### Dot-Bracket Notation

vaRRI-js accepts standard dot-bracket notation with the following characters:

| Character | Meaning |
|---|---|
| `.` | Unpaired nucleotide |
| `(` `)` | Watson-Crick basepair (standard) |
| `[` `]` | Pseudoknot basepair (square brackets) |
| `{` `}` | Pseudoknot basepair (curly brackets) |
| `<` `>` | Intramolecular predicted basepair |
| `&` | Separator between two molecules |

### Two-Molecule Input

Separate structures and sequences of two RNA molecules with `&`:

```
Structure:  ..((((...))))...((...((...((..&............))...))...))..
Sequence:   ACGAUCAGAGAUCAGAGCAUACGACAGCAG&ACGAAAAAAAGAGCAUACGACAGCAG
```

The character positions before `&` belong to molecule 1; positions after `&`
belong to molecule 2.  Intermolecular basepairs are identified automatically
as unmatched brackets: an opening bracket in molecule 1 that has no partner in
molecule 1 is paired to a closing bracket in molecule 2 (and vice-versa).

### IUPAC Sequence Characters

Accepted characters (case-insensitive):

| Character(s) | Meaning |
|---|---|
| `A` `C` `G` `U` `T` | Standard nucleotides |
| `R` | A or G |
| `Y` | C or T/U |
| `S` | G or C |
| `W` | A or T/U |
| `K` | G or T/U |
| `M` | A or C |
| `B` | C, G or T/U |
| `D` | A, G or T/U |
| `H` | A, C or T/U |
| `V` | A, C or G |
| `N` | Any nucleotide |

### Start Index

Molecule positions are displayed using a 1-based index by default.  You can
change the start index to any integer except 0.  Negative start indices are
supported (useful when the visualised region is an excerpt of a longer sequence).

---

## License

This project is a port of [vaRRI](https://github.com/BackofenLab/vaRRI).
See [LICENSE](LICENSE) for the licence terms.

The bundled Fornac library (`fornac/`) is © 2014 Peter Kerpedjiev and is
distributed under its own [licence](fornac/LICENSE).
