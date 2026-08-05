# vaRRI-js JavaScript API

`src/vaRRI.js` exposes one global object, `window.vaRRI`. In CommonJS test
code, `require('./src/vaRRI.js')` returns the same object.

Load Fornac and D3 before vaRRI:

```html
<link rel="stylesheet" href="fornac/fornac.css" />
<script src="fornac/d3.js"></script>
<script src="fornac/fornac.js"></script>
<script src="dist/vaRRI.min.js"></script>
```

Use `src/vaRRI.js` instead of the minified file while developing.

## Core workflow

### `vaRRI.validate(args)`

Validates and normalizes input, applies optional end cropping, and returns the
object expected by `render()`.

| Property | Type | Default | Description |
|---|---|---|---|
| `sequence` | `string` | required | IUPAC sequence; separate two molecules with `&`. |
| `structure` | `string` | required | Dot-bracket structure; separate two molecules with `&`. |
| `startIndex1` | `string\|number` | `1` | First index of molecule 1; zero is invalid. |
| `startIndex2` | `string\|number` | `1` | First index of molecule 2; zero is invalid. |
| `cropping` | `string\|number` | `-1` | Negative disables cropping; non-negative values retain that many terminal unpaired bases. |
| `labelInterval` | `string\|number` | `10` | Interval between index labels. |
| `coloring` | `string` | `strand` | `strand` or `loop`. |
| `highlighting` | `string` | `region` | `nothing`, `basepairs`, or `region`. |
| `backgroundhighlighting` | `string` | `basepairs` | `nothing`, `basepairs`, or `region`. |
| `guBasepairs` | `boolean` | `true` | Render G-U pairs with dashed links. |
| `subsequenceHighlights` | `Array` | `[]` | Subsequence highlight definitions. |
| `regionHighlights` | `Array` | `[]` | Region highlight definitions. |
| `pointMutations` | `Array` | `[]` | Point-mutation definitions. |

```javascript
const validated = vaRRI.validate({
  sequence: 'ACGU&UGCA',
  structure: '((((&))))',
  startIndex1: -2,
  startIndex2: 10,
});
```

### `vaRRI.render(containerId, validated, options?)`

Creates a Fornac visualization, then applies labels, coloring, annotations,
profiles, and link styling. It returns a promise resolving to
`{ cancelled: boolean }`. Starting a newer render cancels pending
post-processing from the previous render.

| Option | Type | Default | Description |
|---|---|---|---|
| `forceLayout` | `boolean` | `false` | Enable Fornac force-layout animation. |
| `forceLayoutLinear` | `boolean` | `false` | Keep intermolecularly paired nucleotides on two rigid parallel rails. Loop bridges derive from the larger strand's arc length and retain bending slack on the shorter strand. Requires `forceLayout`. |
| `freeTrailingEnds` | `boolean` | `false` | Relax the external-loop closure scaffold when force layout is active. |
| `pullPseudoknotBasepairs` | `boolean` | `false` | Increase pseudoknot link strength when force layout is active. |
| `accessData` | `Object<number, number>\|null` | `null` | Node-ID to probability map. |
| `accessColors` | `Object\|null` | `null` | Optional `sequence1` and `sequence2` overlay colors. |
| `accessColorMode` | `Object\|null` | `null` | Optional `sequence1RepresentsOne` and `sequence2RepresentsOne` flags. |

```javascript
const state = await vaRRI.render('rna_ss', validated, {
  forceLayout: true,
  forceLayoutLinear: true,
  accessData: { 1: 0.8, 2: 0.3 },
});
```

### Rotation

- `vaRRI.normaliseRotationDegrees(degrees)` returns an angle in `[-180, 180]`.
- `vaRRI.rotateVisualization(containerId, degrees, options?)` rotates the
  current SVG. `options.mode` is `delta` by default or `absolute`.

Text labels are counter-rotated to remain readable.

## Colors

- `vaRRI.getColors()` returns a copy of the current color settings.
- `vaRRI.setColors(overrides)` updates only the supplied keys.

Supported keys are `sequence1`, `sequence2`, `seq1profileColor`,
`seq2profileColor`, `mutationColor`, `intermolecularHighlight`,
`backgroundHighlight`, `subsequenceHighlight`, and `basepair`.

## Annotation registries

The UI registries return clones, so mutating a returned object does not modify
library state. IDs start at `1` and reset after the corresponding `clear...()`
call.

### Subsequence highlights

A definition has `{ sequence, range, color?, alpha? }`. `sequence` is `1` or
`2`; `range` is a `"start-end"` string, a comma-separated range string, or an
array of `[start, end]` pairs.

- `vaRRI.createSubsequenceHighlight(input, sequenceContext?)`
- `vaRRI.registerSubsequenceHighlight(input, sequenceContext?)`
- `vaRRI.updateSubsequenceHighlight(id, patch, sequenceContext?)`
- `vaRRI.removeSubsequenceHighlight(id)`
- `vaRRI.clearSubsequenceHighlights()`
- `vaRRI.getSubsequenceHighlights()`

### Region highlights

A definition has
`{ sequence1Range, sequence2Range, color?, alpha?, generated? }`. Each range is
a `"start-end"` string or `[start, end]` pair.

- `vaRRI.createRegionHighlight(input, sequenceContext?)`
- `vaRRI.registerRegionHighlight(input, sequenceContext?)`
- `vaRRI.registerGeneratedRegionHighlight(validated, spec)`
- `vaRRI.updateRegionHighlight(id, patch, sequenceContext?)`
- `vaRRI.removeRegionHighlight(id)`
- `vaRRI.clearRegionHighlights()`
- `vaRRI.getRegionHighlights()`
- `vaRRI.computeBackgroundRegionRanges(validated)`
- `vaRRI.getRegionHighlightNodePath(validated, highlight)`

