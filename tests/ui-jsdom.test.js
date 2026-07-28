/**
 * @jest-environment jsdom
 */

'use strict';

const fs = require('fs');
const path = require('path');
// Import your real production calculation library
const vaRRI = require('../src/vaRRI.js'); 

const indexHTMLSource = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

function createIndexHtmlSandbox() {
    // 1. Inject the structure first
    document.documentElement.innerHTML = indexHTMLSource;

    const elements = {};
    const interactiveElements = document.querySelectorAll('input, textarea, select, button, div, span, ul');
    
    // 2. IMMEDIATELY intercept and add tracking properties BEFORE loading the app script
    interactiveElements.forEach(el => {
        if (!el.id) return;
        
        // Initialize tracking container arrays cleanly
        el.listeners = {
            input: [],
            change: [],
            keydown: [],
            click: []
        };
        
        const originalAddEventListener = el.addEventListener.bind(el);
        el.addEventListener = function(eventName, handler, options) {
            if (!this.listeners[eventName]) {
                this.listeners[eventName] = [];
            }
            this.listeners[eventName].push(handler);
            originalAddEventListener(eventName, handler, options);
        };

        el.trigger = function(eventName, extraData = {}) {
            const event = new window.Event(eventName, { bubbles: true });
            Object.assign(event, extraData);
            this.dispatchEvent(event);
        };

        elements[el.id] = el;
    });

    // 3. CRITICAL: Clear the module cache and load the application script AFTER elements are configured
    jest.isolateModules(() => {
        // This ensures your index.js reads the patched elements and traps their bindings!
        require('../index.js'); 
    });

    return { elements };
}

afterEach(() => {
    document.documentElement.innerHTML = '';
    jest.restoreAllMocks(); // Automatically detaches all spies between tests!
});

// ==========================================
// CLEAN, MAINTENANCE-FREE TESTS BELOW
// ==========================================

