import test from 'node:test';
import assert from 'node:assert/strict';

function createElement(id = '') {
    const listeners = {};
    return {
        id,
        checked: false,
        disabled: false,
        hidden: false,
        dataset: {},
        addEventListener(name, callback) {
            listeners[name] = callback;
        },
        async dispatch(name, event = {}) {
            return listeners[name]?.({ target: this, preventDefault() {}, ...event });
        }
    };
}

const elements = new Map();
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
    populateFireFeatureSettings,
    setupFireFeatureSettings
} = await import('./FireSettings.js');

function reset() {
    elements.clear();
    [
        'fire-setting-enabled',
        'fire-setting-tracker-enabled',
        'fire-setting-forecast-enabled',
        'fire-disabled-description',
        'fire-settings-content',
        'fire-tracker-settings',
        'fire-forecast-settings',
        'nav-fire',
        'nav-forecast'
    ].forEach(id => elements.set(id, createElement(id)));
    requests = [];
    saveSucceeds = true;
    store.state.featureSettings = { fire: true, tracker: true, forecast: true, budget: true };
}

test('FIRE settings populate parent and dependent toggles and sections', () => {
    reset();
    store.state.featureSettings.tracker = false;

    populateFireFeatureSettings();

    assert.equal(elements.get('fire-setting-enabled').checked, true);
    assert.equal(elements.get('fire-setting-tracker-enabled').checked, false);
    assert.equal(elements.get('fire-setting-tracker-enabled').disabled, false);
    assert.equal(elements.get('fire-setting-forecast-enabled').checked, true);
    assert.equal(elements.get('fire-disabled-description').hidden, true);
    assert.equal(elements.get('fire-settings-content').hidden, false);
    assert.equal(elements.get('fire-tracker-settings').hidden, true);
    assert.equal(elements.get('fire-forecast-settings').hidden, false);
});

test('disabling FIRE hides dependent navigation and settings', async () => {
    reset();
    setupFireFeatureSettings();

    const toggle = elements.get('fire-setting-enabled');
    toggle.checked = false;
    await toggle.dispatch('change');

    assert.equal(store.state.featureSettings.fire, false);
    assert.equal(elements.get('nav-fire').hidden, true);
    assert.equal(elements.get('nav-forecast').hidden, true);
    assert.equal(elements.get('fire-disabled-description').hidden, false);
    assert.equal(elements.get('fire-settings-content').hidden, true);
    assert.equal(elements.get('fire-setting-tracker-enabled').disabled, true);
    assert.equal(elements.get('fire-setting-forecast-enabled').disabled, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        wealthWatcherFeatureSettings: '{"fire":false,"tracker":true,"forecast":true,"budget":true}'
    });
});

test('dependent toggles independently control their views', async () => {
    reset();
    setupFireFeatureSettings();

    const toggle = elements.get('fire-setting-forecast-enabled');
    toggle.checked = false;
    await toggle.dispatch('change');

    assert.equal(store.state.featureSettings.fire, true);
    assert.equal(store.state.featureSettings.forecast, false);
    assert.equal(elements.get('nav-fire').hidden, false);
    assert.equal(elements.get('nav-forecast').hidden, true);
    assert.equal(elements.get('fire-tracker-settings').hidden, false);
    assert.equal(elements.get('fire-forecast-settings').hidden, true);
});

test('failed FIRE persistence restores the previous state', async () => {
    reset();
    saveSucceeds = false;
    setupFireFeatureSettings();

    const toggle = elements.get('fire-setting-enabled');
    toggle.checked = false;
    await toggle.dispatch('change');

    assert.equal(store.state.featureSettings.fire, true);
    assert.equal(toggle.checked, true);
    assert.equal(elements.get('nav-fire').hidden, false);
    assert.equal(elements.get('nav-forecast').hidden, false);
    assert.equal(elements.get('fire-settings-content').hidden, false);
});
