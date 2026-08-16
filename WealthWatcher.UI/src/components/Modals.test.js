import test from 'node:test';
import assert from 'node:assert/strict';

const elements = new Map();
let assetCheckboxes = [];
let requests = [];
let saveSucceeds = true;

function createElement(id, value = '', tagName = 'div') {
    const children = [];
    const element = {
        id,
        value,
        tagName: tagName.toUpperCase(),
        type: tagName.toLowerCase() === 'input' ? 'text' : undefined,
        name: '',
        checked: false,
        disabled: false,
        required: false,
        innerText: '',
        style: {},
        dataset: {},
        children,
        parentElement: null,
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {},
        appendChild(child) {
            children.push(child);
            child.parentElement = this;
            return child;
        },
        removeChild(child) {
            const index = children.indexOf(child);
            if (index >= 0) children.splice(index, 1);
            child.parentElement = null;
            return child;
        },
        contains(child) {
            return child === this || children.some(candidate => candidate.contains?.(child));
        },
        closest(selector) {
            if (selector === 'label' && this.tagName === 'LABEL') return this;
            return this.parentElement?.closest?.(selector) ?? null;
        },
        setAttribute() {}
    };
    let innerHTML = '';
    Object.defineProperty(element, 'innerHTML', {
        get: () => innerHTML,
        set: valueToSet => {
            innerHTML = String(valueToSet);
            children.splice(0).forEach(child => { child.parentElement = null; });
        }
    });
    return element;
}

function findDescendants(node, predicate, matches = []) {
    for (const child of node?.children || []) {
        if (predicate(child)) matches.push(child);
        findDescendants(child, predicate, matches);
    }
    return matches;
}

function createTextNode(text) {
    return { textContent: text, parentElement: null, children: [] };
}

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };
globalThis.window.isObfuscated = false;
globalThis.document = {
    getElementById: id => elements.get(id) ?? null,
    createElement: tagName => createElement('', '', tagName),
    createTextNode,
    querySelectorAll: selector => {
        if (selector !== 'input[name="fire-assets"]' && selector !== 'input[name="fire-assets"]:checked') return [];
        const renderedCheckboxes = findDescendants(
            elements.get('fire-asset-options'),
            element => element.tagName === 'INPUT' && element.name === 'fire-assets'
        );
        if (renderedCheckboxes.length === 0) return assetCheckboxes;
        return selector.endsWith(':checked')
            ? renderedCheckboxes.filter(checkbox => checkbox.checked)
            : renderedCheckboxes;
    }
};
globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: saveSucceeds };
};

const { normalizeGeneralSettings, store } = await import('../store/store.js');
const {
    populateFireSettings,
    populateGeneralSettings,
    renderWindfallsTable,
    saveGeneralSettings,
    saveFireSettings
} = await import('./Modals.js');

function reset() {
    elements.clear();
    elements.set('fire-setting-income', createElement('fire-setting-income', '4,000.00'));
    elements.set('fire-setting-swr', createElement('fire-setting-swr', '4'));
    elements.set('fire-setting-state-pension', createElement('fire-setting-state-pension', ''));
    elements.set('fire-setting-include-state-pension', createElement('fire-setting-include-state-pension'));
    elements.set('fire-setting-include-windfalls', createElement('fire-setting-include-windfalls'));
    elements.set('windfalls-group', createElement('windfalls-group'));
    elements.set('windfalls-tbody', createElement('windfalls-tbody', '', 'tbody'));
    assetCheckboxes = [{ value: 'Investments' }, { value: 'PENSIONS' }];
    requests = [];
    saveSucceeds = true;
    window.tempWindfalls = [];
    store.state.CATEGORIES = [];
    store.state.fireSettings = {
        targetIncome: 4000,
        swr: 4,
        statePensionAmount: 12547,
        includedAssets: ['investments'],
        windfalls: []
    };
}

test('Fire asset selections save even when the hidden state pension field is blank', async () => {
    reset();

    const saved = await saveFireSettings();

    assert.equal(saved, true);
    assert.deepEqual(store.state.fireSettings.includedAssets, ['investments', 'pensions']);
    assert.equal(requests.length, 1);
    const payload = JSON.parse(requests[0].options.body);
    assert.deepEqual(JSON.parse(payload.wealthWatcherFireSettings).includedAssets, ['investments', 'pensions']);
});

test('Fire settings require a valid state pension amount only when enabled', async () => {
    reset();
    elements.get('fire-setting-include-state-pension').checked = true;
    elements.get('fire-setting-state-pension').value = '12,547.00';

    assert.equal(await saveFireSettings(), true);

    elements.get('fire-setting-state-pension').value = 'not a number';
    assert.equal(await saveFireSettings(), false);
    assert.equal(requests.length, 1);
});

test('Fire settings round-trip explicit zero income and state pension values', async () => {
    reset();
    store.state.fireSettings = {
        ...store.state.fireSettings,
        targetIncome: 0,
        includeStatePension: true,
        statePensionAmount: 0
    };

    populateFireSettings();

    assert.equal(elements.get('fire-setting-income').value, '0.00');
    assert.equal(elements.get('fire-setting-state-pension').value, '0.00');
    assert.equal(await saveFireSettings(), true);
    assert.equal(store.state.fireSettings.targetIncome, 0);
    assert.equal(store.state.fireSettings.statePensionAmount, 0);
    const payload = JSON.parse(requests[0].options.body);
    const savedSettings = JSON.parse(payload.wealthWatcherFireSettings);
    assert.equal(savedSettings.targetIncome, 0);
    assert.equal(savedSettings.statePensionAmount, 0);
});

