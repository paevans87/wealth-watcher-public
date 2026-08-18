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
let nextSettingsResponse = null;
globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if ((options?.method || 'GET') === 'GET') {
        return {
            ok: true,
            status: 200,
            async json() {
                return nextSettingsResponse || {
                    wealthWatcherBudgetSettings: JSON.stringify({ income: [], bills: [], savings: [], spend: [] })
                };
            }
        };
    }
    return { ok: saveSucceeds, status: saveSucceeds ? 200 : 500 };
};

const { store } = await import('../store/store.js');
const {
    getBudgetCategoryOptions,
    getMonthlyBudgetTotals,
    getBudgetFlowData,
    loadBudgetView,
    populateBudgetSettings,
    renderBudgetLineEditorFieldMarkup,
    setupBudgetSettings
} = await import('./Budget.js');
const { createBudgetFlowModel } = await import('./BudgetFlow.js');

function reset() {
    elements.clear();
    elements.set('budget-setting-enabled', createElement('budget-setting-enabled'));
    elements.set('budget-disabled-description', createElement('budget-disabled-description'));
    elements.set('budget-settings-form', createElement('budget-settings-form'));
    elements.set('budget-flow-renderer', createElement('budget-flow-renderer'));
    elements.set('budget-validation-message', createElement('budget-validation-message'));
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
    elements.set('nav-budget', createElement('nav-budget'));
    requests = [];
    saveSucceeds = true;
    nextSettingsResponse = null;
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: true, milestones: false };
    store.state.budgetSettings = { income: [], bills: [], savings: [], spend: [] };
    store.state.assets = [];
}

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
    assert.equal(elements.get('nav-budget').hidden, false, 'Budget navigation remains reachable while disabled');
    assert.equal(elements.get('budget-disabled-description').hidden, false);
    assert.equal(elements.get('budget-settings-form').hidden, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        wealthWatcherFeatureSettings: '{"fire":true,"tracker":true,"forecast":true,"budget":false,"milestones":false}'
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

test('budget setup is idempotent when boot invokes it more than once', async () => {
    reset();
    setupBudgetSettings();
    setupBudgetSettings();

    const checkbox = elements.get('budget-setting-enabled');
    checkbox.checked = false;
    await checkbox.dispatch('change');

    assert.equal(requests.length, 1, 'the second setup pass must not add another toggle listener');
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

test('new budget rows save without client ids and hydrate server ids', async () => {
    reset();
    const nameInput = createElement('new-income-name');
    nameInput.value = 'Browser contract income';
    const amountInput = createElement('new-income-amount');
    amountInput.value = '123.45';
    const cadenceInput = createElement('new-income-cadence');
    cadenceInput.value = 'monthly';
    elements.set(nameInput.id, nameInput);
    elements.set(amountInput.id, amountInput);
    elements.set(cadenceInput.id, cadenceInput);
    nextSettingsResponse = {
        wealthWatcherBudgetSettings: JSON.stringify({
            income: [{ id: 'server-income-id', name: 'Browser contract income', amount: 123.45, cadence: 'monthly' }],
            bills: [],
            savings: [],
            spend: []
        })
    };

    window.addBudgetIncome();
    await new Promise(resolve => setTimeout(resolve, 350));

    assert.equal(requests.length, 2);
    const postedSettings = JSON.parse(JSON.parse(requests[0].options.body).wealthWatcherBudgetSettings);
    assert.equal(postedSettings.income[0].id, null);
    assert.equal(store.state.budgetSettings.income[0].id, 'server-income-id');
});

test('budget changes restore the last saved state when persistence fails', async () => {
    reset();
    store.state.budgetSettings.savings = [{
        id: 'saving-1',
        name: 'Emergency fund',
        amount: 300,
        cadence: 'monthly',
        assetId: null
    }];
    saveSucceeds = false;

    window.updateBudgetSavingCadence(0, 'annually');
    await new Promise(resolve => setTimeout(resolve, 350));

    assert.equal(store.state.budgetSettings.savings[0].cadence, 'monthly');
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

test('budget line editor uses the shared select and typeahead components', () => {
    reset();
    const settings = {
        version: 2,
        groups: [
            {
                id: 'income',
                name: 'Income',
                kind: 'income',
                role: 'income',
                builtIn: true,
                items: [{ id: 'salary', name: 'Salary', amount: 5000, category: 'Employment' }]
            },
            {
                id: 'bills',
                name: 'Bills',
                kind: 'custom',
                role: 'bills',
                builtIn: false,
                items: [
                    { id: 'mortgage', name: 'Mortgage', amount: 1600, cadence: 'quarterly', category: 'Accommodation' },
                    { id: 'water', name: 'Water', amount: 30, category: 'Utilities' },
                    { id: 'legacy', name: 'Legacy', amount: 10, category: 'Uncategorised' }
                ]
            }
        ]
    };
    const categoryOptions = getBudgetCategoryOptions(settings);
    assert.deepEqual(categoryOptions.map(option => option.DisplayName), ['Employment', 'Accommodation', 'Utilities']);

    const markup = renderBudgetLineEditorFieldMarkup({
        groupId: 'bills',
        itemId: 'mortgage',
        draft: { name: 'Mortgage', amount: '1600', category: 'Accommodation', cadence: 'quarterly', assetId: null }
    }, settings.groups[1]);

    assert.match(markup, /class="asset-typeahead budget-line-editor-category-typeahead"/);
    assert.match(markup, /placeholder="Search or enter a category…"/);
    assert.match(markup, /data-budget-editor-field="category"/);
    assert.match(markup, /data-asset-typeahead-empty-label="No category"/);
    assert.match(markup, /class="integration-select budget-line-editor-select"/);
    assert.match(markup, /<option value="quarterly" selected>Quarterly<\/option>/);
    assert.doesNotMatch(markup, /id="budget-editor-bills-mortgage-category"/);
});

test('budget overview explains missing configuration and keeps setup on the Budget page', () => {
    reset();

    loadBudgetView();

    const emptyState = elements.get('budget-empty-state');
    assert.equal(emptyState.id, 'budget-empty-state');
    assert.match(emptyState.className, /budget-page-state/);
    assert.match(emptyState.innerHTML, /Monthly allocation/);
    assert.match(emptyState.innerHTML, /Add income, bills, savings and spending below/);
    assert.doesNotMatch(emptyState.innerHTML, /href="#settings/);
    assert.equal(elements.get('budget-view').children[1], emptyState);
    assert.equal(emptyState.hidden, false);
    assert.equal(elements.get('budget-overview-content').hidden, true);
});

test('budget overview shows configured totals and clickable flow nodes, then hides both when cleared', async () => {
    reset();
    store.state.budgetSettings = {
        income: [{ name: 'Salary', amount: 5000 }],
        bills: [{ name: 'Rent', amount: 2000 }],
        savings: [{ name: 'ISA', amount: 500 }],
        spend: [{ name: 'Groceries', amount: 300 }]
    };

    loadBudgetView();

    assert.equal(elements.has('budget-empty-state'), false, 'ready content should not create the no-data experience');
    assert.equal(elements.get('budget-overview-content').hidden, false);
    assert.deepEqual(getMonthlyBudgetTotals(store.state.budgetSettings), {
        income: 5000,
        bills: 2000,
        savings: 500,
        spend: 300,
        unallocated: 2200
    });
    assert.match(elements.get('budget-flow-renderer').innerHTML, /budget-flow-svg/);
    assert.doesNotMatch(elements.get('budget-flow-renderer').innerHTML, /budget-flow-table/);
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-focus="bills"/);
    assert.match(elements.get('budget-flow-renderer').innerHTML, /class="budget-flow-node-hit-area"/);
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-mobile/);
    assert.doesNotMatch(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-status/);
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-drilldown-hint/);
    assert.equal(elements.get('budget-flow-renderer').dataset.flowState, 'left-to-allocate');

    const flowControl = { dataset: { budgetFlowFocus: 'bills' } };
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => flowControl }
    });
    const selectedBillsMarkup = elements.get('budget-flow-renderer').innerHTML;
    assert.match(selectedBillsMarkup, /data-budget-flow-breakdown="bills"/);
    assert.match(selectedBillsMarkup, /budget-flow-svg-drilldown/);
    assert.match(selectedBillsMarkup, /data-budget-flow-mobile data-budget-flow-breakdown="bills"/);
    assert.match(selectedBillsMarkup, /Bills breakdown/);
    assert.match(selectedBillsMarkup, /Rent/);
    assert.match(selectedBillsMarkup, /data-budget-flow-clear/);
    assert.doesNotMatch(selectedBillsMarkup, /data-budget-flow-node="income"/);
    assert.doesNotMatch(selectedBillsMarkup, /budget-flow-breakdown-item/);

    const backControl = { dataset: { budgetFlowClear: '' } };
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => backControl }
    });
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-node="income"/);
    assert.doesNotMatch(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-breakdown="bills"/);

    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => flowControl }
    });
    await elements.get('budget-flow-renderer').dispatch('keydown', {
        key: 'Enter',
        target: { closest: () => backControl }
    });
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-node="income"/);

    store.state.budgetSettings = { income: [], bills: [], savings: [], spend: [] };
    loadBudgetView();

    assert.equal(elements.get('budget-empty-state').hidden, false);
    assert.equal(elements.get('budget-overview-content').hidden, true);
    assert.equal(elements.get('budget-flow-renderer').innerHTML, '');
});

