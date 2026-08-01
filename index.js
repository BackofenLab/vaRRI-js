// -------------------------------------------------------------------------
// Example data
// -------------------------------------------------------------------------
const EXAMPLES = {
'2mol': {
    structure: '..<<<<...>>>>...((..(((...((..&............))...)))..))..',
    sequence:  'ACGAUCAUGGAUUAGAGCAUUCGACAGCAG&ACGAAAAAAAGAGCAUACGACAGUAG',
    startIndex1: '-6', startIndex2: '100',
    coloring: 'strand', highlighting: 'region',
    backgroundhighlighting: 'basepairs', guBasepairs: true,
    cropping: '2',
    animation: false,
    regionHighlights: [
    { sequence1Range: '13-14', sequence2Range: '120-121', color: '#0d00ff', generated: false },
    ],
    subsequenceHighlights: [
    { sequence: '1', range: '18-20', color: '#338a29' },
    { sequence: '2', range: '114-116', color: '#338a29' },
    ],
    pointMutations: [
    { sequence: '1', position: 16, replacement: 'G', color: '#338a29' },
    { sequence: '2', position: 118, replacement: 'C', color: '#338a29' },
    ],
    profileColor1RepresentsOne: true,
    profileColor2RepresentsOne: false,
    profileData1: `# unpaired probabilities
1 0.9
2 0.7
3 0.3
4 0.1
7 0.3
8 0.7
9 0.6`,
    profileIndexReference1: '1',
},
'1mol': {
    profileData2: '',
    structure: '(((....)))',
    sequence:  'GGGCAAAACC',
    startIndex1: '1', startIndex2: '1',
    coloring: 'loop', highlighting: 'nothing',
    backgroundhighlighting: 'nothing', guBasepairs: false,
    subsequenceHighlights: [],
    pointMutations: [],
    profileColor1RepresentsOne: false,
    profileColor2RepresentsOne: false,
    profileData1: '',
    profileData2: '',
},
'pseudoknot': {
    structure: '((.[[..))..]]',
    sequence:  'ACGUACGUACGUA',
    startIndex1: '1', startIndex2: '1',
    coloring: 'loop', highlighting: 'nothing',
    backgroundhighlighting: 'nothing', guBasepairs: false,
    subsequenceHighlights: [],
    pointMutations: [],
    profileColor1RepresentsOne: false,
    profileColor2RepresentsOne: false,
    profileData1: '',
    profileData2: '',
},
};

function loadExample(key) {
const ex = EXAMPLES[key];
if (!ex) return;
document.getElementById('structure').value         = ex.structure;
document.getElementById('sequence').value          = ex.sequence;
document.getElementById('cropping').value          = ex.cropping;
document.getElementById('startIndex1').value       = ex.startIndex1;
document.getElementById('startIndex2').value       = ex.startIndex2;
document.getElementById('coloring').value          = ex.coloring;
document.getElementById('animation').checked       = !!ex.animation;
document.getElementById('highlighting').value      = ex.highlighting;
document.getElementById('backgroundhighlighting').value = ex.backgroundhighlighting;
document.getElementById('guBasepairs').checked     = ex.guBasepairs;
document.getElementById('profile-data-1').value    = ex.profileData1 || '';
document.getElementById('profile-idx-ref-1').value = ex.profileIndexReference1 || '1';
document.getElementById('profile-data-2').value    = ex.profileData2 || '';
document.getElementById('profile-idx-ref-2').value = ex.profileIndexReference2 || '1';
document.getElementById('profile-color-1-represents-one').checked = !!ex.profileColor1RepresentsOne;
document.getElementById('profile-color-2-represents-one').checked = !!ex.profileColor2RepresentsOne;
vaRRI.clearSubsequenceHighlights();
vaRRI.clearPointMutations();
vaRRI.clearRegionHighlights();

const exampleHighlights = Array.isArray(ex.subsequenceHighlights)
    ? ex.subsequenceHighlights
    : [];
if (exampleHighlights.length > 0) {
    const sequenceContext = getHighlightSequenceContext();
    exampleHighlights.forEach(highlight => {
    vaRRI.registerSubsequenceHighlight({
        sequence: highlight.sequence,
        range: highlight.range,
        color: highlight.color,
    }, sequenceContext);
    });
}

const exampleRegionHighlights = Array.isArray(ex.regionHighlights)
    ? ex.regionHighlights
    : [];
if (exampleRegionHighlights.length > 0) {
    const sequenceContext = getHighlightSequenceContext();
    exampleRegionHighlights.forEach(region => {
    vaRRI.registerRegionHighlight({
        sequence1Range: region.sequence1Range,
        sequence2Range: region.sequence2Range,
        color: region.color,
        generated: region.generated,
    }, sequenceContext);
    });
}

const exampleMutations = Array.isArray(ex.pointMutations)
    ? ex.pointMutations
    : [];
if (exampleMutations.length > 0) {
    const sequenceContext = getHighlightSequenceContext();
    exampleMutations.forEach(mutation => {
    vaRRI.registerPointMutation({
        sequence: mutation.sequence,
        position: mutation.position,
        replacement: mutation.replacement,
        color: mutation.color,
    }, sequenceContext);
    });
}


renderHighlightList();
renderRegionList();
renderMutationList();
resetHighlightForm();
resetRegionForm();
resetMutationForm();
runVisualization();
}

// -------------------------------------------------------------------------
// Colour helpers
// -------------------------------------------------------------------------

/**
 * Convert any CSS colour string (named, hex, rgb, etc.) to a 7-character
 * hex string suitable for <input type="color">.  Uses an off-screen canvas
 * so the browser does the conversion.
 *
 * @param {string} css  Any valid CSS colour value.
 * @returns {string}    Lowercase hex colour, e.g. "#ff0000".
 */
