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

    // Dummy 2D-Context für Canvas
    const createMock2DContext = () => ({
        fillRect: () => {},
        clearRect: () => {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        rect: () => {},
        fillText: () => {},
        strokeText: () => {},
        measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
        translate: () => {},
        scale: () => {},
        rotate: () => {},
    });

    // Hilfsfunktion zur Erstellung von Dummy-DOM-Elementen
    const createMockElement = (tagName = 'div') => {
        const element = {
            tagName: String(tagName).toUpperCase(),
            value: '',
            checked: false,
            type: '',
            textContent: '',
            innerHTML: '',
            style: {},
            width: 300,  // Standard-Canvas Breiten-/Höhenwerte
            height: 150,
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false,
            },
            setAttribute: () => {},
            getAttribute: () => null,
            removeAttribute: () => {},
            appendChild: (child) => child,
            removeChild: (child) => child,
            replaceChild: (child) => child,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
            closest: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],

            // <-- HIER HINZUGEFÜGT: getContext Support
            getContext: (contextType) => {
                if (contextType === '2d') {
                    return createMock2DContext();
                }
                return null;
            },
            toDataURL: () => 'data:image/png;base64,',
        };

        return element;
    };

    const document = {
        createElement: (tagName) => createMockElement(tagName), // <-- HIER HINZUGEFÜGT
        getElementById: () => createMockElement('div'),
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

        const shareUrlText = sandbox.generateShareableURL();
        expect(shareUrlText).toContain('regionHighlights=');

        const shareUrl = new URL(shareUrlText);
        sandbox.loadUrlRegionHighlightsToVaRRI('regionHighlights', shareUrl.searchParams);

        expect(registeredRegionHighlights).toHaveLength(1);
        expect(registeredRegionHighlights[0]).toMatchObject({
            sequence1Range: [2, 4],
            sequence2Range: [5, 7],
            color: '#123456',
        });
    });

    test('does not serialize generated region highlights into the share URL', () => {
        const stubbedRegionHighlights = [
            { id: 1, sequence1Range: [2, 4], sequence2Range: [5, 7], color: '#123456', rangeText: '2-4&5-7', generated: false },
            { id: 2, sequence1Range: [8, 9], sequence2Range: [10, 11], color: '#654321', rangeText: '8-9&10-11', generated: true },
        ];
        const sandbox = createIndexSandbox({
            vaRRIOverrides: {
                getPointMutations: () => [],
                getSubsequenceHighlights: () => [],
                getRegionHighlights: () => stubbedRegionHighlights,
            },
        });

        const shareUrlText = sandbox.generateShareableURL();

        const shareUrl = new URL(shareUrlText);
        expect(shareUrl.searchParams.get('regionHighlights')).toBe('2-4&5-7:123456');
        expect(shareUrl.searchParams.get('regionHighlights')).not.toContain('8-9&10-11');
    });

    test('uses URLSearchParams encoding for parentheses', () => {
        const sandbox = createIndexSandbox({
            formElements: [{ id: 'structure', type: 'textarea', value: '((..))' }],
            vaRRIOverrides: {
                getPointMutations: () => [],
                getSubsequenceHighlights: () => [],
                getRegionHighlights: () => [],
            },
        });

        const shareUrlText = sandbox.generateShareableURL();

        expect(shareUrlText).toContain('structure=%28%28..%29%29');
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
// Linear helix loop identification and invisible spring constraints
// ---------------------------------------------------------------------------

function validateLinearHelixFixture(sequence, structure, overrides = {}) {
    return vaRRI.validate({
        sequence,
        structure,
        startIndex1: '1',
        startIndex2: '1',
        ...overrides,
    });
}

function constraintEndpoints(specs) {
    return specs.map(spec => [spec.source, spec.target, spec.sequence]);
}

describe('RRI helix loop constraints', () => {
    test('excludes uninterrupted stacks and interactions with only one pair', () => {
        const stack = validateLinearHelixFixture('AAA&UUU', '(((&)))');
        const single = validateLinearHelixFixture('AAAA&UUUU', '(...&...)');

        [stack, single].forEach(v => {
            expect(vaRRI.listRriLoopBoundaryPairs(v)).toEqual([]);
            expect(vaRRI.getLinearRriConstraintSpecs(v)).toEqual([]);
        });
    });

    test.each([
        {
            name: 'one-sided bulge',
            sequence: 'AAAAA&UU',
            structure: '(...(&))',
            pairs: [[1, 10], [5, 9]],
            boundary: {
                outer: [1, 10],
                inner: [5, 9],
                gaps: [3, 0],
                loopType: 'bulge',
            },
            endpoints: [[1, 5, '1'], [9, 10, '2']],
        },
        {
            name: 'two-sided interior loop',
            sequence: 'AAAA&UUUU',
            structure: '(..(&)..)',
            pairs: [[1, 11], [4, 8]],
            boundary: {
                outer: [1, 11],
                inner: [4, 8],
                gaps: [2, 2],
                loopType: 'interior',
            },
            endpoints: [[1, 4, '1'], [8, 11, '2']],
        },
    ])('identifies an RRI $name', ({
        sequence,
        structure,
        pairs,
        boundary,
        endpoints,
    }) => {
        const v = validateLinearHelixFixture(sequence, structure);

        expect(vaRRI.listIntermolPairs(v)).toEqual(pairs);
        expect(vaRRI.listRriLoopBoundaryPairs(v)).toEqual([boundary]);
        const specs = vaRRI.getLinearRriConstraintSpecs(v);
        expect(constraintEndpoints(specs)).toEqual(endpoints);
        expect(specs.map(spec => [spec.kind, spec.loopType])).toEqual([
            ['rri', boundary.loopType],
            ['rri', boundary.loopType],
        ]);
        expect(specs[0].loopId).toBe(specs[1].loopId);
        expect(specs.every(spec => spec.distanceUnits === undefined)).toBe(true);
    });

    test('uses the exact nesting cover and is invariant to biological offsets', () => {
        const input = ['AAAAA&UUUUU', '((..(&)..))'];
        const v = validateLinearHelixFixture(...input);
        const shifted = validateLinearHelixFixture(...input, {
            startIndex1: '-20',
            startIndex2: '500',
        });
        const expected = [{
            outer: [2, 12],
            inner: [5, 9],
            gaps: [2, 2],
            loopType: 'interior',
        }];

        expect(vaRRI.listIntermolPairs(v)).toEqual([
            [1, 13],
            [2, 12],
            [5, 9],
        ]);
        expect(vaRRI.listRriLoopBoundaryPairs(v)).toEqual(expected);
        expect(vaRRI.listRriLoopBoundaryPairs(shifted)).toEqual(expected);
        expect(constraintEndpoints(vaRRI.getLinearRriConstraintSpecs(v)))
            .toEqual([[2, 5, '1'], [9, 12, '2']]);
        expect(vaRRI.getLinearRriConstraintSpecs(shifted))
            .toEqual(vaRRI.getLinearRriConstraintSpecs(v));
    });

    test('conservatively excludes candidates touched by a crossing pair', () => {
        const v = validateLinearHelixFixture(
            'AAAA&UUUUUUUUU',
            '([.{&...}...)]'
        );

        expect(vaRRI.listIntermolPairs(v)).toEqual([
            [1, 15],
            [2, 16],
            [4, 11],
        ]);
        expect(vaRRI.listRriLoopBoundaryPairs(v)).toEqual([]);
        expect(vaRRI.getLinearRriConstraintSpecs(v)).toEqual([]);
    });
});

describe('intramolecular helix loop constraints', () => {
    test.each([
        ['stack ending in a hairpin', 'AAAAAAAAA', '(((...)))'],
        ['single-pair hairpin', 'AAAAA', '(...)'],
        ['separate stems', 'AAAAAAAAAAAAAA', '((..))..((..))'],
        ['multibranch loop', 'AAAAAAAAAA', '((..)(..))'],
    ])('excludes a %s', (_name, sequence, structure) => {
        const v = validateLinearHelixFixture(sequence, structure);

        expect(vaRRI.listStructureLoopBoundaryPairs(v)).toEqual([]);
        expect(vaRRI.getLinearStructureConstraintSpecs(v)).toEqual([]);
    });

    test.each([
        {
            name: 'bulge',
            sequence: 'AAAAAAAAA',
            structure: '((...()))',
            boundary: {
                outer: [2, 8],
                inner: [6, 7],
                gaps: [3, 0],
                loopType: 'bulge',
                sequence: '1',
            },
            endpoints: [[2, 6, '1'], [7, 8, '1']],
        },
        {
            name: 'interior loop',
            sequence: 'AAAAAAAAAAAA',
            structure: '((..(..)..))',
            boundary: {
                outer: [2, 11],
                inner: [5, 8],
                gaps: [2, 2],
                loopType: 'interior',
                sequence: '1',
            },
            endpoints: [[2, 5, '1'], [8, 11, '1']],
        },
    ])('identifies an intramolecular $name', ({
        sequence,
        structure,
        boundary,
        endpoints,
    }) => {
        const v = validateLinearHelixFixture(sequence, structure);

        expect(vaRRI.listStructureLoopBoundaryPairs(v)).toEqual([boundary]);
        const specs = vaRRI.getLinearStructureConstraintSpecs(v);
        expect(constraintEndpoints(specs)).toEqual(endpoints);
        expect(specs.map(spec => [spec.kind, spec.loopType])).toEqual([
            ['structure', boundary.loopType],
            ['structure', boundary.loopType],
        ]);
        expect(specs[0].loopId).toBe(specs[1].loopId);
    });

    test('maps both strands through the three synthetic Fornac gap nodes', () => {
        const v = validateLinearHelixFixture(
            'AAAAAAAAAAAA&UUUUUUUUU',
            '((..(..)..))&((...()))'
        );

        expect(vaRRI.listStructureLoopBoundaryPairs(v)).toEqual([
            {
                outer: [2, 11],
                inner: [5, 8],
                gaps: [2, 2],
                loopType: 'interior',
                sequence: '1',
            },
            {
                outer: [17, 23],
                inner: [21, 22],
                gaps: [3, 0],
                loopType: 'bulge',
                sequence: '2',
            },
        ]);
        expect(constraintEndpoints(vaRRI.getLinearStructureConstraintSpecs(v)))
            .toEqual([
                [2, 5, '1'],
                [8, 11, '1'],
                [17, 21, '2'],
                [22, 23, '2'],
            ]);
    });

    test('conservatively excludes candidates touched by crossing pairs', () => {
        const v = validateLinearHelixFixture('AAAAAAAAAAA', '([.{..}..)]');

        expect(vaRRI.listStructureLoopBoundaryPairs(v)).toEqual([]);
        expect(vaRRI.getLinearStructureConstraintSpecs(v)).toEqual([]);
    });
});

function createLinearHelixTestNode(num, x, y, fixed) {
    return {
        nodeType: 'nucleotide',
        num,
        x,
        y,
        px: x - 0.25,
        py: y + 0.5,
        fixed,
    };
}

function createLinearHelixTestLabel(name, x, y, fixed = 0) {
    return {
        nodeType: 'label',
        num: -1,
        name: String(name),
        radius: 6,
        x,
        y,
        px: x - 0.75,
        py: y + 0.25,
        fixed,
    };
}

function createLinearHelixTestContainer(nodes, links = [], multiplier = 4) {
    const handlers = {};
    const force = {
        on: jest.fn((eventName, handler) => {
            if (handler === null) delete handlers[eventName];
            else handlers[eventName] = handler;
            return force;
        }),
        start: jest.fn(),
    };
    return {
        container: {
            graph: { nodes, links },
            options: { linkDistanceMultiplier: multiplier },
            linkStrengths: { backbone: 10 },
            force,
            centerView: jest.fn(),
            update: jest.fn(),
        },
        force,
        handlers,
    };
}

function linearHelixConstraintSummary(constraints = []) {
    return constraints.map(constraint => ({
        endpoints: [constraint.source.num, constraint.target.num],
        kind: constraint.varriLinearHelixKind,
        loop: constraint.varriLinearHelixLoop,
        type: constraint.linkType,
        target: constraint.varriTargetDistance,
        value: constraint.value,
    }));
}

function linearHelixNode(nodes, num) {
    return nodes.find(node => node.num === num);
}

function linearHelixVector(first, second, xField = 'x', yField = 'y') {
    return {
        x: second[xField] - first[xField],
        y: second[yField] - first[yField],
    };
}

function linearHelixVectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function linearHelixDot(first, second) {
    return first.x * second.x + first.y * second.y;
}

function linearHelixCross(first, second) {
    return first.x * second.y - first.y * second.x;
}

function linearHelixExteriorScore(label, anchor, partner) {
    const outward = linearHelixVector(partner, anchor);
    const length = linearHelixVectorLength(outward);
    return linearHelixDot(
        linearHelixVector(anchor, label),
        { x: outward.x / length, y: outward.y / length }
    );
}

function linearHelixNucleotideCoordinateSnapshot(nodes) {
    return nodes
        .filter(node => node.nodeType === 'nucleotide')
        .map(node => ({
            node,
            coordinates: [node.x, node.y, node.px, node.py],
        }));
}

function expectLinearHelixNucleotideCoordinatesUnchanged(snapshot) {
    snapshot.forEach(({ node, coordinates }) => {
        [node.x, node.y, node.px, node.py].forEach((value, index) => {
            expect(value).toBeCloseTo(coordinates[index], 10);
        });
    });
}

function linearHelixCoordinateSnapshot(nodes) {
    return nodes.map(node => ({
        node,
        coordinates: [node.x, node.y, node.px, node.py],
    }));
}

function expectLinearHelixCoordinatesClose(snapshot, precision = 10) {
    snapshot.forEach(({ node, coordinates }) => {
        [node.x, node.y, node.px, node.py].forEach((value, index) => {
            expect(value).toBeCloseTo(coordinates[index], precision);
        });
    });
}

function linearHelixPairwiseDistanceSnapshot(nodes, xField = 'x', yField = 'y') {
    const distances = [];
    nodes.forEach((first, firstIndex) => {
        nodes.slice(firstIndex + 1).forEach(second => {
            distances.push(linearHelixVectorLength(
                linearHelixVector(first, second, xField, yField)
            ));
        });
    });
    return distances;
}

function expectLinearHelixPairwiseDistancesPreserved(
    snapshot,
    nodes,
    xField = 'x',
    yField = 'y',
    precision = 10
) {
    const current = linearHelixPairwiseDistanceSnapshot(nodes, xField, yField);
    expect(current).toHaveLength(snapshot.length);
    current.forEach((distance, index) => {
        expect(distance).toBeCloseTo(snapshot[index], precision);
    });
}

function linearHelixPairCenters(nodes, pairs, xField = 'x', yField = 'y') {
    return pairs.map(pair => {
        const first = linearHelixNode(nodes, pair[0]);
        const second = linearHelixNode(nodes, pair[1]);
        return {
            x: (first[xField] + second[xField]) / 2,
            y: (first[yField] + second[yField]) / 2,
        };
    });
}

function expectLinearHelixHorizontalAxis(
    nodes,
    pairs,
    xField = 'x',
    yField = 'y',
    direction = null
) {
    const centers = linearHelixPairCenters(nodes, pairs, xField, yField);
    const yValues = centers.map(center => center.y);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeCloseTo(0, 10);
    const xDelta = centers.at(-1).x - centers[0].x;
    expect(Math.abs(xDelta)).toBeGreaterThan(1e-8);
    if (direction !== null) expect(Math.sign(xDelta)).toBe(direction);
    return { centers, xDelta };
}

function linearHelixTransformPoint(point, radians, translation) {
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
        x: translation.x + cosine * point.x - sine * point.y,
        y: translation.y + sine * point.x + cosine * point.y,
    };
}

function linearHelixListenerActions(force) {
    return force.on.mock.calls.map(([eventName, handler]) => [
        eventName,
        handler === null ? 'clear' : 'set',
    ]);
}

function expectLinearHelixRailGeometry(
    nodes,
    pairs,
    intervals,
    rungSpacing,
    xField = 'x',
    yField = 'y'
) {
    const firstRail = pairs.map(pair => linearHelixNode(nodes, pair[0]));
    const secondRail = pairs.map(pair => linearHelixNode(nodes, pair[1]));
    const firstSteps = firstRail.slice(1).map((node, index) =>
        linearHelixVector(firstRail[index], node, xField, yField)
    );
    const secondSteps = secondRail.slice(1).map((node, index) =>
        linearHelixVector(secondRail[index], node, xField, yField)
    );
    const rungs = firstRail.map((node, index) =>
        linearHelixVector(node, secondRail[index], xField, yField)
    );

    firstSteps.forEach((step, index) => {
        expect(linearHelixVectorLength(step)).toBeCloseTo(intervals[index], 10);
        expect(linearHelixVectorLength(secondSteps[index]))
            .toBeCloseTo(intervals[index], 10);
        expect(linearHelixCross(step, secondSteps[index])).toBeCloseTo(0, 10);
        expect(linearHelixDot(step, secondSteps[index])).toBeGreaterThan(0);
    });

    const axis = firstSteps[0];
    [...firstSteps, ...secondSteps].forEach(step => {
        expect(linearHelixCross(axis, step)).toBeCloseTo(0, 10);
        expect(linearHelixDot(axis, step)).toBeGreaterThan(0);
    });
    rungs.forEach(rung => {
        expect(linearHelixVectorLength(rung)).toBeCloseTo(rungSpacing, 10);
        expect(linearHelixCross(rungs[0], rung)).toBeCloseTo(0, 10);
        expect(linearHelixDot(rungs[0], rung)).toBeGreaterThan(0);
        expect(linearHelixDot(axis, rung)).toBeCloseTo(0, 10);
    });
}

describe('applyLinearHelixSprings', () => {
    test('stores max-span metadata outside graph links and enforces a rigid RRI ladder', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, -4, -3, 0),
            createLinearHelixTestNode(13, -2, 2, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(12, 10, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(9, 10, 12, 0),
        ];
        const fixedSnapshot = nodes.map(node => [node.num, node.fixed]);
        const existing = {
            source: nodes[0],
            target: nodes[2],
            linkType: 'backbone',
            marker: 'preserve-me',
        };
        const links = [existing];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links,
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.graph.links).toBe(links);
        expect(container.graph.links).toEqual([existing]);
        expect(linearHelixConstraintSummary(container.varriLinearHelixConstraints))
            .toEqual([
                {
                    endpoints: [2, 5],
                    kind: 'rri',
                    loop: 'rri:0',
                    type: 'rri_linear',
                    target: 12,
                    value: 3,
                },
                {
                    endpoints: [9, 12],
                    kind: 'rri',
                    loop: 'rri:0',
                    type: 'rri_linear',
                    target: 12,
                    value: 3,
                },
            ]);
        container.varriLinearHelixConstraints.forEach(constraint => {
            expect(constraint).toMatchObject({
                extraLinkType: 'constraint',
                varriLinearHelix: true,
            });
            expect(container.graph.links).not.toContain(constraint);
        });
        expect(container.varriLinearHelixTemplates).toHaveLength(1);
        expect(container.varriLinearHelixTemplates[0]).toMatchObject({
            kind: 'rri',
            pairs: [[1, 13], [2, 12], [5, 9]],
            intervals: [
                { span: 4, isLoop: false, gaps: [0, 0] },
                { span: 12, isLoop: true, gaps: [2, 2] },
            ],
            railGap: 4,
        });
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expect(nodes.map(node => [node.num, node.fixed])).toEqual(fixedSnapshot);
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]]
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'px',
            'py'
        );
        nodes.forEach(node => {
            expect(node.px - node.x).toBeCloseTo(-0.25, 10);
            expect(node.py - node.y).toBeCloseTo(0.5, 10);
            expect(node.varriLinearHelix).toBe(true);
            expect(node.varriLinearHelixKind).toBe('rri');
        });

        linearHelixNode(nodes, 1).x += 17;
        linearHelixNode(nodes, 2).y -= 9;
        linearHelixNode(nodes, 9).x -= 5;
        linearHelixNode(nodes, 13).px -= 8;
        linearHelixNode(nodes, 5).py += 6;
        linearHelixNode(nodes, 12).px += 3;
        expect(linearHelixVectorLength(linearHelixVector(
            linearHelixNode(nodes, 1),
            linearHelixNode(nodes, 2)
        ))).not.toBeCloseTo(4, 5);
        handlers['tick.varriLinearHelix']();
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]]
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'px',
            'py'
        );
        expect(container.centerView).not.toHaveBeenCalled();

        linearHelixNode(nodes, 13).y += 11;
        linearHelixNode(nodes, 5).x -= 8;
        linearHelixNode(nodes, 1).py -= 13;
        linearHelixNode(nodes, 9).px += 7;
        handlers['end.varriLinearHelix']();
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]]
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'px',
            'py'
        );
        expect(container.centerView).toHaveBeenCalledTimes(1);
        expect(nodes.map(node => [node.num, node.fixed])).toEqual(fixedSnapshot);
        expect(linearHelixListenerActions(force)).toEqual([
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
        ]);
        expect(force.start).toHaveBeenCalledTimes(1);
        expect(container.linkStrengths).toEqual({ backbone: 10 });
        expect(container.update).not.toHaveBeenCalled();
    });

    test('gently moves only retained wrong-side labels before convergence', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nucleotideNodes = [
            createLinearHelixTestNode(1, 0, -2, 0),
            createLinearHelixTestNode(13, 0, 2, 0),
            createLinearHelixTestNode(2, 4, -2, 0),
            createLinearHelixTestNode(12, 4, 2, 0),
            createLinearHelixTestNode(5, 16, -2, 0),
            createLinearHelixTestNode(9, 16, 2, 0),
        ];
        const insideLabel = createLinearHelixTestLabel(5, 16, 1);
        const correctSideLabel = createLinearHelixTestLabel(1, 16, 5);
        const hiddenLabel = createLinearHelixTestLabel(2, 4, 1);
        const nodes = [
            ...nucleotideNodes,
            insideLabel,
            correctSideLabel,
            hiddenLabel,
        ];
        const insideLink = {
            source: linearHelixNode(nodes, 5),
            target: insideLabel,
            value: 1,
            linkType: 'label_link',
        };
        const links = [
            insideLink,
            {
                source: linearHelixNode(nodes, 9),
                target: correctSideLabel,
                value: 1,
                linkType: 'label_link',
            },
            {
                source: linearHelixNode(nodes, 2),
                target: hiddenLabel,
                value: 1,
                linkType: 'label_link',
            },
        ];
        const nucleotideSnapshot = linearHelixNucleotideCoordinateSnapshot(nodes);
        const insideBefore = { ...insideLabel };
        const correctBefore = { ...correctSideLabel };
        const hiddenBefore = { ...hiddenLabel };
        const initialInsideScore = linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        const { container, handlers } = createLinearHelixTestContainer(nodes, links, 4);

        expect(initialInsideScore).toBeCloseTo(-3, 10);
        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.graph.links).toBe(links);
        expect(container.graph.links).toHaveLength(3);
        expect(container.varriLinearHelixLabelBiases.map(bias => bias.label))
            .toEqual([insideLabel, correctSideLabel]);
        expect(container.varriLinearHelixLabelBiases.map(bias => ({
            anchor: bias.anchor.num,
            partner: bias.partner.num,
            linkDistance: bias.linkDistance,
        }))).toEqual([
            { anchor: 5, partner: 9, linkDistance: 4 },
            { anchor: 9, partner: 5, linkDistance: 4 },
        ]);

        const scoreAfterApply = linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        expect(scoreAfterApply - initialInsideScore).toBeCloseTo(0.2, 10);
        expect(insideLabel.x - insideLabel.px)
            .toBeCloseTo(insideBefore.x - insideBefore.px, 10);
        expect(insideLabel.y - insideLabel.py)
            .toBeCloseTo(insideBefore.y - insideBefore.py, 10);
        expect(correctSideLabel).toEqual(correctBefore);
        expect(hiddenLabel).toEqual(hiddenBefore);
        expectLinearHelixNucleotideCoordinatesUnchanged(nucleotideSnapshot);

        handlers['tick.varriLinearHelix']();
        const scoreAfterTick = linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        expect(scoreAfterTick - scoreAfterApply).toBeCloseTo(0.2, 10);
        expect(scoreAfterTick).toBeLessThan(0);

        for (let tick = 0; tick < 40 && linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        ) < 0; tick++) {
            handlers['tick.varriLinearHelix']();
        }
        const scoreAfterCrossing = linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        expect(scoreAfterCrossing).toBeGreaterThanOrEqual(0);
        expect(scoreAfterCrossing).toBeLessThan(0.4);
        handlers['tick.varriLinearHelix']();
        const scoreAfterMarginTick = linearHelixExteriorScore(
            insideLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        expect(scoreAfterMarginTick).toBeGreaterThan(scoreAfterCrossing);
        expect(scoreAfterMarginTick - scoreAfterCrossing).toBeLessThanOrEqual(0.2);
        expect(scoreAfterMarginTick).toBeLessThanOrEqual(0.4);
        expect(correctSideLabel).toEqual(correctBefore);
        expect(hiddenLabel).toEqual(hiddenBefore);
        expectLinearHelixNucleotideCoordinatesUnchanged(nucleotideSnapshot);
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
    });

    test('keeps hidden labels out but includes a mutation label on a rail', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        v.pointMutations = [{ nodeId: 12 }];
        const nucleotideNodes = [
            createLinearHelixTestNode(1, 0, -2, 0),
            createLinearHelixTestNode(13, 0, 2, 0),
            createLinearHelixTestNode(2, 4, -2, 0),
            createLinearHelixTestNode(12, 4, 2, 0),
            createLinearHelixTestNode(5, 16, -2, 0),
            createLinearHelixTestNode(9, 16, 2, 0),
        ];
        const hiddenLabel = createLinearHelixTestLabel(2, 4, 1);
        const mutationLabel = createLinearHelixTestLabel(4, 4, -1);
        const nodes = [...nucleotideNodes, hiddenLabel, mutationLabel];
        const links = [
            {
                source: linearHelixNode(nodes, 2),
                target: hiddenLabel,
                value: 1,
                linkType: 'label_link',
            },
            {
                source: mutationLabel,
                target: linearHelixNode(nodes, 12),
                value: 1,
                linkType: 'label_link',
            },
        ];
        const hiddenBefore = { ...hiddenLabel };
        const mutationScoreBefore = linearHelixExteriorScore(
            mutationLabel,
            linearHelixNode(nodes, 12),
            linearHelixNode(nodes, 2)
        );
        const { container } = createLinearHelixTestContainer(nodes, links, 4);

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixLabelBiases).toHaveLength(1);
        expect(container.varriLinearHelixLabelBiases[0]).toMatchObject({
            label: mutationLabel,
            anchor: linearHelixNode(nodes, 12),
            partner: linearHelixNode(nodes, 2),
            linkDistance: 4,
        });
        expect(hiddenLabel).toEqual(hiddenBefore);
        expect(linearHelixExteriorScore(
            mutationLabel,
            linearHelixNode(nodes, 12),
            linearHelixNode(nodes, 2)
        ) - mutationScoreBefore).toBeCloseTo(0.2, 10);
        expect(container.graph.links).toBe(links);
    });

    test('uses live pair geometry for rotated and reflected rails', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nucleotideNodes = [
            createLinearHelixTestNode(1, -2, 0, 0),
            createLinearHelixTestNode(13, 2, 0, 0),
            createLinearHelixTestNode(2, -2, 4, 0),
            createLinearHelixTestNode(12, 2, 4, 0),
            createLinearHelixTestNode(5, -2, 16, 0),
            createLinearHelixTestNode(9, 2, 16, 0),
        ];
        nucleotideNodes.forEach(node => {
            node.px = node.x + 0.5;
            node.py = node.y - 0.25;
        });
        const firstRailLabel = createLinearHelixTestLabel(5, 1, 16);
        const secondRailLabel = createLinearHelixTestLabel(1, -1, 16);
        const nodes = [...nucleotideNodes, firstRailLabel, secondRailLabel];
        const links = [
            {
                source: linearHelixNode(nodes, 5),
                target: firstRailLabel,
                value: 1,
                linkType: 'label_link',
            },
            {
                source: linearHelixNode(nodes, 9),
                target: secondRailLabel,
                value: 1,
                linkType: 'label_link',
            },
        ];
        const currentDistances = linearHelixPairwiseDistanceSnapshot(nucleotideNodes);
        const previousDistances = linearHelixPairwiseDistanceSnapshot(
            nucleotideNodes,
            'px',
            'py'
        );
        const firstScoreBefore = linearHelixExteriorScore(
            firstRailLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        );
        const secondScoreBefore = linearHelixExteriorScore(
            secondRailLabel,
            linearHelixNode(nodes, 9),
            linearHelixNode(nodes, 5)
        );
        const { container } = createLinearHelixTestContainer(nodes, links, 4);

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixTemplates[0].reflection).toBe(-1);
        expect(linearHelixExteriorScore(
            firstRailLabel,
            linearHelixNode(nodes, 5),
            linearHelixNode(nodes, 9)
        ) - firstScoreBefore).toBeCloseTo(0.2, 10);
        expect(linearHelixExteriorScore(
            secondRailLabel,
            linearHelixNode(nodes, 9),
            linearHelixNode(nodes, 5)
        ) - secondScoreBefore).toBeCloseTo(0.2, 10);
        expectLinearHelixPairwiseDistancesPreserved(
            currentDistances,
            nucleotideNodes
        );
        expectLinearHelixPairwiseDistancesPreserved(
            previousDistances,
            nucleotideNodes,
            'px',
            'py'
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'x',
            'y',
            1
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'px',
            'py',
            1
        );
    });

    test('skips fixed, invalid, and unpaired labels without blocking valid ones', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        v.pointMutations = [{ nodeId: 99 }];
        const nucleotideNodes = [
            createLinearHelixTestNode(1, 0, -2, 0),
            createLinearHelixTestNode(13, 0, 2, 0),
            createLinearHelixTestNode(2, 4, -2, 0),
            createLinearHelixTestNode(12, 4, 2, 0),
            createLinearHelixTestNode(5, 16, -2, 0),
            createLinearHelixTestNode(9, 16, 2, 0),
            createLinearHelixTestNode(99, 80, 80, 0),
        ];
        const validLabel = createLinearHelixTestLabel(1, 0, 1);
        const fixedLabel = createLinearHelixTestLabel(5, 16, 1, 2);
        const invalidLabel = createLinearHelixTestLabel(1, 16, -1);
        invalidLabel.py = Infinity;
        const unpairedLabel = createLinearHelixTestLabel(99, 79, 80);
        const nodes = [
            ...nucleotideNodes,
            validLabel,
            fixedLabel,
            invalidLabel,
            unpairedLabel,
        ];
        const links = [
            [linearHelixNode(nodes, 1), validLabel],
            [linearHelixNode(nodes, 5), fixedLabel],
            [linearHelixNode(nodes, 9), invalidLabel],
            [linearHelixNode(nodes, 99), unpairedLabel],
        ].map(([source, target]) => ({
            source,
            target,
            value: 1,
            linkType: 'label_link',
        }));
        const validScoreBefore = linearHelixExteriorScore(
            validLabel,
            linearHelixNode(nodes, 1),
            linearHelixNode(nodes, 13)
        );
        const fixedBefore = { ...fixedLabel };
        const invalidBefore = { ...invalidLabel };
        const unpairedBefore = { ...unpairedLabel };
        const { container, handlers } = createLinearHelixTestContainer(nodes, links, 4);

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixLabelBiases.map(bias => bias.label))
            .toEqual([validLabel, fixedLabel, invalidLabel]);
        expect(linearHelixExteriorScore(
            validLabel,
            linearHelixNode(nodes, 1),
            linearHelixNode(nodes, 13)
        ) - validScoreBefore).toBeCloseTo(0.2, 10);
        expect(fixedLabel).toEqual(fixedBefore);
        expect(invalidLabel).toEqual(invalidBefore);
        expect(unpairedLabel).toEqual(unpairedBefore);

        handlers['tick.varriLinearHelix']();
        expect(fixedLabel).toEqual(fixedBefore);
        expect(invalidLabel).toEqual(invalidBefore);
        expect(unpairedLabel).toEqual(unpairedBefore);
        expect(nucleotideNodes.every(node =>
            [node.x, node.y, node.px, node.py].every(Number.isFinite)
        )).toBe(true);
    });

    test('end remains capped, guides the centreline outward, and synchronizes label DOM', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nucleotideNodes = [
            createLinearHelixTestNode(1, 0, -2, 0),
            createLinearHelixTestNode(13, 0, 2, 0),
            createLinearHelixTestNode(2, 4, -2, 0),
            createLinearHelixTestNode(12, 4, 2, 0),
            createLinearHelixTestNode(5, 16, -2, 0),
            createLinearHelixTestNode(9, 16, 2, 0),
        ];
        const label = createLinearHelixTestLabel(5, 16, 1);
        const nodes = [...nucleotideNodes, label];
        const labelLink = {
            source: linearHelixNode(nodes, 5),
            target: label,
            value: 1.5,
            linkType: 'label_link',
        };
        const groupAttributes = {};
        const lineAttributes = {};
        const labelGroup = {
            __data__: label,
            setAttribute: jest.fn((name, value) => {
                groupAttributes[name] = value;
            }),
        };
        const labelLine = {
            __data__: labelLink,
            setAttribute: jest.fn((name, value) => {
                lineAttributes[name] = value;
            }),
        };
        const hadDocument = Object.prototype.hasOwnProperty.call(global, 'document');
        const previousDocument = global.document;
        global.document = {
            querySelectorAll: jest.fn(selector => {
                if (selector === 'g.gnode') return [labelGroup];
                if (selector === 'line.link') return [labelLine];
                return [];
            }),
        };

        try {
            const { container, handlers } = createLinearHelixTestContainer(
                nodes,
                [labelLink],
                4
            );
            expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
                .toBe(2);
            expect(container.varriLinearHelixLabelBiases[0].linkDistance).toBe(6);

            const anchor = linearHelixNode(nodes, 5);
            const partner = linearHelixNode(nodes, 9);
            const outward = linearHelixVector(partner, anchor);
            const outwardLength = linearHelixVectorLength(outward);
            const unit = {
                x: outward.x / outwardLength,
                y: outward.y / outwardLength,
            };
            label.x = anchor.x - 2 * unit.x;
            label.y = anchor.y - 2 * unit.y;
            label.px = label.x - 0.75;
            label.py = label.y + 0.25;
            const velocityBefore = [label.x - label.px, label.y - label.py];
            const insideScoreBeforeEnd = linearHelixExteriorScore(label, anchor, partner);

            handlers['end.varriLinearHelix']();
            const insideScoreAfterEnd = linearHelixExteriorScore(label, anchor, partner);
            expect(insideScoreBeforeEnd).toBeCloseTo(-2, 10);
            expect(insideScoreAfterEnd - insideScoreBeforeEnd).toBeCloseTo(0.3, 10);
            expect(insideScoreAfterEnd).toBeLessThan(0);
            expect(label.x - label.px).toBeCloseTo(velocityBefore[0], 10);
            expect(label.y - label.py).toBeCloseTo(velocityBefore[1], 10);

            label.x = anchor.x;
            label.y = anchor.y;
            label.px = label.x - 0.75;
            label.py = label.y + 0.25;
            const centrelineBefore = [label.x, label.y, label.px, label.py];
            handlers['end.varriLinearHelix']();
            const centrelineScoreAfterEnd = linearHelixExteriorScore(
                label,
                anchor,
                partner
            );
            expect(centrelineScoreAfterEnd).toBeCloseTo(0.12, 10);
            expect(centrelineScoreAfterEnd).toBeGreaterThan(0);
            expect(Math.hypot(
                label.x - centrelineBefore[0],
                label.y - centrelineBefore[1]
            )).toBeCloseTo(0.12, 10);
            expect(Math.hypot(
                label.px - centrelineBefore[2],
                label.py - centrelineBefore[3]
            )).toBeCloseTo(0.12, 10);
            expect(groupAttributes.transform)
                .toBe(`translate(${label.x},${label.y})`);
            expect(lineAttributes).toEqual({
                x1: String(anchor.x),
                y1: String(anchor.y),
                x2: String(label.x),
                y2: String(label.y),
            });
            expect(container.centerView).toHaveBeenCalledTimes(1);
        } finally {
            if (hadDocument) global.document = previousDocument;
            else delete global.document;
        }
    });

    test('refits the viewport only on the first end while later ends still enforce', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, -4, -3, 0),
            createLinearHelixTestNode(13, -2, 2, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(12, 10, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(9, 10, 12, 0),
        ];
        const { container, handlers } = createLinearHelixTestContainer(
            nodes,
            [],
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.centerView).not.toHaveBeenCalled();

        handlers['end.varriLinearHelix']();
        expect(container.centerView).toHaveBeenCalledTimes(1);

        linearHelixNode(nodes, 1).x += 19;
        linearHelixNode(nodes, 12).y -= 7;
        linearHelixNode(nodes, 13).px -= 11;
        handlers['tick.varriLinearHelix']();
        expect(container.centerView).toHaveBeenCalledTimes(1);
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );

        linearHelixNode(nodes, 5).y += 13;
        linearHelixNode(nodes, 9).px -= 9;
        handlers['end.varriLinearHelix']();
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expect(container.centerView).toHaveBeenCalledTimes(1);
    });

    test('cancelActiveRender removes helix end handlers before synchronous force.stop', async () => {
        vaRRI.cancelActiveRender();
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, -4, -3, 0),
            createLinearHelixTestNode(13, -2, 2, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(12, 10, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(9, 10, 12, 0),
        ];
        const listeners = {};
        const lifecycle = [];
        const force = {
            on: jest.fn((eventName, handler) => {
                lifecycle.push((handler === null ? 'clear:' : 'set:') + eventName);
                if (handler === null) delete listeners[eventName];
                else listeners[eventName] = handler;
                return force;
            }),
            start: jest.fn(() => {
                lifecycle.push('start');
                return force;
            }),
            stop: jest.fn(() => {
                lifecycle.push('stop');
                const endHandler = listeners['end.varriLinearHelix'];
                if (endHandler) {
                    lifecycle.push('dispatch:end.varriLinearHelix');
                    endHandler();
                }
                return force;
            }),
        };
        const container = {
            graph: { nodes, links: [] },
            options: { linkDistanceMultiplier: 4 },
            linkStrengths: { backbone: 10 },
            force,
            addRNA: jest.fn(),
            centerView: jest.fn(),
            update: jest.fn(),
        };
        const hadFornac = Object.prototype.hasOwnProperty.call(global, 'fornac');
        const previousFornac = global.fornac;
        global.fornac = {
            FornaContainer: jest.fn(function FakeFornaContainer() {
                return container;
            }),
        };

        try {
            const renderPromise = vaRRI.render('linear-cancel-test', v, {
                forceLayout: true,
                forceLayoutLinear: true,
            });
            expect(typeof listeners['end.varriLinearHelix']).toBe('function');
            expect(container.varriLinearHelixTemplates).toHaveLength(1);
            expect(container.varriLinearHelixLabelBiases).toEqual([]);

            vaRRI.cancelActiveRender();
            await expect(renderPromise).resolves.toEqual({ cancelled: true });

            expect(lifecycle.slice(-3)).toEqual([
                'clear:tick.varriLinearHelix',
                'clear:end.varriLinearHelix',
                'stop',
            ]);
            expect(lifecycle).not.toContain('dispatch:end.varriLinearHelix');
            expect(listeners).toEqual({});
            expect(container.varriLinearHelixConstraints).toBeUndefined();
            expect(container.varriLinearHelixTemplates).toBeUndefined();
            expect(container.varriLinearHelixLabelBiases).toBeUndefined();
            expect(container.centerView).not.toHaveBeenCalled();
            expect(force.stop).toHaveBeenCalledTimes(1);
        } finally {
            vaRRI.cancelActiveRender();
            if (hadFornac) global.fornac = previousFornac;
            else delete global.fornac;
        }
    });

    test('skips the whole helix when one pair coordinate is invalid', () => {
        const v = validateLinearHelixFixture('AAAAA&UU', '(...(&))');
        const nodes = [
            createLinearHelixTestNode(1, 0, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(9, 10, 0, 0),
            createLinearHelixTestNode(10, 10, Infinity, 0),
        ];
        const snapshot = nodes.map(node => ({ ...node }));
        const existing = { linkType: 'backbone' };
        const links = [existing];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(0);
        expect(container.graph.links).toBe(links);
        expect(container.graph.links).toEqual([existing]);
        expect(container.varriLinearHelixConstraints).toBeUndefined();
        expect(container.varriLinearHelixTemplates).toBeUndefined();
        expect(container.varriLinearHelixLabelBiases).toBeUndefined();
        expect(container.linkStrengths).toEqual({ backbone: 10 });
        expect(nodes).toEqual(snapshot);
        expect(handlers).toEqual({});
        expect(linearHelixListenerActions(force)).toEqual([]);
        expect(force.start).not.toHaveBeenCalled();
        expect(container.update).not.toHaveBeenCalled();
    });

    test.each([
        {
            name: 'single-pair interaction',
            sequence: 'AAAA&UUUU',
            structure: '(...&...)',
            nodeNumbers: [1, 11],
        },
        {
            name: 'crossing interaction',
            sequence: 'AAAA&UUUUUUUUU',
            structure: '([.{&...}...)]',
            nodeNumbers: [1, 15, 2, 16, 4, 11],
        },
    ])('leaves a $name unchanged because no unique RRI axis exists', ({
        sequence,
        structure,
        nodeNumbers,
    }) => {
        const v = validateLinearHelixFixture(sequence, structure);
        const nodes = nodeNumbers.map((num, index) =>
            createLinearHelixTestNode(num, 3 * index, 5 - 2 * index, 0)
        );
        const snapshot = nodes.map(node => ({ ...node }));
        const links = [{
            source: nodes[0],
            target: nodes[1],
            linkType: 'basepair',
        }];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links,
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(0);
        expect(container.graph.links).toBe(links);
        expect(container.varriLinearHelixConstraints).toBeUndefined();
        expect(container.varriLinearHelixTemplates).toBeUndefined();
        expect(container.varriLinearHelixLabelBiases).toBeUndefined();
        expect(nodes).toEqual(snapshot);
        expect(handlers).toEqual({});
        expect(force.on).not.toHaveBeenCalled();
        expect(force.start).not.toHaveBeenCalled();
    });

    test('preserves reflected rail handedness instead of mirroring the helix', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, 0, 2, 0),
            createLinearHelixTestNode(13, 0, -2, 0),
            createLinearHelixTestNode(2, 4, 2, 0),
            createLinearHelixTestNode(12, 4, -2, 0),
            createLinearHelixTestNode(5, 16, 2, 0),
            createLinearHelixTestNode(9, 16, -2, 0),
        ];
        const links = [{ linkType: 'backbone' }];
        const { container } = createLinearHelixTestContainer(nodes, links, 4);
        const handednessBefore = linearHelixCross(
            linearHelixVector(
                linearHelixNode(nodes, 1),
                linearHelixNode(nodes, 2)
            ),
            linearHelixVector(
                linearHelixNode(nodes, 1),
                linearHelixNode(nodes, 13)
            )
        );

        expect(handednessBefore).toBeLessThan(0);
        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.graph.links).toBe(links);
        expect(container.varriLinearHelixTemplates).toHaveLength(1);
        expect(container.varriLinearHelixTemplates[0].reflection).toBe(-1);
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expect(linearHelixCross(
            linearHelixVector(
                linearHelixNode(nodes, 1),
                linearHelixNode(nodes, 2)
            ),
            linearHelixVector(
                linearHelixNode(nodes, 1),
                linearHelixNode(nodes, 13)
            )
        )).toBeLessThan(0);
    });

    test.each([
        ['permanently pinned', 1],
        ['drag-active', 2],
        ['hover-active', 4],
    ])('skips a helix with a %s endpoint (fixed=%i)', (_state, fixed) => {
        const v = validateLinearHelixFixture('AAAAA&UU', '(...(&))');
        const nodes = [
            createLinearHelixTestNode(1, 0, 0, 0),
            createLinearHelixTestNode(5, 3, 4, fixed),
            createLinearHelixTestNode(9, 10, 0, 0),
            createLinearHelixTestNode(10, 10, 12, 0),
        ];
        const snapshot = nodes.map(node => ({ ...node }));
        const links = [{ linkType: 'backbone' }];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(0);
        expect(container.graph.links).toBe(links);
        expect(container.varriLinearHelixConstraints).toBeUndefined();
        expect(container.varriLinearHelixTemplates).toBeUndefined();
        expect(nodes).toEqual(snapshot);
        expect(handlers).toEqual({});
        expect(force.on).not.toHaveBeenCalled();
        expect(force.start).not.toHaveBeenCalled();
    });

    test('keeps the graph orientation when an unrelated node is pinned', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, -2, 0, 0),
            createLinearHelixTestNode(13, 2, 0, 0),
            createLinearHelixTestNode(2, -2, 4, 0),
            createLinearHelixTestNode(12, 2, 4, 0),
            createLinearHelixTestNode(5, -2, 16, 0),
            createLinearHelixTestNode(9, 2, 16, 0),
            createLinearHelixTestNode(99, 40, -30, 1),
        ];
        const coordinateSnapshot = linearHelixCoordinateSnapshot(nodes);
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            [],
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixTemplates).toHaveLength(1);
        expect(container.varriLinearHelixTemplates[0].lastHorizontalRotation)
            .toBeUndefined();
        const centers = linearHelixPairCenters(
            nodes,
            [[1, 13], [2, 12], [5, 9]]
        );
        expect(Math.max(...centers.map(center => center.x)) -
            Math.min(...centers.map(center => center.x))).toBeCloseTo(0, 10);
        expect(Math.abs(centers.at(-1).y - centers[0].y)).toBeGreaterThan(1e-8);
        expectLinearHelixCoordinatesClose(coordinateSnapshot);
        handlers['tick.varriLinearHelix']();
        expectLinearHelixCoordinatesClose(coordinateSnapshot);
        expect(linearHelixListenerActions(force)).toEqual([
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
        ]);
        expect(force.start).toHaveBeenCalledTimes(1);
    });

    test('horizontalizes a rotated pure RRI stack with one rigid graph-wide transform', () => {
        const v = validateLinearHelixFixture('AAA&UUU', '(((&)))');
        const exteriorLabel = createLinearHelixTestLabel(3, 0, 0);
        const pointEntries = [
            [createLinearHelixTestNode(1, 0, 0, 0), { x: 0, y: -2 }],
            [createLinearHelixTestNode(9, 0, 0, 0), { x: 0, y: 2 }],
            [createLinearHelixTestNode(2, 0, 0, 0), { x: 4, y: -2 }],
            [createLinearHelixTestNode(8, 0, 0, 0), { x: 4, y: 2 }],
            [createLinearHelixTestNode(3, 0, 0, 0), { x: 8, y: -2 }],
            [createLinearHelixTestNode(7, 0, 0, 0), { x: 8, y: 2 }],
            [createLinearHelixTestNode(99, 0, 0, 0), { x: 13, y: 7 }],
            [exteriorLabel, { x: 8, y: -6 }],
        ];
        const nodes = pointEntries.map(([node]) => node);
        const currentAngle = 2 * Math.PI / 3;
        const previousAngle = 5 * Math.PI / 9;
        pointEntries.forEach(([node, point]) => {
            const current = linearHelixTransformPoint(
                point,
                currentAngle,
                { x: 30, y: -10 }
            );
            const previous = linearHelixTransformPoint(
                point,
                previousAngle,
                { x: -12, y: 25 }
            );
            node.x = current.x;
            node.y = current.y;
            node.px = previous.x;
            node.py = previous.y;
        });
        const basepairLink = {
            source: linearHelixNode(nodes, 1),
            target: linearHelixNode(nodes, 9),
            linkType: 'basepair',
        };
        const labelLink = {
            source: linearHelixNode(nodes, 3),
            target: exteriorLabel,
            value: 1,
            linkType: 'label_link',
        };
        const links = [basepairLink, labelLink];
        const currentDistances = linearHelixPairwiseDistanceSnapshot(nodes);
        const previousDistances = linearHelixPairwiseDistanceSnapshot(nodes, 'px', 'py');
        const exteriorScoreBefore = linearHelixExteriorScore(
            exteriorLabel,
            linearHelixNode(nodes, 3),
            linearHelixNode(nodes, 7)
        );
        const nodeElements = nodes.map(node => ({
            __data__: node,
            attributes: {},
            setAttribute: jest.fn(function setAttribute(name, value) {
                this.attributes[name] = value;
            }),
        }));
        const linkElements = links.map(link => ({
            __data__: link,
            attributes: {},
            setAttribute: jest.fn(function setAttribute(name, value) {
                this.attributes[name] = value;
            }),
        }));
        const hadDocument = Object.prototype.hasOwnProperty.call(global, 'document');
        const previousDocument = global.document;
        global.document = {
            querySelectorAll: jest.fn(selector => {
                if (selector === 'g.gnode') return nodeElements;
                if (selector === 'line.link') return linkElements;
                return [];
            }),
        };

        try {
            const { container, force, handlers } = createLinearHelixTestContainer(
                nodes,
                links,
                4
            );

            expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
                .toBe(0);
            expect(container.graph.links).toBe(links);
            expect(container.varriLinearHelixConstraints).toEqual([]);
            expect(container.varriLinearHelixTemplates).toHaveLength(1);
            expect(container.varriLinearHelixTemplates[0]).toMatchObject({
                kind: 'rri',
                pairs: [[1, 9], [2, 8], [3, 7]],
                horizontalDirection: -1,
            });
            expect(container.varriLinearHelixTemplates[0].lastHorizontalRotation)
                .toBeCloseTo(Math.PI / 3, 10);
            expect(container.varriLinearHelixLabelBiases.map(bias => bias.label))
                .toEqual([exteriorLabel]);
            expectLinearHelixHorizontalAxis(
                nodes,
                [[1, 9], [2, 8], [3, 7]],
                'x',
                'y',
                -1
            );
            expectLinearHelixHorizontalAxis(
                nodes,
                [[1, 9], [2, 8], [3, 7]],
                'px',
                'py',
                -1
            );
            expectLinearHelixRailGeometry(
                nodes,
                [[1, 9], [2, 8], [3, 7]],
                [4, 4],
                4
            );
            expectLinearHelixRailGeometry(
                nodes,
                [[1, 9], [2, 8], [3, 7]],
                [4, 4],
                4,
                'px',
                'py'
            );
            expectLinearHelixPairwiseDistancesPreserved(currentDistances, nodes);
            expectLinearHelixPairwiseDistancesPreserved(
                previousDistances,
                nodes,
                'px',
                'py'
            );
            expect(linearHelixExteriorScore(
                exteriorLabel,
                linearHelixNode(nodes, 3),
                linearHelixNode(nodes, 7)
            )).toBeCloseTo(exteriorScoreBefore, 10);

            nodeElements.forEach(element => {
                expect(element.attributes.transform)
                    .toBe(`translate(${element.__data__.x},${element.__data__.y})`);
            });
            linkElements.forEach(element => {
                expect(element.attributes).toEqual({
                    x1: String(element.__data__.source.x),
                    y1: String(element.__data__.source.y),
                    x2: String(element.__data__.target.x),
                    y2: String(element.__data__.target.y),
                });
            });
            expect(linearHelixListenerActions(force)).toEqual([
                ['tick.varriLinearHelix', 'set'],
                ['end.varriLinearHelix', 'set'],
            ]);
            expect(force.start).toHaveBeenCalledTimes(1);

            const horizontalSnapshot = linearHelixCoordinateSnapshot(nodes);
            handlers['tick.varriLinearHelix']();
            expectLinearHelixCoordinatesClose(horizontalSnapshot);
            expect(container.varriLinearHelixTemplates[0].lastHorizontalRotation)
                .toBeCloseTo(0, 10);
            handlers['end.varriLinearHelix']();
            handlers['end.varriLinearHelix']();
            expectLinearHelixCoordinatesClose(horizontalSnapshot);
            expect(container.centerView).toHaveBeenCalledTimes(1);
        } finally {
            if (hadDocument) global.document = previousDocument;
            else delete global.document;
        }
    });

    test('repeated application replaces old listeners and metadata, then clears them', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, -4, -3, 0),
            createLinearHelixTestNode(13, -2, 2, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(12, 10, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(9, 10, 12, 0),
        ];
        const links = [{ linkType: 'backbone' }];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links,
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        const firstConstraints = container.varriLinearHelixConstraints;
        const firstTemplates = container.varriLinearHelixTemplates;
        const firstLabelBiases = container.varriLinearHelixLabelBiases;
        const firstTick = handlers['tick.varriLinearHelix'];
        const firstEnd = handlers['end.varriLinearHelix'];

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixConstraints).not.toBe(firstConstraints);
        expect(container.varriLinearHelixTemplates).not.toBe(firstTemplates);
        expect(container.varriLinearHelixLabelBiases).not.toBe(firstLabelBiases);
        expect(handlers['tick.varriLinearHelix']).not.toBe(firstTick);
        expect(handlers['end.varriLinearHelix']).not.toBe(firstEnd);
        expect(linearHelixListenerActions(force)).toEqual([
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
            ['tick.varriLinearHelix', 'clear'],
            ['end.varriLinearHelix', 'clear'],
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
        ]);
        expect(force.start).toHaveBeenCalledTimes(2);

        expect(vaRRI.applyLinearHelixSprings(container, v, {})).toBe(0);
        expect(container.varriLinearHelixConstraints).toBeUndefined();
        expect(container.varriLinearHelixTemplates).toBeUndefined();
        expect(container.varriLinearHelixLabelBiases).toBeUndefined();
        expect(handlers).toEqual({});
        expect(linearHelixListenerActions(force).slice(-2)).toEqual([
            ['tick.varriLinearHelix', 'clear'],
            ['end.varriLinearHelix', 'clear'],
        ]);
        expect(force.start).toHaveBeenCalledTimes(2);
        expect(container.graph.links).toBe(links);
    });

    test('orients current and previous clouds independently without distortion', () => {
        const v = validateLinearHelixFixture('AAAAA&UUUUU', '((..(&)..))');
        const nodes = [
            createLinearHelixTestNode(1, 0, -2, 0),
            createLinearHelixTestNode(13, 0, 2, 0),
            createLinearHelixTestNode(2, 4, -2, 0),
            createLinearHelixTestNode(12, 4, 2, 0),
            createLinearHelixTestNode(5, 16, -2, 0),
            createLinearHelixTestNode(9, 16, 2, 0),
        ];
        nodes.forEach(node => {
            const currentX = node.x;
            const currentY = node.y;
            node.px = 30 - currentY;
            node.py = currentX - 7;
        });
        const currentDistances = linearHelixPairwiseDistanceSnapshot(nodes);
        const previousDistances = linearHelixPairwiseDistanceSnapshot(nodes, 'px', 'py');
        const { container } = createLinearHelixTestContainer(nodes, [], 4);

        expect(vaRRI.applyLinearHelixSprings(container, v, { rri: true }))
            .toBe(2);
        expect(container.varriLinearHelixTemplates[0].reflection).toBe(1);
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            [4, 12],
            4,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'x',
            'y',
            1
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[1, 13], [2, 12], [5, 9]],
            'px',
            'py',
            1
        );
        expectLinearHelixPairwiseDistancesPreserved(currentDistances, nodes);
        expectLinearHelixPairwiseDistancesPreserved(
            previousDistances,
            nodes,
            'px',
            'py'
        );
    });

    test('projects a clean structure stem despite an unrelated crossing pair', () => {
        const structure = '((..(..)..))..([)]';
        const v = validateLinearHelixFixture('A'.repeat(structure.length), structure);
        const nodes = [
            createLinearHelixTestNode(1, -4, -3, 0),
            createLinearHelixTestNode(12, -2, 2, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(11, 10, 0, 0),
            createLinearHelixTestNode(5, 3, 4, 0),
            createLinearHelixTestNode(8, 10, 12, 0),
            createLinearHelixTestNode(15, 100, 0, 0),
            createLinearHelixTestNode(17, 100, 10, 0),
            createLinearHelixTestNode(16, 110, 0, 0),
            createLinearHelixTestNode(18, 110, 10, 0),
        ];
        const crossingNumbers = new Set([15, 16, 17, 18]);
        const crossingSnapshot = nodes
            .filter(node => crossingNumbers.has(node.num))
            .map(node => ({ ...node }));
        const links = [{ linkType: 'basepair' }];
        const { container, force } = createLinearHelixTestContainer(
            nodes,
            links,
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { structure: true }))
            .toBe(2);
        expect(linearHelixConstraintSummary(container.varriLinearHelixConstraints))
            .toEqual([
                {
                    endpoints: [2, 5],
                    kind: 'structure',
                    loop: 'structure:1:0',
                    type: 'structure_linear',
                    target: 12,
                    value: 3,
                },
                {
                    endpoints: [8, 11],
                    kind: 'structure',
                    loop: 'structure:1:0',
                    type: 'structure_linear',
                    target: 12,
                    value: 3,
                },
            ]);
        expect(container.varriLinearHelixTemplates).toHaveLength(1);
        expect(container.varriLinearHelixTemplates[0]).toMatchObject({
            kind: 'structure',
            sequence: '1',
            pairs: [[1, 12], [2, 11], [5, 8]],
        });
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 12], [2, 11], [5, 8]],
            [4, 12],
            4
        );
        expect(nodes.filter(node => crossingNumbers.has(node.num)))
            .toEqual(crossingSnapshot);
        nodes.filter(node => crossingNumbers.has(node.num)).forEach(node => {
            expect(node.varriLinearHelix).toBeUndefined();
            expect(node.varriLinearHelixKind).toBeUndefined();
        });
        expect(container.graph.links).toBe(links);
        expect(force.start).toHaveBeenCalledTimes(1);
    });

    test('does not globally orient a structure-only stem', () => {
        const v = validateLinearHelixFixture(
            'AAAAAAAAAAAA',
            '((..(..)..))'
        );
        const nodes = [
            createLinearHelixTestNode(1, -2, 0, 0),
            createLinearHelixTestNode(12, 2, 0, 0),
            createLinearHelixTestNode(2, -2, 4, 0),
            createLinearHelixTestNode(11, 2, 4, 0),
            createLinearHelixTestNode(5, -2, 16, 0),
            createLinearHelixTestNode(8, 2, 16, 0),
            createLinearHelixTestNode(99, 30, -20, 0),
        ];
        const coordinateSnapshot = linearHelixCoordinateSnapshot(nodes);
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            [],
            4
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, { structure: true }))
            .toBe(2);
        expect(container.varriLinearHelixTemplates).toHaveLength(1);
        expect(container.varriLinearHelixTemplates[0]).toMatchObject({
            kind: 'structure',
            sequence: '1',
            pairs: [[1, 12], [2, 11], [5, 8]],
        });
        expect(container.varriLinearHelixTemplates[0].lastHorizontalRotation)
            .toBeUndefined();
        const centers = linearHelixPairCenters(
            nodes,
            [[1, 12], [2, 11], [5, 8]]
        );
        expect(Math.max(...centers.map(center => center.x)) -
            Math.min(...centers.map(center => center.x))).toBeCloseTo(0, 10);
        expect(Math.abs(centers.at(-1).y - centers[0].y)).toBeGreaterThan(1e-8);
        expectLinearHelixCoordinatesClose(coordinateSnapshot);
        handlers['tick.varriLinearHelix']();
        expectLinearHelixCoordinatesClose(coordinateSnapshot);
        expect(linearHelixListenerActions(force)).toEqual([
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
        ]);
        expect(force.start).toHaveBeenCalledTimes(1);
    });

    test('combines RRI and structure rail templates without changing graph links', () => {
        const v = validateLinearHelixFixture(
            'AAAAAAAAAAAAAA&UU',
            '((...()))(...(&))'
        );
        const nodes = [
            createLinearHelixTestNode(1, -5, -5, 0),
            createLinearHelixTestNode(9, -4, -1, 0),
            createLinearHelixTestNode(2, 0, 0, 0),
            createLinearHelixTestNode(6, 3, 4, 0),
            createLinearHelixTestNode(7, 10, 0, 0),
            createLinearHelixTestNode(8, 10, 12, 0),
            createLinearHelixTestNode(10, 20, 0, 0),
            createLinearHelixTestNode(14, 20, 6, 0),
            createLinearHelixTestNode(18, 30, 0, 0),
            createLinearHelixTestNode(19, 38, 0, 0),
        ];
        const fixedSnapshot = nodes.map(node => [node.num, node.fixed]);
        const existing = { linkType: 'backbone' };
        const links = [existing];
        const { container, force, handlers } = createLinearHelixTestContainer(
            nodes,
            links,
            2
        );

        expect(vaRRI.applyLinearHelixSprings(container, v, {
            rri: true,
            structure: true,
        })).toBe(4);
        expect(container.graph.links).toBe(links);
        expect(container.graph.links[0]).toBe(existing);
        expect(container.graph.links).toHaveLength(1);
        expect(linearHelixConstraintSummary(container.varriLinearHelixConstraints))
            .toEqual([
                {
                    endpoints: [10, 14],
                    kind: 'rri',
                    loop: 'rri:0',
                    type: 'rri_linear',
                    target: 8,
                    value: 4,
                },
                {
                    endpoints: [18, 19],
                    kind: 'rri',
                    loop: 'rri:0',
                    type: 'rri_linear',
                    target: 8,
                    value: 4,
                },
                {
                    endpoints: [2, 6],
                    kind: 'structure',
                    loop: 'structure:1:0',
                    type: 'structure_linear',
                    target: 12,
                    value: 6,
                },
                {
                    endpoints: [7, 8],
                    kind: 'structure',
                    loop: 'structure:1:0',
                    type: 'structure_linear',
                    target: 12,
                    value: 6,
                },
            ]);
        expect(container.varriLinearHelixTemplates.map(template => template.kind))
            .toEqual(['rri', 'structure']);
        expectLinearHelixRailGeometry(
            nodes,
            [[10, 19], [14, 18]],
            [8],
            2
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[10, 19], [14, 18]],
            [8],
            2,
            'px',
            'py'
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 9], [2, 8], [6, 7]],
            [2, 12],
            2
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 9], [2, 8], [6, 7]],
            [2, 12],
            2,
            'px',
            'py'
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[10, 19], [14, 18]]
        );
        expectLinearHelixHorizontalAxis(
            nodes,
            [[10, 19], [14, 18]],
            'px',
            'py'
        );
        handlers['tick.varriLinearHelix']();
        expectLinearHelixHorizontalAxis(
            nodes,
            [[10, 19], [14, 18]]
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 9], [2, 8], [6, 7]],
            [2, 12],
            2
        );
        expectLinearHelixRailGeometry(
            nodes,
            [[1, 9], [2, 8], [6, 7]],
            [2, 12],
            2,
            'px',
            'py'
        );
        expect(nodes.map(node => [node.num, node.fixed])).toEqual(fixedSnapshot);
        expect(container.varriLinearHelixConstraints.every(constraint =>
            !container.graph.links.includes(constraint)
        )).toBe(true);
        expect(container.linkStrengths).toEqual({ backbone: 10 });
        expect(linearHelixListenerActions(force)).toEqual([
            ['tick.varriLinearHelix', 'set'],
            ['end.varriLinearHelix', 'set'],
        ]);
        expect(typeof handlers['tick.varriLinearHelix']).toBe('function');
        expect(typeof handlers['end.varriLinearHelix']).toBe('function');
        expect(force.start).toHaveBeenCalledTimes(1);
        expect(container.update).not.toHaveBeenCalled();
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
