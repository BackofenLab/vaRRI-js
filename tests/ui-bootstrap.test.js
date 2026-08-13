'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installDomGlobals(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  global.FileReader = dom.window.FileReader;
  global.ResizeObserver = ResizeObserverStub;
  dom.window.ResizeObserver = ResizeObserverStub;
}

test('boots through bound UI actions without inline handlers', async () => {
  jest.resetModules();
  const vaRRI = require('../src/vaRRI.js');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  installDomGlobals(dom);
  global.vaRRI = vaRRI;

  const renderSpy = jest.spyOn(vaRRI, 'render').mockResolvedValue({ cancelled: false });
  require('../index.js');

  window.dispatchEvent(new window.Event('load'));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(renderSpy).toHaveBeenCalled();
  expect(document.getElementById('msg').textContent).toContain('Visualisation ready');
  expect(document.getElementById('sequence').value).not.toBe('');
  expect(document.getElementById('subseqCounterUI').textContent).toBe('(2)');
  expect(document.getElementById('regionCounterUI').textContent).toBe('(1)');
  expect(document.getElementById('mutationCounterUI').textContent).toBe('(2)');

  const dropdown = document.getElementById('exampleDropdown');
  const trigger = document.getElementById('exampleDropdownTrigger');
  const options = document.getElementById('exampleDropdownOptions');
  const exampleButtons = [...options.querySelectorAll('[data-example]')];

  expect(exampleButtons).toHaveLength(3);
  exampleButtons.forEach(button => {
    expect(button.querySelector('.example-option-name').textContent.trim()).not.toBe('');
    expect(button.querySelector('.example-option-description').textContent.trim()).not.toBe('');
  });

  const defaultButton = options.querySelector('[data-example="2mol"]');
  const defaultName = defaultButton.querySelector('.example-option-name').textContent;
  const defaultDescription = defaultButton.querySelector('.example-option-description').textContent;
  expect(document.getElementById('selectedExampleName').textContent).toBe(defaultName);
  expect(trigger.textContent.trim()).toBe(defaultName);
  expect(trigger.textContent).not.toContain(defaultDescription);
  expect(defaultButton.getAttribute('aria-current')).toBe('true');

  const freeTails = document.getElementById('forceLayoutFreeTails');
  const pullCrossing = document.getElementById('forceLayoutPullCrossing');
  freeTails.checked = true;
  pullCrossing.checked = true;

  dropdown.open = true;
  const pseudoknotButton = options.querySelector('[data-example="pseudoknot"]');
  pseudoknotButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(dropdown.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(trigger.textContent.trim()).toBe('RNA pseudoknot');
  expect(trigger.textContent).not.toContain('crossing base pairs');
  expect(pseudoknotButton.getAttribute('aria-current')).toBe('true');
  expect(document.getElementById('sequence').value).toBe('ACGUACGUACGUA');
  expect(document.getElementById('structure').value).toBe('((.[[..))..]]');
  expect(document.getElementById('cropping').value).toBe('-1');
  expect(document.getElementById('forceLayout').checked).toBe(false);
  expect(freeTails.checked).toBe(false);
  expect(freeTails.disabled).toBe(true);
  expect(pullCrossing.checked).toBe(false);
  expect(pullCrossing.disabled).toBe(true);
  expect(document.getElementById('subseqCounterUI').textContent).toBe('');
  expect(document.getElementById('regionCounterUI').textContent).toBe('');
  expect(document.getElementById('mutationCounterUI').textContent).toBe('');

  dropdown.open = true;
  dropdown.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(dropdown.open).toBe(false);

  dropdown.open = true;
  document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  expect(dropdown.open).toBe(false);

  document.getElementById('clearAllBtn').click();
  expect(document.getElementById('sequence').value).toBe('');
  expect(document.getElementById('subseqCounterUI').textContent).toBe('');
  expect(document.getElementById('selectedExampleName').textContent).toBe('Select an example');
  expect(options.querySelectorAll('[aria-current="true"]')).toHaveLength(0);

  dom.window.close();
});