test('budget monthly overview normalises income, bills, and savings cadence', () => {
    reset();
    store.state.budgetSettings = {
        income: [
            { name: 'Salary', amount: 6000, cadence: 'monthly' },
            { name: 'Bonus', amount: 3000, cadence: 'quarterly' }
        ],
        bills: [
            { name: 'Rent', amount: 1800, cadence: 'monthly' },
            { name: 'Insurance', amount: 1200, cadence: 'annually' }
        ],
        savings: [
            { name: 'Emergency fund', amount: 300, cadence: 'monthly' },
            { name: 'Annual ISA', amount: 1200, cadence: 'annually' }
        ],
        spend: [{ name: 'Groceries', amount: 400, cadence: 'monthly' }]
    };

    assert.deepEqual(getMonthlyBudgetTotals(store.state.budgetSettings), {
        income: 7000,
        bills: 1900,
        savings: 400,
        spend: 400,
        unallocated: 4300
    });

    loadBudgetView();

    assert.match(elements.get('budget-flow-renderer').innerHTML, /£7,000\.00/);
    assert.match(elements.get('budget-flow-renderer').innerHTML, /£4,300\.00/);
});

test('budget v2 flow carries the selected group colour through every level', () => {
    reset();
    const settings = {
        version: 2,
        groups: [
            {
                id: 'income',
                name: 'Earnings',
                kind: 'income',
                role: 'income',
                builtIn: true,
                color: '#06b6d4',
                items: [{ id: 'salary', name: 'Salary', amount: 5000, category: 'Employment' }]
            },
            {
                id: 'bills',
                name: 'Bills',
                kind: 'custom',
                role: 'bills',
                builtIn: false,
                color: '#123abc',
                items: [{ id: 'mortgage', name: 'Mortgage', amount: 1600, category: 'Accommodation' }]
            }
        ]
    };
    const totals = getMonthlyBudgetTotals(settings);

    const overviewFlow = getBudgetFlowData(settings, { level: 'overview' }, totals);
    assert.equal(overviewFlow.rows[0].color, '#123abc');
    assert.equal(overviewFlow.source.label, 'Earnings');
    assert.equal(getBudgetFlowData(settings, { level: 'group', groupId: 'bills' }, totals).rows[0].color, '#123abc');
    assert.equal(getBudgetFlowData(settings, { level: 'item', groupId: 'bills', category: 'Accommodation' }, totals).rows[0].color, '#123abc');
});

