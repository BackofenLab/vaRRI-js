'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const examplesScript = fs.readFileSync(path.resolve(__dirname, '../examples.js'), 'utf8');

function installDomGlobals(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  global.FileReader = dom.window.FileReader;
}

function removeDomGlobals() {
  delete global.window;
  delete global.document;
  delete global.Event;
  delete global.FileReader;
  delete global.vaRRI;
}

describe('Linear RRI UI integration', () => {
  let dom;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    if (dom) dom.window.close();
    removeDomGlobals();
  });

  test('keeps linear mode selectable and composes automatic with manual rotation', async () => {
    jest.resetModules();
    const vaRRI = require('../src/vaRRI.js');
    dom = new JSDOM(html, { url: 'http://localhost/' });
    installDomGlobals(dom);
    global.vaRRI = vaRRI;

    const renderSpy = jest.spyOn(vaRRI, 'render').mockResolvedValue({
      cancelled: false,
      rotationDegrees: 35,
    });
    const rotationSpy = jest.spyOn(vaRRI, 'rotateVisualization').mockReturnValue(40);
    require('../index.js');

    window.dispatchEvent(new window.Event('load'));
    await new Promise(resolve => setTimeout(resolve, 0));

    const linearLayout = document.getElementById('forceLayoutLinear');
    const forceLayout = document.getElementById('forceLayout');
    expect(linearLayout).not.toBeNull();

    forceLayout.checked = false;
    forceLayout.dispatchEvent(new window.Event('change'));
    expect(linearLayout.disabled).toBe(false);
    expect(linearLayout.checked).toBe(false);

    linearLayout.checked = true;
    linearLayout.dispatchEvent(new window.Event('change'));
    expect(forceLayout.checked).toBe(true);
    expect(renderSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ forceLayout: true, forceLayoutLinear: true })
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    document.getElementById('rna_ss').innerHTML = '<svg></svg>';
    const rotationSlider = document.getElementById('rotationSlider');
    rotationSlider.value = '5';
    rotationSlider.dispatchEvent(new window.Event('input'));
    expect(rotationSpy).toHaveBeenLastCalledWith('rna_ss', 40, { mode: 'absolute' });
  });

  test('enables force-based linearization in the literature example', () => {
    const secondExample = examplesScript.match(
      /id: "wu-2024",[\s\S]*?vaRRIParams:\s*\{([\s\S]*?)\n\s*\}\n\s*\}/
    );

    expect(secondExample).not.toBeNull();
    expect(secondExample[1]).toMatch(/forceLayout:\s*"on"/);
    expect(secondExample[1]).toMatch(/forceLayoutLinear:\s*"on"/);
  });
});
