import { apiRequest, API_BASE_URL, isDemoMode } from '../api/apiClient.js';
import { store } from '../store/store.js';
import { requestConfirmation } from './ConfirmationModal.js';
import { showToast } from './Toast.js';
import {
    closeAssetTypeaheads,
    getAssetTypeaheadState,
    renderAssetTypeahead,
    setAssetTypeaheadOpen,
    setupAssetTypeahead
} from './AssetTypeahead.js';
import { renderFeatureToggle, renderSelectField } from './FormFields.js';
import { PAGE_STATUS, setPageStatus } from './PageState.js';
import { escapeHtml } from '../utils/html.js';

const steps = ['Enable', 'Add Keys', 'Test', 'Pull Accounts', 'Allocate'];
const DEMO_ONLY_MESSAGE = 'This provider action is unavailable in demo mode. No credentials or live provider accounts are changed.';
const MARKET_DAYS = [
    { value: 'Monday', label: 'Monday' },
    { value: 'Tuesday', label: 'Tuesday' },
    { value: 'Wednesday', label: 'Wednesday' },
    { value: 'Thursday', label: 'Thursday' },
    { value: 'Friday', label: 'Friday' },
    { value: 'Saturday', label: 'Saturday' },
    { value: 'Sunday', label: 'Sunday' }
];
let catalog = [];
let connections = [];
let marketHoursSettings = createDefaultMarketHoursSettings();
let marketHoursSaveTimer;
let currentConnectionId = null;
let currentStep = 1;
let refreshDashboardData = async () => {};
let lastWizardTrigger = null;
let integrationLoadState = { status: 'idle', error: null };
let lastIntegrationLoadOptions = {};

async function request(path, options = {}) {
    if (isDemoProviderOperation(path, options)) {
        showDemoOnlyMessage();
        throw new DemoOnlyOperationError();
    }
    const response = await apiRequest(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = response.status === 204 || typeof response.json !== 'function'
        ? null
        : await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.Error || payload?.error || `Request failed (${response.status}).`);
    }
    return payload;
}

class DemoOnlyOperationError extends Error {
    constructor() {
        super(DEMO_ONLY_MESSAGE);
        this.demoOnly = true;
    }
}

function isDemoProviderOperation(path, options = {}) {
    if (!isDemoMode) return false;
    const method = String(options.method || 'GET').toUpperCase();
    const normalizedPath = String(path || '').split('?')[0];
    return method !== 'GET' && (normalizedPath === '/integrations/settings' || normalizedPath.startsWith('/integrations/'));
}

function showDemoOnlyMessage() {
    showToast({
        title: 'Demo mode',
        message: DEMO_ONLY_MESSAGE,
        type: 'info',
        key: 'demo-provider-operation'
    });
}

function descriptorFor(connection) {
    return catalog.find(item => item.Key === connection?.ProviderKey);
}

function statusLabel(status) {
    return String(status || '').replaceAll(/([a-z])([A-Z])/g, '$1 $2');
}

function isSnapTrade(connection) {
    return connection?.ProviderKey === 'snaptrade';
}

function createDefaultMarketHoursSettings() {
    return {
        Days: MARKET_DAYS.map(day => ({
            Day: day.value,
            Enabled: !['Saturday', 'Sunday'].includes(day.value),
            OpenTime: '08:00',
            CloseTime: '16:30'
        }))
    };
}

function timeInputValue(value, fallback) {
    const text = String(value || fallback || '');
    return text.length >= 5 ? text.slice(0, 5) : text;
}

function marketDaySettings(day) {
    return (marketHoursSettings?.Days || []).find(item =>
        String(item.Day || '').toLowerCase() === day.value.toLowerCase()) || {
        Day: day.value,
        Enabled: !['Saturday', 'Sunday'].includes(day.value),
        OpenTime: '08:00',
        CloseTime: '16:30'
    };
}

function renderMarketHours() {
    const target = document.getElementById('integration-market-hours');
    if (!target) return;

    const wasOpen = target.querySelector?.('details')?.open === true;
    target.innerHTML = `<details class="integration-market-hours-panel" aria-labelledby="integration-market-hours-title"${wasOpen ? ' open' : ''}>
        <summary class="integration-market-hours-summary">
            <span>
                <strong id="integration-market-hours-title">Market hours</strong>
                <small>Connections with market-hours polling enabled will only sync inside these windows.</small>
            </span>
            <span class="integration-market-hours-summary-hint">Server local time</span>
        </summary>
        <form id="integration-market-hours-form" class="integration-market-hours-form">
            <p class="integration-market-hours-description">Times are interpreted using the server's local clock.</p>
            <div class="integration-market-hours-days" role="group" aria-label="Market hours by day">
                ${MARKET_DAYS.map(day => {
                    const settings = marketDaySettings(day);
                    const enabled = settings.Enabled === true;
                    return `<div class="integration-market-hours-row" data-integration-market-day="${day.value}">
                        <label class="integration-market-day-toggle"><input type="checkbox" data-integration-market-day-enabled="${day.value}"${enabled ? ' checked' : ''}><span>${day.label}</span></label>
                        <label><span>Open</span><input type="time" value="${escapeHtml(timeInputValue(settings.OpenTime, '08:00'))}" data-integration-market-open="${day.value}"${enabled ? '' : ' disabled'}></label>
                        <label><span>Close</span><input type="time" value="${escapeHtml(timeInputValue(settings.CloseTime, '16:30'))}" data-integration-market-close="${day.value}"${enabled ? '' : ' disabled'}></label>
                    </div>`;
                }).join('')}
            </div>
            <div class="integration-market-hours-actions">
                <p class="integration-market-hours-message" id="integration-market-hours-message" role="status">Changes save automatically.</p>
            </div>
        </form>
    </details>`;
}

