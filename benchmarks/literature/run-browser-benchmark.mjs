#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

function argument(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.find(item => item.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

const outputPath = path.resolve(argument('output', path.join(scriptDirectory, 'results', 'latest.json')));
const screenshotDirectory = path.resolve(
    argument('screenshot-dir', path.join(scriptDirectory, 'results', 'screenshots'))
);
const croppedRepeats = Number(argument('cropped-repeats', '2'));
const fullRepeats = Number(argument('full-repeats', '1'));
const croppedContext = Number(argument('cropped-context', '20'));
const settleMs = Number(argument('settle-ms', '650'));
const maximumScreenshots = Number(argument('max-screenshots', '8'));
const chromeExecutable = argument(
    'chrome',
    process.env.CHROME_BIN || '/usr/bin/google-chrome'
);

function mimeType(filename) {
    return ({
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
    })[path.extname(filename)] || 'application/octet-stream';
}

function createStaticServer() {
    return http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/benchmarks/literature/index.html';
        const filename = path.resolve(repositoryRoot, `.${pathname}`);
        if (!filename.startsWith(repositoryRoot + path.sep)) {
            response.writeHead(403).end('Forbidden');
            return;
        }
        fs.readFile(filename, (error, data) => {
            if (error) {
                response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
                return;
            }
            response.writeHead(200, { 'content-type': mimeType(filename) }).end(data);
        });
    });
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function availablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForJson(url, attempts = 120) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) return response.json();
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Chrome endpoint did not become ready: ${lastError}`);
}

class CdpClient {
    constructor(webSocketUrl) {
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.socket = new WebSocket(webSocketUrl);
    }

    async connect() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
                else pending.resolve(message.result);
                return;
            }
            (this.listeners.get(message.method) || []).forEach(listener => listener(message.params));
        });
    }

    on(method, listener) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(listener);
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        this.socket.close();
    }
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summarize(report, protocolErrors) {
    const completed = report.results.filter(result => !result.fatalError);
    const problemCounts = {};
    report.results.forEach(result => {
        (result.problems || []).forEach(problem => {
            problemCounts[problem] = (problemCounts[problem] || 0) + 1;
        });
    });
    const timings = completed.map(result => result.renderPromiseMs);
    const observed = completed.map(result => result.observedMs);
    const heap = completed.map(result => result.jsHeapBytes).filter(Number.isFinite);
    const croppedFirst = completed.filter(result => result.mode === 'cropped-context' && result.repeat === 1);
    const croppedLast = completed.filter(result => result.mode === 'cropped-context' && result.repeat === croppedRepeats);
    const firstMedian = percentile(croppedFirst.map(result => result.renderPromiseMs), 0.5);
    const lastMedian = percentile(croppedLast.map(result => result.renderPromiseMs), 0.5);

    return {
        executedRenders: report.results.length,
        completedRenders: completed.length,
        fatalRenders: report.results.length - completed.length,
        casesWithProblems: report.results.filter(result => result.problems?.length).length,
        problemCounts,
        protocolErrors,
        renderPromiseMs: {
            median: percentile(timings, 0.5),
            p95: percentile(timings, 0.95),
            maximum: timings.length ? Math.max(...timings) : null
        },
        observedMs: {
            median: percentile(observed, 0.5),
            p95: percentile(observed, 0.95),
            maximum: observed.length ? Math.max(...observed) : null
        },
        repeatDegradation: {
            firstCroppedMedianMs: firstMedian,
            lastCroppedMedianMs: lastMedian,
            ratio: Number.isFinite(firstMedian) && firstMedian > 0
                ? lastMedian / firstMedian
                : null
        },
        jsHeapBytes: {
            first: heap[0] ?? null,
            last: heap.at(-1) ?? null,
            maximum: heap.length ? Math.max(...heap) : null
        }
    };
}

async function evaluate(client, expression, awaitPromise = true) {
    const response = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true
    });
    if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
}

async function collectHeap(client) {
    await client.send('HeapProfiler.collectGarbage');
    await client.send('HeapProfiler.collectGarbage');
    return evaluate(client, `({
        usedJSHeapSize: performance.memory ? performance.memory.usedJSHeapSize : null,
        totalJSHeapSize: performance.memory ? performance.memory.totalJSHeapSize : null,
        domNodes: document.querySelectorAll('*').length
    })`);
}

async function releaseRenderedState(client) {
    await evaluate(client, `(async () => {
        const validated = vaRRI.validate({
            sequence: 'A&U',
            structure: '(&)',
            highlighting: 'nothing',
            backgroundhighlighting: 'nothing'
        });
        await vaRRI.render('rna-benchmark', validated, { forceLayout: false });
        document.getElementById('rna-benchmark').replaceChildren();
        await new Promise(resolve => setTimeout(resolve, 10000));
        return true;
    })()`);
}

function finiteDifference(value, baseline) {
    return Number.isFinite(value) && Number.isFinite(baseline) ? value - baseline : null;
}

async function captureScreenshots(client, report) {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    const priorities = [
        'gallery-coronel-tellez-2022',
        'gallery-wu-2024',
        'hiv-dis-1xpf-subtype-a',
        'hiv-dis-1xpe-subtype-b'
    ];
    const problematic = report.results
        .filter(result => result.problems?.length)
        .map(result => result.id);
    const ids = [...new Set([...priorities, ...problematic])].slice(0, maximumScreenshots);
    const outputs = [];

    for (const id of ids) {
        const result = await evaluate(
            client,
            `window.renderLiteratureCase(${JSON.stringify(id)}, { settleMs: ${settleMs} })`
        );
        const bounds = await evaluate(client, `(() => {
            const r = document.getElementById('rna-benchmark').getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 };
        })()`);
        const screenshot = await client.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
            clip: bounds
        });
        const filename = path.join(screenshotDirectory, `${id}.png`);
        fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
        outputs.push({ id, filename: path.relative(repositoryRoot, filename), problems: result.problems });
    }
    return outputs;
}

async function main() {
    if (!Number.isInteger(croppedRepeats) || croppedRepeats < 0 ||
        !Number.isInteger(fullRepeats) || fullRepeats < 0) {
        throw new Error('Repeat counts must be non-negative integers');
    }
    if (!fs.existsSync(chromeExecutable)) throw new Error(`Chrome not found: ${chromeExecutable}`);

    const staticServer = createStaticServer();
    const webPort = await listen(staticServer);
    const debugPort = await availablePort();
    const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'varri-literature-chrome-'));
    const chrome = spawn(chromeExecutable, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--enable-precise-memory-info',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDirectory}`,
        '--window-size=1220,860',
        'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let chromeStderr = '';
    chrome.stderr.on('data', chunk => { chromeStderr += String(chunk); });

    let client;
    try {
        await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
        const pageUrl = `http://127.0.0.1:${webPort}/benchmarks/literature/index.html`;
        const page = await fetch(
            `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`,
            { method: 'PUT' }
        ).then(response => response.json());
        client = new CdpClient(page.webSocketDebuggerUrl);
        await client.connect();
        const protocolErrors = [];
        client.on('Runtime.exceptionThrown', event => {
            protocolErrors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text);
        });
        client.on('Log.entryAdded', event => {
            if (event.entry.level === 'error') protocolErrors.push(event.entry.text);
        });
        await Promise.all([
            client.send('Runtime.enable'),
            client.send('Page.enable'),
            client.send('Log.enable'),
            client.send('HeapProfiler.enable')
        ]);
        await new Promise(resolve => setTimeout(resolve, 400));
        const readiness = await evaluate(client, 'window.getLiteratureFixtureDocument().then(x => x.cases.length)');
        process.stdout.write(`Loaded ${readiness} literature fixtures\n`);
        const baselineHeap = await collectHeap(client);

        let lastStatus = '';
        const progressTimer = setInterval(async () => {
            try {
                const current = await evaluate(client, 'window.__varriBenchmarkStatus || ""');
                if (current && current !== lastStatus) {
                    lastStatus = current;
                    process.stdout.write(`${current}\n`);
                }
            } catch {
                // The main evaluation will report a definitive protocol failure.
            }
        }, 10000);

        let report;
        try {
            report = await evaluate(client, `window.runLiteratureBenchmark(${JSON.stringify({
                croppedRepeats,
                fullRepeats,
                croppedContext,
                settleMs
            })})`);
        } finally {
            clearInterval(progressTimer);
        }
        report.protocolErrors = protocolErrors;
        report.summary = summarize(report, protocolErrors);
        const postBenchmarkHeap = await collectHeap(client);
        report.screenshots = await captureScreenshots(client, report);
        await releaseRenderedState(client);
        const releasedHeap = await collectHeap(client);
        report.memoryAudit = {
            baseline: baselineHeap,
            afterBenchmark: postBenchmarkHeap,
            afterReleasingRenderedState: releasedHeap,
            retainedGrowthBytes: finiteDifference(
                releasedHeap.usedJSHeapSize,
                baselineHeap.usedJSHeapSize
            )
        };
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
        process.stdout.write(`Report: ${outputPath}\n`);
    } finally {
        if (client) client.close();
        const chromeExited = new Promise(resolve => chrome.once('exit', resolve));
        chrome.kill('SIGTERM');
        await Promise.race([
            chromeExited,
            new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        staticServer.close();
        fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        if (chrome.exitCode && chrome.exitCode !== 0) {
            process.stderr.write(chromeStderr.slice(-4000));
        }
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
