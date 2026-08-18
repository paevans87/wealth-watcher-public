import assert from 'node:assert/strict';
import test from 'node:test';

import { store } from '../store/store.js';
import { renderAssetTypeahead, setupAssetTypeahead } from './AssetTypeahead.js';

function createTypeaheadFixture() {
    const rootListeners = new Map();
    const optionListeners = new Map();
    const body = {
        appendChild(node) {
            node.parentNode = this;
        }
    };
    const options = {
        hidden: true,
        innerHTML: '',
        parentNode: null,
        nextSibling: null,
        style: {
            removeProperty() {}
        },
        classList: {
            add() {},
            remove() {}
        },
        addEventListener(type, listener) {
            optionListeners.set(type, listener);
        },
        dispatch(type, event) {
            optionListeners.get(type)?.(event);
        },
        contains(node) {
            return node?.parentElement === this;
        }
    };
    const value = { value: '' };
    const picker = {
        dataset: {
            assetTypeaheadKey: 'debug',
            assetTypeaheadEmptyLabel: 'Create a new asset…'
        },
        classList: { toggle() {} },
        querySelector(selector) {
            if (selector === '[data-asset-typeahead-value]') return value;
            if (selector === '[data-asset-typeahead-search]') return search;
            if (selector === '[data-asset-typeahead-options]') return options;
            return null;
        },
        contains(node) {
            return node === value || node === search;
        }
    };
    const search = {
        dataset: { assetTypeaheadSearch: 'debug' },
        value: '',
        closest(selector) {
            if (selector === '[data-asset-typeahead-search]') return this;
            if (selector === '[data-asset-typeahead]') return picker;
            return null;
        },
        getAttribute() {
            return null;
        },
        setAttribute() {},
        select() {},
        getBoundingClientRect() {
            return { left: 0, right: 240, top: 0, bottom: 32, width: 240 };
        }
    };
    const root = {
        dataset: {},
        appendChild(node) {
            node.parentNode = this;
        },
        insertBefore(node) {
            node.parentNode = this;
        },
        contains() {
            return true;
        },
        addEventListener(type, listener) {
            rootListeners.set(type, listener);
        },
        dispatch(type, event) {
            rootListeners.get(type)?.(event);
        },
        querySelector(selector) {
            return selector === '[data-asset-typeahead]' ? picker : null;
        }
    };
    options.parentNode = root;
    const documentMock = {
        body,
        addEventListener() {},
        getElementById() {
            return null;
        }
    };

    return { documentMock, options, picker, root, search, value };
}

test('portaled existing asset options keep their selection handler', () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousAssets = store.state.assets;
    const fixture = createTypeaheadFixture();
    const selected = [];
    store.state.assets = [{ Id: 'asset-aj', DisplayName: 'AJ Bell - SIPP' }];
    globalThis.document = fixture.documentMock;
    globalThis.window = {
        innerWidth: 800,
        innerHeight: 600,
        addEventListener() {}
    };

    try {
        fixture.root.innerHTML = renderAssetTypeahead({
            id: 'debug',
            ariaLabel: 'Search existing assets'
        });
        setupAssetTypeahead(fixture.root, {
            onChoose(_picker, assetId) {
                selected.push(assetId);
            }
        });
        fixture.root.dispatch('click', { target: fixture.search });

        const choice = {
            dataset: { assetTypeaheadChoice: 'asset-aj' },
            parentElement: fixture.options,
            closest(selector) {
                if (selector === '[data-asset-typeahead-choice]') return this;
                if (selector === '[data-asset-typeahead-options]') return fixture.options;
                return null;
            }
        };
        fixture.options.dispatch('click', { target: choice });

        assert.deepEqual(selected, ['asset-aj']);
        assert.equal(fixture.value.value, 'asset-aj');
        assert.equal(fixture.search.value, 'AJ Bell - SIPP');
        assert.equal(fixture.options.hidden, true);
        assert.equal(fixture.options.parentNode, fixture.root);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        store.state.assets = previousAssets;
    }
});

test('portaled options select before a blurred search input can close them', async () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousAssets = store.state.assets;
    const fixture = createTypeaheadFixture();
    const selected = [];
    let prevented = false;
    store.state.assets = [{ Id: 'asset-aj', DisplayName: 'AJ Bell - SIPP' }];
    globalThis.document = fixture.documentMock;
    globalThis.window = {
        innerWidth: 800,
        innerHeight: 600,
        addEventListener() {}
    };

    try {
        fixture.root.innerHTML = renderAssetTypeahead({
            id: 'debug-blur',
            ariaLabel: 'Search existing assets'
        });
        setupAssetTypeahead(fixture.root, {
            onChoose(_picker, assetId) {
                selected.push(assetId);
            }
        });
        fixture.root.dispatch('click', { target: fixture.search });

        const choice = {
            dataset: { assetTypeaheadChoice: 'asset-aj' },
            parentElement: fixture.options,
            closest(selector) {
                if (selector === '[data-asset-typeahead-choice]') return this;
                if (selector === '[data-asset-typeahead-options]') return fixture.options;
                return null;
            }
        };
        fixture.root.dispatch('focusout', { target: fixture.search, relatedTarget: null });
        fixture.options.dispatch('pointerdown', {
            target: choice,
            preventDefault() {
                prevented = true;
            }
        });
        fixture.options.dispatch('click', { target: choice });
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepEqual(selected, ['asset-aj']);
        assert.equal(prevented, true);
        assert.equal(fixture.options.hidden, true);
        assert.equal(fixture.options.parentNode, fixture.root);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        store.state.assets = previousAssets;
    }
});
