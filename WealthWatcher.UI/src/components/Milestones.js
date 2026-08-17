import { saveDbSettings } from '../api/apiClient.js';
import { showToast } from './Toast.js';
import { renderFeatureToggle } from './FormFields.js';
import { formatter } from '../utils/formatters.js';
import { escapeHtml } from '../utils/html.js';
import { store } from '../store/store.js';
import { isFeatureEnabled, setFeatureEnabled } from '../utils/featureFlags.js';

export const MILESTONE_SETTINGS_KEY = 'wealthWatcherMilestoneSettings';
export const MAX_MILESTONE_TARGETS = 50;
export const DEFAULT_MILESTONE_SETTINGS = Object.freeze({ targets: [] });

let dashboardWealth = null;

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function roundCurrency(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasAtMostTwoDecimals(value) {
    return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function readTargetNumber(value) {
    const normalized = typeof value === 'string'
        ? value.replace(/[£,\s]/g, '')
        : value;
    if (typeof normalized === 'string' && normalized.trim() === '') return NaN;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : NaN;
}

/**
 * Returns a safe, sorted client representation of persisted milestone data.
 * Invalid persisted entries are ignored so a malformed legacy document cannot
 * stop the rest of the dashboard from loading.
 */
export function normalizeMilestoneSettings(settings = DEFAULT_MILESTONE_SETTINGS) {
    const source = isPlainObject(settings) ? settings : DEFAULT_MILESTONE_SETTINGS;
    const targets = Array.isArray(source.targets)
        ? source.targets
            .map(readTargetNumber)
            .filter(target => Number.isFinite(target) && target > 0 && hasAtMostTwoDecimals(target))
            .map(roundCurrency)
            .sort((left, right) => left - right)
        : [];

    return {
        targets: [...new Set(targets)].slice(0, MAX_MILESTONE_TARGETS)
    };
}

export function validateMilestoneTargets(rawTargets) {
    if (!Array.isArray(rawTargets)) {
        return { valid: false, error: 'Milestone targets must be a list of amounts.' };
    }

    if (rawTargets.length > MAX_MILESTONE_TARGETS) {
        return { valid: false, error: `You can configure up to ${MAX_MILESTONE_TARGETS} milestones.` };
    }

    const targets = [];
    for (const rawTarget of rawTargets) {
        const target = readTargetNumber(rawTarget);
        if (!Number.isFinite(target)) {
            return { valid: false, error: 'Enter a valid milestone amount.' };
        }
        if (target <= 0) {
            return { valid: false, error: 'Milestone amounts must be greater than £0.' };
        }
        if (!hasAtMostTwoDecimals(target)) {
            return { valid: false, error: 'Milestone amounts can have no more than two decimal places.' };
        }
        targets.push(roundCurrency(target));
    }

    targets.sort((left, right) => left - right);
    for (let index = 1; index < targets.length; index += 1) {
        if (targets[index] === targets[index - 1]) {
            return { valid: false, error: 'Milestone amounts must be unique.' };
        }
    }

    return { valid: true, targets };
}

/**
 * Selects the first target strictly above current wealth and measures progress
 * from the previous achieved target (or £0 for the first target).
 */
export function calculateMilestoneProgress(currentWealth, rawTargets) {
    const targets = normalizeMilestoneSettings({ targets: rawTargets }).targets;
    const current = Number(currentWealth);

    if (!Number.isFinite(current)) {
        return { state: 'unavailable', targets };
    }
    if (targets.length === 0) {
        return { state: 'unconfigured', targets };
    }

    const nextIndex = targets.findIndex(target => target > current);
    if (nextIndex === -1) {
        return {
            state: 'complete',
            targets,
            currentWealth: current,
            previousTarget: targets.at(-1),
            nextTarget: null,
            progress: null,
            remaining: 0
        };
    }

    const previousTarget = nextIndex === 0 ? 0 : targets[nextIndex - 1];
    const nextTarget = targets[nextIndex];
    const span = nextTarget - previousTarget;
    const progress = Math.min(100, Math.max(0, ((current - previousTarget) / span) * 100));

    return {
        state: 'progress',
        targets,
        currentWealth: current,
        previousTarget,
        nextTarget,
        progress: Number(progress.toFixed(1)),
        remaining: Math.max(0, nextTarget - current)
    };
}

export function formatMilestoneTarget(value) {
    const number = Number(value);
    return formatter.format(Number.isFinite(number) ? number : 0);
}

function formatAmount(value) {
    return formatMilestoneTarget(value);
}

function settingsLink(label, focus = 'milestone-new-target') {
    return `<a class="action-btn milestones-inline-link" href="#settings?panel=milestones&focus=${focus}" aria-controls="milestones-settings-pane">${label}</a>`;
}

function renderUnconfiguredCard(card) {
    if (card.dataset) card.dataset.milestoneState = 'unconfigured';
    card.innerHTML = `
        <div class="milestones-card-copy">
            <span class="milestones-card-kicker">Milestones</span>
            <h4>Set your next wealth checkpoint</h4>
            <p>Choose one or more targets to keep the dashboard focused on your next step.</p>
            ${settingsLink('Set up milestones')}
        </div>`;
}

function renderCompleteCard(card, progress) {
    if (card.dataset) card.dataset.milestoneState = 'complete';
    card.innerHTML = `
        <div class="milestones-card-copy">
            <span class="milestones-card-kicker milestones-card-kicker-complete">Milestones</span>
            <h4>Milestone sequence complete</h4>
            <p>You reached every configured milestone at <span class="obfuscate-val">${escapeHtml(formatAmount(progress.currentWealth))}</span>.</p>
            ${settingsLink('Add the next milestone')}
        </div>`;
}

function renderProgressCard(card, progress) {
    const percentage = progress.progress.toFixed(progress.progress % 1 === 0 ? 0 : 1);
    const accessibleLabel = `Progress from ${formatAmount(progress.previousTarget)} to ${formatAmount(progress.nextTarget)}`;
    if (card.dataset) card.dataset.milestoneState = 'progress';
    card.innerHTML = `
        <div class="milestones-card-header">
            <div>
                <span class="milestones-card-kicker">Milestones</span>
                <h4>Next milestone <span class="obfuscate-val">${escapeHtml(formatAmount(progress.nextTarget))}</span></h4>
            </div>
            <strong class="milestones-card-percentage">${percentage}%</strong>
        </div>
        <div class="milestones-card-metrics">
            <span>Current <strong class="obfuscate-val">${escapeHtml(formatAmount(progress.currentWealth))}</strong></span>
            <span><strong class="obfuscate-val">${escapeHtml(formatAmount(progress.remaining))}</strong> to go</span>
        </div>
        <div class="milestones-progress-track" role="progressbar" aria-label="${escapeHtml(accessibleLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.progress}">
            <span class="milestones-progress-fill" style="width: ${progress.progress}%"></span>
        </div>`;
}

/**
 * Renders the dashboard card using the same total shown in #global-total.
 */
export function renderMilestoneDashboardCard(currentWealth) {
    const card = document.getElementById('milestones-dashboard-card');
    if (!card) return;

    dashboardWealth = Number(currentWealth);
    if (!isFeatureEnabled('milestones')) {
        card.hidden = true;
        card.innerHTML = '';
        if (card.dataset) delete card.dataset.milestoneState;
        return;
    }

    const progress = calculateMilestoneProgress(dashboardWealth, store.state.milestoneSettings?.targets);
    if (progress.state === 'unavailable') {
        card.hidden = true;
        card.innerHTML = '';
        if (card.dataset) delete card.dataset.milestoneState;
        return;
    }

    card.hidden = false;
    if (progress.state === 'unconfigured') renderUnconfiguredCard(card);
    else if (progress.state === 'complete') renderCompleteCard(card, progress);
    else renderProgressCard(card, progress);
}

export function clearMilestoneDashboardCard() {
    dashboardWealth = null;
    const card = document.getElementById('milestones-dashboard-card');
    if (!card) return;
    card.hidden = true;
    card.innerHTML = '';
    if (card.dataset) delete card.dataset.milestoneState;
}

function refreshMilestoneDashboardCard() {
    if (dashboardWealth !== null) renderMilestoneDashboardCard(dashboardWealth);
}

function renderMilestoneSettingsToggle() {
    const target = document.getElementById('milestones-setting-enabled-toggle');
    if (!target || target.dataset.rendered === 'true') return;
    target.innerHTML = renderFeatureToggle({ id: 'milestones-setting-enabled', label: 'Enabled' });
    target.dataset.rendered = 'true';
}

function renderMilestoneTargetList() {
    const target = document.getElementById('milestone-target-list');
    if (!target) return;

    const targets = normalizeMilestoneSettings(store.state.milestoneSettings).targets;
    target.innerHTML = targets.length > 0
        ? targets.map((value, index) => `
            <div class="milestone-target-row">
                <label class="milestone-target-field" for="milestone-target-${index}">
                    <span class="sr-only">Milestone ${index + 1} amount</span>
                    <input id="milestone-target-${index}" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(formatMilestoneTarget(value))}" data-milestone-target="${index}" aria-describedby="milestone-settings-error">
                </label>
                <span class="milestone-target-status">${index === targets.length - 1 ? 'Next after current target' : 'Configured target'}</span>
                <button type="button" class="action-btn milestone-remove-button" data-milestone-remove="${index}" aria-label="Remove milestone ${formatAmount(value)}">Remove</button>
            </div>`).join('')
        : '<p class="milestone-empty-copy">No milestones configured yet. Add your first target below.</p>';
}

function setMilestoneSettingsMessage(message = '', type = '') {
    const status = document.getElementById('milestone-settings-error');
    if (!status) return;
    status.textContent = message;
    status.className = `milestone-settings-message${type ? ` ${type}` : ''}`;
    status.hidden = !message;
}

function readMilestoneInputs() {
    return Array.from(document.querySelectorAll('[data-milestone-target]'))
        .map(input => input.value);
}

function isMilestoneAmountInput(input) {
    return input?.matches?.('[data-milestone-target], #milestone-new-target') === true;
}

function formatMilestoneInput(input) {
    const value = readTargetNumber(input.value);
    if (Number.isFinite(value) && value >= 0) input.value = formatMilestoneTarget(value);
}

function unformatMilestoneInput(input) {
    input.value = input.value.replace(/[£,\s]/g, '');
}

function sanitizeMilestoneInput(input) {
    if (input.value.includes('-')) {
        input.value = '';
        return;
    }
    input.value = input.value.replace(/[^\d.,]/g, '');
}

async function persistMilestoneTargets(rawTargets, successMessage) {
    const validation = validateMilestoneTargets(rawTargets);
    if (!validation.valid) {
        setMilestoneSettingsMessage(validation.error, 'error');
        return false;
    }

    const previous = normalizeMilestoneSettings(store.state.milestoneSettings);
    const next = { targets: validation.targets };
    store.state.milestoneSettings = next;
    renderMilestoneTargetList();
    setMilestoneSettingsMessage('Saving milestone settings…', 'pending');

    if (await saveDbSettings(MILESTONE_SETTINGS_KEY, next)) {
        store.clearCache();
        setMilestoneSettingsMessage();
        refreshMilestoneDashboardCard();
        globalThis.refreshDashboardFireStatus?.();
        showToast({
            title: 'Milestones saved',
            message: successMessage,
            type: 'success',
            key: 'milestones-settings'
        });
        return true;
    }

    store.state.milestoneSettings = previous;
    renderMilestoneTargetList();
    setMilestoneSettingsMessage('Your milestone changes could not be saved.', 'error');
    showToast({
        title: 'Unable to save milestones',
        message: 'Your milestone changes could not be saved.',
        type: 'error',
        key: 'milestones-settings'
    });
    return false;
}

export function populateMilestoneSettings() {
    renderMilestoneSettingsToggle();
    renderMilestoneTargetList();
    const toggle = document.getElementById('milestones-setting-enabled');
    if (toggle) toggle.checked = isFeatureEnabled('milestones');
}

export function setupMilestoneSettings() {
    renderMilestoneSettingsToggle();
    const toggle = document.getElementById('milestones-setting-enabled');
    if (toggle && toggle.dataset.milestonesToggleInit !== 'true') {
        toggle.dataset.milestonesToggleInit = 'true';
        toggle.addEventListener('change', async event => {
            const saved = await setFeatureEnabled('milestones', event.target.checked);
            if (!saved) event.target.checked = isFeatureEnabled('milestones');
            refreshMilestoneDashboardCard();
        });
    }

    const form = document.getElementById('milestone-settings-form');
    if (!form || form.dataset.milestonesSettingsInit === 'true') {
        populateMilestoneSettings();
        return;
    }

    form.dataset.milestonesSettingsInit = 'true';
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('focusin', event => {
        if (isMilestoneAmountInput(event.target)) unformatMilestoneInput(event.target);
    });
    form.addEventListener('input', event => {
        if (isMilestoneAmountInput(event.target)) sanitizeMilestoneInput(event.target);
    });
    form.addEventListener('focusout', event => {
        if (isMilestoneAmountInput(event.target)) formatMilestoneInput(event.target);
    });
    form.addEventListener('change', event => {
        if (!event.target.closest?.('[data-milestone-target]')) return;
        void persistMilestoneTargets(readMilestoneInputs(), 'Your milestone targets were updated successfully.');
    });
    form.addEventListener('click', event => {
        const removeButton = event.target.closest?.('[data-milestone-remove]');
        if (removeButton) {
            event.preventDefault();
            const index = Number(removeButton.dataset.milestoneRemove);
            const targets = normalizeMilestoneSettings(store.state.milestoneSettings).targets;
            if (Number.isInteger(index) && index >= 0 && index < targets.length) {
                void persistMilestoneTargets(
                    targets.filter((_, targetIndex) => targetIndex !== index),
                    'The milestone was removed successfully.'
                );
            }
            return;
        }

        const addButton = event.target.closest?.('[data-milestone-add]');
        if (!addButton) return;
        event.preventDefault();
        const input = document.getElementById('milestone-new-target');
        const rawTarget = input?.value ?? '';
        const targets = [...readMilestoneInputs(), rawTarget];
        void persistMilestoneTargets(targets, 'The milestone was added successfully.').then(saved => {
            if (saved && input) input.value = '';
        });
    });

    populateMilestoneSettings();
}
