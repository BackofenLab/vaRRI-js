const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const { releaseMetadata } = require('../scripts/release-metadata.cjs');

describe('npm package publication', () => {
    test('declares the public package metadata and supported entry points', () => {
        expect(packageJson.name).toBe('varri');
        expect(packageJson.license).toBe('MIT');
        expect(packageJson.repository.url).toBe('git+https://github.com/BackofenLab/vaRRI.git');
        expect(packageJson.main).toBe('src/vaRRI.js');
        expect(packageJson.exports['.']).toBe('./src/vaRRI.js');
        expect(packageJson.exports['./fornac/fornac.css']).toBe('./fornac/fornac.css');
        expect(packageJson.publishConfig.access).toBe('public');
    });

    test('all non-generated exported files exist in a clean checkout', () => {
        const generatedExports = new Set([
            './dist/vaRRI.min.js',
            './dist/vaRRI.min.js.map',
        ]);

        Object.values(packageJson.exports)
            .filter(exportPath => !generatedExports.has(exportPath))
            .forEach(exportPath => {
                expect(fs.existsSync(path.join(root, exportPath))).toBe(true);
            });
    });

    test('publishes GitHub releases with the release tag as the package version', () => {
        const workflow = fs.readFileSync(
            path.join(root, '.github/workflows/publish-npm.yml'),
            'utf8'
        );

        expect(workflow).toMatch(/release:\s*\n\s+types: \[published\]/);
        expect(workflow).toContain('npm run test:ci');
        expect(workflow).toContain('node scripts/release-metadata.cjs');
        expect(workflow).toContain('npm run test:package');
        expect(workflow).toContain('npm publish');
    });

    test.each([
        ['v1.0.1', false, '1.0.1', 'latest'],
        ['1.2.0', false, '1.2.0', 'latest'],
        ['v2.0.0-beta.1', false, '2.0.0-beta.1', 'next'],
        ['v2.0.0', true, '2.0.0', 'next'],
        ['v1.0.1+build-5', false, '1.0.1+build-5', 'latest'],
    ])('maps release %s to an npm version and distribution tag', (tag, prerelease, version, npmTag) => {
        expect(releaseMetadata(tag, prerelease)).toEqual({ version, npmTag });
    });

    test.each(['latest', 'v01.2.3', 'v1.0.0-beta.01', '1.0', '--help', '1.0.0\nnext', undefined])(
        'rejects invalid release tag %s before running npm', tag => {
            expect(() => releaseMetadata(tag)).toThrow('semantic version');
        }
    );
});
