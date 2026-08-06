'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf8');
const library = fs.readFileSync(path.resolve(__dirname, '../src/vaRRI.js'), 'utf8');
const apiDocs = fs.readFileSync(path.resolve(__dirname, '../src/README.md'), 'utf8');
const examplesScript = fs.readFileSync(path.resolve(__dirname, '../examples.js'), 'utf8');

describe('UI document structure', () => {
  test('loads scripts explicitly and in dependency order', () => {
    const sources = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]
      .map(match => match[1]);

    expect(sources).toEqual([
      'fornac/d3.js',
      'fornac/fornac.js',
      'src/vaRRI.js',
      'index.js',
    ]);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  test('keeps behavior and presentation out of the HTML', () => {
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).not.toMatch(/\sstyle="/i);
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

  test('enables force-based linearization in the second literature example', () => {
    const secondExample = examplesScript.match(
      /id: "wu-2024",[\s\S]*?vaRRIParams:\s*\{([\s\S]*?)\n\s*\}\n\s*\}/
    );

    expect(secondExample).not.toBeNull();
    expect(secondExample[1]).toMatch(/forceLayout:\s*"on"/);
    expect(secondExample[1]).toMatch(/forceLayoutLinear:\s*"on"/);
  });
});
