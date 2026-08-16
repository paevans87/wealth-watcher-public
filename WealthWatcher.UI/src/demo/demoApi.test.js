import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getDemoStore,
    getDemoState,
    handleDemoRequest,
    resetDemoState
} from './demoApi.js';

test.beforeEach(() => {
    resetDemoState();
});

test('representative reads return response-like, coherent demo data', async () => {
    const settings = await handleDemoRequest('/api/settings');
    assert.equal(settings.ok, true);
    const settingsPayload = await settings.json();
    assert.equal(typeof settingsPayload.wealthWatcherGeneralSettings, 'string');
    assert.equal(settingsPayload.wealthWatcherMilestoneSettings, '{"targets":[]}');

    const dashboard = await handleDemoRequest('http://localhost:5000/api/dashboard?period=1M');
    const payload = await dashboard.json();
    assert.equal(dashboard.status, 200);
    assert.ok(payload.Categories.length >= 3);
    assert.ok(payload.Categories.every(category => category.Aggregate.Data.length > 0));
});

test('milestone settings persist through the demo contract and reset cleanly', async () => {
    const write = await handleDemoRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
            wealthWatcherMilestoneSettings: JSON.stringify({ targets: [600000, 500000] })
        })
    });
    assert.equal(write.ok, true);
    assert.equal(await write.text(), '');

    const settings = await (await handleDemoRequest('/api/settings')).json();
    assert.deepEqual(JSON.parse(settings.wealthWatcherMilestoneSettings), { targets: [500000, 600000] });

    const invalid = await handleDemoRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
            wealthWatcherMilestoneSettings: JSON.stringify({ targets: [500000, 500000] })
        })
    });
    assert.equal(invalid.status, 400);

    resetDemoState();
    const resetSettings = await (await handleDemoRequest('/api/settings')).json();
    assert.deepEqual(JSON.parse(resetSettings.wealthWatcherMilestoneSettings), { targets: [] });
});

test('seed data provides dense history across the past year and a bit', () => {
    const state = getDemoState();
    const dates = [...new Set(state.entries.map(entry => entry.Date))].sort();
    const latestDate = new Date(`${dates.at(-1)}T12:00:00Z`);
    const earliestDate = new Date(`${dates[0]}T12:00:00Z`);
    const historyAgeDays = Math.round((latestDate - earliestDate) / (24 * 60 * 60 * 1000));
    const observationsByMonth = dates.reduce((months, date) => {
        const month = date.slice(0, 7);
        months[month] = (months[month] || 0) + 1;
        return months;
    }, {});
    const monthObservationCounts = Object.values(observationsByMonth);

    assert.ok(state.entries.length >= 800);
    assert.ok(dates.length >= 200);
    assert.ok(historyAgeDays >= 450);
    assert.ok(monthObservationCounts.every(count => count >= 10 && count <= 20));
    for (const assetId of ['asset-isa', 'asset-pension', 'asset-home', 'asset-cash']) {
        assert.ok(state.entries.filter(entry => entry.AssetId === assetId).length >= 200);
    }

    const isaValues = state.entries
        .filter(entry => entry.AssetId === 'asset-isa')
        .sort((a, b) => a.Date.localeCompare(b.Date))
        .map(entry => entry.Value);
    const changes = isaValues.slice(1).map((value, index) => value - isaValues[index]);
    const directionChanges = changes.slice(1).filter((change, index) => (
        Math.sign(change) !== 0 &&
        Math.sign(changes[index]) !== 0 &&
        Math.sign(change) !== Math.sign(changes[index])
    ));
    assert.ok(changes.some(change => change > 0));
    assert.ok(changes.some(change => change < 0));
    assert.ok(directionChanges.length >= 3);
});

