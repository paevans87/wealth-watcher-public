import assert from 'node:assert/strict';
import test from 'node:test';

function createElement() {
    const listeners = new Map();
    const classes = new Set();
    return {
        attributes: {},
        classList: {
            add(...names) {
                names.forEach(name => classes.add(name));
            },
            remove(...names) {
                names.forEach(name => classes.delete(name));
            },
            contains(name) {
                return classes.has(name);
            }
        },
        dataset: {},
        focused: false,
        textContent: '',
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        dispatch(type, event = { target: this }) {
            listeners.get(type)?.(event);
        },
        focus() {
            this.focused = true;
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
    };
}

test('confirmation requests use the app modal and resolve through app controls', async () => {
    const originalDocument = globalThis.document;
    const elements = new Map([
        ['confirmation-modal', createElement()],
        ['confirmation-modal-title', createElement()],
        ['confirmation-modal-message', createElement()],
        ['confirmation-modal-confirm', createElement()],
        ['confirmation-modal-cancel', createElement()],
        ['confirmation-modal-close', createElement()]
    ]);
    const documentListeners = new Map();

    globalThis.document = {
        addEventListener(type, handler) {
            documentListeners.set(type, handler);
        },
        getElementById(id) {
            return elements.get(id) ?? null;
        }
    };

    try {
        const { requestConfirmation } = await import('./ConfirmationModal.js');
        const modal = elements.get('confirmation-modal');
        const confirmButton = elements.get('confirmation-modal-confirm');

        const confirmed = requestConfirmation({
            title: 'Archive group?',
            message: 'Existing history will be retained.',
            confirmLabel: 'Archive group'
        });

        assert.equal(modal.classList.contains('active'), true);
        assert.equal(elements.get('confirmation-modal-title').textContent, 'Archive group?');
        assert.equal(elements.get('confirmation-modal-message').textContent, 'Existing history will be retained.');
        assert.equal(confirmButton.textContent, 'Archive group');
        assert.equal(confirmButton.focused, true);

        confirmButton.dispatch('click');
        assert.equal(await confirmed, true);
        assert.equal(modal.classList.contains('active'), false);

        const cancelled = requestConfirmation({ message: 'Cancel this action?' });
        elements.get('confirmation-modal-cancel').dispatch('click');
        assert.equal(await cancelled, false);

        const closedByEscape = requestConfirmation({ message: 'Close this action?' });
        documentListeners.get('keydown')({ key: 'Escape' });
        assert.equal(await closedByEscape, false);

        const { requestNotification } = await import('./ConfirmationModal.js');
        const notification = requestNotification({
            title: 'Unable to save',
            message: 'The request could not be completed.',
            buttonLabel: 'Dismiss'
        });
        await notification;
        assert.equal(modal.classList.contains('active'), false);
    } finally {
        globalThis.document = originalDocument;
    }
});
