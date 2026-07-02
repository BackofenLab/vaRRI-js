'use strict';

/**
 * Tests for the pure (non-DOM) library functions exported by vaRRI.js.
 *
 * DOM-dependent functions (render, setLinksId, polyline, …) are not tested
 * here because they require a real browser context.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const vaRRI = require('../src/vaRRI.js');
const vaRRISource = fs.readFileSync(path.join(__dirname, '../src/vaRRI.js'), 'utf8');
const indexHTMLSource = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const indexInlineScriptMatch = indexHTMLSource.match(
    /<!-- ====================================================================== -->\s*<!-- Scripts[\s\S]*?-->\s*<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/
);

if (!indexInlineScriptMatch) {
    throw new Error('Could not locate the inline script block in index.html');
}

const indexInlineScript = indexInlineScriptMatch[1];

describe('browser global export', () => {
    test('attaches vaRRI to window even when module.exports is present', () => {
        const sandbox = { window: {}, module: { exports: {} }, console };
        vm.createContext(sandbox);
        vm.runInContext(vaRRISource, sandbox);

        expect(sandbox.window.vaRRI).toBeDefined();
        expect(typeof sandbox.window.vaRRI.getColors).toBe('function');
        expect(sandbox.module.exports).toBe(sandbox.window.vaRRI);
    });
});

// ---------------------------------------------------------------------------
// splitAtAmpersand
// ---------------------------------------------------------------------------

describe('splitAtAmpersand', () => {
    test('splits at the first & character', () => {
        expect(vaRRI.splitAtAmpersand('ABC&DEF')).toEqual(['ABC', 'DEF']);
    });

    test('returns [str, ""] when no & is present', () => {
        expect(vaRRI.splitAtAmpersand('ABCDEF')).toEqual(['ABCDEF', '']);
    });

    test('handles & at the start', () => {
        expect(vaRRI.splitAtAmpersand('&DEF')).toEqual(['', 'DEF']);
    });

    test('only splits at the first & when multiple are present', () => {
        expect(vaRRI.splitAtAmpersand('A&B&C')).toEqual(['A', 'B&C']);
    });
});

// ---------------------------------------------------------------------------
// checkStructureInputSimple
// ---------------------------------------------------------------------------

describe('checkStructureInputSimple', () => {
    test('accepts balanced round brackets', () => {
        expect(() => vaRRI.checkStructureInputSimple('((..))')).not.toThrow();
    });

    test('accepts balanced square brackets', () => {
        expect(() => vaRRI.checkStructureInputSimple('[..[..]..]')).not.toThrow();
    });

    test('accepts dots only', () => {
        expect(() => vaRRI.checkStructureInputSimple('....')).not.toThrow();
    });

    test('accepts mixed bracket types', () => {
        expect(() => vaRRI.checkStructureInputSimple('(.[.])')).not.toThrow();
    });

    test('accepts structure with & separator', () => {
        expect(() => vaRRI.checkStructureInputSimple('((..&..))')).not.toThrow();
    });

    test('throws on too many closing brackets', () => {
        expect(() => vaRRI.checkStructureInputSimple('(..))')).toThrow(/Too many closing/);
    });

    test('throws on too many opening brackets', () => {
        expect(() => vaRRI.checkStructureInputSimple('((..)')).toThrow(/Too many opening/);
    });
});

// ---------------------------------------------------------------------------
// findBasePairs
// ---------------------------------------------------------------------------

describe('findBasePairs', () => {
    test('returns empty array for structure without basepairs', () => {
        expect(vaRRI.findBasePairs('....')).toEqual([]);
    });

    test('finds a single basepair', () => {
        expect(vaRRI.findBasePairs('(.)')).toEqual([[0, 2]]);
    });

    test('finds nested basepairs (inner pair listed before outer)', () => {
        // Inner pair [1,4] is pushed first, then outer [0,5]
        expect(vaRRI.findBasePairs('((..))')).toEqual([[1, 4], [0, 5]]);
    });

    test('finds basepairs with square brackets', () => {
        expect(vaRRI.findBasePairs('[..]')).toEqual([[0, 3]]);
    });

    test('ignores unmatched closing bracket', () => {
        // ')' at position 0 has no opener; findBasePairs silently skips it
        expect(vaRRI.findBasePairs(')(.)')).toEqual([[1, 3]]);
    });
});

// ---------------------------------------------------------------------------
// validateSequenceInput
// ---------------------------------------------------------------------------

describe('validateSequenceInput', () => {
    test('accepts a valid RNA sequence', () => {
        expect(vaRRI.validateSequenceInput('ACGU')).toBe('ACGU');
    });

    test('accepts lower-case IUPAC characters', () => {
        expect(vaRRI.validateSequenceInput('acgu')).toBe('acgu');
    });

    test('accepts a two-molecule sequence separated by &', () => {
        expect(vaRRI.validateSequenceInput('ACGU&CGUC')).toBe('ACGU&CGUC');
    });

    test('accepts all IUPAC ambiguity codes', () => {
        expect(() => vaRRI.validateSequenceInput('ACGTURYMSKWBDHVN')).not.toThrow();
    });

    test('throws on empty sequence', () => {
        expect(() => vaRRI.validateSequenceInput('')).toThrow('No sequence given');
    });

    test('throws on invalid characters', () => {
        expect(() => vaRRI.validateSequenceInput('ACGUZ')).toThrow(/invalid characters/);
    });
});

// ---------------------------------------------------------------------------
// validateStructureInput
// ---------------------------------------------------------------------------

describe('validateStructureInput', () => {
    test('accepts a valid single-molecule structure', () => {
        expect(vaRRI.validateStructureInput('((..))', 'ACGCGU')).toBe('((..))');;
    });

    test('accepts a valid two-molecule structure', () => {
        expect(vaRRI.validateStructureInput('((..&..))', 'ACGU&CGUC')).toBe('((..&..))');
    });

    test('throws on empty structure', () => {
        expect(() => vaRRI.validateStructureInput('', 'ACGU')).toThrow('No structure given');
    });

    test('throws when structure and sequence lengths differ (single mol)', () => {
        expect(() => vaRRI.validateStructureInput('((..)', 'ACG')).toThrow(/do not match/);
    });

    test('throws when first molecule lengths differ (two mol)', () => {
        expect(() => vaRRI.validateStructureInput('(..&..)', 'ACGU&CG')).toThrow(/molecule 1/);
    });

    test('throws when second molecule lengths differ (two mol)', () => {
        expect(() => vaRRI.validateStructureInput('(..&....)', 'ACG&CGU')).toThrow(/molecule 2/);
    });

    test('throws on unbalanced brackets', () => {
        expect(() => vaRRI.validateStructureInput('((..)', 'ACGCG')).toThrow(/brackets/);
    });
});

// ---------------------------------------------------------------------------
// validateOffset
// ---------------------------------------------------------------------------

describe('validateOffset', () => {
    test('returns 1 for "1"', () => {
        expect(vaRRI.validateOffset('1')).toBe(1);
    });

    test('returns negative integers', () => {
        expect(vaRRI.validateOffset('-5')).toBe(-5);
    });

    test('returns large positive integers', () => {
        expect(vaRRI.validateOffset('100')).toBe(100);
    });

    test('throws for "0"', () => {
        expect(() => vaRRI.validateOffset('0')).toThrow('Index 0 is not valid');
    });

    test('throws for non-numeric input', () => {
        expect(() => vaRRI.validateOffset('abc')).toThrow(/not valid/);
    });

    test('throws for decimal input', () => {
        expect(() => vaRRI.validateOffset('1.5')).toThrow(/not valid/);
    });
});

// ---------------------------------------------------------------------------
// validateHighlighting
// ---------------------------------------------------------------------------

describe('validateHighlighting', () => {
    test.each(['nothing', 'basepairs', 'region'])('accepts "%s"', (v) => {
        expect(vaRRI.validateHighlighting(v)).toBe(v);
    });

    test('throws on unknown value', () => {
        expect(() => vaRRI.validateHighlighting('bold')).toThrow(/not accepted/);
    });
});

// ---------------------------------------------------------------------------
// validateBackgroundhighlighting
// ---------------------------------------------------------------------------

describe('validateBackgroundhighlighting', () => {
    test.each(['nothing', 'basepairs', 'region'])('accepts "%s"', (v) => {
        expect(vaRRI.validateBackgroundhighlighting(v)).toBe(v);
    });

    test('throws on unknown value', () => {
        expect(() => vaRRI.validateBackgroundhighlighting('outline')).toThrow(/not accepted/);
    });
});

// ---------------------------------------------------------------------------
// formatStructure
// ---------------------------------------------------------------------------

describe('formatStructure', () => {
    test('handles single-molecule structure', () => {
        const result = vaRRI.formatStructure('((..))');;
        expect(result.structure1).toBe('((..))');;
        expect(result.structure2).toBe('');
        expect(result.structure).toBe('((..))');;
    });

    test('inserts Fornac gap dots for two-molecule structure', () => {
        const result = vaRRI.formatStructure('((..&..))');
        expect(result.structure1).toBe("((..");
        expect(result.structure2).toBe("..))");
        expect(result.structure).toBe('((..&.....))');    });

    test('structure_dict maps 1-based positions for two-molecule structure', () => {
        const result = vaRRI.formatStructure('((..&..))');
        // bareStructure = '((..' + '...' + '..))'  = '((.......))' (10 chars)
        expect(result.structure_dict['1']).toBe('(');
        expect(result.structure_dict['2']).toBe('(');
        expect(result.structure_dict['10']).toBe(')');
    });
});

// ---------------------------------------------------------------------------
// formatSequence
// ---------------------------------------------------------------------------

describe('formatSequence', () => {
    test('handles single-molecule sequence', () => {
        const result = vaRRI.formatSequence('ACGU');
        expect(result.sequence1).toBe('ACGU');
        expect(result.sequence2).toBe('');
        expect(result.sequence).toBe('ACGU');
    });

    test('inserts Fornac gap dots for two-molecule sequence', () => {
        const result = vaRRI.formatSequence('ACGU&CGUC');
        expect(result.sequence1).toBe('ACGU');
        expect(result.sequence2).toBe('CGUC');
        expect(result.sequence).toBe('ACGU&...CGUC');
    });

    test('sequence_dict maps 1-based positions including gap dots', () => {
        const result = vaRRI.formatSequence('ACGU&CGUC');
        // bareSequence = 'ACGU' + '...' + 'CGUC'  = 'ACGU...CGUC' (11 chars)
        expect(result.sequence_dict['1']).toBe('A');
        expect(result.sequence_dict['4']).toBe('U');
        expect(result.sequence_dict['5']).toBe('.');
        expect(result.sequence_dict['8']).toBe('C');
    });
});

// ---------------------------------------------------------------------------
// getMolecules
// ---------------------------------------------------------------------------

describe('getMolecules', () => {
    test('returns "2" when sequence2 is non-empty', () => {
        expect(vaRRI.getMolecules({ sequence2: 'ACG' })).toBe('2');
    });

    test('returns "1" when sequence2 is empty', () => {
        expect(vaRRI.getMolecules({ sequence2: '' })).toBe('1');
    });
});

// ---------------------------------------------------------------------------
// getSequenceIndices
// ---------------------------------------------------------------------------

describe('getSequenceIndices', () => {
    test('generates consecutive indices starting at positive offset', () => {
        expect(vaRRI.getSequenceIndices('s1', 1, 3)).toEqual([
            ['s1', 1], ['s1', 2], ['s1', 3],
        ]);
    });

    test('skips 0 and extends the last index when range crosses zero', () => {
        // offset=-1, length=3 → would give -1,0,1 → skips 0 → yields -1,1,2
        expect(vaRRI.getSequenceIndices('s1', -1, 3)).toEqual([
            ['s1', -1], ['s1', 1], ['s1', 2],
        ]);
    });

    test('labels indices with the given sequence id', () => {
        const result = vaRRI.getSequenceIndices('s2', 5, 2);
        expect(result.every(([id]) => id === 's2')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getIndexDictionary
// ---------------------------------------------------------------------------

describe('getIndexDictionary', () => {
    test('builds a 1-based dictionary with gap entries between molecules', () => {
        const v = { offset1: 1, offset2: 1, sequence1: 'ACG', sequence2: 'GC' };
        const dict = vaRRI.getIndexDictionary(v);
        // s1: keys 1-3, gap: 4-6, s2: 7-8
        expect(dict[1]).toEqual(['s1', 1]);
        expect(dict[3]).toEqual(['s1', 3]);
        expect(dict[4]).toEqual(['e', 0]);
        expect(dict[6]).toEqual(['e', 0]);
        expect(dict[7]).toEqual(['s2', 1]);
        expect(dict[8]).toEqual(['s2', 2]);
    });

    test('total length equals seq1 + GAP(3) + seq2', () => {
        const v = { offset1: 1, offset2: 1, sequence1: 'ACGU', sequence2: 'GCU' };
        const dict = vaRRI.getIndexDictionary(v);
        expect(Object.keys(dict).length).toBe(4 + 3 + 3);
    });
});

// ---------------------------------------------------------------------------
// parseSubsequences
// ---------------------------------------------------------------------------

describe('parseSubsequences', () => {
    test('returns null for null input', () => {
        expect(vaRRI.parseSubsequences(null)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(vaRRI.parseSubsequences('')).toBeNull();
    });

    test('parses a single range', () => {
        expect(vaRRI.parseSubsequences('3-8')).toEqual([[3, 8]]);
    });

    test('parses multiple comma-separated ranges', () => {
        expect(vaRRI.parseSubsequences('3-8,15-20')).toEqual([[3, 8], [15, 20]]);
    });

    test('throws on malformed range (not two parts)', () => {
        expect(() => vaRRI.parseSubsequences('3-8-9')).toThrow(/Invalid subsequence range/);
    });

    test('throws on non-numeric range', () => {
        expect(() => vaRRI.parseSubsequences('a-b')).toThrow(/Invalid subsequence range/);
    });
});

// ---------------------------------------------------------------------------
// listIntermolNodes
// ---------------------------------------------------------------------------

describe('listIntermolNodes', () => {
    test('returns empty array for structure with no intermolecular basepairs', () => {
        expect(vaRRI.listIntermolNodes('((..))')).toEqual([]);
    });

    test('returns empty array for dots-only structure', () => {
        expect(vaRRI.listIntermolNodes('....')).toEqual([]);
    });

    test('identifies unmatched opening brackets as intermolecular', () => {
        // '((..' has two unmatched opens at positions 1 and 2
        expect(vaRRI.listIntermolNodes('((..')).toEqual([[1, '('], [2, '(']]);
    });

    test('identifies unmatched closing brackets as intermolecular', () => {
        // '..)' has one unmatched close at position 3
        expect(vaRRI.listIntermolNodes('..)')).toEqual([[3, ')']]);
    });

    test('applies a shift to all returned positions', () => {
        expect(vaRRI.listIntermolNodes('..)', 10)).toEqual([[13, ')']]);
    });

    test('returns sorted results by position', () => {
        const result = vaRRI.listIntermolNodes('((..');
        const positions = result.map(([pos]) => pos);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
});

// ---------------------------------------------------------------------------
// listBasepairs
// ---------------------------------------------------------------------------

describe('listBasepairs', () => {
    test('returns empty array for all-dot structure', () => {
        const struc = { 1: '.', 2: '.', 3: '.' };
        expect(vaRRI.listBasepairs(struc)).toEqual([]);
    });

    test('finds a single basepair', () => {
        const struc = { 1: '(', 2: '.', 3: '.', 4: ')' };
        expect(vaRRI.listBasepairs(struc)).toEqual([[1, 4]]);
    });

    test('returns basepairs sorted by opening position', () => {
        const struc = { 1: '(', 2: '(', 3: ')', 4: ')' };
        const result = vaRRI.listBasepairs(struc);
        const openPositions = result.map(([o]) => o);
        expect(openPositions).toEqual([...openPositions].sort((a, b) => a - b));
    });
});

// ---------------------------------------------------------------------------
// getIntermolBasepairRegion
// ---------------------------------------------------------------------------

describe('getIntermolBasepairRegion', () => {
    test('returns empty array when there are no intermolecular basepairs', () => {
        // Both structures fully self-paired
        expect(vaRRI.getIntermolBasepairRegion('((..))', '((..))')).toEqual([]);
    });

    test('returns empty array when one structure has no intermolecular nodes', () => {
        expect(vaRRI.getIntermolBasepairRegion('....', '((...))')).toEqual([]);
    });

    test('returns the [first,last] range for each molecule', () => {
        // structure1 = '((..' → unmatched opens at 1,2
        // structure2 = '..))'  with shift = len('((..') + 3 = 7
        //              unmatched closes at 3,4 → positions 10,11
        const result = vaRRI.getIntermolBasepairRegion('((..',  '..))');;
        expect(result).toEqual([[1, 2], [10, 11]]);
    });

    test('returns single-element range when only one intermolecular node per molecule', () => {
        // structure1 = '(..' → unmatched open at 1
        // structure2 = '..)'  with shift = 3+3 = 6 → unmatched close at pos 3 → 9
        const result = vaRRI.getIntermolBasepairRegion('(..', '..)');
        expect(result).toEqual([[1, 1], [9, 9]]);
    });
});

// ---------------------------------------------------------------------------
// sequenceColoring
// ---------------------------------------------------------------------------

describe('sequenceColoring', () => {
    test('maps all nucleotides in seq1 to lightblue', () => {
        const colors = vaRRI.sequenceColoring('ACG', '');
        expect(colors).toEqual(['lightblue', 'lightblue', 'lightblue']);
    });

    test('maps all nucleotides in seq2 to #F4BB44', () => {
        const colors = vaRRI.sequenceColoring('', 'GU');
        expect(colors).toEqual(['#F4BB44', '#F4BB44']);
    });

    test('concatenates seq1 colors then seq2 colors', () => {
        const colors = vaRRI.sequenceColoring('AC', 'GU');
        expect(colors).toEqual(['lightblue', 'lightblue', '#F4BB44', '#F4BB44']);
    });

    test('returns empty array for two empty sequences', () => {
        expect(vaRRI.sequenceColoring('', '')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// validate  (integration)
// ---------------------------------------------------------------------------

describe('validate', () => {
    const base2mol = {
        structure: '((..&..))',
        sequence: 'ACGU&CGUC',
        startIndex1: '1',
        startIndex2: '1',
        labelInterval: '10',
        coloring: 'strand',
        highlighting: 'region',
        backgroundhighlighting: 'basepairs',
        guBasepairs: true,
    };

    test('produces correct molecules count for two-molecule input', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.molecules).toBe('2');
    });

    test('splits sequences correctly for two-molecule input', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.sequence1).toBe('ACGU');
        expect(v.sequence2).toBe('CGUC');
    });

    test('splits structures correctly for two-molecule input', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.structure1).toBe("((..");
        expect(v.structure2).toBe("..))");
    });

    test('stores parsed offsets', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.offset1).toBe(1);
        expect(v.offset2).toBe(1);
    });

    test('produces correct molecules count for single-molecule input', () => {
        const v = vaRRI.validate({
            structure: '((..))',
            sequence: 'ACGCGU',
            startIndex1: '1',
            startIndex2: '1',
        });
        expect(v.molecules).toBe('1');
    });

    test('null highlightSubseq when not provided', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.highlightSubseq1).toBeNull();
        expect(v.highlightSubseq2).toBeNull();
    });

    test('parses highlightSubseq ranges', () => {
        const v = vaRRI.validate({ ...base2mol, highlightSubseq1: '2-4' });
        expect(v.highlightSubseq1).toEqual([[2, 4]]);
    });

    test('throws on empty sequence', () => {
        expect(() => vaRRI.validate({ ...base2mol, sequence: '' })).toThrow();
    });

    test('throws on empty structure', () => {
        expect(() => vaRRI.validate({ ...base2mol, structure: '' })).toThrow();
    });

    test('throws on structure/sequence length mismatch', () => {
        expect(() => vaRRI.validate({ ...base2mol, sequence: 'ACG&CGUC' })).toThrow();
    });

    test('throws on invalid offset (0)', () => {
        expect(() => vaRRI.validate({ ...base2mol, startIndex1: '0' })).toThrow();
    });

    test('throws on invalid highlighting value', () => {
        expect(() => vaRRI.validate({ ...base2mol, highlighting: 'bright' })).toThrow();
    });
});

// ---------------------------------------------------------------------------
// setColors / getColors
// ---------------------------------------------------------------------------

describe('getColors', () => {
    test('returns an object with all six colour keys', () => {
        const colors = vaRRI.getColors();
        expect(colors).toHaveProperty('sequence1');
        expect(colors).toHaveProperty('sequence2');
        expect(colors).toHaveProperty('intermolecularHighlight');
        expect(colors).toHaveProperty('backgroundHighlight');
        expect(colors).toHaveProperty('subsequenceHighlight');
        expect(colors).toHaveProperty('basepair');
    });

    test('returns default sequence1 as lightblue', () => {
        expect(vaRRI.getColors().sequence1).toBe('lightblue');
    });

    test('returns default sequence2 as #F4BB44', () => {
        expect(vaRRI.getColors().sequence2).toBe('#F4BB44');
    });

    test('returns default basepair as red', () => {
        expect(vaRRI.getColors().basepair).toBe('red');
    });

    test('returns a copy (mutations do not affect the internal state)', () => {
        const colors = vaRRI.getColors();
        colors.sequence1 = 'black';
        expect(vaRRI.getColors().sequence1).toBe('lightblue');
    });
});

describe('setColors', () => {
    // Capture defaults so each test can restore them.
    let defaults;
    beforeAll(() => { defaults = vaRRI.getColors(); });
    afterEach(() => vaRRI.setColors(defaults));

    test('overrides a single colour key', () => {
        vaRRI.setColors({ sequence1: 'blue' });
        expect(vaRRI.getColors().sequence1).toBe('blue');
    });

    test('leaves other keys unchanged when only one key is overridden', () => {
        vaRRI.setColors({ sequence1: 'blue' });
        const colors = vaRRI.getColors();
        expect(colors.sequence2).toBe('#F4BB44');
        expect(colors.intermolecularHighlight).toBe('red');
        expect(colors.backgroundHighlight).toBe('red');
        expect(colors.subsequenceHighlight).toBe('purple');
        expect(colors.basepair).toBe('red');
    });

    test('overrides multiple colour keys at once', () => {
        vaRRI.setColors({ sequence1: '#aabbcc', sequence2: '#ddeeff' });
        const colors = vaRRI.getColors();
        expect(colors.sequence1).toBe('#aabbcc');
        expect(colors.sequence2).toBe('#ddeeff');
    });

    test('overrides basepair colour key', () => {
        vaRRI.setColors({ basepair: '#123456' });
        expect(vaRRI.getColors().basepair).toBe('#123456');
    });

    test('sequenceColoring reflects updated colours after setColors', () => {
        vaRRI.setColors({ sequence1: '#111111', sequence2: '#222222' });
        const result = vaRRI.sequenceColoring('AC', 'GU');
        expect(result).toEqual(['#111111', '#111111', '#222222', '#222222']);
    });

    test('restores colours after reset', () => {
        vaRRI.setColors({ sequence1: 'blue' });
        vaRRI.setColors(defaults);
        expect(vaRRI.getColors().sequence1).toBe('lightblue');
    });
});

describe('normaliseRotationDegrees', () => {
    test('keeps angles already in range', () => {
        expect(vaRRI.normaliseRotationDegrees(90)).toBe(90);
        expect(vaRRI.normaliseRotationDegrees(-180)).toBe(-180);
        expect(vaRRI.normaliseRotationDegrees(180)).toBe(180);
    });

    test('wraps angles outside [-180, 180]', () => {
        expect(vaRRI.normaliseRotationDegrees(270)).toBe(-90);
        expect(vaRRI.normaliseRotationDegrees(-270)).toBe(90);
        expect(vaRRI.normaliseRotationDegrees(360)).toBe(0);
    });

    test('throws on non-finite values', () => {
        expect(() => vaRRI.normaliseRotationDegrees(NaN)).toThrow(/finite number/);
    });
});

function createIndexHtmlSandbox() {
    const fieldsWithWrap = new Set([
        'structure',
        'sequence',
        'startIndex1',
        'startIndex2',
        'highlightSubseq1',
        'highlightSubseq2',
    ]);

    function makeWrap() {
        const tooltip = { textContent: '' };
        return {
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
            },
            querySelector: jest.fn(() => tooltip),
        };
    }

    function makeElement(id, { value = '', checked = false, tagName = 'INPUT', type = 'text' } = {}) {
        const wrap = fieldsWithWrap.has(id) ? makeWrap() : null;
        return {
            id,
            value,
            checked,
            tagName,
            type,
            innerHTML: '',
            className: '',
            textContent: '',
            style: {},
            listeners: {},
            addEventListener(eventName, handler) {
                if (!this.listeners[eventName]) {
                    this.listeners[eventName] = [];
                }
                this.listeners[eventName].push(handler);
            },
            trigger(eventName, event = {}) {
                (this.listeners[eventName] || []).forEach(handler => handler(event));
            },
            closest(selector) {
                return selector === '.input-wrap' ? wrap : null;
            },
            querySelector: jest.fn(() => null),
        };
    }

    const elements = {
        structure: makeElement('structure', { tagName: 'TEXTAREA' }),
        sequence: makeElement('sequence', { tagName: 'TEXTAREA' }),
        startIndex1: makeElement('startIndex1', { value: '1', type: 'number' }),
        startIndex2: makeElement('startIndex2', { value: '1', type: 'number' }),
        labelInterval: makeElement('labelInterval', { value: '10', type: 'number' }),
        coloring: makeElement('coloring', { value: 'strand', tagName: 'SELECT' }),
        highlighting: makeElement('highlighting', { value: 'region', tagName: 'SELECT' }),
        backgroundhighlighting: makeElement('backgroundhighlighting', { value: 'basepairs', tagName: 'SELECT' }),
        guBasepairs: makeElement('guBasepairs', { checked: true, type: 'checkbox' }),
        highlightSubseq1: makeElement('highlightSubseq1'),
        highlightSubseq2: makeElement('highlightSubseq2'),
        animation: makeElement('animation', { type: 'checkbox' }),
        'color-seq1': makeElement('color-seq1', { value: '#000000', type: 'color' }),
        'color-seq2': makeElement('color-seq2', { value: '#000000', type: 'color' }),
        'color-intermol': makeElement('color-intermol', { value: '#000000', type: 'color' }),
        'color-bg': makeElement('color-bg', { value: '#000000', type: 'color' }),
        'color-subseq': makeElement('color-subseq', { value: '#000000', type: 'color' }),
        'color-basepair': makeElement('color-basepair', { value: '#000000', type: 'color' }),
        'rotation-slider': makeElement('rotation-slider', { value: '0', type: 'range' }),
        rna_ss: makeElement('rna_ss', { tagName: 'DIV' }),
        msg: makeElement('msg', { tagName: 'DIV' }),
    };

    const loadHandlers = [];
    let nextTimerId = 1;
    const timers = new Map();
    const scheduledDelays = [];
    const vaRRIStub = {
        getColors: jest.fn(() => ({
            sequence1: '#000000',
            sequence2: '#000000',
            intermolecularHighlight: '#000000',
            backgroundHighlight: '#000000',
            subsequenceHighlight: '#000000',
            basepair: '#000000',
        })),
        setColors: jest.fn(),
        validateSequenceInput: jest.fn(v => v),
        validateStructureInput: jest.fn(v => v),
        validateOffset: jest.fn(v => Number(v)),
        parseSubsequences: jest.fn(() => null),
        validate: jest.fn(args => args),
        render: jest.fn(() => Promise.resolve({ cancelled: false })),
        rotateVisualization: jest.fn(),
        normaliseRotationDegrees: jest.fn(v => v),
        downloadSVG: jest.fn(),
        downloadPNG: jest.fn(),
    };

    const sandbox = {
        console,
        document: {
            getElementById: jest.fn(id => elements[id] || null),
            querySelectorAll: jest.fn(() => []),
            createElement: jest.fn(tag => {
                if (tag !== 'canvas') {
                    throw new Error(`Unexpected element creation: ${tag}`);
                }

                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        fillStyle: '',
                        fillRect: () => {},
                        getImageData: () => ({ data: [0, 0, 0, 255] }),
                    }),
                };
            }),
        },
        window: {
            addEventListener: jest.fn((eventName, handler) => {
                if (eventName === 'load') {
                    loadHandlers.push(handler);
                }
            }),
        },
        setTimeout: jest.fn((handler, delay) => {
            const id = nextTimerId++;
            scheduledDelays.push(delay);
            timers.set(id, handler);
            return id;
        }),
        clearTimeout: jest.fn((id) => {
            timers.delete(id);
        }),
        vaRRI: vaRRIStub,
    };

    vm.createContext(sandbox);
    vm.runInContext(indexInlineScript, sandbox);

    function runPendingTimers() {
        const pending = Array.from(timers.entries());
        timers.clear();
        pending.forEach(([, handler]) => handler());
    }

    return { elements, loadHandlers, runPendingTimers, scheduledDelays, vaRRIStub };
}

describe('index.html auto visualization UI', () => {
    test('removes the manual visualization button', () => {
        expect(indexHTMLSource).not.toContain('▶ Visualise');
        expect(indexHTMLSource).not.toContain('onclick="runVisualization()"');
    });

    test('registers commit-based listeners for typed fields and change listeners for toggles', () => {
        const { elements, loadHandlers } = createIndexHtmlSandbox();
        const committedFields = ['structure', 'sequence', 'startIndex1', 'startIndex2', 'labelInterval', 'highlightSubseq1', 'highlightSubseq2'];
        const enterCommittedFields = ['startIndex1', 'startIndex2', 'labelInterval', 'highlightSubseq1', 'highlightSubseq2'];
        const immediateFields = ['coloring', 'highlighting', 'backgroundhighlighting', 'guBasepairs', 'animation'];

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();

        committedFields.forEach(id => {
            expect(elements[id].listeners.input).toHaveLength(1);
            expect(elements[id].listeners.change).toHaveLength(1);
        });

        enterCommittedFields.forEach(id => {
            expect(elements[id].listeners.keydown).toHaveLength(1);
        });

        expect(elements.structure.listeners.keydown).toBeUndefined();
        expect(elements.sequence.listeners.keydown).toBeUndefined();

        immediateFields.forEach(id => {
            expect(elements[id].listeners.change).toHaveLength(1);
        });
    });

    test('does not rerender while typing into committed fields', () => {
        const { elements, loadHandlers, runPendingTimers, vaRRIStub } = createIndexHtmlSandbox();

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();
        vaRRIStub.validate.mockClear();
        vaRRIStub.render.mockClear();

        elements.structure.trigger('input');
        elements.startIndex1.trigger('input');
        runPendingTimers();

        expect(vaRRIStub.validate).not.toHaveBeenCalled();
        expect(vaRRIStub.render).not.toHaveBeenCalled();
    });

    test('rerenders on committed edits and keeps the container hidden until rendering finishes', async () => {
        const { elements, loadHandlers, vaRRIStub } = createIndexHtmlSandbox();
        const renderResult = {};
        let resolveRender;

        vaRRIStub.render.mockImplementation(() => new Promise(resolve => {
            resolveRender = resolve;
        }));

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();
        vaRRIStub.validate.mockClear();
        vaRRIStub.render.mockClear();

        elements.startIndex1.trigger('keydown', { key: 'Enter' });

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(1);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(1);
        expect(elements.rna_ss.style.visibility).toBe('hidden');

        resolveRender(renderResult);
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));

        expect(elements.rna_ss.style.visibility).toBe('');
        expect(elements.msg.textContent).toBe('Visualisation ready. Use the export buttons to save.');

        elements.startIndex1.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(1);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(1);

        elements.structure.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(2);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(2);

        elements.coloring.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(3);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(3);
    });
});
