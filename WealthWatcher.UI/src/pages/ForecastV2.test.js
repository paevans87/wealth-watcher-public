import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };
const { store } = await import('../store/store.js');
const {
    createProjectionChartConfig,
    FORECAST_STRATEGIES,
    FIRST_LAST_ANNUALIZED_STRATEGY,
    buildForecastRequest,
    getBudgetForecastContributions,
    getForecastAssetCalculationsPreference,
    getForecastCalculationStrategy,
    getForecastContributionInputs,
    renderHistoricalRateSources,
    setForecastAssetCalculationsPreference,
    setForecastPageState
} = await import('./ForecastV2.js');

function createForecastDom() {
    const elements = new Map();
    const strategyControls = { hidden: false };
    const results = { hidden: false };
    const rateSources = {
        hidden: false,
        innerHTML: '',
        innerText: '',
        children: [],
        setAttribute(name, value) {
            this[name] = value;
        },
        appendChild(element) {
            this.children.push(element);
        }
    };
    const header = { nextElementSibling: null };
    let insertedAfterHeader = false;
    const view = {
        prepend(element) {
            elements.set(element.id, element);
        },
        insertBefore(element, reference) {
            insertedAfterHeader = reference === null;
            elements.set(element.id, element);
        },
        querySelector(selector) {
            return selector === '.forecast-strategy-controls' ? strategyControls
                : selector === '.forecast-results' ? results
                    : selector.includes('header') ? header : null;
        }
    };
    elements.set('forecast-view', view);
    elements.set('forecast-rate-sources', rateSources);

    return {
        elements,
        strategyControls,
        results,
        wasInsertedAfterHeader: () => insertedAfterHeader,
        document: {
            getElementById: id => elements.get(id) ?? null,
            createElement: () => ({
                hidden: false,
                innerText: '',
                setAttribute() {}
            })
        }
    };
}

function withForecastDom(callback) {
    const originalDocument = globalThis.document;
    const dom = createForecastDom();
    globalThis.document = dom.document;
    try {
        callback(dom);
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
}

test('forecast strategy defaults to FIRE and accepts each named approach', () => {
    assert.equal(getForecastCalculationStrategy({}), 'fire-default');
    assert.equal(getForecastCalculationStrategy({ forecastStrategy: 'median-monthly-return' }), 'median-monthly-return');
    assert.equal(getForecastCalculationStrategy({ historicalCalculationStrategy: 'period-linked' }), 'fire-default');
    assert.equal(getForecastCalculationStrategy({ forecastStrategy: FIRST_LAST_ANNUALIZED_STRATEGY }), FIRST_LAST_ANNUALIZED_STRATEGY);
    assert.equal(FORECAST_STRATEGIES.length, 7);
    assert.ok(FORECAST_STRATEGIES.every(strategy => strategy.label && strategy.description));
    assert.match(FORECAST_STRATEGIES.find(strategy => strategy.value === FIRST_LAST_ANNUALIZED_STRATEGY).description, /first and last/i);
});

test('forecast calculation visibility defaults on and persists per browser storage', () => {
    const values = new Map();
    const storage = {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, value); }
    };

    assert.equal(getForecastAssetCalculationsPreference(storage), true);
    assert.equal(setForecastAssetCalculationsPreference(false, storage), false);
    assert.equal(getForecastAssetCalculationsPreference(storage), false);
    assert.equal(setForecastAssetCalculationsPreference(true, storage), true);
    assert.equal(getForecastAssetCalculationsPreference(storage), true);
});

test('forecast request persists the selected strategy without legacy period settings', () => {
    const request = buildForecastRequest({
        annualReturn: 5,
        monthlyContribution: 100,
        forecastStrategy: 'winsorized-monthly-return'
    }, 25000, { includedAssets: ['investments'], includeWindfalls: false });

    assert.equal(request.forecastStrategy, 'winsorized-monthly-return');
    assert.equal('historicalCalculationStrategy' in request, false);
    assert.equal('historicalAveragePeriod' in request, false);
    assert.deepEqual(request.includedAssets, ['investments']);
});

test('first-to-last strategy is sent unchanged through the forecast request', () => {
    const request = buildForecastRequest({
        annualReturn: 4,
        monthlyContribution: 100,
        forecastStrategy: FIRST_LAST_ANNUALIZED_STRATEGY
    }, 25000, { includedAssets: ['investments'], includeWindfalls: false });

    assert.equal(request.forecastStrategy, FIRST_LAST_ANNUALIZED_STRATEGY);
    assert.equal(request.annualReturn, 4);
});

test('projection chart is stacked and each asset type has its own dataset', () => {
    const points = [{
        Date: '2026-01-01',
        Values: { Investments: 100, Pensions: 200, 'Unallocated Contributions': 10 },
        Total: 310
    }];
    const config = createProjectionChartConfig(
        points, ['Investments', 'Pensions', 'Unallocated Contributions'], 1000);

    assert.equal(config.type, 'line');
    assert.equal(config.options.scales.y.stacked, true);
    assert.deepEqual(config.data.datasets.slice(0, 3).map(dataset => dataset.label),
        ['Investments', 'Pensions', 'Unallocated Contributions']);
    assert.ok(config.data.datasets.slice(0, 3).every(dataset => dataset.fill === true));
    assert.equal(config.data.datasets.at(-1).label, 'FIRE Target');
});

