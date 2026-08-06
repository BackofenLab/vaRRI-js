(function () {
    'use strict';

    const CONTAINER_ID = 'rna-benchmark';
    const FORNAC_GAP_LENGTH = 3;
    const statusElement = document.getElementById('status');
    const capturedBrowserErrors = [];
    let fixtureDocumentPromise = null;

    window.addEventListener('error', event => {
        capturedBrowserErrors.push(`error: ${event.message}`);
    });
    window.addEventListener('unhandledrejection', event => {
        capturedBrowserErrors.push(`unhandledrejection: ${String(event.reason)}`);
    });

    function status(message) {
        statusElement.textContent = message;
        window.__varriBenchmarkStatus = message;
    }

    function fixtureDocument() {
        if (!fixtureDocumentPromise) {
            fixtureDocumentPromise = fetch('../../tests/fixtures/literature-interactions.json')
                .then(response => {
                    if (!response.ok) throw new Error(`Fixture HTTP status ${response.status}`);
                    return response.json();
                });
        }
        return fixtureDocumentPromise;
    }

    function sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    function finite(value) {
        return Number.isFinite(Number(value));
    }

    function centre(element) {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
            radius: Math.max(bounds.width, bounds.height) / 2
        };
    }

    function nucleotideCircle(nodeNumber) {
        return document.querySelector(
            `#${CONTAINER_ID} circle[node_type="nucleotide"][node_num="${nodeNumber}"]`
        );
    }

    function screenLineEndpoints(line) {
        const matrix = line.getScreenCTM();
        if (!matrix) return null;
        const svg = line.ownerSVGElement;
        const point = svg.createSVGPoint();
        point.x = Number(line.getAttribute('x1'));
        point.y = Number(line.getAttribute('y1'));
        const first = point.matrixTransform(matrix);
        point.x = Number(line.getAttribute('x2'));
        point.y = Number(line.getAttribute('y2'));
        const second = point.matrixTransform(matrix);
        return { first, second };
    }

    function maximumAbsoluteDeviation(values) {
        if (values.length === 0) return null;
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return Math.max(...values.map(value => Math.abs(value - mean)));
    }

    function average(values) {
        return values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;
    }

    function percentile(values, fraction) {
        if (values.length === 0) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    }

    function countCircleOverlaps(circles) {
        const points = circles.map(centre).filter(Boolean);
        const cellSize = 14;
        const cells = new Map();
        let overlaps = 0;
        let minimumDistance = Infinity;

        points.forEach((point, index) => {
            const cellX = Math.floor(point.x / cellSize);
            const cellY = Math.floor(point.y / cellSize);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const candidates = cells.get(`${cellX + dx}:${cellY + dy}`) || [];
                    candidates.forEach(otherIndex => {
                        const other = points[otherIndex];
                        const distance = Math.hypot(point.x - other.x, point.y - other.y);
                        minimumDistance = Math.min(minimumDistance, distance);
                        const collisionDistance = 0.72 * (point.radius + other.radius);
                        if (distance + 0.05 < collisionDistance) overlaps++;
                    });
                }
            }
            const key = `${cellX}:${cellY}`;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(index);
        });

        return {
            overlaps,
            minimumDistancePx: minimumDistance === Infinity ? null : minimumDistance
        };
    }

    function intramolecularNodeIds(sequence1Length) {
        const ids = new Set();
        document.querySelectorAll(`#${CONTAINER_ID} line[link_type="basepair"]`).forEach(line => {
            const start = Number(line.getAttribute('start'));
            const end = Number(line.getAttribute('end'));
            const firstMolecule = start <= sequence1Length;
            const secondMolecule = start >= sequence1Length + FORNAC_GAP_LENGTH + 1;
            if (
                (firstMolecule && end <= sequence1Length) ||
                (secondMolecule && end >= sequence1Length + FORNAC_GAP_LENGTH + 1)
            ) {
                ids.add(start);
                ids.add(end);
            }
        });
        return ids;
    }

    function measureGeometry(validated, expected) {
        const nodeCircles = [...document.querySelectorAll(
            `#${CONTAINER_ID} circle[node_type="nucleotide"]`
        )].filter(circle => /^\d+$/.test(circle.getAttribute('node_num') || ''));
        const pairs = vaRRI.listIntermolPairs(validated);
        const topPoints = [];
        const bottomPoints = [];
        let missingRailNodes = 0;

        pairs.forEach(([first, second]) => {
            const firstPoint = centre(nucleotideCircle(first));
            const secondPoint = centre(nucleotideCircle(second));
            if (!firstPoint || !secondPoint) {
                missingRailNodes++;
                return;
            }
            topPoints.push(firstPoint);
            bottomPoints.push(secondPoint);
        });

        const topRailY = average(topPoints.map(point => point.y));
        const bottomRailY = average(bottomPoints.map(point => point.y));
        const pairHorizontalOffsets = topPoints.map((point, index) =>
            Math.abs(point.x - bottomPoints[index].x)
        );
        const pairVerticalGaps = topPoints.map((point, index) =>
            bottomPoints[index].y - point.y
        );
        const pairOrderDirection = topPoints.length > 1
            ? Math.sign(topPoints.at(-1).x - topPoints[0].x) || 1
            : 1;
        let orderReversals = 0;
        for (let i = 1; i < topPoints.length; i++) {
            if ((topPoints[i].x - topPoints[i - 1].x) * pairOrderDirection < -0.25) {
                orderReversals++;
            }
        }

        const railIds = new Set(pairs.flat());
        const structuredIds = intramolecularNodeIds(validated.sequence1.length);
        const sequence2Start = validated.sequence1.length + FORNAC_GAP_LENGTH + 1;
        let structuredHalfPlaneViolations = 0;
        structuredIds.forEach(nodeId => {
            if (railIds.has(nodeId)) return;
            const point = centre(nucleotideCircle(nodeId));
            if (!point || topRailY === null || bottomRailY === null) return;
            if (nodeId <= validated.sequence1.length && point.y > topRailY + 1.5) {
                structuredHalfPlaneViolations++;
            } else if (nodeId >= sequence2Start && point.y < bottomRailY - 1.5) {
                structuredHalfPlaneViolations++;
            }
        });

        let supplementaryOutwardViolations = 0;
        let supplementaryLinks = 0;
        document.querySelectorAll(`#${CONTAINER_ID} line[link_type="label_link"]`).forEach(line => {
            const nucleotideId = Number(line.getAttribute('start'));
            if (!Number.isInteger(nucleotideId)) return;
            const endpoints = screenLineEndpoints(line);
            if (!endpoints) return;
            supplementaryLinks++;
            if (
                nucleotideId <= validated.sequence1.length &&
                endpoints.second.y > endpoints.first.y + 1.5
            ) {
                supplementaryOutwardViolations++;
            } else if (
                nucleotideId >= sequence2Start &&
                endpoints.second.y < endpoints.first.y - 1.5
            ) {
                supplementaryOutwardViolations++;
            }
        });

        const nonFiniteSvgElements = [...document.querySelectorAll(
            `#${CONTAINER_ID} g[transform], #${CONTAINER_ID} line[x1]`
        )].filter(element => /NaN|Infinity/.test(
            ['transform', 'x1', 'y1', 'x2', 'y2']
                .map(attribute => element.getAttribute(attribute) || '')
                .join(' ')
        )).length;

        const overlap = countCircleOverlaps(nodeCircles);
        const basepairLinks = document.querySelectorAll(
            `#${CONTAINER_ID} line[link_type="basepair"], ` +
            `#${CONTAINER_ID} line[link_type="pseudoknot"]`
        ).length;
        const visibleGhostElements = document.querySelectorAll(
            `#${CONTAINER_ID} [data-varri-linear-ghost], #${CONTAINER_ID} [node_num^="-100000"]`
        ).length;
        const svg = document.querySelector(`#${CONTAINER_ID} svg`);
        const svgBounds = svg ? svg.getBoundingClientRect() : null;
        const outOfViewportNodes = svgBounds ? nodeCircles.filter(circle => {
            const point = centre(circle);
            return point.x < svgBounds.left - 1 || point.x > svgBounds.right + 1 ||
                point.y < svgBounds.top - 1 || point.y > svgBounds.bottom + 1;
        }).length : nodeCircles.length;

        return {
            visibleNucleotideNodes: nodeCircles.length,
            expectedVisibleNucleotideNodes: validated.sequence1.length + validated.sequence2.length,
            basepairLinks,
            expectedBasepairLinks: expected.intermolecularBasePairs + expected.intramolecularBasePairs,
            missingRailNodes,
            topRailMaximumDeviationPx: maximumAbsoluteDeviation(topPoints.map(point => point.y)),
            bottomRailMaximumDeviationPx: maximumAbsoluteDeviation(bottomPoints.map(point => point.y)),
            maximumPairHorizontalOffsetPx: pairHorizontalOffsets.length
                ? Math.max(...pairHorizontalOffsets)
                : null,
            minimumPairVerticalGapPx: pairVerticalGaps.length
                ? Math.min(...pairVerticalGaps)
                : null,
            medianPairVerticalGapPx: percentile(pairVerticalGaps, 0.5),
            topRailAboveBottomRail: topRailY !== null && bottomRailY !== null && topRailY < bottomRailY,
            orderReversals,
            structuredHalfPlaneNodes: structuredIds.size,
            structuredHalfPlaneViolations,
            supplementaryLinks,
            supplementaryOutwardViolations,
            nucleotideOverlaps: overlap.overlaps,
            minimumNucleotideDistancePx: overlap.minimumDistancePx,
            nonFiniteSvgElements,
            visibleGhostElements,
            outOfViewportNodes
        };
    }

    function geometryProblems(geometry) {
        const problems = [];
        if (geometry.visibleNucleotideNodes !== geometry.expectedVisibleNucleotideNodes) {
            problems.push('nucleotide-count-mismatch');
        }
        if (geometry.basepairLinks !== geometry.expectedBasepairLinks) {
            problems.push('basepair-link-count-mismatch');
        }
        if (geometry.missingRailNodes) problems.push('missing-rail-nodes');
        if (!geometry.topRailAboveBottomRail) problems.push('molecule-order-reversed-or-collapsed');
        if ((geometry.topRailMaximumDeviationPx || 0) > 1) problems.push('top-rail-not-horizontal');
        if ((geometry.bottomRailMaximumDeviationPx || 0) > 1) problems.push('bottom-rail-not-horizontal');
        if ((geometry.maximumPairHorizontalOffsetPx || 0) > 1) problems.push('interaction-rungs-not-vertical');
        if ((geometry.minimumPairVerticalGapPx || 0) < 3) problems.push('interaction-rails-overlap');
        if (geometry.orderReversals) problems.push('interaction-order-reversal');
        if (geometry.structuredHalfPlaneViolations) problems.push('structure-entered-interaction-corridor');
        if (geometry.supplementaryOutwardViolations) problems.push('supplementary-node-points-inward');
        if (geometry.nucleotideOverlaps) problems.push('nucleotide-overlap');
        if (geometry.nonFiniteSvgElements) problems.push('non-finite-svg-geometry');
        if (geometry.visibleGhostElements) problems.push('terminal-ghost-became-visible');
        if (geometry.outOfViewportNodes) problems.push('node-outside-svg-viewport');
        return problems;
    }

    async function renderFixture(fixture, runOptions = {}) {
        const container = document.getElementById(CONTAINER_ID);
        container.replaceChildren();
        vaRRI.clearPointMutations();
        vaRRI.clearRegionHighlights();
        vaRRI.clearSubsequenceHighlights();

        const input = JSON.parse(JSON.stringify(fixture.input));
        if (runOptions.cropping !== undefined) input.cropping = runOptions.cropping;
        const validationStart = performance.now();
        const validated = vaRRI.validate(input);
        const validationMs = performance.now() - validationStart;
        const errorsBefore = capturedBrowserErrors.length;
        const renderStart = performance.now();
        const renderState = await vaRRI.render(CONTAINER_ID, validated, fixture.renderOptions);
        const promiseMs = performance.now() - renderStart;
        await sleep(runOptions.settleMs ?? 650);
        const observedMs = performance.now() - renderStart;
        const geometry = measureGeometry(validated, fixture.expected);
        const browserErrors = capturedBrowserErrors.slice(errorsBefore);
        const problems = geometryProblems(geometry);
        if (browserErrors.length) problems.push('browser-error');
        if (renderState.cancelled) problems.push('render-cancelled');

        return {
            id: fixture.id,
            title: fixture.title,
            category: fixture.category,
            inputCombinedLength: fixture.expected.combinedLength,
            renderedCombinedLength: validated.sequence1.length + validated.sequence2.length,
            interactionPairs: fixture.expected.intermolecularBasePairs,
            cropping: input.cropping,
            validationMs,
            renderPromiseMs: promiseMs,
            observedMs,
            jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
            rotationDegrees: renderState.rotationDegrees ?? null,
            geometry,
            browserErrors,
            problems
        };
    }

    function defaultFullContextIds(cases) {
        const meyer = cases
            .filter(fixture => fixture.id.startsWith('meyer-'))
            .sort((a, b) => a.expected.combinedLength - b.expected.combinedLength);
        const indexes = [0, Math.floor(meyer.length / 4), Math.floor(meyer.length / 2),
            Math.floor(3 * meyer.length / 4), meyer.length - 1];
        return [
            ...new Set(indexes.map(index => meyer[index].id)),
            ...cases.filter(fixture => !fixture.id.startsWith('meyer-')).map(fixture => fixture.id)
        ];
    }

    async function runLiteratureBenchmark(options = {}) {
        const documentData = await fixtureDocument();
        const requestedIds = options.caseIds ? new Set(options.caseIds) : null;
        const croppedCases = requestedIds
            ? documentData.cases.filter(fixture => requestedIds.has(fixture.id))
            : documentData.cases;
        const fullIds = new Set(options.fullContextIds || defaultFullContextIds(documentData.cases));
        const fullCases = documentData.cases.filter(fixture => fullIds.has(fixture.id));
        const croppedRepeats = options.croppedRepeats ?? 2;
        const fullRepeats = options.fullRepeats ?? 1;
        const croppedContext = options.croppedContext ?? 20;
        const settleMs = options.settleMs ?? 650;
        const results = [];
        const startedAt = new Date().toISOString();
        const wallStart = performance.now();
        let completed = 0;
        const total = croppedCases.length * croppedRepeats + fullCases.length * fullRepeats;

        async function runSet(cases, repeats, mode, cropping) {
            for (let repeat = 1; repeat <= repeats; repeat++) {
                for (const fixture of cases) {
                    status(`${completed}/${total} · ${mode} repeat ${repeat} · ${fixture.id}`);
                    try {
                        const result = await renderFixture(fixture, { cropping, settleMs });
                        results.push({ mode, repeat, ...result });
                    } catch (error) {
                        results.push({
                            mode,
                            repeat,
                            id: fixture.id,
                            title: fixture.title,
                            category: fixture.category,
                            inputCombinedLength: fixture.expected.combinedLength,
                            cropping,
                            fatalError: error && error.stack ? error.stack : String(error),
                            problems: ['fatal-render-error']
                        });
                    }
                    completed++;
                }
            }
        }

        await runSet(croppedCases, croppedRepeats, 'cropped-context', croppedContext);
        await runSet(fullCases, fullRepeats, 'full-context', -1);

        const report = {
            schemaVersion: 1,
            startedAt,
            finishedAt: new Date().toISOString(),
            wallMs: performance.now() - wallStart,
            userAgent: navigator.userAgent,
            options: { croppedRepeats, fullRepeats, croppedContext, settleMs },
            fixtureCount: documentData.cases.length,
            executedRenders: results.length,
            browserErrors: capturedBrowserErrors.slice(),
            results
        };
        window.__varriBenchmarkReport = report;
        status(`complete · ${results.length} renders · ${report.wallMs.toFixed(1)} ms`);
        return report;
    }

    async function renderLiteratureCase(id, options = {}) {
        const documentData = await fixtureDocument();
        const fixture = documentData.cases.find(candidate => candidate.id === id);
        if (!fixture) throw new Error(`Unknown literature fixture: ${id}`);
        status(`rendering ${id}`);
        const result = await renderFixture(fixture, options);
        status(`${id} · ${result.problems.length ? result.problems.join(', ') : 'no detected problems'}`);
        return result;
    }

    window.runLiteratureBenchmark = runLiteratureBenchmark;
    window.renderLiteratureCase = renderLiteratureCase;
    window.getLiteratureFixtureDocument = fixtureDocument;
    fixtureDocument()
        .then(documentData => status(`ready · ${documentData.cases.length} literature fixtures`))
        .catch(error => status(`fixture load failed · ${error.stack || error}`));
}());