test('seed forecast settings provide a birth date and a reachable target date', async () => {
    const settings = await (await handleDemoRequest('/api/settings')).json();
    const forecastSettings = JSON.parse(settings.wealthWatcherForecastSettings);
    assert.match(forecastSettings.dateOfBirth, /^\d{4}-\d{2}-\d{2}$/);

    const forecast = await (await handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({
            target: 1200000,
            annualReturn: forecastSettings.annualReturn,
            monthlyContribution: 0,
            includedAssets: ['investments', 'pensions', 'property']
        })
    })).json();
    assert.ok(forecast.TargetHitMonth > 0);
    assert.match(forecast.TargetHitDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('future-dated snapshots are excluded from dashboard and forecast current values', async () => {
    const request = {
        method: 'POST',
        body: JSON.stringify({
            target: 1000000000,
            annualReturn: 0,
            monthlyContribution: 0,
            includedAssets: ['investments']
        })
    };
    const before = await (await handleDemoRequest('/api/wealth/forecast', request)).json();
    const write = await handleDemoRequest('/api/wealth', {
        method: 'POST',
        body: JSON.stringify({
            Type: 'investments',
            AssetId: 'asset-isa',
            Name: 'Stocks & Shares ISA',
            Value: 999999,
            Date: '2099-01-01',
            Time: '12:00:00'
        })
    });
    assert.equal(write.status, 201);

    const after = await (await handleDemoRequest('/api/wealth/forecast', request)).json();
    const dashboard = await (await handleDemoRequest('/api/dashboard?period=1M')).json();
    const investments = dashboard.Categories.find(category => category.Id === 'investments').Aggregate;
    assert.equal(after.CurrentNW, before.CurrentNW);
    assert.equal(investments.Data.at(-1).Value, before.CurrentNW);
    assert.notEqual(investments.LatestBreakdown['Stocks & Shares ISA'], 999999);
});

test('forecast keeps future windfalls out of current net worth and applies them in the first period', async () => {
    const now = new Date();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (now.getUTCDate() >= lastDay) return;
    const futureDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
        .toISOString().slice(0, 10);
    const forecastRequest = windfalls => handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({
            target: 1000000000,
            annualReturn: 0,
            monthlyContribution: 0,
            includedAssets: ['investments'],
            windfalls
        })
    });
    const withoutWindfall = await (await forecastRequest([])).json();
    const future = await (await forecastRequest([{ Amount: 50000, ExpectedDate: futureDate, IncludeInCalculation: true }])).json();
    const pastDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
        .toISOString().slice(0, 10);
    const past = await (await forecastRequest([{ Amount: 50000, ExpectedDate: pastDate, IncludeInCalculation: true }])).json();

    assert.equal(future.CurrentNW, withoutWindfall.CurrentNW);
    assert.equal(future.Projection[0].Values['Unallocated Windfalls'], 0);
    assert.ok(future.Projection.some(point => point.Values['Unallocated Windfalls'] >= 50000));
    assert.equal(past.CurrentNW, withoutWindfall.CurrentNW + 50000);
});

test('forecast applies linked contributions using their configured cadence', async () => {
    const makeForecast = contributions => handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({
            target: 1000000000,
            annualReturn: 0,
            monthlyContribution: 0,
            includedAssets: ['investments'],
            contributions
        })
    });
    const baseline = await (await makeForecast([])).json();
    const monthly = await (await makeForecast([{ amount: 100, assetId: 'asset-isa', cadence: 'monthly' }])).json();
    const quarterly = await (await makeForecast([{ amount: 100, assetId: 'asset-isa', cadence: 'quarterly' }])).json();
    const baselineJanuary = baseline.Projection.find((point, index) => index > 0 && point.Date.endsWith('-01-01'))
        || baseline.Projection.at(-1);
    const monthlyJanuary = monthly.Projection.find(point => point.Date === baselineJanuary.Date);
    const quarterlyJanuary = quarterly.Projection.find(point => point.Date === baselineJanuary.Date);

    assert.ok(monthlyJanuary.Values.Investments > quarterlyJanuary.Values.Investments);
    assert.ok(quarterlyJanuary.Values.Investments > baselineJanuary.Values.Investments);
});

