const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require('../package.json');

describe('npm package publication', () => {
    test('declares the public package metadata and supported entry points', () => {
        expect(packageJson.name).toBe('varri-js');
        expect(packageJson.license).toBe('MIT');
        expect(packageJson.repository.url).toBe('git+https://github.com/BackofenLab/vaRRI-js.git');
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
        expect(workflow).toContain('npm version "$package_version" --no-git-tag-version --allow-same-version');
        expect(workflow).toContain('npm pack --dry-run');
        expect(workflow).toContain('npm publish');
        expect(workflow).toContain('secrets.NPM_TOKEN');
    });
});
