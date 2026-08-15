import { escapeHtml } from '../utils/html.js';

export const PAGE_STATUS = Object.freeze({
    LOADING: 'loading',
    READY: 'ready',
    EMPTY: 'empty',
    ERROR: 'error'
});

export function setPageStatus(viewOrId, status) {
    const view = typeof viewOrId === 'string'
        ? (typeof document !== 'undefined' ? document.getElementById(viewOrId) : null)
        : viewOrId;
    if (!view || !Object.values(PAGE_STATUS).includes(status)) return null;

    if (!view.dataset) view.dataset = {};
    view.dataset.pageStatus = status;
    view.setAttribute?.('aria-busy', String(status === PAGE_STATUS.LOADING));
    return status;
}

export function getPageStatus(viewOrId) {
    const view = typeof viewOrId === 'string'
        ? (typeof document !== 'undefined' ? document.getElementById(viewOrId) : null)
        : viewOrId;
    return view?.dataset?.pageStatus || null;
}

export function renderPageError(target, {
    message = 'Unable to load this view.',
    retryLabel = 'Try again',
    onRetry = null
} = {}) {
    if (!target) return null;
    target.innerHTML = `
        <div class="page-state-error" role="alert">
            <strong>Something went wrong</strong>
            <span>${escapeHtml(message)}</span>
            ${onRetry ? '<button type="button" class="action-btn page-state-retry" data-page-retry></button>' : ''}
        </div>`;
    const retry = target.querySelector?.('[data-page-retry]');
    if (retry) {
        retry.textContent = retryLabel;
        retry.addEventListener?.('click', () => void onRetry());
    }
    return target;
}
