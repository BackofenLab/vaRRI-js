'use strict';

const vaRRI = require('../src/vaRRI.js');
const examples = require('../examples-data.js');

describe('shared example catalog', () => {
  test('contains the feature overview and the two existing literature examples', () => {
    expect(Object.keys(examples)).toEqual([
      '2mol',
      'coronel-tellez-2022',
      'wu-2024',
    ]);

    const literatureIds = Object.entries(examples)
      .filter(([, example]) => example.originalFigure)
      .map(([id]) => id);

    expect(literatureIds).toEqual([
      'coronel-tellez-2022',
      'wu-2024',
    ]);
  });

  test.each(Object.entries(examples))('%s is a valid two-molecule RNA-RNA interaction', (_id, example) => {
    expect(example.name.trim()).not.toBe('');
    expect(example.description.trim()).not.toBe('');
    expect(example.vaRRIParams).toBeDefined();

    const { sequence, structure } = example.vaRRIParams;
    expect(sequence.split('&')).toHaveLength(2);
    expect(structure.split('&')).toHaveLength(2);
    expect(sequence.split('&').every(Boolean)).toBe(true);
    expect(structure.split('&').every(Boolean)).toBe(true);

    const validated = vaRRI.validate({
      sequence,
      structure,
      startIndex1: String(example.vaRRIParams.startIndex1 ?? 1),
      startIndex2: String(example.vaRRIParams.startIndex2 ?? 1),
      cropping: String(example.vaRRIParams.cropping ?? -1),
      coloring: example.vaRRIParams.coloring ?? 'strand',
      highlighting: example.vaRRIParams.highlighting ?? 'region',
      backgroundhighlighting: example.vaRRIParams.backgroundhighlighting ?? 'basepairs',
      guBasepairs: example.vaRRIParams.guBasepairs !== 0,
    });

    expect(validated.molecules).toBe('2');
  });

  test('literature URL parameters retain their showcased annotations', () => {
    expect(examples['coronel-tellez-2022'].vaRRIParams).toMatchObject({
      cropping: 3,
      highlighting: 'basepairs',
      backgroundhighlighting: 'nothing',
    });
    expect(examples['coronel-tellez-2022'].vaRRIParams.subseqHighlights.split(',')).toHaveLength(4);
    expect(examples['coronel-tellez-2022'].vaRRIParams.profileData1).not.toBe('');
    expect(examples['coronel-tellez-2022'].vaRRIParams.profileData2).not.toBe('');

    expect(examples['wu-2024'].vaRRIParams.subseqHighlights.split(',')).toHaveLength(1);
    expect(examples['wu-2024'].vaRRIParams.mutations.split(',')).toHaveLength(4);
  });
});