test('Fire settings reject a zero withdrawal rate instead of restoring the default', async () => {
    reset();
    elements.get('fire-setting-swr').value = '0';

    assert.equal(await saveFireSettings(), false);
    assert.equal(elements.get('fire-setting-swr').value, '0');
    assert.equal(requests.length, 0);
});

test('FIRE settings restore the last saved state when persistence fails', async () => {
    reset();
    saveSucceeds = false;
    elements.get('fire-setting-income').value = '5,000.00';

    assert.equal(await saveFireSettings(), false);
    assert.equal(store.state.fireSettings.targetIncome, 4000);
    assert.equal(elements.get('fire-setting-income').value, '4,000.00');
});

test('Fire settings display a persisted zero withdrawal rate without restoring the default', () => {
    reset();
    store.state.fireSettings = {
        ...store.state.fireSettings,
        swr: 0
    };

    populateFireSettings();

    assert.equal(elements.get('fire-setting-swr').value, 0);
});

test('Fire settings population tolerates controls that are not rendered', () => {
    elements.clear();
    store.state.fireSettings = {};

    assert.doesNotThrow(() => populateFireSettings());
});

test('Fire settings population keeps the external state pension toggle and windfall controls working', async () => {
    reset();

    const assetOptions = createElement('fire-asset-options');
    const statePensionToggle = elements.get('fire-setting-include-state-pension');
    const statePensionLabel = createElement('', '', 'label');
    statePensionLabel.appendChild(statePensionToggle);
    const settingsControls = createElement('fire-settings-controls');
    settingsControls.appendChild(assetOptions);
    settingsControls.appendChild(statePensionLabel);
    elements.set('fire-asset-options', assetOptions);

    const statePensionGroup = elements.get('state-pension-amount-group') || createElement('state-pension-amount-group');
    elements.set('state-pension-amount-group', statePensionGroup);
    store.state.CATEGORIES = [
        { Id: 'investments', Label: 'Investments' },
        { Id: 'pensions', Label: 'Pensions' }
    ];
    store.state.fireSettings = {
        ...store.state.fireSettings,
        includeStatePension: true,
        includeWindfalls: true,
        statePensionAmount: 12547,
        includedAssets: ['pensions'],
        windfalls: [{ Name: 'Bonus', Amount: 1000, ExpectedDate: '2030-01-01', IncludeInCalculation: true }]
    };

    populateFireSettings();

    assert.equal(elements.get('fire-setting-include-state-pension'), statePensionToggle);
    assert.equal(assetOptions.contains(statePensionToggle), false);
    assert.deepEqual(
        assetOptions.children.map(label => label.children[0]?.value),
        ['investments', 'pensions']
    );
    assert.equal(settingsControls.children[1], statePensionLabel);
    assert.equal(statePensionLabel.parentElement, settingsControls);
    assert.equal(statePensionToggle.checked, true);
    assert.equal(elements.get('fire-setting-include-windfalls').checked, true);
    assert.equal(elements.get('windfalls-group').style.display, 'block');

    assert.equal(await saveFireSettings(), true);
    assert.equal(store.state.fireSettings.includeStatePension, true);
    assert.equal(store.state.fireSettings.includeWindfalls, true);
    assert.deepEqual(store.state.fireSettings.includedAssets, ['pensions']);
    assert.equal(requests.length, 1);
});

test('general settings use positive zero-value controls and migrate legacy dashboard settings', () => {
    assert.deepEqual(normalizeGeneralSettings({ hideZeroValues: true }), {
        showZeroValuesOnDashboard: false,
        showZeroValuesOnHistory: false,
        showSparklines: true
    });
    assert.equal(normalizeGeneralSettings({ hideZeroValues: false }).showZeroValuesOnDashboard, true);

    elements.clear();
    elements.set('general-setting-show-zero-values-dashboard', createElement('general-setting-show-zero-values-dashboard'));
    elements.set('general-setting-show-zero-values-history', createElement('general-setting-show-zero-values-history'));
    elements.set('general-setting-show-sparklines', createElement('general-setting-show-sparklines'));
    store.state.generalSettings = { hideZeroValues: true, showZeroValuesOnHistory: true, showSparklines: false };

    populateGeneralSettings();

    assert.equal(elements.get('general-setting-show-zero-values-dashboard').checked, false);
    assert.equal(elements.get('general-setting-show-zero-values-history').checked, true);
    assert.equal(elements.get('general-setting-show-sparklines').checked, false);
});

test('general settings restore the last saved state when persistence fails', async () => {
    reset();
    elements.set('general-setting-show-zero-values-dashboard', createElement('general-setting-show-zero-values-dashboard'));
    elements.set('general-setting-show-zero-values-history', createElement('general-setting-show-zero-values-history'));
    elements.set('general-setting-show-sparklines', createElement('general-setting-show-sparklines'));
    store.state.generalSettings = {
        showZeroValuesOnDashboard: false,
        showZeroValuesOnHistory: false,
        showSparklines: true
    };
    elements.get('general-setting-show-zero-values-dashboard').checked = true;
    saveSucceeds = false;

    assert.equal(await saveGeneralSettings(), false);
    assert.equal(store.state.generalSettings.showZeroValuesOnDashboard, false);
    assert.equal(elements.get('general-setting-show-zero-values-dashboard').checked, false);
});

test('windfall rows escape imported values and avoid inline event handlers', () => {
    reset();
    window.tempWindfalls = [{
        Name: '<img src=x onerror=alert(1)>',
        Amount: 1000,
        ExpectedDate: '</td><script>alert(1)</script>',
        IncludeInCalculation: true
    }];

    renderWindfallsTable();

    const markup = elements.get('windfalls-tbody').children[0].innerHTML;
    assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(markup, /&lt;\/td&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(markup, /<img|<script|onchange=|onclick=/);
});
