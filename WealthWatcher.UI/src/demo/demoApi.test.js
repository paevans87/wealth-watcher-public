import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
    assert.equal(typeof (await settings.json()).wealthWatcherGeneralSettings, 'string');

    const dashboard = await handleDemoRequest('http://localhost:5000/api/dashboard?period=1M');
    const payload = await dashboard.json();
    assert.equal(dashboard.status, 200);
    assert.ok(payload.Categories.length >= 3);
    assert.ok(payload.Categories.every(category => category.Aggregate.Data.length > 0));
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