function cssColorToHex(css) {
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 1;
const ctx = canvas.getContext('2d');
ctx.fillStyle = css;
ctx.fillRect(0, 0, 1, 1);
const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Initialise each colour picker to the current vaRRI.js default. */
function initColorPickers() {
const c = vaRRI.getColors();
document.getElementById('color-seq1').value     = cssColorToHex(c.sequence1);
document.getElementById('color-seq2').value     = cssColorToHex(c.sequence2);
document.getElementById('profile-color-1').value = cssColorToHex(c.seq1profileColor);
document.getElementById('profile-color-2').value = cssColorToHex(c.seq2profileColor);
document.getElementById('profile-color-1-represents-one').checked = false;
document.getElementById('profile-color-2-represents-one').checked = false;
document.getElementById('mutationColor').value = getDefaultMutationColor();
document.getElementById('color-intermol').value = cssColorToHex(c.intermolecularHighlight);
document.getElementById('color-bg').value       = cssColorToHex(c.backgroundHighlight);
document.getElementById('highlightColor').value = getDefaultSubsequenceHighlightColor();
document.getElementById('regionColor').value = getDefaultRegionHighlightColor();
document.getElementById('color-basepair').value = cssColorToHex(c.basepair);
}

function getProfileAccessibilityColors() {
const defaults = vaRRI.getColors();
return {
    sequence1: document.getElementById('profile-color-1')?.value || cssColorToHex(defaults.seq1profileColor),
    sequence2: document.getElementById('profile-color-2')?.value || cssColorToHex(defaults.seq2profileColor),
};
}

function getProfileAccessibilityMode() {
return {
    sequence1RepresentsOne: !!document.getElementById('profile-color-1-represents-one')?.checked,
    sequence2RepresentsOne: !!document.getElementById('profile-color-2-represents-one')?.checked,
};
}

function applyColors() {
vaRRI.setColors({
    sequence1:              document.getElementById('color-seq1').value,
    sequence2:              document.getElementById('color-seq2').value,
    intermolecularHighlight: document.getElementById('color-intermol').value,
    backgroundHighlight:    document.getElementById('color-bg').value,
    subsequenceHighlight:   document.getElementById('highlightColor').value,
    basepair:               document.getElementById('color-basepair').value,
});
}

// -------------------------------------------------------------------------
// Main visualisation
// -------------------------------------------------------------------------
let currentContainerId = 'rna_ss';
let committedRotationDeg = 0;
let autoVisualizationTimeoutId = null;
let latestVisualizationRunId = 0;
const skipNextCommittedFieldChange = new WeakMap();
let defaultSubsequenceHighlightColor = null;
let defaultRegionHighlightColor = null;
let defaultMutationColor = null;

function getDefaultSubsequenceHighlightColor() {
if (defaultSubsequenceHighlightColor !== null) return defaultSubsequenceHighlightColor;
defaultSubsequenceHighlightColor = cssColorToHex(vaRRI.getColors().subsequenceHighlight);
return defaultSubsequenceHighlightColor;
}

function getDefaultRegionHighlightColor() {
if (defaultRegionHighlightColor !== null) return defaultRegionHighlightColor;
defaultRegionHighlightColor = cssColorToHex(vaRRI.getColors().backgroundHighlight);
return defaultRegionHighlightColor;
}

function getDefaultMutationColor() {
if (defaultMutationColor !== null) return defaultMutationColor;
defaultMutationColor = cssColorToHex(vaRRI.getColors().mutationColor);
return defaultMutationColor;
}

function showMsg(text, type) {
const el = document.getElementById('msg');
el.className = type;
el.textContent = text;
}

function clearMsg() {
const el = document.getElementById('msg');
el.className = '';
el.style.display = 'none';
}

function clearAll() {
document.getElementById('structure').value = '';
document.getElementById('sequence').value  = '';
document.getElementById('profile-data-1').value = '';
document.getElementById('profile-idx-ref-1').value = '1';
document.getElementById('profile-data-2').value = '';
document.getElementById('profile-idx-ref-2').value = '1';
document.getElementById('startIndex1').value = '1';
document.getElementById('startIndex2').value = '1';
vaRRI.clearSubsequenceHighlights();
vaRRI.clearRegionHighlights();
vaRRI.clearPointMutations();
renderHighlightList();
renderRegionList();
renderMutationList();
resetHighlightForm();
resetRegionForm();
resetMutationForm();
const container = document.getElementById('rna_ss');
container.innerHTML = '';
container.style.visibility = '';
resetCroppingControl();
resetRotationControl();
resetForceLayoutControl();
clearMsg();
clearAllFieldErrors();
}

function resetForceLayoutControl() {
// disable the checkboxes for force-layout options when resetting the form
const animationCheckbox = document.getElementById('animation');
if (animationCheckbox) animationCheckbox.checked = false;
const freeTrailingEndsCheckbox = document.getElementById('free-trailing-ends');
if (freeTrailingEndsCheckbox) freeTrailingEndsCheckbox.checked = false;
const pullPseudoknotBasepairsCheckbox = document.getElementById('pull-pseudoknot-basepairs');
if (pullPseudoknotBasepairsCheckbox) pullPseudoknotBasepairsCheckbox.checked = false;
}

function resetRotationControl() {
committedRotationDeg = 0;
const slider = document.getElementById('rotation-slider');
if (slider) slider.value = '0';
}

function resetCroppingControl() {
const croppingSlider = document.getElementById('cropping');
if (croppingSlider) croppingSlider.value = '-1';
const croppingValueEl = document.getElementById('cropping-value');
if (croppingValueEl) croppingValueEl.textContent = '-1';
}

function applySliderRotation() {
const slider = document.getElementById('rotation-slider');
if (!slider) return;

const container = document.getElementById(currentContainerId);
if (!container || !container.querySelector('svg')) return;

const sliderDelta = Number(slider.value);
vaRRI.rotateVisualization(
    currentContainerId,
    committedRotationDeg + sliderDelta,
    { mode: 'absolute' }
);
}

function commitSliderRotation() {
const slider = document.getElementById('rotation-slider');
if (!slider) return;

const sliderDelta = Number(slider.value);
committedRotationDeg = vaRRI.normaliseRotationDegrees(committedRotationDeg + sliderDelta);
slider.value = '0';

const container = document.getElementById(currentContainerId);
if (!container || !container.querySelector('svg')) return;

vaRRI.rotateVisualization(currentContainerId, committedRotationDeg, { mode: 'absolute' });
}

// -------------------------------------------------------------------------
// Per-field validation helpers
// -------------------------------------------------------------------------
function setFieldError(fieldId, msg) {
const el = document.getElementById(fieldId);
if (!el) return;
const wrap = el.closest('.input-wrap');
if (wrap) {
    wrap.classList.add('has-error');
    const tooltip = wrap.querySelector('.field-tooltip');
    if (tooltip) tooltip.textContent = msg;
    return;
}

const inlineRow = el.closest('.start-index-label-row');
if (!inlineRow) return;
inlineRow.classList.add('has-error');
el.style.borderColor = '#e74c3c';
el.style.background = '#fff5f5';
const tooltip = inlineRow.querySelector('.field-tooltip');
if (tooltip) {
    tooltip.textContent = msg;
    tooltip.style.display = 'block';
}
}

function clearFieldError(fieldId) {
const el = document.getElementById(fieldId);
if (!el) return;
const wrap = el.closest('.input-wrap');
if (wrap) {
    wrap.classList.remove('has-error');
    const tooltip = wrap.querySelector('.field-tooltip');
    if (tooltip) tooltip.textContent = '';
    return;
}

const inlineRow = el.closest('.start-index-label-row');
if (!inlineRow) return;
inlineRow.classList.remove('has-error');
el.style.borderColor = '';
el.style.background = '';
const tooltip = inlineRow.querySelector('.field-tooltip');
if (tooltip) {
    tooltip.textContent = '';
    tooltip.style.display = '';
}
}

function clearAllFieldErrors() {
document.querySelectorAll('.input-wrap.has-error').forEach(wrap => {
    wrap.classList.remove('has-error');
    const t = wrap.querySelector('.field-tooltip');
    if (t) t.textContent = '';
});

document.querySelectorAll('.start-index-label-row.has-error').forEach(row => {
    row.classList.remove('has-error');
    const input = row.querySelector('input[type="number"]');
    if (input) {
    input.style.borderColor = '';
    input.style.background = '';
    }
    const tooltip = row.querySelector('.field-tooltip');
    if (tooltip) {
    tooltip.textContent = '';
    tooltip.style.display = '';
    }
});
}

function getBaseVisualizationArgs() {
return {
    structure:              document.getElementById('structure').value.trim(),
    sequence:               document.getElementById('sequence').value.trim(),
    startIndex1:            document.getElementById('startIndex1').value.trim() || '1',
    startIndex2:            document.getElementById('startIndex2').value.trim() || '1',
    cropping:               document.getElementById('cropping').value.trim() || '-1',
    labelInterval:          '10',
    coloring:               document.getElementById('coloring').value,
    highlighting:           document.getElementById('highlighting').value,
    backgroundhighlighting: document.getElementById('backgroundhighlighting').value,
    guBasepairs:            document.getElementById('guBasepairs').checked,
    pointMutations:         vaRRI.getPointMutations().map(mutation => ({
                                sequence: mutation.sequence,
                                position: mutation.position,
                                replacement: mutation.replacement,
                                color: mutation.color,
                                })),
    regionHighlights:       vaRRI.getRegionHighlights().map(highlight => ({
                                sequence1Range: highlight.sequence1Range,
                                sequence2Range: highlight.sequence2Range,
                                color: highlight.color,
                                generated: highlight.generated,
                                })),
};
}

function getHighlightSequenceContext() {
    const baseArgs = getBaseVisualizationArgs();
    const v = vaRRI.validate(baseArgs);
    return {
        '1': { offset: v.offset1, length: (v.sequence1 == null ? 0 : v.sequence1.length ), sequence: v.sequence1 },
        '2': { offset: v.offset2, length: (v.sequence2 == null ? 0 : v.sequence2.length ), sequence: v.sequence2 },
    };
}

function getProfileIndexReference(seq) {
    const selected = document.getElementById(`profile-idx-ref-${seq}`);
    return selected ? selected.value : '1';
}

function parseProfileLines(profileText, fieldId) {
const lines = String(profileText || '').split(/\r?\n/);
const data = [];

for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    if (/^\s*$/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;

    const match = line.match(/^\s*(-?\d+)\s+(\d+(?:\.\d+)?)/);
    if (!match) {
    throw {
        fieldId,
        message: `Invalid profile line ${lineNo + 1}. Expected empty/comment or "index value" data line.`,
    };
    }

    data.push({
    index: parseInt(match[1], 10),
    value: parseFloat(match[2]),
    });

    const current = data[data.length - 1];
    if (current.value < 0 || current.value > 1) {
    throw {
        fieldId,
        message: `Invalid profile line ${lineNo + 1}. Probability value must be within [0, 1].`,
    };
    }
}

return data;
}

function getOriginalProfileSequencePositions(vUncropped, seqId) {
const seqLength = seqId === '1' ? vUncropped.sequence1.length : vUncropped.sequence2.length;
const offset = seqId === '1' ? vUncropped.offset1 : vUncropped.offset2;
const seqKey = seqId === '1' ? 's1' : 's2';
return vaRRI.getSequenceIndices(seqKey, offset, seqLength).map(([, pos]) => pos);
}

function mapProfileDataToAccessData(seqData, seqId, refMode, v, vUncropped) {
const seqKey = seqId === '1' ? 's1' : 's2';
const seqLength = seqId === '1' ? v.sequence1.length : v.sequence2.length;
const renderedSeqPositions = vaRRI
    .getSequenceIndices(seqKey, seqId === '1' ? v.offset1 : v.offset2, seqLength)
    .map(([, pos]) => pos);
const renderedSeqPositionSet = new Set(renderedSeqPositions);

const sourceSeqPositions = getOriginalProfileSequencePositions(vUncropped, seqId);
const sourceSeqPositionSet = new Set(sourceSeqPositions);

const seqNodeMap = {};
for (const [nodeIdStr, [seqName, pos]] of Object.entries(vaRRI.getIndexDictionary(v))) {
    if (seqName === seqKey) seqNodeMap[pos] = Number(nodeIdStr);
}

const accessData = {};
seqData.forEach(({ index, value }) => {
    let seqPosition;
    if (refMode === '1') {
    const ordinal = index;
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > sourceSeqPositions.length) {
        throw {
        fieldId: `profile-data-${seqId}`,
        message: `Profile index ${index} is out of 1-based sequence bounds [1, ${sourceSeqPositions.length}] for sequence ${seqId}.`,
        };
    }
    seqPosition = sourceSeqPositions[ordinal - 1];
    } else {
    // Start-index mode is resolved against the original (uncropped)
    // sequence coordinate system.
    if (sourceSeqPositionSet.has(index)) {
        seqPosition = index;
    } else {
        seqPosition = index;
    }
    }

    const nodeId = seqNodeMap[seqPosition];
    if (!nodeId) {
    // Cropping can remove nucleotides referenced by profile input.
    // In that case, skip the entry instead of remapping it or failing.
    if (sourceSeqPositionSet.has(seqPosition) && !renderedSeqPositionSet.has(seqPosition)) {
        return;
    }
    throw {
        fieldId: `profile-data-${seqId}`,
        message: `Profile index ${index} does not map to a valid nucleotide of sequence ${seqId}.`,
    };
    }

    accessData[nodeId] = value;
});

return accessData;
}

