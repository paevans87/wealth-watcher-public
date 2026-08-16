import { store } from '../store/store.js';
import { saveDbSettings } from '../api/apiClient.js';
import { showToast } from '../components/Toast.js';

export const FEATURE_SETTINGS_KEY = 'wealthWatcherFeatureSettings';

// Feature definitions keep navigation and route behavior reusable as more
// optional features are added.
export const FEATURE_DEFINITIONS = Object.freeze({
    fire: Object.freeze({
        defaultEnabled: true
    }),
    tracker: Object.freeze({
        navId: 'nav-fire',
        route: '#fire',
        parent: 'fire',
        defaultEnabled: true
    }),
    forecast: Object.freeze({
        navId: 'nav-forecast',
        route: '#forecast',
        parent: 'fire',
        defaultEnabled: true
    }),
    budget: Object.freeze({
        navId: 'nav-budget',
        route: '#budget',
        defaultEnabled: true
    }),
    milestones: Object.freeze({
        defaultEnabled: false
    })
});

export function normalizeFeatureSettings(settings = {}) {
    const source = settings && typeof settings === 'object' && !Array.isArray(settings)
        ? settings
        : {};
    const normalized = { ...source };

    Object.entries(FEATURE_DEFINITIONS).forEach(([featureKey, definition]) => {
        if (typeof normalized[featureKey] !== 'boolean') {
            normalized[featureKey] = definition.defaultEnabled;
        }
    });

    return normalized;
}

export function isFeatureEnabled(featureKey, visited = new Set()) {
    const definition = FEATURE_DEFINITIONS[featureKey];
    if (!definition) return false;
    if (visited.has(featureKey)) return false;
    visited.add(featureKey);

    const value = store.state.featureSettings?.[featureKey];
    const enabled = typeof value === 'boolean' ? value : definition.defaultEnabled;
    if (!enabled || !definition.parent) return enabled;

    return isFeatureEnabled(definition.parent, visited);
}

export function getFeatureKeyForRoute(route) {
    return Object.entries(FEATURE_DEFINITIONS)
        .find(([, definition]) => definition.route === route)?.[0] ?? null;
}

export function applyFeatureVisibility() {
    Object.entries(FEATURE_DEFINITIONS).forEach(([featureKey, definition]) => {
        if (!definition.navId) return;
        const nav = document.getElementById(definition.navId);
        if (nav) {
            nav.hidden = !isFeatureEnabled(featureKey);
        }
    });
}

export async function setFeatureEnabled(featureKey, enabled) {
    if (!FEATURE_DEFINITIONS[featureKey]) return false;

    const featureLabel = featureKey.charAt(0).toUpperCase() + featureKey.slice(1);

    const previousSettings = normalizeFeatureSettings(store.state.featureSettings);
    const nextSettings = {
        ...previousSettings,
        [featureKey]: enabled === true
    };

    store.state.featureSettings = nextSettings;
    applyFeatureVisibility();

    if (await saveDbSettings(FEATURE_SETTINGS_KEY, nextSettings)) {
        showToast({
            title: `${featureLabel} ${nextSettings[featureKey] ? 'enabled' : 'disabled'}`,
            message: `${featureLabel} settings were saved successfully.`,
            type: 'success',
            key: 'feature-settings'
        });
        return true;
    }

    // Keep the UI and runtime cache consistent if persistence fails.
    store.state.featureSettings = previousSettings;
    applyFeatureVisibility();
    showToast({
        title: `Unable to update ${featureLabel}`,
        message: `${featureLabel} settings could not be saved.`,
        type: 'error',
        key: 'feature-settings'
    });
    return false;
}
