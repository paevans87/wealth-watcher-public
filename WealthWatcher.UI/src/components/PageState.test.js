import assert from 'node:assert/strict';
import test from 'node:test';
import { getPageStatus, PAGE_STATUS, renderPageError, setPageStatus } from './PageState.js';

function createElement() {
    const attributes = new Map();
    const listeners = new Map();
    const retry = {
        textContent: '',
        addEventListener(type, listener) {
            listeners.set(type, listener);
        }
    };
    return {
        dataset: {},
        innerHTML: '',
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) || null;
        },
        querySelector(selector) {
            return selector === '[data-page-retry]' ? retry : null;
        },
        listeners,
        retry
    };
}

test('page status uses the shared loading, ready, empty, and error vocabulary', () => {
    const view = createElement();

    assert.equal(setPageStatus(view, PAGE_STATUS.LOADING), 'loading');
    assert.equal(getPageStatus(view), 'loading');
    assert.equal(view.getAttribute('aria-busy'), 'true');

    setPageStatus(view, PAGE_STATUS.READY);
    assert.equal(getPageStatus(view), 'ready');
    assert.equal(view.getAttribute('aria-busy'), 'false');
    assert.equal(setPageStatus(view, 'unknown'), null);
});

test('page error helper escapes messages and binds an optional retry action', async () => {
    const target = createElement();
    let retried = false;

    renderPageError(target, {
        message: '<bad>&',
        onRetry: async () => { retried = true; }
    });

    assert.match(target.innerHTML, /&lt;bad&gt;&amp;/);
    assert.equal(target.retry.textContent, 'Try again');
    await target.listeners.get('click')();
    assert.equal(retried, true);
});
