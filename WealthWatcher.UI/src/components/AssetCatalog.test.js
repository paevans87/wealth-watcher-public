import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost' };
globalThis.document = {
    getElementById() {
        return null;
    }
};

const { store } = await import('../store/store.js');
const {
    moveAssetToGroup,
    renderAssetKindManager,
    renderAssetKindOptions,
    renderBoard
} = await import('./AssetCatalog.js');

const assetGroups = [
    { Id: 'group-liquid', Key: 'liquid', DisplayName: 'Liquid', Color: '#10b981', DisplayOrder: 1 },
    { Id: 'group-illiquid', Key: 'illiquid', DisplayName: 'Illiquid', Color: '#f59e0b', DisplayOrder: 2 },
    { Id: 'group-empty', Key: 'empty', DisplayName: 'Empty', Color: '#64748b', DisplayOrder: 3 }
];

const assetKinds = [
    { Id: 'kind-property', Key: 'property', DisplayName: 'Property', Color: '#f59e0b', DisplayOrder: 4, ParentValueId: 'group-illiquid' },
    { Id: 'kind-investments', Key: 'investments', DisplayName: 'Investments', Color: '#10b981', DisplayOrder: 3, ParentValueId: 'group-liquid' },
    { Id: 'kind-unclassified', Key: 'unclassified', DisplayName: 'Unclassified', Color: '#64748b', DisplayOrder: 99 }
];

function setCatalogState() {
    store.state.classificationGroups = [
        { Key: 'asset-kind', Values: assetKinds },
        { Key: 'asset-group', Values: assetGroups }
    ];
}

test('asset catalogue derives lanes from AssetKind mappings and exposes drag semantics', () => {
    setCatalogState();
    const board = renderBoard(assetGroups, [
        {
            Id: 'asset-road',
            DisplayName: '49 Hillsley Road',
            AssetKindCode: 'property',
            AssetKindId: 'kind-property'
        },
        {
            Id: 'asset-invest',
            DisplayName: 'Trading 212 - Invest',
            AssetKindCode: 'investments',
            AssetKindId: 'kind-investments'
        }
    ]);

    const liquidLane = board.match(/aria-label="Liquid asset group">([\s\S]*?)<\/section>/)?.[1] || '';
    const illiquidLane = board.match(/aria-label="Illiquid asset group">([\s\S]*?)<\/section>/)?.[1] || '';

    assert.match(liquidLane, /Trading 212 - Invest/);
    assert.doesNotMatch(liquidLane, /49 Hillsley Road/);
    assert.match(illiquidLane, /49 Hillsley Road/);
    assert.doesNotMatch(illiquidLane, /Trading 212 - Invest/);
    assert.match(board, /data-drop-group-id="group-liquid"/);
    assert.match(board, /data-asset-id="asset-invest"[^>]*role="button"[^>]*draggable="true"/);
    assert.match(board, /data-move-asset="asset-invest"/);
    assert.match(board, /aria-label="Edit asset Trading 212 - Invest\. Drag to move it to another Group\."/);
});