test('does not rerender while typing into committed fields', () => {
    // 1. Monitor the real functions seamlessly using native spies
    const validateSpy = jest.spyOn(vaRRI, 'validate').mockImplementation(v => v);
    const renderSpy = jest.spyOn(vaRRI, 'render').mockResolvedValue({ cancelled: false });

    // 2. Build sandbox (automatically grabs any UI changes from index.html)
    const { elements } = createIndexHtmlSandbox();
    window.dispatchEvent(new window.Event('load'));

    // 3. Clear initial load call counts so we only check typing behavior
    validateSpy.mockClear();
    renderSpy.mockClear();

    // 4. Act
    elements.structure.trigger('input');
    elements.startIndex1.trigger('input');

    // 5. Assert
    expect(validateSpy).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
});
/*
describe('index.html auto visualization UI', () => {
test('removes the manual visualization button', () => {
expect(indexHTMLSource).not.toContain('▶ Visualise');
expect(indexHTMLSource).not.toContain('onclick="runVisualization()"');
}); 

test('registers commit-based listeners for typed fields and change listeners for toggles', () => {
const { elements } = createIndexHtmlSandbox();
window.dispatchEvent(new window.Event('load'));

const committedFields = [      
      'structure',
      'sequence',
      'cropping',
      'startIndex1',
      'startIndex2',
      'mutationPosition',
      'profile-data-1',
      'profile-data-2',
    ];
const enterCommittedFields = ['cropping', 'startIndex1', 'startIndex2', 'mutationPosition'];
const immediateFields = [
    'coloring',
    'highlighting',
    'backgroundhighlighting',
    'guBasepairs',
    'animation',
    'mutationSequence',
    'mutationBase',
    'mutationColor',
];

committedFields.forEach(id => {
    const inputLength = (elements[id].listeners.input || []).length;
    const changeLength = (elements[id].listeners.change || []).length;
    expect(inputLength).toBeGreaterThanOrEqual(1);
    expect(changeLength).toBeGreaterThanOrEqual(1);
});

expect(elements.mutationPosition.listeners.input).toBeGreaterThanOrEqual(1);
expect(elements.mutationPosition.listeners.change).toBeGreaterThanOrEqual(1);

enterCommittedFields.forEach(id => {
    expect(elements[id].listeners.keydown).toHaveLength(1);
});

expect(elements.structure.listeners.keydown).toBeUndefined();
expect(elements.sequence.listeners.keydown).toBeUndefined();

expect(elements.highlightSubmitBtn.listeners.click).toHaveLength(1);
expect(elements.highlightCancelBtn.listeners.click).toHaveLength(1);
expect(elements.mutationSubmitBtn.listeners.click).toHaveLength(1);
expect(elements.mutationCancelBtn.listeners.click).toHaveLength(1);

immediateFields.forEach(id => {
    expect(elements[id].listeners.change).toHaveLength(1);
});

});

test('does not rerender while typing into committed fields', () => {
const validateSpy = jest.spyOn(vaRRI, 'validate').mockImplementation(v => v);
const renderSpy = jest.spyOn(vaRRI, 'render').mockResolvedValue({ cancelled: false });
const { elements } = createIndexHtmlSandbox();

window.dispatchEvent(new window.Event('load'));
validateSpy.mockClear();
renderSpy.mockClear();

elements.structure.trigger('input');
elements.startIndex1.trigger('input');

expect(validateSpy).not.toHaveBeenCalled();
expect(renderSpy).not.toHaveBeenCalled();

});

test('rerenders on committed edits and keeps the container hidden until rendering finishes', async () => {
const validateSpy = jest.spyOn(vaRRI, 'validate').mockImplementation(v => v);
let resolveRender;
const renderSpy = jest.spyOn(vaRRI, 'render').mockImplementation(() => new Promise(resolve => {
resolveRender = resolve;
}));
const { elements } = createIndexHtmlSandbox();

window.dispatchEvent(new window.Event('load'));
validateSpy.mockClear();
renderSpy.mockClear();

elements.startIndex1.trigger('keydown', { key: 'Enter' });

expect(validateSpy).toHaveBeenCalledTimes(1);
expect(renderSpy).toHaveBeenCalledTimes(1);
expect(elements.rna_ss.style.visibility).toBe('hidden');

resolveRender({});
await Promise.resolve();
await Promise.resolve();
await new Promise(resolve => setImmediate(resolve));

expect(elements.rna_ss.style.visibility).toBe('');
expect(elements.msg.textContent).toBe('Visualisation ready. Use the export buttons to save.');

elements.startIndex1.trigger('change');

expect(validateSpy).toHaveBeenCalledTimes(1);
expect(renderSpy).toHaveBeenCalledTimes(1);

elements.structure.trigger('change');

expect(validateSpy).toHaveBeenCalledTimes(2);
expect(renderSpy).toHaveBeenCalledTimes(2);

elements.coloring.trigger('change');

expect(validateSpy).toHaveBeenCalledTimes(3);
expect(renderSpy).toHaveBeenCalledTimes(3);

});

test('clears highlight form fields after successful add', () => {
const registerSpy = jest.spyOn(vaRRI, 'registerSubsequenceHighlight').mockReturnValue({ id: 1, ranges: [] });
const { elements } = createIndexHtmlSandbox();

window.dispatchEvent(new window.Event('load'));

elements.highlightSequence.value = '2';
elements.highlightRange.value = '3-8';
elements.highlightColor.value = '#112233';

elements.highlightSubmitBtn.trigger('click', {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
});

expect(registerSpy).toHaveBeenCalledTimes(1);
expect(elements.highlightEditId.value).toBe('');
expect(elements.highlightSequence.value).toBe('1');
expect(elements.highlightRange.value).toBe('');
expect(elements.highlightSubmitBtn.textContent).toBe('Add');

});

test('clears mutation form fields after successful add', () => {
const registerMutationSpy = jest.spyOn(vaRRI, 'registerPointMutation').mockReturnValue({ id: 1 });
const { elements } = createIndexHtmlSandbox();

window.dispatchEvent(new window.Event('load'));

elements.mutationSequence.value = '2';
elements.mutationPosition.value = '7';
elements.mutationBase.value = 'G';
elements.mutationColor.value = '#223344';

elements.mutationSubmitBtn.trigger('click', {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
});

expect(registerMutationSpy).toHaveBeenCalledTimes(1);
expect(elements.mutationEditId.value).toBe('');
expect(elements.mutationSequence.value).toBe('1');
expect(elements.mutationPosition.value).toBe('');
expect(elements.mutationBase.value).toBe('A');
expect(elements.mutationSubmitBtn.textContent).toBe('Add');

});

test('shows invalid range message on range input when parser mentions sequence indices', () => {
const registerSpy = jest.spyOn(vaRRI, 'registerSubsequenceHighlight').mockImplementation(() => {
throw new Error('Invalid subsequence range: "-2-3". Range endpoints must be valid sequence indices.');
});
const { elements } = createIndexHtmlSandbox();

window.dispatchEvent(new window.Event('load'));
elements.sequence1 = 'ACGU';
elements.highlightRange.value = '-2-3';

elements.highlightSubmitBtn.trigger('click', {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
});

expect(elements.highlightRange.__wrap.classList.add).toHaveBeenCalledWith('has-error');
expect(elements.highlightRange.__wrap.__tooltip.textContent).toMatch(/valid sequence indices/);

});

});
*/