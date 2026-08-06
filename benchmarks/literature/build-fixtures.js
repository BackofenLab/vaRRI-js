#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_DIR = __dirname;
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_OUTPUT = path.join(REPOSITORY_ROOT, 'tests', 'fixtures', 'literature-interactions.json');
const CANONICAL_OR_WOBBLE = new Set(['AU', 'UA', 'GC', 'CG', 'GU', 'UG']);

function fail(message) {
    throw new Error(message);
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (quoted) fail('CSV ends inside a quoted field');
    if (field || row.length) {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
    }
    return rows;
}

function csvObjects(text) {
    const rows = parseCsv(text);
    const headers = rows.shift();
    if (!headers || headers.length === 0) fail('CSV has no header');
    return rows.filter(row => row.some(Boolean)).map((row, index) => {
        if (row.length !== headers.length) {
            fail(`CSV row ${index + 2} has ${row.length} fields; expected ${headers.length}`);
        }
        return Object.fromEntries(headers.map((header, i) => [header, row[i]]));
    });
}

function positiveInteger(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) fail(`${label} is not a positive integer: ${value}`);
    return parsed;
}

function embedSite(length, start, end, notation, allowed, label) {
    if (notation.length !== end - start + 1) {
        fail(`${label} notation length ${notation.length} does not match ${start}-${end}`);
    }
    if (start < 1 || end > length || start > end) fail(`${label} coordinates are out of bounds`);
    if ([...notation].some(char => !allowed.has(char))) fail(`${label} contains unsupported notation`);
    return '.'.repeat(start - 1) + notation + '.'.repeat(length - end);
}

function countCharacters(value, character) {
    return [...value].filter(char => char === character).length;
}

function verifyCanonicalSitePairs(row, sequence1Start, sequence2Start) {
    const opens = [...row.srna_site_interaction]
        .flatMap((character, index) => character === '(' ? [index] : []);
    const closes = [...row.mrna_site_interaction]
        .flatMap((character, index) => character === ')' ? [index] : []);
    if (opens.length !== closes.length) fail(`Pair ${row.pair_id} has unbalanced site pair counts`);

    const pairs = opens.map((offset, index) => {
        const firstIndex = sequence1Start - 1 + offset;
        const secondOffset = closes[closes.length - 1 - index];
        const secondIndex = sequence2Start - 1 + secondOffset;
        const bases = row.srna_sequence[firstIndex] + row.mrna_sequence[secondIndex];
        if (!CANONICAL_OR_WOBBLE.has(bases)) {
            fail(`Pair ${row.pair_id} has noncanonical source pair ${bases} at ${firstIndex + 1}/${secondIndex + 1}`);
        }
        return [firstIndex + 1, secondIndex + 1, bases];
    });
    return pairs;
}

