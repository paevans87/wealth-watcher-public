/**
 * Shared modal behaviour for the application.
 *
 * Keeping focus management here means every modal gets the same keyboard
 * contract: focus moves into the dialog, Tab stays inside it, Escape closes
 * it, and focus returns to the control that opened it.
 */

const modalStates = new WeakMap();
const activeModals = [];
let controllerInitialised = false;

function getDocument() {
    return typeof document !== 'undefined' ? document : null;
}

function resolveModal(target) {
    if (!target) return null;
    if (typeof target === 'string') return getDocument()?.getElementById?.(target) || null;
    return target;
}

function getDialog(modal) {
    return modal?.querySelector?.('[role="dialog"]')
        || modal?.firstElementChild
        || modal;
}

function getFocusableElements(modal) {
    const dialog = getDialog(modal);
    if (!dialog?.querySelectorAll) return [];

    return Array.from(dialog.querySelectorAll(
        'a[href], area[href], button, input, select, textarea, [contenteditable="true"], [tabindex]'
    )).filter(element => {
        if (!element || element.disabled || element.hidden) return false;
        if (element.getAttribute?.('aria-hidden') === 'true') return false;
        const tabIndex = element.getAttribute?.('tabindex');
        return tabIndex === null || tabIndex === undefined || Number(tabIndex) >= 0;
    });
}

function focusElement(element) {
    element?.focus?.();
}

function removeActiveModal(modal) {
    const index = activeModals.lastIndexOf(modal);
    if (index >= 0) activeModals.splice(index, 1);
}

function getTopActiveModal() {
    for (let index = activeModals.length - 1; index >= 0; index -= 1) {
        const modal = activeModals[index];
        if (modal?.classList?.contains?.('active')) return modal;
    }
    return null;
}

function handleKeydown(event) {
    const modal = getTopActiveModal();
    if (!modal) return;

    const state = modalStates.get(modal) || {};
    if (event.key === 'Escape') {
        event.preventDefault?.();
        if (typeof state.onEscape === 'function') {
            state.onEscape(event);
        } else {
            closeManagedModal(modal);
        }
        return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(modal);
    if (focusable.length === 0) {
        event.preventDefault?.();
        focusElement(getDialog(modal));
        return;
    }

    const activeElement = getDocument()?.activeElement;
    const currentIndex = focusable.indexOf(activeElement);
    const movingBackwards = event.shiftKey === true;
    const nextIndex = currentIndex < 0
        ? (movingBackwards ? focusable.length - 1 : 0)
        : (currentIndex + (movingBackwards ? -1 : 1) + focusable.length) % focusable.length;

    if (currentIndex < 0 || nextIndex === 0 || nextIndex === focusable.length - 1) {
        if ((movingBackwards && (currentIndex <= 0 || currentIndex < 0))
            || (!movingBackwards && (currentIndex === focusable.length - 1 || currentIndex < 0))) {
            event.preventDefault?.();
            focusElement(focusable[nextIndex]);
        }
    }
}

export function setupModalController() {
    const doc = getDocument();
    if (!doc?.addEventListener || controllerInitialised) return;
    doc.addEventListener('keydown', handleKeydown);
    controllerInitialised = true;
}

export function openManagedModal(target, { initialFocus = null, onEscape = null } = {}) {
    const modal = resolveModal(target);
    if (!modal) return null;

    setupModalController();
    const doc = getDocument();
    const currentFocus = doc?.activeElement;
    const previousState = modalStates.get(modal);
    const previousFocus = previousState?.previousFocus
        || (currentFocus && !modal.contains?.(currentFocus) ? currentFocus : null);

    modalStates.set(modal, { previousFocus, onEscape });
    if (!activeModals.includes(modal)) activeModals.push(modal);
    modal.classList?.add?.('active');
    modal.hidden = false;
    modal.setAttribute?.('aria-hidden', 'false');

    const dialog = getDialog(modal);
    if (dialog && dialog !== modal && !dialog.getAttribute?.('tabindex')) {
        dialog.setAttribute?.('tabindex', '-1');
    }

    const requestedFocus = typeof initialFocus === 'string'
        ? dialog?.querySelector?.(initialFocus)
        : initialFocus;
    const focusable = getFocusableElements(modal);
    focusElement(requestedFocus || focusable[0] || dialog);
    return modal;
}

export function closeManagedModal(target, { restoreFocus = true } = {}) {
    const modal = resolveModal(target);
    if (!modal) return false;

    const state = modalStates.get(modal);
    modal.classList?.remove?.('active');
    modal.hidden = true;
    modal.setAttribute?.('aria-hidden', 'true');
    removeActiveModal(modal);
    modalStates.delete(modal);

    if (restoreFocus) {
        const focusTarget = state?.previousFocus;
        if (focusTarget && !focusTarget.hidden && !focusTarget.disabled) focusElement(focusTarget);
    }
    return true;
}

export function isManagedModalOpen(target) {
    const modal = resolveModal(target);
    return Boolean(modal?.classList?.contains?.('active'));
}

export { getFocusableElements };