test('budget v2 flow shows uncategorised child items without inventing a category', () => {
    reset();
    const settings = {
        version: 2,
        groups: [
            {
                id: 'income',
                name: 'Income',
                kind: 'income',
                role: 'income',
                builtIn: true,
                items: [{ id: 'salary', name: 'Salary', amount: 5000, category: 'Employment' }]
            },
            {
                id: 'general',
                name: 'General',
                kind: 'custom',
                builtIn: false,
                items: [
                    { id: 'groceries', name: 'Groceries', amount: 400, category: '' },
                    { id: 'mortgage', name: 'Mortgage', amount: 1200, category: 'Accommodation' },
                    { id: 'legacy-uncategorised', name: 'Legacy item', amount: 50, category: 'Uncategorised' }
                ]
            }
        ]
    };
    const totals = getMonthlyBudgetTotals(settings);
    const flow = getBudgetFlowData(settings, { level: 'group', groupId: 'general' }, totals);

    assert.deepEqual(flow.rows.map(row => ({ label: row.label, value: row.value, action: row.action })), [
        { label: 'Accommodation', value: 1200, action: { type: 'category', groupId: 'general', category: 'Accommodation' } },
        { label: 'Groceries', value: 400, action: null },
        { label: 'Legacy item', value: 50, action: null }
    ]);
    assert.equal(flow.rows.some(row => row.label === 'Uncategorised'), false);
    assert.equal(flow.summary, 'General categories');

    const staleUncategorisedView = getBudgetFlowData(settings, {
        level: 'item',
        groupId: 'general',
        category: 'Uncategorised'
    }, totals);
    assert.equal(staleUncategorisedView.summary, 'General categories');
});

