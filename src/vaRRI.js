/**
 * vaRRI.js — Browser-only JavaScript port of the vaRRI RNA-RNA interaction 
 * visualiser.
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

    /** Active requestAnimationFrame ID for the background-highlight animation loop (null when idle). */
    let _animFrameId = null;

    /** Active timeout ID for delayed post-processing after a render (null when idle). */
    let _renderTimeoutId = null;

    /** Resolver for the render promise that is currently waiting for post-processing. */
    let _pendingRenderResolve = null;

    /**
     * Default colours used by vaRRI rendering functions.
     *
     * Change these at runtime with {@link setColors}; the new values take
     * effect on the next call to any rendering function.
     */
    const COLORS = {
        /** Fill colour for nucleotide circles of sequence 1 in strand-colouring mode. */
        sequence1: 'lightblue',
        /** Fill colour for nucleotide circles of sequence 2 in strand-colouring mode. */
        sequence2: '#F4BB44',
        /** Default fill colour for sequence-1 accessibility/profile overlays. */
        seq1profileColor: 'purple',
        /** Default fill colour for sequence-2 accessibility/profile overlays. */
        seq2profileColor: 'red',
        /** Default fill colour for point mutation overlays. */
        mutationColor: 'Darkgreen',
        /** Stroke colour used for intermolecular nucleotide and index-label highlighting. */
        intermolecularHighlight: 'red',
        /** Fill/stroke colour used for background (region / basepair-stack) highlighting. */
        backgroundHighlight: 'red',
        /** Stroke colour used for subsequence-highlighting polylines and circles. */
        subsequenceHighlight: 'purple',
        /** Stroke colour used for basepair links. */
        basepair: 'red',
    };

    /** In-memory registry of user-defined subsequence highlight objects. */
    const SUBSEQUENCE_HIGHLIGHTS = [];
    let _nextHighlightId = 1;

    /** In-memory registry of user-defined region highlight objects. */
    const REGION_HIGHLIGHTS = [];
    let _nextRegionHighlightId = 1;

    /** In-memory registry of user-defined point mutation objects. */
    const POINT_MUTATIONS = [];
    let _nextMutationId = 1;

    /**
     * Return a deep-enough clone of a highlight object for external consumers.
     *
     * @param {Object} highlight
     * @returns {Object}
     */
    function cloneSubsequenceHighlight(highlight) {
        return {
            id: highlight.id,
            sequence: highlight.sequence,
            ranges: highlight.ranges.map(([start, end]) => [start, end]),
            color: highlight.color,
            rangeText: highlight.rangeText,
        };
    }

    /**
     * Validate and normalize a sequence selector for subsequence highlighting.
     *
     * @param {string|number} sequence
     * @returns {'1'|'2'}
     */
    function normaliseHighlightSequence(sequence) {
        const seq = String(sequence);
        if (seq !== '1' && seq !== '2') {
            throw new Error('Highlight sequence must be "1" or "2".');
        }
        return seq;
    }

    /**
     * Normalize and validate a highlight range input.
     *
     * @param {string|Array<[number, number]>} rangeInput
     * @param {{offset:number, length:number}=} context
     * @returns {{ranges:Array<[number, number]>, rangeText:string}}
     */
    function normaliseHighlightRanges(rangeInput, context) {
        if (typeof rangeInput === 'string') {
            const ranges = parseSubsequences(
                rangeInput,
                context ? context.offset : undefined,
                context ? context.length : undefined
            );
            if (!ranges || ranges.length === 0) {
                throw new Error('Highlight range must not be empty.');
            }
            return { ranges, rangeText: rangeInput.trim() };
        }

        if (!Array.isArray(rangeInput) || rangeInput.length === 0) {
            throw new Error('Highlight range must not be empty.');
        }

        const ranges = rangeInput.map((pair, idx) => {
            if (!Array.isArray(pair) || pair.length !== 2) {
                throw new Error(`Invalid subsequence range ${pair} at index ${idx}. Expected [start, end].`);
            }
            const start = Number(pair[0]);
            const end = Number(pair[1]);
            if (!Number.isInteger(start) || !Number.isInteger(end)) {
                throw new Error(`Invalid subsequence range at index ${idx}. Range bounds must be integers.`);
            }
            if (start === 0 || end === 0) {
                throw new Error(`Invalid subsequence range at index ${idx}. Index 0 is not valid.`);
            }
            if (start > end) {
                throw new Error(`Invalid subsequence range at index ${idx}. Start index must be <= end index.`);
            }
            return [start, end];
        });

        if (context) {
            parseSubsequences(
                ranges.map(([start, end]) => `${start}-${end}`).join(','),
                context.offset,
                context.length
            );
        }

        return {
            ranges,
            rangeText: ranges.map(([start, end]) => `${start}-${end}`).join(','),
        };
    }

    /**
     * Build a normalized subsequence-highlight object from user input.
     *
     * @param {{sequence:string|number, range:string|Array<[number, number]>, color?:string, id?:number}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {{id:number, sequence:'1'|'2', ranges:Array<[number, number]>, color:string, rangeText:string}}
     */
    function createSubsequenceHighlight(input, sequenceContext = {}) {
        const sequence = normaliseHighlightSequence(input.sequence);
        const context = sequenceContext[sequence];
        const normalizedRanges = normaliseHighlightRanges(input.range, context);
        const color = (input.color || '').trim() || COLORS.subsequenceHighlight;

        return {
            id: Number.isInteger(input.id) ? input.id : 0,
            sequence,
            ranges: normalizedRanges.ranges,
            color,
            rangeText: normalizedRanges.rangeText,
        };
    }

    /**
     * Register a new subsequence highlight object.
     *
     * @param {{sequence:string|number, range:string|Array<[number, number]>, color?:string}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function registerSubsequenceHighlight(input, sequenceContext = {}) {
        const normalized = createSubsequenceHighlight(input, sequenceContext);
        normalized.id = _nextHighlightId++;
        SUBSEQUENCE_HIGHLIGHTS.push(normalized);
        return cloneSubsequenceHighlight(normalized);
    }

    /**
     * Update an existing subsequence highlight object.
     *
     * @param {number} id
     * @param {{sequence?:string|number, range?:string|Array<[number, number]>, color?:string}} patch
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function updateSubsequenceHighlight(id, patch, sequenceContext = {}) {
        const target = SUBSEQUENCE_HIGHLIGHTS.find(h => h.id === id);
        if (!target) {
            throw new Error(`Highlight with id ${id} not found.`);
        }

        const normalized = createSubsequenceHighlight({
            id,
            sequence: patch.sequence !== undefined ? patch.sequence : target.sequence,
            range: patch.range !== undefined ? patch.range : target.ranges,
            color: patch.color !== undefined ? patch.color : target.color,
        }, sequenceContext);

        target.sequence = normalized.sequence;
        target.ranges = normalized.ranges;
        target.color = normalized.color;
        target.rangeText = normalized.rangeText;

        return cloneSubsequenceHighlight(target);
    }

    /**
     * Remove a subsequence highlight object by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removeSubsequenceHighlight(id) {
        const idx = SUBSEQUENCE_HIGHLIGHTS.findIndex(h => h.id === id);
        if (idx === -1) return false;
        SUBSEQUENCE_HIGHLIGHTS.splice(idx, 1);
        return true;
    }

    /**
     * Remove all registered subsequence highlights.
     */
    function clearSubsequenceHighlights() {
        SUBSEQUENCE_HIGHLIGHTS.length = 0;
        _nextHighlightId = 1;
    }

    /**
     * Read registered subsequence highlights.
     *
     * @returns {Array<Object>}
     */
    function getSubsequenceHighlights() {
        return SUBSEQUENCE_HIGHLIGHTS.map(cloneSubsequenceHighlight);
    }

    /**
     * Return a deep-enough clone of a region-highlight object for external consumers.
     *
     * @param {Object} highlight
     * @returns {Object}
     */
    function cloneRegionHighlight(highlight) {
        return {
            id: highlight.id,
            sequence1Range: [highlight.sequence1Range[0], highlight.sequence1Range[1]],
            sequence2Range: [highlight.sequence2Range[0], highlight.sequence2Range[1]],
            color: highlight.color,
            rangeText: highlight.rangeText,
            generated: !!highlight.generated,
        };
    }

    /**
     * Normalize a range input for region highlighting.
     *
     * @param {string|Array<number|[number, number]>} rangeInput
     * @param {{offset:number, length:number}=} context
     * @returns {{range:[number, number], rangeText:string}}
     */
    function normaliseRegionRange(rangeInput, context = {}) {
        if (typeof rangeInput === 'string') {
            const ranges = parseSubsequences(rangeInput, context.offset, context.length);
            if (!ranges || ranges.length === 0) {
                throw new Error('Region range must not be empty.');
            }
            if (ranges.length > 1) {
                throw new Error('Region highlighting supports a single range per sequence.');
            }
            const [start, end] = ranges[0];
            return { range: [start, end], rangeText: rangeInput.trim() };
        }

        if (!Array.isArray(rangeInput) || rangeInput.length === 0) {
            throw new Error('Region range must not be empty.');
        }

        const pair = rangeInput;
        if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error('Invalid region range. Expected [start, end].');
        }

        const start = Number(pair[0]);
        const end = Number(pair[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
            throw new Error('Invalid region range. Range bounds must be integers.');
        }
        if (start === 0 || end === 0) {
            throw new Error('Invalid region range. Index 0 is not valid.');
        }
        if (start > end) {
            throw new Error('Invalid region range. Start index must be <= end index.');
        }

        if (context) {
            parseSubsequences(`${start}-${end}`, context.offset, context.length);
        }

        return {
            range: [start, end],
            rangeText: `${start}-${end}`,
        };
    }

    /**
     * Build a normalized region-highlight object from user input.
     *
     * @param {{sequence1Range:string|[number, number], sequence2Range:string|[number, number], color?:string, generated?:boolean, id?:number}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {{id:number, sequence1Range:[number, number], sequence2Range:[number, number], color:string, rangeText:string, generated:boolean}}
     */
    function createRegionHighlight(input, sequenceContext = {}) {
        const context1 = sequenceContext['1'];
        const context2 = sequenceContext['2'];
        const seq1Range = normaliseRegionRange(input.sequence1Range, context1);
        const seq2Range = normaliseRegionRange(input.sequence2Range, context2);
        const color = (input.color || '').trim() || COLORS.backgroundHighlight;

        return {
            id: Number.isInteger(input.id) ? input.id : 0,
            sequence1Range: seq1Range.range,
            sequence2Range: seq2Range.range,
            color,
            rangeText: `${seq1Range.rangeText}&${seq2Range.rangeText}`,
            generated: !!input.generated,
        };
    }

    /**
     * Register a new region highlight object.
     *
     * @param {{sequence1Range:string|[number, number], sequence2Range:string|[number, number], color?:string, generated?:boolean}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function registerRegionHighlight(input, sequenceContext = {}) {
        const normalized = createRegionHighlight(input, sequenceContext);
        normalized.id = _nextRegionHighlightId++;
        REGION_HIGHLIGHTS.push(normalized);
        return cloneRegionHighlight(normalized);
    }

    /**
     * Update an existing region highlight object.
     *
     * @param {number} id
     * @param {{sequence1Range?:string|[number, number], sequence2Range?:string|[number, number], color?:string, generated?:boolean}} patch
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function updateRegionHighlight(id, patch, sequenceContext = {}) {
        const target = REGION_HIGHLIGHTS.find(h => h.id === id);
        if (!target) {
            throw new Error(`Region highlight with id ${id} not found.`);
        }

        const normalized = createRegionHighlight({
            id,
            sequence1Range: patch.sequence1Range !== undefined ? patch.sequence1Range : target.sequence1Range,
            sequence2Range: patch.sequence2Range !== undefined ? patch.sequence2Range : target.sequence2Range,
            color: patch.color !== undefined ? patch.color : target.color,
            generated: patch.generated !== undefined ? patch.generated : target.generated,
        }, sequenceContext);

        target.sequence1Range = normalized.sequence1Range;
        target.sequence2Range = normalized.sequence2Range;
        target.color = normalized.color;
        target.rangeText = normalized.rangeText;
        target.generated = normalized.generated;

        return cloneRegionHighlight(target);
    }

    /**
     * Remove a region highlight object by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removeRegionHighlight(id) {
        const idx = REGION_HIGHLIGHTS.findIndex(h => h.id === id);
        if (idx === -1) return false;
        REGION_HIGHLIGHTS.splice(idx, 1);
        return true;
    }

    /**
     * Remove all registered region highlights.
     */
    function clearRegionHighlights() {
        REGION_HIGHLIGHTS.length = 0;
        _nextRegionHighlightId = 1;
    }

    /**
     * Read registered region highlights.
     *
     * @returns {Array<Object>}
     */
    function getRegionHighlights() {
        return REGION_HIGHLIGHTS.map(cloneRegionHighlight);
    }

    /**
     * Return a deep-enough clone of a point-mutation object for external consumers.
     *
     * @param {Object} mutation
     * @returns {Object}
     */
    function clonePointMutation(mutation) {
        return {
            id: mutation.id,
            sequence: mutation.sequence,
            position: mutation.position,
            replacement: mutation.replacement,
            reference: mutation.reference,
            nodeId: mutation.nodeId,
            color: mutation.color,
            labelText: mutation.labelText,
        };
    }

    /**
     * Validate and normalize a mutation sequence selector.
     *
     * @param {string|number} sequence
     * @returns {'1'|'2'}
     */
    function normaliseMutationSequence(sequence) {
        const seq = String(sequence);
        if (seq !== '1' && seq !== '2') {
            throw new Error('Mutation sequence must be "1" or "2".');
        }
        return seq;
    }

    /**
     * Build a map of valid sequence positions to their bases.
     *
     * @param {{offset:number, sequence:string}|undefined} context
     * @returns {Object.<number, string>}
     */
    function buildSequencePositionMap(context) {
        const map = {};
        if (!context || !Number.isInteger(context.offset) || typeof context.sequence !== 'string') {
            return map;
        }

        getSequenceIndices('s', context.offset, context.sequence.length).forEach(([, position], index) => {
            map[position] = context.sequence[index];
        });
        return map;
    }

    /**
     * Normalize a mutation position and validate it against the current sequence context.
     *
     * @param {number|string} positionInput
     * @param {{offset:number, sequence:string}|undefined} context
     * @returns {number}
     */
    function normaliseMutationPosition(positionInput, context) {
        if (positionInput === undefined || positionInput === null || positionInput === '') {
             throw new Error('Mutation position must not be empty.');
        }
        const position = validateOffset(String(positionInput));

        if (context) {
            const sequencePositionMap = buildSequencePositionMap(context);
            if (!(position in sequencePositionMap)) {
                throw new Error('Mutation position must be a valid sequence index.');
            }
        }

        return position;
    }

    /**
     * Validate a point-mutation replacement base.
     *
     * @param {string} replacement
     * @returns {string}
     */
    function normaliseMutationReplacement(replacement) {
        const newLetter = String(replacement || '').trim();
        if (newLetter.length !== 1) {
            throw new Error('Mutation replacement must be a single letter.');
        }
        return newLetter;
    }

    /**
     * Build a normalized point-mutation object from user input.
     *
     * @param {{sequence:string|number, position:number|string, replacement:string, color?:string, id?:number}} input
     * @param {{'1'?:{offset:number, sequence:string}, '2'?:{offset:number, sequence:string}}=} sequenceContext
     * @returns {{id:number, sequence:'1'|'2', position:number, replacement:string, reference:string, nodeId:number, color:string, labelText:string}}
     */
    function createPointMutation(input, sequenceContext = {}) {
        const sequence = normaliseMutationSequence(input.sequence);
        const context = sequenceContext[sequence];
        const position = normaliseMutationPosition(input.position, context);
        const replacement = normaliseMutationReplacement(input.replacement);
        const color = (input.color || '').trim() || COLORS.intermolecularHighlight;

        const referenceMap = context ? buildSequencePositionMap(context) : {};
        const reference = referenceMap[position] || '';

        return {
            id: Number.isInteger(input.id) ? input.id : 0,
            sequence,
            position,
            replacement,
            reference,
            nodeId: 0,
            color,
            labelText: `${reference || '?'}${position}${replacement}`,
        };
    }

    /**
     * Register a new point mutation.
     *
     * @param {{sequence:string|number, position:number|string, replacement:string, color?:string}} input
     * @param {{'1'?:{offset:number, sequence:string}, '2'?:{offset:number, sequence:string}}=} sequenceContext
     * @returns {Object}
     */
    function registerPointMutation(input, sequenceContext = {}) {
        const normalized = createPointMutation(input, sequenceContext);
        normalized.id = _nextMutationId++;
        POINT_MUTATIONS.push(normalized);
        return clonePointMutation(normalized);
    }

    /**
     * Update an existing point mutation.
     *
     * @param {number} id
     * @param {{sequence?:string|number, position?:number|string, replacement?:string, color?:string}} patch
     * @param {{'1'?:{offset:number, sequence:string}, '2'?:{offset:number, sequence:string}}=} sequenceContext
     * @returns {Object}
     */
    function updatePointMutation(id, patch, sequenceContext = {}) {
        const target = POINT_MUTATIONS.find(m => m.id === id);
        if (!target) {
            throw new Error(`Mutation with id ${id} not found.`);
        }

        const normalized = createPointMutation({
            id,
            sequence: patch.sequence !== undefined ? patch.sequence : target.sequence,
            position: patch.position !== undefined ? patch.position : target.position,
            replacement: patch.replacement !== undefined ? patch.replacement : target.replacement,
            color: patch.color !== undefined ? patch.color : target.color,
        }, sequenceContext);

        target.sequence = normalized.sequence;
        target.position = normalized.position;
        target.replacement = normalized.replacement;
        target.reference = normalized.reference;
        target.nodeId = normalized.nodeId;
        target.color = normalized.color;
        target.labelText = normalized.labelText;

        return clonePointMutation(target);
    }

    /**
     * Remove a point mutation by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removePointMutation(id) {
        const idx = POINT_MUTATIONS.findIndex(m => m.id === id);
        if (idx === -1) return false;
        POINT_MUTATIONS.splice(idx, 1);
        return true;
    }

    /**
     * Remove all registered point mutations.
     */
    function clearPointMutations() {
        POINT_MUTATIONS.length = 0;
        _nextMutationId = 1;
    }

    /**
     * Read registered point mutations.
     *
     * @returns {Array<Object>}
     */
    function getPointMutations() {
        return POINT_MUTATIONS.map(clonePointMutation);
    }

    /**
     * Find the node ID that corresponds to a given sequence position.
     *
     * @param {Object} v
     * @param {'1'|'2'} sequence
     * @param {number} position
     * @returns {number}
     */
    function getNodeIdForSequencePosition(v, sequence, position) {
        for (const [nodeId, [seqName, seqPosition]] of Object.entries(getIndexDictionary(v))) {
            if (seqName === `s${sequence}` && seqPosition === position) {
                return parseInt(nodeId, 10);
            }
        }
        return 0;
    }

    /**
     * Override one or more default rendering colours.
     *
     * Only the keys present in `overrides` are changed; all others retain
     * their current values.  The new colours take effect on the next call to
     * any rendering function.
     *
    * Valid keys: `sequence1`, `sequence2`, `seq1profileColor`, `seq2profileColor`,
    * `mutationColor`, `intermolecularHighlight`, `backgroundHighlight`, `subsequenceHighlight`, `basepair`.
     *
     * @param {Partial<typeof COLORS>} overrides  Key → CSS-colour-string map.
     */
    function setColors(overrides) {
        Object.assign(COLORS, overrides);
    }

    /**
     * Return a shallow copy of the current colour settings.
     *
     * @returns {typeof COLORS}
     */
    function getColors() {
        return { ...COLORS };
    }

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
     * Validate cropping input.  Must be an integer string, and disallowed for
     * @param {string} cropping (integer string to be validated)
     * @param {string} structure Validated structure string, used to check for unpaired-only structures)
     * @returns the validated cropping string
     * @throws {Error}  When cropping is not a valid integer or when cropping is disallowed for unpaired-only structures.
     */
    function validateCroppingInput(structure, cropping) {
        // check if cropping is not set, return default value
        if (!cropping) return '-1';  // default value

        // check if cropping is a valid integer string
        if (!/^-?\d+$/.test(cropping)) {
            throw new Error(`The given cropping input is not an integer: ${cropping}`);
        }
        
        // negative cropping is indicating no cropping, return -1
        if (parseInt(cropping, 10) < 0) return -1;  

        // check if structure is only composed of dots (unpaired) and if so, disallow cropping
        if( structure ) {
            if (!structure.match(/[^.&]/)) {
                throw new Error('Cropping is not allowed for structures with only unpaired nucleotides.');
            }
            if (structure.includes('&')) {
                // check structure of the first molecule (before &) if present
                const [struc1, struc2] = splitAtAmpersand(structure);
                if (!struc1.match(/[^.]/) || !struc2.match(/[^.]/)) {
                    throw new Error('Cropping is not allowed for structures with only unpaired nucleotides in either molecule.');
                }
            }
        }
        return cropping;
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
     * Crop leading and trailing unpaired nucleotides from sequences and structures.
     * 
     * @param {string} rawSeq 
     * @param {string} validStruc 
     * @param {integer} offset1 
     * @param {integer} offset2 
     * @param {integer} cropping 
     * @returns Object with updated rawSeq, validStruc, offset1, offset2
     */
    function applyCropping(rawSeq, validStruc, offset1, offset2, cropping) {

        // check if cropping is not set or is negative, return original values
        if( !cropping || cropping < 0 ) {
            return { rawSeq, validStruc, offset1, offset2 };
        }

        let seq = rawSeq.split('&');
        let str = validStruc.split('&');
        let off = [offset1, offset2];
                
        for (let i = 0; i < seq.length; i++) {
            // leading cropping
            let unpairedLeading = str[i].match(/^\.+/);
            if (unpairedLeading && unpairedLeading[0].length > cropping) {
                seq[i] = seq[i].slice(unpairedLeading[0].length - cropping);
                str[i] = str[i].slice(unpairedLeading[0].length - cropping);
                const offOld = off[i];
                off[i] += unpairedLeading[0].length - cropping;
                if (off[i] >= 0 && offOld < 0) { off[i] += 1; } // skip 0
            }
            // trailing cropping
            let trailing = str[i].match(/\.+$/);
            if (trailing && trailing[0].length > cropping) {
                seq[i] = seq[i].slice(0, seq[i].length - (trailing[0].length - cropping));
                str[i] = str[i].slice(0, str[i].length - (trailing[0].length - cropping));
                }
        }
                    
        // return updated values
        return { rawSeq: seq.join("&"), validStruc: str.join("&"), offset1: off[0], offset2: off[1] };
    }

    /**
     * Validate all inputs and return a `validated` parameter object ready for rendering.
     *
     * @param {Object} args  Raw input parameters.
     * @param {string} args.structure    Dot-bracket structure, one or two molecules separated by `&`.
     * @param {string} args.sequence     RNA sequence, one or two molecules separated by `&`.
     * @param {string} [args.cropping="-1"]  Cropping value (integer string).
     * @param {string} [args.startIndex1="1"]  Start index for sequence 1.
     * @param {string} [args.startIndex2="1"]  Start index for sequence 2.
     * @param {string} [args.labelInterval="10"]  Interval for index label display.
     * @param {string} [args.coloring="strand"]  Coloring option: `"strand"` or `"loop"`.
     * @param {string} [args.highlighting="region"]  Highlighting option: `"nothing"`, `"basepairs"`, `"region"`.
     * @param {string} [args.backgroundhighlighting="basepairs"]  Background-highlighting option.
     * @param {boolean} [args.guBasepairs=true]  Whether to display G-U basepairs as dashed lines.
    * @param {Array<{sequence:string|number, range:string|Array<[number, number]>, color?:string}>} [args.subsequenceHighlights=[]]
    *     Generic subsequence-highlight definitions.
     * @returns {Object}  Validated parameter dictionary.
     * @throws {Error}  On invalid input.
     */
    function validate(args) {
        const v = {};

        // Sequence
        const rawSeq = (args.sequence || '').trim();
        validateSequenceInput(rawSeq);
        
        // Structure
        const rawStruc = (args.structure || '').trim();
        const validStruc = validateStructureInput(rawStruc, rawSeq);
        
        // Offsets
        v.offset1 = validateOffset(String(args.startIndex1 || '1'));
        v.offset2 = validateOffset(String(args.startIndex2 || '1'));
        
        // Cropping
        const cropping = validateCroppingInput(validStruc, String(args.cropping || '-1'));

        // update sequences, structures and offsets based on cropping
        const cropped = applyCropping(rawSeq, validStruc, v.offset1, v.offset2, cropping);

        // update offset information
        v.offset1 = cropped.offset1;
        v.offset2 = cropped.offset2;

        // create the formatted sequence and structure objects
        const seqFmt = formatSequence(cropped.rawSeq);
        Object.assign(v, seqFmt);
        const strucFmt = formatStructure(cropped.validStruc);
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

        // Subsequence highlights
        const sequenceContext = {
            '1': { offset: v.offset1, length: v.sequence1.length, sequence: v.sequence1 },
            '2': { offset: v.offset2, length: v.sequence2.length, sequence: v.sequence2 },
        };

        if (Array.isArray(args.subsequenceHighlights)) {
            v.subsequenceHighlights = args.subsequenceHighlights.map(h =>
                createSubsequenceHighlight(h, sequenceContext)
            );
        } else {
            v.subsequenceHighlights = [];
        }

        if (Array.isArray(args.regionHighlights)) {
            v.regionHighlights = args.regionHighlights.map(highlight =>
                createRegionHighlight(highlight, sequenceContext)
            );
        } else {
            v.regionHighlights = [];
        }

        if (Array.isArray(args.pointMutations)) {
            v.pointMutations = args.pointMutations.map(mutation =>
                createPointMutation(mutation, sequenceContext)
            );

            const seenMutationPositions = new Set();
            v.pointMutations.forEach(mutation => {
                const key = `${mutation.sequence}:${mutation.position}`;
                if (seenMutationPositions.has(key)) {
                    throw new Error(`Duplicate point mutation at ${key}.`);
                }
                seenMutationPositions.add(key);

                mutation.nodeId = getNodeIdForSequencePosition(v, mutation.sequence, mutation.position);
                if (!mutation.nodeId) {
                    throw new Error(`Mutation position ${mutation.position} is not visible in the current rendering.`);
                }
                mutation.labelText = `${mutation.reference || '?'}${mutation.position}${mutation.replacement}`;
            });
        } else {
            v.pointMutations = [];
        }

        return v;
    }

    /**
     * Parse a comma-separated list of `"start-end"` range strings.
     *
     * @param {string|null|undefined} input
     * @param {number} [startIndex]
     * @param {number} [sequenceLength]
     * @returns {Array<[number,number]>|null}
     */
    function parseSubsequences(input, startIndex, sequenceLength) {
        if (!input || input.trim() === '') return null;
        let validIndices = null;
        if (Number.isInteger(startIndex) && Number.isInteger(sequenceLength) && sequenceLength >= 0) {
            validIndices = new Set(
                getSequenceIndices('s', startIndex, sequenceLength).map(([, index]) => index)
            );
        }
        const ranges = input.split(',').map(s => s.trim()).filter(Boolean);
        return ranges.map(r => {
            const match = r.match(/^(-?\d+)-(-?\d+)$/);
            if (!match) {
                throw new Error(`Invalid subsequence range: "${r}". Expected "start-end".`);
            }
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);

            if (start === 0 || end === 0) {
                throw new Error(`Invalid subsequence range: "${r}". Index 0 is not valid.`);
            }
            if (start > end) {
                throw new Error(`Invalid subsequence range: "${r}". Start index must be <= end index.`);
            }
            if (validIndices && (!validIndices.has(start) || !validIndices.has(end))) {
                throw new Error(
                    `Invalid subsequence range: "${r}". Range endpoints must be valid sequence indices.`
                );
            }

            return [start, end];
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
     * Each nucleotide in `seq1` maps to {@link COLORS.sequence1};
     * each nucleotide in `seq2` maps to {@link COLORS.sequence2}.
     *
     * @param {string} seq1
     * @param {string} seq2
     * @returns {string[]}
     */
    function sequenceColoring(seq1, seq2) {
        return [
            ...Array.from(seq1, () => COLORS.sequence1),
            ...Array.from(seq2, () => COLORS.sequence2),
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
     * Apply the intermolecular-highlight stroke style to the label at the given index.
     *
     * @param {number} targetIndex
     */
    function highlightLabel(targetIndex) {
        document.querySelectorAll(`[label_num="${targetIndex}"]`).forEach(label => {
            label.setAttribute('style', `stroke: ${COLORS.intermolecularHighlight};stroke-width: 0.8;`);
        });
    }

    /**
     * Set or update the SVG title used as a hover tooltip for a label.
     *
     * @param {SVGElement} label
     * @param {string} text
     */
    function setLabelTooltip(label, text) {
        const parent = label.parentElement;
        if (!parent) return;

        const existingTitleOnLabel = label.querySelector('title');
        if (existingTitleOnLabel) existingTitleOnLabel.remove();

        let title = parent.querySelector('title');
        if (!title) {
            title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            parent.insertBefore(title, parent.firstChild);
        }
        title.textContent = text;
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
        const mutationByNodeId = {};
        (Array.isArray(v.pointMutations) ? v.pointMutations : []).forEach(mutation => {
            if (mutation.nodeId) mutationByNodeId[mutation.nodeId] = mutation;
        });
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
                    highlightLabel(pos);
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
        const labelValues = Object.entries(indexLabels);
        document.querySelectorAll('[label_type="label"]').forEach((label, index) => {
            const [posStr, value] = labelValues[index] || [];
            const pos = posStr ? parseInt(posStr, 10) : 0;
            const mutation = pos && mutationByNodeId[pos] ? mutationByNodeId[pos] : null;

            if (mutation) {
                label.innerHTML = mutation.replacement;
                setLabelTooltip(label, `Mutation: ${mutation.labelText}`);
                label.setAttribute('style', `fill: ${mutation.color}; stroke: ${mutation.color}; stroke-width: 0.2; font-weight: bolder;`);
                addStyleToNodes([mutation.nodeId], `stroke: ${mutation.color}; stroke-width: 2px;`);
                return;
            }

            label.removeAttribute('style');
            const parent = label.parentElement;
            const existingTitle = parent?.querySelector('title');
            if (existingTitle) existingTitle.remove();
            label.innerHTML = value !== undefined ? value : '';
        });

        // Remove suppressed labels
        for (const [posStr, value] of Object.entries(indexLabels)) {
            const pos = parseInt(posStr, 10);
            if (value === 0 && !mutationByNodeId[pos]) {
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
     * Resolve where new overlay elements should be inserted.
     *
     * If a vaRRI rotation layer exists, insert into that layer so newly added
     * overlays follow the current rotation.
     *
     * @returns {SVGElement|null}
     */
    function getPlotInsertRoot() {
        const plot = document.getElementsByClassName('fornac-plot')[0];
        if (!plot) return null;

        const rotationLayer = Array.from(plot.children).find(child =>
            child.tagName && child.tagName.toLowerCase() === 'g' &&
            child.getAttribute('data-varri-rotation-layer') === 'true'
        );

        return rotationLayer || plot;
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
        const insertRoot = getPlotInsertRoot();
        if (insertRoot) insertRoot.insertBefore(el, insertRoot.firstChild);
    }

    /**
     * Resolve the x/y coordinates of a list of Fornac node IDs.
     *
     * @param {number[]} indices  Fornac node IDs to resolve.
     * @returns {Array<[number, number]>}
     */
    function getNodePointPairs(indices) {
        const points = [];
        indices.forEach(index => {
            document.querySelectorAll(`g[num="n${index}"]`).forEach(node => {
                const transform = node.getAttribute('transform') || '';
                const match = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)];
                if (match.length >= 2) {
                    points.push([parseFloat(match[0][0]), parseFloat(match[1][0])]);
                }
            });
        });
        return points;
    }

    /**
     * Close a polygon point list by appending the first point at the end.
     *
     * @param {Array<[number, number]>} points
     * @returns {string[]}
     */
    function closePolygonPoints(points) {
        if (!Array.isArray(points) || points.length === 0) return [];
        const pointStrings = points.map(([x, y]) => `${x},${y}`);
        if (pointStrings.length < 2) return pointStrings;
        return [...pointStrings, pointStrings[0]];
    }

    /**
     * Draw a polyline connecting a list of Fornac node positions.
     *
     * @param {number[]} indices  Fornac node IDs to connect.
     * @param {string} style  CSS style string for the polyline.
     */
    function polyline(indices, style, extraAttrs = {}) {
        const points = getNodePointPairs(indices);
        const pointString = points.map(([x, y]) => `${x},${y}`).join(' ');

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', pointString);
        poly.setAttribute('style', style);
        for (const [k, val] of Object.entries(extraAttrs)) {
            poly.setAttribute(k, val);
        }
        const insertRoot = getPlotInsertRoot();
        if (insertRoot) insertRoot.insertBefore(poly, insertRoot.firstChild);
    }

    /**
     * Draw a closed polygon connecting a list of Fornac node positions.
     *
     * @param {number[]} indices  Fornac node IDs to connect.
     * @param {string} style  CSS style string for the polygon.
     */
    function polygon(indices, style, extraAttrs = {}) {
        const points = getNodePointPairs(indices);
        const pointString = closePolygonPoints(points).join(' ');

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pointString);
        poly.setAttribute('style', style);
        for (const [k, val] of Object.entries(extraAttrs)) {
            poly.setAttribute(k, val);
        }
        const insertRoot = getPlotInsertRoot();
        if (insertRoot) insertRoot.insertBefore(poly, insertRoot.firstChild);
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
     * Highlight nodes in the intermolecular basepair region with a stroke.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function highlightRegion(v) {
        const basepairRegion = getIntermolBasepairRegion(v.structure1, v.structure2);
        const intermolNodes = [];
        for (const [start, end] of basepairRegion) {
            for (let i = start; i <= end; i++) intermolNodes.push(i);
        }
        addStyleToNodes(intermolNodes, `stroke: ${COLORS.intermolecularHighlight};`);
    }

    /**
     * Highlight individual intermolecular basepair nodes with a stroke.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function highlightBasepairs(v) {
        const split = v.sequence1.length + 1;
        // Highlight all nodes that are part of intermolecular basepairs of main layouting (basepair) or 2ndary layouting (pseudoknot)
        for (const type of ["basepair", "pseudoknot"]) {
            document.querySelectorAll(`[link_type="${type}"]`).forEach(link => {
                const nodes = [
                    parseInt(link.getAttribute('start'), 10),
                    parseInt(link.getAttribute('end'), 10),
                ];
                if (!(nodes[0] < split && nodes[1] > split)) return;
                nodes.forEach(nodeNum => {
                    const node = document.querySelector(`circle[node_num="${nodeNum}"]`);
                    if (node) {
                        node.setAttribute('style', (node.getAttribute('style') || '') + `stroke: ${COLORS.intermolecularHighlight};`);
                    }
                });
            });
        }
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
     * Highlight subsequence ranges with polyline/circle overlays.
     *
     * @param {Object} v  Validated parameter dictionary.
     * @param {"1"|"2"} seq  Which sequence to highlight.
     * @param {Array<[number, number]>} ranges  Parsed index ranges.
     * @param {string} color  Highlight color.
     */
    function highlightSubsequence(v, seq, ranges, color) {
        const highlightDiameter = 14;
        const keyOffset = `offset${seq}`;

        // Map RNA index → Fornac web node id for the relevant sequence
        const indexDict = {};
        for (const [web, [mol, index]] of Object.entries(getIndexDictionary(v))) {
            if (mol === `s${seq}`) {
                indexDict[index] = parseInt(web, 10);
            }
        }

        const shift = seq === '2' ? v.sequence1.length + GAP : 0;

        for (const [start, end] of (ranges || [])) {
            const startIndex = v[keyOffset];

            if (start === end) {
                const webId = indexDict[start];
                const [x, y] = getPositionOfNode(webId);
                addElement('circle', {
                    cx: String(x),
                    cy: String(y),
                    r: `${Math.ceil(highlightDiameter/2)}px`,
                    style: `fill:${color};opacity:0.3;`,
                    'data-varri-subseq': 'true',
                });
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
                `stroke:${color};stroke-width:14;opacity:0.3;fill:None;` +
                'stroke-linejoin:round;stroke-linecap:round',
                { 'data-varri-subseq': 'true' }
            );
        }
    }

    /**
     * Remove all generated region highlights from the active registry.
     */
    function clearGeneratedRegionHighlights() {
        getRegionHighlights().filter(highlight => highlight.generated).forEach(highlight => {
            removeRegionHighlight(highlight.id);
        });
    }

    /**
     * Register a generated region highlight from sequence ranges.
     *
     * @param {Object} v
     * @param {{sequence1Range:[number, number], sequence2Range:[number, number], color?:string}} spec
     * @returns {Object}
     */
    function registerGeneratedRegionHighlight(v, spec) {
        const sequenceContext = {
            '1': { offset: v.offset1, length: v.sequence1 ? v.sequence1.length : 0, sequence: v.sequence1 },
            '2': { offset: v.offset2, length: v.sequence2 ? v.sequence2.length : 0, sequence: v.sequence2 },
        };

        return registerRegionHighlight({
            sequence1Range: spec.sequence1Range,
            sequence2Range: spec.sequence2Range,
            color: spec.color || COLORS.backgroundHighlight,
            generated: true,
        }, sequenceContext);
    }

    /**
     * Derive a true sequence-position range (matching offset/skip-zero
     * numbering) for a given sequence from a list of combined node/structure
     * positions (as produced by {@link listIntermolPairs} or
     * {@link getIntermolBasepairRegion}).
     *
     * @param {Object} v
     * @param {number[]} positions  Combined node positions (1-based, gap-inclusive).
     * @param {'1'|'2'} sequence
     * @returns {[number, number]|null}
     */
    function getBackgroundRangeForPositions(v, positions, sequence) {
        const indexDict = getIndexDictionary(v);
        const values = positions
            .map(position => indexDict[position])
            .filter(entry => Array.isArray(entry) && entry[0] === `s${sequence}`)
            .map(([, seqPosition]) => seqPosition)
            .filter(Number.isFinite);

        if (values.length === 0) return null;
        return [Math.min(...values), Math.max(...values)];
    }

    /**
     * Compute the generated region-highlight ranges for the "entire
     * intermolecular region" background-highlighting mode, expressed as true
     * sequence positions (matching offset/skip-zero numbering).
     *
     * @param {Object} v  Validated parameter dictionary.
     * @returns {{sequence1Range:[number,number], sequence2Range:[number,number]}|null}
     */
    function computeBackgroundRegionRanges(v) {
        const basepairRegion = getIntermolBasepairRegion(v.structure1, v.structure2);
        if (!basepairRegion || basepairRegion.length < 2) return null;

        const sequence1Range = getBackgroundRangeForPositions(v, basepairRegion[0], '1');
        const sequence2Range = getBackgroundRangeForPositions(v, basepairRegion[1], '2');
        if (!sequence1Range || !sequence2Range) return null;

        return { sequence1Range, sequence2Range };
    }

    /**
     * Build the node-ID path for a region highlight's filled polygon.
     *
     * @param {Object} v
     * @param {Object} highlight
     * @returns {number[]}
     */
    function getRegionHighlightNodePath(v, highlight) {
        const nodeIds = [];
        const seq1Range = Array.isArray(highlight.sequence1Range) ? highlight.sequence1Range : [];
        const seq2Range = Array.isArray(highlight.sequence2Range) ? highlight.sequence2Range : [];

        for (let position = seq1Range[0]; position <= seq1Range[1]; position++) {
            const nodeId = getNodeIdForSequencePosition(v, '1', position);
            if (nodeId) nodeIds.push(nodeId);
        }

        for (let position = seq2Range[0]; position <= seq2Range[1]; position++) {
            const nodeId = getNodeIdForSequencePosition(v, '2', position);
            if (nodeId) nodeIds.push(nodeId);
        }

        return nodeIds;
    }

    /**
     * Apply all region highlights from the active registry.
     *
     * @param {Object} v
     */
    function applyRegionHighlights(v) {
        const registryHighlights = getRegionHighlights();
        const highlights = registryHighlights.length > 0
            ? registryHighlights
            : (Array.isArray(v.regionHighlights) ? v.regionHighlights : []);

        highlights.forEach(highlight => {
            const nodePath = getRegionHighlightNodePath(v, highlight);
            if (nodePath.length >= 3) {
                polygon(
                    nodePath,
                    `fill:${highlight.color || COLORS.backgroundHighlight};opacity:0.2;stroke:${highlight.color || COLORS.backgroundHighlight};stroke-width:7`,
                    { 'data-varri-region': 'true' }
                );
            }
        });
    }

    /**
     * Apply all subsequence highlights from `v.subsequenceHighlights`.
     *
     * @param {Object} v
     */
    function applySubsequenceHighlights(v) {
        const highlights = Array.isArray(v.subsequenceHighlights) ? v.subsequenceHighlights : [];
        highlights.forEach(highlight => {
            highlightSubsequence(
                v,
                highlight.sequence,
                highlight.ranges,
                highlight.color || COLORS.subsequenceHighlight
            );
        });
    }

    /**
     * Apply point-mutation styling to nucleotide nodes.
     *
     * @param {Object} v
     */
    function applyPointMutations(v) {
        const mutations = Array.isArray(v.pointMutations) ? v.pointMutations : [];
        mutations.forEach(mutation => {
            if (!mutation.nodeId) return;
            addStyleToNodes([mutation.nodeId], `stroke: ${mutation.color}; stroke-width: 2px;`);
        });
    }

    /**
     * Visualise basepairs: apply the basepair colour to all basepair links,
     * and additionally mark G-U basepairs with a dashed line style.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function styleBasepairs(v) {
        // Apply basepair colour to all basepair links using inline style so it
        // overrides the Fornac CSS rule `line.fornac-link[link_type="basepair"]
        // { stroke: red; }`, which takes precedence over SVG presentation
        // attributes.
        document.querySelectorAll('[link_type="basepair"]').forEach(link => {
            link.style.stroke = COLORS.basepair;
        });

        if (v.guBasepairs) {
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
                    link.style.strokeDasharray = '1,1';
                } else {
                    link.style.strokeDasharray = '';
                }
            });
        } else {
            document.querySelectorAll('[link_type="basepair"]').forEach(link => {
                link.style.strokeDasharray = '';
            });
        }
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
    function backgroundhighlightBasepairs(v) {
        const intermolPairs = listIntermolPairs(v);
        if (intermolPairs.length === 0) {
            clearGeneratedRegionHighlights();
            return;
        }

        let stack = [intermolPairs.shift()];
        const highlightAreas = [];

        for (const [open, close] of intermolPairs) {
            const [stackOpen, stackClose] = stack[stack.length - 1];
            if (open - 1 === stackOpen && close + 1 === stackClose) {
                stack.push([open, close]);
                continue;
            }
            const area = stack.flatMap(([a, b]) => [a, b]).sort((a, b) => a - b);
            highlightAreas.push(area);
            stack = [[open, close]];
        }
        const area = stack.flatMap(([a, b]) => [a, b]).sort((a, b) => a - b);
        highlightAreas.push(area);

        clearGeneratedRegionHighlights();
        highlightAreas.forEach(region => {
            const seq1Range = getBackgroundRangeForPositions(v, region, '1');
            const seq2Range = getBackgroundRangeForPositions(v, region, '2');
            if (seq1Range && seq2Range) {
                registerGeneratedRegionHighlight(v, {
                    sequence1Range: seq1Range,
                    sequence2Range: seq2Range,
                    color: COLORS.backgroundHighlight,
                });
            }
        });
    }

    /**
     * Add background highlighting for the entire intermolecular region.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function backgroundhighlightRegion(v) {
        const ranges = computeBackgroundRegionRanges(v);
        if (!ranges) {
            clearGeneratedRegionHighlights();
            return;
        }

        clearGeneratedRegionHighlights();
        registerGeneratedRegionHighlight(v, {
            sequence1Range: ranges.sequence1Range,
            sequence2Range: ranges.sequence2Range,
            color: COLORS.backgroundHighlight,
        });
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
    function mapProbabilityToOpacity(prb, representsOne) {
        return representsOne ? prb : (1 - prb);
    }

    /**
     * Visualise nucleotide accessibility data as overlaid coloured circles.
     *
     * @param {Object.<number, number>} accessData  Map of node ID → accessibility probability.
     * @param {number} lenSeq  Length of sequence 1 (used to distinguish colour by molecule).
     * @param {{sequence1?: string, sequence2?: string}|null} accessColors  Optional colors for sequence 1/2 overlays.
     * @param {{sequence1RepresentsOne?: boolean, sequence2RepresentsOne?: boolean}|null} accessColorMode
     *     Optional per-sequence mapping flags. If true, probability 1 maps to full color.
     */
    function visualiseAccessibility(accessData, lenSeq, accessColors = null, accessColorMode = null) {
        const seq1Color = accessColors?.sequence1 || COLORS.seq1profileColor;
        const seq2Color = accessColors?.sequence2 || COLORS.seq2profileColor;
        const seq1RepresentsOne = !!accessColorMode?.sequence1RepresentsOne;
        const seq2RepresentsOne = !!accessColorMode?.sequence2RepresentsOne;
        for (const [indexStr, prb] of Object.entries(accessData)) {
            const index = parseInt(indexStr, 10);
            const isSeq1 = index <= lenSeq;
            const color = isSeq1 ? seq1Color : seq2Color;
            const representsOne = isSeq1 ? seq1RepresentsOne : seq2RepresentsOne;
            const style = `fill: ${color};opacity: ${mapProbabilityToOpacity(prb, representsOne)}; stroke-width: 0;`;
            const prbTooltip = '\n' + prb.toExponential(2);
            addAccessibilityOverlay(index, style, prbTooltip);
        }
    }

    /**
     * Resolve a force-graph link endpoint to a node object when possible.
     *
     * @param {Object} graph
     * @param {Object|number|string|null|undefined} endpoint
     * @returns {Object|null}
     */
    function resolveGraphNodeFromEndpoint(graph, endpoint) {
        if (endpoint && typeof endpoint === 'object') return endpoint;

        const idx = parseInt(String(endpoint), 10);
        if (!Number.isFinite(idx)) return null;

        if (Array.isArray(graph?.nodes) && graph.nodes[idx]) return graph.nodes[idx];
        if (Array.isArray(graph?.nodes)) {
            const byNumber = graph.nodes.find(node => node && node.num === idx);
            if (byNumber) return byNumber;
        }

        return null;
    }

    /**
     * Identify the force-graph nodes that implement Fornac's "free-form"
     * loop circularisation: the two synthetic closure nodes plus every hub
     * whose loop is exterior-flavoured, along with the full member set of
     * each such hub.
     *
     * Fornac's `reinforceLoops()` gives every loop of the structure (stems
     * excluded) its own fake "middle" hub node via `addFakeNode()`, which
     * pulls that loop's member nucleotides toward one shared point (keeping
     * the loop visually rounded). For the true top-level external loop
     * specifically — and only when Fornac's `circularizeExternal` option is
     * enabled, which is the default — two extra synthetic "closure" middle
     * nodes (`num: -2` and `num: -3`), positioned at the RNA's very first
     * and very last nucleotide, are additionally appended to that loop's
     * member list before its hub is created. This is exactly the
     * constraint that pulls the two sequence ends together.
     *
     * That hub cannot be found reliably via link adjacency: `addFakeNode()`
     * skips creating any link (hub spoke *and* the two "chord" links to
     * nearby members — see below) for member-list entries whose index
     * exceeds the sequence length, which is exactly what the closure nodes'
     * synthetic indices are. So the closure nodes are never linked to the
     * hub directly, only incidentally chord-linked to a couple of nearby
     * real nucleotide members. Instead, each hub's own `nucs` array — a
     * snapshot of the 1-based `graph.nodes` array indices of every member
     * of that loop, recorded when the hub was created — is used: for the
     * true external loop only, it includes the closure nodes' own array
     * indices, which identifies that hub precisely.
     *
     * vaRRI additionally inserts extra unpaired "gap" characters between two
     * molecules to work around a Fornac rendering bug. Fornac's own
     * `breakNodesToFakeNodes()` marks every member of *any* loop that
     * touches that gap as `elemType: "e"` (the same label used for the true
     * exterior loop), regardless of that loop's real type — this is exactly
     * the "trailing ends around the & spacer" that should also be freed.
     * Any hub whose resolved members include an `elemType: "e"` nucleotide
     * is therefore treated the same way as the true external-loop hub.
     *
     * Each qualifying hub's `nucs` array also lists every other member of
     * its loop (real nucleotides, and closure nodes for the true external
     * hub). Those member sets are returned too, because `addFakeNode()`
     * additionally links members directly to each other with two kinds of
     * "chord" links (skipping the hub entirely) to keep the loop's ring
     * shape from collapsing — e.g. a member is linked straight to the
     * member roughly opposite it in the loop. Those direct member-to-member
     * links must also be removed to fully free the loop's nucleotides;
     * removing only the hub and closure nodes leaves them in place, which
     * still visibly pulls opposite sides of the loop together. Loops that
     * don't qualify (i.e. every other stem/hairpin/interior/multi loop) are
     * left completely untouched.
     *
     * @param {Object} graph
     * @returns {{closureUids: Set<string>, hubUids: Set<string>, memberUids: Set<string>}|null}
     */
    function getFreeableLoopScaffoldUids(graph) {
        if (!graph || !Array.isArray(graph.nodes)) return null;

        const closureNodes = graph.nodes.filter(node =>
            node && node.nodeType === 'middle' && (node.num === -2 || node.num === -3)
        );
        const closureUids = new Set(closureNodes.map(node => node.uid).filter(Boolean));
        const closureIndices = new Set(closureNodes.map(node => graph.nodes.indexOf(node) + 1));

        const hubs = graph.nodes.filter(node =>
            node && node.nodeType === 'middle' && node.num === -1 && Array.isArray(node.nucs)
        );

        const hubUids = new Set();
        const memberUids = new Set(closureUids);

        hubs.forEach(hub => {
            const members = hub.nucs.map(idx => graph.nodes[idx - 1]).filter(Boolean);
            const touchesClosure = hub.nucs.some(idx => closureIndices.has(idx));
            const touchesExternalElemType = members.some(member => member.elemType === 'e');

            if (!touchesClosure && !touchesExternalElemType) return;

            hubUids.add(hub.uid);
            members.forEach(member => {
                if (member.uid) memberUids.add(member.uid);
            });
        });

        if (closureUids.size === 0 && hubUids.size === 0) return null;

        return { closureUids, hubUids, memberUids };
    }

    /**
     * Remove Fornac's exterior-flavoured loop circularisation scaffolds —
     * the closure nodes and every hub whose loop is exterior-flavoured
     * (the true top-level external loop, plus any loop touching vaRRI's
     * inter-molecule gap) — from the force graph and rerun the layout.
     * Every other loop's own hub and circular constraint is left untouched.
     *
     * @param {Object} container
     * @param {Object} v
     * @returns {boolean}
     */
    function relaxForceGraphScaffold(container, v) {
        const graph = container && container.graph;
        const scaffold = getFreeableLoopScaffoldUids(graph);
        if (!scaffold) return false;

        const removableNodeUids = new Set(scaffold.closureUids);
        scaffold.hubUids.forEach(uid => removableNodeUids.add(uid));

        graph.links = graph.links.filter(link => {
            const linkType = String(link && link.linkType);
            if (linkType !== 'fake' && linkType !== 'fake_fake') return true;

            const sourceNode = resolveGraphNodeFromEndpoint(graph, link.source);
            const targetNode = resolveGraphNodeFromEndpoint(graph, link.target);
            const sourceUid = sourceNode && sourceNode.uid;
            const targetUid = targetNode && targetNode.uid;

            // Drop anything touching a freed hub or the closure nodes themselves.
            if ((sourceUid && removableNodeUids.has(sourceUid)) || (targetUid && removableNodeUids.has(targetUid))) {
                return false;
            }

            // Drop direct member-to-member "chord" links that bypass the hub
            // entirely but still connect two nucleotides of the external loop.
            if (sourceUid && targetUid && scaffold.memberUids.has(sourceUid) && scaffold.memberUids.has(targetUid)) {
                return false;
            }

            return true;
        });

        graph.nodes = graph.nodes.filter(node => !(node && node.uid && removableNodeUids.has(node.uid)));

        if (typeof container.update === 'function') {
            container.update();
        }

        if (container.force && typeof container.force.resume === 'function') {
            container.force.resume();
        } else if (container.force && typeof container.force.start === 'function') {
            container.force.start();
        }

        return true;
    }

    /**
     * Override Fornac's "pseudoknot" link force strength on a live container.
     *
     * Fornac's `FornaContainer` sets `container.linkStrengths.pseudoknot = 0`
     * by default, meaning pseudoknot basepair links exert no pull in the
     * force simulation. `container.linkStrengths` is read by the link-force
     * accessor function on every `force.start()` call (which rebuilds the
     * internal per-link strength array), but *not* by `force.resume()`
     * (which only restarts ticking without rebuilding that array). So the
     * new strength must be set before calling `force.start()` specifically.
     *
     * @param {Object} container
     * @param {boolean} enabled  When true, sets pseudoknot strength to 10.
     */
    function applyPseudoknotLinkStrength(container, enabled) {
        if (!container || !container.linkStrengths) return;

        container.linkStrengths.pseudoknot = enabled ? 10 : 0;

        if (container.force && typeof container.force.start === 'function') {
            container.force.start();
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
    * @param {boolean} [options.freeTrailingEnds=false]  Remove Fornac's external-loop circularisation constraint (the "closure" scaffold linking the sequence ends) from the force graph, leaving all other loop constraints intact.
    * @param {boolean} [options.pullPseudoknotBasepairs=false]  Set Fornac's pseudoknot link force strength to 10 (default 0), pulling pseudoknot basepairs together in the force layout.
     * @param {boolean} [options.legend=false]  Whether to also render the legend.
     * @param {Object.<number,number>|null} [options.accessData=null]  Accessibility data map.
     * @param {{sequence1?: string, sequence2?: string}|null} [options.accessColors=null]  Optional accessibility-overlay colors.
     * @param {{sequence1RepresentsOne?: boolean, sequence2RepresentsOne?: boolean}|null} [options.accessColorMode=null]
     *     Optional per-sequence mapping flags; true means probability 1 maps to full color.
     */
    function render(containerId, v, options = {}) {
        // Cancel any background-highlight loop from a previous render.
        if (_animFrameId !== null) {
            cancelAnimationFrame(_animFrameId);
            _animFrameId = null;
        }

        if (_renderTimeoutId !== null) {
            clearTimeout(_renderTimeoutId);
            _renderTimeoutId = null;
            if (_pendingRenderResolve) {
                const resolvePendingRender = _pendingRenderResolve;
                queueMicrotask(() => resolvePendingRender({ cancelled: true }));
                _pendingRenderResolve = null;
            }
        }

        const {
            animation = false,
            freeTrailingEnds = false,
            pullPseudoknotBasepairs = false,
            accessData = null,
            accessColors = null,
            accessColorMode = null,
        } = options;

        // Build molecules via Fornac
        const container = new fornac.FornaContainer(
            `#${containerId}`,
            { animation: animation, labelInterval: 1 }
        );
        container.addRNA(v.structure, { structure: v.structure, sequence: v.sequence });

        if (animation && freeTrailingEnds) {
            relaxForceGraphScaffold(container, v);
        }

        if (animation && pullPseudoknotBasepairs) {
            applyPseudoknotLinkStrength(container, true);
        }

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
                if (v.highlighting === 'region') highlightRegion(v);
                if (v.highlighting === 'basepairs') highlightBasepairs(v);
                if (v.backgroundhighlighting === 'region') backgroundhighlightRegion(v);
                if (v.backgroundhighlighting === 'basepairs') backgroundhighlightBasepairs(v);
            }

            // Basepair styling (colour + optional G-U dashing)
            styleBasepairs(v);

            // Region highlights
            applyRegionHighlights(v);

            // Subsequence highlights
            applySubsequenceHighlights(v);

            // Point mutations
            applyPointMutations(v);

            // Accessibility overlay
            if (accessData) {
                visualiseAccessibility(accessData, v.sequence1.length, accessColors, accessColorMode);
            }

            // When animation is on, keep the background-highlight polygon in sync
            // with the force-layout by redrawing it on every animation frame.
            if (animation) {
                function highlightSyncLoop() {
                    document.querySelectorAll('[data-varri-region]').forEach(el => el.remove());
                    document.querySelectorAll('[data-varri-subseq]').forEach(el => el.remove());

                    applyRegionHighlights(v);
                    applySubsequenceHighlights(v);

                    _animFrameId = requestAnimationFrame(highlightSyncLoop);
                }
                _animFrameId = requestAnimationFrame(highlightSyncLoop);
            }
        }

        return new Promise((resolve, reject) => {
            _pendingRenderResolve = resolve;
            _renderTimeoutId = setTimeout(() => {
                _renderTimeoutId = null;
                _pendingRenderResolve = null;

                try {
                    applyModifications();
                    resolve({ cancelled: false });
                } catch (err) {
                    reject(err);
                }
            }, 200);
        });
    }

    // -----------------------------------------------------------------------
    // Rotation helpers
    // -----------------------------------------------------------------------

    /**
     * Normalise a rotation angle to the range [-180, 180].
     *
     * @param {number} degrees
     * @returns {number}
     */
    function normaliseRotationDegrees(degrees) {
        if (!Number.isFinite(degrees)) {
            throw new Error('Rotation degrees must be a finite number');
        }
        let value = degrees % 360;
        if (value > 180) value -= 360;
        if (value < -180) value += 360;
        return value;
    }

    /**
     * Resolve the element that should host the rotation layer.
     *
     * If Fornac's plot group exists, rotate inside that group so that
     * pan/zoom transforms stay in screen-space and dragging keeps expected
     * directions after rotation.
     *
     * @param {SVGSVGElement} svgEl
     * @returns {SVGElement}
     */
    function getRotationHost(svgEl) {
        const fornacPlot = svgEl.querySelector('.fornac-plot');
        return fornacPlot || svgEl;
    }

    /**
     * Ensure a host element has a dedicated layer that can be rotated.
     *
     * @param {SVGElement} hostEl
     * @returns {SVGGElement}
     */
    function ensureRotationLayer(hostEl) {
        let layer = Array.from(hostEl.children).find(child =>
            child.tagName && child.tagName.toLowerCase() === 'g' &&
            child.getAttribute('data-varri-rotation-layer') === 'true'
        );

        if (!layer) {
            layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            layer.setAttribute('data-varri-rotation-layer', 'true');
            hostEl.appendChild(layer);
        }

        const nodesToMove = Array.from(hostEl.childNodes).filter(node => {
            if (node === layer) return false;
            if (hostEl.tagName && hostEl.tagName.toLowerCase() === 'svg' &&
                    node.nodeType === Node.ELEMENT_NODE && node.tagName &&
                    node.tagName.toLowerCase() === 'defs') {
                return false;
            }
            return true;
        });
        nodesToMove.forEach(node => layer.appendChild(node));

        return layer;
    }

    /**
     * Compute the centre of an SVG element's bounding box.
     *
     * @param {SVGGraphicsElement} el
     * @returns {{x:number, y:number}|null}
     */
    function getBBoxCenter(el) {
        try {
            const bbox = el.getBBox();
            if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y) ||
                    !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
                return null;
            }
            return {
                x: bbox.x + (bbox.width / 2),
                y: bbox.y + (bbox.height / 2),
            };
        } catch (err) {
            return null;
        }
    }

    /**
     * Rotate the current visualisation around its bounding-box centre while
     * keeping text labels horizontally aligned.
     *
     * @param {string} containerId  ID of the container element.
     * @param {number} degrees  Rotation amount.
     * @param {Object} [options]
     * @param {'delta'|'absolute'} [options.mode='delta']
     * @returns {number}  Applied absolute angle in degrees (normalised).
     */
    function rotateVisualization(containerId, degrees, options = {}) {
        const container = document.getElementById(containerId);
        const svgEl = container && container.querySelector('svg');
        if (!svgEl) throw new Error('No SVG found in container');

        const amount = Number(degrees);
        if (!Number.isFinite(amount)) {
            throw new Error('Rotation degrees must be a finite number');
        }

        const mode = options.mode === 'absolute' ? 'absolute' : 'delta';
        const current = Number(svgEl.getAttribute('data-varri-rotation') || 0);
        const target = normaliseRotationDegrees(mode === 'absolute' ? amount : current + amount);

        const hostEl = getRotationHost(svgEl);
        const layer = ensureRotationLayer(hostEl);
        const center = getBBoxCenter(layer);
        if (!center) return current;

        layer.setAttribute('transform', `rotate(${target} ${center.x} ${center.y})`);
        svgEl.setAttribute('data-varri-rotation', String(target));

        layer.querySelectorAll('text').forEach(textEl => {
            if (!textEl.hasAttribute('data-varri-base-transform')) {
                textEl.setAttribute('data-varri-base-transform', textEl.getAttribute('transform') || '');
            }
            const baseTransform = textEl.getAttribute('data-varri-base-transform') || '';
            if (target === 0) {
                if (baseTransform) {
                    textEl.setAttribute('transform', baseTransform);
                } else {
                    textEl.removeAttribute('transform');
                }
                return;
            }

            const textCenter = getBBoxCenter(textEl) || center;
            const transformParts = [];
            if (baseTransform) transformParts.push(baseTransform);
            transformParts.push(`rotate(${-target} ${textCenter.x} ${textCenter.y})`);
            textEl.setAttribute('transform', transformParts.join(' '));
        });

        return target;
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
        rotateVisualization,
        normaliseRotationDegrees,

        // Colors
        setColors,
        getColors,

        // Export
        downloadSVG,
        downloadPNG,
        buildSVGString,

        // Validation helpers
        checkStructureInputSimple,
        validateSequenceInput,
        validateCroppingInput,
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
        createSubsequenceHighlight,
        registerSubsequenceHighlight,
        updateSubsequenceHighlight,
        removeSubsequenceHighlight,
        clearSubsequenceHighlights,
        getSubsequenceHighlights,
        createRegionHighlight,
        registerRegionHighlight,
        updateRegionHighlight,
        removeRegionHighlight,
        clearRegionHighlights,
        getRegionHighlights,
        registerGeneratedRegionHighlight,
        computeBackgroundRegionRanges,
        getRegionHighlightNodePath,
        createPointMutation,
        registerPointMutation,
        updatePointMutation,
        removePointMutation,
        clearPointMutations,
        getPointMutations,

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
        highlightRegion,
        highlightBasepairs,
        backgroundhighlightRegion,
        backgroundhighlightBasepairs,
        styleBasepairs,
        highlightSubsequence,
        applyRegionHighlights,
        applySubsequenceHighlights,
        applyPointMutations,
        removeDummyNodes,
        removeSecondLink,
        addStyleToNodes,
        polyline,
        addElement,
        getPositionOfNode,
        closePolygonPoints,
        visualiseAccessibility,
        setAttributeForElements,
    };

    // Export
    global.vaRRI = vaRRI;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = vaRRI;
    }

}(typeof window !== 'undefined' ? window : this));