test('projection chart uses configured asset colours for matching stacks', () => {
    const points = [{
        Date: '2026-01-01',
        Values: { Investments: 100, Bonds: 200, 'Unallocated Contributions': 10 },
        Total: 310
    }];
    const config = createProjectionChartConfig(
        points,
        ['Investments', 'Bonds', 'Unallocated Contributions'],
        1000,
        [
            { Id: 'investments', Label: 'Investments', Color: '#123456' },
            { Id: 'bonds', Label: 'Bonds', Color: '#abcdef' }
        ]);

    assert.equal(config.data.datasets[0].borderColor, '#123456');
    assert.equal(config.data.datasets[0].backgroundColor, '#12345699');
    assert.equal(config.data.datasets[1].borderColor, '#abcdef');
    assert.equal(config.data.datasets[1].backgroundColor, '#abcdef99');
});

test('forecast empty state leaves only the setup prompt when projection data is absent', () => {
    withForecastDom(({ elements, strategyControls, results, wasInsertedAfterHeader }) => {
        setForecastPageState('empty');

        assert.equal(elements.get('forecast-empty-state').hidden, false);
        assert.match(elements.get('forecast-empty-state').innerHTML, /presentation-empty-state-layout/);
        assert.match(elements.get('forecast-empty-state').innerHTML, /Illustrative preview/);
        assert.match(elements.get('forecast-empty-state').innerHTML, /forecast-preview/);
        assert.match(elements.get('forecast-empty-state').innerHTML, /aria-label="Illustrative preview of a configured wealth forecast; not your data"/);
        assert.match(elements.get('forecast-empty-state').innerHTML, /href="#settings\?panel=fire-settings(?:&amp;|&)focus=fire-forecast-settings"/);
        assert.match(elements.get('forecast-empty-state').innerHTML, /aria-controls="fire-settings-pane"/);
        assert.equal(strategyControls.hidden, true);
        assert.equal(results.hidden, true);
        assert.equal(wasInsertedAfterHeader(), true);
    });
});

test('forecast empty state restores the strategy control and results when projection data exists', () => {
    withForecastDom(({ elements, strategyControls, results }) => {
        setForecastPageState('empty');
        setForecastPageState('ready');

        assert.equal(elements.get('forecast-empty-state').hidden, true);
        assert.equal(strategyControls.hidden, false);
        assert.equal(results.hidden, false);
    });
});

test('forecast error state is distinct from the illustrative empty experience and offers retry', () => {
    withForecastDom(({ elements, strategyControls, results }) => {
        setForecastPageState('empty');
        setForecastPageState('error');

        const emptyState = elements.get('forecast-empty-state');
        const errorState = elements.get('forecast-error-state');
        assert.equal(emptyState.hidden, true);
        assert.equal(errorState.hidden, false);
        assert.match(errorState.innerHTML, /We couldn't load your forecast/);
        assert.match(errorState.innerHTML, /forecast-retry/);
        assert.doesNotMatch(errorState.innerHTML, /forecast-preview/);
        assert.equal(strategyControls.hidden, true);
        assert.equal(results.hidden, true);
    });
});

test('forecast asset calculations can be hidden without losing the saved rate sources', () => {
    withForecastDom(({ elements }) => {
        renderHistoricalRateSources([{
            AssetName: 'NS&I',
            AnnualRatePercent: 4,
            Source: 'fire-default',
            HistoricalPeriodCount: 12
        }], false);

        const container = elements.get('forecast-rate-sources');
        assert.equal(container.hidden, true);
        assert.equal(container.children.length, 0);

        renderHistoricalRateSources(undefined, true);
        assert.equal(container.hidden, false);
        assert.equal(container.children.length, 1);
        assert.match(container.children[0].innerText, /NS&I: 4\.00%/);
    });
});

test('disabled budgeting does not add saved savings to the forecast request', () => {
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: false, milestones: false };
    store.state.budgetSettings = {
        savings: [{ name: 'ISA', amount: 200, assetId: 'asset-isa', cadence: 'quarterly' }]
    };

    assert.deepEqual(getBudgetForecastContributions(), []);

    store.state.featureSettings.budget = true;
    assert.deepEqual(getBudgetForecastContributions(), [{
        name: 'ISA', amount: 200, assetId: 'asset-isa', cadence: 'quarterly'
    }]);
});

test('unlinked budget savings use the configured forecast contribution', () => {
    store.state.budgetSettings = {
        savings: [{ name: 'General saving', amount: 200, assetId: null, cadence: 'monthly' }]
    };

    assert.deepEqual(getForecastContributionInputs({ monthlyContribution: 1500 }), {
        monthlyContribution: 1500,
        contributions: []
    });
});

test('linked budget savings stay asset-specific while unlinked savings use the manual fallback', () => {
    store.state.budgetSettings = {
        savings: [
            { name: 'ISA', amount: 500, assetId: 'asset-isa', cadence: 'monthly' },
            { name: 'General saving', amount: 200, assetId: null, cadence: 'monthly' }
        ]
    };

    assert.deepEqual(getForecastContributionInputs({ monthlyContribution: 1500 }), {
        monthlyContribution: 1500,
        contributions: [{ name: 'ISA', amount: 500, assetId: 'asset-isa', cadence: 'monthly' }]
    });
});
