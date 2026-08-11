import { isFeatureEnabled, setFeatureEnabled } from '../utils/featureFlags.js';
import { renderFeatureToggle } from './FormFields.js';

const FIRE_SUBFEATURES = Object.freeze([
    Object.freeze({
        featureKey: 'tracker',
        toggleId: 'fire-setting-tracker-enabled',
        sectionId: 'fire-tracker-settings'
    }),
    Object.freeze({
        featureKey: 'forecast',
        toggleId: 'fire-setting-forecast-enabled',
        sectionId: 'fire-forecast-settings'
    })
]);

function renderFireFeatureToggles() {
    const toggles = [
        ['fire-setting-enabled-toggle', 'fire-setting-enabled', 'Enabled'],
        ['fire-setting-tracker-toggle', 'fire-setting-tracker-enabled', 'Enabled'],
        ['fire-setting-forecast-toggle', 'fire-setting-forecast-enabled', 'Enabled']
    ];

    toggles.forEach(([targetId, inputId, label]) => {
        const target = document.getElementById(targetId);
        if (!target || target.dataset.rendered === 'true') return;
        target.innerHTML = renderFeatureToggle({ id: inputId, label });
        target.dataset.rendered = 'true';
    });
}

export function updateFireSettingsVisibility() {
    const fireEnabled = isFeatureEnabled('fire');
    const description = document.getElementById('fire-disabled-description');
    const content = document.getElementById('fire-settings-content');

    if (description) description.hidden = fireEnabled;
    if (content) content.hidden = !fireEnabled;

    FIRE_SUBFEATURES.forEach(({ featureKey, toggleId, sectionId }) => {
        const toggle = document.getElementById(toggleId);
        if (toggle) {
            toggle.checked = isFeatureEnabled(featureKey);
            toggle.disabled = !fireEnabled;
        }

        const section = document.getElementById(sectionId);
        if (section) section.hidden = !isFeatureEnabled(featureKey);
    });
}

export function populateFireFeatureSettings() {
    renderFireFeatureToggles();
    const fireToggle = document.getElementById('fire-setting-enabled');
    if (fireToggle) fireToggle.checked = isFeatureEnabled('fire');

    FIRE_SUBFEATURES.forEach(({ featureKey, toggleId }) => {
        const toggle = document.getElementById(toggleId);
        if (toggle) toggle.checked = isFeatureEnabled(featureKey);
    });

    updateFireSettingsVisibility();
}

export function setupFireFeatureSettings() {
    renderFireFeatureToggles();
    const fireToggle = document.getElementById('fire-setting-enabled');
    if (fireToggle && fireToggle.dataset.fireToggleInit !== 'true') {
        fireToggle.dataset.fireToggleInit = 'true';
        fireToggle.addEventListener('change', async event => {
            await setFeatureEnabled('fire', event.target.checked);
            populateFireFeatureSettings();
        });
    }

    FIRE_SUBFEATURES.forEach(({ featureKey, toggleId }) => {
        const toggle = document.getElementById(toggleId);
        if (!toggle || toggle.dataset.fireSubfeatureToggleInit === 'true') return;

        toggle.dataset.fireSubfeatureToggleInit = 'true';
        toggle.addEventListener('change', async event => {
            await setFeatureEnabled(featureKey, event.target.checked);
            populateFireFeatureSettings();
        });
    });

    populateFireFeatureSettings();
}
