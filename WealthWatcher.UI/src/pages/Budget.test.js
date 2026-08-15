import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(id = '') {
    const listeners = {};
    return {
        id,
        innerHTML: '',
        innerText: '',
        checked: false,
        hidden: false,
        dataset: {},
        style: {},
        children: [],
        appendChild(child) {
            this.children.push(child);
        },
        addEventListener(name, callback) {
            listeners[name] = callback;
        },
        async dispatch(name, event = {}) {
            return listeners[name]?.({ target: this, preventDefault() {}, ...event });
        }
    };
}

const elements = new Map();
globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };
globalThis.document = {
    getElementById: id => elements.get(id) ?? null,
    createElement
};

let requests = [];
let saveSucceeds = true;
globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: saveSucceeds };
};

const { store } = await import('../store/store.js');
const { loadBudgetView, populateBudgetSettings, setupBudgetSettings } = await import('./Budget.js');

function reset() {
    elements.clear();
    elements.set('budget-setting-enabled', createElement('budget-setting-enabled'));
    elements.set('budget-disabled-description', createElement('budget-disabled-description'));
    elements.set('budget-settings-form', createElement('budget-settings-form'));
    const budgetView = createElement('budget-view');
    const budgetHeader = createElement('budget-header');
    budgetHeader.nextElementSibling = null;
    budgetView.children.push(budgetHeader);
    budgetView.querySelector = selector => selector.includes('header') ? budgetHeader : null;
    budgetView.insertBefore = (child, reference) => {
        const index = reference ? budgetView.children.indexOf(reference) : -1;
        if (index >= 0) budgetView.children.splice(index, 0, child);
        else budgetView.children.push(child);
        elements.set(child.id, child);
    };
    budgetView.prepend = child => {
        budgetView.children.unshift(child);
        elements.set(child.id, child);
    };
    elements.set('budget-view', budgetView);
    elements.set('budget-overview-content', createElement('budget-overview-content'));
    ['budget-total-income', 'budget-total-bills', 'budget-total-savings', 'budget-total-spend', 'budget-unallocated']
        .forEach(id => elements.set(id, createElement(id)));
    elements.set('nav-budget', createElement('nav-budget'));
    requests = [];
    saveSucceeds = true;
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: true };
    store.state.budgetSettings = { income: [], bills: [], savings: [], spend: [] };
    store.state.assets = [];
}

let chartInstances = [];
globalThis.Chart = function ChartMock(_ctx, configuration) {
    const chart = {
        configuration,
        destroyed: false,
        destroy() {
            this.destroyed = true;
        }
    };
    chartInstances.push(chart);
    return chart;
};

test('budget settings populate the feature toggle from the runtime cache', () => {
    reset();
    store.state.featureSettings.budget = false;

    populateBudgetSettings();

    assert.equal(elements.get('budget-setting-enabled').checked, false);
    assert.equal(elements.get('budget-disabled-description').hidden, false);
    assert.equal(elements.get('budget-settings-form').hidden, true);

    store.state.featureSettings.budget = true;
    populateBudgetSettings();
    assert.equal(elements.get('budget-setting-enabled').checked, true);
    assert.equal(elements.get('budget-disabled-description').hidden, true);
    assert.equal(elements.get('budget-settings-form').hidden, false);
});

test('budget toggle updates nav visibility and persists feature settings', async () => {
    reset();
    setupBudgetSettings();

    const checkbox = elements.get('budget-setting-enabled');
    checkbox.checked = false;
    await checkbox.dispatch('change');

    assert.equal(store.state.featureSettings.budget, false);
    assert.equal(elements.get('nav-budget').hidden, true);
    assert.equal(elements.get('budget-disabled-description').hidden, false);
    assert.equal(elements.get('budget-settings-form').hidden, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        wealthWatcherFeatureSettings: '{"fire":true,"tracker":true,"forecast":true,"budget":false}'
    });
});

test('budget toggle restores its checked state when persistence fails', async () => {
    reset();
    saveSucceeds = false;
    setupBudgetSettings();

    const checkbox = elements.get('budget-setting-enabled');
    checkbox.checked = false;
    await checkbox.dispatch('change');

    assert.equal(store.state.featureSettings.budget, true);
    assert.equal(checkbox.checked, true);
    assert.equal(elements.get('nav-budget').hidden, false);
    assert.equal(elements.get('budget-disabled-description').hidden, true);
    assert.equal(elements.get('budget-settings-form').hidden, false);
});

test('budget settings render existing rows when the settings panel is initialised', () => {
    reset();
    const incomeBody = createElement('budget-income-tbody');
    elements.set('budget-income-tbody', incomeBody);
    store.state.budgetSettings.income = [{ name: 'Salary', amount: 4160 }];

    setupBudgetSettings();

    assert.equal(incomeBody.children.length, 1);
    assert.match(incomeBody.children[0].innerHTML, /Salary/);
    assert.match(incomeBody.children[0].innerHTML, /4,160\.00/);
});