function parseProfileAccessData(v, args) {
const vUncropped = vaRRI.validate({ ...args, cropping: '-1' });
let accessData = {};
for (const seqId of ['1', '2']) {
    const profileRaw = document.getElementById(`profile-data-${seqId}`).value;
    const seqData = parseProfileLines(profileRaw, `profile-data-${seqId}`);
    const refMode = getProfileIndexReference(seqId);
    // append the access data for this sequence to the overall access data object
    accessData = { ...accessData, ...mapProfileDataToAccessData(seqData, seqId, refMode, v, vUncropped) };
}
// update UI counters for profile data fields
updateInputCounter(['profile-data-1', 'profile-data-2'], 'profile-counter');
// return the combined access data for both sequences
return accessData;
}

function getCompatibilityValidationContext(v) {
return {
    '1': { offset: v.offset1, sequence: v.sequence1 },
    '2': { offset: v.offset2, sequence: v.sequence2 },
};
}

function getVisibleSequencePositionSets(v) {
const visible = { '1': new Set(), '2': new Set() };
const indexDictionary = vaRRI.getIndexDictionary(v);
Object.values(indexDictionary).forEach(([seqName, pos]) => {
    if (seqName === 's1') visible['1'].add(pos);
    if (seqName === 's2') visible['2'].add(pos);
});
return visible;
}

function validateStartIndexCompatibility(args) {
const argsWithoutAnnotations = {
    ...args,
    subsequenceHighlights: [],
    regionHighlights: [],
    pointMutations: [],
};

let validatedBase;
try {
    validatedBase = vaRRI.validate(argsWithoutAnnotations);
} catch (err) {
    return {
    ok: false,
    message: err && err.message ? err.message : String(err),
    focusField: null,
    startField: null,
    };
}

const sequenceContext = getCompatibilityValidationContext(validatedBase);
const visiblePositions = getVisibleSequencePositionSets(validatedBase);

const highlights = vaRRI.getSubsequenceHighlights();
for (const highlight of highlights) {
    try {
    vaRRI.createSubsequenceHighlight({
        sequence: highlight.sequence,
        range: highlight.ranges,
        color: highlight.color,
    }, sequenceContext);
    } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return {
        ok: false,
        message: `Start index ${highlight.sequence} is incompatible with subsequence highlight "${highlight.rangeText}": ${message}`,
        focusField: 'highlightRange',
        startField: highlight.sequence === '1' ? 'startIndex1' : 'startIndex2',
    };
    }
}

const regions = vaRRI.getRegionHighlights();
for (const region of regions) {
    try {
        vaRRI.createRegionHighlight({
            sequence1Range: region.sequence1Range,
            sequence2Range: region.sequence2Range,
            color: region.color,
            generated: region.generated,
        }, sequenceContext);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return {
            ok: false,
            message: `Start index ${region.sequence1Range[0]} is incompatible with region highlight "${region.rangeText}": ${message}`,
            focusField: 'regionSequence1Start',
            startField: 'startIndex1',
        };
    }
}

const mutations = vaRRI.getPointMutations();
for (const mutation of mutations) {
    try {
    const normalized = vaRRI.createPointMutation({
        sequence: mutation.sequence,
        position: mutation.position,
        replacement: mutation.replacement,
        color: mutation.color,
    }, sequenceContext);

    if (!visiblePositions[normalized.sequence].has(normalized.position)) {
        return {
        ok: false,
        message: `Start index ${normalized.sequence} is incompatible with mutation ${normalized.labelText}.`,
        focusField: 'mutationPosition',
        startField: normalized.sequence === '1' ? 'startIndex1' : 'startIndex2',
        };
    }
    } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const mutationSeq = String(mutation.sequence);
    return {
        ok: false,
        message: `Start index ${mutationSeq} is incompatible with mutation at ${mutation.position}: ${message}`,
        focusField: 'mutationPosition',
        startField: mutationSeq === '1' ? 'startIndex1' : 'startIndex2',
    };
    }
}

try {
    parseProfileAccessData(validatedBase, argsWithoutAnnotations);
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    const fieldId = err && err.fieldId ? err.fieldId : null;
    const seq = fieldId === 'profile-data-2' ? '2' : '1';
    return {
    ok: false,
    message: `Start index ${seq} is incompatible with profile data: ${message}`,
    focusField: fieldId,
    startField: seq === '1' ? 'startIndex1' : 'startIndex2',
    };
}

