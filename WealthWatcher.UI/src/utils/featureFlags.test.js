import test from 'node:test';
import assert from 'node:assert/strict';

const elements = new Map();
function element(id) {
    if (!elements.has(id)) {
        elements.set(id, { hidden: false });
    }
    return elements.get(id);
}

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };
globalThis.document = {
    getElementById: id => elements.get(id) ?? null
};

let requests = [];
let saveSucceeds = true;
globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: saveSucceeds };
};

const { store } = await import('../store/store.js');
const {
    FEATURE_SETTINGS_KEY,
    applyFeatureVisibility,
    getFeatureKeyForRoute,
    isFeatureEnabled,
    normalizeFeatureSettings,
    setFeatureEnabled
} = await import('./featureFlags.js');

function reset() {
    elements.clear();
    element('nav-budget');
    element('nav-fire');
    element('nav-forecast');
    requests = [];
    saveSucceeds = true;
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: true, milestones: false };
}

test('missing feature flags use their configured defaults', () => {
    assert.deepEqual(normalizeFeatureSettings({}), {
        fire: true,
        tracker: true,
        forecast: true,
        budget: true,
        milestones: false
    });
    store.state.featureSettings = {};
    assert.equal(isFeatureEnabled('budget'), true);
    assert.equal(isFeatureEnabled('fire'), true);
    assert.equal(isFeatureEnabled('tracker'), true);
    assert.equal(isFeatureEnabled('forecast'), true);
});

test('feature routes resolve through the shared registry', () => {
    assert.equal(getFeatureKeyForRoute('#budget'), 'budget');
    assert.equal(getFeatureKeyForRoute('#fire'), 'tracker');
    assert.equal(getFeatureKeyForRoute('#forecast'), 'forecast');
    assert.equal(getFeatureKeyForRoute('#dashboard'), null);
});

test('dependent features are disabled when FIRE is disabled', () => {
    reset();
    store.state.featureSettings.fire = false;

    assert.equal(isFeatureEnabled('fire'), false);
    assert.equal(isFeatureEnabled('tracker'), false);
    assert.equal(isFeatureEnabled('forecast'), false);
});

test('feature visibility reflects the enabled state', () => {
    reset();
    applyFeatureVisibility();
    assert.equal(element('nav-budget').hidden, false);
    assert.equal(element('nav-fire').hidden, false);
    assert.equal(element('nav-forecast').hidden, false);

    store.state.featureSettings.budget = false;
    store.state.featureSettings.forecast = false;
    applyFeatureVisibility();
    // Budget remains discoverable so its in-page enable action is reachable.
    assert.equal(element('nav-budget').hidden, false);
    assert.equal(element('nav-forecast').hidden, true);

    store.state.featureSettings.forecast = true;
    store.state.featureSettings.fire = false;
    applyFeatureVisibility();
    assert.equal(element('nav-fire').hidden, true);
    assert.equal(element('nav-forecast').hidden, true);
});

test('feature changes update the cache, nav, and database setting', async () => {
    reset();

    assert.equal(await setFeatureEnabled('budget', false), true);
    assert.deepEqual(store.state.featureSettings, {
        fire: true,
        tracker: true,
        forecast: true,
        budget: false,
        milestones: false
    });
    assert.equal(element('nav-budget').hidden, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://localhost:5000/api/settings');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        [FEATURE_SETTINGS_KEY]: '{"fire":true,"tracker":true,"forecast":true,"budget":false,"milestones":false}'
    });
});

test('failed feature persistence restores the previous cache and nav state', async () => {
    reset();
    saveSucceeds = false;

    assert.equal(await setFeatureEnabled('budget', false), false);
    assert.deepEqual(store.state.featureSettings, {
        fire: true,
        tracker: true,
        forecast: true,
        budget: true,
        milestones: false
    });
    assert.equal(element('nav-budget').hidden, false);
});

test('budget navigation remains available while its persisted flag is off', async () => {
    reset();

    assert.equal(await setFeatureEnabled('budget', false), true);
    assert.equal(store.state.featureSettings.budget, false);
    assert.equal(element('nav-budget').hidden, false);

    store.state.featureSettings.budget = true;
    applyFeatureVisibility();
    assert.equal(element('nav-budget').hidden, false);
});
