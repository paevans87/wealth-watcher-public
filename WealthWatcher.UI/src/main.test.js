import assert from 'node:assert/strict';
import test from 'node:test';

function createElement(tagName = 'div') {
    const listeners = new Map();
    const element = {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        dataset: {},
        children: [],
        innerHTML: '',
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        addEventListener(name, callback) {
            listeners.set(name, callback);
        }
    };
    return element;
}

const categorySelect = createElement('select');
const originalCategories = [
    { Id: 'cash', Label: 'Cash' },
    { Id: 'unclassified', Label: 'Unclassified' },
    { Id: 'investments', Label: 'Investments' }
];

globalThis.window = globalThis;
globalThis.window.location = { hostname: 'localhost', hash: '' };
globalThis.document = {
    getElementById(id) {
        return id === 'entry-category' ? categorySelect : null;
    },
    createElement,
    querySelectorAll() {
        return [];
    },
    addEventListener() {}
};

const { getInteractiveCategoryOptions, populateCategoryOptions } = await import('./main.js');

test('manual category options exclude Unclassified without mutating read-only categories', () => {
    const interactiveCategories = getInteractiveCategoryOptions(originalCategories);

    assert.deepEqual(interactiveCategories.map(category => category.Id), ['cash', 'investments']);
    assert.deepEqual(originalCategories.map(category => category.Id), ['cash', 'unclassified', 'investments']);

    populateCategoryOptions(originalCategories);

    assert.deepEqual(categorySelect.children.map(option => option.textContent), ['Select Asset...', 'Cash', 'Investments']);
    assert.doesNotMatch(categorySelect.children.map(option => option.textContent).join(' '), /Unclassified/);
});