test('budget rows escape imported names and use delegated actions', () => {
    reset();
    const incomeBody = createElement('budget-income-tbody');
    elements.set('budget-income-tbody', incomeBody);
    store.state.budgetSettings.income = [{
        name: '<img src=x onerror=alert(1)>',
        amount: 4160
    }];

    setupBudgetSettings();

    const markup = incomeBody.children[0].innerHTML;
    assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(markup, /data-budget-remove="income"/);
    assert.doesNotMatch(markup, /<img|onclick=/);
});

test('forecast asset uses the searchable asset typeahead in savings rows', () => {
    reset();
    const savingsBody = createElement('budget-savings-tbody');
    elements.set('budget-savings-tbody', savingsBody);
    store.state.assets = [{ Id: 'asset-isa', DisplayName: 'Stocks & Shares ISA' }];
    store.state.budgetSettings.savings = [{ id: 'saving-1', name: 'ISA', amount: 500, assetId: null }];

    populateBudgetSettings();

    const markup = savingsBody.children[0].innerHTML;
    assert.match(markup, /class="asset-typeahead budget-asset-typeahead"/);
    assert.match(markup, /class="asset-typeahead-search integration-asset-search"/);
    assert.match(markup, /class="asset-typeahead-options integration-asset-options"/);
    assert.match(markup, /data-asset-typeahead/);
    assert.match(markup, /aria-autocomplete="list"/);
    assert.doesNotMatch(markup, /<select[^>]+data-budget-saving-asset=/);
});

test('budget overview explains missing configuration and links to settings', () => {
    reset();
    const chartCountBeforeLoad = chartInstances.length;

    loadBudgetView();

    const emptyState = elements.get('budget-empty-state');
    assert.equal(emptyState.id, 'budget-empty-state');
    assert.match(emptyState.className, /catalog-workspace/);
    assert.match(emptyState.innerHTML, /presentation-empty-state-layout/);
    assert.match(emptyState.innerHTML, /Illustrative example/);
    assert.match(emptyState.innerHTML, /budget-preview/);
    assert.match(emptyState.innerHTML, /aria-label="Illustrative example of a configured budget overview"/);
    assert.match(emptyState.innerHTML, /href="#settings\?panel=monthly-budget"/);
    assert.match(emptyState.innerHTML, /aria-controls="budget-settings-pane"/);
    assert.match(emptyState.innerHTML, /No budget data yet/);
    assert.equal(elements.get('budget-view').children[1], emptyState);
    assert.equal(emptyState.hidden, false);
    assert.equal(elements.get('budget-overview-content').hidden, true);
    assert.equal(chartInstances.length, chartCountBeforeLoad);
});

test('budget overview shows configured totals and chart, then hides both when cleared', () => {
    reset();
    const totalIncome = elements.get('budget-total-income');
    const totalBills = elements.get('budget-total-bills');
    const totalSavings = elements.get('budget-total-savings');
    const totalSpend = elements.get('budget-total-spend');
    const unallocated = elements.get('budget-unallocated');
    elements.set('budget-chart-back-btn', createElement('budget-chart-back-btn'));
    elements.set('budgetChart', createElement('budgetChart'));
    store.state.budgetSettings = {
        income: [{ name: 'Salary', amount: 5000 }],
        bills: [{ name: 'Rent', amount: 2000 }],
        savings: [{ name: 'ISA', amount: 500 }],
        spend: [{ name: 'Groceries', amount: 300 }]
    };

    loadBudgetView();

    assert.equal(elements.has('budget-empty-state'), false, 'ready content should not create the no-data experience');
    assert.equal(elements.get('budget-overview-content').hidden, false);
    assert.equal(totalIncome.innerText, '£5,000.00');
    assert.equal(totalBills.innerText, '£2,000.00');
    assert.equal(totalSavings.innerText, '£500.00');
    assert.equal(totalSpend.innerText, '£300.00');
    assert.equal(unallocated.innerText, '£2,200.00');
    assert.deepEqual(chartInstances.at(-1).configuration.data.datasets[0].data, [2000, 500, 300, 2200]);

    store.state.budgetSettings = { income: [], bills: [], savings: [], spend: [] };
    loadBudgetView();

    assert.equal(elements.get('budget-empty-state').hidden, false);
    assert.equal(elements.get('budget-overview-content').hidden, true);
    assert.equal(totalIncome.innerText, '');
    assert.equal(totalBills.innerText, '');
    assert.equal(totalSavings.innerText, '');
    assert.equal(totalSpend.innerText, '');
    assert.equal(unallocated.innerText, '');
    assert.equal(chartInstances.at(-1).destroyed, true);
});
