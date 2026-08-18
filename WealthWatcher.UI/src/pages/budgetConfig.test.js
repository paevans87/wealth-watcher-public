import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getBudgetGroupColorSuggestion,
    getBudgetItemCategory,
    getRealBudgetItemCategory,
    getNearestBudgetGroupColor,
    normalizeBudgetSettings,
    isIncomeBudgetGroup
} from './budgetConfig.js';

test('nearest group colour suggestions use the shared palette without overriding close matches', () => {
    assert.deepEqual(getNearestBudgetGroupColor('#ff0000'), {
        color: '#ef4444',
        distance: Math.sqrt((255 - 239) ** 2 + (0 - 68) ** 2 + (0 - 68) ** 2)
    });
    assert.equal(getBudgetGroupColorSuggestion('#ef4444'), null);
    assert.equal(getBudgetGroupColorSuggestion('#ef5050'), null);
    assert.equal(getBudgetGroupColorSuggestion('#ffffff')?.color, '#d946ef');
    assert.equal(getBudgetGroupColorSuggestion('not-a-colour'), null);
});

test('legacy budget documents normalize to v2 groups and request migration', () => {
    const settings = normalizeBudgetSettings({
        income: [{ name: 'Salary', amount: '4,800', cadence: 'monthly' }],
        bills: [{ name: 'Mortgage', amount: 1600, category: 'Accommodation' }],
        savings: [],
        spend: []
    });

    assert.equal(settings.version, 2);
    assert.equal(settings.needsUpdate, true);
    assert.equal(settings.groups.length, 4);
    assert.equal(settings.groups[0].name, 'Income');
    assert.equal(settings.groups[0].builtIn, true);
    assert.equal(settings.groups[0].color, '#06b6d4');
    assert.equal(settings.groups[1].color, '#ef4444');
    assert.equal(settings.groups[1].items[0].category, 'Accommodation');
    assert.equal(isIncomeBudgetGroup(settings.groups[0]), true);
});

test('v2 normalization keeps income built in while supporting display names and categories', () => {
    const settings = normalizeBudgetSettings({
        version: 2,
        needsUpdate: true,
        groups: [
            { id: 'travel', name: 'Travel', kind: 'custom', builtIn: false, color: '#123abc', items: [{ id: 'flights', name: 'Flights', amount: 300, category: '' }] },
            { id: 'income', name: 'Renamed income', kind: 'income', builtIn: true, items: [] }
        ]
    });

    assert.equal(settings.needsUpdate, true);
    assert.equal(settings.groups[0].id, 'income');
    assert.equal(settings.groups[0].name, 'Renamed income');
    assert.equal(settings.groups[0].builtIn, true);
    assert.equal(settings.groups[1].name, 'Travel');
    assert.equal(settings.groups[1].color, '#123abc');
    assert.equal(getBudgetItemCategory(settings.groups[1].items[0]), 'Uncategorised');
    assert.equal(getRealBudgetItemCategory(settings.groups[1].items[0]), '');
    assert.equal(getRealBudgetItemCategory({ category: 'Uncategorized' }), '');
    assert.equal(getRealBudgetItemCategory({ category: 'Accommodation' }), 'Accommodation');
});

test('saving normalization clears migration guidance without changing line items', () => {
    const settings = normalizeBudgetSettings({
        version: 2,
        needsUpdate: true,
        groups: [{ id: 'income', name: 'Income', builtIn: true, items: [{ id: 'salary', name: 'Salary', amount: 4000 }] }]
    }, { needsUpdate: false });

    assert.equal(settings.needsUpdate, false);
    assert.deepEqual(settings.groups[0].items[0], {
        id: 'salary',
        name: 'Salary',
        amount: 4000,
        cadence: 'monthly',
        assetId: null,
        category: ''
    });
});
