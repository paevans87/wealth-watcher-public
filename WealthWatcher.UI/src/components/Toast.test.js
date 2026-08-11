import assert from 'node:assert/strict';
import test from 'node:test';

const elements = new Map();
const timers = new Map();
let nextTimerId = 0;

function createElement(tagName = 'div') {
    const listeners = new Map();
    const attributes = new Map();
    const children = [];
    const element = {
        tagName: tagName.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        type: '',
        children,
        parentNode: null,
        appendChild(child) {
            children.push(child);
            child.parentNode = this;
            if (child.id) elements.set(child.id, child);
            return child;
        },
        removeChild(child) {
            const index = children.indexOf(child);
            if (index >= 0) children.splice(index, 1);
            child.parentNode = null;
            if (child.id) elements.delete(child.id);
            return child;
        },
        remove() {
            this.parentNode?.removeChild(this);
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        dispatch(type, event = { target: this }) {
            return listeners.get(type)?.(event);
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) ?? null;
        }
    };

    let innerHTML = '';
    Object.defineProperty(element, 'innerHTML', {
        get: () => innerHTML,
        set: value => {
            innerHTML = String(value);
            children.splice(0).forEach(child => { child.parentNode = null; });
        }
    });
    return element;
}

const body = createElement('body');
globalThis.document = {
    body,
    getElementById: id => elements.get(id) ?? null,
    createElement: tagName => createElement(tagName)
};

globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
};
globalThis.clearTimeout = id => timers.delete(id);

const { dismissAllToasts, showToast } = await import('./Toast.js');
const { requestNotification } = await import('./ConfirmationModal.js');

function reset() {
    dismissAllToasts();
    elements.get('toast-region')?.remove();
    elements.delete('toast-region');
    timers.clear();
}

function latestTimer() {
    const ids = Array.from(timers.keys());
    return timers.get(ids[ids.length - 1]);
}

test('success toasts render in an accessible bottom-center region and auto-dismiss', () => {
    reset();

    const toast = showToast({
        title: 'Asset saved',
        message: 'The asset was saved successfully.',
        type: 'success',
        duration: 1500
    });

    const region = elements.get('toast-region');
    assert.ok(toast);
    assert.equal(region.getAttribute('role'), 'status');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.equal(region.getAttribute('aria-atomic'), 'false');
    assert.equal(region.children.length, 1);
    assert.equal(region.children[0].getAttribute('role'), 'status');
    assert.match(region.children[0].className, /ww-toast--success/);
    assert.equal(region.children[0].children[0].children[0].textContent, 'Asset saved');
    assert.equal(region.children[0].children[0].children[1].textContent, 'The asset was saved successfully.');
    assert.equal(latestTimer().delay, 1500);

    latestTimer().callback();
    assert.equal(region.children.length, 0);
});

test('keyed toasts replace content without stale timers and unique toasts stack', () => {
    reset();

    const first = showToast({ message: 'Sync started.', key: 'sync', duration: 1000 });
    const staleTimer = latestTimer();
    const replacement = showToast({ message: 'Sync completed.', key: 'sync', duration: 2000 });
    showToast({ message: 'Another update completed.', type: 'success', duration: 3000 });

    const region = elements.get('toast-region');
    assert.equal(region.children.length, 2);
    assert.equal(replacement.id, first.id);
    assert.equal(region.children[0].children[0].children[0].textContent, 'Sync completed.');
    assert.equal(region.children[1].children[0].children[0].textContent, 'Another update completed.');

    staleTimer.callback();
    assert.equal(region.children.length, 2);

    latestTimer().callback();
    assert.equal(region.children.length, 1);
});

test('requestNotification reports CRUD failures as an assertive toast instead of opening the confirmation modal', async () => {
    reset();

    await requestNotification({
        title: 'Unable to archive asset',
        message: 'The API rejected the archive request.',
        duration: 2500,
        key: 'archive-failure'
    });

    const toast = elements.get('toast-region').children[0];
    assert.equal(toast.getAttribute('role'), 'alert');
    assert.match(toast.className, /ww-toast--error/);
    assert.equal(toast.children[0].children[0].textContent, 'Unable to archive asset');
    assert.equal(toast.children[0].children[1].textContent, 'The API rejected the archive request.');
});
