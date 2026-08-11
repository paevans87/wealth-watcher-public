const DEFAULT_DURATION = 4000;
const MAX_VISIBLE_TOASTS = 4;

let nextToastId = 0;
const activeToasts = new Map();
const keyedToasts = new Map();

function getDocument() {
    return typeof document === 'undefined' ? null : document;
}

function getToastRegion() {
    const doc = getDocument();
    if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.body.appendChild !== 'function') return null;

    let region = doc.getElementById?.('toast-region');
    if (region) return region;

    region = doc.createElement('div');
    region.id = 'toast-region';
    region.className = 'ww-toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    region.setAttribute('aria-label', 'Notifications');
    doc.body.appendChild(region);
    return region;
}

function normalizeOptions(input, overrides = {}) {
    if (typeof input === 'string') {
        return { message: input, ...overrides };
    }
    return { ...(input || {}), ...overrides };
}

function normalizeDuration(value) {
    const duration = Number(value);
    return Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_DURATION;
}

function clearToastTimer(record) {
    if (record.timer !== null) clearTimeout(record.timer);
    record.timer = null;
    record.timerToken = null;
}

function armToastTimer(record, duration) {
    clearToastTimer(record);
    const token = {};
    record.timerToken = token;
    record.timer = setTimeout(() => {
        // A callback from a replaced toast must not dismiss the new content.
        if (record.timerToken !== token || !activeToasts.has(record.id)) return;
        dismissToast(record.id);
    }, duration);
}

function appendTextElement(parent, tagName, className, text) {
    const doc = getDocument();
    const element = doc.createElement(tagName);
    element.className = className;
    element.textContent = String(text ?? '');
    parent.appendChild(element);
    return element;
}

function renderToast(record, options) {
    const doc = getDocument();
    if (!doc || !record.element) return;

    const type = String(options.type || 'info').toLowerCase();
    const isError = type === 'error' || type === 'danger';
    const title = String(options.title ?? '').trim();
    const message = String(options.message ?? '').trim();

    record.element.className = `ww-toast ww-toast--${type}`;
    record.element.setAttribute('role', isError ? 'alert' : 'status');
    record.element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    record.element.setAttribute('aria-atomic', 'true');
    record.element.innerHTML = '';

    const content = doc.createElement('div');
    content.className = 'ww-toast-content';
    if (title) appendTextElement(content, 'strong', 'ww-toast-title', title);
    appendTextElement(content, 'span', 'ww-toast-message', message);
    record.element.appendChild(content);

    const dismissButton = doc.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'ww-toast-dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss notification');
    dismissButton.textContent = '×';
    dismissButton.addEventListener('click', () => dismissToast(record.id));
    record.element.appendChild(dismissButton);
}

function createHandle(id) {
    return {
        id,
        dismiss: () => dismissToast(id)
    };
}

export function showToast(input, overrides = {}) {
    const options = normalizeOptions(input, overrides);
    const title = String(options.title ?? '').trim();
    const message = String(options.message ?? '').trim();
    if (!title && !message) return null;

    const duration = normalizeDuration(options.duration);
    const key = options.key ? String(options.key) : null;
    const existing = key ? keyedToasts.get(key) : null;

    if (existing) {
        renderToast(existing, options);
        armToastTimer(existing, duration);
        return createHandle(existing.id);
    }

    const region = getToastRegion();
    if (!region) return null;

    const record = {
        id: String(options.id || `toast-${++nextToastId}`),
        key,
        element: getDocument().createElement('div'),
        timer: null,
        timerToken: null
    };
    renderToast(record, options);
    region.appendChild(record.element);
    activeToasts.set(record.id, record);
    if (key) keyedToasts.set(key, record);
    armToastTimer(record, duration);

    while (activeToasts.size > MAX_VISIBLE_TOASTS) {
        const oldestId = activeToasts.keys().next().value;
        if (!oldestId) break;
        dismissToast(oldestId);
    }

    return createHandle(record.id);
}

export function dismissToast(id) {
    const record = activeToasts.get(String(id));
    if (!record) return false;

    clearToastTimer(record);
    activeToasts.delete(record.id);
    if (record.key && keyedToasts.get(record.key) === record) keyedToasts.delete(record.key);
    record.element?.remove?.();
    if (record.element?.parentNode && typeof record.element.parentNode.removeChild === 'function') {
        record.element.parentNode.removeChild(record.element);
    }
    return true;
}

export function dismissAllToasts() {
    Array.from(activeToasts.keys()).forEach(dismissToast);
}

export const TOAST_DEFAULT_DURATION = DEFAULT_DURATION;
