import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    location: { hostname: 'localhost', hash: '#settings' },
    addEventListener() {}
};

const originalDocument = globalThis.document;
globalThis.document = {};

const { getSettingsPanelTarget, revealSettingsPanel } = await import('./router.js');

test.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
});

test('settings route targets preserve the panel and optional subsection', () => {
    assert.deepEqual(getSettingsPanelTarget('#settings?panel=monthly-budget'), {
        panelId: 'monthly-budget',
        focusId: null
    });
    assert.deepEqual(getSettingsPanelTarget('#settings?panel=fire-settings&focus=fire-forecast-settings'), {
        panelId: 'fire-settings',
        focusId: 'fire-forecast-settings'
    });
    assert.equal(getSettingsPanelTarget('#settings'), null);
    assert.equal(getSettingsPanelTarget('#budget?panel=monthly-budget'), null);
});

test('settings route expands a closed pane and scrolls to its requested subsection', () => {
    const attributes = {};
    const pane = {
        dataset: { paneId: 'fire-settings' },
        classList: {
            classes: new Set(['collapsed']),
            contains(name) { return this.classes.has(name); },
            add(name) { this.classes.add(name); },
            remove(name) { this.classes.delete(name); }
        },
        querySelector(selector) {
            return selector === '.collapsible-header'
                ? { setAttribute(name, value) { attributes[name] = value; } }
                : null;
        }
    };
    const section = { scrollIntoView(options) { this.options = options; } };

    globalThis.document.getElementById = id => id === 'fire-forecast-settings' ? section : null;
    globalThis.document.querySelector = selector => selector === '[data-pane-id="fire-settings"]' ? pane : null;

    const result = revealSettingsPanel({ panelId: 'fire-settings', focusId: 'fire-forecast-settings' });

    assert.equal(result, pane);
    assert.equal(pane.classList.contains('collapsed'), false);
    assert.equal(attributes['aria-expanded'], 'true');
    assert.deepEqual(section.options, { block: 'start', behavior: 'smooth' });
});
