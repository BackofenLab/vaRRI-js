/**
 * @jest-environment node
 */

'use strict';

/*
test('diagnostic environment check', () => {
  console.log('--- JEST DIAGNOSTIC LOG ---');
  console.log('Process Node Version:', process.version);
  console.log('Global Object Keys count:', Object.keys(global).length);
  console.log('Is window defined?', typeof window !== 'undefined');
  console.log('Is URLSearchParams on global?', typeof global.URLSearchParams !== 'undefined');
  console.log('---------------------------');
});


function createIndexHtmlSandbox() {
    const fieldsWithWrap = new Set([
        'structure',
        'sequence',
        'startIndex1',
        'startIndex2',
        'highlightSequence',
        'highlightRange',
        'highlightColor',
        'mutationSequence',
        'mutationPosition',
        'mutationBase',
        'mutationColor',
    ]);

    function makeWrap() {
        const tooltip = { textContent: '' };
        return {
            __tooltip: tooltip,
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
            },
            querySelector: jest.fn(() => tooltip),
        };
    }

    function makeElement(id, { value = '', checked = false, tagName = 'INPUT', type = 'text' } = {}) {
        const wrap = fieldsWithWrap.has(id) ? makeWrap() : null;
        return {
            id,
            value,
            checked,
            tagName,
            type,
            children: [],
            dataset: {},
            innerHTML: '',
            className: '',
            textContent: '',
            style: {},
            listeners: {},
            classList: {
                add: jest.fn(),
                remove: jest.fn(),
            },
            addEventListener(eventName, handler) {
                if (!this.listeners[eventName]) {
                    this.listeners[eventName] = [];
                }
                this.listeners[eventName].push(handler);
            },
            appendChild(child) {
                this.children.push(child);
                return child;
            },
            trigger(eventName, event = {}) {
                (this.listeners[eventName] || []).forEach(handler => handler(event));
            },
            closest(selector) {
                return selector === '.input-wrap' ? wrap : null;
            },
            querySelector: jest.fn(() => null),
            __wrap: wrap,
        };
    }

    const elements = {
        structure: makeElement('structure', { tagName: 'TEXTAREA' }),
        sequence: makeElement('sequence', { tagName: 'TEXTAREA' }),
        startIndex1: makeElement('startIndex1', { value: '1', type: 'number' }),
        startIndex2: makeElement('startIndex2', { value: '1', type: 'number' }),
        cropping: makeElement('cropping', { value: '-1', type: 'range' }),
        'cropping-value': makeElement('cropping-value', { tagName: 'SPAN' }),
        coloring: makeElement('coloring', { value: 'strand', tagName: 'SELECT' }),
        highlighting: makeElement('highlighting', { value: 'region', tagName: 'SELECT' }),
        backgroundhighlighting: makeElement('backgroundhighlighting', { value: 'basepairs', tagName: 'SELECT' }),
        guBasepairs: makeElement('guBasepairs', { checked: true, type: 'checkbox' }),
        highlightSequence: makeElement('highlightSequence', { value: '1', tagName: 'SELECT' }),
        highlightRange: makeElement('highlightRange', { value: '', type: 'text' }),
        highlightColor: makeElement('highlightColor', { value: '#000000', type: 'color' }),
        highlightEditId: makeElement('highlightEditId', { value: '', type: 'hidden' }),
        highlightSubmitBtn: makeElement('highlightSubmitBtn', { tagName: 'BUTTON' }),
        highlightCancelBtn: makeElement('highlightCancelBtn', { tagName: 'BUTTON' }),
        'highlight-list': makeElement('highlight-list', { tagName: 'UL' }),
        mutationSequence: makeElement('mutationSequence', { value: '1', tagName: 'SELECT' }),
        mutationPosition: makeElement('mutationPosition', { value: '', type: 'text' }),
        mutationBase: makeElement('mutationBase', { value: 'A', type: 'text' }),
        mutationColor: makeElement('mutationColor', { value: '#000000', type: 'color' }),
        mutationEditId: makeElement('mutationEditId', { value: '', type: 'hidden' }),
        mutationSubmitBtn: makeElement('mutationSubmitBtn', { tagName: 'BUTTON' }),
        mutationCancelBtn: makeElement('mutationCancelBtn', { tagName: 'BUTTON' }),
        'mutation-list': makeElement('mutation-list', { tagName: 'UL' }),
        animation: makeElement('animation', { type: 'checkbox' }),
        'color-seq1': makeElement('color-seq1', { value: '#000000', type: 'color' }),
        'color-seq2': makeElement('color-seq2', { value: '#000000', type: 'color' }),
        'color-intermol': makeElement('color-intermol', { value: '#000000', type: 'color' }),
        'color-bg': makeElement('color-bg', { value: '#000000', type: 'color' }),
        'color-basepair': makeElement('color-basepair', { value: '#000000', type: 'color' }),
        'rotation-slider': makeElement('rotation-slider', { value: '0', type: 'range' }),
        rna_ss: makeElement('rna_ss', { tagName: 'DIV' }),
        msg: makeElement('msg', { tagName: 'DIV' }),
        'profile-data-1': makeElement('profile-data-1', { tagName: 'TEXTAREA' }),
        'profile-data-2': makeElement('profile-data-2', { tagName: 'TEXTAREA' }),
        'profile-color-1': makeElement('profile-color-1', { value: '#000000', type: 'color' }),
        'profile-color-2': makeElement('profile-color-2', { value: '#000000', type: 'color' }),
        'profile-color-1-represents-one': makeElement('profile-color-1-represents-one', { checked: true, type: 'checkbox' }),
        'profile-color-2-represents-one': makeElement('profile-color-2-represents-one', { checked: true, type: 'checkbox' })
    };

    const loadHandlers = [];
    let nextTimerId = 1;
    const timers = new Map();
    const scheduledDelays = [];
    const highlightStore = [];
    let nextHighlightId = 1;
    const mutationStore = [];
    let nextMutationId = 1;
    const vaRRIStub = {
        getColors: jest.fn(() => ({
            sequence1: '#000000',
            sequence2: '#000000',
            intermolecularHighlight: '#000000',
            backgroundHighlight: '#000000',
            subsequenceHighlight: '#000000',
            basepair: '#000000',
        })),
        setColors: jest.fn(),
        validateSequenceInput: jest.fn(v => v),
        validateStructureInput: jest.fn(v => v),
        validateOffset: jest.fn(v => Number(v)),
        validate: jest.fn(args => args),
        render: jest.fn(() => Promise.resolve({ cancelled: false })),
        clearSubsequenceHighlights: jest.fn(() => {
            highlightStore.length = 0;
            nextHighlightId = 1;
        }),
        getSubsequenceHighlights: jest.fn(() =>
            highlightStore.map(h => ({ ...h, ranges: h.ranges.map(([a, b]) => [a, b]) }))
        ),
        registerSubsequenceHighlight: jest.fn((input) => {
            const item = {
                id: nextHighlightId++,
                sequence: String(input.sequence),
                ranges: [[1, 2]],
                rangeText: String(input.range),
                color: input.color || '#000000',
            };
            highlightStore.push(item);
            return { ...item, ranges: item.ranges.map(([a, b]) => [a, b]) };
        }),
        updateSubsequenceHighlight: jest.fn((id, patch) => {
            const idx = highlightStore.findIndex(h => h.id === id);
            if (idx === -1) throw new Error('not found');
            highlightStore[idx] = {
                ...highlightStore[idx],
                sequence: patch.sequence !== undefined ? String(patch.sequence) : highlightStore[idx].sequence,
                rangeText: patch.range !== undefined ? String(patch.range) : highlightStore[idx].rangeText,
                color: patch.color !== undefined ? patch.color : highlightStore[idx].color,
            };
            return { ...highlightStore[idx], ranges: highlightStore[idx].ranges.map(([a, b]) => [a, b]) };
        }),
        removeSubsequenceHighlight: jest.fn((id) => {
            const idx = highlightStore.findIndex(h => h.id === id);
            if (idx === -1) return false;
            highlightStore.splice(idx, 1);
            return true;
        }),
        clearPointMutations: jest.fn(() => {
            mutationStore.length = 0;
            nextMutationId = 1;
        }),
        getPointMutations: jest.fn(() =>
            mutationStore.map(m => ({ ...m }))
        ),
        registerPointMutation: jest.fn((input) => {
            const item = {
                id: nextMutationId++,
                sequence: String(input.sequence),
                position: Number(input.position),
                replacement: String(input.replacement),
                reference: 'A',
                nodeId: 1,
                color: input.color || '#000000',
                labelText: `A${Number(input.position)}${String(input.replacement)}`,
            };
            mutationStore.push(item);
            return { ...item };
        }),
        updatePointMutation: jest.fn((id, patch) => {
            const idx = mutationStore.findIndex(m => m.id === id);
            if (idx === -1) throw new Error('not found');
            mutationStore[idx] = {
                ...mutationStore[idx],
                sequence: patch.sequence !== undefined ? String(patch.sequence) : mutationStore[idx].sequence,
                position: patch.position !== undefined ? Number(patch.position) : mutationStore[idx].position,
                replacement: patch.replacement !== undefined ? String(patch.replacement) : mutationStore[idx].replacement,
                color: patch.color !== undefined ? patch.color : mutationStore[idx].color,
                labelText: `A${patch.position !== undefined ? Number(patch.position) : mutationStore[idx].position}${patch.replacement !== undefined ? String(patch.replacement) : mutationStore[idx].replacement}`,
            };
            return { ...mutationStore[idx] };
        }),
        removePointMutation: jest.fn((id) => {
            const idx = mutationStore.findIndex(m => m.id === id);
            if (idx === -1) return false;
            mutationStore.splice(idx, 1);
            return true;
        }),
        rotateVisualization: jest.fn(),
        normaliseRotationDegrees: jest.fn(v => v),
        downloadSVG: jest.fn(),
        downloadPNG: jest.fn(),
    };

    const sandbox = {
        
        console,
         // Add this line to explicitly pass it into the isolated VM context:
        URLSearchParams: URLSearchParams,   // Add these mocks to satisfy the .search lookup:
        location: { search: '?test=true' },
        document: {
            location: { search: '?test=true' },
            getElementById: jest.fn(id => elements[id] || null),
            querySelectorAll: jest.fn(() => []),
            createElement: jest.fn(tag => {
                if (tag === 'canvas') {
                    return {
                        width: 0,
                        height: 0,
                        getContext: () => ({
                            fillStyle: '',
                            fillRect: () => {},
                            getImageData: () => ({ data: [0, 0, 0, 255] }),
                        }),
                    };
                }

                return makeElement(`created-${tag}`, { tagName: tag.toUpperCase() });
            }),
        },
        window: {
            location: { search: '?test=true' },
            addEventListener: jest.fn((eventName, handler) => {
                if (eventName === 'load') {
                    loadHandlers.push(handler);
                }
            }),
        },
        setTimeout: jest.fn((handler, delay) => {
            const id = nextTimerId++;
            scheduledDelays.push(delay);
            timers.set(id, handler);
            return id;
        }),
        clearTimeout: jest.fn((id) => {
            timers.delete(id);
        }),
        vaRRI: vaRRIStub,
    };

    vm.createContext(sandbox);
    vm.runInContext(indexInlineScript, sandbox);

    function runPendingTimers() {
        const pending = Array.from(timers.entries());
        timers.clear();
        pending.forEach(([, handler]) => handler());
    }

    return { elements, loadHandlers, runPendingTimers, scheduledDelays, vaRRIStub };
}

describe('index.html auto visualization UI', () => {
    test('removes the manual visualization button', () => {
        expect(indexHTMLSource).not.toContain('▶ Visualise');
        expect(indexHTMLSource).not.toContain('onclick="runVisualization()"');
    });

    test('registers commit-based listeners for typed fields and change listeners for toggles', () => {
        const { elements, loadHandlers } = createIndexHtmlSandbox();
        const committedFields = ['structure', 'sequence', 'cropping', 'startIndex1', 'startIndex2', 'mutationPosition'];
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

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();

        committedFields.forEach(id => {
            expect(elements[id].listeners.input).toHaveLength(1);
            expect(elements[id].listeners.change).toHaveLength(1);
        });

        expect(elements.mutationPosition.listeners.input).toHaveLength(1);
        expect(elements.mutationPosition.listeners.change).toHaveLength(1);

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
        const { elements, loadHandlers, runPendingTimers, vaRRIStub } = createIndexHtmlSandbox();

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();
        vaRRIStub.validate.mockClear();
        vaRRIStub.render.mockClear();

        elements.structure.trigger('input');
        elements.startIndex1.trigger('input');
        runPendingTimers();

        expect(vaRRIStub.validate).not.toHaveBeenCalled();
        expect(vaRRIStub.render).not.toHaveBeenCalled();
    });

    test('rerenders on committed edits and keeps the container hidden until rendering finishes', async () => {
        const { elements, loadHandlers, vaRRIStub } = createIndexHtmlSandbox();
        const renderResult = {};
        let resolveRender;

        vaRRIStub.render.mockImplementation(() => new Promise(resolve => {
            resolveRender = resolve;
        }));

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();
        vaRRIStub.validate.mockClear();
        vaRRIStub.render.mockClear();

        elements.startIndex1.trigger('keydown', { key: 'Enter' });

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(1);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(1);
        expect(elements.rna_ss.style.visibility).toBe('hidden');

        resolveRender(renderResult);
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));

        expect(elements.rna_ss.style.visibility).toBe('');
        expect(elements.msg.textContent).toBe('Visualisation ready. Use the export buttons to save.');

        elements.startIndex1.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(1);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(1);

        elements.structure.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(2);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(2);

        elements.coloring.trigger('change');

        expect(vaRRIStub.validate).toHaveBeenCalledTimes(3);
        expect(vaRRIStub.render).toHaveBeenCalledTimes(3);
    });

    test('clears highlight form fields after successful add', () => {
        const { elements, loadHandlers, vaRRIStub } = createIndexHtmlSandbox();

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();

        elements.highlightSequence.value = '2';
        elements.highlightRange.value = '3-8';
        elements.highlightColor.value = '#112233';

        elements.highlightSubmitBtn.trigger('click', {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(vaRRIStub.registerSubsequenceHighlight).toHaveBeenCalledTimes(1);
        expect(elements.highlightEditId.value).toBe('');
        expect(elements.highlightSequence.value).toBe('1');
        expect(elements.highlightRange.value).toBe('');
        expect(elements.highlightSubmitBtn.textContent).toBe('Add');
    });

    test('clears mutation form fields after successful add', () => {
        const { elements, loadHandlers, vaRRIStub } = createIndexHtmlSandbox();

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();

        elements.mutationSequence.value = '2';
        elements.mutationPosition.value = '7';
        elements.mutationBase.value = 'G';
        elements.mutationColor.value = '#223344';

        elements.mutationSubmitBtn.trigger('click', {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(vaRRIStub.registerPointMutation).toHaveBeenCalledTimes(1);
        expect(elements.mutationEditId.value).toBe('');
        expect(elements.mutationSequence.value).toBe('1');
        expect(elements.mutationPosition.value).toBe('');
        expect(elements.mutationBase.value).toBe('A');
        expect(elements.mutationSubmitBtn.textContent).toBe('Add');
    });
 
    test('shows invalid range message on range input when parser mentions sequence indices', () => {
        const { elements, loadHandlers, vaRRIStub } = createIndexHtmlSandbox();

        expect(loadHandlers).toHaveLength(1);
        loadHandlers[0]();
        elements.sequence1 = 'ACGU';
        elements.highlightRange.value = '-2-3';
        vaRRIStub.registerSubsequenceHighlight.mockImplementation(() => {
            throw new Error('Invalid subsequence range: "-2-3". Range endpoints must be valid sequence indices.');
        });

        elements.highlightSubmitBtn.trigger('click', {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(elements.highlightRange.__wrap.classList.add).toHaveBeenCalledWith('has-error');
        expect(elements.highlightRange.__wrap.__tooltip.textContent).toMatch(/valid sequence indices/);
    });
});
*/