test('budget flow breakdown formats annual lines and linked assets', async () => {
    reset();
    store.state.assets = [{ Id: 'asset-isa', DisplayName: 'Stocks & Shares ISA' }];
    store.state.budgetSettings = {
        income: [{ id: 'income-1', name: 'Salary', amount: 4800.86, cadence: 'monthly' }],
        bills: [{ id: 'bill-council-tax', name: 'Council tax', amount: 2160, cadence: 'annually' }],
        savings: [{ id: 'saving-isa', name: 'ISA contribution', amount: 500, cadence: 'monthly', assetId: 'asset-isa' }],
        spend: []
    };

    loadBudgetView();

    assert.match(elements.get('budget-flow-renderer').innerHTML, /£4,800\.86/);

    const flowControl = { dataset: { budgetFlowFocus: 'bills' } };
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => flowControl }
    });
    const billsMarkup = elements.get('budget-flow-renderer').innerHTML;
    assert.match(billsMarkup, /budget-flow-svg-drilldown/);
    assert.match(billsMarkup, /Council tax/);
    assert.match(billsMarkup, /£180\.00\/mo · £2,160\.00\/year/);

    const clearControl = { dataset: { budgetFlowClear: '' } };
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => clearControl }
    });
    assert.match(elements.get('budget-flow-renderer').innerHTML, /data-budget-flow-drilldown-hint/);

    const savingsControl = { dataset: { budgetFlowFocus: 'savings' } };
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => savingsControl }
    });
    const savingsMarkup = elements.get('budget-flow-renderer').innerHTML;
    assert.match(savingsMarkup, /data-budget-flow-asset-name="Stocks &amp; Shares ISA"/);
    assert.match(savingsMarkup, /linked to Stocks &amp; Shares ISA/);
    await elements.get('budget-flow-renderer').dispatch('click', {
        target: { closest: () => clearControl }
    });
});

test('budget flow reports a funding gap without negative geometry', () => {
    reset();
    store.state.budgetSettings = {
        income: [{ name: 'Income', amount: 1000 }],
        bills: [{ name: 'Bills', amount: 800 }],
        savings: [{ name: 'Savings', amount: 400 }],
        spend: [{ name: 'Spend', amount: 200 }]
    };
    loadBudgetView();
    const rendered = elements.get('budget-flow-renderer').innerHTML;
    assert.match(rendered, /data-budget-flow-node="funding-gap"/);
    assert.match(rendered, /data-budget-flow-link="funding-gap-link"/);
    assert.match(rendered, /stroke="#ef4444"/);
    assert.doesNotMatch(rendered, /data-budget-flow-link-row/);

    const model = createBudgetFlowModel({ income: 1000, bills: 800, savings: 400, spend: 200 });

    assert.equal(model.status, 'funding-gap');
    assert.equal(model.fundingGap, 400);
    assert.ok(model.links.every(link => Number.isFinite(link.amount) && link.amount >= 0));
    assert.equal(model.nodes.find(node => node.id === 'funding-gap').amount, 400);
});
