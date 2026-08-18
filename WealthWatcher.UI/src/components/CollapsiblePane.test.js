import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// In-memory localStorage mock
const localStorageStore = new Map();
globalThis.localStorage = {
    getItem(key) {
        return localStorageStore.has(key) ? localStorageStore.get(key) : null;
    },
    setItem(key, value) {
        localStorageStore.set(key, String(value));
    },
    removeItem(key) {
        localStorageStore.delete(key);
    },
    clear() {
        localStorageStore.clear();
    }
};

// DOM Mocking helper
function createMockElement(tagName = 'div', options = {}) {
    const children = [];
    const eventListeners = {};
    const dataset = options.dataset || {};
    const classes = new Set(options.className ? options.className.split(' ').filter(Boolean) : []);

    const element = {
        tagName: tagName.toUpperCase(),
        id: options.id || '',
        dataset,
        parentElement: null,
        children,
        attributes: {},
        get className() {
            return Array.from(classes).join(' ');
        },
        set className(val) {
            classes.clear();
            (val || '').split(' ').filter(Boolean).forEach(c => classes.add(c));
        },
        classList: {
            add(...cls) {
                cls.forEach(c => classes.add(c));
            },
            remove(...cls) {
                cls.forEach(c => classes.delete(c));
            },
            contains(cls) {
                return classes.has(cls);
            },
            toggle(cls) {
                if (classes.has(cls)) {
                    classes.delete(cls);
                    return false;
                }
                classes.add(cls);
                return true;
            }
        },
        setAttribute(name, val) {
            element.attributes[name] = String(val);
        },
        getAttribute(name) {
            return element.attributes[name] ?? null;
        },
        appendChild(child) {
            child.parentElement = element;
            children.push(child);
            return child;
        },
        prepend(child) {
            child.parentElement = element;
            children.unshift(child);
            return child;
        },
        addEventListener(event, fn) {
            if (!eventListeners[event]) eventListeners[event] = [];
            eventListeners[event].push(fn);
        },
        dispatchEvent(evt) {
            const eventObj = typeof evt === 'string' ? { type: evt, target: element } : evt;
            if (!eventObj.target) eventObj.target = element;
            if (!eventObj.closest) {
                eventObj.closest = (sel) => eventObj.target.closest(sel);
            }
            const handlers = eventListeners[eventObj.type] || [];
            for (const handler of handlers) {
                handler(eventObj);
            }
        },
        closest(selector) {
            const targetTypes = selector.split(',').map(s => s.trim().toLowerCase());
            let curr = element;
            while (curr) {
                const tag = curr.tagName ? curr.tagName.toLowerCase() : '';
                if (targetTypes.includes(tag)) {
                    return curr;
                }
                curr = curr.parentElement;
            }
            return null;
        },
        querySelector(selector) {
            return findSelector(element, selector);
        },
        querySelectorAll(selector) {
            return findAllSelector(element, selector);
        }
    };

    return element;
}

