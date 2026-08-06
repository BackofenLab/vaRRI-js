'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

function installDomGlobals(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  global.FileReader = dom.window.FileReader;
}

test('boots through bound UI actions without inline handlers', async () => {
  jest.resetModules();
  const vaRRI = require('../src/vaRRI.js');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
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

  expect(renderSpy).toHaveBeenCalled();
  expect(document.getElementById('msg').textContent).toContain('Visualisation ready');
  expect(document.getElementById('sequence').value).not.toBe('');
  expect(document.getElementById('subseqCounterUI').textContent).toBe('(2)');
  expect(document.getElementById('regionCounterUI').textContent).toBe('(1)');
  expect(document.getElementById('mutationCounterUI').textContent).toBe('(2)');

  const rotationSlider = document.getElementById('rotationSlider');
  document.getElementById('rna_ss').innerHTML = '<svg></svg>';
  rotationSlider.value = '5';
  rotationSlider.dispatchEvent(new window.Event('input'));
  expect(rotationSpy).toHaveBeenLastCalledWith(
    'rna_ss',
    40,
    { mode: 'absolute' }
  );

  const linearLayout = document.getElementById('forceLayoutLinear');
  const forceLayout = document.getElementById('forceLayout');
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

  document.getElementById('clearAllBtn').click();
  expect(document.getElementById('sequence').value).toBe('');
  expect(document.getElementById('subseqCounterUI').textContent).toBe('');

  dom.window.close();
});
