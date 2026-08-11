import test from 'node:test';
import assert from 'node:assert/strict';
import { setPageLoading } from './PageLoading.js';

function createElement({ skeletons = [], contents = [] } = {}) {
    const attributes = new Map();
    const element = {
        hidden: true,
        querySelectorAll(selector) {
            if (selector === '[data-page-skeleton]') return skeletons;
            if (selector === '[data-page-content]') return contents;
            return [];
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) || null;
        }
    };
    return element;
}

const skeleton = createElement();
skeleton.hidden = true;
const content = createElement();
content.hidden = false;
const view = createElement({ skeletons: [skeleton], contents: [content] });
const calendarView = createElement();
globalThis.document = {
    getElementById(id) {
        if (id === 'dashboard-view') return view;
        if (id === 'calendar-view') return calendarView;
        return null;
    }
};

test('page skeleton becomes visible while page content is hidden', () => {
    setPageLoading('dashboard-view', true);

    assert.equal(skeleton.hidden, false);
    assert.equal(content.hidden, true);
    assert.equal(view.getAttribute('aria-busy'), 'true');
});

test('page skeleton hides and content returns when loading completes', () => {
    setPageLoading('dashboard-view', false);

    assert.equal(skeleton.hidden, true);
    assert.equal(content.hidden, false);
    assert.equal(view.getAttribute('aria-busy'), 'false');
});

test('page busy state works when a page owns its status surface', () => {
    setPageLoading('calendar-view', true);
    assert.equal(calendarView.getAttribute('aria-busy'), 'true');

    setPageLoading('calendar-view', false);
    assert.equal(calendarView.getAttribute('aria-busy'), 'false');
});