function buildMeyerFixture(row) {
    const sequence1Length = positiveInteger(row.srna_length, `Pair ${row.pair_id} sRNA length`);
    const sequence2Length = positiveInteger(row.mrna_length, `Pair ${row.pair_id} mRNA length`);
    const sequence1Start = positiveInteger(row.srna_site_start, `Pair ${row.pair_id} sRNA site start`);
    const sequence1End = positiveInteger(row.srna_site_end, `Pair ${row.pair_id} sRNA site end`);
    const sequence2Start = positiveInteger(row.mrna_site_start, `Pair ${row.pair_id} mRNA site start`);
    const sequence2End = positiveInteger(row.mrna_site_end, `Pair ${row.pair_id} mRNA site end`);

    if (row.srna_sequence.length !== sequence1Length) fail(`Pair ${row.pair_id} sRNA length mismatch`);
    if (row.mrna_sequence.length !== sequence2Length) fail(`Pair ${row.pair_id} mRNA length mismatch`);

    const structure1 = embedSite(
        sequence1Length,
        sequence1Start,
        sequence1End,
        row.srna_site_interaction,
        new Set(['.', '(']),
        `Pair ${row.pair_id} sRNA`
    );
    const structure2 = embedSite(
        sequence2Length,
        sequence2Start,
        sequence2End,
        row.mrna_site_interaction,
        new Set(['.', ')']),
        `Pair ${row.pair_id} mRNA`
    );
    const basePairs = verifyCanonicalSitePairs(row, sequence1Start, sequence2Start);

    return {
        id: `meyer-${String(row.pair_id).padStart(3, '0')}-${row.srna_name}-${row.mrna_name}`
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-'),
        title: `${row.srna_name}–${row.mrna_name}`,
        category: 'experimentally-validated-srna-mrna',
        sourceIds: ['linearcofold-2023', 'linearcofold-zenodo-8153422', 'lai-meyer-2016'],
        evidence: {
            level: 'experimentally validated interaction',
            annotationScope: 'intermolecular base pairs only',
            note: 'The source dataset has no intramolecular base-pair annotation; unannotated positions are represented as dots, not inferred as unpaired in vivo.'
        },
        sourceRecord: {
            file: 'Meyer_dataset.csv',
            row: Number(row.pair_id) + 1,
            pairId: positiveInteger(row.pair_id, 'pair ID'),
            species: row.species,
            genomeAccession: row.genome,
            sequence1: { name: row.srna_name, id: row.srna_id },
            sequence2: { name: row.mrna_name, id: row.mrna_id },
            interactionSite: {
                sequence1: [sequence1Start, sequence1End],
                sequence2: [sequence2Start, sequence2End],
                sourceNotation1: row.srna_site_interaction,
                sourceNotation2: row.mrna_site_interaction,
                sourceCanonicalFlag: row.site_canonical
            }
        },
        input: {
            sequence: `${row.srna_sequence}&${row.mrna_sequence}`,
            structure: `${structure1}&${structure2}`,
            startIndex1: 1,
            startIndex2: -positiveInteger(row.utr_length, `Pair ${row.pair_id} UTR length`),
            cropping: -1,
            highlighting: 'basepairs',
            backgroundhighlighting: 'nothing'
        },
        renderOptions: {
            forceLayout: true,
            forceLayoutLinear: true
        },
        expected: {
            sequenceLengths: [sequence1Length, sequence2Length],
            combinedLength: sequence1Length + sequence2Length,
            intermolecularBasePairs: basePairs.length,
            intramolecularBasePairs: 0,
            canonicalOrWobblePairs: basePairs.length
        }
    };
}

function extractGalleryExamples() {
    const filename = path.join(REPOSITORY_ROOT, 'examples.js');
    const source = fs.readFileSync(filename, 'utf8');
    const match = source.match(/const EXAMPLES\s*=\s*([\s\S]*?);\s*\n\s*function buildVaRRIUrl/);
    if (!match) fail('Could not locate EXAMPLES array in examples.js');
    return vm.runInNewContext(`(${match[1]})`, Object.create(null), { filename });
}

function basePairCounts(structure, sequence1Length) {
    const matching = { ')': '(', ']': '[', '}': '{', '>': '<' };
    const stacks = { '(': [], '[': [], '{': [], '<': [] };
    const bare = structure.replace('&', '');
    let intermolecular = 0;
    let intramolecular = 0;
    [...bare].forEach((character, index) => {
        if (stacks[character]) {
            stacks[character].push(index);
        } else if (matching[character]) {
            const start = stacks[matching[character]].pop();
            if (start === undefined) fail(`Unbalanced structure: ${structure}`);
            if ((start < sequence1Length) !== (index < sequence1Length)) intermolecular++;
            else intramolecular++;
        }
    });
    if (Object.values(stacks).some(stack => stack.length)) fail(`Unbalanced structure: ${structure}`);
    return { intermolecular, intramolecular };
}

function parseGallerySubsequenceHighlights(value) {
    if (!value) return [];
    return value.split(",").map(item => {
        const [sequence, range, color, alpha] = item.split(":");
        return {
            sequence,
            range,
            color: `#${color}`,
            ...(alpha === undefined ? {} : { alpha: Number(alpha) })
        };
    });
}

function parseGalleryMutations(value) {
    if (!value) return [];
    return value.split(",").map(item => {
        const [sequence, positionAndReplacement, color] = item.split(":");
        const match = positionAndReplacement.match(/^(-?\d+)([A-Za-z])$/);
        if (!match) fail(`Unsupported gallery mutation: ${item}`);
        return {
            sequence,
            position: Number(match[1]),
            replacement: match[2].toUpperCase(),
            color: `#${color}`
        };
    });
}