Generated highlights represent the automatic whole-RRI background region and
can be excluded from persisted user state.

### Point mutations

A definition has `{ sequence, position, replacement, color? }`.

- `vaRRI.createPointMutation(input, sequenceContext?)`
- `vaRRI.registerPointMutation(input, sequenceContext?)`
- `vaRRI.updatePointMutation(id, patch, sequenceContext?)`
- `vaRRI.removePointMutation(id)`
- `vaRRI.clearPointMutations()`
- `vaRRI.getPointMutations()`

A `sequenceContext` uses molecule keys and visible sequence metadata:

```javascript
const sequenceContext = {
  '1': { offset: -2, length: 4, sequence: 'ACGU' },
  '2': { offset: 10, length: 4, sequence: 'UGCA' },
};
```

## Validation and formatting helpers

| Function | Purpose |
|---|---|
| `checkStructureInputSimple(structure)` | Check bracket balance for `()`, `[]`, `{}`, and `<>`. |
| `findBasePairs(structure)` | Return zero-based matched bracket pairs. |
| `formatSequence(sequence)` | Return Fornac-ready sequence fields for one or two molecules. |
| `formatStructure(structure)` | Return Fornac-ready structure fields for one or two molecules. |
| `getIndexDictionary(validated)` | Map Fornac node IDs to molecule IDs and biological positions. |
| `getMolecules(validated)` | Return `"1"` or `"2"`. |
| `getSequenceIndices(seqId, offset, length)` | Generate biological indices while skipping zero. |
| `parseSubsequences(input, startIndex?, sequenceLength?)` | Parse and optionally bounds-check range strings. |
| `splitAtAmpersand(value)` | Split once and always return two strings. |
| `validateBackgroundhighlighting(value)` | Validate a background-highlighting mode. |
| `validateCroppingInput(structure, cropping)` | Validate and normalize cropping. |
| `validateHighlighting(value)` | Validate a nucleotide-highlighting mode. |
| `validateOffset(value)` | Parse a non-zero biological index. |
| `validateSequenceInput(sequence)` | Validate IUPAC sequence input. |
| `validateStructureInput(structure, sequence)` | Validate structure syntax and sequence-length parity. |

## Base-pair utilities

- `vaRRI.getIntermolBasepairRegion(structure1, structure2)`
- `vaRRI.getLinearRriConstraintSpecs(validated)`
- `vaRRI.listBasepairs(structureDictionary)`
- `vaRRI.listIntermolNodes(structure, shift?)`
- `vaRRI.listIntermolPairs(validated)`
- `vaRRI.sequenceColoring(sequence1, sequence2)`

## DOM modification helpers

These advanced functions operate on the current Fornac SVG. Normal consumers
should call `render()` and let it coordinate them.

| Function | Purpose |
|---|---|
| `addElement(elementType, attributes)` | Insert an SVG element in the plot. |
| `addStyleToNodes(nodeIds, style)` | Append inline style to nucleotide nodes. |
| `applyPointMutations(validated)` | Apply validated mutation overlays. |
| `applyRegionHighlights(validated)` | Draw registered or validated region polygons. |
| `applySubsequenceHighlights(validated)` | Draw validated subsequence overlays. |
| `backgroundhighlightBasepairs(validated)` | Draw backgrounds around intermolecular stacks. |
| `backgroundhighlightRegion(validated)` | Draw the automatic whole-RRI background. |
| `changeBackgroundColor(validated)` | Apply strand colors. |
| `closePolygonPoints(points)` | Close a polygon point list. |
| `getPositionOfNode(nodeId)` | Read a node's `[x, y]` coordinates. |
| `highlightBasepairs(validated)` | Highlight individual intermolecular nodes. |
| `highlightRegion(validated)` | Highlight the intermolecular region. |
| `highlightSubsequence(validated, sequence, ranges, color, alpha)` | Draw a subsequence overlay. |
| `polyline(indices, style, attributes?)` | Draw an SVG polyline through node IDs. |
| `removeDummyNodes(sequence)` | Remove Fornac gap nodes. |
| `removeSecondLink()` | Remove duplicate intermolecular links. |
| `setAttributeForElements(targetAttr, targetValue, attr, value)` | Update matching DOM elements. |
| `setIndexLabels(validated)` | Configure biological index labels. |
| `setLabelsId()` | Assign stable IDs to Fornac labels. |
| `setLinksId()` | Assign endpoint metadata to Fornac links. |
| `styleBasepairs(validated)` | Apply base-pair colors and G-U dashing. |
| `updateLinkTooltips(validated)` | Add biological positions to link tooltips. |
| `updateNodeToolTips(validated)` | Add biological positions to node tooltips. |
| `visualiseAccessibility(data, sequence1Length, colors?, colorMode?)` | Draw probability overlays. |

## Export

- `vaRRI.buildSVGString(containerId)` returns a self-contained SVG string with
  computed presentation styles and explicit dimensions.
- `vaRRI.downloadSVG(containerId, filename = 'vaRRI_output.svg')` downloads the
  self-contained SVG.
- `vaRRI.downloadPNG(containerId, filename = 'vaRRI_output.png', scale = 2)`
  rasterizes the same SVG onto a white canvas and downloads a PNG.

All three functions throw if the container does not contain an SVG.
