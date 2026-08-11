function getElements(view, selector) {
    if (typeof view.querySelectorAll === 'function') {
        return Array.from(view.querySelectorAll(selector));
    }

    const element = view.querySelector?.(selector);
    return element ? [element] : [];
}

export function setPageLoading(viewId, loading) {
    if (typeof document === 'undefined') return;

    const view = document.getElementById(viewId);
    if (!view) return;

    view.setAttribute?.('aria-busy', String(loading));
    getElements(view, '[data-page-skeleton]').forEach(element => {
        element.hidden = !loading;
    });
    getElements(view, '[data-page-content]').forEach(element => {
        element.hidden = loading;
    });
}