function buildGalleryFixtures() {
    return extractGalleryExamples().map(example => {
        const params = example.vaRRIParams;
        const [sequence1, sequence2] = params.sequence.split('&');
        const counts = basePairCounts(params.structure, sequence1.length);
        return {
            id: `gallery-${example.id}`,
            title: example.title,
            category: 'published-gallery-reproduction',
            sourceIds: [`gallery-source-${example.id}`],
            evidence: {
                level: 'published interaction model',
                annotationScope: 'the base-pair model encoded by the existing vaRRI literature reproduction',
                note: 'Imported programmatically from examples.js so the benchmark and public gallery cannot silently diverge.'
            },
            sourceRecord: {
                galleryExampleId: example.id,
                figure: example.originalFigure.title,
                figureUrl: example.originalFigure.url
            },
            input: {
                sequence: params.sequence,
                structure: params.structure,
                startIndex1: params.startIndex1 ?? 1,
                startIndex2: params.startIndex2 ?? 1,
                cropping: params.cropping ?? -1,
                highlighting: 'basepairs',
                backgroundhighlighting: 'nothing',
                subsequenceHighlights: parseGallerySubsequenceHighlights(params.subseqHighlights),
                pointMutations: parseGalleryMutations(params.mutations)
            },
            renderOptions: {
                forceLayout: true,
                forceLayoutLinear: true
            },
            expected: {
                sequenceLengths: [sequence1.length, sequence2.length],
                combinedLength: sequence1.length + sequence2.length,
                intermolecularBasePairs: counts.intermolecular,
                intramolecularBasePairs: counts.intramolecular
            }
        };
    });
}

function buildHivFixture({ id, subtype, pdb, sequence, resolution }) {
    const structure1 = '(((((((..[[[[[[.)))))))';
    const structure2 = '(((((((..]]]]]].)))))))';
    return {
        id,
        title: `HIV-1 subtype ${subtype} DIS kissing-loop homodimer`,
        category: 'experimentally-determined-kissing-loop',
        sourceIds: ['ennifar-dumas-2006', `rcsb-${pdb.toLowerCase()}`, 'reblova-2007'],
        evidence: {
            level: 'X-ray structure',
            annotationScope: 'seven intramolecular stem pairs per strand and six intermolecular kissing-loop pairs',
            note: 'Polymer sequence comes from the RCSB mmCIF entity record. Pair topology is cross-checked against Figure 1A of Réblová et al.; square brackets encode the crossing intermolecular helix.'
        },
        sourceRecord: {
            pdb,
            chains: ['A', 'B'],
            experimentalMethod: 'X-RAY DIFFRACTION',
            resolutionAngstrom: resolution,
            polymerSequence: sequence,
            nucleotideNumberingStart: 265
        },
        input: {
            sequence: `${sequence}&${sequence}`,
            structure: `${structure1}&${structure2}`,
            startIndex1: 265,
            startIndex2: 265,
            cropping: -1,
            highlighting: 'basepairs',
            backgroundhighlighting: 'nothing'
        },
        renderOptions: {
            forceLayout: true,
            forceLayoutLinear: true,
            pullPseudoknotBasepairs: true
        },
        expected: {
            sequenceLengths: [23, 23],
            combinedLength: 46,
            intermolecularBasePairs: 6,
            intramolecularBasePairs: 14,
            canonicalOrWobblePairs: 20
        }
    };
}

