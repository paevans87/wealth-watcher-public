import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
const installListeners = new Map();
const installButton = {
    hidden: true,
    disabled: false,
    addEventListener(name, callback) {
        installListeners.set(name, callback);
    }
};

globalThis.window = globalThis;
Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: false });
globalThis.document = {
    getElementById: id => id === 'install-app-btn' ? installButton : null
};
globalThis.window.location = { hostname: 'localhost' };
globalThis.window.matchMedia = () => ({ matches: false });
globalThis.window.addEventListener = (name, callback) => listeners.set(name, callback);

const { setupPwa } = await import('./pwa.js');

test('PWA install prompt is deferred until the user clicks the install button', async () => {
    setupPwa();

    let promptCalls = 0;
    let prevented = false;
    const installEvent = {
        preventDefault() {
            prevented = true;
        },
        prompt() {
            promptCalls++;
        },
        userChoice: Promise.resolve({ outcome: 'dismissed' })
    };

    listeners.get('beforeinstallprompt')(installEvent);
    assert.equal(prevented, true);
    assert.equal(promptCalls, 0);
    assert.equal(installButton.hidden, false);

    await installListeners.get('click')();
    assert.equal(promptCalls, 1);
    assert.equal(installButton.hidden, true);
});