return { ok: true };
}

/**
 * Updates a UI counter element based on the number of non-empty input/textarea fields.
 * 
 * @param {string[]} inputIds - Array of element IDs to inspect (e.g. ['profile-data-1', 'profile-data-2']).
 * @param {string} counterId - ID of the <span> element displaying the counter.
 */
function updateInputCounter(inputIds, counterId) {
  const counter = document.getElementById(counterId);
  if (!counter || !Array.isArray(inputIds)) return;

  // Count how many listed input fields contain non-empty values after trim()
  const activeCount = inputIds.reduce((count, id) => {
    const el = document.getElementById(id);
    if (el && typeof el.value === 'string' && el.value.trim() !== '') {
      return count + 1;
    }
    return count;
  }, 0);

  // Set counter text, e.g. "(2)". Hide if 0.
  counter.textContent = activeCount > 0 ? `(${activeCount})` : '';
}

/**
 * Aktualisiert einen Zähler in der UI basierend auf der Anzahl der <li> Elemente in einer Liste.
 * 
 * @param {string} listId - Die ID des <ul> oder <ol> Elements.
 * @param {string} counterId - Die ID des <span> Elements, das die Zahl anzeigen soll.
 */
function updateListCounter(listId, counterId) {
  const list = document.getElementById(listId);
  const counter = document.getElementById(counterId);

  if (list && counter) {
    // Zählt alle Listen-Elemente innerhalb der Liste
    const count = list.querySelectorAll('li').length;
    
    // Setzt den Text. Zeigt z.B. "(2)" an. Wenn die Liste leer ist, wird der Text geleert.
    counter.textContent = count > 0 ? `(${count})` : '';
  }
}

function resetHighlightForm() {
document.getElementById('highlightEditId').value = '';
document.getElementById('highlightSequence').value = '1';
document.getElementById('highlightRange').value = '';
document.getElementById('highlightColor').value = getDefaultSubsequenceHighlightColor();
document.getElementById('highlightSubmitBtn').textContent = 'Add';
clearFieldError('highlightSequence');
clearFieldError('highlightRange');
clearFieldError('highlightColor');
document.querySelectorAll('.highlight-item.active').forEach(el => el.classList.remove('active'));
}

function normalizeRegionInput(value) {
    if (value === null || value === undefined) return '';
    const normalized = String(value).replace(/\s+/g, '');
    if (normalized === '') return '';
    if (!/^(-?\d+)-(-?\d+)$/.test(normalized)) {
        throw new Error('Region must use the format START-END.');
    }
    return normalized;
}

function resetRegionForm() {
document.getElementById('regionEditId').value = '';
document.getElementById('region1').value = '';
document.getElementById('region2').value = '';
document.getElementById('regionColor').value = getDefaultRegionHighlightColor();
document.getElementById('regionSubmitBtn').textContent = 'Add';
clearFieldError('region1');
clearFieldError('region2');
clearFieldError('regionColor');
document.querySelectorAll('.region-item.active').forEach(el => el.classList.remove('active'));
}