function buildSources(galleryExamples) {
    const gallerySources = Object.fromEntries(galleryExamples.map(example => [
        `gallery-source-${example.id}`,
        {
            type: 'publication figure',
            citation: `${example.authors}. ${example.title}.`,
            doi: example.doi.replace('http://dx.doi.org/', 'https://doi.org/'),
            figure: example.originalFigure.title,
            figureUrl: example.originalFigure.url
        }
    ]));
    return {
        'linearcofold-2023': {
            type: 'primary research article',
            citation: 'Zhang H, Li S, Dai N, Zhang L, Mathews DH, Huang L. LinearCoFold and LinearCoPartition: linear-time algorithms for secondary structure prediction of interacting RNA molecules. Nucleic Acids Research. 2023;51(18):e94.',
            doi: 'https://doi.org/10.1093/nar/gkad664',
            pmcid: 'PMC10570024',
            url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10570024/',
            relevance: 'Defines the deposited Meyer dataset as 109 bacterial sRNA–mRNA pairs with annotated intermolecular ground-truth base pairs and states that the interactions were experimentally validated with compensatory mutations.'
        },
        'linearcofold-zenodo-8153422': {
            type: 'author-deposited dataset',
            citation: 'Zhang H, Li S, Dai N, Zhang L, Mathews D, Huang L. LinearCoFold and LinearCoPartition dataset. Zenodo. 2023.',
            doi: 'https://doi.org/10.5281/zenodo.8153422',
            url: 'https://zenodo.org/records/8153422',
            file: 'data.zip/Meyer_dataset.csv',
            archiveMd5: 'ae3d993e7d4413f1d0cffbb60fccce66',
            archiveSha256: '95d901f0819451c5744f8348be10347b4bfe0538f58f0e088ecc27294533856c',
            csvSha256: '0372618bcc1d52380728d97ada788029fda9f88731608f1e903caccd70e3c2e3',
            accessDate: '2026-08-06',
            licenseIdInZenodoRecord: 'other-nc'
        },
        'lai-meyer-2016': {
            type: 'primary benchmark curation article',
            citation: 'Lai D, Meyer IM. A comprehensive comparison of general RNA–RNA interaction prediction methods. Nucleic Acids Research. 2016;44(7):e61.',
            doi: 'https://doi.org/10.1093/nar/gkv1477',
            pmcid: 'PMC4838349',
            url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4838349/'
        },
        'ennifar-dumas-2006': {
            type: 'primary structural article',
            citation: 'Ennifar E, Dumas P. Polymorphism of bulged-out residues in HIV-1 RNA DIS kissing complex and structure comparison with solution studies. Journal of Molecular Biology. 2006;356(3):771–782.',
            doi: 'https://doi.org/10.1016/j.jmb.2005.12.022',
            pubmed: '16403527'
        },
        'reblova-2007': {
            type: 'primary research article with secondary-structure cross-check',
            citation: 'Réblová K, Fadrná E, Sarzynska J, et al. Conformations of flanking bases in HIV-1 RNA DIS kissing complexes studied by molecular dynamics. Biophysical Journal. 2007;93(11):3932–3949.',
            doi: 'https://doi.org/10.1529/biophysj.107.110056',
            pmcid: 'PMC2099213',
            url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2099213/',
            figure: 'Figure 1A'
        },
        'rcsb-1xpf': {
            type: 'primary structure record',
            citation: 'RCSB PDB 1XPF: HIV-1 subtype A genomic RNA Dimerization Initiation Site.',
            doi: 'https://doi.org/10.2210/pdb1xpf/pdb',
            url: 'https://www.rcsb.org/structure/1XPF'
        },
        'rcsb-1xpe': {
            type: 'primary structure record',
            citation: 'RCSB PDB 1XPE: HIV-1 subtype B genomic RNA Dimerization Initiation Site.',
            doi: 'https://doi.org/10.2210/pdb1xpe/pdb',
            url: 'https://www.rcsb.org/structure/1XPE'
        },
        ...gallerySources
    };
}

function main() {
    const csvPath = process.argv[2];
    const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT);
    if (!csvPath) {
        fail('Usage: node benchmarks/literature/build-fixtures.js /path/to/Meyer_dataset.csv [output.json]');
    }

    const rows = csvObjects(fs.readFileSync(csvPath, 'utf8'));
    if (rows.length !== 109) fail(`Expected 109 Meyer sRNA–mRNA records, found ${rows.length}`);
    const galleryExamples = extractGalleryExamples();
    const cases = [
        ...rows.map(buildMeyerFixture),
        ...buildGalleryFixtures(),
        buildHivFixture({
            id: 'hiv-dis-1xpf-subtype-a',
            subtype: 'A',
            pdb: '1XPF',
            sequence: 'CUUGCUGAGGUGCACACAGCAAG',
            resolution: 2.30
        }),
        buildHivFixture({
            id: 'hiv-dis-1xpe-subtype-b',
            subtype: 'B',
            pdb: '1XPE',
            sequence: 'CUUGCUGAAGCGCGCACGGCAAG',
            resolution: 1.94
        })
    ];

    const document = {
        schemaVersion: 1,
        title: 'Literature-derived RNA–RNA interaction fixtures for vaRRI-js',
        generatedBy: 'benchmarks/literature/build-fixtures.js',
        generatedOn: '2026-08-06',
        curationRules: [
            'No base pairs are inferred from interaction-region coordinates alone.',
            'Meyer records preserve the deposited full sequences and site pairing strings exactly.',
            'Dots outside an annotated Meyer interaction mean “no base pair annotation in this dataset”, not experimental proof of an unpaired state.',
            'Every imported Meyer pair is independently checked for length, balanced pairing, and canonical or G–U complementarity.',
            'Gallery cases are imported from examples.js rather than retyped.',
            'HIV DIS sequences are copied from RCSB mmCIF polymer records and cross-checked against a published secondary-structure figure.'
        ],
        sources: buildSources(galleryExamples),
        cases
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n');
    process.stdout.write(`Wrote ${cases.length} validated literature fixtures to ${outputPath}\n`);
}

main();
