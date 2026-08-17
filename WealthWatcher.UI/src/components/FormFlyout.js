import {
    closeManagedModal,
    isManagedModalOpen,
    openManagedModal
} from './ModalController.js';

const flyoutStates = new WeakMap();

function resolveFlyout(target) {
    if (!target) return null;
    if (typeof target === 'string') {
        return typeof document !== 'undefined' ? document.getElementById?.(target) || null : null;
    }
    return target;
}

function setBodyFlyoutState(isOpen) {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body?.classList) return;
    if (isOpen) {
        body.classList.add('form-flyout-open');
    } else if (!document.querySelector?.('[data-form-flyout].active')) {
        body.classList.remove('form-flyout-open');
    }
}

/**
 * Adds the shared close behaviour to a form flyout.
 *
 * Flyouts stay declarative in index.html: any backdrop, close button, or
 * cancel action can opt into the behaviour with data-flyout-close.
 */
export function initFormFlyout(target, options = {}) {
    const flyout = resolveFlyout(target);
    if (!flyout) return null;

    const currentState = flyoutStates.get(flyout) || {};
    const state = {
        ...currentState,
        ...(Object.prototype.hasOwnProperty.call(options, 'onClose')
            ? { onClose: options.onClose }
            : {})
    };

    if (state.listenerAttached !== true) {
        flyout.addEventListener?.('click', event => {
            if (!event.target?.closest?.('[data-flyout-close]')) return;
            event.preventDefault?.();
            closeFormFlyout(flyout);
        });
        state.listenerAttached = true;
    }

    flyoutStates.set(flyout, state);
    return flyout;
}

export function openFormFlyout(target, options = {}) {
    const flyout = initFormFlyout(target, options);
    if (!flyout) return null;

    const onEscape = typeof options.onEscape === 'function' ? options.onEscape : null;
    setBodyFlyoutState(true);
    return openManagedModal(flyout, {
        initialFocus: options.initialFocus || null,
        onEscape: event => {
            onEscape?.(event);
            if (isManagedModalOpen(flyout)) closeFormFlyout(flyout);
        }
    });
}

export function closeFormFlyout(target, { restoreFocus = true } = {}) {
    const flyout = resolveFlyout(target);
    if (!flyout) return false;

    const state = flyoutStates.get(flyout);
    const closed = closeManagedModal(flyout, { restoreFocus });
    if (!closed) return false;

    state?.onClose?.();
    setBodyFlyoutState(false);
    return true;
}

export function isFormFlyoutOpen(target) {
    return isManagedModalOpen(resolveFlyout(target));
}