function renderHighlightList() {
const listEl = document.getElementById('highlight-list');
const highlights = vaRRI.getSubsequenceHighlights();

if (highlights.length === 0) {
    listEl.innerHTML = '<li class="highlight-empty">No highlights defined.</li>';
    return;
}

listEl.innerHTML = '';
highlights.forEach(highlight => {
    const item = document.createElement('li');
    item.className = 'highlight-item';
    item.dataset.highlightId = String(highlight.id);

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'highlight-item-main';
    info.textContent = `Seq ${highlight.sequence} : ${highlight.rangeText}`;
    info.style.borderLeft = `10px solid ${highlight.color}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'highlight-delete';
    removeBtn.setAttribute('aria-label', `Remove highlight ${highlight.id}`);
    removeBtn.textContent = '🗑️'; // trash can icon
    removeBtn.title = 'Remove highlight';

    info.addEventListener('click', () => {
    document.querySelectorAll('.highlight-item.active').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('highlightEditId').value = String(highlight.id);
    document.getElementById('highlightSequence').value = highlight.sequence;
    document.getElementById('highlightRange').value = highlight.rangeText;
    document.getElementById('highlightColor').value = cssColorToHex(highlight.color);
    document.getElementById('highlightSubmitBtn').textContent = 'Update';
    clearFieldError('highlightSequence');
    clearFieldError('highlightRange');
    clearFieldError('highlightColor');
    });

    removeBtn.addEventListener('click', () => {
    const removed = vaRRI.removeSubsequenceHighlight(highlight.id);
    if (!removed) return;
    if (document.getElementById('highlightEditId').value === String(highlight.id)) {
        resetHighlightForm();
    }
    renderHighlightList();
    runVisualization();
    });

    item.appendChild(info);
    item.appendChild(removeBtn);
    listEl.appendChild(item);
});
// update counter in UI section
updateListCounter('highlight-list', 'highlight-counter');
}

function submitHighlightForm(event) {
if (event) {
    event.preventDefault();
    event.stopPropagation();
}

clearFieldError('highlightSequence');
clearFieldError('highlightRange');
clearFieldError('highlightColor');

const sequence = document.getElementById('highlightSequence').value;
const range = document.getElementById('highlightRange').value.trim();
const color = document.getElementById('highlightColor').value;
const editIdRaw = document.getElementById('highlightEditId').value;

if (!range) {
    setFieldError('highlightRange', 'Highlight range must not be empty.');
    return;
}

let sequenceContext;
try {
    sequenceContext = getHighlightSequenceContext();
} catch (err) {
    showMsg('Please fix sequence/structure inputs first: ' + err.message, 'error');
    return;
}

try {
    if (editIdRaw) {
    vaRRI.updateSubsequenceHighlight(Number(editIdRaw), { sequence, range, color }, sequenceContext);
    } else {
    vaRRI.registerSubsequenceHighlight({ sequence, range, color }, sequenceContext);
    }
} catch (err) {
    const message = err && err.message ? err.message : String(err);

    // Route parsing/validation failures for the range text box to the
    // range field, even when the message mentions "sequence indices".
    const isSequenceSelectorError = /must be "1" or "2"/i.test(message);
    const isColorError = /color/i.test(message);

    if (isSequenceSelectorError) setFieldError('highlightSequence', message);
    else if (isColorError) setFieldError('highlightColor', message);
    else setFieldError('highlightRange', message);
    return;
}

// Reset first so the form is cleared even if later UI updates fail.
resetHighlightForm();
renderHighlightList();
runVisualization();
}

function renderRegionList() {
const listEl = document.getElementById('region-list');
const regions = vaRRI.getRegionHighlights();

if (regions.length === 0) {
    listEl.innerHTML = '<li class="highlight-empty">No region highlights defined.</li>';
    updateListCounter('region-list', 'region-counter');
    return;
}

listEl.innerHTML = '';
regions.forEach(region => {
    const item = document.createElement('li');
    item.className = 'highlight-item region-item';
    item.dataset.regionId = String(region.id);
    if (region.generated) item.classList.add('generated');

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'highlight-item-main';
    info.textContent = region.rangeText;
    info.style.borderLeft = `10px solid ${region.color}`;
    if (region.generated) {
        info.disabled = true;
        info.title = 'Generated region highlight';
    }

    if (!region.generated) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'highlight-delete';
        removeBtn.setAttribute('aria-label', `Remove region highlight ${region.id}`);
        removeBtn.textContent = '🗑️';
        removeBtn.title = 'Remove region highlight';

        info.addEventListener('click', () => {
            document.querySelectorAll('.region-item.active').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('regionEditId').value = String(region.id);
            document.getElementById('region1').value = `${region.sequence1Range[0]}-${region.sequence1Range[1]}`;
            document.getElementById('region2').value = `${region.sequence2Range[0]}-${region.sequence2Range[1]}`;
            document.getElementById('regionColor').value = cssColorToHex(region.color);
            document.getElementById('regionSubmitBtn').textContent = 'Update';
            clearFieldError('region1');
            clearFieldError('region2');
            clearFieldError('regionColor');
        });

        removeBtn.addEventListener('click', () => {
            const removed = vaRRI.removeRegionHighlight(region.id);
            if (!removed) return;
            if (document.getElementById('regionEditId').value === String(region.id)) {
                resetRegionForm();
            }
            renderRegionList();
            runVisualization();
        });

        item.appendChild(info);
        item.appendChild(removeBtn);
    } else {
        item.appendChild(info);
    }

    listEl.appendChild(item);
});

updateListCounter('region-list', 'region-counter');
}

function submitRegionForm(event) {
if (event) {
    event.preventDefault();
    event.stopPropagation();
}

clearFieldError('region1');
clearFieldError('region2');
clearFieldError('regionColor');

const region1Input = document.getElementById('region1').value;
const region2Input = document.getElementById('region2').value;
const color = document.getElementById('regionColor').value;
const editIdRaw = document.getElementById('regionEditId').value;

let region1Value;
let region2Value;
try {
    region1Value = normalizeRegionInput(region1Input);
    region2Value = normalizeRegionInput(region2Input);
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (region1Input.trim() && /format/.test(message)) {
        setFieldError('region1', message);
    } else if (region2Input.trim() && /format/.test(message)) {
        setFieldError('region2', message);
    } else {
        if (!region1Value && region1Input.trim() === '') setFieldError('region1', 'Region 1 is required.');
        if (!region2Value && region2Input.trim() === '') setFieldError('region2', 'Region 2 is required.');
    }
    return;
}

if (!region1Value || !region2Value) {
    if (!region1Value) setFieldError('region1', 'Region 1 is required.');
    if (!region2Value) setFieldError('region2', 'Region 2 is required.');
    return;
}

let sequenceContext;
try {
    sequenceContext = getHighlightSequenceContext();
} catch (err) {
    showMsg('Please fix sequence/structure inputs first: ' + err.message, 'error');
    return;
}

try {
    if (editIdRaw) {
        vaRRI.updateRegionHighlight(Number(editIdRaw), {
            sequence1Range: region1Value,
            sequence2Range: region2Value,
            color,
        }, sequenceContext);
    } else {
        vaRRI.registerRegionHighlight({
            sequence1Range: region1Value,
            sequence2Range: region2Value,
            color,
        }, sequenceContext);
    }
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (/color/i.test(message)) setFieldError('regionColor', message);
    else if (/region 1|sequence 1/i.test(message)) setFieldError('region1', message);
    else if (/region 2|sequence 2/i.test(message)) setFieldError('region2', message);
    else setFieldError('region1', message);
    return;
}

resetRegionForm();
renderRegionList();
runVisualization();
}

function resetMutationForm() {
document.getElementById('mutationEditId').value = '';
document.getElementById('mutationSequence').value = '1';
document.getElementById('mutationPosition').value = '';
document.getElementById('mutationBase').value = '';
document.getElementById('mutationColor').value = getDefaultMutationColor();
document.getElementById('mutationSubmitBtn').textContent = 'Add';
clearFieldError('mutationSequence');
clearFieldError('mutationPosition');
clearFieldError('mutationBase');
clearFieldError('mutationColor');
document.querySelectorAll('.mutation-item.active').forEach(el => el.classList.remove('active'));
}

function renderMutationList() {
const listEl = document.getElementById('mutation-list');
const mutations = vaRRI.getPointMutations();

if (mutations.length === 0) {
    listEl.innerHTML = '<li class="highlight-empty">No mutations defined.</li>';
    return;
}

listEl.innerHTML = '';
mutations.forEach(mutation => {
    const item = document.createElement('li');
    item.className = 'highlight-item mutation-item';
    item.dataset.mutationId = String(mutation.id);

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'highlight-item-main';
//      info.textContent = `Seq ${mutation.sequence} | ${mutation.labelText} | ${mutation.color}`;
    info.textContent = `Seq ${mutation.sequence} : ${mutation.labelText}`;
    info.style.borderLeft = `10px solid ${mutation.color}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'highlight-delete';
    removeBtn.setAttribute('aria-label', `Remove mutation ${mutation.id}`);
    removeBtn.textContent = '🗑️';
    removeBtn.title = 'Remove mutation';

    info.addEventListener('click', () => {
    document.querySelectorAll('.mutation-item.active').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('mutationEditId').value = String(mutation.id);
    document.getElementById('mutationSequence').value = mutation.sequence;
    document.getElementById('mutationPosition').value = String(mutation.position);
    document.getElementById('mutationBase').value = mutation.replacement;
    document.getElementById('mutationColor').value = cssColorToHex(mutation.color);
    document.getElementById('mutationSubmitBtn').textContent = 'Update';
    clearFieldError('mutationSequence');
    clearFieldError('mutationPosition');
    clearFieldError('mutationBase');
    clearFieldError('mutationColor');
    });

    removeBtn.addEventListener('click', () => {
    const removed = vaRRI.removePointMutation(mutation.id);
    if (!removed) return;
    if (document.getElementById('mutationEditId').value === String(mutation.id)) {
        resetMutationForm();
    }
    renderMutationList();
    runVisualization();
    });

    item.appendChild(info);
    item.appendChild(removeBtn);
    listEl.appendChild(item);
});
// update counter in UI section
updateListCounter('mutation-list', 'mutation-counter');
}

function submitMutationForm(event) {
if (event) {
    event.preventDefault();
    event.stopPropagation();
}

clearFieldError('mutationSequence');
clearFieldError('mutationPosition');
clearFieldError('mutationBase');
clearFieldError('mutationColor');

const sequence = document.getElementById('mutationSequence').value;
const positionInput = document.getElementById('mutationPosition').value.trim();
const replacement = document.getElementById('mutationBase').value.trim();
const color = document.getElementById('mutationColor').value;
const editIdRaw = document.getElementById('mutationEditId').value;

if (!positionInput) {
    setFieldError('mutationPosition', 'Mutation position must not be empty.');
    return;
}

let position;
try {
    position = vaRRI.validateOffset(positionInput);
} catch (err) {
    setFieldError('mutationPosition', err && err.message ? err.message : String(err));
    return;
}

let sequenceContext;
try {
    sequenceContext = getHighlightSequenceContext();
} catch (err) {
    showMsg('Please fix sequence/structure inputs first: ' + err.message, 'error');
    return;
}

try {
    if (editIdRaw) {
    vaRRI.updatePointMutation(Number(editIdRaw), { sequence, position, replacement, color }, sequenceContext);
    } else {
    vaRRI.registerPointMutation({ sequence, position, replacement, color }, sequenceContext);
    }
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    const isSequenceError = /sequence/i.test(message);
    const isPositionError = /position|index/i.test(message);
    const isBaseError = /replacement|reference|nucleotide|single letter/i.test(message);

    if (isSequenceError) setFieldError('mutationSequence', message);
    else if (isPositionError) setFieldError('mutationPosition', message);
    else if (isBaseError) setFieldError('mutationBase', message);
    else setFieldError('mutationColor', message);
    return;
}

resetMutationForm();
renderMutationList();
runVisualization();
}