test('drag status spans the catalogue board instead of reserving a lane column', async () => {
    const stylesheet = await readFile(new URL('../../style.css', import.meta.url), 'utf8');
    const statusRule = stylesheet.match(/\.catalog-drag-status\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(statusRule, /grid-column:\s*1\s*\/\s*-1/);
    assert.match(statusRule, /margin:\s*0/);
});

test('catalogue filters use the standard searchable input treatment', async () => {
    const markup = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const stylesheet = await readFile(new URL('../../style.css', import.meta.url), 'utf8');

    assert.match(markup, /id="catalog-asset-kind-filter"[^>]*role="combobox"/);
    assert.match(markup, /id="catalog-asset-group-filter"[^>]*role="combobox"/);
    assert.doesNotMatch(markup, /<select id="catalog-asset-(kind|group)-filter"/);
    assert.match(stylesheet, /\.catalog-search-field input,\s*\.catalog-filter-field input/);
    assert.match(stylesheet, /\.catalog-filter-options\s*\{/);
});

test('Unclassified remains visible as a system type but is absent from manual selectors and archive controls', () => {
    const manager = renderAssetKindManager(assetKinds, assetGroups);
    const options = renderAssetKindOptions(assetKinds);

    assert.match(manager, /Unclassified/);
    assert.match(manager, /data-system-kind="true"/);
    assert.match(manager, /System Type/);
    assert.doesNotMatch(manager, /Archive Type Unclassified/);
    assert.match(manager, /Archive Type Investments/);
    assert.doesNotMatch(options, /Unclassified/);
    assert.match(options, /Investments/);
});

test('Asset Type cards keep the name separate from wrapping metadata', async () => {
    const manager = renderAssetKindManager(assetKinds, assetGroups);
    const stylesheet = await readFile(new URL('../../style.css', import.meta.url), 'utf8');
    const editRule = stylesheet.match(/\.catalog-kind-edit\s*\{([^}]*)\}/)?.[1] || '';
    const metaRule = stylesheet.match(/\.catalog-kind-meta\s*\{([^}]*)\}/g)?.find(rule => rule.includes('flex-wrap')) || '';
    const rowHoverRule = stylesheet.match(/\.catalog-kind-row:hover,\s*\.catalog-kind-row:focus-within\s*\{([^}]*)\}/)?.[1] || '';
    const editHoverRule = stylesheet.match(/\.catalog-kind-edit:hover,\s*\.catalog-kind-edit:focus-visible\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(manager, /class="catalog-kind-primary"/);
    assert.match(manager, /class="catalog-kind-meta"/);
    assert.match(manager, /class="catalog-kind-group">Liquid<\/span>/);
    assert.doesNotMatch(manager, /Default:/);
    assert.match(editRule, /flex-direction:\s*column/);
    assert.match(metaRule, /flex-wrap:\s*wrap/);
    assert.match(stylesheet, /\.catalog-kind-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    assert.match(rowHoverRule, /background:\s*rgba\(103,\s*232,\s*249,\s*0\.06\)/);
    assert.match(editHoverRule, /background:\s*transparent/);
});

test('drag/drop move changes only the Asset Group', async () => {
    const originalAssets = store.state.assets;
    const originalFetch = globalThis.fetch;
    setCatalogState();
    store.state.assets = [{
        Id: 'asset-road',
        DisplayName: '49 Hillsley Road',
        AssetKindCode: 'property',
        AssetKindId: 'kind-property'
    }];

    let request;
    let refreshCount = 0;
    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true };
    };

    try {
        assert.equal(await moveAssetToGroup('asset-road', 'group-liquid', () => { refreshCount++; }), true);
        assert.equal(request.options.method, 'PATCH');
        assert.match(request.url, /\/assets\/asset-road$/);
        assert.deepEqual(JSON.parse(request.options.body), {
            AssetGroupId: 'group-liquid',
            SetAssetGroup: true
        });
        assert.equal(refreshCount, 1);
    } finally {
        store.state.assets = originalAssets;
        globalThis.fetch = originalFetch;
    }
});

test('drag/drop move does not depend on how many Types a destination group has', async () => {
    const originalAssets = store.state.assets;
    const originalFetch = globalThis.fetch;
    setCatalogState();
    assetKinds.push({
        Id: 'kind-savings',
        Key: 'savings',
        DisplayName: 'Savings',
        Color: '#3b82f6',
        DisplayOrder: 2,
        ParentValueId: 'group-liquid'
    });
    store.state.assets = [{ Id: 'asset-road', DisplayName: '49 Hillsley Road', AssetKindId: 'kind-property' }];

    let request;
    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true };
    };

    try {
        assert.equal(await moveAssetToGroup('asset-road', 'group-liquid', () => {}), true);
        assert.deepEqual(JSON.parse(request.options.body), {
            AssetGroupId: 'group-liquid',
            SetAssetGroup: true
        });
    } finally {
        assetKinds.pop();
        store.state.assets = originalAssets;
        globalThis.fetch = originalFetch;
    }
});

test('drag/drop reports API failures and invalid destinations', async () => {
    const originalAssets = store.state.assets;
    const originalFetch = globalThis.fetch;
    setCatalogState();
    store.state.assets = [{ Id: 'asset-road', DisplayName: '49 Hillsley Road', AssetKindId: 'kind-property' }];

    let requestCount = 0;
    let refreshCount = 0;
    globalThis.fetch = async () => {
        requestCount++;
        return { ok: false, text: async () => JSON.stringify({ Error: 'Move rejected.' }) };
    };

    try {
        assert.equal(await moveAssetToGroup('asset-road', 'group-liquid', () => { refreshCount++; }), false);
        assert.equal(requestCount, 1);
        assert.equal(refreshCount, 0);
        assert.equal(await moveAssetToGroup('asset-road', 'missing-group', () => { refreshCount++; }), false);
        assert.equal(requestCount, 1, 'no request is sent when the destination has no usable kind');
        assert.equal(refreshCount, 0);
    } finally {
        store.state.assets = originalAssets;
        globalThis.fetch = originalFetch;
    }
});
