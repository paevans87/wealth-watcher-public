import assert from 'node:assert/strict';
import test from 'node:test';

function createElement() {
    return {
        addEventListener() {},
        classList: { add() {}, remove() {} },
        style: {},
        value: '',
        innerText: '',
        textContent: '',
        readOnly: false
    };
}

test('property actions add a new snapshot and use the app confirmation modal', async () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const elements = new Map([
        ['entry-modal-title', createElement()],
        ['entry-submit-btn', createElement()],
        ['entry-category', createElement()],
        ['entry-name', createElement()],
        ['entry-value', createElement()],
        ['entry-mortgage', createElement()],
        ['entry-date', createElement()],
        ['mortgage-group', createElement()],
        ['property-delete-modal', createElement()],
        ['property-delete-name', createElement()],
        ['property-delete-confirm', createElement()],
        ['property-delete-cancel', createElement()],
        ['property-delete-close', createElement()]
    ]);
    const openedModals = [];

    globalThis.document = {
        addEventListener() {},
        getElementById(id) {
            return elements.get(id) ?? null;
        }
    };
    globalThis.window = {
        closeModal(id) {
            openedModals.push(`closed:${id}`);
        },
        currentCategoryNames: [],
        openModal(id) {
            openedModals.push(id);
        }
    };

    try {
        const { getPropertyFormState, openPropertyEntry, setupPropertyPanel } = await import('./Properties.js');
        setupPropertyPanel();
        openPropertyEntry({ Id: 'home-id', Name: 'Home', Value: 250000, Mortgage: 90000 });

        assert.equal(getPropertyFormState().mode, 'entry');
        assert.equal(elements.get('entry-modal-title').innerText, 'Add Property Entry');
        assert.equal(elements.get('entry-submit-btn').innerText, 'Add Entry');
        assert.equal(elements.get('entry-name').readOnly, true);
        assert.deepEqual(openedModals, ['entry-modal']);

        globalThis.window.removeProperty('home-id', 'Home');
        assert.equal(elements.get('property-delete-name').textContent, 'Home');
        assert.deepEqual(openedModals, ['entry-modal', 'property-delete-modal']);
        assert.equal(typeof globalThis.window.confirm, 'undefined');
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
    }
});