function validateFields(args) {
clearAllFieldErrors();
clearMsg();
let valid = true;

// Sequence
if (!args.sequence) {
    setFieldError('sequence', 'No sequence given.');
    valid = false;
} else {
    try { vaRRI.validateSequenceInput(args.sequence); }
    catch (e) { setFieldError('sequence', e.message); valid = false; }
}

// Structure
if (!args.structure) {
    setFieldError('structure', 'No structure given.');
    valid = false;
} else if (args.sequence) {
    try { vaRRI.validateStructureInput(args.structure, args.sequence); }
    catch (e) { setFieldError('structure', e.message); valid = false; }
}

// Cropping
if (args.cropping) {
    try { vaRRI.validateCroppingInput(args.structure, args.cropping); }
    catch (e) { 
    setFieldError('structure', e.message); 
    setFieldError('cropping', e.message); 
    valid = false; }
    // update cropping value field "cropping-value"
    const croppingValueEl = document.getElementById('cropping-value');
    if (croppingValueEl) {
    croppingValueEl.textContent = args.cropping;
    }
}

// Start index 1
let offset1;
try { offset1 = vaRRI.validateOffset(String(args.startIndex1 || '1')); }
catch (e) { setFieldError('startIndex1', e.message); valid = false; }

// Start index 2
let offset2;
try { offset2 = vaRRI.validateOffset(String(args.startIndex2 || '1')); }
catch (e) { setFieldError('startIndex2', e.message); valid = false; }

// Profile textarea syntax
try { parseProfileLines(document.getElementById('profile-data-1').value, 'profile-data-1'); }
catch (e) { setFieldError(e.fieldId || 'profile-data-1', e.message || String(e)); valid = false; }

try { parseProfileLines(document.getElementById('profile-data-2').value, 'profile-data-2'); }
catch (e) { setFieldError(e.fieldId || 'profile-data-2', e.message || String(e)); valid = false; }

if (valid) {
    const compatibility = validateStartIndexCompatibility(args);
    if (!compatibility.ok) {
    if (compatibility.startField) setFieldError(compatibility.startField, compatibility.message);
    if (compatibility.focusField) setFieldError(compatibility.focusField, compatibility.message);
    showMsg(compatibility.message, 'error');
    valid = false;
    }
}

return valid;
}

async function runVisualization() {
clearMsg();
applyColors();

const args = {
    ...getBaseVisualizationArgs(),
    subsequenceHighlights: vaRRI.getSubsequenceHighlights().map(highlight => ({
    sequence: highlight.sequence,
    range: highlight.ranges,
    color: highlight.color,
    })),
};

syncGeneratedRegionHighlight();
renderRegionList();

if (!validateFields(args)) return;

let v;
try {
    v = vaRRI.validate(args);
} catch (err) {
    showMsg('Validation error: ' + err.message, 'error');
    return;
}

let accessData;
try {
    accessData = parseProfileAccessData(v, args);
} catch (err) {
    setFieldError(err.fieldId || 'profile-data-1', err.message || String(err));
    return;
}

// Clear previous output
const runId = ++latestVisualizationRunId;
const container = document.getElementById(currentContainerId);
container.innerHTML = '';
container.style.visibility = 'hidden';
resetRotationControl();

const animation = document.getElementById('animation').checked;
const accessColors = getProfileAccessibilityColors();
const accessColorMode = getProfileAccessibilityMode();

try {
    const renderState = await vaRRI.render(currentContainerId, v, { animation, accessData, accessColors, accessColorMode });
    if (runId !== latestVisualizationRunId || renderState?.cancelled) return;
    container.style.visibility = '';
    renderRegionList();
    showMsg('Visualisation ready. Use the export buttons to save.', 'success');
} catch (err) {
    if (runId !== latestVisualizationRunId) return;
    container.style.visibility = '';
    renderRegionList();
    showMsg('Render error: ' + err.message, 'error');
}
}

function queueVisualization(delay = 0) {
if (autoVisualizationTimeoutId !== null) {
    clearTimeout(autoVisualizationTimeoutId);
    autoVisualizationTimeoutId = null;
}

if (delay < 1) {
    runVisualization();
    return;
}

autoVisualizationTimeoutId = setTimeout(() => {
    autoVisualizationTimeoutId = null;
    runVisualization();
}, delay);
}

function attachAutoVisualizationListeners() {
const committedFieldIds = [
    'structure',
    'sequence',
    'cropping',
    'startIndex1',
    'startIndex2',
    'mutationPosition',
    'profile-data-1',
    'profile-data-2',
];
const listenerConfig = {
    coloring: { eventName: 'change' },
    highlighting: { eventName: 'change' },
    backgroundhighlighting: { eventName: 'change' },
    guBasepairs: { eventName: 'change' },
    animation: { eventName: 'change' },
    'profile-color-1': { eventName: 'change' },
    'profile-color-2': { eventName: 'change' },
    'profile-color-1-represents-one': { eventName: 'change' },
    'profile-color-2-represents-one': { eventName: 'change' },
    mutationSequence: { eventName: 'change' },
    mutationBase: { eventName: 'change' },
    mutationColor: { eventName: 'change' },
    'profile-idx-ref-1': { eventName: 'change' },
    'profile-idx-ref-2': { eventName: 'change' },
};

committedFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('input', () => {
    clearFieldError(id);
    });

    el.addEventListener('change', () => {
    const skippedValue = skipNextCommittedFieldChange.get(el);
    if (skippedValue !== undefined) {
        skipNextCommittedFieldChange.delete(el);
        if (skippedValue === el.value) return;
    }
    clearFieldError(id);
    queueVisualization();
    });

    if (el.tagName === 'TEXTAREA') return;

    el.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    skipNextCommittedFieldChange.set(el, el.value);
    clearFieldError(id);
    queueVisualization();
    });
});

Object.entries(listenerConfig).forEach(([id, config]) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener(config.eventName, () => {
    clearFieldError(id);
    queueVisualization();
    });
});
}

// -------------------------------------------------------------------------
// Export
// -------------------------------------------------------------------------
function exportSVG() {
try {
    vaRRI.downloadSVG(currentContainerId, 'vaRRI_output.svg');
} catch (err) {
    showMsg('Export error: ' + err.message, 'error');
}
}

function exportPNG() {
try {
    vaRRI.downloadPNG(currentContainerId, 'vaRRI_output.png');
} catch (err) {
    showMsg('Export error: ' + err.message, 'error');
}
}


// -------------------------------------------------------------------------
// Drag-and-drop file loading
// -------------------------------------------------------------------------

function setupFileDragAndDrop(textareaId) {
const el = document.getElementById(textareaId);
if (!el) return;

['dragenter', 'dragover'].forEach(eventName => {
    el.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drag-over');
    });
});

['dragleave', 'dragend'].forEach(eventName => {
    el.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    });
});

el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');

    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
    el.value = (event.target && event.target.result) || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    reader.readAsText(file);
});
}



//  ------------------------------------------------------------------------
//  URL parameter generation
//  ------------------------------------------------------------------------
/**
 * Generiert einen Share-Link vollautomatisch durch Scannen aller Formularelemente im DOM.
 * Verwendet eine Blacklist, um bestimmte Elemente von der URL-Codierung auszuschließen.
 * 
 * @param {HTMLElement} btnElement - Optionales Button-Element für Feedback im UI
 */
