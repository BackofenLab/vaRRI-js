/**
 * vaRRI.js — Browser-only JavaScript port of the vaRRI RNA interaction visualiser.
 *
 * This library translates the Python vaRRI source into pure browser JavaScript,
 * removing all command-line dependencies (RNAfold, RNAplfold, Playwright).
 * It relies on Fornac (https://github.com/ViennaRNA/fornac) and D3.js which
 * must be loaded before this script.
 *
 * @module vaRRI
 */

(function (global) {
    'use strict';

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Number of invisible gap nodes Fornac inserts between two molecules. */
    const GAP = 3;

    // -----------------------------------------------------------------------
    // Utilities  (ported from utils.py)
    // -----------------------------------------------------------------------

    /**
     * Identify intermolecular basepair positions in a structure string.
     *
     * Analyses a dot-bracket structure and returns positions involved in
     * intermolecular basepairs.  Unmatched opening or closing brackets are
     * considered intermolecular.
     *
     * Supports `()`, `[]`, `{}`, `<>` bracket types independently.
     *
     * @param {string} struc  Structure string in dot-bracket notation.
     * @param {number} [shift=0]  Offset added to every returned index.
     * @returns {Array<[number, string]>}  Sorted list of [1-based index, bracket] pairs.
     */
    function listIntermolNodes(struc, shift = 0) {
        const interBasepairs = [];
        const openBasepairs = { '(': [], '<': [], '[': [], '{': [] };
        const bracketPairs = [['(', ')'], ['[', ']'], ['{', '}'], ['<', '>']];

        for (let i = 0; i < struc.length; i++) {
            const char = struc[i];
            const index = i + 1; // 1-based
            for (const [open, close] of bracketPairs) {
                if (char === open) {
                    openBasepairs[open].push([index + shift, char]);
                    break;
                }
                if (char === close) {
                    if (openBasepairs[open].length > 0) {
                        openBasepairs[open].pop();
                    } else {
                        interBasepairs.push([index + shift, char]);
                    }
                    break;
                }
            }
        }

        for (const pairs of Object.values(openBasepairs)) {
            interBasepairs.push(...pairs);
        }

        interBasepairs.sort((a, b) => a[0] - b[0]);
        return interBasepairs;
    }

    // -----------------------------------------------------------------------
    // Input validation  (ported from input_validation.py)
    // -----------------------------------------------------------------------

    /**
     * Split a string at the first `&` character.
     *
     * Always returns exactly two strings; the second is empty when `&` is absent.
     *
     * @param {string} str
     * @returns {[string, string]}
     */
    function splitAtAmpersand(str) {
        const idx = str.indexOf('&');
        if (idx === -1) return [str, ''];
        return [str.slice(0, idx), str.slice(idx + 1)];
    }

    /**
     * Check whether two strings have the same length.
     *
     * @param {string} a
     * @param {string} b
     * @returns {boolean}
     */
    function sameLength(a, b) {
        return a.length === b.length;
    }

    /**
     * Validate a structure string for correctly-paired brackets.
     *
     * Ensures `()`, `<>`, `[]`, `{}` are properly opened and closed.
     *
     * @param {string} structure  Dot-bracket structure, may contain `&`.
     * @throws {Error} When bracket counts do not balance.
     */
    function checkStructureInputSimple(structure) {
        const basepairs = { '(': 0, '<': 0, '[': 0, '{': 0 };
        const closingBp = { ')': '(', '>': '<', ']': '[', '}': '{' };

        for (const char of structure) {
            if (char in basepairs) {
                basepairs[char]++;
            } else if (char in closingBp) {
                const open = closingBp[char];
                basepairs[open]--;
                if (basepairs[open] < 0) {
                    throw new Error(
                        `The number of brackets does not line up. Too many closing ${char} brackets:\n${structure}`
                    );
                }
            }
        }

        for (const [bp, count] of Object.entries(basepairs)) {
            if (count > 0) {
                throw new Error(
                    `The number of brackets does not line up. Too many opening ${bp} brackets:\n${structure}`
                );
            }
        }
    }

    /**
     * Find base-pair indices in a dot-bracket structure string.
     *
     * @param {string} structure
     * @returns {Array<[number, number]>}  List of [open, close] index pairs (0-based).
     */
    function findBasePairs(structure) {
        const basepairList = [];
        const openBasepairs = { '(': [], '<': [], '[': [], '{': [] };
        const closingBp = { ')': '(', '>': '<', ']': '[', '}': '{' };

        for (let i = 0; i < structure.length; i++) {
            const char = structure[i];
            if (char in openBasepairs) {
                openBasepairs[char].push(i);
            } else if (char in closingBp) {
                const open = closingBp[char];
                if (openBasepairs[open].length > 0) {
                    const openIdx = openBasepairs[open].pop();
                    basepairList.push([openIdx, i]);
                }
            }
        }
        return basepairList;
    }

    /**
     * Remove base pairs that fall outside the given [start, end] bounds.
     *
     * @param {string[]} structureArr  Structure as an array of characters.
     * @param {[number, number]} bounds  [start, end] indices (0-based, inclusive).
     * @returns {string}  Modified structure as a string.
     */
    function removeBPoutsideBounds(structureArr, bounds) {
        const [start, end] = bounds;
        for (const [startBP, endBP] of findBasePairs(structureArr.join(''))) {
            if (startBP < start || endBP > end) {
                structureArr[startBP] = '.';
                structureArr[endBP] = '.';
            }
        }
        return structureArr.join('');
    }

    /**
     * Validate a sequence string — must consist of IUPAC nucleotide characters,
     * optionally separated by a single `&`.
     *
     * @param {string} sequence
     * @returns {string}  The validated sequence.
     * @throws {Error}
     */
    function validateSequenceInput(sequence) {
        if (sequence === '') throw new Error('No sequence given');
        if (/^([aAcCgGtTuUrRyYsSwWkKmMbBdDhHvVnN]+&)?[aAcCgGtTuUrRyYsSwWkKmMbBdDhHvVnN]+$/.test(sequence)) {
            return sequence;
        }
        throw new Error(`The given sequence input has invalid characters: ${sequence}`);
    }

    /**
     * Validate a structure string in dot-bracket notation.
     *
     * @param {string} structure
     * @param {string} sequence  Used to check length parity when `&` is present.
     * @returns {string}  The validated structure.
     * @throws {Error}
     */
    function validateStructureInput(structure, sequence) {
        if (structure === '') throw new Error('No structure given');

        if (structure.includes('&')) {
            const [struc1, struc2] = splitAtAmpersand(structure);
            const [seq1, seq2] = splitAtAmpersand(sequence);
            for (const [idx, struc, seq] of [[1, struc1, seq1], [2, struc2, seq2]]) {
                if (struc.length !== seq.length) {
                    throw new Error(
                        `Structure length (${struc.length}) and Sequence length (${seq.length}) ` +
                        `of molecule ${idx} do not match`
                    );
                }
            }
        } else {
            if (!sameLength(structure, sequence)) {
                throw new Error(
                    `Structure length (${structure.length}) and Sequence length (${sequence.length}) do not match`
                );
            }
        }

        if (/^([\.()<>\[\]{}]+&)?[\.()<>\[\]{}]+$/.test(structure)) {
            checkStructureInputSimple(structure);
            return structure;
        }
        throw new Error(`The given structure input is not valid: ${structure}`);
    }

    /**
     * Validate an offset value.
     *
     * @param {string} offsetStr  String representation of the offset.
     * @returns {number}
     * @throws {Error}
     */
    function validateOffset(offsetStr) {
        if (offsetStr === '0') throw new Error('Index 0 is not valid; use a value of -1 or less, or 1 or greater');
        if (/^-?\d+$/.test(offsetStr)) return parseInt(offsetStr, 10);
        throw new Error(`The given index input is not valid: ${offsetStr}`);
    }

    /**
     * Validate the highlighting option.
     *
     * @param {string} highlighting
     * @returns {string}
     * @throws {Error}
     */
    function validateHighlighting(highlighting) {
        const valid = ['nothing', 'basepairs', 'region'];
        if (valid.includes(highlighting)) return highlighting;
        throw new Error(
            `The given highlighting input (${highlighting}) is not accepted [nothing, basepairs, region]`
        );
    }

    /**
     * Validate the backgroundhighlighting option.
     *
     * @param {string} bgHighlighting
     * @returns {string}
     * @throws {Error}
     */
    function validateBackgroundhighlighting(bgHighlighting) {
        const valid = ['nothing', 'basepairs', 'region'];
        if (valid.includes(bgHighlighting)) return bgHighlighting;
        throw new Error(
            `The given backgroundhighlighting input (${bgHighlighting}) is not accepted [nothing, basepairs, region]`
        );
    }

    /**
     * Split structure string and apply the Fornac `&...` fix.
     *
     * Fornac incorrectly cuts the first 2 nodes of the second sequence when
     * the separator is exactly `&`.  Inserting `&...` compensates for this.
     *
     * @param {string} structure  Raw structure (may contain `&`).
     * @returns {{structure1: string, structure2: string, structure: string, structure_dict: Object}}
     */
    function formatStructure(structure) {
        const [first, second] = splitAtAmpersand(structure);

        // Fix: Fornac incorrectly cuts the first 2 nodes of the second sequence
        // when the separator is exactly `&`.  Inserting 3 gap dots compensates.
        // Build strings explicitly from the already-split parts to avoid
        // partial-replacement ambiguity on the `&` character.
        const fixedStructure = second !== '' ? first + '&...' + second : first;
        const bareStructure  = second !== '' ? first + '...'  + second : first;

        const structureDict = {};
        for (let i = 0; i < bareStructure.length; i++) {
            structureDict[String(i + 1)] = bareStructure[i];
        }

        return { structure1: first, structure2: second, structure: fixedStructure, structure_dict: structureDict };
    }

    /**
     * Split sequence string and apply the Fornac `&...` fix.
     *
     * @param {string} sequence  Raw sequence (may contain `&`).
     * @returns {{sequence1: string, sequence2: string, sequence: string, sequence_dict: Object}}
     */
    function formatSequence(sequence) {
        const [first, second] = splitAtAmpersand(sequence);

        // Same Fornac fix as formatStructure — build from split parts explicitly.
        const fixedSequence = second !== '' ? first + '&...' + second : first;
        const bareSequence  = second !== '' ? first + '...'  + second : first;

        const sequenceDict = {};
        for (let i = 0; i < bareSequence.length; i++) {
            sequenceDict[String(i + 1)] = bareSequence[i];
        }

        return { sequence1: first, sequence2: second, sequence: fixedSequence, sequence_dict: sequenceDict };
    }

    /**
     * Determine how many molecules are given (`"1"` or `"2"`).
     *
     * @param {{sequence2: string}} validated
     * @returns {"1"|"2"}
     */
    function getMolecules(validated) {
        return validated.sequence2 !== '' ? '2' : '1';
    }

    /**
     * Generate indexed sequence positions with RNA-style numbering (skipping 0).
     *
     * @param {string} seqId  Sequence identifier, e.g. `"s1"`.
     * @param {number} offset  Starting index.
     * @param {number} length  Length of the sequence.
     * @returns {Array<[string, number]>}  Array of [seqId, index] pairs.
     */
    function getSequenceIndices(seqId, offset, length) {
        const indices = [];
        for (let i = offset; i < offset + length; i++) {
            indices.push([seqId, i]);
        }
        // RNA-style: skip 0
        const zeroIdx = indices.findIndex(([, n]) => n === 0);
        if (zeroIdx !== -1) {
            indices.splice(zeroIdx, 1);
            const [seq, lastNum] = indices[indices.length - 1];
            indices.push([seq, lastNum + 1]);
        }
        return indices;
    }

    /**
     * Build a mapping from Fornac node ID (1-based) to [sequenceId, position].
     *
     * @param {{offset1: number, offset2: number, sequence1: string, sequence2: string}} v
     * @returns {Object.<number, [string, number]>}
     */
    function getIndexDictionary(v) {
        const { offset1, offset2, sequence1, sequence2 } = v;
        const gapList = Array.from({ length: GAP }, () => ['e', 0]);

        const indices = [
            ...getSequenceIndices('s1', offset1, sequence1.length),
            ...gapList,
            ...getSequenceIndices('s2', offset2, sequence2.length),
        ];

        const dict = {};
        indices.forEach(([seq, num], i) => {
            dict[i + 1] = [seq, num];
        });
        return dict;
    }

    /**
     * Validate all inputs and return a `validated` parameter object ready for rendering.
     *
     * @param {Object} args  Raw input parameters.
     * @param {string} args.structure    Dot-bracket structure, one or two molecules separated by `&`.
     * @param {string} args.sequence     RNA sequence, one or two molecules separated by `&`.
     * @param {string} [args.startIndex1="1"]  Start index for sequence 1.
     * @param {string} [args.startIndex2="1"]  Start index for sequence 2.
     * @param {string} [args.labelInterval="10"]  Interval for index label display.
     * @param {string} [args.coloring="strand"]  Coloring option: `"strand"` or `"loop"`.
     * @param {string} [args.highlighting="region"]  Highlighting option: `"nothing"`, `"basepairs"`, `"region"`.
     * @param {string} [args.backgroundhighlighting="basepairs"]  Background-highlighting option.
     * @param {boolean} [args.guBasepairs=true]  Whether to display G-U basepairs as dashed lines.
     * @param {string|null} [args.highlightSubseq1=null]  Subsequence range for sequence 1 `"start-end"` or null.
     * @param {string|null} [args.highlightSubseq2=null]  Subsequence range for sequence 2 `"start-end"` or null.
     * @returns {Object}  Validated parameter dictionary.
     * @throws {Error}  On invalid input.
     */
    function validate(args) {
        const v = {};

        // Sequence
        const rawSeq = (args.sequence || '').trim();
        validateSequenceInput(rawSeq);
        const seqFmt = formatSequence(rawSeq);
        Object.assign(v, seqFmt);

        // Offsets
        v.offset1 = validateOffset(String(args.startIndex1 || '1'));
        v.offset2 = validateOffset(String(args.startIndex2 || '1'));

        // Structure
        const rawStruc = (args.structure || '').trim();
        const validStruc = validateStructureInput(rawStruc, rawSeq);
        const strucFmt = formatStructure(validStruc);
        Object.assign(v, strucFmt);

        // Molecules
        v.molecules = getMolecules(v);

        // Options
        v.coloring = args.coloring || 'strand';
        v.highlighting = validateHighlighting(args.highlighting || 'region');
        v.backgroundhighlighting = validateBackgroundhighlighting(
            args.backgroundhighlighting || 'basepairs'
        );
        v.guBasepairs = args.guBasepairs !== false; // default true
        v.labelInterval = parseInt(String(args.labelInterval || '10'), 10) || 10;

        // Subsequence highlights (parse "start-end" strings)
        v.highlightSubseq1 = parseSubsequences(args.highlightSubseq1);
        v.highlightSubseq2 = parseSubsequences(args.highlightSubseq2);

        return v;
    }

    /**
     * Parse a comma-separated list of `"start-end"` range strings.
     *
     * @param {string|null|undefined} input
     * @returns {Array<[number,number]>|null}
     */
    function parseSubsequences(input) {
        if (!input || input.trim() === '') return null;
        const ranges = input.split(',').map(s => s.trim()).filter(Boolean);
        return ranges.map(r => {
            const parts = r.split('-').map(x => parseInt(x, 10));
            if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                throw new Error(`Invalid subsequence range: "${r}". Expected "start-end".`);
            }
            return parts;
        });
    }

    // -----------------------------------------------------------------------
    // DOM modification helpers  (ported from modifications.py)
    // -----------------------------------------------------------------------

    /**
     * Set an attribute on all elements that match `[targetAttr="targetValue"]`.
     *
     * @param {string} targetAttr
     * @param {string} targetValue
     * @param {string} setAttr
     * @param {string} setValue
     */
    function setAttributeForElements(targetAttr, targetValue, setAttr, setValue) {
        document.querySelectorAll(`[${targetAttr}="${targetValue}"]`).forEach(el => {
            el.setAttribute(setAttr, setValue);
        });
    }

    /**
     * Generate a color list for two sequences.
     *
     * Each nucleotide in `seq1` maps to `"lightblue"`;
     * each nucleotide in `seq2` maps to `"#F4BB44"`.
     *
     * @param {string} seq1
     * @param {string} seq2
     * @returns {string[]}
     */
    function sequenceColoring(seq1, seq2) {
        return [
            ...Array.from(seq1, () => 'lightblue'),
            ...Array.from(seq2, () => '#F4BB44'),
        ];
    }

    /**
     * Apply strand-based coloring to all nucleotide circles in the Fornac plot.
     *
     * @param {{sequence1: string, sequence2: string}} v
     */
    function changeBackgroundColor(v) {
        const coloring = sequenceColoring(v.sequence1, v.sequence2);
        if (coloring.length === 0) return;
        const nodes = document.querySelectorAll('[r="5"]');
        nodes.forEach((node, index) => {
            node.setAttribute('style', `fill: ${coloring[index]};`);
        });
    }

    /**
     * Assign `start` and `end` attributes to every `<line>` link element.
     *
     * Fornac stores link identity in a tooltip text child; this function
     * parses it and promotes the IDs to proper attributes.
     */
    function setLinksId() {
        document.querySelectorAll('line').forEach(line => {
            const textContent = line.children[0] && line.children[0].textContent;
            if (!textContent) return;
            const parts = textContent.split(':')[1];
            if (!parts) return;
            const ids = parts.split('-').filter(x => !isNaN(parseInt(x, 10)) && x !== '');
            if (ids.length >= 2) {
                line.setAttribute('start', ids[0].trim());
                line.setAttribute('end', ids[1].trim());
            }
        });
    }

    /**
     * Assign sequential `label_gnum` / `label_num` IDs to label elements.
     */
    function setLabelsId() {
        document.querySelectorAll('g[num="n-1"]').forEach((label, index) => {
            label.setAttribute('label_gnum', String(index + 1));
            if (label.firstChild) {
                label.firstChild.setAttribute('label_num', String(index + 1));
            }
        });
    }

    /**
     * Update node tooltip text to display correct sequence and index labels.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function updateNodeToolTips(v) {
        const indexDict = getIndexDictionary(v);
        for (const [key, [seq, num]] of Object.entries(indexDict)) {
            document.querySelectorAll(`circle[node_num="${key}"]`).forEach(node => {
                if (node.firstChild) {
                    node.firstChild.innerHTML = `${seq}[${num}]`;
                }
            });
        }
    }

    /**
     * Validate whether a label marker should be placed at the given position.
     *
     * Prevents two adjacent markers from being displayed simultaneously.
     *
     * @param {number} pos
     * @param {Object.<number, number>} indexing
     * @param {number} number
     * @returns {number}  The number to place, or 0 to suppress.
     */
    function validateLabelPos(pos, indexing, number) {
        for (const neighbor of [pos - 1, pos + 1]) {
            if (neighbor in indexing && indexing[neighbor] !== 0) {
                return 0;
            }
        }
        return number;
    }

    /**
     * Apply a red stroke style to the label at the given index.
     *
     * @param {number} targetIndex
     */
    function colorLabelRed(targetIndex) {
        document.querySelectorAll(`[label_num="${targetIndex}"]`).forEach(label => {
            label.setAttribute('style', 'stroke: red;stroke-width: 0.8;');
        });
    }

    /**
     * Remove label group elements at the given index.
     *
     * @param {number} index
     */
    function removeLabel(index) {
        document.querySelectorAll(`[label_gnum="${index}"]`).forEach(node => node.remove());
    }

    /**
     * Remove label-link line elements at the given index.
     *
     * @param {number} index
     */
    function removeLabelLink(index) {
        document.querySelectorAll(`line[start="${index}"]`).forEach(line => {
            if (line.getAttribute('link_type') === 'label_link') {
                line.remove();
            }
        });
    }

    /**
     * Set index labels on the Fornac plot using a priority system.
     *
     * Priority order (highest → lowest):
     * 1. Start/end of each sequence.
     * 2. Start/end of intermolecular basepair region.
     * 3. Every `labelInterval`-th position.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function setIndexLabels(v) {
        const { structure1, structure2, sequence1, labelInterval, molecules, sequence_dict } = v;
        const length1 = sequence1.length;
        const lengthTotal = Object.keys(sequence_dict).length;
        const indexDict = getIndexDictionary(v);
        const indexLabels = {};
        for (const key of Object.keys(indexDict)) {
            indexLabels[parseInt(key, 10)] = 0;
        }

        // Priority 1 — sequence boundaries
        for (const pos of [1, length1, length1 + GAP + 1, lengthTotal]) {
            if (!(pos in indexDict)) break;
            const [, number] = indexDict[pos];
            indexLabels[pos] = validateLabelPos(pos, indexLabels, number);
        }

        // Priority 2 — intermolecular basepair region boundaries
        if (molecules === '2') {
            const basepairRegion = getIntermolBasepairRegion(structure1, structure2);
            for (const region of basepairRegion) {
                for (const pos of region) {
                    if (!(pos in indexDict)) continue;
                    const [, number] = indexDict[pos];
                    indexLabels[pos] = validateLabelPos(pos, indexLabels, number);
                    colorLabelRed(pos);
                }
            }
        }

        // Priority 3 — every labelInterval
        for (const [posStr, [, number]] of Object.entries(indexDict)) {
            const pos = parseInt(posStr, 10);
            if (number % labelInterval === 0 || number === 1) {
                indexLabels[pos] = validateLabelPos(pos, indexLabels, number);
            }
        }

        // Apply labels
        const labelValues = Object.values(indexLabels);
        document.querySelectorAll('[label_type="label"]').forEach((label, index) => {
            label.innerHTML = labelValues[index] !== undefined ? labelValues[index] : '';
        });

        // Remove suppressed labels
        for (const [posStr, value] of Object.entries(indexLabels)) {
            if (value === 0) {
                const pos = parseInt(posStr, 10);
                removeLabel(pos);
                removeLabelLink(pos);
            }
        }
    }

    /**
     * Update tooltip text on link elements to display correct index values.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function updateLinkTooltips(v) {
        const updatedIndices = {};
        for (const [key, [, index]] of Object.entries(getIndexDictionary(v))) {
            updatedIndices[String(key)] = String(index);
        }
        document.querySelectorAll('line').forEach(line => {
            const start = line.getAttribute('start');
            const end = line.getAttribute('end');
            if (!line.firstChild) return;
            if (line.getAttribute('link_type') === 'label_link') {
                line.firstChild.textContent = updatedIndices[start] || '';
            } else {
                line.firstChild.textContent =
                    (updatedIndices[start] || '') + '-' + (updatedIndices[end] || '');
            }
        });
    }

    /**
     * Apply a CSS style string to an array of nodes by `node_num`.
     *
     * @param {number[]} nodeIds
     * @param {string} style
     */
    function addStyleToNodes(nodeIds, style) {
        nodeIds.forEach(nodeId => {
            document.querySelectorAll(`circle[node_num="${nodeId}"]`).forEach(node => {
                node.setAttribute('style', (node.getAttribute('style') || '') + style);
            });
        });
    }

    /**
     * Retrieve the x,y position of a Fornac node from its `transform` attribute.
     *
     * @param {number} nodeId
     * @returns {number[]}  [x, y] coordinates.
     */
    function getPositionOfNode(nodeId) {
        const pos = [];
        document.querySelectorAll(`g[num="n${nodeId}"]`).forEach(node => {
            const transform = node.getAttribute('transform') || '';
            const matches = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)];
            matches.forEach(([val]) => pos.push(parseFloat(val)));
        });
        return pos;
    }

    /**
     * Create and insert an SVG element at the beginning of the Fornac plot.
     *
     * @param {string} elementType  SVG tag name (e.g. `"circle"`, `"polyline"`).
     * @param {Object.<string,string>} attr  Attribute key→value map.
     */
    function addElement(elementType, attr) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', elementType);
        for (const [key, value] of Object.entries(attr)) {
            el.setAttribute(key, value);
        }
        const plot = document.getElementsByClassName('fornac-plot')[0];
        if (plot) plot.insertBefore(el, plot.firstChild);
    }

    /**
     * Draw a polyline connecting a list of Fornac node positions.
     *
     * @param {number[]} indices  Fornac node IDs to connect.
     * @param {string} style  CSS style string for the polyline.
     */
    function polyline(indices, style) {
        let posString = '';
        indices.forEach(index => {
            document.querySelectorAll(`g[num="n${index}"]`).forEach(node => {
                const transform = node.getAttribute('transform') || '';
                const match = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)];
                if (match.length >= 2) {
                    posString += `${match[0][0]},${match[1][0]} `;
                }
            });
        });

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', posString);
        poly.setAttribute('style', style);
        const plot = document.getElementsByClassName('fornac-plot')[0];
        if (plot) plot.insertBefore(poly, plot.firstChild);
    }

    /**
     * Compute [start, end] ranges of intermolecular basepair regions.
     *
     * @param {string} structure1
     * @param {string} structure2
     * @returns {Array<[number, number]>}
     */
    function getIntermolBasepairRegion(structure1, structure2) {
        const basepairRegion = [];
        const offset = structure1.length + GAP;

        for (const [structure, shift] of [[structure1, 0], [structure2, offset]]) {
            const basepairList = listIntermolNodes(structure, shift).map(([idx]) => idx);
            if (basepairList.length === 0) return [];
            basepairRegion.push([basepairList[0], basepairList[basepairList.length - 1]]);
        }
        return basepairRegion;
    }

    /**
     * Highlight nodes in the intermolecular basepair region with a red stroke.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function highlightingRegion(v) {
        const basepairRegion = getIntermolBasepairRegion(v.structure1, v.structure2);
        const intermolNodes = [];
        for (const [start, end] of basepairRegion) {
            for (let i = start; i <= end; i++) intermolNodes.push(i);
        }
        addStyleToNodes(intermolNodes, 'stroke: red;');
    }

    /**
     * Highlight individual intermolecular basepair nodes with a red stroke.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function highlightingBasepairs(v) {
        const split = v.sequence1.length + 1;
        document.querySelectorAll('[link_type="basepair"]').forEach(link => {
            const nodes = [
                parseInt(link.getAttribute('start'), 10),
                parseInt(link.getAttribute('end'), 10),
            ];
            if (!(nodes[0] < split && nodes[1] > split)) return;
            nodes.forEach(nodeNum => {
                const node = document.querySelector(`circle[node_num="${nodeNum}"]`);
                if (node) {
                    node.setAttribute('style', (node.getAttribute('style') || '') + 'stroke: red;');
                }
            });
        });
    }

    /**
     * Remove duplicate basepair links (keep only links where start < end).
     */
    function removeSecondLink() {
        document.querySelectorAll('[link_type="basepair"]').forEach(link => {
            const start = parseInt(link.getAttribute('start'), 10);
            const end = parseInt(link.getAttribute('end'), 10);
            if (start > end) link.remove();
        });
    }

    /**
     * Remove a Fornac node group element by ID.
     *
     * @param {number} id
     */
    function removeNode(id) {
        document.querySelectorAll(`[num="n${id}"]`).forEach(node => node.remove());
    }

    /**
     * Remove the directional arrow from a node.
     *
     * @param {number} id
     */
    function removeArrow(id) {
        document.querySelectorAll(`[num="n${id}"]`).forEach(node => {
            if (node.firstChild) node.firstChild.remove();
        });
    }

    /**
     * Remove a backbone link between two nodes.
     *
     * @param {number} startId
     * @param {number} endId
     */
    function removeLink(startId, endId) {
        const targetIds = `${startId},${endId}`;
        document.querySelectorAll('[link_type="backbone"]').forEach(link => {
            const ids = `${link.getAttribute('start')},${link.getAttribute('end')}`;
            if (ids === targetIds) link.remove();
        });
    }

    /**
     * Remove dummy gap nodes that Fornac inserts between two molecules.
     *
     * @param {string} sequence  The combined sequence string (with `&` and fix dots).
     */
    function removeDummyNodes(sequence) {
        for (let index = 0; index < sequence.length; index++) {
            if (sequence[index] === '.') {
                removeLink(index, index + 1);
                removeArrow(index + 1);
                removeNode(index);
            }
        }
    }

    /**
     * Highlight a subsequence range with a purple polyline or circle overlay.
     *
     * @param {Object} v  Validated parameter dictionary.
     * @param {"1"|"2"} seq  Which sequence to highlight.
     */
    function highlightSubsequence(v, seq) {
        const keyHighlight = `highlightSubseq${seq}`;
        const keyOffset = `offset${seq}`;

        // Map RNA index → Fornac web node id for the relevant sequence
        const indexDict = {};
        for (const [web, [mol, index]] of Object.entries(getIndexDictionary(v))) {
            if (mol === `s${seq}`) {
                indexDict[index] = parseInt(web, 10);
            }
        }

        const shift = seq === '2' ? v.sequence1.length + GAP : 0;

        for (const [start, end] of (v[keyHighlight] || [])) {
            const startIndex = v[keyOffset];

            if (start === end) {
                const webId = indexDict[start];
                const [x, y] = getPositionOfNode(webId);
                addElement('circle', { cx: String(x), cy: String(y), r: '7px', style: 'fill:purple;opacity:0.3;' });
                continue;
            }

            let distance1 = start - startIndex;
            let distance2 = end - start;

            if (startIndex < 0 && start > 0) distance1 -= 1;
            if (start < 0 && end > 0) distance2 -= 1;

            const startNode = distance1 + 1 + shift;
            const endNode = distance1 + distance2 + 1 + shift;
            const indices = [];
            for (let i = startNode; i <= endNode; i++) indices.push(i);

            polyline(indices,
                'stroke:purple;stroke-width:10;opacity:0.3;fill:None;' +
                'stroke-linejoin:miter;stroke-miterlimit:0.1;'
            );
        }
    }

    /**
     * Visualise G-U basepairs with a dashed line style.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function visualiseBasepairStrength(v) {
        // Build a 1-based sequence map including gap dots
        const seq1 = v.sequence1;
        const seq2 = v.sequence2;
        const gapDots = '.'.repeat(GAP);
        const combined = seq1 + gapDots + seq2;
        const seqDict = {};
        for (let i = 0; i < combined.length; i++) {
            seqDict[String(i + 1)] = combined[i];
        }

        document.querySelectorAll('[link_type="basepair"]').forEach(link => {
            const l1 = seqDict[link.getAttribute('start')];
            const l2 = seqDict[link.getAttribute('end')];
            if ((l1 === 'G' && l2 === 'U') || (l1 === 'U' && l2 === 'G')) {
                link.setAttribute('stroke-dasharray', '1,1');
            }
        });
    }

    /**
     * Parse basepairs from a dot-bracket-like structure dictionary.
     *
     * @param {Object.<string, string>} struc  Position → bracket character map.
     * @returns {Array<[number, number]>}  Sorted basepair index pairs.
     */
    function listBasepairs(struc) {
        const basepairs = [];
        const openBasepairs = { '(': [], '<': [], '[': [], '{': [] };
        const brackets = [['(', ')'], ['[', ']'], ['{', '}'], ['<', '>']];

        for (const [indexStr, char] of Object.entries(struc)) {
            const index = parseInt(indexStr, 10);
            for (const [open, close] of brackets) {
                if (char === open) { openBasepairs[open].push(index); break; }
                if (char === close) {
                    if (openBasepairs[open].length > 0) {
                        basepairs.push([openBasepairs[open].pop(), index]);
                    }
                    break;
                }
            }
        }
        basepairs.sort((a, b) => a[0] - b[0]);
        return basepairs;
    }

    /**
     * Extract intermolecular basepair pairs from the combined structure.
     *
     * @param {Object} v  Validated parameter dictionary.
     * @returns {Array<[number, number]>}
     */
    function listIntermolPairs(v) {
        const struc = v.structure_dict;
        const struc1 = v.structure1;
        const struc2 = v.structure2;
        const shift = struc1.length + GAP;

        const intermol = {};
        for (const i of Object.keys(struc)) intermol[i] = '.';

        for (const [index, bracket] of [
            ...listIntermolNodes(struc1),
            ...listIntermolNodes(struc2, shift),
        ]) {
            intermol[String(index)] = bracket;
        }

        return listBasepairs(intermol);
    }

    /**
     * Add background highlighting for intermolecular basepair stacks.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function backgroundhighlightingBasepairs(v) {
        const intermolPairs = listIntermolPairs(v);
        if (intermolPairs.length === 0) return;

        let stack = [intermolPairs.shift()];
        const highlightAreas = [];

        for (const [open, close] of intermolPairs) {
            const [stackOpen, stackClose] = stack[stack.length - 1];
            if (open - 1 === stackOpen && close + 1 === stackClose) {
                stack.push([open, close]);
                continue;
            }
            const area = stack.flatMap(([a, b]) => [a, b]).sort((a, b) => a - b);
            highlightAreas.push([...area, area[0]]);
            stack = [[open, close]];
        }
        const area = stack.flatMap(([a, b]) => [a, b]).sort((a, b) => a - b);
        highlightAreas.push([...area, area[0]]);

        for (const region of highlightAreas) {
            polyline(region, 'fill:red;opacity:0.2;stroke:red;stroke-width:7');
        }
    }

    /**
     * Add background highlighting for the entire intermolecular region.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function backgroundhighlightingRegion(v) {
        const basepairRegion = getIntermolBasepairRegion(v.structure1, v.structure2);
        const intermolNodes = [];
        for (const [start, end] of basepairRegion) {
            for (let i = start; i <= end; i++) intermolNodes.push(i);
        }
        polyline(intermolNodes, 'fill:red;opacity:0.2');
    }

    /**
     * Add an accessibility-overlay circle on top of an existing node.
     *
     * @param {number} id   Node ID.
     * @param {string} style  CSS style for the overlay.
     * @param {string} tooltip  Extra tooltip text to append.
     */
    function addAccessibilityOverlay(id, style, tooltip) {
        document.querySelectorAll(`circle[node_num="${id}"]`).forEach(node => {
            const overlay = node.cloneNode(true);
            overlay.setAttribute('node_num', `o${id}`);
            overlay.setAttribute('style', style);
            if (overlay.firstChild) {
                overlay.firstChild.innerHTML += tooltip;
            }
            node.after(overlay);
        });
    }

    /**
     * Map a probability value to an opacity (higher probability → lower opacity).
     *
     * @param {number} prb  Value in [0, 1].
     * @returns {number}
     */
    function mapProbabilityToOpacity(prb) {
        return 1 - prb;
    }

    /**
     * Visualise nucleotide accessibility data as overlaid coloured circles.
     *
     * @param {Object.<number, number>} accessData  Map of node ID → accessibility probability.
     * @param {number} lenSeq  Length of sequence 1 (used to distinguish colour by molecule).
     */
    function visualiseAccessibility(accessData, lenSeq) {
        for (const [indexStr, prb] of Object.entries(accessData)) {
            const index = parseInt(indexStr, 10);
            const color = index <= lenSeq ? 'purple' : 'red';
            const style = `fill: ${color};opacity: ${mapProbabilityToOpacity(prb)}; stroke-width: 0;`;
            const prbTooltip = '\n' + prb.toExponential(2);
            addAccessibilityOverlay(index, style, prbTooltip);
        }
    }

    // -----------------------------------------------------------------------
    // Main render function
    // -----------------------------------------------------------------------

    /**
     * Build the Fornac RNA visualisation inside `containerId` and apply all
     * vaRRI modifications.
     *
     * This is the main entry point.  Call `validate()` first to produce `v`.
     *
     * @param {string} containerId  CSS selector or element ID of the Fornac container.
     * @param {Object} v  Validated parameter dictionary (from `validate()`).
     * @param {Object} [options]
     * @param {boolean} [options.animation=false]  Enable Fornac force-layout animation.
     * @param {number}  [options.animationTimer=100]  Ms to wait when animation is on.
     * @param {boolean} [options.legend=false]  Whether to also render the legend.
     * @param {Object.<number,number>|null} [options.accessData=null]  Accessibility data map.
     */
    function render(containerId, v, options = {}) {
        const {
            animation = false,
            animationTimer = 100,
            accessData = null,
        } = options;

        // Build molecules via Fornac
        const container = new fornac.FornaContainer(
            `#${containerId}`,
            { animation: animation, labelInterval: 1 }
        );
        container.addRNA(v.structure, { structure: v.structure, sequence: v.sequence });

        function applyModifications() {
            // Set IDs for DOM querying
            setLinksId();
            setLabelsId();

            // Remove gap nodes
            removeDummyNodes(v.sequence);

            // Remove duplicate intermolecular links
            if (v.molecules === '2') {
                removeSecondLink();
            }

            // Strand coloring
            if (v.coloring === 'strand') {
                changeBackgroundColor(v);
            }

            // Tooltips and labels
            updateNodeToolTips(v);
            updateLinkTooltips(v);
            setIndexLabels(v);

            // Highlighting (only for 2-molecule input)
            if (v.molecules === '2') {
                if (v.highlighting === 'region') highlightingRegion(v);
                if (v.highlighting === 'basepairs') highlightingBasepairs(v);
                if (v.backgroundhighlighting === 'region') backgroundhighlightingRegion(v);
                if (v.backgroundhighlighting === 'basepairs') backgroundhighlightingBasepairs(v);
            }

            // G-U basepair strength
            if (v.guBasepairs) {
                visualiseBasepairStrength(v);
            }

            // Subsequence highlights
            if (v.highlightSubseq1 !== null) highlightSubsequence(v, '1');
            if (v.molecules === '2' && v.highlightSubseq2 !== null) highlightSubsequence(v, '2');

            // Accessibility overlay
            if (accessData) {
                visualiseAccessibility(accessData, v.sequence1.length);
            }
        }

        if (animation) {
            setTimeout(applyModifications, animationTimer);
        } else {
            // Fornac uses a requestAnimationFrame loop internally; we need to
            // wait for a tick before the SVG nodes exist in the DOM.
            setTimeout(applyModifications, 200);
        }
    }

    // -----------------------------------------------------------------------
    // SVG / PNG export
    // -----------------------------------------------------------------------

    /**
     * SVG presentation properties to inline when exporting.
     *
     * These cover every visual property used by Fornac and vaRRI: fill/stroke
     * paint, font, text alignment, and element visibility.  Using this fixed
     * list avoids dumping hundreds of irrelevant properties from
     * `getComputedStyle` (e.g. layout-only CSS that SVG viewers ignore).
     */
    const SVG_STYLE_PROPS = [
        'fill', 'fill-opacity', 'fill-rule',
        'stroke', 'stroke-width', 'stroke-opacity',
        'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
        'font-family', 'font-size', 'font-weight', 'font-style',
        'text-anchor', 'dominant-baseline', 'alignment-baseline',
        'opacity', 'visibility', 'display',
        'marker-start', 'marker-end', 'marker-mid',
        'color',
    ];

    /**
     * Walk `originalEl` and `cloneEl` in parallel, reading computed styles
     * from `originalEl` (which has all browser CSS applied) and writing them
     * as an inline `style` attribute on `cloneEl`.
     *
     * This makes every element carry its own fully-resolved presentation
     * values so the exported SVG is self-contained — no external stylesheet
     * is required.  In particular:
     *  - class-based rules (`.fornac-node`, `.fornac-link`, etc.) are baked in
     *  - relative units (`0.4em` font-size) are resolved to absolute pixels
     *  - inline `style` overrides from vaRRI (strand colours, highlights) are
     *    already included in the computed value, so nothing is lost
     *
     * @param {Element} originalEl  Live DOM element (inside the visible SVG).
     * @param {Element} cloneEl     Corresponding cloned element.
     */
    function inlineComputedStyles(originalEl, cloneEl) {
        if (!originalEl || originalEl.nodeType !== Node.ELEMENT_NODE) return;

        // Leave <style> and <defs> subtrees alone — they hold definitions, not
        // rendered shapes, and rewriting their style attributes would break them.
        const tag = (originalEl.tagName || '').toLowerCase();
        if (tag === 'style' || tag === 'defs') return;

        const computed = window.getComputedStyle(originalEl);
        let inlined = '';
        for (const prop of SVG_STYLE_PROPS) {
            const val = computed.getPropertyValue(prop);
            if (val) inlined += `${prop}:${val};`;
        }
        if (inlined) cloneEl.setAttribute('style', inlined);

        // Recurse into child elements in lock-step.
        const origKids  = originalEl.children;
        const cloneKids = cloneEl.children;
        for (let i = 0; i < origKids.length; i++) {
            if (cloneKids[i]) inlineComputedStyles(origKids[i], cloneKids[i]);
        }
    }

    /**
     * Build a self-contained SVG string from the current Fornac visualisation.
     *
     * Strategy:
     *  1. Clone the live SVG element (preserves all D3 transforms and vaRRI
     *     DOM modifications).
     *  2. Walk original + clone in parallel and inline every computed
     *     presentation property so the file is fully self-contained.
     *  3. Set explicit pixel width/height on the root so viewers render at
     *     the same size as the browser display.
     *  4. Prepend a white background rect to match the container's background.
     *  5. Serialise with XMLSerializer (namespace-aware).
     *
     * @param {string} containerId  ID of the container element.
     * @returns {string}  Full SVG markup.
     */
    function buildSVGString(containerId) {
        const container = document.getElementById(containerId);
        const svgEl = container && container.querySelector('svg');
        if (!svgEl) throw new Error('No SVG found in container');

        // Clone the live SVG so we can annotate it without touching the DOM.
        const clone = svgEl.cloneNode(true);

        // Inline all computed presentation styles before any other annotation
        // so that class-based CSS rules, relative units, and inherited values
        // are all baked into the clone as plain inline style attributes.
        inlineComputedStyles(svgEl, clone);

        // Required namespace declarations for a standalone SVG file.
        clone.setAttribute('xmlns',       'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        // Derive pixel dimensions from the rendered element so the exported
        // file renders at the same size as what the user sees in the browser.
        const w = svgEl.clientWidth  || container.clientWidth  || 800;
        const h = svgEl.clientHeight || container.clientHeight || 600;
        clone.setAttribute('width',  w);
        clone.setAttribute('height', h);

        // Keep (or synthesise) the viewBox so the internal coordinate space
        // that Fornac uses maps 1:1 to the exported pixel dimensions.
        if (!clone.getAttribute('viewBox')) {
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }

        // White background rect — matches the container's background: #fff
        // so the exported image looks identical to the on-screen visualisation.
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('width',  '100%');
        bg.setAttribute('height', '100%');
        bg.setAttribute('fill',   'white');
        clone.insertBefore(bg, clone.firstChild);

        return new XMLSerializer().serializeToString(clone);
    }

    /**
     * Trigger a browser download of the current visualisation as an SVG file.
     *
     * @param {string} containerId  ID of the container element.
     * @param {string} [filename="vaRRI_output.svg"]
     */
    function downloadSVG(containerId, filename = 'vaRRI_output.svg') {
        const svgStr = buildSVGString(containerId);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        triggerDownload(URL.createObjectURL(blob), filename);
    }

    /**
     * Trigger a browser download of the current visualisation as a PNG image.
     *
     * Rasterises the SVG to a canvas at `scale` × the rendered size and
     * converts it to a PNG data URL.  A white background is painted on the
     * canvas before the image is drawn so the result matches the on-screen
     * appearance.
     *
     * @param {string} containerId  ID of the container element.
     * @param {string} [filename="vaRRI_output.png"]
     * @param {number} [scale=2]  Resolution multiplier (2 = retina quality).
     */
    function downloadPNG(containerId, filename = 'vaRRI_output.png', scale = 2) {
        const svgStr = buildSVGString(containerId);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        // Determine the rendered pixel size from the live container so that
        // canvas dimensions are correct regardless of the SVG's naturalWidth.
        const container = document.getElementById(containerId);
        const svgEl = container && container.querySelector('svg');
        const w = (svgEl && svgEl.clientWidth)  || (container && container.clientWidth)  || 800;
        const h = (svgEl && svgEl.clientHeight) || (container && container.clientHeight) || 600;

        function rasterise(imgEl, canvasW, canvasH) {
            const canvas = document.createElement('canvas');
            canvas.width  = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext('2d');
            // White background to match the container's CSS background colour.
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvasW, canvasH);
            ctx.drawImage(imgEl, 0, 0, canvasW, canvasH);
            return canvas.toDataURL('image/png');
        }

        const img = new Image();
        img.onload = () => {
            const dataUrl = rasterise(img, w * scale, h * scale);
            URL.revokeObjectURL(url);
            triggerDownload(dataUrl, filename);
        };
        img.onerror = () => {
            // Fallback: load the SVG via a data URI instead of a blob URL.
            URL.revokeObjectURL(url);
            const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
            const imgFallback = new Image();
            imgFallback.onload = () => {
                triggerDownload(rasterise(imgFallback, w * scale, h * scale), filename);
            };
            imgFallback.src = dataUri;
        };
        img.src = url;
    }

    /**
     * Create a hidden `<a>` element and programmatically click it to download.
     *
     * @param {string} href  URL or data URI.
     * @param {string} filename
     */
    function triggerDownload(href, filename) {
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    const vaRRI = {
        // Core
        validate,
        render,

        // Export
        downloadSVG,
        downloadPNG,
        buildSVGString,

        // Validation helpers
        checkStructureInputSimple,
        validateSequenceInput,
        validateStructureInput,
        validateOffset,
        validateHighlighting,
        validateBackgroundhighlighting,
        splitAtAmpersand,
        findBasePairs,
        getIndexDictionary,
        getSequenceIndices,
        getMolecules,
        formatStructure,
        formatSequence,
        parseSubsequences,

        // Utility
        listIntermolNodes,
        listIntermolPairs,
        listBasepairs,
        getIntermolBasepairRegion,
        sequenceColoring,

        // DOM modifications (exposed for advanced use)
        setLinksId,
        setLabelsId,
        changeBackgroundColor,
        updateNodeToolTips,
        updateLinkTooltips,
        setIndexLabels,
        highlightingRegion,
        highlightingBasepairs,
        backgroundhighlightingRegion,
        backgroundhighlightingBasepairs,
        visualiseBasepairStrength,
        highlightSubsequence,
        removeDummyNodes,
        removeSecondLink,
        addStyleToNodes,
        polyline,
        addElement,
        getPositionOfNode,
        visualiseAccessibility,
        setAttributeForElements,
    };

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = vaRRI;
    } else {
        global.vaRRI = vaRRI;
    }

}(typeof window !== 'undefined' ? window : this));