function allocationRoles(connection) {
    return isSnapTrade(connection) ? ['Deployed', 'Undeployed'] : ['Deployed'];
}

function allocationFor(account, role) {
    const allocation = (account?.AssetAllocations || []).find(item =>
        String(item.Role || '').toLowerCase() === role.toLowerCase());
    if (allocation) return allocation;
    return role === 'Deployed' && account?.AssetId
        ? { AssetId: account.AssetId, AssetDisplayName: account.AssetDisplayName || '' }
        : null;
}

function isAccountAllocationComplete(account, connection) {
    return allocationRoles(connection).every(role => Boolean(allocationFor(account, role)?.AssetId));
}

function assetKindValues() {
    const group = (store.state.classificationGroups || []).find(item =>
        String(item.Key || '').trim().toLowerCase() === 'asset-kind');
    return (Array.isArray(group?.Values) ? group.Values : [])
        .filter(value => !value.ArchivedAt &&
            String(value.Key || value.Code || '').trim().toLowerCase() !== 'unclassified')
        .slice()
        .sort((left, right) => {
            const orderDifference = (Number(left.DisplayOrder) || 0) - (Number(right.DisplayOrder) || 0);
            if (orderDifference !== 0) return orderDifference;
            return String(left.DisplayName || left.Key || '').localeCompare(String(right.DisplayName || right.Key || ''));
        });
}

function preferredAssetKindId(role) {
    const preferredCode = role === 'Undeployed' ? 'cash' : 'investments';
    const values = assetKindValues();
    return String(values.find(value =>
        String(value.Key || value.Code || '').trim().toLowerCase() === preferredCode)?.Id
        || values[0]?.Id
        || '');
}

function renderAssetKindOptions(selectedValueId, role) {
    const values = assetKindValues();
    const preferredId = String(selectedValueId || preferredAssetKindId(role));
    return [
        '<option value="">Select an Asset Kind</option>',
        ...values.map(value => {
            const valueId = String(value.Id);
            const selected = valueId === preferredId ? ' selected' : '';
            return `<option value="${escapeHtml(valueId)}"${selected}>${escapeHtml(value.DisplayName || value.Key || value.Code)}</option>`;
        })
    ].join('');
}

function renderSteps() {
    const target = document.getElementById('integration-wizard-steps');
    if (!target) return;
    target.innerHTML = steps.map((label, index) => `
        <span class="integration-step ${index + 1 === currentStep ? 'active' : ''} ${index + 1 < currentStep ? 'complete' : ''}">
            <b>${index + 1}</b>${label}
        </span>
    `).join('');
}

