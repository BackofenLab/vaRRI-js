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
                throw new Error(`Invalid subsequence range at index ${idx}. Expected [start, end].`);
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
     * Override one or more default rendering colours.
     *
     * Only the keys present in `overrides` are changed; all others retain
     * their current values.  The new colours take effect on the next call to
     * any rendering function.
     *
     * Valid keys: `sequence1`, `sequence2`, `intermolecularHighlight`,
     * `backgroundHighlight`, `subsequenceHighlight`, `basepair`.
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
        if( structure && !structure.match(/[^.&]/)) {
            throw new Error('Cropping is not allowed for structures with only unpaired nucleotides.');
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
    * @param {string|null} [args.highlightSubseq1=null]  Legacy subsequence range for sequence 1 `"start-end"` or null.
    * @param {string|null} [args.highlightSubseq2=null]  Legacy subsequence range for sequence 2 `"start-end"` or null.
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

        // Subsequence highlights (generic framework + legacy compatibility)
        const sequenceContext = {
            '1': { offset: v.offset1, length: v.sequence1.length },
            '2': { offset: v.offset2, length: v.sequence2.length },
        };

        if (Array.isArray(args.subsequenceHighlights)) {
            v.subsequenceHighlights = args.subsequenceHighlights.map(h =>
                createSubsequenceHighlight(h, sequenceContext)
            );
        } else {
            const legacyHighlights = [];
            const parsedSeq1 = parseSubsequences(args.highlightSubseq1, v.offset1, v.sequence1.length);
            const parsedSeq2 = parseSubsequences(args.highlightSubseq2, v.offset2, v.sequence2.length);

            if (parsedSeq1 !== null) {
                legacyHighlights.push(createSubsequenceHighlight({
                    sequence: '1',
                    range: parsedSeq1,
                    color: COLORS.subsequenceHighlight,
                }, sequenceContext));
            }

            if (parsedSeq2 !== null) {
                legacyHighlights.push(createSubsequenceHighlight({
                    sequence: '2',
                    range: parsedSeq2,
                    color: COLORS.subsequenceHighlight,
                }, sequenceContext));
            }

            v.subsequenceHighlights = legacyHighlights;
        }

        // Legacy fields are still exported for callers that rely on them.
        v.highlightSubseq1 = (v.subsequenceHighlights.find(h => h.sequence === '1') || {}).ranges || null;
        v.highlightSubseq2 = (v.subsequenceHighlights.find(h => h.sequence === '2') || {}).ranges || null;

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
     * Draw a polyline connecting a list of Fornac node positions.
     *
     * @param {number[]} indices  Fornac node IDs to connect.
     * @param {string} style  CSS style string for the polyline.
     */
    function polyline(indices, style, extraAttrs = {}) {
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
        document.querySelectorAll('[link_type="basepair"]').forEach(link => {
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
                addElement('circle', { cx: String(x), cy: String(y), r: '7px', style: `fill:${color};opacity:0.3;` });
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
                `stroke:${color};stroke-width:10;opacity:0.3;fill:None;` +
                'stroke-linejoin:miter;stroke-miterlimit:0.1;'
            );
        }
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
            polyline(region, `fill:${COLORS.backgroundHighlight};opacity:0.2;stroke:${COLORS.backgroundHighlight};stroke-width:7`, { 'data-varri-bg': 'true' });
        }
    }

    /**
     * Add background highlighting for the entire intermolecular region.
     *
     * @param {Object} v  Validated parameter dictionary.
     */
    function backgroundhighlightRegion(v) {
        const basepairRegion = getIntermolBasepairRegion(v.structure1, v.structure2);
        const intermolNodes = [];
        for (const [start, end] of basepairRegion) {
            for (let i = start; i <= end; i++) intermolNodes.push(i);
        }
        polyline(intermolNodes, `fill:${COLORS.backgroundHighlight};opacity:0.2`, { 'data-varri-bg': 'true' });
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
     * @param {boolean} [options.legend=false]  Whether to also render the legend.
     * @param {Object.<number,number>|null} [options.accessData=null]  Accessibility data map.
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
                if (v.highlighting === 'region') highlightRegion(v);
                if (v.highlighting === 'basepairs') highlightBasepairs(v);
                if (v.backgroundhighlighting === 'region') backgroundhighlightRegion(v);
                if (v.backgroundhighlighting === 'basepairs') backgroundhighlightBasepairs(v);
            }

            // Basepair styling (colour + optional G-U dashing)
            styleBasepairs(v);

            // Subsequence highlights
            applySubsequenceHighlights(v);

            // Accessibility overlay
            if (accessData) {
                visualiseAccessibility(accessData, v.sequence1.length);
            }

            // When animation is on, keep the background-highlight polygon in sync
            // with the force-layout by redrawing it on every animation frame.
            if (animation && v.molecules === '2' &&
                    (v.backgroundhighlighting === 'basepairs' || v.backgroundhighlighting === 'region')) {
                function bgHighlightLoop() {
                    document.querySelectorAll('[data-varri-bg]').forEach(el => el.remove());
                    if (v.backgroundhighlighting === 'region') backgroundhighlightRegion(v);
                    if (v.backgroundhighlighting === 'basepairs') backgroundhighlightBasepairs(v);
                    _animFrameId = requestAnimationFrame(bgHighlightLoop);
                }
                _animFrameId = requestAnimationFrame(bgHighlightLoop);
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
        applySubsequenceHighlights,
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
    global.vaRRI = vaRRI;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = vaRRI;
    }

}(typeof window !== 'undefined' ? window : this));