function generateShareableURL(btnElement) {
  const params = new URLSearchParams();

  // 1. Blacklist: IDs von Elementen, die NIEMALS in die URL sollen
  const blacklist = new Set([
    // region highlight input/update form fields
    'regionEditId',
    'region1',
    'region2',
    'regionColor',
    // sequence highlight input/update form fields
    'highlightEditId',
    'highlightSequence',
    'highlightRange',
    'highlightColor',
    // mutation input/update form fields
    'mutationEditId',
    'mutationSequence',
    'mutationPosition',
    'mutationBase',
    'mutationColor',
    // rotation control & slider
    'rotation-slider'
  ]);

  // 2. Automatisch ALLE verarbeitbaren Formular-Elemente im DOM finden
  const formElements = document.querySelectorAll('input, textarea, select');

  formElements.forEach(el => {
    const id = el.id;

    // Nur Elemente mit ID berücksichtigen, die nicht auf der Blacklist stehen
    if (!id || blacklist.has(id)) return;

    // Unrelevante Input-Typen überspringen
    if (['button', 'submit', 'reset', 'file'].includes(el.type)) return;

    // Behandlung von Checkboxen und Radio-Buttons
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) {
        params.append(id, el.value || 'true');
      }
      return;
    }

    // Behandlung aller Standard-Textinputs, Selects und Textareas
    if (typeof el.value === 'string') {
      const val = el.value.trim();
      if (val !== '') {
        params.append(id, val);
      }
    }
  });

  // 3. Mutationen aus vaRRI auslesen (Encoding: "<seq>:<pos><replacement>[:<color>]")
  const mutations = (typeof vaRRI !== 'undefined' && vaRRI.getPointMutations) ? vaRRI.getPointMutations() : [];
  if (mutations && mutations.length > 0) {
    const encodedMutations = mutations.map(m => {
      const colorClean = m.color ? m.color.replace('#', '') : '';
      return `${m.sequence}:${m.position}${m.replacement}${colorClean ? ':' + colorClean : ''}`;
    }).join(',');

    params.append('mutations', encodedMutations);
  }

  // 4. Subsequence Highlights aus vaRRI auslesen (Encoding: "<seq>:<start>-<end>[:<color>]")
  const highlights = (typeof vaRRI !== 'undefined' && vaRRI.getSubsequenceHighlights) ? vaRRI.getSubsequenceHighlights() : [];
  if (highlights && highlights.length > 0) {
    const encodedHighlights = highlights
      .map(h => {
        const colorClean = h.color ? h.color.replace('#', '') : '';
        const sequence = h.sequence || '1';

        // 1. Prefer explicit rangeText if available (e.g., "18-20")
        if (typeof h.rangeText === 'string' && h.rangeText && h.rangeText !== 'undefined') {
          return `${sequence}:${h.rangeText}${colorClean ? ':' + colorClean : ''}`;
        }

        // 2. Fall back to nested ranges array (e.g., [[18, 20]])
        if (Array.isArray(h.ranges) && h.ranges.length > 0) {
          return h.ranges.map(r => {
            const rangeStr = Array.isArray(r) ? `${r[0]}-${r[1]}` : r;
            return `${sequence}:${rangeStr}${colorClean ? ':' + colorClean : ''}`;
          }).join(',');
        }

        // 3. Fall back to single range property
        if (typeof h.range === 'string' && h.range !== 'undefined') {
          return `${sequence}:${h.range}${colorClean ? ':' + colorClean : ''}`;
        }

        return null;
      })
      .filter(Boolean)
      .join(',');

    if (encodedHighlights) {
      params.append('highlights', encodedHighlights);
    }
  }

  // 5. Region highlights aus vaRRI auslesen (Encoding: "<start1>-<end1>&<start2>-<end2>[:<color>]")
  const regionHighlights = (typeof vaRRI !== 'undefined' && vaRRI.getRegionHighlights) ? vaRRI.getRegionHighlights() : [];
  if (regionHighlights && regionHighlights.length > 0) {
    const encodedRegionHighlights = regionHighlights
      .filter(h => !h.generated)
      .map(h => {
        const colorClean = h.color ? h.color.replace('#', '') : '';
        const rangeText = typeof h.rangeText === 'string' && h.rangeText && h.rangeText !== 'undefined'
          ? h.rangeText
          : `${Array.isArray(h.sequence1Range) ? h.sequence1Range.join('-') : ''}&${Array.isArray(h.sequence2Range) ? h.sequence2Range.join('-') : ''}`;

        return `${rangeText}${colorClean ? ':' + colorClean : ''}`;
      })
      .filter(Boolean)
      .join(',');

    if (encodedRegionHighlights) {
      params.append('regionHighlights', encodedRegionHighlights);
    }
  }

  let queryString = params.toString();
  if (!queryString) return;

  // -------------------------------------------------------------------------
  // FIX: Explicitly percent-encode '(' and ')' characters which URLSearchParams
  // leaves raw by default according to RFC 3986.
  // -------------------------------------------------------------------------
  queryString = queryString.replace(/\(/g, '%28').replace(/\)/g, '%29');

  // 5. Basis-URL bestimmen (http vs file://)
  let baseUrl;
  if (window.location.protocol === 'file:') {
    baseUrl = window.location.href.split('?')[0].split('#')[0];
  } else {
    baseUrl = `${window.location.origin}${window.location.pathname}`;
  }

  const shareableURL = `${baseUrl}?${queryString}`;

  // 6. In die Zwischenablage kopieren & UI-Feedback
  navigator.clipboard.writeText(shareableURL)
    .then(() => {
      if (btnElement) {
        const originalText = btnElement.innerHTML;
        btnElement.innerHTML = '✓ Copied!';
        setTimeout(() => { btnElement.innerHTML = originalText; }, 2000);
      }
    })
    .catch(err => {
      console.error('Could not copy link to clipboard:', err);
      prompt('Copy your shareable URL below:', shareableURL);
    });
}

// ------------------------------------------------------------------------
// URL parameter loading
// ------------------------------------------------------------------------

/**
 * Helper to parse hex colors cleanly (restores '#' if missing).
 */
function parseUrlColor(colorStr, defaultColor) {
  if (!colorStr) return defaultColor;
  const clean = colorStr.trim().replace('#', '').toUpperCase();
  return /^[0-9A-F]{3,8}$/i.test(clean) ? `#${clean}` : defaultColor;
}

/**
 * Checks whether point mutations are present in the URL parameters and loads them into vaRRI.
 * Expected encoding: "<seq>:<pos><character>[:<color>]", comma-separated.
 */
function loadUrlMutationsToVaRRI(argName = 'mutations') {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has(argName)) {
    const value = urlParams.get(argName) || '';
    const mutations = value.split(',').map(m => m.trim()).filter(m => m.length > 0);

    mutations.forEach(mutation => {
      const match = mutation.match(/^([12]):(-?\d+)(.)(?::([0-9a-fA-F]{3,8}))?$/i);
      if (match) {
        const sequence = match[1];
        const position = parseInt(match[2], 10);
        const replacement = match[3];
        const color = parseUrlColor(match[4], getDefaultMutationColor());

        try {
          vaRRI.registerPointMutation(
            { sequence, position, replacement, color }, 
            getHighlightSequenceContext()
          );
        } catch (err) {
          console.warn(`Failed to register mutation from URL parameter: ${mutation}. Error: ${err.message}`);
        }
      } else {
        console.warn(`Invalid mutation format in URL parameter: ${mutation}`);
      }
    });
  }
}

/**
 * Checks whether subsequence highlights are present in the URL parameters and loads them into vaRRI.
 * Expected encoding: "<seq>:<start>-<end>[:<color>]", comma-separated.
 */
function loadUrlSubsequenceHighlightsToVaRRI(argName = 'highlights') {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has(argName)) {
    const value = urlParams.get(argName) || '';
    const highlights = value.split(',').map(h => h.trim()).filter(h => h.length > 0);

    highlights.forEach(highlight => {
      const match = highlight.match(/^([12]):(-?\d+)-(-?\d+)(?::([0-9a-fA-F]{3,8}))?$/i);
      if (match) {
        const sequence = match[1];
        const start = parseInt(match[2], 10);
        const end = parseInt(match[3], 10);
        const color = parseUrlColor(match[4], getDefaultSubsequenceHighlightColor());

        try {
          vaRRI.registerSubsequenceHighlight(
            { sequence, range: `${start}-${end}`, color }, 
            getHighlightSequenceContext()
          );
        } catch (err) {
          console.warn(`Failed to register subsequence highlight from URL parameter: ${highlight}. Error: ${err.message}`);
        }
      } else {
        console.warn(`Invalid subsequence highlight format in URL parameter: ${highlight}`);
      }
    });
  }
}

/**
 * Checks whether region highlights are present in the URL parameters and loads them into vaRRI.
 * Expected encoding: "<start1>-<end1>&<start2>-<end2>[:<color>]", comma-separated.
 */
