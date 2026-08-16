import { showToast } from './Toast.js';
import {
    closeManagedModal,
    openManagedModal,
    setupModalController
} from './ModalController.js';

let confirmationResolver = null;
let isInitialized = false;

export function setupConfirmationModal() {
    if (isInitialized) return;

    const modal = document.getElementById('confirmation-modal');
    if (!modal) return;

    isInitialized = true;
    setupModalController();
    document.getElementById('confirmation-modal-confirm')?.addEventListener('click', () => resolveActiveModal(true));
    document.getElementById('confirmation-modal-cancel')?.addEventListener('click', () => resolveActiveModal(false));
    document.getElementById('confirmation-modal-close')?.addEventListener('click', () => resolveActiveModal(false));
    modal.addEventListener('click', event => {
        if (event.target === modal) resolveActiveModal(false);
    });
}

export function requestConfirmation({
    title = 'Confirm action',
    message = 'Are you sure?',
    confirmLabel = 'Confirm'
} = {}) {
    setupConfirmationModal();

    const modal = document.getElementById('confirmation-modal');
    if (!modal) {
        console.error('Confirmation dialog is not available.');
        return Promise.resolve(false);
    }

    if (confirmationResolver) resolveConfirmation(false);

    const titleElement = document.getElementById('confirmation-modal-title');
    const messageElement = document.getElementById('confirmation-modal-message');
    const confirmButton = document.getElementById('confirmation-modal-confirm');
    const cancelButton = document.getElementById('confirmation-modal-cancel');
    if (titleElement) titleElement.textContent = title;
    if (messageElement) messageElement.textContent = message;
    if (confirmButton) confirmButton.textContent = confirmLabel;
    if (cancelButton) cancelButton.hidden = false;
    confirmButton?.classList.remove('action-btn');
    confirmButton?.classList.add('danger-btn');

    return new Promise(resolve => {
        confirmationResolver = resolve;
        openManagedModal(modal, {
            initialFocus: confirmButton,
            onEscape: () => resolveActiveModal(false)
        });
    });
}

export function requestNotification({
    title = 'Notice',
    message = '',
    type = 'error',
    key = 'request-notification'
} = {}) {
    showToast({ title, message, type, key });
    return Promise.resolve();
}

function resolveActiveModal(result) {
    resolveConfirmation(result);
}

function resolveConfirmation(result) {
    const resolve = confirmationResolver;
    confirmationResolver = null;
    closeManagedModal('confirmation-modal');
    resolve?.(result);
}
