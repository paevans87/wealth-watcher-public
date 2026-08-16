import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };

const { store } = await import('../store/store.js');
const { loadForecastSnapshot } = await import('./ForecastV2.js');

test('Dashboard forecast snapshots reuse the keyed response and expose a projected date', async () => {
    const originalFetch = globalThis.fetch;
    const originalFeatureSettings = { ...store.state.featureSettings };
    let requestCount = 0;
    globalThis.fetch = async (_url, options) => {
        requestCount += 1;
        const request = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    Projection: [{ Date: '2026-09', Total: 450000 }],
                    CurrentNW: 411300,
                    TargetHitMonth: 198,
                    TargetHitDate: '2043-02-01',
                    receivedTarget: request.target
                };
            }
        };
    };

    store.state.featureSettings = { ...originalFeatureSettings, fire: true, tracker: true, forecast: true };
    store.state.fireSettings = {
        targetIncome: 4000,
        swr: 4,
        includeStatePension: false,
        includedAssets: ['investments']
    };
    store.state.forecastSettings = { annualReturn: 4, monthlyContribution: 1500, forecastStrategy: 'fire-default' };
    store.state.CATEGORIES = [{ Id: 'investments' }];
    store.state.fireStatusForecast = { key: '', status: 'idle', target: 0, data: null, date: null };

    try {
        const first = await loadForecastSnapshot({ force: true });
        const second = await loadForecastSnapshot();

        assert.equal(first.status, 'projected');
        assert.equal(first.date, '2043-02');
        assert.equal(second.status, 'projected');
        assert.equal(requestCount, 1);
    } finally {
        globalThis.fetch = originalFetch;
        store.state.featureSettings = originalFeatureSettings;
        store.clearCache();
    }
});

test('Dashboard forecast snapshots fail soft when the forecast endpoint is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const originalFeatureSettings = { ...store.state.featureSettings };
    globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Unavailable' });
    store.state.featureSettings = { ...originalFeatureSettings, fire: true, tracker: true, forecast: true };
    store.state.fireSettings = { targetIncome: 4000, swr: 4, includedAssets: ['investments'] };
    store.state.forecastSettings = { annualReturn: 4, monthlyContribution: 1500, forecastStrategy: 'fire-default' };
    store.state.CATEGORIES = [{ Id: 'investments' }];
    store.state.fireStatusForecast = { key: '', status: 'idle', target: 0, data: null, date: null };

    try {
        const snapshot = await loadForecastSnapshot({ force: true });
        assert.equal(snapshot.status, 'unavailable');
        assert.equal(snapshot.data, null);
    } finally {
        globalThis.fetch = originalFetch;
        store.state.featureSettings = originalFeatureSettings;
        store.clearCache();
    }
});