function loadUrlRegionHighlightsToVaRRI(argName = 'regionHighlights') {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has(argName)) {
    const value = urlParams.get(argName) || '';
    const regionHighlights = value.split(',').map(h => h.trim()).filter(h => h.length > 0);

    regionHighlights.forEach(region => {
      const match = region.match(/^(-?\d+)-(-?\d+)&(-?\d+)-(-?\d+)(?::([0-9a-fA-F]{3,8}))?$/i);
      if (match) {
        const sequence1Range = [parseInt(match[1], 10), parseInt(match[2], 10)];
        const sequence2Range = [parseInt(match[3], 10), parseInt(match[4], 10)];
        const color = parseUrlColor(match[5], getDefaultRegionHighlightColor());

        try {
          vaRRI.registerRegionHighlight(
            { sequence1Range, sequence2Range, color },
            getHighlightSequenceContext()
          );
        } catch (err) {
          console.warn(`Failed to register region highlight from URL parameter: ${region}. Error: ${err.message}`);
        }
      } else {
        console.warn(`Invalid region highlight format in URL parameter: ${region}`);
      }
    });
  }
}

/**
 * Helper to populate any DOM element from a URL parameter by ID.
 * Handles text inputs, textareas, checkboxes, select dropdowns, and color inputs.
 */
function loadUrlArgumentToInputField(argName, inputFieldId = argName) {
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has(argName)) return false;

  const value = urlParams.get(argName);
  const el = document.getElementById(inputFieldId);

  if (!el) {
    console.warn(`URL param found for '${argName}', but no DOM element with ID '${inputFieldId}' exists.`);
    return false;
  }

  // 1. Handle Checkboxes
  if (el.type === 'checkbox') {
    el.checked = (value === 'on' || value === 'true' || value === '1');
  } 
  // 2. Handle Color Pickers (Ensure leading #)
  else if (el.type === 'color') {
    el.value = parseUrlColor(value, el.value);
  } 
  // 3. Handle Textarea, Select, Text, Number
  else {
    el.value = value;
  }

  // Dispatch events so UI listeners update
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}

/**
 * Master initialization function to execute on page load.
 */
function syncGeneratedRegionHighlight() {
  const bgMode = document.getElementById('backgroundhighlighting')?.value;
  if (bgMode !== 'region') {
    vaRRI.getRegionHighlights().filter(highlight => highlight.generated).forEach(highlight => {
      vaRRI.removeRegionHighlight(highlight.id);
    });
    return;
  }

  let sequenceContext;
  try {
    sequenceContext = getHighlightSequenceContext();
  } catch (err) {
    return;
  }

  let validated;
  try {
    validated = vaRRI.validate({
      ...getBaseVisualizationArgs(),
      subsequenceHighlights: [],
      regionHighlights: [],
      pointMutations: [],
    });
  } catch (err) {
    return;
  }

  const ranges = vaRRI.computeBackgroundRegionRanges(validated);
  if (!ranges) {
    vaRRI.getRegionHighlights().filter(highlight => highlight.generated).forEach(highlight => {
      vaRRI.removeRegionHighlight(highlight.id);
    });
    return;
  }

  const payload = {
    sequence1Range: ranges.sequence1Range,
    sequence2Range: ranges.sequence2Range,
    color: document.getElementById('color-bg')?.value || getDefaultRegionHighlightColor(),
  };

  const existing = vaRRI.getRegionHighlights().find(highlight => highlight.generated);
  if (existing) {
    vaRRI.updateRegionHighlight(existing.id, {
      ...payload,
      generated: true,
    }, sequenceContext);
  } else {
    vaRRI.registerGeneratedRegionHighlight({
      offset1: validated.offset1,
      offset2: validated.offset2,
      sequence1: validated.sequence1,
      sequence2: validated.sequence2,
    }, {
      ...payload,
      generated: true,
    });
  }
}


function loadAllUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  let hasProfileData = false;

  // 0. Check for "showRenderingOnly" parameter to hide UI elements
  if (urlParams.has('showRenderingOnly') && urlParams.get('showRenderingOnly') !== 'false') {
    document.body.classList.add('rendering-only');
  }

  // 1. Hydrate ALL matching DOM elements from URL parameters
  urlParams.forEach((_, paramKey) => {
    // Exclude special dynamic list keys and rendering flags handled separately
    if (paramKey === 'mutations' || paramKey === 'highlights' || paramKey === 'showRenderingOnly') return;

    const loaded = loadUrlArgumentToInputField(paramKey, paramKey);

    if (loaded && (paramKey.startsWith('profile-data') || paramKey.startsWith('profile-color') || paramKey.startsWith('profile-idx'))) {
      hasProfileData = true;
    }
  });

  // 2. Load vaRRI point mutations, subsequence highlights, and region highlights
  loadUrlMutationsToVaRRI('mutations');
  loadUrlSubsequenceHighlightsToVaRRI('highlights');
  loadUrlRegionHighlightsToVaRRI('regionHighlights');

  // 3. Auto-apply probability profiles if profile data was populated
  if (hasProfileData) {
    // Open the probability profile details accordion so it's visible
    const profileDetails = document.getElementById('profile-data-1')?.closest('details');
    if (profileDetails) {
      profileDetails.open = true;
    }

    // Trigger profile application after a micro-task tick
    setTimeout(() => {
      const profileBtn = document.getElementById('profileApplyBtn');
      if (profileBtn) {
        profileBtn.click();
      }
    }, 50);
  }
}

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// Auto-load 2-molecule example on page load
// -------------------------------------------------------------------------
window.addEventListener('load', () => {
// reset
clearAll();
// Initialise colour pickers from the vaRRI.js defaults
initColorPickers();
resetHighlightForm();
resetMutationForm();
renderHighlightList();
renderMutationList();

const submitBtn = document.getElementById('highlightSubmitBtn');
const cancelBtn = document.getElementById('highlightCancelBtn');
const regionSubmitBtn = document.getElementById('regionSubmitBtn');
const regionCancelBtn = document.getElementById('regionCancelBtn');
const mutationSubmitBtn = document.getElementById('mutationSubmitBtn');
const mutationCancelBtn = document.getElementById('mutationCancelBtn');
const profileApplyBtn = document.getElementById('profileApplyBtn');
if (submitBtn) submitBtn.addEventListener('click', submitHighlightForm);
if (cancelBtn) cancelBtn.addEventListener('click', resetHighlightForm);
if (regionSubmitBtn) regionSubmitBtn.addEventListener('click', submitRegionForm);
if (regionCancelBtn) regionCancelBtn.addEventListener('click', resetRegionForm);
if (mutationSubmitBtn) mutationSubmitBtn.addEventListener('click', submitMutationForm);
if (mutationCancelBtn) mutationCancelBtn.addEventListener('click', resetMutationForm);
if (profileApplyBtn) profileApplyBtn.addEventListener('click', () => runVisualization());

attachAutoVisualizationListeners();

setupFileDragAndDrop('profile-data-1');
setupFileDragAndDrop('profile-data-2');

const rotationSlider = document.getElementById('rotation-slider');
if (rotationSlider) {
    rotationSlider.addEventListener('input', applySliderRotation);
    rotationSlider.addEventListener('change', commitSliderRotation);
}

// register input event listeners for profile data textareas to update the counter in the UI
const profileInputIds = ['profile-data-1', 'profile-data-2'];
profileInputIds.forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      updateInputCounter(profileInputIds, 'profile-counter');
    });
    el.addEventListener('change', () => {
      updateInputCounter(profileInputIds, 'profile-counter');
    });
  }
});

// load URL parameters if present, otherwise load the 2-molecule example
const urlParams = new URLSearchParams(window.location.search);
// at least a sequence has to be present in the URL parameters for the visualization to be loaded
if (urlParams.has('sequence')) {
    // load all URL parameters into the form fields and vaRRI state
    loadAllUrlParameters();

    // trigger page rendering with the loaded URL parameters
    renderHighlightList();
    renderRegionList();
    renderMutationList();
    resetHighlightForm();
    resetRegionForm();
    resetMutationForm();
    runVisualization();
} else {
    loadExample('2mol');
}
});
