// Exercise the tarball, not the source checkout: missing files must fail CI.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'varri-package-check-'));
const npm = (args, cwd) => execFileSync('npm', args, {
  cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(temp, 'cache') },
});

try {
  npm(['pack', '--pack-destination', temp], root);
  const archive = fs.readdirSync(temp).find(name => name.endsWith('.tgz'));
  assert.ok(archive, 'npm pack produced an archive');
  const consumer = path.join(temp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true}');
  npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, archive)], consumer);
  const installedRequire = createRequire(path.join(consumer, 'package.json'));
  const installed = path.dirname(installedRequire.resolve('varri/package.json'));
  const manifest = installedRequire('varri/package.json');
  for (const key of Object.keys(manifest.exports)) {
    const specifier = key === '.' ? manifest.name : manifest.name + key.slice(1);
    assert.ok(fs.statSync(installedRequire.resolve(specifier)).isFile(), specifier);
  }
  assert.equal(typeof installedRequire('varri').render, 'function');
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "import v from 'varri'; if (typeof v.render !== 'function') throw Error('ESM API missing')"], { cwd: consumer });

  const origin = 'https://installed-package.invalid/';
  for (const name of ['index.html', 'README.html', 'citation.html']) {
    const html = fs.readFileSync(path.join(installed, name), 'utf8');
    const dom = new JSDOM(html);
    for (const element of dom.window.document.querySelectorAll('[src], link[href], a[href]')) {
      const value = element.getAttribute('src') || element.getAttribute('href');
      const url = new URL(value, origin + name);
      if (url.origin !== new URL(origin).origin) continue;
      const target = path.join(installed, decodeURIComponent(url.pathname));
      assert.ok(fs.existsSync(target), `${name} references missing packaged file ${value}`);
    }
    dom.window.close();
  }
  for (const name of ['README.md', 'CITATION.bib', 'CITATION.cff', 'src/README.md']) {
    assert.ok(fs.statSync(path.join(installed, name)).size > 0, `${name} must be packaged`);
  }
  // Markdown embeds are loaded by README.html after parsing, so inspect them too.
  const readme = fs.readFileSync(path.join(installed, 'README.md'), 'utf8');
  for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = new URL(match[1], origin);
    if (url.origin === new URL(origin).origin) {
      assert.ok(fs.existsSync(path.join(installed, decodeURIComponent(url.pathname))), `Missing README image ${match[1]}`);
    }
  }
  console.log('Installed package: viewer assets, documentation, citation data, CommonJS and ESM passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