test('demo settings preserve intentional zero values and tolerate malformed JSON', async () => {
    const saved = await handleDemoRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
            wealthWatcherFireSettings: JSON.stringify({ targetIncome: 0, swr: 0, statePensionAmount: 0 }),
            wealthWatcherForecastSettings: JSON.stringify({ annualReturn: 0, monthlyContribution: 0 }),
            wealthWatcherBudgetSettings: JSON.stringify({ income: [], bills: [], savings: [{ amount: 0, cadence: 'annually' }], spend: [] })
        })
    });
    assert.equal(saved.status, 200);
    const settings = await (await handleDemoRequest('/api/settings')).json();
    assert.deepEqual(JSON.parse(settings.wealthWatcherFireSettings), { targetIncome: 0, swr: 0, statePensionAmount: 0 });
    assert.deepEqual(JSON.parse(settings.wealthWatcherForecastSettings), { annualReturn: 0, monthlyContribution: 0 });

    const malformed = await handleDemoRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ wealthWatcherForecastSettings: 'not-json' })
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(JSON.parse((await (await handleDemoRequest('/api/settings')).json()).wealthWatcherForecastSettings), {
        annualReturn: 0,
        monthlyContribution: 0
    });

    getDemoStore().settings.wealthWatcherForecastSettings = '[]';
    const safeSettings = await (await handleDemoRequest('/api/settings')).json();
    assert.equal(safeSettings.wealthWatcherForecastSettings, '{}');
    const forecast = await handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({ target: 0, annualReturn: 0, monthlyContribution: 0, includedAssets: ['investments'] })
    });
    assert.equal(forecast.status, 200);
    assert.equal((await forecast.json()).TargetHitMonth, 0);
});

test('demo returns API-like validation responses for invalid financial requests', async () => {
    const property = await handleDemoRequest('/api/properties', {
        method: 'POST',
        body: JSON.stringify({ Name: 'Invalid rental', Value: -1, Mortgage: 0 })
    });
    assert.equal(property.status, 400);

    const genericProperty = await handleDemoRequest('/api/wealth', {
        method: 'POST',
        body: JSON.stringify({ Type: 'property', AssetId: 'asset-home', Name: 'Primary Home', Value: 1, Mortgage: -1 })
    });
    assert.equal(genericProperty.status, 400);

    const invalidForecast = await handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({ Target: 100, IncludedAssets: null, Contributions: null, Windfalls: null })
    });
    assert.equal(invalidForecast.status, 400);

    const nullCollections = await handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({ Target: 100, IncludedAssets: ['investments'], Contributions: null, Windfalls: null })
    });
    assert.equal(nullCollections.status, 200);

    const invalidJson = await handleDemoRequest('/api/wealth/forecast', { method: 'POST', body: '{' });
    assert.equal(invalidJson.status, 400);
});

test('demo aggregates same-name entries instead of dropping the later asset', async () => {
    const beforeDashboard = await (await handleDemoRequest('/api/dashboard?period=1M')).json();
    const beforeBreakdown = beforeDashboard.Categories.find(category => category.Id === 'investments').Aggregate.LatestBreakdown;
    const created = await handleDemoRequest('/api/assets', {
        method: 'POST',
        body: JSON.stringify({ DisplayName: 'Second ISA', AssetKindId: 'kind-investments' })
    });
    const asset = await created.json();
    const today = new Date().toISOString().slice(0, 10);
    await handleDemoRequest('/api/wealth', {
        method: 'POST',
        body: JSON.stringify({ Type: 'cash', AssetId: asset.Id, Name: 'Stocks & Shares ISA', Value: 123, Date: today, Time: '00:00:00' })
    });

    const dashboard = await (await handleDemoRequest('/api/dashboard?period=1M')).json();
    const breakdown = dashboard.Categories.find(category => category.Id === 'investments').Aggregate.LatestBreakdown;
    assert.equal(breakdown['Stocks & Shares ISA'], beforeBreakdown['Stocks & Shares ISA'] + 123);
});

