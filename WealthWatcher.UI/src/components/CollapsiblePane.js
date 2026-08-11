/**
 * CollapsiblePane component module
 * Manages collapsible state, localStorage persistence, and DOM interactions.
 */

export const STORAGE_PREFIX = 'wealthwatcher_pane_';

/**
 * Reads the optional helper copy configured on a settings pane.
 * @param {HTMLElement} paneEl
 * @returns {{title: string, description: string, icon: string}|null}
 */
export function getPaneHelperConfig(paneEl) {
    const title = paneEl?.dataset?.paneHelperTitle?.trim() || '';
    const description = paneEl?.dataset?.paneHelperDescription?.trim() || '';

    if (!title || !description) return null;

    return {
        title,
        description,
        icon: paneEl.dataset.paneHelperIcon?.trim() || '✦'
    };
}

/**
 * Adds the shared helper banner to a configured settings pane.
 * @param {HTMLElement} paneEl
 * @returns {HTMLElement|null} The existing or newly created helper element.
 */
export function ensurePaneHelper(paneEl) {
    const config = getPaneHelperConfig(paneEl);
    const content = paneEl?.querySelector?.('.collapsible-content');

    if (!config || !content) return null;

    const existing = content.querySelector('.settings-pane-helper');
    if (existing) return existing;

    const helper = document.createElement('div');
    helper.className = 'settings-pane-helper';
    helper.setAttribute('role', 'note');

    const copy = document.createElement('div');
    copy.className = 'settings-pane-helper-copy';

    const title = document.createElement('strong');
    title.textContent = config.title;
    copy.appendChild(title);

    const description = document.createElement('span');
    description.textContent = config.description;
    copy.appendChild(description);

    const icon = document.createElement('span');
    icon.className = 'settings-pane-helper-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = config.icon;

    helper.appendChild(copy);
    helper.appendChild(icon);

    if (typeof content.prepend === 'function') {
        content.prepend(helper);
    } else {
        content.appendChild(helper);
    }

    return helper;
}

/**
 * Reads saved collapse state for a given pane ID from localStorage.
 * @param {string} paneId
 * @returns {boolean} True if collapsed, false if expanded (default)
 */
export function getPaneState(paneId) {
    if (!paneId) return false;
    try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}${paneId}`);
        return stored === 'collapsed';
    } catch (e) {
        // Fallback if localStorage is restricted or unavailable
        return false;
    }
}

/**
 * Saves collapse state for a given pane ID to localStorage.
 * @param {string} paneId
 * @param {boolean} isCollapsed
 */
export function setPaneState(paneId, isCollapsed) {
    if (!paneId) return;
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${paneId}`, isCollapsed ? 'collapsed' : 'expanded');
    } catch (e) {
        // Safe fallback for restricted localStorage environments
    }
}

/**
 * Toggles the collapse state of a pane element or pane by ID.
 * @param {HTMLElement|string} pane Target HTMLElement or string pane ID
 * @returns {boolean} Updated isCollapsed state
 */
export function togglePane(pane) {
    const paneEl = typeof pane === 'string'
        ? (document.getElementById(pane) || document.querySelector(`[data-pane-id="${pane}"]`))
        : pane;

    if (!paneEl) return false;

    const paneId = paneEl.dataset?.paneId || paneEl.id;
    const isCollapsed = paneEl.classList.contains('collapsed');
    const newCollapsedState = !isCollapsed;

    if (newCollapsedState) {
        paneEl.classList.add('collapsed');
    } else {
        paneEl.classList.remove('collapsed');
    }

    // Update aria-expanded on header if present
    const header = paneEl.querySelector('.collapsible-header');
    if (header) {
        header.setAttribute('aria-expanded', String(!newCollapsedState));
    }

    if (paneId) {
        setPaneState(paneId, newCollapsedState);
    }

    return newCollapsedState;
}

/**
 * Ensures a collapsible pane is expanded without changing an already-open pane.
 * @param {HTMLElement|string} pane Target HTMLElement or pane ID
 * @returns {boolean} True when the pane exists and is expanded
 */
export function expandPane(pane) {
    const paneEl = typeof pane === 'string'
        ? (document.getElementById(pane) || document.querySelector(`[data-pane-id="${pane}"]`))
        : pane;

    if (!paneEl) return false;
    if (paneEl.classList.contains('collapsed')) {
        togglePane(paneEl);
    }
    return true;
}

/**
 * Initializes a single collapsible pane element, restoring state and binding event handlers.
 * @param {HTMLElement} paneEl
 */
export function initCollapsiblePane(paneEl) {
    if (!paneEl) return;

    ensurePaneHelper(paneEl);

    const paneId = paneEl.dataset?.paneId || paneEl.id;
    if (paneId) {
        const isCollapsed = getPaneState(paneId);
        if (isCollapsed) {
            paneEl.classList.add('collapsed');
        } else {
            paneEl.classList.remove('collapsed');
        }

        const header = paneEl.querySelector('.collapsible-header');
        if (header) {
            header.setAttribute('aria-expanded', String(!isCollapsed));
        }
    }

    // Prevent duplicate listener registration
    if (paneEl.dataset?.collapsibleInit === 'true') {
        return;
    }
    paneEl.dataset.collapsibleInit = 'true';

    const header = paneEl.querySelector('.collapsible-header');
    if (header) {
        header.addEventListener('click', (e) => {
            // Prevent toggle if clicking interactive controls inside header
            if (e.target.closest('button, input, select, a, label')) {
                return;
            }
            togglePane(paneEl);
        });
    }
}

/**
 * Initializes all collapsible panes found within a container (or full document).
 * @param {HTMLElement|string} [container=document]
 */
export function initAllCollapsiblePanes(container = document) {
    const parent = typeof container === 'string' ? document.querySelector(container) : document;
    if (!parent) return;

    const panes = parent.querySelectorAll('.collapsible-pane, [data-collapsible]');
    panes.forEach(pane => initCollapsiblePane(pane));
}
