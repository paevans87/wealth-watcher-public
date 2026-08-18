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
    assert.match(target.innerHTML, /class="budget-v2-flow-mobile-source" style="--budget-flow-accent: #06b6d4"/);
    assert.match(target.innerHTML, /<li style="--budget-flow-accent: #ef4444"><button/);
    assert.match(target.innerHTML, /Bills <tspan class="budget-flow-svg-value obfuscate-val">\(£1800\.00\)<\/tspan>/);
    assert.match(target.innerHTML, /Bills <strong class="budget-flow-inline-value obfuscate-val">\(£1800\.00\)<\/strong>/);

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

test('v2 mobile flow keeps the selected source colour on rows without an explicit colour', () => {
    const target = createTarget();
    renderBudgetV2Flow(target, model(
        'group',
        [{ label: 'Mortgage', value: 1600, action: { type: 'category', groupId: 'bills', category: 'Accommodation' } }],
        { label: 'Bills', value: 1600, color: '#123abc' }
    ), {
        formatter: value => `£${value.toFixed(2)}`
    });

    assert.match(target.innerHTML, /class="budget-v2-flow-mobile-source" style="--budget-flow-accent: #123abc"/);
    assert.match(target.innerHTML, /<li style="--budget-flow-accent: #123abc"><button/);
});

test('v2 flow marks category rows without marking direct line items', () => {
    const target = createTarget();
    renderBudgetV2Flow(target, model('group', [
        { label: 'Accommodation', value: 1600, color: '#123abc', action: { type: 'category', groupId: 'bills', category: 'Accommodation' } },
        { label: 'PHC', value: 9.49, color: '#123abc', action: null }
    ]), {
        formatter: value => `£${value.toFixed(2)}`
    });

    assert.match(target.innerHTML, /budget-v2-flow-node-group is-interactive is-category/);
    assert.match(target.innerHTML, /budget-flow-svg-category-marker/);
    assert.match(target.innerHTML, /budget-flow-mobile-category-marker/);
    assert.equal((target.innerHTML.match(/budget-flow-mobile-category-marker/g) || []).length, 1);
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

test('v2 flow source bar spans the rendered flow stack', async () => {
    const target = createTarget();
    renderBudgetV2Flow(target, model('overview', [
        { label: 'Bills', value: 2500, color: '#ef4444', action: { type: 'group', groupId: 'bills' } },
        { label: 'Savings', value: 1500, color: '#f97316', action: { type: 'group', groupId: 'savings' } },
        { label: 'Spend', value: 1000, color: '#ec4899', action: { type: 'group', groupId: 'spend' } }
    ]), {
        formatter: value => `£${value.toFixed(2)}`
    });

    const rects = [...target.innerHTML.matchAll(/<rect class="budget-v2-flow-node" x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]), height: Number(match[3]) }));
    const source = rects.find(rect => rect.x === 220);
    const targets = rects.filter(rect => rect.x === 620);
    assert.ok(source);
    assert.equal(targets.length, 3);
    assert.ok(Math.abs(source.y - targets[0].y) < 0.01);
    assert.ok(targets[1].y - (targets[0].y + targets[0].height) >= 24);
    assert.ok(Math.abs((source.y + source.height) - (targets.at(-1).y + targets.at(-1).height)) < 0.01);
});

test('v2 flow branches links from the centred source stream', () => {
    const target = createTarget();
    renderBudgetV2Flow(target, model('overview', [
        { label: 'Bills', value: 2500, color: '#ef4444', action: { type: 'group', groupId: 'bills' } },
        { label: 'Savings', value: 1500, color: '#f97316', action: { type: 'group', groupId: 'savings' } },
        { label: 'Spend', value: 1000, color: '#ec4899', action: { type: 'group', groupId: 'spend' } }
    ]), {
        formatter: value => `£${value.toFixed(2)}`
    });

    const paths = [...target.innerHTML.matchAll(/<path class="budget-v2-flow-link" d="M [\d.]+ ([\d.]+) C [\d.]+ [\d.]+, [\d.]+ [\d.]+, [\d.]+ ([\d.]+)"/g)]
        .map(match => ({ sourceY: Number(match[1]), targetY: Number(match[2]) }));
    assert.equal(paths.length, 3);
    assert.ok(paths[0].sourceY > paths[0].targetY);
    assert.ok(paths.at(-1).sourceY < paths.at(-1).targetY);
});

test('v2 flow uses the source colour for the drilldown source bar', () => {
    const target = createTarget();
    renderBudgetV2Flow(target, model(
        'group',
        [{ label: 'Accommodation', value: 1600, color: '#123abc', action: { type: 'category', groupId: 'bills', category: 'Accommodation' } }],
        { label: 'Bills', value: 1600, color: '#123abc' }
    ), {
        formatter: value => `£${value.toFixed(2)}`
    });

    assert.match(target.innerHTML, /<rect class="budget-v2-flow-node" x="220"[^>]+fill="#123abc"/);
});

test('v2 flow expands its canvas for large item lists', () => {
    const target = createTarget();
    const rows = Array.from({ length: 24 }, (_, index) => ({
        label: `Item ${index + 1}`,
        value: 100,
        color: '#123abc'
    }));
    renderBudgetV2Flow(target, model('item', rows, { label: 'Bills · General', value: 2400 }), {
        formatter: value => `£${value.toFixed(2)}`
    });

    const viewBox = target.innerHTML.match(/viewBox="0 0 920 ([\d.]+)"/);
    assert.ok(viewBox);
    const svgHeight = Number(viewBox[1]);
    assert.ok(svgHeight > 420);

    const targetRects = [...target.innerHTML.matchAll(/<rect class="budget-v2-flow-node" x="620" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)];
    assert.equal(targetRects.length, rows.length);
    assert.match(target.innerHTML, /class="budget-flow-svg budget-v2-flow-svg is-dense"/);
    const lastRect = targetRects.at(-1);
    assert.ok(Number(lastRect[1]) + Number(lastRect[2]) < svgHeight);
    assert.doesNotMatch(target.innerHTML, /y="-/);
});