function renderConnections() {
    const target = document.getElementById('integration-connections');
    if (!target) return;

    if (integrationLoadState.status === 'loading') {
        setPageStatus(target, PAGE_STATUS.LOADING);
        target.innerHTML = '<p class="integration-empty" role="status">Loading integrations…</p>';
        return;
    }

    if (integrationLoadState.status === 'error') {
        setPageStatus(target, PAGE_STATUS.ERROR);
        target.innerHTML = renderIntegrationLoadError(integrationLoadState.error);
        return;
    }

    setPageStatus(target, connections.length > 0 ? PAGE_STATUS.READY : PAGE_STATUS.EMPTY);
    if (connections.length === 0) {
        target.innerHTML = '<p class="integration-empty" role="status">No integrations are enabled yet. Choose a partner below to begin.</p>';
        return;
    }

    target.innerHTML = connections.map(connection => {
        const descriptor = descriptorFor(connection);
        const accountSummary = connection.Accounts?.length
            ? `${connection.Accounts.filter(account => isAccountAllocationComplete(account, connection)).length}/${connection.Accounts.length} accounts allocated`
            : 'No accounts discovered';
        return `
            <article class="integration-connection" data-connection-id="${escapeHtml(connection.Id)}">
                <div class="integration-connection-copy">
                    <strong>${escapeHtml(connection.DisplayName)}</strong>
                    <span>${escapeHtml(descriptor?.DisplayName || connection.ProviderKey)} · ${escapeHtml(statusLabel(connection.Status))}</span>
                    <small>${escapeHtml(accountSummary)}${connection.LastError ? ` · ${escapeHtml(connection.LastError)}` : ''}</small>
                </div>
                <div class="integration-connection-controls">
                    <label class="integration-polling-control">
                        <span>Poll every</span>
                        <input class="integration-number-input" type="number" min="${escapeHtml(descriptor?.MinimumPollingIntervalMinutes || 1)}" step="1" value="${escapeHtml(connection.PollingIntervalMinutes)}" data-integration-polling="${escapeHtml(connection.Id)}" aria-label="Polling interval for ${escapeHtml(connection.DisplayName)}">
                        <span>minutes</span>
                    </label>
                    ${renderFeatureToggle({
                        id: `integration-enabled-${connection.Id}`,
                        label: 'Enabled',
                        className: 'integration-enabled-toggle',
                        title: 'Enable or disable scheduled polling',
                        inputAttributes: {
                            'data-integration-enabled': connection.Id,
                            checked: connection.Enabled
                        }
                    })}
                    ${renderFeatureToggle({
                        id: `integration-market-hours-${connection.Id}`,
                        label: 'Only poll during market times',
                        className: 'integration-market-hours-toggle',
                        title: 'Skip scheduled polling outside the configured market hours',
                        inputAttributes: {
                            'data-integration-market-hours': connection.Id,
                            checked: connection.OnlyPollDuringMarketTimes === true
                        }
                    })}
                    <div class="integration-connection-actions">
                        <button type="button" class="action-btn" data-integration-manage="${escapeHtml(connection.Id)}">Manage</button>
                        <button type="button" class="action-btn integration-remove-btn" data-integration-remove="${escapeHtml(connection.Id)}" aria-label="Remove ${escapeHtml(connection.DisplayName)}">Remove</button>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

export function renderIntegrationLoadError(error) {
    const message = error?.message || 'There was a problem communicating with the API.';
    return `<div class="integration-message error" role="alert">
        <strong>Unable to load integrations.</strong>
        <span>${escapeHtml(message)}</span>
        <button type="button" class="action-btn" data-integration-retry>Retry loading integrations</button>
    </div>`;
}

function renderCatalog() {
    const target = document.getElementById('integration-catalog');
    if (!target) return;
    target.innerHTML = catalog.map(descriptor => {
        const instanceCount = connections.filter(connection => connection.ProviderKey === descriptor.Key).length;
        return `<article class="integration-partner">
            <div>
                <strong>${escapeHtml(descriptor.DisplayName)}</strong>
                <p>${escapeHtml(descriptor.Description)}</p>
            </div>
            <button type="button" class="action-btn" data-integration-enable="${escapeHtml(descriptor.Key)}">${instanceCount ? 'Add another' : 'Enable'}</button>
        </article>`;
    }).join('');
}

function renderCredentialField(field, values = {}, allowEmpty = false) {
    const value = values[field.Key] ?? field.DefaultValue ?? '';
    const required = field.Required && !allowEmpty;
    if (field.Type === 'select') {
        const options = (field.Options || []).map(option =>
            `<option value="${escapeHtml(option.Value)}" ${String(option.Value) === String(value) ? 'selected' : ''}>${escapeHtml(option.Label)}</option>`
        ).join('');
        return `${renderSelectField({
            name: `option:${field.Key}`,
            label: `${field.Label}${field.Required ? ' *' : ''}`,
            wrapperClassName: 'integration-field',
            options,
            required
        })}<small>${escapeHtml(field.Description)}</small>`;
    }
    if (field.Type === 'checkbox') {
        return `<label class="integration-checkbox"><input type="checkbox" name="option:${escapeHtml(field.Key)}" ${String(value).toLowerCase() === 'true' ? 'checked' : ''}><span><strong>${escapeHtml(field.Label)}</strong><small>${escapeHtml(field.Description)}</small></span></label>`;
    }
    return `<label class="integration-field"><span>${escapeHtml(field.Label)}${field.Required ? ' *' : ''}</span>
        <input type="${escapeHtml(field.Type || (field.Secret ? 'password' : 'text'))}" name="credential:${escapeHtml(field.Key)}" value="" placeholder="${value ? 'Stored securely' : ''}" ${required} autocomplete="off">
        <small>${escapeHtml(field.Description)}</small></label>`;
}

function renderWizardBody() {
    const target = document.getElementById('integration-wizard-body');
    if (!target) return;
    closeAssetTypeaheads(target);
    const wizard = document.getElementById('integration-wizard');
    const connection = connections.find(item => item.Id === currentConnectionId);
    const descriptor = descriptorFor(connection);
    if (!wizard || !connection || !descriptor) {
        if (wizard) {
            wizard.hidden = true;
            wizard.classList.remove('active');
            wizard.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    const wasOpen = !wizard.hidden;
    wizard.hidden = false;
    wizard.classList.add('active');
    wizard.setAttribute('aria-hidden', 'false');
    renderSteps();
    const options = connection.Options || {};

    if (currentStep === 1) {
        target.innerHTML = `<h5>Step 1 · Enable ${escapeHtml(descriptor.DisplayName)}</h5>
            <p>Give this connection a name so you can distinguish it from other ${escapeHtml(descriptor.DisplayName)} instances. Your keys stay on this machine.</p>
            <form id="integration-name-form" class="integration-fields">
                <label class="integration-field"><span>Instance name *</span>
                    <input type="text" name="displayName" value="${escapeHtml(connection.DisplayName)}" maxlength="100" required autocomplete="off">
                    <small>For example, Trading 212 ISA or Trading 212 Invest.</small>
                </label>
                <div class="integration-wizard-actions"><button type="submit" class="action-btn primary">Continue to keys</button></div>
                <p class="integration-message" id="integration-wizard-message" role="status"></p>
            </form>`;
    } else if (currentStep === 2) {
        target.innerHTML = `<h5>Step 2 · Add keys</h5>
            <p>Enter the credentials for this partner. Existing values are retained unless replaced.</p>
            <form id="integration-credentials-form" class="integration-fields">
                ${descriptor.CredentialFields.map(field => renderCredentialField(field, {}, connection.HasCredentials)).join('')}
                ${descriptor.OptionFields.length ? `<div class="integration-options"><h6>Optional settings</h6>${descriptor.OptionFields.map(field => renderCredentialField(field, options)).join('')}</div>` : ''}
                <div class="integration-wizard-actions"><button type="button" class="action-btn" data-integration-back="1">Back</button><button type="submit" class="action-btn primary">Save keys</button></div>
                <p class="integration-message" id="integration-wizard-message" role="status"></p>
            </form>`;
    } else if (currentStep === 3) {
        target.innerHTML = `<h5>Step 3 · Test connection</h5>
            <p>Test the stored keys before retrieving any account information.</p>
            <p class="integration-message" id="integration-wizard-message" role="status"></p>
            <div class="integration-wizard-actions"><button type="button" class="action-btn" data-integration-back="2">Back</button><button type="button" class="action-btn primary" data-integration-test>Test connection</button></div>`;
    } else if (currentStep === 4) {
        target.innerHTML = `<h5>Step 4 · Pull accounts</h5>
            <p>Discover the accounts available to this connection. No values are synced until each account is allocated.</p>
            <p class="integration-message" id="integration-wizard-message" role="status"></p>
            <div class="integration-wizard-actions"><button type="button" class="action-btn" data-integration-back="3">Back</button><button type="button" class="action-btn primary" data-integration-discover>Pull accounts</button></div>`;
    } else if (currentStep === 5) {
        const accounts = connection.Accounts || [];
        target.innerHTML = `<h5>Step 5 · Allocate accounts</h5>
            <p>${isSnapTrade(connection) ? 'Choose an invested asset and an undeployed cash asset for each discovered account.' : 'Choose an existing asset or create a new one for each discovered account.'}</p>
            ${accounts.length ? accounts.map(account => renderAccountAllocation(account, connection)).join('') : '<p class="integration-empty">No accounts were discovered.</p>'}
            <div class="integration-wizard-actions"><button type="button" class="action-btn" data-integration-back="4">Back</button>${accounts.length ? '<button type="button" class="action-btn primary" data-integration-finish>Finish setup</button>' : ''}</div>`;
    } else {
        target.innerHTML = `<h5>Integration ready</h5><p>${escapeHtml(connection.DisplayName)} is configured and will poll every ${connection.PollingIntervalMinutes} minutes.</p><button type="button" class="action-btn primary" data-integration-close>Done</button>`;
    }

    if (!wasOpen) document.getElementById('integration-wizard-close')?.focus?.();
}

function setupWizardModal() {
    const wizard = document.getElementById('integration-wizard');
    if (!wizard || wizard.dataset.modalInitialized === 'true') return wizard;

    const stepsTarget = document.getElementById('integration-wizard-steps');
    const bodyTarget = document.getElementById('integration-wizard-body');
    const content = document.createElement('div');
    const header = document.createElement('div');
    const title = document.createElement('h2');
    const closeButton = document.createElement('button');

    wizard.classList.remove('integration-wizard');
    wizard.classList.add('modal-overlay');
    wizard.setAttribute('aria-hidden', 'true');

    content.className = 'modal-content glass-panel integration-wizard';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    content.setAttribute('aria-labelledby', 'integration-wizard-title');
    header.className = 'modal-header';
    title.id = 'integration-wizard-title';
    title.textContent = 'Integration setup';
    closeButton.type = 'button';
    closeButton.id = 'integration-wizard-close';
    closeButton.className = 'close-btn';
    closeButton.setAttribute('aria-label', 'Close integration setup');
    closeButton.dataset.integrationClose = 'true';
    closeButton.textContent = '×';

    header.append(title, closeButton);
    content.append(header);
    if (stepsTarget) content.append(stepsTarget);
    if (bodyTarget) content.append(bodyTarget);
    wizard.append(content);
    wizard.dataset.modalInitialized = 'true';
    return wizard;
}

function closeWizard() {
    currentConnectionId = null;
    renderWizardBody();
    lastWizardTrigger?.focus?.();
    lastWizardTrigger = null;
}

function renderAccountAllocation(account, connection) {
    const assets = (store.state.assets || []).filter(asset => !asset.ArchivedAt);
    const accountId = String(account.Id);
    const slots = allocationRoles(connection).map(role => {
        const allocation = allocationFor(account, role);
        const selectedAsset = assets.find(asset => String(asset.Id) === String(allocation?.AssetId));
        const selectedAssetId = allocation?.AssetId || '';
        const selectedAssetName = selectedAsset?.DisplayName || allocation?.AssetDisplayName || '';
        const hasAsset = Boolean(selectedAssetId);
        const isUndeployed = role === 'Undeployed';
        const roleLabel = isUndeployed ? 'Undeployed cash asset' : 'Invested asset';
        const roleDescription = isUndeployed
            ? 'Cash waiting to be invested'
            : 'Holdings and invested value';
        const fieldKey = `${accountId}-${role.toLowerCase()}`;
        const defaultName = isUndeployed
            ? `${account.DisplayName} - Undeployed cash`
            : account.DisplayName;
        const assetTypeahead = renderAssetTypeahead({
            id: `integration-${fieldKey}`,
            selectedAssetId,
            selectedAssetName,
            ariaLabel: `Search assets for ${account.DisplayName} ${roleLabel.toLowerCase()}`,
            pickerClass: 'integration-asset-typeahead',
            pickerAttributes: {
                'data-account-asset-picker': accountId,
                'data-account-allocation-role': role
            },
            valueAttributes: {
                'data-account-asset': accountId,
                'data-account-allocation-role': role
            },
            searchAttributes: {
                'data-account-asset-search': accountId,
                'data-account-allocation-role': role
            },
            optionsAttributes: {
                'data-account-asset-options': accountId,
                'data-account-allocation-role': role
            },
            emptyChoiceLabel: 'Create a new asset…'
        });
        return `<div class="integration-allocation-slot" data-account-allocation-role="${escapeHtml(role)}" data-account-initial-asset-id="${escapeHtml(selectedAssetId)}" data-account-allocation-cleared="false">
            <div class="integration-allocation-label"><strong>${roleLabel}</strong><small>${roleDescription}</small></div>
            ${assetTypeahead}
            <input type="text" data-account-new-asset="${escapeHtml(accountId)}" data-account-allocation-role="${escapeHtml(role)}" placeholder="New asset name" value="${hasAsset ? '' : escapeHtml(defaultName)}" ${hasAsset ? 'hidden' : ''}>
            ${renderSelectField({
                className: 'integration-select',
                ariaLabel: `New ${roleLabel.toLowerCase()} Asset Kind`,
                options: renderAssetKindOptions('', role),
                hidden: hasAsset,
                disabled: assetKindValues().length === 0,
                attributes: {
                    'data-account-asset-kind': accountId,
                    'data-account-allocation-role': role
                }
            })}
            <span class="integration-allocation-status" data-account-allocation-status="${escapeHtml(accountId)}" data-account-allocation-role="${escapeHtml(role)}" ${hasAsset ? '' : 'hidden'}>Allocated to ${escapeHtml(selectedAssetName)}</span>
            <button type="button" class="action-btn integration-clear-allocation" data-account-allocation-clear="${escapeHtml(accountId)}" data-account-allocation-role="${escapeHtml(role)}" aria-label="Remove ${escapeHtml(roleLabel.toLowerCase())} allocation" ${hasAsset ? '' : 'hidden'}>Remove allocation</button>
        </div>`;
    }).join('');
    return `<div class="integration-account" data-account-id="${escapeHtml(account.Id)}">
        <div class="integration-account-summary"><strong>${escapeHtml(account.DisplayName)}</strong><small>${escapeHtml(account.AccountType)}${account.Currency ? ` · ${escapeHtml(account.Currency)}` : ''}</small></div>
        <div class="integration-account-allocations">${slots}</div>
    </div>`;
}

function assetPickerState(picker) {
    const accountId = picker?.dataset.accountAssetPicker;
    const role = picker?.dataset.accountAllocationRole || 'Deployed';
    const row = picker?.closest('.integration-account');
    const typeahead = getAssetTypeaheadState(picker);
    return {
        accountId,
        role,
        row,
        slot: picker?.closest('.integration-allocation-slot'),
        assetId: typeahead.value || row?.querySelector(`[data-account-asset="${accountId}"][data-account-allocation-role="${role}"]`),
        search: typeahead.search || row?.querySelector(`[data-account-asset-search="${accountId}"][data-account-allocation-role="${role}"]`),
        options: typeahead.options || row?.querySelector(`[data-account-asset-options="${accountId}"][data-account-allocation-role="${role}"]`),
        newName: row?.querySelector(`[data-account-new-asset="${accountId}"][data-account-allocation-role="${role}"]`),
        assetKind: row?.querySelector(`[data-account-asset-kind="${accountId}"][data-account-allocation-role="${role}"]`),
        status: row?.querySelector(`[data-account-allocation-status="${accountId}"][data-account-allocation-role="${role}"]`),
        clearButton: row?.querySelector(`[data-account-allocation-clear="${accountId}"][data-account-allocation-role="${role}"]`)
    };
}

function clearAssetPickerSelection(state) {
    if (!state.assetId) return;
    state.assetId.value = '';
    if (state.newName) state.newName.hidden = false;
    if (state.assetKind) state.assetKind.hidden = false;
    if (state.status) {
        state.status.hidden = true;
        state.status.textContent = '';
    }
    if (state.search) state.search.placeholder = 'Search existing assets…';
}

function clearAccountAllocationSelection(button) {
    const slot = button.closest?.('.integration-allocation-slot');
    const picker = slot?.querySelector?.('[data-account-asset-picker]');
    const state = assetPickerState(picker);
    if (!state.slot || !state.assetId) return;

    state.assetId.value = '';
    state.search && (state.search.value = '');
    state.newName && (state.newName.value = '');
    if (state.newName) state.newName.hidden = false;
    if (state.assetKind) state.assetKind.hidden = false;
    if (state.status) {
        state.status.hidden = false;
        state.status.textContent = 'Allocation will be removed when setup is finished.';
    }
    if (state.clearButton) state.clearButton.hidden = true;
    state.slot.dataset.accountAllocationCleared = 'true';
    setAssetTypeaheadOpen(picker, false);
}

function chooseAsset(picker, assetId) {
    const state = assetPickerState(picker);
    const asset = (store.state.assets || []).find(item => String(item.Id) === String(assetId));
    if (!asset) {
        clearAssetPickerSelection(state);
        if (state.search) state.search.value = '';
        if (state.slot) state.slot.dataset.accountAllocationCleared = 'false';
        setAssetTypeaheadOpen(picker, false);
        state.newName?.focus?.();
        return;
    }

    if (state.assetId) state.assetId.value = String(asset.Id);
    if (state.search) {
        state.search.value = asset.DisplayName;
        state.search.placeholder = 'Search assets…';
    }
    if (state.newName) state.newName.value = '';
    if (state.newName) state.newName.hidden = true;
    if (state.assetKind) state.assetKind.hidden = true;
    if (state.status) {
        state.status.hidden = false;
        state.status.textContent = `${state.role === 'Undeployed' ? 'Cash allocated' : 'Allocated'} to ${asset.DisplayName}`;
    }
    if (state.clearButton) state.clearButton.hidden = false;
    if (state.slot) state.slot.dataset.accountAllocationCleared = 'false';
    setAssetTypeaheadOpen(picker, false);
}

function accountAllocationState(accountId, role) {
    const row = document.querySelector(`[data-account-id="${accountId}"]`);
    const slot = row?.querySelector(`.integration-allocation-slot[data-account-allocation-role="${role}"]`);
    const picker = slot?.querySelector(`[data-account-asset-picker="${accountId}"][data-account-allocation-role="${role}"]`);
    const typeahead = getAssetTypeaheadState(picker);
    const newAssetInput = slot?.querySelector(`[data-account-new-asset="${accountId}"][data-account-allocation-role="${role}"]`);
    return {
        initialAssetId: String(slot?.dataset.accountInitialAssetId || ''),
        cleared: slot?.dataset.accountAllocationCleared === 'true',
        assetId: String(typeahead.value?.value || ''),
        newName: newAssetInput && !newAssetInput.hidden ? String(newAssetInput.value || '').trim() : '',
        assetKindId: String(slot?.querySelector(`[data-account-asset-kind="${accountId}"][data-account-allocation-role="${role}"]`)?.value || '').trim()
    };
}

function accountAllocationNeedsSave(account, connection, role) {
    const roles = role ? [role] : allocationRoles(connection);
    return roles.some(roleName => {
        const state = accountAllocationState(account.Id, roleName);
        const currentAssetId = String(allocationFor(account, roleName)?.AssetId || '');
        if (state.assetId) return state.assetId !== currentAssetId;
        if (state.newName) return true;
        return state.cleared && Boolean(currentAssetId);
    });
}

async function refresh({ includeCatalog = true, includeAssets = true } = {}) {
    integrationLoadState = { status: 'loading', error: null };
    renderConnections();
    try {
        const [nextCatalog, nextConnections, nextAssets, nextMarketHours] = await Promise.all([
            includeCatalog ? request('/integrations/catalog') : Promise.resolve(catalog),
            request('/integrations'),
            includeAssets ? request('/assets') : Promise.resolve(null),
            request('/integrations/settings')
        ]);

        if (!Array.isArray(nextCatalog)) throw new Error('The integration catalogue response was invalid.');
        if (!Array.isArray(nextConnections)) throw new Error('The integrations response was invalid.');
        if (includeAssets && !Array.isArray(nextAssets)) throw new Error('The integration assets response was invalid.');

        catalog = nextCatalog;
        connections = nextConnections;
        marketHoursSettings = nextMarketHours || createDefaultMarketHoursSettings();
        if (includeAssets) store.state.assets = nextAssets;
        store.state.integrationCatalog = catalog;
        store.state.integrations = connections;
        integrationLoadState = { status: 'ready', error: null };
        renderMarketHours();
        renderCatalog();
        renderConnections();
        renderWizardBody();
    } catch (error) {
        integrationLoadState = { status: 'error', error };
        renderConnections();
        throw error;
    }
}

function showMessage(message, success = false) {
    const target = document.getElementById('integration-wizard-message');
    if (target) {
        target.textContent = message;
        target.className = `integration-message ${success ? 'success' : 'error'}`;
    }
}

function setButtonBusy(button, busy, label = 'Working…') {
    if (!button) return;
    if (busy) {
        if (!Object.prototype.hasOwnProperty.call(button.dataset, 'busyContent')) button.dataset.busyContent = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('is-busy');
        button.innerHTML = `<span class="integration-button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
        return;
    }

    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-busy');
    if (Object.prototype.hasOwnProperty.call(button.dataset, 'busyContent')) {
        button.innerHTML = button.dataset.busyContent;
        delete button.dataset.busyContent;
    }
}

async function withBusyButton(button, label, action) {
    setButtonBusy(button, true, label);
    try {
        return await action();
    } finally {
        setButtonBusy(button, false);
    }
}

async function enable(providerKey) {
    try {
        const connection = await request(`/integrations/${encodeURIComponent(providerKey)}`, { method: 'POST', body: '{}' });
        await refresh({ includeCatalog: false, includeAssets: false });
        currentConnectionId = connection.Id;
        currentStep = 1;
        renderWizardBody();
        showToast({
            title: 'Integration added',
            message: 'The integration connection is ready for setup.',
            type: 'success',
            key: 'integration-enable'
        });
    } catch (error) {
        if (error?.demoOnly) return;
        showMessage(error.message);
        showToast({
            title: 'Unable to add integration',
            message: error.message,
            type: 'error',
            key: 'integration-enable'
        });
    }
}

async function saveConnectionName(form) {
    const name = form.querySelector('[name="displayName"]')?.value.trim();
    if (!name) {
        showMessage('Enter a name for this integration instance.');
        return;
    }

    try {
        await request(`/integrations/${currentConnectionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ DisplayName: name })
        });
        await refresh({ includeCatalog: false, includeAssets: false });
        currentStep = 2;
        renderWizardBody();
        showToast({
            title: 'Integration name saved',
            message: 'The integration name was updated successfully.',
            type: 'success',
            key: 'integration-name'
        });
    } catch (error) {
        if (error?.demoOnly) return;
        showMessage(error.message);
        showToast({
            title: 'Unable to save integration name',
            message: error.message,
            type: 'error',
            key: 'integration-name'
        });
    }
}

async function removeConnection(connectionId) {
    const connection = connections.find(item => item.Id === connectionId);
    if (!connection) return;

    if (!await requestConfirmation({
        title: `Remove ${connection.DisplayName}?`,
        message: 'This removes the connection, credentials, and account mappings. Existing synced history and assets will be retained.',
        confirmLabel: 'Remove integration'
    })) return;

    try {
        await request(`/integrations/${connectionId}`, { method: 'DELETE' });
        if (currentConnectionId === connectionId) {
            currentConnectionId = null;
            currentStep = 1;
        }
        await refresh({ includeCatalog: false, includeAssets: false });
        showToast({
            title: 'Integration removed',
            message: `${connection.DisplayName} was removed successfully.`,
            type: 'success',
            key: 'integration-remove'
        });
    } catch (error) {
        if (error?.demoOnly) return;
        showMessage(error.message);
        showToast({
            title: 'Unable to remove integration',
            message: error.message,
            type: 'error',
            key: 'integration-remove'
        });
    }
}

async function saveCredentials(form) {
    const credentials = {};
    const options = {};
    form.querySelectorAll('[name^="credential:"]').forEach(input => {
        if (input.value.trim()) credentials[input.name.slice('credential:'.length)] = input.value.trim();
    });
    form.querySelectorAll('[name^="option:"]').forEach(input => {
        options[input.name.slice('option:'.length)] = input.type === 'checkbox' ? String(input.checked) : input.value;
    });
    try {
        await request(`/integrations/${currentConnectionId}/credentials`, {
            method: 'PUT', body: JSON.stringify({ Credentials: credentials, Options: options })
        });
        await refresh({ includeCatalog: false, includeAssets: false });
        currentStep = 3;
        renderWizardBody();
        showToast({
            title: 'Integration credentials saved',
            message: 'The integration credentials were saved successfully.',
            type: 'success',
            key: 'integration-credentials'
        });
    } catch (error) {
        if (error?.demoOnly) return;
        showMessage(error.message);
        showToast({
            title: 'Unable to save integration credentials',
            message: error.message,
            type: 'error',
            key: 'integration-credentials'
        });
    }
}

async function updateConnection(id, body) {
    try {
        await request(`/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await refresh({ includeCatalog: false, includeAssets: false });
        showToast({
            title: 'Integration settings saved',
            message: 'The integration settings were updated successfully.',
            type: 'success',
            key: 'integration-settings'
        });
    } catch (error) {
        console.error('Unable to update integration', error);
        showToast({
            title: 'Unable to update integration settings',
            message: error.message,
            type: 'error',
            key: 'integration-settings'
        });
        await refresh({ includeCatalog: false, includeAssets: false });
    }
}

function showMarketHoursMessage(message, state = 'error') {
    const target = document.getElementById('integration-market-hours-message');
    if (!target) return;
    target.textContent = message;
    target.className = `integration-market-hours-message ${state}`;
}

function scheduleMarketHoursSave(form) {
    clearTimeout(marketHoursSaveTimer);
    marketHoursSaveTimer = setTimeout(() => {
        marketHoursSaveTimer = null;
        void saveMarketHours(form);
    }, 500);
}

async function saveMarketHours(form) {
    const days = Array.from(form.querySelectorAll('[data-integration-market-day]')).map(row => {
        const day = row.dataset.integrationMarketDay;
        return {
            Day: day,
            Enabled: row.querySelector(`[data-integration-market-day-enabled="${day}"]`)?.checked === true,
            OpenTime: row.querySelector(`[data-integration-market-open="${day}"]`)?.value || '',
            CloseTime: row.querySelector(`[data-integration-market-close="${day}"]`)?.value || ''
        };
    });

    if (days.length !== MARKET_DAYS.length || days.some(day =>
        day.Enabled && (!day.OpenTime || !day.CloseTime || day.OpenTime >= day.CloseTime))) {
        showMarketHoursMessage('Enter an opening time before the closing time for each enabled day.', 'error');
        return;
    }

    showMarketHoursMessage('Saving market hours…', 'saving');
    try {
        marketHoursSettings = await request('/integrations/settings', {
            method: 'PUT',
            body: JSON.stringify({ Days: days })
        });
        showMarketHoursMessage('Market hours saved.', 'success');
        showToast({
            title: 'Market hours saved',
            message: 'Scheduled polling will use the updated market-hours windows.',
            type: 'success',
            key: 'integration-market-hours'
        });
    } catch (error) {
        if (error?.demoOnly) return;
        showMarketHoursMessage(error.message, 'error');
        showToast({
            title: 'Unable to save market hours',
            message: error.message,
            type: 'error',
            key: 'integration-market-hours'
        });
    }
}

async function allocateAccount(accountId, role = 'Deployed') {
    const state = accountAllocationState(accountId, role);
    const currentAssetId = String(allocationFor(
        (connections.flatMap(connection => connection.Accounts || [])).find(account => String(account.Id) === String(accountId)),
        role)?.AssetId || '');
    if (state.assetId) {
        if (state.assetId === currentAssetId && !state.cleared) return null;
    } else if (state.newName) {
        if (!state.assetKindId) throw new Error('Select an Asset Kind for the new asset.');
    } else if (state.cleared && currentAssetId) {
        return request(`/integrations/${currentConnectionId}/accounts/${accountId}/allocation`, {
            method: 'PUT',
            body: JSON.stringify({ Clear: true, Role: role })
        });
    } else {
        throw new Error('Select an existing asset or enter a name for a new one.');
    }

    const body = state.assetId
        ? { AssetId: state.assetId, Role: role }
        : { AssetName: state.newName, AssetKindId: state.assetKindId, Role: role };
    return request(`/integrations/${currentConnectionId}/accounts/${accountId}/allocation`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

export async function loadIntegrations(options = {}) {
    const panel = document.getElementById('integration-settings-pane');
    if (!panel) return;
    lastIntegrationLoadOptions = { ...options };
    try {
        await refresh(options);
    } catch (error) {
        renderConnections();
    }
}

export function setupIntegrations({ refresh: dashboardRefresh } = {}) {
    if (dashboardRefresh) refreshDashboardData = dashboardRefresh;
    const panel = document.getElementById('integration-settings-pane');
    if (!panel || panel.dataset.integrationsInit === 'true') return;
    panel.dataset.integrationsInit = 'true';
    const wizard = setupWizardModal();
    setupAssetTypeahead(panel, {
        emptyChoiceLabel: 'Create a new asset…',
        onClear: clearAssetPickerSelection,
        onChoose: chooseAsset
    });
    panel.addEventListener('click', async event => {
        if (event.target === wizard) return closeWizard();
        const button = event.target.closest('button');
        if (!button) return;
        try {
            if (button.disabled) return;
            if (button.hasAttribute?.('data-integration-retry')) {
                return loadIntegrations(lastIntegrationLoadOptions);
            }
            if (button.dataset.accountAllocationClear) return clearAccountAllocationSelection(button);
            if (button.dataset.integrationEnable) return withBusyButton(
                button,
                'Adding…',
                () => {
                    lastWizardTrigger = button;
                    return enable(button.dataset.integrationEnable);
                });
            if (button.dataset.integrationRemove) return removeConnection(button.dataset.integrationRemove);
            if (button.dataset.integrationManage) {
                lastWizardTrigger = button;
                currentConnectionId = button.dataset.integrationManage;
                const connection = connections.find(item => item.Id === currentConnectionId);
                currentStep = connection?.Status === 'NeedsCredentials'
                    ? 2
                    : connection?.Status === 'NeedsAllocation' || isSnapTrade(connection)
                        ? 5
                        : 3;
                return renderWizardBody();
            }
            if (button.dataset.integrationNext) {
                currentStep = Number(button.dataset.integrationNext);
                return renderWizardBody();
            }
            if (button.dataset.integrationBack) {
                currentStep = Number(button.dataset.integrationBack);
                return renderWizardBody();
            }
            if (button.hasAttribute('data-integration-test')) {
                return withBusyButton(button, 'Testing…', async () => {
                    const result = await request(`/integrations/${currentConnectionId}/test`, { method: 'POST' });
                    await refresh({ includeCatalog: false, includeAssets: false });
                    currentStep = result.Succeeded ? 4 : 3;
                    renderWizardBody();
                    showMessage(result.Message, result.Succeeded);
                    showToast({
                        title: result.Succeeded ? 'Connection test passed' : 'Connection test failed',
                        message: result.Message || (result.Succeeded ? 'The connection is working.' : 'The connection could not be verified.'),
                        type: result.Succeeded ? 'success' : 'error',
                        key: 'integration-test'
                    });
                });
            }
            if (button.hasAttribute('data-integration-discover')) {
                return withBusyButton(button, 'Pulling accounts…', async () => {
                    const result = await request(`/integrations/${currentConnectionId}/accounts/discover`, { method: 'POST' });
                    await refresh({ includeCatalog: false, includeAssets: false });
                    currentStep = result.Succeeded ? 5 : 4;
                    renderWizardBody();
                    showMessage(result.Message, result.Succeeded);
                    showToast({
                        title: result.Succeeded ? 'Accounts discovered' : 'Unable to discover accounts',
                        message: result.Message || (result.Succeeded ? 'Accounts were discovered successfully.' : 'The provider did not return any accounts.'),
                        type: result.Succeeded ? 'success' : 'error',
                        key: 'integration-discover'
                    });
                });
            }
            if (button.hasAttribute('data-integration-finish')) {
                return withBusyButton(button, 'Finishing setup…', async () => {
                    const connection = connections.find(item => item.Id === currentConnectionId);
                    const pending = (connection?.Accounts || []).filter(account => accountAllocationNeedsSave(account, connection));
                    for (const account of pending) {
                        for (const role of allocationRoles(connection)) {
                            if (accountAllocationNeedsSave(account, connection, role)) await allocateAccount(account.Id, role);
                        }
                    }
                    await refresh({ includeCatalog: false, includeAssets: true });
                    store.clearCache();
                    await refreshDashboardData();
                    currentStep = 6;
                    renderWizardBody();
                    showToast({
                        title: 'Integration setup complete',
                        message: 'Account allocations were saved successfully.',
                        type: 'success',
                        key: 'integration-finish'
                    });
                });
            }
            if (button.hasAttribute('data-integration-close')) {
                return closeWizard();
            }
        } catch (error) {
            if (error?.demoOnly) return;
            showMessage(error.message);
            showToast({
                title: 'Integration action failed',
                message: error.message,
                type: 'error',
                key: 'integration-action'
            });
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && wizard?.classList.contains('active')) {
            event.preventDefault();
            closeWizard();
        }
    });

    panel.addEventListener('submit', event => {
        event.preventDefault();
        if (event.target.id === 'integration-name-form') {
            return saveConnectionName(event.target);
        } else if (event.target.id === 'integration-credentials-form') {
            return saveCredentials(event.target);
        } else if (event.target.id === 'integration-market-hours-form') {
            return scheduleMarketHoursSave(event.target);
        }
    });

    panel.addEventListener('input', event => {
        const form = event.target.closest?.('#integration-market-hours-form');
        if (form) scheduleMarketHoursSave(form);
    });

    panel.addEventListener('change', async event => {
        const input = event.target;
        const marketHoursForm = input.closest?.('#integration-market-hours-form');
        if (marketHoursForm) {
            if (input.dataset.integrationMarketDayEnabled) {
                const row = input.closest('.integration-market-hours-row');
                const day = input.dataset.integrationMarketDayEnabled;
                row?.querySelector(`[data-integration-market-open="${day}"]`)?.toggleAttribute('disabled', !input.checked);
                row?.querySelector(`[data-integration-market-close="${day}"]`)?.toggleAttribute('disabled', !input.checked);
            }
            scheduleMarketHoursSave(marketHoursForm);
        } else if (input.dataset.integrationPolling) {
            const minutes = Number(input.value);
            if (Number.isInteger(minutes) && minutes > 0) await updateConnection(input.dataset.integrationPolling, { PollingIntervalMinutes: minutes });
        } else if (input.dataset.integrationEnabled) {
            await updateConnection(input.dataset.integrationEnabled, { Enabled: input.checked });
        } else if (input.dataset.integrationMarketHours) {
            await updateConnection(input.dataset.integrationMarketHours, { OnlyPollDuringMarketTimes: input.checked });
        }
    });
}
