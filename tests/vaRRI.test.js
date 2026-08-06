/**
 * @jest-environment node
 */

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
const indexScriptSource = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

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

function createIndexSandbox(options = {}) {
    const formElements = options.formElements || [];
    const document = {
        getElementById: () => ({
            value: '',
            checked: false,
            type: '',
            dispatchEvent() {},
            closest: () => null,
            querySelector: () => null,
        }),
        querySelectorAll: selector => selector === 'input, textarea, select' ? formElements : [],
    };
    const navigator = options.clipboardWrite
        ? { clipboard: { writeText: options.clipboardWrite } }
        : {};
    const window = {
        location: {
            protocol: 'https:',
            origin: 'https://example.test',
            pathname: '/index.html',
            search: '',
            href: 'https://example.test/index.html',
        },
        addEventListener: () => {},
        document,
        navigator,
        console,
        URLSearchParams,
        setTimeout,
        clearTimeout,
    };
    const sandbox = {
        window,
        document,
        navigator,
        console,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        module: { exports: {} },
    };

    window.window = window;
    sandbox.vaRRI = { ...vaRRI, ...(options.vaRRIOverrides || {}) };
    window.vaRRI = sandbox.vaRRI;

    vm.createContext(sandbox);
    vm.runInContext(vaRRISource, sandbox);
    vm.runInContext(indexScriptSource, sandbox);

    sandbox.getHighlightSequenceContext = () => ({
        '1': { offset: 1, length: 4 },
        '2': { offset: 1, length: 4 },
    });
    sandbox.getDefaultSubsequenceHighlightColor = () => '#ff0000';
    sandbox.getDefaultRegionHighlightColor = () => '#ff0000';
    sandbox.getDefaultMutationColor = () => '#ff0000';

    return sandbox;
}

describe('region input helpers', () => {
    test('normalizes region range strings by removing whitespace', () => {
        const sandbox = createIndexSandbox();

        expect(sandbox.normalizeRegionInput(' 2 - 4 ')).toBe('2-4');
        expect(sandbox.normalizeRegionInput('')).toBe('');
    });
});

