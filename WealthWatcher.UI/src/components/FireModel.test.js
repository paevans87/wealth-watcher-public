import test from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateFireSummary,
    calculateFireTarget,
    getIncludedFireAssetIds,
    getCurrentWindfallsAmount
} from './FireModel.js';

test('shared FIRE target math keeps tracker and forecast assumptions aligned', () => {
    const fire = {
        targetIncome: 4000,
        swr: 4,
        includeStatePension: true,
        statePensionAmount: 12000
    };

    assert.equal(calculateFireTarget(fire), 900000);
    assert.equal(calculateFireSummary({ categories: { investments: 300000 }, fire }).target, 900000);
});

test('shared FIRE summary separates selected assets from holistic categories', () => {
    const summary = calculateFireSummary({
        categories: {
            cash: 32000,
            investments: 200000,
            pensions: 150000,
            property: 275000
        },
        fire: {
            targetIncome: 4000,
            swr: 4,
            includedAssets: ['investments', 'pensions']
        }
    });

    assert.equal(summary.state, 'ready');
    assert.equal(summary.investableAssets, 350000);
    assert.equal(summary.target, 1200000);
    assert.equal(summary.gap, 850000);
    assert.equal(summary.targetReached, false);
});

test('shared FIRE summary keeps explicit zero settings and excludes future windfalls', () => {
    const summary = calculateFireSummary({
        categories: { investments: 100000 },
        fire: {
            targetIncome: 0,
            swr: 4,
            includedAssets: ['investments'],
            includeWindfalls: true,
            windfalls: [
                { amount: 50000, expectedDate: '2099-12-31', includeInCalculation: true },
                { amount: 10000, expectedDate: '2026-01-01', includeInCalculation: true }
            ]
        },
        today: '2026-08-16'
    });

    assert.equal(summary.targetIncome, 0);
    assert.equal(summary.target, 0);
    assert.equal(summary.investableAssets, 110000);
    assert.equal(summary.state, 'setup');
    assert.equal(getCurrentWindfallsAmount(summary.includeWindfalls ? [
        { amount: 10, expectedDate: '2026-01-01', includeInCalculation: true }
    ] : [], '2026-08-16'), 10);
});

test('included FIRE assets default away from cash and savings', () => {
    assert.deepEqual(getIncludedFireAssetIds({}, [
        { Id: 'cash' },
        { Id: 'investments' },
        { Id: 'savings' },
        { Id: 'property' }
    ]), ['investments', 'property']);
    assert.deepEqual(getIncludedFireAssetIds({ includedAssets: ['Pensions', 'pensions'] }), ['pensions']);
});
