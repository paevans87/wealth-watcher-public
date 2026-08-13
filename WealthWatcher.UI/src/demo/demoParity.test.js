import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEMO_API_CONTRACT } from './demoContract.js';
import { handleDemoRequest, resetDemoState } from './demoApi.js';

async function readJavaScriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await readJavaScriptFiles(path));
        else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path);
    }
    return files;
}

test.beforeEach(() => resetDemoState());

test('the demo adapter explicitly covers the current API-backed UI contract', async () => {
    for (const operation of DEMO_API_CONTRACT) {
        const response = await handleDemoRequest(operation.path, {
            method: operation.method,
            body: operation.body ? JSON.stringify(operation.body) : undefined
        });
        assert.equal(response.ok, true, `${operation.method} ${operation.path} returned ${response.status}`);
    }
});

test('core demo response shapes remain usable by their pages', async () => {
    const dashboard = await (await handleDemoRequest('/api/dashboard?period=1M')).json();
    assert.ok(Array.isArray(dashboard.Categories));
    assert.ok(dashboard.Categories.some(category => category.Aggregate?.Data?.length));
    assert.ok(Array.isArray(dashboard.YtdCategories));
    const investmentDetails = dashboard.Categories.find(category => category.Id === 'investments')?.Aggregate?.InvestmentDetails;
    assert.ok(investmentDetails && Object.values(investmentDetails).every(positions => Array.isArray(positions)));
    const propertyDetails = dashboard.Categories.find(category => category.Id === 'property')?.Aggregate?.PropertyDetails;
    assert.ok(Array.isArray(propertyDetails?.Properties));

    const history = await (await handleDemoRequest('/api/history?period=1M')).json();
    assert.ok(Array.isArray(history.Categories));
    assert.ok(Array.isArray(history.Timeline));

    const calendar = await (await handleDemoRequest('/api/calendar?year=2026&month=8')).json();
    assert.ok(Array.isArray(calendar.Days));
    assert.ok(calendar.Days.every(day => typeof day.Date === 'string'));
    assert.ok(calendar.Days.some(day => day.ChangeAvailable === true));
    assert.equal(calendar.MonthComparison?.Available, true);

    const forecast = await (await handleDemoRequest('/api/wealth/forecast', {
        method: 'POST',
        body: JSON.stringify({ target: 1200000, annualReturn: 4, monthlyContribution: 1500 })
    })).json();
    assert.ok(Array.isArray(forecast.Projection));
    assert.ok(forecast.Projection.every(point => point.Values && Number.isFinite(point.Total)));
});

test('application source has one browser-network boundary', async () => {
    const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
    const files = await readJavaScriptFiles(sourceRoot);
    const bypasses = [];
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        if (/\bfetch\s*\(/.test(source) && !file.endsWith(join('api', 'apiClient.js'))) {
            bypasses.push(file);
        }
    }
    assert.deepEqual(bypasses, [], `Direct fetch calls bypass the provider: ${bypasses.join(', ')}`);
});