describe('region highlight URL helpers', () => {
    test('serializes and loads region highlights through the browser script helpers', () => {
        let clipboardText = '';
        const registeredRegionHighlights = [];
        const stubbedRegionHighlights = [{
            id: 1,
            sequence1Range: [2, 4],
            sequence2Range: [5, 7],
            color: '#123456',
            rangeText: '2-4&5-7',
            generated: false,
        }];
        const sandbox = createIndexSandbox({
            clipboardWrite: async value => { clipboardText = value; },
            vaRRIOverrides: {
                getPointMutations: () => [],
                getSubsequenceHighlights: () => [],
                getRegionHighlights: () => stubbedRegionHighlights,
                registerRegionHighlight: input => {
                    registeredRegionHighlights.push(input);
                    return { id: 1, ...input };
                },
                validate: () => ({ offset1: 1, offset2: 1, sequence1: 'ACGU', sequence2: 'ACGU' }),
            },
        });

        sandbox.generateShareableURL();
        expect(clipboardText).toContain('regionHighlights=');

        const shareUrl = new URL(clipboardText);
        sandbox.loadUrlRegionHighlightsToVaRRI('regionHighlights', shareUrl.searchParams);

        expect(registeredRegionHighlights).toHaveLength(1);
        expect(registeredRegionHighlights[0]).toMatchObject({
            sequence1Range: [2, 4],
            sequence2Range: [5, 7],
            color: '#123456',
        });
    });

    test('does not serialize generated region highlights into the share URL', () => {
        let clipboardText = '';
        const stubbedRegionHighlights = [
            { id: 1, sequence1Range: [2, 4], sequence2Range: [5, 7], color: '#123456', rangeText: '2-4&5-7', generated: false },
            { id: 2, sequence1Range: [8, 9], sequence2Range: [10, 11], color: '#654321', rangeText: '8-9&10-11', generated: true },
        ];
        const sandbox = createIndexSandbox({
            clipboardWrite: async value => { clipboardText = value; },
            vaRRIOverrides: {
                getPointMutations: () => [],
                getSubsequenceHighlights: () => [],
                getRegionHighlights: () => stubbedRegionHighlights,
            },
        });

        sandbox.generateShareableURL();

        const shareUrl = new URL(clipboardText);
        expect(shareUrl.searchParams.get('regionHighlights')).toBe('2-4&5-7:123456');
        expect(shareUrl.searchParams.get('regionHighlights')).not.toContain('8-9&10-11');
    });

    test('uses URLSearchParams encoding for parentheses', () => {
        let clipboardText = '';
        const sandbox = createIndexSandbox({
            clipboardWrite: async value => { clipboardText = value; },
            formElements: [{ id: 'structure', type: 'textarea', value: '((..))' }],
            vaRRIOverrides: {
                getPointMutations: () => [],
                getSubsequenceHighlights: () => [],
                getRegionHighlights: () => [],
            },
        });

        sandbox.generateShareableURL();

        expect(clipboardText).toContain('structure=%28%28..%29%29');
    });

    test('rejects malformed URL alpha values', () => {
        const registeredHighlights = [];
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const sandbox = createIndexSandbox({
            vaRRIOverrides: {
                registerSubsequenceHighlight: input => registeredHighlights.push(input),
            },
        });

        sandbox.loadUrlSubsequenceHighlightsToVaRRI(
            'subseqHighlights',
            new URLSearchParams('subseqHighlights=1:2-3:ff0000:0x5')
        );

        expect(registeredHighlights).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid subsequence highlight format'));
        warnSpy.mockRestore();
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

    test('parses negative index ranges', () => {
        expect(vaRRI.parseSubsequences('-3--1')).toEqual([[-3, -1]]);
    });

    test('validates range endpoints against sequence indices when context is provided', () => {
        // offset=-2, length=4 => valid indices: -2, -1, 1, 2
        expect(vaRRI.parseSubsequences('-2-2', -2, 4)).toEqual([[-2, 2]]);
        expect(() => vaRRI.parseSubsequences('-2-3', -2, 4)).toThrow(/valid sequence indices/);
    });

    test('rejects index 0 in a range', () => {
        expect(() => vaRRI.parseSubsequences('0-2')).toThrow(/Index 0 is not valid/);
    });

    test('throws on malformed range (not two parts)', () => {
        expect(() => vaRRI.parseSubsequences('3-8-9')).toThrow(/Invalid subsequence range/);
    });

    test('throws on non-numeric range', () => {
        expect(() => vaRRI.parseSubsequences('a-b')).toThrow(/Invalid subsequence range/);
    });
});

describe('subsequence highlight registry', () => {
    beforeEach(() => {
        vaRRI.clearSubsequenceHighlights();
    });

    test('creates a normalized highlight object from string input', () => {
        const highlight = vaRRI.createSubsequenceHighlight({
            sequence: 1,
            range: '3-8',
            color: '#123456',
        });

        expect(highlight.sequence).toBe('1');
        expect(highlight.range).toEqual([[3, 8]]);
        expect(highlight.rangeText).toBe('3-8');
        expect(highlight.color).toBe('#123456');
        expect(highlight.alpha).toBe(0.3);  // should be default alpha value
    });

    test('registers, updates and removes highlights by id', () => {
        const added = vaRRI.registerSubsequenceHighlight({
            sequence: '1',
            range: '2-4',
            color: '#abcdef',
        });

        expect(added.id).toBe(1);
        expect(vaRRI.getSubsequenceHighlights()).toHaveLength(1);

        const updated = vaRRI.updateSubsequenceHighlight(added.id, {
            sequence: '2',
            range: '5-7',
            color: '#111111',
        });

        expect(updated.sequence).toBe('2');
        expect(updated.rangeText).toBe('5-7');
        expect(updated.color).toBe('#111111');

        expect(vaRRI.removeSubsequenceHighlight(added.id)).toBe(true);
        expect(vaRRI.getSubsequenceHighlights()).toHaveLength(0);
    });

    test('validates highlight ranges against sequence context', () => {
        expect(() => vaRRI.registerSubsequenceHighlight(
            { sequence: '1', range: '-2-3', color: '#000000' },
            { '1': { offset: -2, length: 4 } }
        )).toThrow(/valid sequence indices/);
    });
});

describe('region highlight registry', () => {
    beforeEach(() => {
        vaRRI.clearRegionHighlights();
    });

    function validateBackgroundHighlight(backgroundhighlighting) {
        return vaRRI.validate({
            structure: '((..&..))',
            sequence: 'ACGU&CGUC',
            startIndex1: '-2',
            startIndex2: '100',
            labelInterval: '10',
            coloring: 'strand',
            highlighting: 'region',
            backgroundhighlighting,
            guBasepairs: true,
        });
    }

    function expectTrueSequenceRanges(region) {
        expect(region.sequence1Range).toEqual([-2, -1]);
        expect(region.sequence2Range).toEqual([102, 103]);
    }

    test('creates a normalized region highlight object from string input', () => {
        const highlight = vaRRI.createRegionHighlight({
            sequence1Range: '3-8',
            sequence2Range: '10-12',
            color: '#123456',
            generated: true,
        });

        expect(highlight.sequence1Range).toEqual([3, 8]);
        expect(highlight.sequence2Range).toEqual([10, 12]);
        expect(highlight.rangeText).toBe('3-8&10-12');
        expect(highlight.color).toBe('#123456');
        expect(highlight.alpha).toBe(0.2);  // should be default alpha value
        expect(highlight.generated).toBe(true);
    });

    test('computes generated background region ranges as true sequence positions, not raw node ids', () => {
        const v = validateBackgroundHighlight('region');

        const ranges = vaRRI.computeBackgroundRegionRanges(v);
        expectTrueSequenceRanges(ranges);
    });

    test('registers generated region highlights using true sequence positions', () => {
        const v = validateBackgroundHighlight('region');

        vaRRI.backgroundhighlightRegion(v);
        const generated = vaRRI.getRegionHighlights().find(h => h.generated);
        expectTrueSequenceRanges(generated);
    });

    test('registers generated basepair-stack highlights using true sequence positions', () => {
        const v = validateBackgroundHighlight('basepairs');

        vaRRI.backgroundhighlightBasepairs(v);
        const generated = vaRRI.getRegionHighlights().find(h => h.generated);
        expectTrueSequenceRanges(generated);
    });

    test('registers, updates and removes region highlights by id', () => {
        const added = vaRRI.registerRegionHighlight({
            sequence1Range: '2-4',
            sequence2Range: '5-7',
            color: '#abcdef',
        });

        expect(added.id).toBe(1);
        expect(vaRRI.getRegionHighlights()).toHaveLength(1);

        const updated = vaRRI.updateRegionHighlight(added.id, {
            sequence1Range: '6-8',
            sequence2Range: '9-10',
            color: '#111111',
            generated: true,
        });

        expect(updated.sequence1Range).toEqual([6, 8]);
        expect(updated.sequence2Range).toEqual([9, 10]);
        expect(updated.generated).toBe(true);
        expect(updated.color).toBe('#111111');

        expect(vaRRI.removeRegionHighlight(added.id)).toBe(true);
        expect(vaRRI.getRegionHighlights()).toHaveLength(0);
    });

    test('validates region ranges against sequence context', () => {
        expect(() => vaRRI.registerRegionHighlight(
            { sequence1Range: '-2-3', sequence2Range: '1-2', color: '#000000' },
            { '1': { offset: -2, length: 4 }, '2': { offset: 1, length: 4 } }
        )).toThrow(/valid sequence indices/);
    });
});

describe('polygon helpers', () => {
    test('closes point lists for filled polygons', () => {
        expect(vaRRI.closePolygonPoints([[10, 20], [30, 40], [50, 60]])).toEqual([
            '10,20',
            '30,40',
            '50,60',
            '10,20',
        ]);
    });

    test('resolves region node paths from true sequence positions', () => {
        const v = {
            offset1: 1,
            offset2: 1,
            sequence1: 'AC',
            sequence2: 'GU',
        };

        expect(vaRRI.getRegionHighlightNodePath(v, {
            sequence1Range: [1, 2],
            sequence2Range: [1, 2],
        })).toEqual([1, 2, 6, 7]);
    });
});

describe('point mutation registry', () => {
    beforeEach(() => {
        vaRRI.clearPointMutations();
    });

    test('creates a normalized mutation object from string input', () => {
        const mutation = vaRRI.createPointMutation(
            { sequence: 1, position: 2, replacement: 'g' },
            { '1': { offset: 1, sequence: 'ACGU' } }
        );

        expect(mutation.sequence).toBe('1');
        expect(mutation.position).toBe(2);
        expect(mutation.replacement).toBe('g');
        expect(mutation.reference).toBe('C');
        expect(mutation.labelText).toBe('C2g');
    });

    test('accepts any single letter replacement', () => {
        const mutation = vaRRI.createPointMutation(
            { sequence: '2', position: 110, replacement: 'x' },
            { '2': { offset: 110, sequence: 'ACG' } }
        );

        expect(mutation.replacement).toBe('x');
        expect(mutation.labelText).toBe('A110x');
    });

    test('registers, updates and removes mutations by id', () => {
        const added = vaRRI.registerPointMutation(
            { sequence: '1', position: 2, replacement: 'G', color: '#abcdef' },
            { '1': { offset: 1, sequence: 'ACGU' } }
        );

        expect(added.id).toBe(1);
        expect(vaRRI.getPointMutations()).toHaveLength(1);

        const updated = vaRRI.updatePointMutation(added.id, {
            sequence: '1',
            position: 4,
            replacement: 'A',
            color: '#111111',
        }, { '1': { offset: 1, sequence: 'ACGU' } });

        expect(updated.position).toBe(4);
        expect(updated.replacement).toBe('A');
        expect(updated.color).toBe('#111111');

        expect(vaRRI.removePointMutation(added.id)).toBe(true);
        expect(vaRRI.getPointMutations()).toHaveLength(0);
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
// getLinearRriConstraintSpecs
// ---------------------------------------------------------------------------

describe('getLinearRriConstraintSpecs', () => {
    test('uses the larger loop to derive equal chords for both rails', () => {
        const v = vaRRI.validate({
            structure: '(..(.....(&).....)....)',
            sequence: 'AAAAAAAAAA&AAAAAAAAAAAA',
            startIndex1: '1',
            startIndex2: '1',
        });

        expect(vaRRI.listIntermolPairs(v)).toEqual([
            [1, 25],
            [4, 20],
            [10, 14],
        ]);

        const constraints = vaRRI.getLinearRriConstraintSpecs(v);
        expect(constraints).toHaveLength(4);
        expect(constraints[0]).toMatchObject({ source: 1, target: 4, sequence: '1' });
        expect(constraints[1]).toMatchObject({ source: 25, target: 20, sequence: '2' });
        // The first interval has 2 unpaired nodes on sequence 1 and 4 on
        // sequence 2, so both rails use the chord derived from the larger loop.
        expect(constraints[0].distanceUnits).toBeCloseTo(vaRRI.LINEAR_RRI_LINK_DISTANCE_SCALE * 10 / Math.PI, 10);
        expect(constraints[1].distanceUnits).toBeCloseTo(vaRRI.LINEAR_RRI_LINK_DISTANCE_SCALE * 10 / Math.PI, 10);

        expect(constraints[2]).toMatchObject({ source: 4, target: 10, sequence: '1' });
        expect(constraints[3]).toMatchObject({ source: 20, target: 14, sequence: '2' });
        expect(constraints[2].distanceUnits).toBeCloseTo(vaRRI.LINEAR_RRI_LINK_DISTANCE_SCALE * 12 / Math.PI, 10);
        expect(constraints[3].distanceUnits).toBeCloseTo(vaRRI.LINEAR_RRI_LINK_DISTANCE_SCALE * 12 / Math.PI, 10);

    });

    test('returns no constraints for fewer than two intermolecular pairs', () => {
        const v = vaRRI.validate({
            structure: '(...&...)',
            sequence: 'AAAA&AAAA',
            startIndex1: '1',
            startIndex2: '1',
        });

        expect(vaRRI.getLinearRriConstraintSpecs(v)).toEqual([]);
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

    test('sets empty subsequenceHighlights when not provided', () => {
        const v = vaRRI.validate(base2mol);
        expect(v.subsequenceHighlights).toEqual([]);
    });

    test('accepts generic subsequenceHighlights objects', () => {
        const v = vaRRI.validate({
            ...base2mol,
            subsequenceHighlights: [
                { sequence: '1', range: '2-4', color: '#123456' },
                { sequence: '2', range: '1-2', color: '#654321' },
            ],
        });

        expect(v.subsequenceHighlights).toHaveLength(2);
        expect(v.subsequenceHighlights[0].sequence).toBe('1');
        expect(v.subsequenceHighlights[0].color).toBe('#123456');
        expect(v.subsequenceHighlights[1].sequence).toBe('2');
    });

    test('accepts pointMutations objects', () => {
        const v = vaRRI.validate({
            ...base2mol,
            pointMutations: [
                { sequence: '1', position: 1, replacement: 'G', color: '#123456' },
            ],
        });

        expect(v.pointMutations).toHaveLength(1);
        expect(v.pointMutations[0].sequence).toBe('1');
        expect(v.pointMutations[0].labelText).toBe('A1G');
        expect(v.pointMutations[0].nodeId).toBeGreaterThan(0);
    });

    test('accepts negative subsequence ranges with negative sequence start index', () => {
        const v = vaRRI.validate({
            ...base2mol,
            startIndex1: '-2',
            subsequenceHighlights: [{ sequence: '1', range: '-2-2', color: '#123456' }],
        });
        expect(v.subsequenceHighlights[0].range).toEqual([[-2, 2]]);
    });

    test('throws when subsequenceHighlights range endpoints are outside valid sequence indices', () => {
        expect(() => vaRRI.validate({
            ...base2mol,
            startIndex1: '-2',
            subsequenceHighlights: [{ sequence: '1', range: '-2-3', color: '#123456' }],
        })).toThrow(/valid sequence indices/);
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
    test('returns an object with all seven colour keys', () => {
        const colors = vaRRI.getColors();
        expect(colors).toHaveProperty('sequence1');
        expect(colors).toHaveProperty('sequence2');
        expect(colors).toHaveProperty('mutationColor');
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

    test('returns default mutationColor as Darkgreen', () => {
        expect(vaRRI.getColors().mutationColor).toBe('Darkgreen');
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
        expect(colors.mutationColor).toBe('Darkgreen');
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
