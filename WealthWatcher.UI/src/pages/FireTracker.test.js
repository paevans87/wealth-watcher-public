import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../store/store.js';
import { getCurrentWindfallsAmount, renderFireView } from './FireTracker.js';

// Setup minimal DOM environment mock for testing renderFireView
function setupMockDOM() {
    const elements = {};
    const querySelectors = {
        'input[name="fire-assets"]': [],
        '#fire-view .obfuscate-val': []
    };

    const getOrCreateElement = (id) => {
        if (id === 'fire-empty-state' && !elements[id]) return null;
        if (!elements[id]) {
            elements[id] = { id, value: '', innerText: '', checked: false, style: {} };
        }
        return elements[id];
    };

    global.window = global.window || {};
    global.document = {
        getElementById: (id) => getOrCreateElement(id),
        querySelectorAll: (selector) => querySelectors[selector] || [],
        createElement: () => ({
            id: '',
            className: '',
            innerHTML: '',
            hidden: false,
            setAttribute() {}
        })
    };

    elements['fire-view'] = {
        id: 'fire-view',
        children: [],
        querySelector(selector) {
            if (selector === 'header') return elements['fire-header'];
            if (selector === '.fire-dashboard') return elements['fire-dashboard'];
            return null;
        },
        prepend(child) {
            this.children.unshift(child);
            elements[child.id] = child;
        }
    };
    elements['fire-header'] = { hidden: false };
    elements['fire-dashboard'] = { hidden: false };

    return elements;
}

test('FireTracker fallback includedAssets excludes cash and savings by default', () => {
    setupMockDOM();
    
    // Set fireSettings without includedAssets
    store.state.fireSettings = {
        targetIncome: 4000,
        swr: 4.0,
        includeStatePension: false,
        statePensionAmount: 12547,
        includeWindfalls: false,
        expectedWindfalls: 0
    };

    // Populate categories including cash & savings
    store.state.categories = {
        cash: 20000,
        savings: 30000,
        investments: 100000,
        pensions: 150000,
        property: 200000
    };

    renderFireView();

    const currentAssetsEl = document.getElementById('fire-current-assets');
    // Investments (100k) + Pensions (150k) + Property (200k) = 450,000. Cash and savings are excluded.
    assert.strictEqual(currentAssetsEl.innerText, '£450,000.00');
});

test('FireTracker calculates investable assets correctly with custom includedAssets and active windfalls', () => {
    setupMockDOM();
    
    store.state.fireSettings = {
        targetIncome: 4000,
        swr: 4.0,
        includeStatePension: false,
        statePensionAmount: 12547,
        includeWindfalls: true,
        includedAssets: ['investments', 'pensions'],
        windfalls: [
            { Description: 'Inheritance', Amount: 50000, ExpectedDate: '2000-01-01', IncludeInCalculation: true },
            { Description: 'Bonus', Amount: 10000, ExpectedDate: '2000-01-01', IncludeInCalculation: false }
        ]
    };

    store.state.categories = {
        cash: 20000,
        savings: 30000,
        investments: 100000,
        pensions: 150000,
        property: 200000
    };

    renderFireView();

    const currentAssetsEl = document.getElementById('fire-current-assets');
    // Investments (100k) + Pensions (150k) + Active Windfall (50k) = 300,000. Property, Cash, Savings excluded.
    assert.strictEqual(currentAssetsEl.innerText, '£300,000.00');
});

test('FireTracker keeps future windfalls forecast-only and preserves explicit zero FIRE values', () => {
    const elements = setupMockDOM();
    store.state.fireSettings = {
        targetIncome: 0,
        swr: 4,
        includeStatePension: true,
        statePensionAmount: 0,
        includeWindfalls: true,
        includedAssets: ['investments'],
        windfalls: [
            { Amount: 50000, ExpectedDate: '2099-12-31', IncludeInCalculation: true },
            { Amount: 10000, ExpectedDate: '2000-01-01', IncludeInCalculation: true }
        ]
    };
    store.state.categories = { investments: 100000 };

    renderFireView();

    assert.equal(elements['fire-current-assets'].innerText, '£110,000.00');
    assert.equal(elements['fire-target-income'].innerText, '£0.00');
    assert.equal(elements['fire-target-display'].innerText, '£0.00');
    assert.equal(elements['fire-setting-income'].value, '0.00');
    assert.equal(elements['fire-setting-state-pension'].value, '0.00');
});

test('current windfall totals require an included, valid date on or before today', () => {
    assert.equal(getCurrentWindfallsAmount([
        { Amount: 10, ExpectedDate: '2026-01-01', IncludeInCalculation: true },
        { Amount: 20, ExpectedDate: '2026-06-01', IncludeInCalculation: true },
        { Amount: 30, ExpectedDate: '2026-06-01', IncludeInCalculation: false },
        { Amount: 40, ExpectedDate: 'not-a-date', IncludeInCalculation: true }
    ], '2026-06-01'), 30);
});

test('FireTracker shows a settings CTA when tracking data is absent', () => {
    const elements = setupMockDOM();
    store.state.categories = {};

    renderFireView();

    assert.equal(elements['fire-empty-state'].hidden, false);
    assert.equal(elements['fire-header'].hidden, true);
    assert.equal(elements['fire-dashboard'].hidden, true);
    assert.match(elements['fire-empty-state'].innerHTML, /presentation-empty-state-layout/);
    assert.match(elements['fire-empty-state'].innerHTML, /Illustrative example/);
    assert.match(elements['fire-empty-state'].innerHTML, /tracker-preview/);
    assert.match(elements['fire-empty-state'].innerHTML, /aria-label="Illustrative example of a configured FIRE tracker"/);
    assert.match(elements['fire-empty-state'].innerHTML, /Illustrative projection/);
    assert.doesNotMatch(elements['fire-empty-state'].innerHTML, /On track/);
    assert.match(elements['fire-empty-state'].innerHTML, /href="#settings\?panel=fire-settings(?:&amp;|&)focus=fire-tracker-settings"/);
    assert.match(elements['fire-empty-state'].innerHTML, /aria-controls="fire-settings-pane"/);
    assert.match(elements['fire-empty-state'].innerHTML, /No tracking data yet/);
});

test('FireTracker restores the header and dashboard when tracking data exists', () => {
    const elements = setupMockDOM();
    store.state.categories = {};
    renderFireView();

    assert.equal(elements['fire-header'].hidden, true);
    assert.equal(elements['fire-dashboard'].hidden, true);

    store.state.categories = { investments: 100000 };

    renderFireView();

    assert.equal(elements['fire-empty-state'].hidden, true);
    assert.equal(elements['fire-header'].hidden, false);
    assert.equal(elements['fire-dashboard'].hidden, false);
});

test('FireTracker clears stale calculated content before rendering the no-data experience', () => {
    const elements = setupMockDOM();
    store.state.categories = { investments: 100000 };
    renderFireView();

    assert.notEqual(elements['fire-current-assets'].innerText, '');
    elements['fire-progress-fill'].style.width = '68%';

    store.state.categories = {};
    renderFireView();

    assert.equal(elements['fire-current-assets'].innerText, '');
    assert.equal(elements['fire-target-display'].innerText, '');
    assert.equal(elements['fire-progress-fill'].style.width, '0%');
    assert.equal(elements['fire-header'].hidden, true);
    assert.equal(elements['fire-dashboard'].hidden, true);
});
