
## `vaRRI-js` JavaScript Library API

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
| `cropping` | `string\|number` | `"0"` | Number of unpaired nucleotides to crop from each end of the structure. `"0"` disables cropping. |
| `startIndex1` | `string\|number` | `"1"` | Start index for molecule 1. |
| `startIndex2` | `string\|number` | `"1"` | Start index for molecule 2. |
| `labelInterval` | `string\|number` | `"10"` | Interval for displayed index labels. |
| `coloring` | `string` | `"strand"` | `"strand"` or `"loop"`. |
| `highlighting` | `string` | `"region"` | `"nothing"`, `"basepairs"`, or `"region"`. |
| `backgroundhighlighting` | `string` | `"basepairs"` | `"nothing"`, `"basepairs"`, or `"region"`. |
| `guBasepairs` | `boolean` | `true` | Show G-U basepairs as dashed lines. |

**Returns:** A validated parameter object.  
**Throws:** `Error` on any invalid input.

```javascript
const v = vaRRI.validate({
  structure: '..((((...))))...((...((...((..&............))...))...))..',
  sequence:  'ACGAUCAGAGAUCAGAGCAUACGACAGCAG&ACGAAAAAAAGAGCAUACGACAGCAG',
});
```

---

#### `vaRRI.render(containerId, v, options)` → `Promise<{ cancelled: boolean }>`

Builds the Fornac visualisation and applies all vaRRI modifications. The returned promise resolves after the delayed post-processing step finishes. If a newer render supersedes a pending one, the older promise resolves with `{ cancelled: true }`.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `containerId` | `string` | The **id** of the DOM element that will host the Fornac SVG. The element must already exist in the DOM. |
| `v` | `Object` | Validated parameter dictionary from `vaRRI.validate()`. |
| `options` | `Object` | Optional settings (see below). |

**`options` properties:**

| Property | Type | Default | Description |
|---|---|---|---|
| `animation` | `boolean` | `false` | Enable Fornac force-layout animation. When `true` and background highlighting is active, the highlight polygon is redrawn on every animation frame to stay in sync with the force layout. |
| `accessData` | `Object\|null` | `null` | Accessibility data: `{ nodeId: probability, … }`. |

```javascript
const container = document.getElementById('rna_ss');
container.innerHTML = '';

const v = vaRRI.validate({ structure: '((...))', sequence: 'GGGCCC' });
await vaRRI.render('rna_ss', v);
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

#### `vaRRI.parseSubsequences(input, startIndex?, sequenceLength?)` → `Array<[number, number]>|null`
Parses a comma-separated list of `"start-end"` strings (including negative indices) into numeric pairs.
When `startIndex` and `sequenceLength` are provided, range endpoints are validated against
the sequence's valid RNA-style indices (no index `0`).

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

#### `vaRRI.polyline(indices, style, extraAttrs?)` → `void`
Draws an SVG polyline connecting the given Fornac node positions.
An optional `extraAttrs` object (e.g. `{ 'data-varri-bg': 'true' }`) sets additional attributes on the created `<polyline>` element.

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
