import assert from 'node:assert/strict';
import test from 'node:test';

const card = {
    hidden: true,
    innerHTML: '',
    dataset: {}
};

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost', hash: '#dashboard' };
globalThis.document = {
    getElementById(id) {
        return id === 'milestones-dashboard-card' ? card : null;
    }
};

const { store } = await import('../store/store.js');
const {
    calculateMilestoneProgress,
    clearMilestoneDashboardCard,
    normalizeMilestoneSettings,
    renderMilestoneDashboardCard,
    validateMilestoneTargets
} = await import('./Milestones.js');

test.beforeEach(() => {
    card.hidden = true;
    card.innerHTML = '';
    card.dataset = {};
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: true, milestones: false };
    store.state.milestoneSettings = { targets: [] };
});

test('milestone progress selects the next strict target and measures from the previous one', () => {
    assert.deepEqual(calculateMilestoneProgress(0, [500000, 600000]), {
        state: 'progress',
        targets: [500000, 600000],
        currentWealth: 0,
        previousTarget: 0,
        nextTarget: 500000,
        progress: 0,
        remaining: 500000
    });

    const exact = calculateMilestoneProgress(500000, [500000, 600000]);
    assert.equal(exact.previousTarget, 500000);
    assert.equal(exact.nextTarget, 600000);
    assert.equal(exact.progress, 0);

    const example = calculateMilestoneProgress(550000, [600000, 500000]);
    assert.equal(example.previousTarget, 500000);
    assert.equal(example.nextTarget, 600000);
    assert.equal(example.progress, 50);
    assert.equal(example.remaining, 50000);

    assert.equal(calculateMilestoneProgress(600000, [500000, 600000]).state, 'complete');
});

test('milestone settings normalize safely and reject invalid writes', () => {
    assert.deepEqual(normalizeMilestoneSettings({ targets: [600000, 500000, 500000, -1, 'invalid'] }), {
        targets: [500000, 600000]
    });
    assert.equal(validateMilestoneTargets([]).valid, true);
    assert.match(validateMilestoneTargets([500000, 500000]).error, /unique/);
    assert.match(validateMilestoneTargets([0]).error, /greater than/);
    assert.match(validateMilestoneTargets([1.001]).error, /two decimal/);
    assert.match(validateMilestoneTargets(['']).error, /valid/);
});

test('dashboard card stays hidden when disabled and renders the configured interval when enabled', () => {
    store.state.milestoneSettings = { targets: [500000, 600000] };
    renderMilestoneDashboardCard(550000);
    assert.equal(card.hidden, true);

    store.state.featureSettings.milestones = true;
    renderMilestoneDashboardCard(550000);
    assert.equal(card.hidden, false);
    assert.equal(card.dataset.milestoneState, 'progress');
    assert.match(card.innerHTML, /50%/);
    assert.match(card.innerHTML, /aria-valuenow="50"/);
    assert.match(card.innerHTML, /£50,000\.00/);
    assert.doesNotMatch(card.innerHTML, /milestones-card-anchors/);
    assert.doesNotMatch(card.innerHTML, /achieved/);

    store.state.milestoneSettings = { targets: [] };
    renderMilestoneDashboardCard(550000);
    assert.equal(card.dataset.milestoneState, 'unconfigured');
    assert.match(card.innerHTML, /#settings\?panel=milestones/);

    clearMilestoneDashboardCard();
    assert.equal(card.hidden, true);
    assert.equal(card.innerHTML, '');
});