function matchesSelector(el, selector) {
    const parts = selector.split(',').map(s => s.trim());
    for (const part of parts) {
        if (part.startsWith('.')) {
            if (el.classList.contains(part.slice(1))) return true;
        } else if (part.startsWith('#')) {
            if (el.id === part.slice(1)) return true;
        } else if (part.startsWith('[') && part.endsWith(']')) {
            const attr = part.slice(1, -1);
            if (attr.includes('=')) {
                const [key, val] = attr.split('=').map(s => s.trim().replace(/^["']|["']$/g, ''));
                if (key === 'data-pane-id') return el.dataset?.paneId === val;
            } else if (attr === 'data-collapsible') {
                return el.dataset && ('collapsible' in el.dataset);
            }
        } else if (el.tagName && el.tagName.toLowerCase() === part.toLowerCase()) {
            return true;
        }
    }
    return false;
}

function findSelector(parent, selector) {
    const results = findAllSelector(parent, selector);
    return results.length > 0 ? results[0] : null;
}

function findAllSelector(parent, selector) {
    const list = [];
    function walk(node) {
        for (const child of node.children) {
            if (matchesSelector(child, selector)) {
                list.push(child);
            }
            walk(child);
        }
    }
    walk(parent);
    return list;
}

const registeredElements = new Map();

globalThis.window = globalThis;
globalThis.document = {
    getElementById(id) {
        return registeredElements.get(id) || null;
    },
    querySelector(selector) {
        if (selector.startsWith('#')) {
            return registeredElements.get(selector.slice(1)) || null;
        }
        if (selector.startsWith('[data-pane-id="') && selector.endsWith('"]')) {
            const paneId = selector.slice(15, -2);
            for (const el of registeredElements.values()) {
                if (el.dataset?.paneId === paneId) return el;
            }
        }
        for (const el of registeredElements.values()) {
            if (matchesSelector(el, selector)) return el;
            const childMatch = findSelector(el, selector);
            if (childMatch) return childMatch;
        }
        return null;
    },
    querySelectorAll(selector) {
        const matches = [];
        for (const el of registeredElements.values()) {
            if (matchesSelector(el, selector)) matches.push(el);
            matches.push(...findAllSelector(el, selector));
        }
        return matches;
    },
    createElement(tagName) {
        return createMockElement(tagName);
    }
};

const {
    STORAGE_PREFIX,
    getPaneState,
    setPaneState,
    togglePane,
    expandPane,
    initCollapsiblePane,
    initAllCollapsiblePanes,
    getPaneHelperConfig,
    ensurePaneHelper
} = await import('./CollapsiblePane.js');

test('CollapsiblePane Unit Tests', async (t) => {
    t.afterEach(() => {
        localStorageStore.clear();
        registeredElements.clear();
    });

    await t.test('localStorage persistence helpers (getPaneState / setPaneState)', () => {
        // Defaults to expanded (false) when not saved unless a pane-specific default is supplied
        assert.equal(getPaneState('general-settings'), false, 'Default pane state should be expanded (false)');
        assert.equal(getPaneState('application-version', true), true, 'Pane-specific default should be respected');
        assert.equal(getPaneState(null), false, 'Null paneId returns default false');
        assert.equal(getPaneState(''), false, 'Empty paneId returns default false');

        // Saves and retrieves collapsed state
        setPaneState('general-settings', true);
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}general-settings`), 'collapsed');
        assert.equal(getPaneState('general-settings'), true, 'Should read collapsed state as true');

        // Saves and retrieves expanded state
        setPaneState('general-settings', false);
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}general-settings`), 'expanded');
        assert.equal(getPaneState('general-settings'), false, 'Should read expanded state as false');

        // Unknown stored values are treated as expanded.
        localStorage.setItem(`${STORAGE_PREFIX}fire-tracker`, 'true');
        assert.equal(getPaneState('fire-tracker'), false, 'Should ignore unknown stored values');
    });

    await t.test('graceful fallback when localStorage throws errors', () => {
        const originalGetItem = localStorage.getItem;
        const originalSetItem = localStorage.setItem;

        localStorage.getItem = () => { throw new Error('QuotaExceeded / Restricted'); };
        localStorage.setItem = () => { throw new Error('QuotaExceeded / Restricted'); };

        assert.doesNotThrow(() => {
            const state = getPaneState('test-pane');
            assert.equal(state, false, 'Returns false on getPaneState error');
        });

        assert.doesNotThrow(() => {
            setPaneState('test-pane', true);
        });

        localStorage.getItem = originalGetItem;
        localStorage.setItem = originalSetItem;
    });

    await t.test('general settings uses the standard full-width settings pane structure', () => {
        const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

        assert.match(indexHtml, /<div class="card glass-panel collapsible-pane full-width-col" id="general-settings-pane"/);
        assert.match(indexHtml, /id="general-settings-pane"[\s\S]*?<div class="collapsible-header">[\s\S]*?<h4 class="section-title">General Settings<\/h4>/);
        assert.match(indexHtml, /id="general-settings-pane"[\s\S]*?<div class="collapsible-content">[\s\S]*?id="general-settings-form"/);
    });

    await t.test('Budget setup uses the persisted collapsible pane structure', () => {
        const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

        assert.match(indexHtml, /<section id="budget-settings-pane" class="card glass-panel full-width-col budget-configuration-panel collapsible-pane" data-budget-configuration data-collapsible data-pane-id="monthly-budget"/);
        assert.match(indexHtml, /id="budget-settings-pane"[\s\S]*?<div class="budget-configuration-header collapsible-header">[\s\S]*?Toggle Budget setup/);
        assert.match(indexHtml, /id="budget-settings-pane"[\s\S]*?<div class="collapsible-content">[\s\S]*?id="budget-groups-editor"/);
        assert.match(indexHtml, /id="budget-settings-pane"[\s\S]*?data-pane-id="monthly-budget"/);
        assert.doesNotMatch(indexHtml, /budget-editor-note/);
    });

    await t.test('renders configured helper copy once at the top of the pane content', () => {
        const paneEl = createMockElement('div', {
            id: 'general-settings-pane',
            dataset: {
                paneId: 'general-settings',
                paneHelperTitle: 'Shape your dashboard',
                paneHelperDescription: 'Choose what appears on the dashboard.',
                paneHelperIcon: '?'
            }
        });
        const headerEl = createMockElement('div', { className: 'collapsible-header' });
        const contentEl = createMockElement('div', { className: 'collapsible-content' });
        const formEl = createMockElement('form');
        contentEl.appendChild(formEl);
        paneEl.appendChild(headerEl);
        paneEl.appendChild(contentEl);

        assert.deepEqual(getPaneHelperConfig(paneEl), {
            title: 'Shape your dashboard',
            description: 'Choose what appears on the dashboard.',
            icon: '?'
        });

        const helper = ensurePaneHelper(paneEl);
        assert.ok(helper);
        assert.equal(contentEl.children[0], helper);
        assert.equal(helper.className, 'settings-pane-helper');
        assert.equal(helper.getAttribute('role'), 'note');
        assert.equal(helper.querySelector('strong').textContent, 'Shape your dashboard');
        assert.equal(helper.querySelector('span').textContent, 'Choose what appears on the dashboard.');
        assert.equal(helper.querySelector('.settings-pane-helper-icon').textContent, '?');
        assert.equal(ensurePaneHelper(paneEl), helper, 'Repeated initialisation should not duplicate the helper');
        assert.equal(contentEl.children.length, 2);
    });

    await t.test('togglePane updates class, aria-expanded attribute, and localStorage', () => {
        const paneEl = createMockElement('div', { id: 'fire-forecast-pane', dataset: { paneId: 'fire-forecast-pane' } });
        const headerEl = createMockElement('div', { className: 'collapsible-header' });
        paneEl.appendChild(headerEl);
        registeredElements.set('fire-forecast-pane', paneEl);

        // Initially expanded
        assert.equal(paneEl.classList.contains('collapsed'), false);

        // Toggle 1: Expanded -> Collapsed
        const isCollapsed1 = togglePane(paneEl);
        assert.equal(isCollapsed1, true, 'togglePane should return true when collapsing');
        assert.equal(paneEl.classList.contains('collapsed'), true, 'Element should have collapsed class');
        assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'aria-expanded should be set to false');
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}fire-forecast-pane`), 'collapsed');

        // Toggle 2: Collapsed -> Expanded
        const isCollapsed2 = togglePane(paneEl);
        assert.equal(isCollapsed2, false, 'togglePane should return false when expanding');
        assert.equal(paneEl.classList.contains('collapsed'), false, 'Element should not have collapsed class');
        assert.equal(headerEl.getAttribute('aria-expanded'), 'true', 'aria-expanded should be set to true');
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}fire-forecast-pane`), 'expanded');

        // Toggle by string ID lookup
        const isCollapsed3 = togglePane('fire-forecast-pane');
        assert.equal(isCollapsed3, true, 'togglePane by ID string should collapse element');
        assert.equal(paneEl.classList.contains('collapsed'), true);

        // Handles non-existent element string ID
        const resultMissing = togglePane('non-existent-id');
        assert.equal(resultMissing, false, 'togglePane returns false for missing element');
    });

    await t.test('expandPane reveals a collapsed pane without collapsing an open pane', () => {
        const paneEl = createMockElement('div', { id: 'budget-settings-pane', dataset: { paneId: 'monthly-budget' } });
        const headerEl = createMockElement('div', { className: 'collapsible-header' });
        paneEl.appendChild(headerEl);
        registeredElements.set('budget-settings-pane', paneEl);

        paneEl.classList.add('collapsed');
        assert.equal(expandPane('monthly-budget'), true);
        assert.equal(paneEl.classList.contains('collapsed'), false);
        assert.equal(headerEl.getAttribute('aria-expanded'), 'true');
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}monthly-budget`), 'expanded');

        assert.equal(expandPane(paneEl), true);
        assert.equal(paneEl.classList.contains('collapsed'), false);
        assert.equal(expandPane('missing-pane'), false);
    });

    await t.test('initCollapsiblePane restores saved state and binds header click listener', () => {
        // Pre-set pane to collapsed in localStorage
        setPaneState('monthly-budget-pane', true);

        const paneEl = createMockElement('div', { id: 'monthly-budget-pane', dataset: { paneId: 'monthly-budget-pane' } });
        const headerEl = createMockElement('div', { className: 'collapsible-header' });
        const titleEl = createMockElement('h4');
        const buttonEl = createMockElement('button');

        headerEl.appendChild(titleEl);
        headerEl.appendChild(buttonEl);
        paneEl.appendChild(headerEl);

        initCollapsiblePane(paneEl);

        // Verified state restored from localStorage
        assert.equal(paneEl.classList.contains('collapsed'), true, 'Should restore collapsed class on init');
        assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'aria-expanded restored to false');
        assert.equal(paneEl.dataset.collapsibleInit, 'true', 'dataset.collapsibleInit should be true');

        // Clicking header title (non-interactive element) toggles pane
        headerEl.dispatchEvent({ type: 'click', target: titleEl });
        assert.equal(paneEl.classList.contains('collapsed'), false, 'Clicking header content should toggle to expanded');
        assert.equal(localStorage.getItem(`${STORAGE_PREFIX}monthly-budget-pane`), 'expanded');

        // Clicking button inside header (interactive element) DOES NOT toggle pane
        headerEl.dispatchEvent({ type: 'click', target: buttonEl });
        assert.equal(paneEl.classList.contains('collapsed'), false, 'Clicking button in header should NOT toggle pane');

        // Re-initializing pane does not duplicate event listeners
        initCollapsiblePane(paneEl);
        headerEl.dispatchEvent({ type: 'click', target: titleEl });
        assert.equal(paneEl.classList.contains('collapsed'), true, 'Single click should toggle once back to collapsed');
    });

    await t.test('initCollapsiblePane uses the pane default only when no saved state exists', () => {
        const paneEl = createMockElement('div', {
            id: 'application-version-pane',
            dataset: { paneId: 'application-version', defaultCollapsed: 'true' }
        });
        const headerEl = createMockElement('div', { className: 'collapsible-header' });
        paneEl.appendChild(headerEl);

        initCollapsiblePane(paneEl);
        assert.equal(paneEl.classList.contains('collapsed'), true, 'Application version should be collapsed by default');
        assert.equal(headerEl.getAttribute('aria-expanded'), 'false');

        setPaneState('application-version', false);
        initCollapsiblePane(paneEl);
        assert.equal(paneEl.classList.contains('collapsed'), false, 'Saved expanded state should override the default');
        assert.equal(headerEl.getAttribute('aria-expanded'), 'true');
    });

    await t.test('initAllCollapsiblePanes initializes all matching panes in container or document', () => {
        const container = createMockElement('div', { id: 'settings-view' });

        const pane1 = createMockElement('div', { className: 'collapsible-pane', dataset: { paneId: 'pane-1' } });
        const header1 = createMockElement('div', { className: 'collapsible-header' });
        pane1.appendChild(header1);

        const pane2 = createMockElement('div', { dataset: { collapsible: '', paneId: 'pane-2' } });
        const header2 = createMockElement('div', { className: 'collapsible-header' });
        pane2.appendChild(header2);

        container.appendChild(pane1);
        container.appendChild(pane2);

        registeredElements.set('settings-view', container);

        // Pre-save state for pane-2
        setPaneState('pane-2', true);

        initAllCollapsiblePanes(container);

        assert.equal(pane1.dataset.collapsibleInit, 'true', 'pane-1 initialized');
        assert.equal(pane1.classList.contains('collapsed'), false, 'pane-1 expanded by default');
        assert.equal(pane2.dataset.collapsibleInit, 'true', 'pane-2 initialized');
        assert.equal(pane2.classList.contains('collapsed'), true, 'pane-2 restored collapsed state');
    });
});
