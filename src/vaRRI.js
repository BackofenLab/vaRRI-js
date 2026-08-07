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

    /** Force-graph link type reserved for invisible linear-RRI constraints. */
    const LINEAR_RRI_LINK_TYPE = 'rri_linear';

    /** Force-graph link type for invisible terminal continuation anchors. */
    const LINEAR_RRI_GHOST_LINK_TYPE = 'rri_linear_ghost';

    /** Match Fornac's strong backbone/basepair link strength. */
    const LINEAR_RRI_LINK_STRENGTH = 10;

    /** Compact horizontal backbone spacing relative to Fornac's natural link distance. */
    const LINEAR_RRI_LINK_DISTANCE_SCALE = 0.9;

    /** Vertical separation between the north and south interaction rails. */
    const LINEAR_RRI_TRACK_GAP_UNITS = 1;

    /** Outward rise per horizontal unit for terminal zipper ends. */
    const LINEAR_RRI_TAIL_SLOPE = 0.35;

    /** Minimum outward offset for index and mutation labels, in backbone units. */
    const LINEAR_RRI_SUPPLEMENTARY_OFFSET_UNITS = 1.8;

    /** Never auto-fit a linear interaction below a readable zoom level. */
    const LINEAR_RRI_MINIMUM_VIEW_SCALE = 0.1;

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

    /** In-memory registries for user-defined annotations. */
    const SUBSEQUENCE_REGISTRY = { items: [], nextId: 1, label: 'Highlight' };
    const REGION_REGISTRY = { items: [], nextId: 1, label: 'Region highlight' };
    const MUTATION_REGISTRY = { items: [], nextId: 1, label: 'Mutation' };

    // Short aliases keep rendering code focused on domain objects.
    const SUBSEQUENCE_HIGHLIGHTS = SUBSEQUENCE_REGISTRY.items;
    const REGION_HIGHLIGHTS = REGION_REGISTRY.items;
    const POINT_MUTATIONS = MUTATION_REGISTRY.items;

    function clearRegistry(registry) {
        registry.items.length = 0;
        registry.nextId = 1;
    }

    function getRegistryItem(registry, id) {
        const item = registry.items.find(candidate => candidate.id === id);
        if (!item) throw new Error(registry.label + ' with id ' + id + ' not found.');
        return item;
    }

    function listRegistryItems(registry, cloneItem) {
        return registry.items.map(cloneItem);
    }

    function registerRegistryItem(registry, item, cloneItem) {
        item.id = registry.nextId++;
        registry.items.push(item);
        return cloneItem(item);
    }

    function removeRegistryItem(registry, id) {
        const index = registry.items.findIndex(item => item.id === id);
        if (index === -1) return false;
        registry.items.splice(index, 1);
        return true;
    }

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
            range: highlight.range.map(([start, end]) => [start, end]),
            color: highlight.color,
            alpha: highlight.alpha,
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
     * @returns {{range:Array<[number, number]>, rangeText:string}}
     */
    function normaliseHighlightRanges(rangeInput, context) {
        if (typeof rangeInput === 'string') {
            const range = parseSubsequences(
                rangeInput,
                context ? context.offset : undefined,
                context ? context.length : undefined
            );
            if (!range || range.length === 0) {
                throw new Error('Highlight range must not be empty.');
            }
            return { range, rangeText: rangeInput.trim() };
        }

        if (!Array.isArray(rangeInput) || rangeInput.length === 0) {
            throw new Error('Highlight range must not be empty.');
        }

        const range = rangeInput.map((pair, idx) => {
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
                range.map(([start, end]) => `${start}-${end}`).join(','),
                context.offset,
                context.length
            );
        }

        return {
            range,
            rangeText: range.map(([start, end]) => `${start}-${end}`).join(','),
        };
    }

    /**
     * Build a normalized subsequence-highlight object from user input.
     *
     * @param {{sequence:string|number, range:string|Array<[number, number]>, color?:string, alpha?:number, id?:number}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {{id:number, sequence:'1'|'2', range:Array<[number, number]>, color:string, rangeText:string}}
     */
    function createSubsequenceHighlight(input, sequenceContext = {}) {
        const sequence = normaliseHighlightSequence(input.sequence);
        const context = sequenceContext[sequence];
        const normalizedRange = normaliseHighlightRanges(input.range, context);
        const color = (input.color || '').trim() || COLORS.subsequenceHighlight;
        const alpha = input.alpha !== undefined ? Number(input.alpha) : 0.3;

        return {
            id: Number.isInteger(input.id) ? input.id : 0,
            sequence,
            range: normalizedRange.range,
            color,
            alpha,
            rangeText: normalizedRange.rangeText,
        };
    }

    /**
     * Register a new subsequence highlight object.
     *
     * @param {{sequence:string|number, range:string|Array<[number, number]>, color?:string, alpha?:number}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function registerSubsequenceHighlight(input, sequenceContext = {}) {
        return registerRegistryItem(
            SUBSEQUENCE_REGISTRY,
            createSubsequenceHighlight(input, sequenceContext),
            cloneSubsequenceHighlight
        );
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
        const target = getRegistryItem(SUBSEQUENCE_REGISTRY, id);

        const normalized = createSubsequenceHighlight({
            id,
            sequence: patch.sequence !== undefined ? patch.sequence : target.sequence,
            range: patch.range !== undefined ? patch.range : target.range,
            color: patch.color !== undefined ? patch.color : target.color,
            alpha: patch.alpha !== undefined ? patch.alpha : target.alpha,
        }, sequenceContext);

        Object.assign(target, normalized);

        return cloneSubsequenceHighlight(target);
    }

    /**
     * Remove a subsequence highlight object by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removeSubsequenceHighlight(id) {
        return removeRegistryItem(SUBSEQUENCE_REGISTRY, id);
    }

    /**
     * Remove all registered subsequence highlights.
     */
    function clearSubsequenceHighlights() {
        clearRegistry(SUBSEQUENCE_REGISTRY);
    }

    /**
     * Read registered subsequence highlights.
     *
     * @returns {Array<Object>}
     */
    function getSubsequenceHighlights() {
        return listRegistryItems(SUBSEQUENCE_REGISTRY, cloneSubsequenceHighlight);
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
            alpha: highlight.alpha,
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
     * @param {{sequence1Range:string|[number, number], sequence2Range:string|[number, number], color?:string, alpha?:number, generated?:boolean, id?:number}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {{id:number, sequence1Range:[number, number], sequence2Range:[number, number], color:string, rangeText:string, generated:boolean}}
     */
    function createRegionHighlight(input, sequenceContext = {}) {
        const context1 = sequenceContext['1'];
        const context2 = sequenceContext['2'];
        const seq1Range = normaliseRegionRange(input.sequence1Range, context1);
        const seq2Range = normaliseRegionRange(input.sequence2Range, context2);
        const color = (input.color || '').trim() || COLORS.backgroundHighlight;
        const alpha = input.alpha !== undefined ? Number(input.alpha) : 0.2;

        return {
            id: Number.isInteger(input.id) ? input.id : 0,
            sequence1Range: seq1Range.range,
            sequence2Range: seq2Range.range,
            color,
            alpha,
            rangeText: `${seq1Range.rangeText}&${seq2Range.rangeText}`,
            generated: !!input.generated,
        };
    }

    /**
     * Register a new region highlight object.
     *
     * @param {{sequence1Range:string|[number, number], sequence2Range:string|[number, number], color?:string, alpha?:number, generated?:boolean}} input
     * @param {{'1'?:{offset:number, length:number}, '2'?:{offset:number, length:number}}=} sequenceContext
     * @returns {Object}
     */
    function registerRegionHighlight(input, sequenceContext = {}) {
        return registerRegistryItem(
            REGION_REGISTRY,
            createRegionHighlight(input, sequenceContext),
            cloneRegionHighlight
        );
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
        const target = getRegistryItem(REGION_REGISTRY, id);

        const normalized = createRegionHighlight({
            id,
            sequence1Range: patch.sequence1Range !== undefined ? patch.sequence1Range : target.sequence1Range,
            sequence2Range: patch.sequence2Range !== undefined ? patch.sequence2Range : target.sequence2Range,
            color: patch.color !== undefined ? patch.color : target.color,
            alpha: patch.alpha !== undefined ? patch.alpha : target.alpha,
            generated: patch.generated !== undefined ? patch.generated : target.generated,
        }, sequenceContext);

        Object.assign(target, normalized);

        return cloneRegionHighlight(target);
    }

    /**
     * Remove a region highlight object by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removeRegionHighlight(id) {
        return removeRegistryItem(REGION_REGISTRY, id);
    }

    /**
     * Remove all registered region highlights.
     */
    function clearRegionHighlights() {
        clearRegistry(REGION_REGISTRY);
    }

    /**
     * Read registered region highlights.
     *
     * @returns {Array<Object>}
     */
    function getRegionHighlights() {
        return listRegistryItems(REGION_REGISTRY, cloneRegionHighlight);
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
        return registerRegistryItem(
            MUTATION_REGISTRY,
            createPointMutation(input, sequenceContext),
            clonePointMutation
        );
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
        const target = getRegistryItem(MUTATION_REGISTRY, id);

        const normalized = createPointMutation({
            id,
            sequence: patch.sequence !== undefined ? patch.sequence : target.sequence,
            position: patch.position !== undefined ? patch.position : target.position,
            replacement: patch.replacement !== undefined ? patch.replacement : target.replacement,
            color: patch.color !== undefined ? patch.color : target.color,
        }, sequenceContext);

        Object.assign(target, normalized);

        return clonePointMutation(target);
    }

    /**
     * Remove a point mutation by id.
     *
     * @param {number} id
     * @returns {boolean}
     */
    function removePointMutation(id) {
        return removeRegistryItem(MUTATION_REGISTRY, id);
    }

    /**
     * Remove all registered point mutations.
     */
    function clearPointMutations() {
        clearRegistry(MUTATION_REGISTRY);
    }

    /**
     * Read registered point mutations.
     *
     * @returns {Array<Object>}
     */
    function getPointMutations() {
        return listRegistryItems(MUTATION_REGISTRY, clonePointMutation);
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
            if (structure.length !== sequence.length) {
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

    function insertSvgShape(tagName, pointString, style, extraAttrs) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        shape.setAttribute('points', pointString);
        shape.setAttribute('style', style);
        for (const [name, value] of Object.entries(extraAttrs)) {
            shape.setAttribute(name, value);
        }
        const insertRoot = getPlotInsertRoot();
        if (insertRoot) insertRoot.insertBefore(shape, insertRoot.firstChild);
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

        insertSvgShape('polyline', pointString, style, extraAttrs);
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

        insertSvgShape('polygon', pointString, style, extraAttrs);
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
     * @param {Array<[number, number]>} range  Parsed index range.
     * @param {string} color  Highlight color.
     * @param {number} Highlight opacity.
     */
    function highlightSubsequence(v, seq, range, color, alpha) {
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

        for (const [start, end] of (range || [])) {
            const startIndex = v[keyOffset];

            if (start === end) {
                const webId = indexDict[start];
                const [x, y] = getPositionOfNode(webId);
                addElement('circle', {
                    cx: String(x),
                    cy: String(y),
                    r: `${Math.ceil(highlightDiameter/2)}px`,
                    style: `fill:${color};opacity:${alpha};`,
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
                `stroke:${color};stroke-width:14;opacity:${alpha};fill:None;` +
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
     * @param {{sequence1Range:[number, number], sequence2Range:[number, number], color?:string, alpha?:number}} spec
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
            alpha: spec.alpha,
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
                    `fill:${highlight.color || COLORS.backgroundHighlight};opacity:${highlight.alpha};stroke:${highlight.color || COLORS.backgroundHighlight};stroke-width:7`,
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
                highlight.range,
                highlight.color || COLORS.subsequenceHighlight,
                highlight.alpha
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
     * Build invisible same-strand distance constraints between neighbouring
     * RRI base-pair columns.
     *
     * Both strands receive the same chord. Its length is derived from the
     * larger intervening loop, as required by Issue 59, so asymmetric bulges
     * cannot pull one rail interval shorter than the other.
     *
     * @param {Object} v  Validated parameter dictionary.
     * @returns {Array<{source:number,target:number,distanceUnits:number,sequence:"1"|"2"}>}
     */
    function getLinearRriConstraintSpecs(v) {
        const pairs = listIntermolPairs(v).slice().sort((a, b) => a[0] - b[0]);
        const constraints = [];

        for (let index = 1; index < pairs.length; index++) {
            const previous = pairs[index - 1];
            const current = pairs[index];
            const sequence1LoopSize = Math.max(
                0,
                Math.abs(current[0] - previous[0]) - 1
            );
            const sequence2LoopSize = Math.max(
                0,
                Math.abs(current[1] - previous[1]) - 1
            );
            const largerLoopSize = Math.max(sequence1LoopSize, sequence2LoopSize);

            // A semicircle with contour length L has chord 2L / PI. The
            // contour contains one more backbone bond than internal nodes.
            const distanceUnits = LINEAR_RRI_LINK_DISTANCE_SCALE *
                Math.max(1, 2 * (largerLoopSize + 1) / Math.PI);

            constraints.push({
                source: previous[0],
                target: current[0],
                distanceUnits,
                sequence: '1',
            });
            constraints.push({
                source: previous[1],
                target: current[1],
                distanceUnits,
                sequence: '2',
            });
        }

        return constraints;
    }

    /**
     * Return evenly spaced positions for one outward RRI loop bridge.
     *
     * When its backbone contour can span the shared chord, the bridge follows
     * a circular arc. A shorter asymmetric side is distributed evenly along
     * the chord instead of being allowed to collapse at one endpoint.
     *
     * @param {{x:number,y:number}} startPoint
     * @param {{x:number,y:number}} endPoint
     * @param {number} internalNodeCount
     * @param {number} bondLength
     * @param {{x:number,y:number}} outwardHint
     * @returns {Array<{x:number,y:number}>}
     */
    function getLinearRriBridgePositions(
        startPoint,
        endPoint,
        internalNodeCount,
        bondLength,
        outwardHint
    ) {
        const rawCount = Number(internalNodeCount);
        const count = Number.isFinite(rawCount) ? Math.max(0, Math.trunc(rawCount)) : 0;
        if (count === 0) return [];

        const startX = Number(startPoint && startPoint.x);
        const startY = Number(startPoint && startPoint.y);
        const endX = Number(endPoint && endPoint.x);
        const endY = Number(endPoint && endPoint.y);
        if (![startX, startY, endX, endY].every(Number.isFinite)) return [];

        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const chordLength = Math.hypot(deltaX, deltaY);
        const straightPositions = Array.from({ length: count }, (_, index) => {
            const fraction = (index + 1) / (count + 1);
            return {
                x: startX + deltaX * fraction,
                y: startY + deltaY * fraction,
            };
        });

        const scaledBondLength = Number(bondLength);
        const contourLength = (count + 1) * scaledBondLength;
        if (
            chordLength < 1e-6 ||
            !Number.isFinite(scaledBondLength) ||
            scaledBondLength <= 0 ||
            contourLength <= chordLength + 1e-6
        ) {
            return straightPositions;
        }

        const axisX = deltaX / chordLength;
        const axisY = deltaY / chordLength;
        let outwardX = -axisY;
        let outwardY = axisX;
        const hintX = Number(outwardHint && outwardHint.x) || 0;
        const hintY = Number(outwardHint && outwardHint.y) || 0;
        if (outwardX * hintX + outwardY * hintY < 0) {
            outwardX *= -1;
            outwardY *= -1;
        }

        const targetRatio = chordLength / contourLength;
        const semicircleRatio = 2 / Math.PI;
        let angle = Math.PI;
        if (targetRatio > semicircleRatio) {
            let lower = 0;
            let upper = Math.PI;
            for (let iteration = 0; iteration < 60; iteration++) {
                const candidate = (lower + upper) / 2;
                const ratio = candidate < 1e-9
                    ? 1
                    : 2 * Math.sin(candidate / 2) / candidate;
                if (ratio > targetRatio) lower = candidate;
                else upper = candidate;
            }
            angle = (lower + upper) / 2;
        }

        const radius = chordLength / (2 * Math.sin(angle / 2));
        const midpointX = (startX + endX) / 2;
        const midpointY = (startY + endY) / 2;
        const halfAngleCosine = Math.cos(angle / 2);

        return Array.from({ length: count }, (_, index) => {
            const fraction = (index + 1) / (count + 1);
            const pointAngle = -angle / 2 + angle * fraction;
            const along = radius * Math.sin(pointAngle);
            const outward = radius * (Math.cos(pointAngle) - halfAngleCosine);
            return {
                x: midpointX + axisX * along + outwardX * outward,
                y: midpointY + axisY * along + outwardY * outward,
            };
        });
    }

    /**
     * Return nucleotide numbers strictly between two paired endpoints.
     *
     * @param {number} source
     * @param {number} target
     * @returns {number[]}
     */
    function getIntermediateNodeNumbers(source, target) {
        const step = Math.sign(target - source);
        if (step === 0) return [];

        const nodeNumbers = [];
        for (let nodeNumber = source + step; nodeNumber !== target; nodeNumber += step) {
            nodeNumbers.push(nodeNumber);
        }
        return nodeNumbers;
    }

    /**
     * Resolve a nucleotide node by its 1-based Fornac node number.
     *
     * @param {Object} graph
     * @param {number} nodeNumber
     * @returns {Object|null}
     */
    function getGraphNucleotideByNumber(graph, nodeNumber) {
        if (!graph || !Array.isArray(graph.nodes)) return null;
        if (graph.varriLinearRriNucleotideByNumber instanceof Map) {
            return graph.varriLinearRriNucleotideByNumber.get(nodeNumber) || null;
        }
        return graph.nodes.find(node =>
            node && node.nodeType === 'nucleotide' && node.num === nodeNumber
        ) || null;
    }

    /**
     * Fix a nucleotide at one deterministic linear-RRI scaffold position.
     *
     * @param {Object} node
     * @param {{x:number,y:number}} point
     * @returns {boolean}
     */
    function pinLinearRriNode(node, point) {
        if (
            !node ||
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
        ) {
            return false;
        }

        node.x = node.px = point.x;
        node.y = node.py = point.y;
        node.fixed = (node.fixed || 0) | 1;
        node.varriLinearRri = true;
        return true;
    }

    /**
     * Place directly attached terminal unpaired runs as diverging zipper ends.
     *
     * A terminal run is constrained only when its neighbouring nucleotide is
     * an outer RRI rail node. Terminal dots separated from the interaction by
     * other structure remain fully force-directed.
     *
     * @param {Object} v
     * @param {Object.<number,{x:number,y:number,sequence:string}>} railPositions
     * @param {number} nucleotideSpacing
     * @param {{x:number,y:number}} axis
     * @param {{x:number,y:number}} normal
     * @returns {Object.<number,{x:number,y:number,sequence:string,side:string}>}
     */
    function getLinearRriTailPositions(
        v,
        railPositions,
        nucleotideSpacing,
        axis,
        normal
    ) {
        const spacing = Number(nucleotideSpacing);
        if (!Number.isFinite(spacing) || spacing <= 0) return {};

        const axisLength = Math.hypot(Number(axis?.x), Number(axis?.y));
        const axisX = Number.isFinite(axisLength) && axisLength > 1e-6
            ? Number(axis.x) / axisLength
            : 1;
        const axisY = Number.isFinite(axisLength) && axisLength > 1e-6
            ? Number(axis.y) / axisLength
            : 0;
        const normalLength = Math.hypot(Number(normal?.x), Number(normal?.y));
        const normalX = Number.isFinite(normalLength) && normalLength > 1e-6
            ? Number(normal.x) / normalLength
            : -axisY;
        const normalY = Number.isFinite(normalLength) && normalLength > 1e-6
            ? Number(normal.y) / normalLength
            : axisX;

        const tailPositions = {};
        const horizontalUnit = 1 / Math.hypot(1, LINEAR_RRI_TAIL_SLOPE);
        const verticalUnit = LINEAR_RRI_TAIL_SLOPE * horizontalUnit;
        const sequence2Start = v.sequence1.length + GAP + 1;
        const specs = [
            {
                sequence: '1',
                structure: v.structure1,
                firstNode: 1,
                planeDirection: -1,
            },
            {
                sequence: '2',
                structure: v.structure2,
                firstNode: sequence2Start,
                planeDirection: 1,
            },
        ];

        specs.forEach(spec => {
            if (
                typeof spec.structure !== 'string' ||
                spec.structure.length === 0
            ) {
                return;
            }

            const pairNumbers = Object.entries(railPositions)
                .filter(([, point]) => point.sequence === spec.sequence)
                .map(([nodeNumber]) => Number(nodeNumber))
                .sort((a, b) => a - b);
            if (pairNumbers.length === 0) return;

            const addTail = (side, count, anchorLocalNumber) => {
                if (count <= 0) return;

                const anchorNumber = spec.firstNode + anchorLocalNumber - 1;
                const anchor = railPositions[anchorNumber];
                if (!anchor) return;

                const neighbourNumber = side === 'leading'
                    ? pairNumbers.find(nodeNumber => nodeNumber > anchorNumber)
                    : pairNumbers.slice().reverse().find(
                        nodeNumber => nodeNumber < anchorNumber
                    );
                const neighbour = railPositions[neighbourNumber];
                let horizontalDirection = neighbour
                    ? Math.sign(
                        (anchor.x - neighbour.x) * axisX +
                        (anchor.y - neighbour.y) * axisY
                    )
                    : (side === 'leading' ? -1 : 1);
                if (horizontalDirection === 0) {
                    horizontalDirection = side === 'leading' ? -1 : 1;
                }

                for (let step = 1; step <= count; step++) {
                    const localNumber = side === 'leading'
                        ? anchorLocalNumber - step
                        : anchorLocalNumber + step;
                    const nodeNumber = spec.firstNode + localNumber - 1;
                    tailPositions[nodeNumber] = {
                        x: anchor.x +
                            axisX * horizontalDirection * horizontalUnit * spacing * step +
                            normalX * spec.planeDirection * verticalUnit * spacing * step,
                        y: anchor.y +
                            axisY * horizontalDirection * horizontalUnit * spacing * step +
                            normalY * spec.planeDirection * verticalUnit * spacing * step,
                        sequence: spec.sequence,
                        side,
                    };
                }
            };

            const leadingMatch = spec.structure.match(/^\.+/);
            const leadingCount = leadingMatch ? leadingMatch[0].length : 0;
            addTail('leading', leadingCount, leadingCount + 1);

            const trailingMatch = spec.structure.match(/\.+$/);
            const trailingCount = trailingMatch ? trailingMatch[0].length : 0;
            addTail(
                'trailing',
                trailingCount,
                spec.structure.length - trailingCount
            );
        });

        return tailPositions;
    }

    /**
     * Calculate a two-rail RRI scaffold along a requested local axis.
     *
     * Only intermolecularly paired nucleotides are rail nodes. Purely unpaired
     * intervals receive deterministic outward bridge positions. Intervals that
     * contain intramolecular pairs are recorded separately and retain Fornac's
     * primary fold instead of being overwritten by a synthetic arc.
     *
     * @param {Object} v  Validated parameter dictionary.
     * @param {number} nucleotideSpacing  Effective backbone bond length.
     * @param {number} trackGap
     * @param {{x:number,y:number}} [center]
     * @param {{x:number,y:number}} [requestedAxis]
     * @returns {Object|null}
     */
    function getLinearRriInteractionLayout(
        v,
        nucleotideSpacing,
        trackGap,
        center = { x: 0, y: 0 },
        requestedAxis = { x: 1, y: 0 }
    ) {
        const spacing = Number(nucleotideSpacing);
        if (!Number.isFinite(spacing) || spacing <= 0) return null;

        const pairs = listIntermolPairs(v).slice().sort((a, b) => a[0] - b[0]);
        if (pairs.length === 0) return null;

        const centerX = Number.isFinite(Number(center && center.x)) ? Number(center.x) : 0;
        const centerY = Number.isFinite(Number(center && center.y)) ? Number(center.y) : 0;
        let axisX = Number(requestedAxis && requestedAxis.x);
        let axisY = Number(requestedAxis && requestedAxis.y);
        let axisLength = Math.hypot(axisX, axisY);
        if (!Number.isFinite(axisLength) || axisLength < 1e-6) {
            axisX = 1;
            axisY = 0;
            axisLength = 1;
        }
        axisX /= axisLength;
        axisY /= axisLength;
        const normalX = -axisY;
        const normalY = axisX;
        const requestedGap = Number(trackGap);
        const effectiveTrackGap = Math.max(
            spacing,
            Number.isFinite(requestedGap) && requestedGap > 0
                ? requestedGap
                : LINEAR_RRI_TRACK_GAP_UNITS * spacing
        );
        const northOffset = -effectiveTrackGap / 2;
        const southOffset = effectiveTrackGap / 2;
        const northY = centerY + normalY * northOffset;
        const southY = centerY + normalY * southOffset;

        const sequence1PairNumbers = pairs.map(pair => pair[0]);
        const sequence2PairNumbers = pairs.map(pair => pair[1]);
        const interactionRanges = {
            sequence1: [
                Math.min(...sequence1PairNumbers),
                Math.max(...sequence1PairNumbers),
            ],
            sequence2: [
                Math.min(...sequence2PairNumbers),
                Math.max(...sequence2PairNumbers),
            ],
        };

        const sequence2Deltas = sequence2PairNumbers.slice(1).map(
            (nodeNumber, index) => nodeNumber - sequence2PairNumbers[index]
        );
        const pairOrderMonotonic = sequence2Deltas.every(delta => delta > 0) ||
            sequence2Deltas.every(delta => delta < 0);

        const columnOffsets = [0];
        for (let index = 1; index < pairs.length; index++) {
            const sequence1LoopSize = Math.max(
                0,
                Math.abs(pairs[index][0] - pairs[index - 1][0]) - 1
            );
            const sequence2LoopSize = Math.max(
                0,
                Math.abs(pairs[index][1] - pairs[index - 1][1]) - 1
            );
            const largerLoopSize = Math.max(sequence1LoopSize, sequence2LoopSize);
            const chordLength = spacing *
                Math.max(1, 2 * (largerLoopSize + 1) / Math.PI);
            columnOffsets.push(columnOffsets[columnOffsets.length - 1] + chordLength);
        }

        const columnCenter =
            (columnOffsets[0] + columnOffsets[columnOffsets.length - 1]) / 2;
        const positions = {};

        pairs.forEach((pair, index) => {
            const along = columnOffsets[index] - columnCenter;
            positions[pair[0]] = {
                x: centerX + axisX * along + normalX * northOffset,
                y: centerY + axisY * along + normalY * northOffset,
                sequence: '1',
            };
            positions[pair[1]] = {
                x: centerX + axisX * along + normalX * southOffset,
                y: centerY + axisY * along + normalY * southOffset,
                sequence: '2',
            };
        });

        const bridgePositions = {};
        const structuredBridgeGroups = [];
        if (pairOrderMonotonic) {
            for (let index = 1; index < pairs.length; index++) {
                const previousPair = pairs[index - 1];
                const currentPair = pairs[index];
                const bridges = [
                    {
                        source: previousPair[0],
                        target: currentPair[0],
                        start: positions[previousPair[0]],
                        end: positions[currentPair[0]],
                        sequence: '1',
                        outward: { x: -normalX, y: -normalY },
                    },
                    {
                        source: previousPair[1],
                        target: currentPair[1],
                        start: positions[previousPair[1]],
                        end: positions[currentPair[1]],
                        sequence: '2',
                        outward: { x: normalX, y: normalY },
                    },
                ];

                bridges.forEach(bridge => {
                    const nodeNumbers = getIntermediateNodeNumbers(
                        bridge.source,
                        bridge.target
                    );
                    const containsIntramolecularStructure = nodeNumbers.some(
                        nodeNumber => v.structure_dict[String(nodeNumber)] !== '.'
                    );
                    if (containsIntramolecularStructure) {
                        structuredBridgeGroups.push({
                            sequence: bridge.sequence,
                            nodeNumbers,
                        });
                        return;
                    }
                    const seededPositions = getLinearRriBridgePositions(
                        bridge.start,
                        bridge.end,
                        nodeNumbers.length,
                        spacing,
                        bridge.outward
                    );
                    nodeNumbers.forEach((nodeNumber, nodeIndex) => {
                        bridgePositions[nodeNumber] = {
                            ...seededPositions[nodeIndex],
                            sequence: bridge.sequence,
                        };
                    });
                });
            }
        }

        const tailPositions = getLinearRriTailPositions(
            v,
            positions,
            spacing,
            { x: axisX, y: axisY },
            { x: normalX, y: normalY }
        );

        return {
            positions,
            bridgePositions,
            structuredBridgeGroups,
            tailPositions,
            pairs,
            interactionRanges,
            center: { x: centerX, y: centerY },
            axis: { x: axisX, y: axisY },
            normal: { x: normalX, y: normalY },
            northOffset,
            southOffset,
            northY,
            southY,
            trackGap: effectiveTrackGap,
            nucleotideSpacing: spacing,
            rotationDegrees: normaliseRotationDegrees(
                -Math.atan2(axisY, axisX) * 180 / Math.PI
            ),
            pairOrderMonotonic,
        };
    }

    /**
     * Pin purely unpaired RRI bulges to deterministic outward bridges.
     *
     * Structured intervals are absent from `bridgePositions`; their original
     * Fornac fold therefore remains untouched.
     *
     * @param {Object} graph
     * @param {Object} layout
     */
    function seedLinearRriBridgeNodes(graph, layout) {
        if (!graph || !Array.isArray(graph.nodes) || !layout) return;

        Object.entries(layout.bridgePositions || {}).forEach(([nodeNumber, point]) => {
            const node = getGraphNucleotideByNumber(graph, Number(nodeNumber));
            if (!node || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            if (pinLinearRriNode(node, point)) {
                node.varriLinearRriBridge = true;
            }
        });
    }

    /**
     * Pin directly attached terminal dots to straight outward zipper ends.
     *
     * @param {Object} graph
     * @param {Object} layout
     */
    function seedLinearRriTailNodes(graph, layout) {
        if (!graph || !Array.isArray(graph.nodes) || !layout) return;

        Object.entries(layout.tailPositions || {}).forEach(([nodeNumber, point]) => {
            const node = getGraphNucleotideByNumber(graph, Number(nodeNumber));
            if (!node || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            if (pinLinearRriNode(node, point)) {
                node.varriLinearRriTail = true;
            }
        });
    }

    /**
     * Derive the RRI axis from Fornac's existing pair-column orientation.
     *
     * @param {Array<{sequence1:Object,sequence2:Object}>} pairNodes
     * @returns {{x:number,y:number}}
     */
    function getLinearRriScaffoldAxis(pairNodes) {
        if (!Array.isArray(pairNodes) || pairNodes.length === 0) {
            return { x: 1, y: 0 };
        }

        const pairCenter = pair => ({
            x: (pair.sequence1.x + pair.sequence2.x) / 2,
            y: (pair.sequence1.y + pair.sequence2.y) / 2,
        });
        const separation = pairNodes.reduce((sum, pair) => ({
            x: sum.x + pair.sequence2.x - pair.sequence1.x,
            y: sum.y + pair.sequence2.y - pair.sequence1.y,
        }), { x: 0, y: 0 });
        let axisX;
        let axisY;

        if (pairNodes.length === 1) {
            axisX = separation.y;
            axisY = -separation.x;
        } else {
            const first = pairCenter(pairNodes[0]);
            const last = pairCenter(pairNodes[pairNodes.length - 1]);
            axisX = last.x - first.x;
            axisY = last.y - first.y;
        }
        let length = Math.hypot(axisX, axisY);

        if (!Number.isFinite(length) || length < 1e-6) {
            axisX = pairNodes[pairNodes.length - 1].sequence1.x -
                pairNodes[0].sequence1.x;
            axisY = pairNodes[pairNodes.length - 1].sequence1.y -
                pairNodes[0].sequence1.y;
            length = Math.hypot(axisX, axisY);
        }
        if (!Number.isFinite(length) || length < 1e-6) {
            return { x: 1, y: 0 };
        }

        axisX /= length;
        axisY /= length;
        const normalDotSeparation =
            (-axisY * separation.x) + (axisX * separation.y);
        if (Number.isFinite(normalDotSeparation) && normalDotSeparation < 0) {
            axisX *= -1;
            axisY *= -1;
        }

        return { x: axisX, y: axisY };
    }

    /**
     * Add one fixed, invisible continuation node beyond each molecular end.
     *
     * The nodes and links are appended after Fornac created the SVG, so they
     * never create visible elements. A continuation spring is added only when
     * the terminal nucleotide already belongs to a deterministic zipper tail
     * or rail. Structured termini still receive the requested invisible node,
     * but no extra spring is allowed to distort their primary fold.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {number} nucleotideSpacing
     * @returns {number}
     */
    function addLinearRriTerminalGhosts(
        graph,
        v,
        layout,
        nucleotideSpacing
    ) {
        if (
            !graph ||
            !Array.isArray(graph.nodes) ||
            !Array.isArray(graph.links) ||
            graph.varriLinearRriGhosts
        ) {
            return 0;
        }

        const spacing = Number(nucleotideSpacing);
        if (!Number.isFinite(spacing) || spacing <= 0) return 0;

        const frame = getLinearRriFrame(layout);
        let axisX = Number(layout?.axis?.x);
        let axisY = Number(layout?.axis?.y);
        let axisLength = Math.hypot(axisX, axisY);
        if (!Number.isFinite(axisLength) || axisLength < 1e-6) {
            axisX = frame.normalY;
            axisY = -frame.normalX;
            axisLength = 1;
        }
        axisX /= axisLength;
        axisY /= axisLength;

        const sequence2Start = v.sequence1.length + GAP + 1;
        const sequence2End = sequence2Start + v.sequence2.length - 1;
        const termini = [
            {
                sequence: '1',
                side: 'leading',
                terminal: 1,
                adjacent: v.sequence1.length > 1 ? 2 : null,
                planeDirection: -1,
            },
            {
                sequence: '1',
                side: 'trailing',
                terminal: v.sequence1.length,
                adjacent: v.sequence1.length > 1
                    ? v.sequence1.length - 1
                    : null,
                planeDirection: -1,
            },
            {
                sequence: '2',
                side: 'leading',
                terminal: sequence2Start,
                adjacent: v.sequence2.length > 1 ? sequence2Start + 1 : null,
                planeDirection: 1,
            },
            {
                sequence: '2',
                side: 'trailing',
                terminal: sequence2End,
                adjacent: v.sequence2.length > 1 ? sequence2End - 1 : null,
                planeDirection: 1,
            },
        ];
        const ghosts = [];

        termini.forEach((spec, index) => {
            const terminal = getGraphNucleotideByNumber(graph, spec.terminal);
            const adjacent = spec.adjacent === null
                ? null
                : getGraphNucleotideByNumber(graph, spec.adjacent);
            if (!terminal) return;

            let directionX = adjacent ? terminal.x - adjacent.x : NaN;
            let directionY = adjacent ? terminal.y - adjacent.y : NaN;
            let directionLength = Math.hypot(directionX, directionY);
            const outwardX = frame.normalX * spec.planeDirection;
            const outwardY = frame.normalY * spec.planeDirection;
            const outwardProjection = directionLength > 1e-6
                ? (directionX * outwardX + directionY * outwardY) / directionLength
                : -1;

            if (
                !Number.isFinite(directionLength) ||
                directionLength < 1e-6 ||
                outwardProjection < 0.1
            ) {
                const alongProjection =
                    (terminal.x - frame.centerX) * axisX +
                    (terminal.y - frame.centerY) * axisY;
                const defaultAlongDirection = spec.side === 'leading' ? -1 : 1;
                const alongDirection = adjacent
                    ? (Math.sign(alongProjection) || defaultAlongDirection)
                    : defaultAlongDirection;
                directionX =
                    axisX * alongDirection +
                    outwardX * LINEAR_RRI_TAIL_SLOPE;
                directionY =
                    axisY * alongDirection +
                    outwardY * LINEAR_RRI_TAIL_SLOPE;
                directionLength = Math.hypot(directionX, directionY);
            }

            directionX /= directionLength;
            directionY /= directionLength;
            const ghost = {
                uid: `varri-linear-ghost-${spec.sequence}-${spec.side}`,
                num: -1000000 - index,
                nodeType: 'middle',
                name: '',
                x: terminal.x + directionX * spacing,
                y: terminal.y + directionY * spacing,
                px: terminal.x + directionX * spacing,
                py: terminal.y + directionY * spacing,
                fixed: 1,
                radius: 0,
                sequence: spec.sequence,
                side: spec.side,
                varriLinearRriGhost: true,
            };
            graph.nodes.push(ghost);
            const terminalIsConstrained =
                Object.prototype.hasOwnProperty.call(
                    layout.tailPositions || {},
                    terminal.num
                ) ||
                Object.prototype.hasOwnProperty.call(
                    layout.positions || {},
                    terminal.num
                );
            if (terminalIsConstrained) {
                graph.links.push({
                    source: terminal,
                    target: ghost,
                    value: 1,
                    linkType: LINEAR_RRI_GHOST_LINK_TYPE,
                    extraLinkType: 'constraint',
                });
            }
            ghosts.push(ghost);
        });

        graph.varriLinearRriGhosts = ghosts;
        return ghosts.length;
    }

    /**
     * Resolve the scaffold-local centre and outward normal.
     *
     * Older callers that provide only northY/southY retain horizontal behavior.
     *
     * @param {Object} layout
     * @returns {{centerX:number,centerY:number,normalX:number,normalY:number,northOffset:number,southOffset:number}}
     */
    function getLinearRriFrame(layout) {
        const fallbackCenterY =
            (Number(layout?.northY) + Number(layout?.southY)) / 2;
        const centerX = Number.isFinite(Number(layout?.center?.x))
            ? Number(layout.center.x)
            : 0;
        const centerY = Number.isFinite(Number(layout?.center?.y))
            ? Number(layout.center.y)
            : (Number.isFinite(fallbackCenterY) ? fallbackCenterY : 0);

        let normalX = Number(layout?.normal?.x);
        let normalY = Number(layout?.normal?.y);
        let normalLength = Math.hypot(normalX, normalY);
        if (!Number.isFinite(normalLength) || normalLength < 1e-6) {
            normalX = 0;
            normalY = 1;
            normalLength = 1;
        }
        normalX /= normalLength;
        normalY /= normalLength;

        const fallbackNorthOffset = Number(layout?.northY) - centerY;
        const fallbackSouthOffset = Number(layout?.southY) - centerY;
        const northOffset = Number.isFinite(Number(layout?.northOffset))
            ? Number(layout.northOffset)
            : (Number.isFinite(fallbackNorthOffset) ? fallbackNorthOffset : 0);
        const southOffset = Number.isFinite(Number(layout?.southOffset))
            ? Number(layout.southOffset)
            : (Number.isFinite(fallbackSouthOffset) ? fallbackSouthOffset : 0);

        return {
            centerX,
            centerY,
            normalX,
            normalY,
            northOffset,
            southOffset,
        };
    }

    /**
     * Translate one flanking structure into its scaffold-local half-plane.
     *
     * @param {Object[]} nodes
     * @param {number} boundaryProjection
     * @param {"north"|"south"} plane
     * @param {Object} frame
     */
    function translateLinearRriGroupIntoPlane(
        nodes,
        boundaryProjection,
        plane,
        frame
    ) {
        const positionedNodes = nodes.filter(node => Number.isFinite(node?.y));
        if (positionedNodes.length === 0) return 0;

        const projections = positionedNodes.map(node => {
            const x = Number.isFinite(node.x) ? node.x : frame.centerX;
            return (x - frame.centerX) * frame.normalX +
                (node.y - frame.centerY) * frame.normalY;
        });
        const edgeProjection = plane === 'north'
            ? Math.max(...projections)
            : Math.min(...projections);
        const shift = plane === 'north'
            ? Math.min(0, boundaryProjection - edgeProjection)
            : Math.max(0, boundaryProjection - edgeProjection);
        if (shift === 0) return 0;

        positionedNodes.forEach(node => {
            const shiftX = frame.normalX * shift;
            const shiftY = frame.normalY * shift;
            node.x = (Number.isFinite(node.x) ? node.x : frame.centerX) + shiftX;
            node.y += shiftY;
            node.px = node.x;
            node.py = node.y;
        });
        return positionedNodes.length;
    }

    /**
     * Split each molecule into movable structural components.
     *
     * Rail nodes, deterministic pure-bulge nodes, and deterministic terminal
     * tails act as boundaries. Backbone neighbours remain connected, and
     * intramolecular basepairs reconnect stem halves that lie on opposite sides
     * of an interaction rail. Moving each resulting component as one rigid
     * group preserves Fornac's primary fold.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @returns {Array<{nodes:Object[],plane:"north"|"south"}>}
     */
    function getLinearRriMovableGroups(graph, v, layout) {
        const nodeByNumber = new Map(
            graph.nodes
                .filter(node => node && node.nodeType === 'nucleotide')
                .map(node => [node.num, node])
        );
        const constrainedNumbers = new Set(
            [
                ...Object.keys(layout.positions || {}),
                ...Object.keys(layout.bridgePositions || {}),
                ...Object.keys(layout.tailPositions || {}),
                ...Object.keys(layout.structurePositions || {}),
            ].map(Number)
        );
        const sequence2Start = v.sequence1.length + GAP + 1;
        const specs = [
            { start: 1, end: v.sequence1.length, plane: 'north' },
            {
                start: sequence2Start,
                end: sequence2Start + v.sequence2.length - 1,
                plane: 'south',
            },
        ];
        const groups = [];

        specs.forEach(spec => {
            const movableNumbers = new Set();
            for (let nodeNumber = spec.start; nodeNumber <= spec.end; nodeNumber++) {
                const node = nodeByNumber.get(nodeNumber);
                if (node && !constrainedNumbers.has(nodeNumber)) {
                    movableNumbers.add(nodeNumber);
                }
            }
            const adjacency = new Map(
                [...movableNumbers].map(nodeNumber => [nodeNumber, new Set()])
            );
            const connect = (first, second) => {
                if (!movableNumbers.has(first) || !movableNumbers.has(second)) return;
                adjacency.get(first).add(second);
                adjacency.get(second).add(first);
            };

            for (let nodeNumber = spec.start; nodeNumber < spec.end; nodeNumber++) {
                connect(nodeNumber, nodeNumber + 1);
            }
            (graph.links || []).forEach(link => {
                const sourceNumber = typeof link?.source === 'number'
                    ? link.source
                    : link?.source?.num;
                const targetNumber = typeof link?.target === 'number'
                    ? link.target
                    : link?.target?.num;
                if (!Number.isInteger(sourceNumber) || !Number.isInteger(targetNumber)) {
                    return;
                }
                connect(sourceNumber, targetNumber);
            });

            const visited = new Set();
            [...movableNumbers].sort((a, b) => a - b).forEach(startNumber => {
                if (visited.has(startNumber)) return;
                const componentNumbers = [];
                const pending = [startNumber];
                visited.add(startNumber);
                while (pending.length > 0) {
                    const nodeNumber = pending.pop();
                    componentNumbers.push(nodeNumber);
                    adjacency.get(nodeNumber).forEach(neighbour => {
                        if (visited.has(neighbour)) return;
                        visited.add(neighbour);
                        pending.push(neighbour);
                    });
                }
                componentNumbers.sort((a, b) => a - b);
                groups.push({
                    nodes: componentNumbers.map(nodeNumber => nodeByNumber.get(nodeNumber)),
                    plane: spec.plane,
                });
            });
        });

        return groups;
    }

    /**
     * Map every non-synthetic structural component from Fornac's original
     * coordinates onto its new rail attachments with a rigid/similarity
     * transform.
     *
     * Two or more attachments determine rotation and scale. The scale is never
     * allowed below one, so linearization cannot compress a valid primary fold.
     * A one-attachment component is translated only.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {Object.<number,{x:number,y:number}>} originalPositions
     * @returns {number} Number of positioned structural nucleotides.
     */
    function alignLinearRriStructuralComponents(
        graph,
        v,
        layout,
        originalPositions
    ) {
        if (!graph || !layout || !originalPositions) return 0;
        const targetPositions = {
            ...(layout.positions || {}),
            ...(layout.bridgePositions || {}),
            ...(layout.tailPositions || {}),
        };
        const targetNumbers = new Set(Object.keys(targetPositions).map(Number));
        let positioned = 0;

        getLinearRriMovableGroups(graph, v, layout).forEach(group => {
            const groupNumbers = new Set(group.nodes.map(node => node.num));
            const attachmentsByKey = new Map();
            const addAttachment = (componentNumber, targetNumber) => {
                if (
                    groupNumbers.has(componentNumber) &&
                    targetNumbers.has(targetNumber) &&
                    originalPositions[componentNumber] &&
                    targetPositions[targetNumber]
                ) {
                    attachmentsByKey.set(
                        `${componentNumber}:${targetNumber}`,
                        { componentNumber, targetNumber }
                    );
                }
            };

            group.nodes.forEach(node => {
                addAttachment(node.num, node.num - 1);
                addAttachment(node.num, node.num + 1);
            });
            (graph.links || []).forEach(link => {
                const sourceNumber = typeof link?.source === 'number'
                    ? link.source
                    : link?.source?.num;
                const targetNumber = typeof link?.target === 'number'
                    ? link.target
                    : link?.target?.num;
                addAttachment(sourceNumber, targetNumber);
                addAttachment(targetNumber, sourceNumber);
            });

            const frame = getLinearRriFrame(layout);
            const spacing = Number(layout.nucleotideSpacing) ||
                Number(layout.trackGap) ||
                1;
            const outwardDirection = group.plane === 'north' ? -1 : 1;
            const attachmentTarget = attachment => {
                const target = targetPositions[attachment.targetNumber];
                return {
                    x: target.x + frame.normalX * outwardDirection * spacing,
                    y: target.y + frame.normalY * outwardDirection * spacing,
                };
            };
            const attachments = [...attachmentsByKey.values()];
            let transformPoint = point => ({ x: point.x, y: point.y });
            if (attachments.length === 1) {
                const source = originalPositions[attachments[0].componentNumber];
                const target = attachmentTarget(attachments[0]);
                const shiftX = target.x - source.x;
                const shiftY = target.y - source.y;
                transformPoint = point => ({
                    x: point.x + shiftX,
                    y: point.y + shiftY,
                });
            } else if (attachments.length >= 2) {
                let first = 0;
                let second = 1;
                let maximumDistance = -1;
                for (let firstIndex = 0; firstIndex < attachments.length; firstIndex++) {
                    for (
                        let secondIndex = firstIndex + 1;
                        secondIndex < attachments.length;
                        secondIndex++
                    ) {
                        const firstPoint = originalPositions[
                            attachments[firstIndex].componentNumber
                        ];
                        const secondPoint = originalPositions[
                            attachments[secondIndex].componentNumber
                        ];
                        const distance = Math.hypot(
                            secondPoint.x - firstPoint.x,
                            secondPoint.y - firstPoint.y
                        );
                        if (distance > maximumDistance) {
                            maximumDistance = distance;
                            first = firstIndex;
                            second = secondIndex;
                        }
                    }
                }

                const sourceFirst = originalPositions[
                    attachments[first].componentNumber
                ];
                const sourceSecond = originalPositions[
                    attachments[second].componentNumber
                ];
                const targetFirst = attachmentTarget(attachments[first]);
                const targetSecond = attachmentTarget(attachments[second]);
                const sourceX = sourceSecond.x - sourceFirst.x;
                const sourceY = sourceSecond.y - sourceFirst.y;
                const targetX = targetSecond.x - targetFirst.x;
                const targetY = targetSecond.y - targetFirst.y;
                const sourceLength = Math.hypot(sourceX, sourceY);
                const targetLength = Math.hypot(targetX, targetY);

                if (sourceLength > 1e-6 && targetLength > 1e-6) {
                    const cosine =
                        (sourceX * targetX + sourceY * targetY) /
                        (sourceLength * targetLength);
                    const sine =
                        (sourceX * targetY - sourceY * targetX) /
                        (sourceLength * targetLength);
                    const scale = Math.max(1, targetLength / sourceLength);
                    const sourceCenter = {
                        x: (sourceFirst.x + sourceSecond.x) / 2,
                        y: (sourceFirst.y + sourceSecond.y) / 2,
                    };
                    const targetCenter = {
                        x: (targetFirst.x + targetSecond.x) / 2,
                        y: (targetFirst.y + targetSecond.y) / 2,
                    };
                    transformPoint = point => {
                        const relativeX = point.x - sourceCenter.x;
                        const relativeY = point.y - sourceCenter.y;
                        return {
                            x: targetCenter.x + scale * (
                                cosine * relativeX - sine * relativeY
                            ),
                            y: targetCenter.y + scale * (
                                sine * relativeX + cosine * relativeY
                            ),
                        };
                    };
                }
            }

            const transformedNodes = group.nodes.map(node => {
                const source = originalPositions[node.num];
                if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) {
                    return null;
                }
                return { node, target: transformPoint(source) };
            }).filter(Boolean);
            let reflectAcrossRailAxis = false;
            let attachmentCenter = null;
            if (attachments.length > 0 && transformedNodes.length > 0) {
                const attachmentTargets = attachments.map(attachmentTarget);
                attachmentCenter = attachmentTargets.reduce((sum, point) => ({
                    x: sum.x + point.x,
                    y: sum.y + point.y,
                }), { x: 0, y: 0 });
                attachmentCenter.x /= attachmentTargets.length;
                attachmentCenter.y /= attachmentTargets.length;
                const componentCenter = transformedNodes.reduce((sum, item) => ({
                    x: sum.x + item.target.x,
                    y: sum.y + item.target.y,
                }), { x: 0, y: 0 });
                componentCenter.x /= transformedNodes.length;
                componentCenter.y /= transformedNodes.length;
                const componentNormalOffset =
                    (componentCenter.x - attachmentCenter.x) * frame.normalX +
                    (componentCenter.y - attachmentCenter.y) * frame.normalY;
                reflectAcrossRailAxis =
                    componentNormalOffset * outwardDirection < 0;
            }

            transformedNodes.forEach(({ node, target: unreflectedTarget }) => {
                let target = unreflectedTarget;
                if (reflectAcrossRailAxis) {
                    const normalOffset =
                        (target.x - attachmentCenter.x) * frame.normalX +
                        (target.y - attachmentCenter.y) * frame.normalY;
                    target = {
                        x: target.x - 2 * normalOffset * frame.normalX,
                        y: target.y - 2 * normalOffset * frame.normalY,
                    };
                }
                node.x = node.px = target.x;
                node.y = node.py = target.y;
                positioned++;
            });
        });

        return positioned;
    }

    /**
     * Capture and pin the structure-preserving coordinates after alignment and
     * half-plane correction.
     *
     * @param {Object} graph
     * @param {Object} layout
     */
    function captureLinearRriStructurePositions(graph, layout) {
        const alreadyConstrained = new Set(
            [
                ...Object.keys(layout.positions || {}),
                ...Object.keys(layout.bridgePositions || {}),
                ...Object.keys(layout.tailPositions || {}),
            ].map(Number)
        );
        layout.structurePositions = {};
        graph.nodes.forEach(node => {
            if (
                !node ||
                node.nodeType !== 'nucleotide' ||
                alreadyConstrained.has(node.num) ||
                !Number.isFinite(node.x) ||
                !Number.isFinite(node.y)
            ) {
                return;
            }
            layout.structurePositions[node.num] = { x: node.x, y: node.y };
            pinLinearRriNode(node, layout.structurePositions[node.num]);
            node.varriLinearRriStructure = true;
        });
    }

    /**
     * Keep every unconstrained fold in its molecule's scaffold-local outer
     * half-plane without flattening individual nucleotides.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {number} clearance
     * @returns {number} Number of corrected nodes.
     */
    function enforceLinearRriHalfPlanes(graph, v, layout, clearance) {
        if (!graph || !Array.isArray(graph.nodes) || !layout) return 0;

        const safeClearance = Math.max(0, Number(clearance) || 0);
        const frame = getLinearRriFrame(layout);
        const northBoundary = frame.northOffset - safeClearance;
        const southBoundary = frame.southOffset + safeClearance;
        let changed = 0;

        getLinearRriMovableGroups(graph, v, layout).forEach(group => {
            const boundary = group.plane === 'north'
                ? northBoundary
                : southBoundary;
            changed += translateLinearRriGroupIntoPlane(
                group.nodes,
                boundary,
                group.plane,
                frame
            );
        });

        return changed;
    }

    /**
     * Preserve initial fold shapes while moving flanking structures outside
     * the protected interaction corridor.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {number} clearance
     */
    function prepareLinearRriExternalStructures(graph, v, layout, clearance) {
        enforceLinearRriHalfPlanes(graph, v, layout, clearance);
    }

    /**
     * Keep index and mutation label nodes outside the local RNA contour.
     *
     * A fixed offset from the labelled nucleotide is insufficient for folded
     * structures: another stem can occupy that offset.  Work in the scaffold's
     * orthonormal axis/normal frame and search the nearest collision-free point
     * in the molecule's outward half-plane.  Candidate links that cross another
     * nucleotide are rejected as well.  Label positions remain display-only so
     * this never pulls on or deforms the RNA force graph.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {number} distance
     * @returns {number}
     */
    function enforceLinearRriSupplementaryNodes(graph, v, layout, distance) {
        if (
            !graph ||
            !Array.isArray(graph.links) ||
            !layout ||
            !Number.isFinite(Number(distance))
        ) {
            return 0;
        }

        const frame = getLinearRriFrame(layout);
        const safeDistance = Math.max(0, Number(distance));
        let axisX = Number(layout?.axis?.x);
        let axisY = Number(layout?.axis?.y);
        const axisLength = Math.hypot(axisX, axisY);
        if (!Number.isFinite(axisLength) || axisLength < 1e-6) {
            axisX = frame.normalY;
            axisY = -frame.normalX;
        } else {
            axisX /= axisLength;
            axisY /= axisLength;
        }
        const sequence2Start = v.sequence1.length + GAP + 1;
        const sequence2End = sequence2Start + v.sequence2.length - 1;
        const projectAxis = point => point.x * axisX + point.y * axisY;
        const projectNormal = point =>
            point.x * frame.normalX + point.y * frame.normalY;
        const isActualNucleotide = node => node?.nodeType === 'nucleotide' && (
            (node.num >= 1 && node.num <= v.sequence1.length) ||
            (node.num >= sequence2Start && node.num <= sequence2End)
        ) && Number.isFinite(node.x) && Number.isFinite(node.y);
        const nucleotideSet = new Set(
            Array.isArray(graph.nodes)
                ? graph.nodes.filter(isActualNucleotide)
                : []
        );
        graph.links.forEach(link => {
            if (isActualNucleotide(link?.source)) nucleotideSet.add(link.source);
            if (isActualNucleotide(link?.target)) nucleotideSet.add(link.target);
        });
        const positionSignature = [...nucleotideSet].reduce((signature, node, index) => {
            const weight = Number(node.num) + index + 1;
            signature.weightedX += weight * node.x;
            signature.weightedY += weight * node.y;
            signature.squaredDistance += node.x ** 2 + node.y ** 2;
            return signature;
        }, {
            weightedX: 0,
            weightedY: 0,
            squaredDistance: 0,
        });
        const obstacleCacheKey = [
            v.sequence1.length,
            v.sequence2.length,
            nucleotideSet.size,
            safeDistance,
            axisX,
            axisY,
            frame.normalX,
            frame.normalY,
            positionSignature.weightedX,
            positionSignature.weightedY,
            positionSignature.squaredDistance,
        ].join(':');
        let obstacleIndex = layout.varriLinearRriSupplementaryObstacleIndex;
        if (
            !obstacleIndex ||
            obstacleIndex.graph !== graph ||
            obstacleIndex.key !== obstacleCacheKey
        ) {
            const nucleotideObstacles = [...nucleotideSet].map(node => ({
                node,
                axis: projectAxis(node),
                normal: projectNormal(node),
            }));
            const gridSize = Math.max(12, safeDistance);
            const grid = new Map();
            nucleotideObstacles.forEach(obstacle => {
                const key = `${Math.floor(obstacle.axis / gridSize)}:` +
                    Math.floor(obstacle.normal / gridSize);
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(obstacle);
            });
            obstacleIndex = {
                graph,
                key: obstacleCacheKey,
                nucleotideObstacles,
                grid,
                gridSize,
            };
            layout.varriLinearRriSupplementaryObstacleIndex = obstacleIndex;
        }
        const { nucleotideObstacles, grid, gridSize } = obstacleIndex;
        const queryObstacles = (minimumAxis, maximumAxis, minimumNormal, maximumNormal) => {
            const obstacles = [];
            const firstAxisCell = Math.floor(minimumAxis / gridSize);
            const lastAxisCell = Math.floor(maximumAxis / gridSize);
            const firstNormalCell = Math.floor(minimumNormal / gridSize);
            const lastNormalCell = Math.floor(maximumNormal / gridSize);
            for (let axisCell = firstAxisCell; axisCell <= lastAxisCell; axisCell++) {
                for (
                    let normalCell = firstNormalCell;
                    normalCell <= lastNormalCell;
                    normalCell++
                ) {
                    const bucket = grid.get(`${axisCell}:${normalCell}`);
                    if (bucket) obstacles.push(...bucket);
                }
            }
            return obstacles;
        };
        const nucleotideClearance = Math.max(12, safeDistance * 0.55);
        const labelClearance = Math.max(12, safeDistance * 0.55);
        const linkPathClearance = Math.max(6, safeDistance * 0.28);
        const rotationCandidates = [0, 28, -28, 45, -45, 62, -62, 76, -76];
        const radiusMultipliers = [1, 1.25, 1.5, 1.8, 2.2, 2.8, 3.6];
        const placedLabels = [];
        const segmentDistance = (point, start, end) => {
            const deltaAxis = end.axis - start.axis;
            const deltaNormal = end.normal - start.normal;
            const lengthSquared = deltaAxis ** 2 + deltaNormal ** 2;
            if (lengthSquared < 1e-6) {
                return Math.hypot(
                    point.axis - start.axis,
                    point.normal - start.normal
                );
            }
            const projection = Math.max(0, Math.min(1,
                ((point.axis - start.axis) * deltaAxis +
                    (point.normal - start.normal) * deltaNormal) /
                lengthSquared
            ));
            return Math.hypot(
                point.axis - (start.axis + projection * deltaAxis),
                point.normal - (start.normal + projection * deltaNormal)
            );
        };
        let changed = 0;

        graph.links.forEach(link => {
            if (!link || link.linkType !== 'label_link') return;
            const source = link.source;
            const target = link.target;
            const nucleotide = source?.nodeType === 'nucleotide'
                ? source
                : (target?.nodeType === 'nucleotide' ? target : null);
            const label = source?.nodeType === 'label'
                ? source
                : (target?.nodeType === 'label' ? target : null);
            if (!nucleotide || !label) return;

            const isSequence1 =
                nucleotide.num >= 1 && nucleotide.num <= v.sequence1.length;
            const isSequence2 =
                nucleotide.num >= sequence2Start &&
                nucleotide.num <= sequence2End;
            if (!isSequence1 && !isSequence2) return;

            const outwardDirection = isSequence1 ? -1 : 1;
            if (!Number.isFinite(label.varriLinearRriTangentOffset)) {
                const originalDeltaX = Number.isFinite(label.x - nucleotide.x)
                    ? label.x - nucleotide.x
                    : 0;
                const originalDeltaY = Number.isFinite(label.y - nucleotide.y)
                    ? label.y - nucleotide.y
                    : 0;
                const originalTangentOffset =
                    originalDeltaX * axisX + originalDeltaY * axisY;
                const maximumTangentOffset = safeDistance / 2;
                label.varriLinearRriTangentOffset = Math.max(
                    -maximumTangentOffset,
                    Math.min(maximumTangentOffset, originalTangentOffset)
                );
            }

            const nucleotidePoint = {
                axis: projectAxis(nucleotide),
                normal: projectNormal(nucleotide),
            };
            const baseAxis =
                nucleotidePoint.axis + label.varriLinearRriTangentOffset;
            const centerAxis = Number.isFinite(layout?.center?.x) &&
                Number.isFinite(layout?.center?.y)
                ? projectAxis(layout.center)
                : nucleotidePoint.axis;
            const preferredTangentDirection =
                Math.sign(label.varriLinearRriTangentOffset) ||
                Math.sign(nucleotidePoint.axis - centerAxis) ||
                1;
            const orderedAngles = rotationCandidates.map(angle =>
                angle * preferredTangentDirection
            );
            const requiredNucleotideClearance = Math.max(
                nucleotideClearance,
                Number(label.varriLinearRriRequiredClearance) || 0
            );
            const candidateIsClear = candidate => {
                const centerObstacles = queryObstacles(
                    candidate.axis - requiredNucleotideClearance,
                    candidate.axis + requiredNucleotideClearance,
                    candidate.normal - requiredNucleotideClearance,
                    candidate.normal + requiredNucleotideClearance
                );
                const clearsNucleotideCenters = centerObstacles.every(obstacle => {
                    const centerDistance = Math.hypot(
                        candidate.axis - obstacle.axis,
                        candidate.normal - obstacle.normal
                    );
                    return centerDistance + 1e-6 >= requiredNucleotideClearance;
                });
                if (!clearsNucleotideCenters) return false;
                const pathObstacles = queryObstacles(
                    Math.min(nucleotidePoint.axis, candidate.axis) - linkPathClearance,
                    Math.max(nucleotidePoint.axis, candidate.axis) + linkPathClearance,
                    Math.min(nucleotidePoint.normal, candidate.normal) - linkPathClearance,
                    Math.max(nucleotidePoint.normal, candidate.normal) + linkPathClearance
                );
                const clearsLinkPath = pathObstacles.every(obstacle =>
                    obstacle.node === nucleotide ||
                    segmentDistance(obstacle, nucleotidePoint, candidate) + 1e-6 >=
                        linkPathClearance
                );
                if (!clearsLinkPath) return false;
                return placedLabels.every(placed => Math.hypot(
                    candidate.axis - placed.axis,
                    candidate.normal - placed.normal
                ) + 1e-6 >= labelClearance);
            };

            let selectedCandidate = null;
            for (const radiusMultiplier of radiusMultipliers) {
                const radius = Math.max(12, safeDistance) * radiusMultiplier;
                for (const angleDegrees of orderedAngles) {
                    const angle = angleDegrees * Math.PI / 180;
                    const candidate = {
                        axis: baseAxis + Math.sin(angle) * radius,
                        normal: nucleotidePoint.normal +
                            outwardDirection * Math.cos(angle) * radius,
                    };
                    if (candidateIsClear(candidate)) {
                        selectedCandidate = candidate;
                        break;
                    }
                }
                if (selectedCandidate) break;
            }

            // Extremely dense input can exhaust the short-link candidates.  The
            // deterministic fallback walks the normal beyond every obstacle at
            // the candidate tangent, preserving the non-overlap guarantee.
            if (!selectedCandidate) {
                let fallbackNormal = nucleotidePoint.normal +
                    outwardDirection * Math.max(12, safeDistance);
                nucleotideObstacles.forEach(obstacle => {
                    const tangentSeparation = Math.abs(baseAxis - obstacle.axis);
                    if (tangentSeparation >= requiredNucleotideClearance) return;
                    const requiredNormalSeparation = Math.sqrt(
                        requiredNucleotideClearance ** 2 - tangentSeparation ** 2
                    );
                    const outwardLimit = obstacle.normal +
                        outwardDirection * requiredNormalSeparation;
                    fallbackNormal = outwardDirection < 0
                        ? Math.min(fallbackNormal, outwardLimit)
                        : Math.max(fallbackNormal, outwardLimit);
                });
                selectedCandidate = { axis: baseAxis, normal: fallbackNormal };
            }

            const candidateAxis = selectedCandidate.axis;
            const candidateNormal = selectedCandidate.normal;

            label.varriLinearRriDisplayX =
                axisX * candidateAxis + frame.normalX * candidateNormal;
            label.varriLinearRriDisplayY =
                axisY * candidateAxis + frame.normalY * candidateNormal;
            label.varriLinearRriDisplayAxis = candidateAxis;
            label.varriLinearRriDisplayNormal = candidateNormal;
            label.varriLinearRriSupplementary = true;
            placedLabels.push({
                axis: candidateAxis,
                normal: candidateNormal,
                outwardDirection,
            });
            changed++;
        });

        return changed;
    }

    /**
     * Restore exact RRI rail coordinates after a collision pass.
     *
     * @param {Object} graph
     * @param {Object} layout
     */
    function enforceLinearRriPinnedGeometry(graph, layout) {
        if (!graph || !Array.isArray(graph.nodes) || !layout) return;

        [
            layout.positions || {},
            layout.bridgePositions || {},
            layout.tailPositions || {},
            layout.structurePositions || {},
        ].forEach(positionMap => {
            Object.entries(positionMap).forEach(([nodeNumber, point]) => {
                const node = getGraphNucleotideByNumber(graph, Number(nodeNumber));
                pinLinearRriNode(node, point);
            });
        });
    }

    /**
     * Synchronize the SVG after the post-collision geometry constraints run.
     *
     * Fornac draws inside its own tick listener before namespaced listeners are
     * called. Updating bound SVG elements here prevents a one-frame display of
     * collision-displaced rail or half-plane nodes.
     *
     * @param {Object} graph
     */
    function syncLinearRriDom(graph) {
        if (typeof document === 'undefined' || !graph) return;

        document.querySelectorAll('g.gnode').forEach(element => {
            const node = element.__data__;
            if (!node) return;
            const x = Number.isFinite(node.varriLinearRriDisplayX)
                ? node.varriLinearRriDisplayX
                : node.x;
            const y = Number.isFinite(node.varriLinearRriDisplayY)
                ? node.varriLinearRriDisplayY
                : node.y;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                element.setAttribute('transform', `translate(${x},${y})`);
            }
        });
        document.querySelectorAll('line.link').forEach(element => {
            const link = element.__data__;
            if (!link || !link.source || !link.target) return;
            const displayPoint = node => ({
                x: Number.isFinite(node.varriLinearRriDisplayX)
                    ? node.varriLinearRriDisplayX
                    : node.x,
                y: Number.isFinite(node.varriLinearRriDisplayY)
                    ? node.varriLinearRriDisplayY
                    : node.y,
            });
            const source = displayPoint(link.source);
            const target = displayPoint(link.target);
            element.setAttribute('x1', source.x);
            element.setAttribute('y1', source.y);
            element.setAttribute('x2', target.x);
            element.setAttribute('y2', target.y);
        });
    }

    /**
     * Refine supplementary placement against the actual rendered SVG footprint.
     *
     * Fornac's label force node is a fixed-radius circle, while vaRRI can replace
     * its text with multi-digit biological indexes (including negative values).
     * Model-space node clearance therefore cannot by itself guarantee that the
     * wider text rectangle clears every nucleotide.  Measure the post-rotation
     * DOM boxes, convert each box's enclosing radius to model units, and feed
     * that required clearance back into the deterministic model-space search.
     * A small measured retry remains for browser rounding edge cases.
     *
     * @param {Object} graph
     * @param {Object} v
     * @param {Object} layout
     * @param {number} distance
     * @param {number} [maximumIterations=4]
     * @returns {{iterations:number,remainingOverlaps:number}}
     */
    function resolveLinearRriSupplementaryDomOverlaps(
        graph,
        v,
        layout,
        distance,
        maximumIterations = 4
    ) {
        if (typeof document === 'undefined' || !graph || !layout) {
            return { iterations: 0, remainingOverlaps: 0 };
        }

        const safeIterations = Math.max(1, Math.floor(Number(maximumIterations) || 1));
        const screenPadding = 0.75;
        const graphNodeSet = new Set(Array.isArray(graph.nodes) ? graph.nodes : []);
        const nucleotideElements = () => [...document.querySelectorAll(
            'circle[node_type="nucleotide"]'
        )].filter(circle => graphNodeSet.has(circle.parentElement?.__data__));
        const labelElements = () => [...document.querySelectorAll('g.gnode')].filter(group => {
            const node = group.__data__;
            const text = group.querySelector('[label_type="label"]');
            return graphNodeSet.has(node) && node?.varriLinearRriSupplementary &&
                text && text.textContent.trim() !== '';
        });
        const screenScale = group => {
            const matrix = typeof group.getScreenCTM === 'function'
                ? group.getScreenCTM()
                : null;
            const scaleX = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
            const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : 1;
            return Math.max(1e-4, Math.min(scaleX || 1, scaleY || 1));
        };
        const readNucleotideBounds = () => nucleotideElements().map(circle => {
            const bounds = circle.getBoundingClientRect();
            return {
                centerX: bounds.left + bounds.width / 2,
                centerY: bounds.top + bounds.height / 2,
                radius: Math.max(bounds.width, bounds.height) / 2,
            };
        }).filter(bounds => bounds.radius > 0);
        const maximumPenetration = (group, nucleotideBounds) => {
            const bounds = group.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return 0;
            return nucleotideBounds.reduce((maximum, nucleotide) => {
                const nearestX = Math.max(
                    bounds.left,
                    Math.min(nucleotide.centerX, bounds.right)
                );
                const nearestY = Math.max(
                    bounds.top,
                    Math.min(nucleotide.centerY, bounds.bottom)
                );
                const edgeDistance = Math.hypot(
                    nucleotide.centerX - nearestX,
                    nucleotide.centerY - nearestY
                );
                return Math.max(
                    maximum,
                    nucleotide.radius + screenPadding - edgeDistance
                );
            }, 0);
        };

        // One placement pass sized from the actual text boxes replaces many
        // trial-and-error iterations on large full-context molecules.
        const initialNucleotides = readNucleotideBounds();
        const maximumNucleotideRadius = initialNucleotides.reduce(
            (maximum, nucleotide) => Math.max(maximum, nucleotide.radius),
            0
        );
        let enforcementPasses = 0;
        let clearanceChanged = false;
        labelElements().forEach(group => {
            const bounds = group.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return;
            const scale = screenScale(group);
            const requiredClearance = (
                Math.hypot(bounds.width, bounds.height) / 2 +
                maximumNucleotideRadius +
                screenPadding
            ) / scale;
            const node = group.__data__;
            const current = Math.max(
                12,
                Number(distance) * 0.55,
                Number(node.varriLinearRriRequiredClearance) || 0
            );
            if (requiredClearance > current + 0.05) {
                node.varriLinearRriRequiredClearance = requiredClearance;
                clearanceChanged = true;
            }
        });
        if (clearanceChanged) {
            enforceLinearRriSupplementaryNodes(graph, v, layout, distance);
            syncLinearRriDom(graph);
            enforcementPasses++;
        }

        let remainingOverlaps = 0;
        while (enforcementPasses < safeIterations) {
            const nucleotideBounds = readNucleotideBounds();
            const collisions = [];

            labelElements().forEach(group => {
                const penetration = maximumPenetration(group, nucleotideBounds);
                if (penetration <= 0) return;

                collisions.push({
                    node: group.__data__,
                    additionalClearance: penetration / screenScale(group) + 1,
                });
            });

            remainingOverlaps = collisions.length;
            if (remainingOverlaps === 0) {
                return { iterations: enforcementPasses, remainingOverlaps: 0 };
            }
            collisions.forEach(({ node, additionalClearance }) => {
                const current = Number(node.varriLinearRriRequiredClearance) || 0;
                node.varriLinearRriRequiredClearance = Math.max(
                    current + additionalClearance,
                    Math.max(12, Number(distance) * 0.55) + additionalClearance
                );
            });
            enforceLinearRriSupplementaryNodes(graph, v, layout, distance);
            syncLinearRriDom(graph);
            enforcementPasses++;
        }

        const finalNucleotideBounds = readNucleotideBounds();
        remainingOverlaps = labelElements().filter(group =>
            maximumPenetration(group, finalNucleotideBounds) > 0
        ).length;
        return { iterations: enforcementPasses, remainingOverlaps };
    }

    /**
     * Build a two-rail interaction scaffold in Fornac's existing orientation.
     *
     * Intermolecularly paired nodes form parallel rails: molecule 1 on one
     * outward side and molecule 2 on the other. The SVG rotation layer aligns
     * the established scaffold horizontally as a presentation transform.
     *
     * @param {Object} container  Live Fornac container.
     * @param {Object} v  Validated parameter dictionary.
     * @returns {boolean}  Whether a linear scaffold was applied.
     */
    function applyLinearRriLayout(container, v) {
        const graph = container && container.graph;
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) return false;
        graph.varriLinearRriNucleotideByNumber = new Map(
            graph.nodes
                .filter(node => node && node.nodeType === 'nucleotide')
                .map(node => [node.num, node])
        );

        const pairs = listIntermolPairs(v).slice().sort((a, b) => a[0] - b[0]);
        if (pairs.length === 0) return false;

        const pairNodes = pairs.map(([sequence1Node, sequence2Node]) => ({
            sequence1: getGraphNucleotideByNumber(graph, sequence1Node),
            sequence2: getGraphNucleotideByNumber(graph, sequence2Node),
        }));
        if (pairNodes.some(pair => !pair.sequence1 || !pair.sequence2)) return false;
        const originalPositions = {};
        graph.nodes.forEach(node => {
            if (
                node &&
                node.nodeType === 'nucleotide' &&
                Number.isFinite(node.x) &&
                Number.isFinite(node.y)
            ) {
                originalPositions[node.num] = { x: node.x, y: node.y };
            }
        });

        const linkDistanceMultiplier = Number(container.options?.linkDistanceMultiplier) || 15;
        const nucleotideSpacing = LINEAR_RRI_LINK_DISTANCE_SCALE * linkDistanceMultiplier;
        const trackGap = LINEAR_RRI_TRACK_GAP_UNITS * linkDistanceMultiplier;
        const scaffoldAxis = getLinearRriScaffoldAxis(pairNodes);
        const scaffoldCenter = pairNodes.reduce((sum, pair) => ({
            x: sum.x + (pair.sequence1.x + pair.sequence2.x) / 2,
            y: sum.y + (pair.sequence1.y + pair.sequence2.y) / 2,
        }), { x: 0, y: 0 });
        scaffoldCenter.x /= pairNodes.length;
        scaffoldCenter.y /= pairNodes.length;

        const layout = getLinearRriInteractionLayout(
            v,
            nucleotideSpacing,
            trackGap,
            scaffoldCenter,
            scaffoldAxis
        );
        if (!layout) return false;

        enforceLinearRriPinnedGeometry(graph, layout);
        seedLinearRriBridgeNodes(graph, layout);
        seedLinearRriTailNodes(graph, layout);
        alignLinearRriStructuralComponents(
            graph,
            v,
            layout,
            originalPositions
        );

        const halfPlaneClearance = 0.75 * nucleotideSpacing;
        prepareLinearRriExternalStructures(graph, v, layout, halfPlaneClearance);
        captureLinearRriStructurePositions(graph, layout);

        const constraints = getLinearRriConstraintSpecs(v);
        constraints.forEach(spec => {
            const source = getGraphNucleotideByNumber(graph, spec.source);
            const target = getGraphNucleotideByNumber(graph, spec.target);
            if (!source || !target) return;
            graph.links.push({
                source,
                target,
                value: spec.distanceUnits,
                linkType: LINEAR_RRI_LINK_TYPE,
                extraLinkType: 'constraint',
            });
        });
        addLinearRriTerminalGhosts(graph, v, layout, nucleotideSpacing);

        if (container.linkStrengths) {
            container.linkStrengths[LINEAR_RRI_LINK_TYPE] = LINEAR_RRI_LINK_STRENGTH;
            container.linkStrengths[LINEAR_RRI_GHOST_LINK_TYPE] = LINEAR_RRI_LINK_STRENGTH;
        }
        const supplementaryDistance =
            LINEAR_RRI_SUPPLEMENTARY_OFFSET_UNITS * linkDistanceMultiplier;
        if (container.force && typeof container.force.on === 'function') {
            const enforceAndSync = () => {
                enforceLinearRriPinnedGeometry(graph, layout);
                enforceLinearRriSupplementaryNodes(
                    graph,
                    v,
                    layout,
                    supplementaryDistance
                );
                syncLinearRriDom(graph);
            };
            container.varriEnforceLinearRriGeometry = enforceAndSync;
            container.force.on('tick.varriLinearRriGeometry', enforceAndSync);
            container.force.on('end.varriLinearRriGeometry', enforceAndSync);
        }
        if (container.force && typeof container.force.start === 'function') {
            container.force.start();
        }

        container.varriLinearRriLayout = layout;
        layout.supplementaryDistance = supplementaryDistance;
        return true;
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
     * Calculate the zoom transform that keeps the interaction focus centred
     * after the SVG-only rail rotation.
     *
     * @param {{x:number,y:number}} focus
     * @param {{x:number,y:number}} rotationCenter
     * @param {number} rotationDegrees
     * @param {number} width
     * @param {number} height
     * @param {number} scale
     * @returns {{scale:number,translate:[number,number],rotatedFocus:{x:number,y:number}}}
     */
    function getLinearRriReadableViewTransform(
        focus,
        rotationCenter,
        rotationDegrees,
        width,
        height,
        scale
    ) {
        const radians = Number(rotationDegrees) * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const relativeX = Number(focus.x) - Number(rotationCenter.x);
        const relativeY = Number(focus.y) - Number(rotationCenter.y);
        const rotatedFocus = {
            x: Number(rotationCenter.x) +
                cosine * relativeX -
                sine * relativeY,
            y: Number(rotationCenter.y) +
                sine * relativeX +
                cosine * relativeY,
        };
        return {
            scale,
            translate: [
                Number(width) / 2 - scale * rotatedFocus.x,
                Number(height) / 2 - scale * rotatedFocus.y,
            ],
            rotatedFocus,
        };
    }

    /**
     * Run Fornac's normal fit, but keep extremely long linear interactions at
     * a readable minimum zoom and centre the RRI rather than the remote tails.
     *
     * @param {Object} container
     * @param {Object} layout
     * @returns {number|null} Applied zoom scale.
     */
    function centerLinearRriView(container, layout) {
        if (
            !container ||
            typeof container.centerView !== 'function' ||
            !container.zoomer ||
            typeof document === 'undefined'
        ) {
            return null;
        }
        container.centerView();
        const fittedScale = Number(container.zoomer.scale());
        if (
            !Number.isFinite(fittedScale) ||
            fittedScale >= LINEAR_RRI_MINIMUM_VIEW_SCALE
        ) {
            return fittedScale;
        }

        const svgSelection = container.options?.svg;
        const svg = svgSelection && typeof svgSelection.node === 'function'
            ? svgSelection.node()
            : null;
        const plot = svg && svg.querySelector('.fornac-plot');
        const rotationLayer = plot &&
            plot.querySelector('[data-varri-rotation-layer="true"]');
        const rotationCenter = rotationLayer && getBBoxCenter(rotationLayer);
        if (!svg || !plot || !rotationCenter || !layout?.center) {
            return fittedScale;
        }

        const transform = getLinearRriReadableViewTransform(
            layout.center,
            rotationCenter,
            layout.rotationDegrees || 0,
            Number(container.options.svgW) || 300,
            Number(container.options.svgH) || 300,
            LINEAR_RRI_MINIMUM_VIEW_SCALE
        );
        const applyMinimumView = () => {
            if (!svg.isConnected) return;
            if (global.d3 && typeof global.d3.select === 'function') {
                const selection = global.d3.select(plot);
                if (typeof selection.interrupt === 'function') selection.interrupt();
            }
            plot.setAttribute(
                'transform',
                `translate(${transform.translate}) scale(${transform.scale})`
            );
            container.zoomer.translate(transform.translate);
            container.zoomer.scale(transform.scale);
            svg.setAttribute('data-varri-minimum-view-scale', 'true');
        };
        applyMinimumView();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                applyMinimumView();
                requestAnimationFrame(applyMinimumView);
            });
        }
        return transform.scale;
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
     * @param {boolean} [options.forceLayout=false]  Enable Fornac force-layout animation.
     * @param {boolean} [options.forceLayoutLinear=false]  Pin intermolecularly paired nucleotides to parallel rails in the initial Fornac orientation, retain intervening structures in their outer half-planes, extend the terminal zipper ends with invisible anchors, and use the SVG rotation layer for final horizontal alignment.
     * @param {boolean} [options.freeTrailingEnds=false]  Remove Fornac's external-loop circularisation constraint (the "closure" scaffold linking the sequence ends) from the force graph, leaving all other loop constraints intact.
     * @param {boolean} [options.pullPseudoknotBasepairs=false]  Set Fornac's pseudoknot link force strength to 10 (default 0), pulling pseudoknot basepairs together in the force layout.
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
            forceLayout = false,
            forceLayoutLinear = false,
            freeTrailingEnds = false,
            pullPseudoknotBasepairs = false,
            accessData = null,
            accessColors = null,
            accessColorMode = null,
        } = options;

        // Build molecules via Fornac
        const container = new fornac.FornaContainer(
            `#${containerId}`,
            { animation: forceLayout, labelInterval: 1 }
        );
        container.addRNA(v.structure, { structure: v.structure, sequence: v.sequence });

        if (forceLayout && freeTrailingEnds) {
            relaxForceGraphScaffold(container, v);
        }

        if (forceLayout && pullPseudoknotBasepairs) {
            applyPseudoknotLinkStrength(container, true);
        }

        if (forceLayout && forceLayoutLinear && v.molecules === '2') {
            applyLinearRriLayout(container, v);
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
            if (
                forceLayout &&
                forceLayoutLinear &&
                typeof container.varriEnforceLinearRriGeometry === 'function'
            ) {
                container.varriEnforceLinearRriGeometry();
            }

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

            let rotationDegrees = 0;
            if (forceLayout && forceLayoutLinear && container.varriLinearRriLayout) {
                rotationDegrees = rotateVisualization(
                    containerId,
                    container.varriLinearRriLayout.rotationDegrees,
                    { mode: 'absolute' }
                );
            }

            // The fixed scaffold may extend beyond Fornac's initial bounds.
            // Refit after the first force ticks and all hidden nodes are removed.
            if (forceLayout && forceLayoutLinear && container.varriLinearRriLayout) {
                centerLinearRriView(container, container.varriLinearRriLayout);
                const supplementaryResolution =
                    resolveLinearRriSupplementaryDomOverlaps(
                        container.graph,
                        v,
                        container.varriLinearRriLayout,
                        container.varriLinearRriLayout.supplementaryDistance
                    );
                container.varriLinearRriLayout.supplementaryResolution =
                    supplementaryResolution;
                if (supplementaryResolution.iterations > 0) {
                    centerLinearRriView(container, container.varriLinearRriLayout);
                }
            }

            // When animation is on, keep the background-highlight polygon in sync
            // with the force-layout by redrawing it on every animation frame.
            if (forceLayout) {
                function highlightSyncLoop() {
                    document.querySelectorAll('[data-varri-region]').forEach(el => el.remove());
                    document.querySelectorAll('[data-varri-subseq]').forEach(el => el.remove());

                    applyRegionHighlights(v);
                    applySubsequenceHighlights(v);

                    _animFrameId = requestAnimationFrame(highlightSyncLoop);
                }
                _animFrameId = requestAnimationFrame(highlightSyncLoop);
            }

            return rotationDegrees;
        }

        return new Promise((resolve, reject) => {
            _pendingRenderResolve = resolve;
            _renderTimeoutId = setTimeout(() => {
                _renderTimeoutId = null;
                _pendingRenderResolve = null;

                try {
                    const rotationDegrees = applyModifications();
                    resolve({ cancelled: false, rotationDegrees });
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

        // Constants
        LINEAR_RRI_LINK_DISTANCE_SCALE,
        LINEAR_RRI_MINIMUM_VIEW_SCALE,
        LINEAR_RRI_TRACK_GAP_UNITS,

        // Core
        normaliseRotationDegrees,
        render,
        rotateVisualization,
        validate,

        // Colors
        getColors,
        setColors,

        // Annotation registries
        clearPointMutations,
        clearRegionHighlights,
        clearSubsequenceHighlights,
        computeBackgroundRegionRanges,
        createPointMutation,
        createRegionHighlight,
        createSubsequenceHighlight,
        getPointMutations,
        getRegionHighlightNodePath,
        getRegionHighlights,
        getSubsequenceHighlights,
        registerGeneratedRegionHighlight,
        registerPointMutation,
        registerRegionHighlight,
        registerSubsequenceHighlight,
        removePointMutation,
        removeRegionHighlight,
        removeSubsequenceHighlight,
        updatePointMutation,
        updateRegionHighlight,
        updateSubsequenceHighlight,

        // Validation and formatting
        checkStructureInputSimple,
        findBasePairs,
        formatSequence,
        formatStructure,
        getIndexDictionary,
        getMolecules,
        getSequenceIndices,
        parseSubsequences,
        splitAtAmpersand,
        validateBackgroundhighlighting,
        validateCroppingInput,
        validateHighlighting,
        validateOffset,
        validateSequenceInput,
        validateStructureInput,

        // Base-pair utilities
        alignLinearRriStructuralComponents,
        addLinearRriTerminalGhosts,
        enforceLinearRriHalfPlanes,
        enforceLinearRriSupplementaryNodes,
        getIntermolBasepairRegion,
        getLinearRriBridgePositions,
        getLinearRriConstraintSpecs,
        getLinearRriInteractionLayout,
        getLinearRriReadableViewTransform,
        getLinearRriScaffoldAxis,
        listBasepairs,
        listIntermolNodes,
        listIntermolPairs,
        sequenceColoring,

        // DOM modifications (advanced use)
        addElement,
        addStyleToNodes,
        applyPointMutations,
        applyRegionHighlights,
        applySubsequenceHighlights,
        backgroundhighlightBasepairs,
        backgroundhighlightRegion,
        changeBackgroundColor,
        closePolygonPoints,
        getPositionOfNode,
        highlightBasepairs,
        highlightRegion,
        highlightSubsequence,
        polyline,
        removeDummyNodes,
        removeSecondLink,
        setAttributeForElements,
        setIndexLabels,
        setLabelsId,
        setLinksId,
        styleBasepairs,
        updateLinkTooltips,
        updateNodeToolTips,
        visualiseAccessibility,

        // Export
        buildSVGString,
        downloadPNG,
        downloadSVG,
    };

    // Export
    global.vaRRI = vaRRI;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = vaRRI;
    }

}(typeof window !== 'undefined' ? window : this));
