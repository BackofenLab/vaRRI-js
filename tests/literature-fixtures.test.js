'use strict';

const fixtures = require('./fixtures/literature-interactions.json');
const vaRRI = require('../src/vaRRI.js');

const FORNAC_GAP_LENGTH = 3;
const CANONICAL_OR_WOBBLE = new Set(['AU', 'UA', 'GC', 'CG', 'GU', 'UG']);

function countAllPairs(structure) {
    return vaRRI.findBasePairs(structure.replace('&', '')).length;
}

describe('literature interaction fixtures', () => {
    test('carry stable, complete source references', () => {
        expect(fixtures.schemaVersion).toBe(1);
        expect(fixtures.cases).toHaveLength(113);
        expect(fixtures.sources['linearcofold-zenodo-8153422']).toMatchObject({
            archiveMd5: 'ae3d993e7d4413f1d0cffbb60fccce66',
            csvSha256: '0372618bcc1d52380728d97ada788029fda9f88731608f1e903caccd70e3c2e3'
        });

        const ids = fixtures.cases.map(fixture => fixture.id);
        expect(new Set(ids).size).toBe(ids.length);
        fixtures.cases.forEach(fixture => {
            expect(fixture.sourceIds.length).toBeGreaterThan(0);
            fixture.sourceIds.forEach(sourceId => {
                expect(fixtures.sources[sourceId]).toBeDefined();
            });
        });
    });

    test.each(fixtures.cases.map(fixture => [fixture.id, fixture]))(
        '%s validates and preserves its declared pair counts',
        (_id, fixture) => {
            const validated = vaRRI.validate(fixture.input);
            const [sequence1, sequence2] = fixture.input.sequence.split('&');
            const [structure1, structure2] = fixture.input.structure.split('&');

            expect([sequence1.length, sequence2.length]).toEqual(fixture.expected.sequenceLengths);
            expect(sequence1.length + sequence2.length).toBe(fixture.expected.combinedLength);
            expect(structure1.length).toBe(sequence1.length);
            expect(structure2.length).toBe(sequence2.length);
            expect(vaRRI.listIntermolPairs(validated)).toHaveLength(
                fixture.expected.intermolecularBasePairs
            );
            expect(countAllPairs(fixture.input.structure)).toBe(
                fixture.expected.intermolecularBasePairs + fixture.expected.intramolecularBasePairs
            );
        }
    );

    test('all 109 deposited Meyer records retain exact site notation and canonical pairing', () => {
        const meyerCases = fixtures.cases.filter(fixture => fixture.id.startsWith('meyer-'));
        expect(meyerCases).toHaveLength(109);

        meyerCases.forEach(fixture => {
            const validated = vaRRI.validate(fixture.input);
            const [structure1, structure2] = fixture.input.structure.split('&');
            const source = fixture.sourceRecord.interactionSite;
            const [start1, end1] = source.sequence1;
            const [start2, end2] = source.sequence2;

            expect(structure1.slice(start1 - 1, end1)).toBe(source.sourceNotation1);
            expect(structure2.slice(start2 - 1, end2)).toBe(source.sourceNotation2);

            const [sequence1, sequence2] = fixture.input.sequence.split('&');
            vaRRI.listIntermolPairs(validated).forEach(([firstNode, secondNode]) => {
                const firstBase = sequence1[firstNode - 1];
                const secondIndex = secondNode - sequence1.length - FORNAC_GAP_LENGTH - 1;
                const secondBase = sequence2[secondIndex];
                expect(CANONICAL_OR_WOBBLE.has(firstBase + secondBase)).toBe(true);
            });
        });
    });

    test('HIV kissing-loop fixtures retain crossing inter- and intramolecular helices', () => {
        const hivCases = fixtures.cases.filter(fixture => fixture.id.startsWith('hiv-dis-'));
        expect(hivCases).toHaveLength(2);
        hivCases.forEach(fixture => {
            expect(fixture.input.structure).toContain('[[[[[[');
            expect(fixture.input.structure).toContain(']]]]]]');
            expect(fixture.expected).toMatchObject({
                combinedLength: 46,
                intermolecularBasePairs: 6,
                intramolecularBasePairs: 14
            });
        });
    });
});
