import test from 'node:test';
import assert from 'node:assert/strict';

import { renderBudgetV2Flow } from './BudgetV2Flow.js';

function createTarget() {
    const listeners = {};
    return {
        dataset: {},
        innerHTML: '',
        addEventListener(name, callback) {
            listeners[name] = callback;
        },
        dispatch(name, event = {}) {
            return listeners[name]?.({ target: this, preventDefault() {}, ...event });
        }
    };
}

function model(level, rows, source = { label: 'Income', value: 5000 }, sourceAction = null) {
    return {
        view: { level },
        source,
        sourceAction,
        rows,
        summary: level === 'overview' ? 'Budget groups' : 'Bills categories',
        caption: 'Select the next level to continue.',
        groupName: 'Bills'
    };
}

test('v2 flow renders SVG, mobile and accessible equivalents with group actions', async () => {
    const target = createTarget();
    const actions = [];
    renderBudgetV2Flow(target, model('overview', [{
        label: 'Bills', value: 1800, color: '#ef4444', action: { type: 'group', groupId: 'bills' }
    }]), {
        formatter: value => `£${value.toFixed(2)}`,
        onNavigate: action => actions.push(action)
    });

    assert.match(target.innerHTML, /budget-v2-flow-svg/);
    assert.match(target.innerHTML, /data-budget-flow-mobile/);
    assert.match(target.innerHTML, /data-budget-flow-accessible/);
    assert.match(target.innerHTML, /data-budget-v2-flow-action="group" data-budget-group="bills"/);

    await target.dispatch('click', {
        target: { closest: () => ({ dataset: { budgetV2FlowAction: 'group', budgetGroup: 'bills' } }) }
    });
    assert.deepEqual(actions[0], { type: 'group', groupId: 'bills', category: undefined });
});

test('v2 flow exposes All and Back navigation at nested levels', async () => {
    const target = createTarget();
    const actions = [];
    renderBudgetV2Flow(target, model('item', [{ label: 'Mortgage', value: 1600, color: '#ef4444' }], { label: 'Bills · Accommodation', value: 1600 }), {
        formatter: value => `£${value.toFixed(2)}`,
        onNavigate: action => actions.push(action)
    });

    assert.match(target.innerHTML, /data-budget-v2-flow-navigation="all"/);
    assert.match(target.innerHTML, /data-budget-v2-flow-navigation="back"/);
    await target.dispatch('click', {
        target: { closest: () => ({ dataset: { budgetV2FlowNavigation: 'back' } }) }
    });
    assert.deepEqual(actions[0], { type: 'back' });
});

test('v2 flow makes the left source bar a one-level back control', async () => {
    const target = createTarget();
    const actions = [];
    renderBudgetV2Flow(target, model('item', [{ label: 'Mortgage', value: 1600, color: '#ef4444' }], { label: 'Bills · Accommodation', value: 1600 }, {
        type: 'navigation',
        navigation: 'back',
        ariaLabel: 'Back to Bills categories'
    }), {
        formatter: value => `£${value.toFixed(2)}`,
        onNavigate: action => actions.push(action)
    });

    assert.match(target.innerHTML, /data-budget-v2-flow-navigation="back"/);
    assert.match(target.innerHTML, /aria-label="Back to Bills categories"/);
    await target.dispatch('click', {
        target: { closest: () => ({ dataset: { budgetV2FlowNavigation: 'back' } }) }
    });
    assert.deepEqual(actions[0], { type: 'back' });
});
