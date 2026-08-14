import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const [indexMarkup, stylesheet] = await Promise.all([
    readFile(path.join(sourceDirectory, '..', 'index.html'), 'utf8'),
    readFile(path.join(sourceDirectory, '..', 'style.css'), 'utf8')
]);

test('responsive shell and navigation contracts are present', () => {
    assert.match(stylesheet, /html\s*\{[\s\S]*overflow-x:\s*clip/);
    assert.match(stylesheet, /\.asset-group-section:not\(\[open\]\)\s*>\s*\.grid-container/);
    assert.match(stylesheet, /#calendar-view\s+\.calendar-grid-content\s*\{[\s\S]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(stylesheet, /\.presentation-empty-state-layout\s*\{[\s\S]*overflow:\s*hidden/);
    assert.match(stylesheet, /\.page-state-error\s*\{[\s\S]*background/);
    assert.match(stylesheet, /\.page-state-retry\s*\{/);
    assert.match(stylesheet, /\[data-page-state="loading"\][\s\S]*\.page-state-error/);

    for (const label of ['Dashboard', 'History', 'Calendar', 'Forecast', 'Tracker', 'Budget', 'Settings']) {
        assert.match(indexMarkup, new RegExp(`<a[^>]+aria-label="${label}"`));
    }

    assert.match(indexMarkup, /id="entry-modal"[\s\S]*?role="dialog"\s+aria-modal="true"/);
    assert.match(indexMarkup, /id="audit-modal"[\s\S]*?role="dialog"\s+aria-modal="true"/);
});

test('public demo banner is fixed above the page and preserves its layout space', () => {
    assert.match(stylesheet, /\.demo-mode-banner\s*\{[\s\S]*position:\s*fixed[\s\S]*top:\s*0[\s\S]*left:\s*0[\s\S]*right:\s*0/);
    assert.match(stylesheet, /\.demo-mode-banner\s*\{[\s\S]*background:\s*transparent[\s\S]*border-bottom:\s*0[\s\S]*box-shadow:\s*none/);
    assert.match(stylesheet, /html:not\(\[data-demo-mode="true"\]\)\s+\.demo-mode-banner\s*\{\s*display:\s*none;\s*\}/);
    assert.match(stylesheet, /body\.demo-mode\s*\{[\s\S]*padding-top:\s*calc\(var\(--demo-banner-height[\s\S]*var\(--demo-app-bar-height/);
    assert.match(stylesheet, /\.demo-mode \.top-nav\s*\{[\s\S]*position:\s*fixed[\s\S]*top:\s*var\(--demo-banner-height[\s\S]*z-index:\s*100/);
    assert.match(stylesheet, /\.demo-mode-banner\s*\{[\s\S]*z-index:\s*110/);
    assert.match(indexMarkup, /<html\s+lang="en"\s+data-demo-mode="false">/);
    assert.match(indexMarkup, /<aside id="demo-mode-banner" class="demo-mode-banner" data-demo-banner\s+role="status"/);
    assert.match(indexMarkup, /class="action-btn demo-main-site-link"\s+href="https:\/\/wealthwatcher\.co\.uk\/"/);
});

test('high-data pages have explicit mobile containment contracts', () => {
    assert.match(stylesheet, /#forecast-view\s+\.forecast-control-actions\s*\{[\s\S]*flex:\s*0 1 auto/);
    assert.match(stylesheet, /#fire-view\s+\.fire-dashboard\s*>\s*\.grid-container\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /#budget-view\s+#budget-overview-content\s*>\s*div:first-child\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /#budget-view\s+#budget-overview-content\s*>\s*\.card\s*>\s*div\s*\{[\s\S]*height:\s*300px/);
    assert.match(stylesheet, /@media\s*\(min-width:\s*769px\)[\s\S]*\.property-table-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(90px,\s*1\.25fr\)/);
});

test('mobile Budget configuration uses contained controls and card rows', () => {
    assert.match(indexMarkup, /<table class="budget-table" data-budget-category="income"/);
    assert.match(indexMarkup, /<table class="budget-table" data-budget-category="savings"/);
    assert.match(stylesheet, /@media\s*\(max-width:\s*560px\)[\s\S]*#budget-settings-pane\s+\.budget-entry-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /#budget-settings-pane\s+\.table-container\s*\{[\s\S]*overflow-x:\s*hidden\s*!important/);
    assert.match(stylesheet, /#budget-settings-pane\s+\.budget-table\s*\{[\s\S]*table-layout:\s*fixed/);
    assert.match(stylesheet, /#budget-settings-pane\s+\.budget-table:has\(\.budget-item-row\)\s+\.budget-item-row\s*\{[\s\S]*display:\s*grid/);
    assert.match(stylesheet, /#budget-settings-pane\s+\.budget-table\[data-budget-category="savings"\]\s+th\s*\{[\s\S]*font-size:\s*0\.68rem\s*!important[\s\S]*word-break:\s*normal/);
    assert.match(stylesheet, /#budget-settings-pane\s+\.budget-table\[data-budget-category="savings"\]\s+th:nth-child\(2\)\s*\{\s*width:\s*21%\s*!important/);
});

test('settings controls and integrations cannot establish a narrow-screen min-content width', () => {
    assert.match(stylesheet, /#settings-view\s+\.settings-toggle-list\s+\.feature-toggle\s*\{[\s\S]*width:\s*100%[\s\S]*min-width:\s*0/);
    assert.match(stylesheet, /#settings-view\s+\.catalog-kind-list\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(stylesheet, /#settings-view\s+\.integration-connection\s*\{[\s\S]*width:\s*100%/);
    assert.match(stylesheet, /#settings-view\s+\.integration-market-hours-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
