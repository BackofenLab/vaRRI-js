"""Smoke-test a served, installed package. Requires Python Playwright and Chrome.

Usage: python scripts/browser-smoke.py http://127.0.0.1:8080 /tmp/varri-browser-results
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/')
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    errors, missing_local, external_failures = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: missing_local.append(response.url)
            if response.url.startswith(base + '/') and response.status >= 400 else None)
    page.on('requestfailed', lambda request: external_failures.append(request.url)
            if not request.url.startswith(base + '/') else missing_local.append(request.url))
    try:
        page.goto(base + '/index.html', wait_until='networkidle')
        page.locator('#exampleDropdownTrigger').click()
        examples = page.locator('#exampleDropdownOptions [data-example]')
        assert examples.count() > 0, 'Packaged example catalog is missing'
        examples.first.click()
        page.wait_for_selector('#rendering-canvas svg')
        page.wait_for_function("document.querySelectorAll('#rendering-canvas svg circle').length > 0")
        for extension, button in [('svg', '#exportSvgBtn'), ('png', '#exportPngBtn')]:
            with page.expect_download() as result:
                page.locator(button).click()
            target = output / ('render.' + extension)
            result.value.save_as(target)
            assert target.stat().st_size > 100, f'{extension} export is empty'
            if extension == 'png':
                assert target.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            else:
                assert '<svg' in target.read_text()
        page.screenshot(path=str(output / 'viewer.png'), full_page=True)
        page.goto(base + '/README.html', wait_until='networkidle')
        page.wait_for_selector('#markdown-text h1')
        page.goto(base + '/citation.html', wait_until='networkidle')
        page.wait_for_function("document.querySelector('#pre-bibtex')?.textContent.includes('@')")
        assert not missing_local, f'Missing package assets: {missing_local}'
        assert not errors, f'Browser errors: {errors}'
        print(json.dumps({'result': 'passed', 'checks': ['example rendering', 'SVG', 'PNG', 'README', 'citation'],
                          'external_request_failures': external_failures}, indent=2))
    finally:
        browser.close()
