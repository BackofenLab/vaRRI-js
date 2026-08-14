'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf8');
const library = fs.readFileSync(path.resolve(__dirname, '../src/vaRRI.js'), 'utf8');
const apiDocs = fs.readFileSync(path.resolve(__dirname, '../src/README.md'), 'utf8');
const pagesWorkflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/pages.yml'), 'utf8');
const testWorkflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/test.yml'), 'utf8');
const packageConfig = require('../package.json');

describe('UI document structure', () => {

  test('uses source locally and the minified library on GitHub Pages', () => {
    const minifyCommand = 'npx esbuild src/vaRRI.js --minify --sourcemap --outfile=dist/vaRRI.min.js';
    const swapCommand = "sed -i 's|src/vaRRI.js|dist/vaRRI.min.js|g' index.html";
    const uploadStep = 'uses: actions/upload-pages-artifact@v5';

    expect(html).toContain('<script src="src/vaRRI.js"></script>');
    expect(pagesWorkflow).toContain(minifyCommand);
    expect(pagesWorkflow).toContain(swapCommand);
    expect(pagesWorkflow.indexOf(minifyCommand)).toBeLessThan(pagesWorkflow.indexOf(swapCommand));
    expect(pagesWorkflow.indexOf(swapCommand)).toBeLessThan(pagesWorkflow.indexOf(uploadStep));
  });

  test('runs the complete test suite with an environment diagnostic', () => {
    expect(packageConfig.jest.globalSetup).toBe('<rootDir>/tests/jest-global-setup.js');
    expect(testWorkflow).toMatch(/run:\s+npm test -- --runInBand/);
    expect(testWorkflow).not.toMatch(/jest\s+tests\/vaRRI\.test\.js/);
  });

  test('keeps behavior and presentation out of the HTML', () => {
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });

  test('keeps example options out of the static HTML', () => {
    expect(html).toContain('<details id="exampleDropdown" class="example-dropdown">');
    expect(html).toMatch(/<summary[^>]+aria-labelledby="exampleDropdownLabel selectedExampleName"/);
    expect(html).toContain('id="exampleDropdownOptions"');
    expect(html).not.toMatch(/\bdata-example=/);
  });

  test('uses unique element IDs', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('gives every repeated landmark a unique accessible name', () => {
    const asideLabels = [...html.matchAll(/<aside\b[^>]*\baria-label="([^"]+)"/g)]
      .map(match => match[1]);
    const asideCount = (html.match(/<aside\b/g) || []).length;

    expect(asideLabels).toHaveLength(asideCount);
    expect(new Set(asideLabels).size).toBe(asideLabels.length);
  });

  test('uses standards-compliant form and void-element markup', () => {
    expect(html).not.toMatch(/<(?:input|img|link|meta)\b[^>]*\/>/i);
    expect(html).not.toMatch(/<input\b[^>]*type="number"[^>]*\bsize=/i);
    expect(html).not.toMatch(/<textarea\b[^>]*\bwrap="?off/i);
  });

  test('defines the extracted utility classes', () => {
    ['btn-secondary', 'checkbox-row-nested', 'cite-note', 'cropping-value'].forEach(className => {
      expect(css).toContain(`.${className}`);
    });
  });

  test('documents every public API function', () => {
    const apiBlock = library.match(/const vaRRI = \{([\s\S]*?)\n    \};/);
    expect(apiBlock).not.toBeNull();

    const exportedFunctions = [...apiBlock[1].matchAll(/^\s{8}([A-Za-z][A-Za-z0-9]*),/gm)]
      .map(match => match[1]);
    expect(exportedFunctions.length).toBeGreaterThan(0);

    exportedFunctions.forEach(functionName => {
      expect(apiDocs).toContain(functionName);
    });
  });
});
