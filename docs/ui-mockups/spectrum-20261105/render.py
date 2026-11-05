"""Requires playwright Python package and system Google Chrome; no server/network."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    for variant in ['decision-first', 'evidence-first']:
        page = browser.new_page(viewport={'width': 1200, 'height': 1300}, device_scale_factor=2)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((root / (variant + '.html')).as_uri())
        assert page.get_by_text('DESIGN MOCKUP · ALL DATA SYNTHETIC · NOT CONNECTED').is_visible()
        page.screenshot(path=str(root / (variant + '.png')), full_page=True)
        page.get_by_role('button', name='Review channel 1').click()
        assert page.locator('dialog').is_visible()
        assert not page.locator('#opt').is_checked()
        page.screenshot(path=str(root / (variant + '-review.png')), full_page=True)
        page.get_by_role('button', name='Acknowledge preview').click()
        assert 'nothing applied' in page.locator('#feedback').inner_text()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(root / (variant + '-mobile.png')), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        results.append({'variant': variant, 'console_errors': errors, 'review_dialog': 'pass', 'default_opt_in': False, 'acknowledgement': 'pass', 'mobile_document_overflow': False})
        page.close()
    browser.close()
assert (root / 'decision-first.png').read_bytes() != (root / 'evidence-first.png').read_bytes()
(root / 'render-results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