test('demo keeps explicit per-asset groups available for mixed-group dashboard splitting', async () => {
    const reassigned = await handleDemoRequest('/api/assets/asset-isa', {
        method: 'PATCH',
        body: JSON.stringify({ AssetGroupId: 'group-property' })
    });
    assert.equal(reassigned.status, 200);

    const assets = await (await handleDemoRequest('/api/assets')).json();
    const isa = assets.find(asset => asset.Id === 'asset-isa');
    const created = await handleDemoRequest('/api/assets', {
        method: 'POST',
        body: JSON.stringify({ DisplayName: 'Second ISA', AssetKindId: 'kind-investments', AssetGroupId: 'group-investments' })
    });
    const secondIsa = await created.json();
    await handleDemoRequest('/api/wealth', {
        method: 'POST',
        body: JSON.stringify({ Type: 'investments', AssetId: secondIsa.Id, Name: 'Second ISA', Value: 123, Date: new Date().toISOString().slice(0, 10), Time: '00:00:00' })
    });
    const assetsAfter = await (await handleDemoRequest('/api/assets')).json();
    const secondIsaRead = assetsAfter.find(asset => asset.Id === secondIsa.Id);
    assert.equal(isa.AssetGroupId, 'group-property');
    assert.equal(secondIsaRead.AssetGroupId, 'group-investments');

    const dashboard = await (await handleDemoRequest('/api/dashboard?period=1M')).json();
    const aggregate = dashboard.Categories.find(category => category.Id === 'investments').Aggregate;
    assert.ok(aggregate.LatestBreakdown['Stocks & Shares ISA'] > 0);
    assert.equal(aggregate.LatestBreakdown['Second ISA'], 123);
    assert.equal(
        Object.values(aggregate.LatestBreakdown).reduce((total, value) => total + value, 0),
        aggregate.Data.at(-1).Value
    );
});

test('writes update the shared ledger and are visible through later reads', async () => {
    const before = await (await handleDemoRequest('/api/assets')).json();
    const created = await handleDemoRequest('/api/assets', {
        method: 'POST',
        body: JSON.stringify({ DisplayName: 'Demo ISA', AssetKindId: 'kind-investments' })
    });
    const createdAsset = await created.json();
    assert.equal(created.status, 201);

    const after = await (await handleDemoRequest('/api/assets')).json();
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).Id, createdAsset.Id);

    await handleDemoRequest('/api/wealth', {
        method: 'POST',
        body: JSON.stringify({ Type: 'investments', AssetId: createdAsset.Id, Name: 'Demo ISA', Value: 12345, Date: new Date().toISOString().slice(0, 10), Time: '12:00:00' })
    });
    const names = await (await handleDemoRequest('/api/wealth/investments/names')).json();
    assert.ok(names.some(item => item.Id === createdAsset.Id));
});

test('reset restores the initial state after mutations', async () => {
    await handleDemoRequest('/api/assets', { method: 'POST', body: JSON.stringify({ DisplayName: 'Temporary', AssetKindId: 'kind-cash' }) });
    assert.equal((await (await handleDemoRequest('/api/assets')).json()).some(asset => asset.DisplayName === 'Temporary'), true);
    resetDemoState();
    assert.equal((await (await handleDemoRequest('/api/assets')).json()).some(asset => asset.DisplayName === 'Temporary'), false);
    assert.equal(getDemoState().integrations.length, 0);
});

test('unsupported routes and methods fail loudly with route context', async () => {
    await assert.rejects(
        () => handleDemoRequest('/api/not-an-endpoint'),
        /Unsupported demo GET route: \/not-an-endpoint/
    );
    await assert.rejects(
        () => handleDemoRequest('/api/dashboard', { method: 'DELETE' }),
        /Unsupported demo DELETE route: \/dashboard/
    );
});
