import { normalizeGeneralSettings, store } from '../store/store.js';
import { saveDbSettings } from '../api/apiClient.js';
import { renderFireView } from '../pages/FireTracker.js';
import { loadDashboard } from '../pages/Dashboard.js';
import { requestNotification, setupConfirmationModal } from './ConfirmationModal.js';
import { showToast } from './Toast.js';
import {
    renderCatalogInputField,
    renderCurrencyInputField,
    renderDateInputField,
    renderFeatureToggle
} from './FormFields.js';
import { escapeHtml } from '../utils/html.js';
import { closeManagedModal, openManagedModal, setupModalController } from './ModalController.js';

let generalSaveTimer;
let fireSaveTimer;
const DEFAULT_INCLUDED_ASSETS = ['investments', 'bonds', 'pensions', 'property'];

function renderGeneralSettingsControls() {
    const target = document.getElementById('general-settings-controls');
    if (!target || target.dataset.rendered === 'true') return;

    target.innerHTML = [
        renderFeatureToggle({
            id: 'general-setting-show-zero-values-dashboard',
            label: 'Show £0 value records on Dashboard'
        }),
        renderFeatureToggle({
            id: 'general-setting-show-zero-values-history',
            label: 'Show £0 value records on History'
        }),
        renderFeatureToggle({
            id: 'general-setting-show-sparklines',
            label: 'Show sparklines on Dashboard'
        })
    ].join('');
    target.dataset.rendered = 'true';
}

function renderFireSettingToggles() {
    const toggles = [
        ['fire-setting-include-state-pension-toggle', 'fire-setting-include-state-pension', 'Include State Pension'],
        ['fire-setting-include-windfalls-toggle', 'fire-setting-include-windfalls', 'Include Windfalls']
    ];

    toggles.forEach(([targetId, inputId, label]) => {
        const target = document.getElementById(targetId);
        if (!target || target.dataset.rendered === 'true') return;
        target.innerHTML = renderFeatureToggle({ id: inputId, label });
        target.dataset.rendered = 'true';
    });
}

function renderWindfallEntryFields() {
    const target = document.getElementById('windfall-entry-fields');
    if (!target || target.dataset.rendered === 'true') return;

    target.innerHTML = [
        renderCatalogInputField({
            id: 'new-wf-name',
            label: 'Name',
            placeholder: 'Windfall Name',
            inputAttributes: { style: 'flex: 2; min-width: 150px;' }
        }),
        renderCurrencyInputField({
            id: 'new-wf-amount',
            label: 'Amount (£)',
            placeholder: 'Amount (£)',
            inputAttributes: { style: 'flex: 1; min-width: 100px; text-align: right;' }
        }),
        renderDateInputField({
            id: 'new-wf-date',
            label: 'Date',
            placeholder: 'Select Date',
            inputAttributes: { style: 'flex: 1; min-width: 130px;', min: '2020-01-01', max: '2099-12-31' }
        })
    ].join('');
    target.dataset.rendered = 'true';
}

function normalizeAssetId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function parseFiniteNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneSettings(settings) {
    if (settings === undefined || settings === null) return {};
    try {
        return JSON.parse(JSON.stringify(settings));
    } catch {
        return {};
    }
}

function debounceSave(timer, callback) {
    clearTimeout(timer);
    return setTimeout(callback, 500);
}

function readGeneralCheckbox(id, fallback) {
    const checkbox = document.getElementById(id);
    return checkbox ? checkbox.checked === true : fallback;
}

function readShowZeroValuesOnDashboard(settings) {
    const newControl = document.getElementById('general-setting-show-zero-values-dashboard');
    if (newControl) return newControl.checked === true;

    // Keep the current index.html control working while the shared markup rolls
    // over to the explicitly named, positive setting.
    const legacyControl = document.getElementById('general-setting-hide-zero-values');
    return legacyControl ? legacyControl.checked !== true : settings.showZeroValuesOnDashboard === true;
}

export async function saveGeneralSettings() {
    const current = normalizeGeneralSettings(store.state.generalSettings);
    const previousSettings = cloneSettings(store.state.generalSettings);
    const showZeroValuesOnDashboard = readShowZeroValuesOnDashboard(current);
    const showZeroValuesOnHistory = readGeneralCheckbox(
        'general-setting-show-zero-values-history',
        current.showZeroValuesOnHistory
    );
    const showSparklines = readGeneralCheckbox(
        'general-setting-show-sparklines',
        current.showSparklines
    );
    store.state.generalSettings = {
        ...current,
        showZeroValuesOnDashboard,
        showZeroValuesOnHistory,
        showSparklines
    };

    if (!await saveDbSettings('wealthWatcherGeneralSettings', store.state.generalSettings)) {
        store.state.generalSettings = previousSettings;
        populateGeneralSettings();
        showToast({
            title: 'Unable to save settings',
            message: 'Your general settings could not be saved.',
            type: 'error',
            key: 'settings-general'
        });
        return false;
    }
    store.clearCache();
    await loadDashboard();
    showToast({
        title: 'Settings saved',
        message: 'Your general settings were saved successfully.',
        type: 'success',
        key: 'settings-general'
    });
    return true;
}

function scheduleGeneralSave() {
    generalSaveTimer = debounceSave(generalSaveTimer, saveGeneralSettings);
}

export async function saveFireSettings() {
    const previousSettings = cloneSettings(store.state.fireSettings);
    const income = parseFloat(String(document.getElementById('fire-setting-income')?.value ?? '').replace(/,/g, ''));
    const swr = parseFloat(String(document.getElementById('fire-setting-swr')?.value ?? ''));
    const includeStatePension = document.getElementById('fire-setting-include-state-pension')?.checked === true;
    const configuredStatePension = parseFloat(String(document.getElementById('fire-setting-state-pension')?.value ?? '').replace(/,/g, ''));
    const storedStatePension = parseFloat(store.state.fireSettings?.statePensionAmount);
    const spAmount = Number.isFinite(configuredStatePension)
        ? configuredStatePension
        : (Number.isFinite(storedStatePension) ? storedStatePension : 12547);
    if (!Number.isFinite(income) || income < 0 ||
        !Number.isFinite(swr) || swr <= 0 ||
        (includeStatePension && (!Number.isFinite(configuredStatePension) || configuredStatePension < 0))) {
        showToast({
            title: 'Unable to save FIRE settings',
            message: 'Enter valid income, withdrawal rate, and state pension values.',
            type: 'error',
            key: 'settings-fire'
        });
        return false;
    }

    const checkedAssets = Array.from(document.querySelectorAll('input[name="fire-assets"]:checked'))
        .map(cb => normalizeAssetId(cb.value))
        .filter(Boolean);

    store.state.fireSettings = {
        ...store.state.fireSettings,
        targetIncome: income,
        swr,
        includedAssets: checkedAssets,
        includeStatePension,
        statePensionAmount: spAmount,
        windfalls: Array.isArray(window.tempWindfalls) ? window.tempWindfalls : (store.state.fireSettings?.windfalls || []),
        includeWindfalls: document.getElementById('fire-setting-include-windfalls')?.checked === true
    };

    if (!await saveDbSettings('wealthWatcherFireSettings', store.state.fireSettings)) {
        store.state.fireSettings = previousSettings;
        populateFireSettings();
        showToast({
            title: 'Unable to save FIRE settings',
            message: 'Your FIRE settings could not be saved.',
            type: 'error',
            key: 'settings-fire'
        });
        return false;
    }
    store.clearCache();
    renderFireView();
    globalThis.refreshDashboardFireStatus?.();
    showToast({
        title: 'FIRE settings saved',
        message: 'Your FIRE settings were saved successfully.',
        type: 'success',
        key: 'settings-fire'
    });
    return true;
}

function scheduleFireSave(event) {
    if (event?.type === 'change') {
        clearTimeout(fireSaveTimer);
        fireSaveTimer = null;
        void saveFireSettings();
        return;
    }
    fireSaveTimer = debounceSave(fireSaveTimer, saveFireSettings);
}

export function setupModals() {
    renderGeneralSettingsControls();
    renderFireSettingToggles();
    renderWindfallEntryFields();
    setupConfirmationModal();
    setupModalController();

    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal-overlay')) {
            closeModal(event.target.id);
        }
    });

    populateGeneralSettings();

    const generalForm = document.getElementById('general-settings-form');
    generalForm?.addEventListener('input', scheduleGeneralSave);
    generalForm?.addEventListener('change', scheduleGeneralSave);
    generalForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        scheduleGeneralSave();
    });

    document.getElementById('fire-setting-include-state-pension')?.addEventListener('change', (e) => {
        const group = document.getElementById('state-pension-amount-group');
        if (group) group.style.display = e.target.checked ? 'block' : 'none';
        const amount = document.getElementById('fire-setting-state-pension');
        if (amount) {
            amount.disabled = !e.target.checked;
            amount.required = e.target.checked;
        }
    });

    document.getElementById('fire-setting-include-windfalls')?.addEventListener('change', (e) => {
        const group = document.getElementById('windfalls-group');
        group.style.display = e.target.checked ? 'block' : 'none';
    });

    const fireForm = document.getElementById('fire-settings-form');
    fireForm?.addEventListener('input', scheduleFireSave);
    fireForm?.addEventListener('change', scheduleFireSave);
    fireForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        void saveFireSettings();
    });
}

export function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return null;
    if (id === 'entry-modal') {
        window.resetPropertyFormState?.();
        const entryDate = document.getElementById('entry-date');
        const entryCategory = document.getElementById('entry-category');
        const entryName = document.getElementById('entry-name');
        const entryAssetId = document.getElementById('entry-asset-id');
        const entryValue = document.getElementById('entry-value');
        const entryMortgage = document.getElementById('entry-mortgage');
        const mortgageGroup = document.getElementById('mortgage-group');
        if (entryDate) entryDate.value = new Date().toISOString().split('T')[0];
        if (entryCategory) entryCategory.value = '';
        if (entryName) {
            entryName.readOnly = false;
            entryName.value = '';
        }
        if (entryAssetId) entryAssetId.value = '';
        window.selectedEntryAssetId = '';
        if (entryValue) entryValue.value = '';
        if (entryMortgage) entryMortgage.value = '';
        if (mortgageGroup) mortgageGroup.style.display = 'none';
        window.currentCategoryNames = [];
    }
    const escapeHandlers = {
        'property-delete-modal': () => window.cancelPropertyRemoval?.(),
        'classification-edit-modal': () => window.closeClassificationEditor?.()
    };
    return openManagedModal(modal, { onEscape: escapeHandlers[id] });
}

export function closeModal(id) {
    return closeManagedModal(id);
}

export function populateFireSettings() {
    renderFireSettingToggles();
    renderWindfallEntryFields();
    const s = store.state.fireSettings || {};
    
    const incomeInput = document.getElementById('fire-setting-income');
    if (incomeInput) {
        incomeInput.value = parseFiniteNumber(s.targetIncome, 4000)
            .toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    const swrInput = document.getElementById('fire-setting-swr');
    if (swrInput) swrInput.value = parseFiniteNumber(s.swr, 4.0);
    
    const includeSp = s.includeStatePension === true;
    const spCb = document.getElementById('fire-setting-include-state-pension');
    if (spCb) spCb.checked = includeSp;
    const spInput = document.getElementById('fire-setting-state-pension');
    if (spInput) {
        spInput.value = parseFiniteNumber(s.statePensionAmount, 12547)
            .toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        spInput.disabled = !includeSp;
        spInput.required = includeSp;
    }
    
    window.tempWindfalls = Array.isArray(s.windfalls) ? JSON.parse(JSON.stringify(s.windfalls)) : [];
    renderWindfallsTable();
    
    const rawIncluded = Array.isArray(s.includedAssets) ? s.includedAssets : DEFAULT_INCLUDED_ASSETS;
    const includedAssets = new Set(rawIncluded.map(normalizeAssetId).filter(Boolean));
    const assetOptions = document.getElementById('fire-asset-options');
    if (assetOptions) {
        // Only dynamic asset labels belong in this container. The static
        // state-pension control lives beside it so population never removes
        // its label or event handler.
        assetOptions.innerHTML = '';
        const categories = Array.isArray(store.state.CATEGORIES) ? store.state.CATEGORIES : [];
        categories.forEach(category => {
            const value = String(category.Id ?? '').trim();
            if (!value) return;
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; font-weight: normal; font-size: 0.95rem; color: #fff;';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'fire-assets';
            checkbox.value = value;
            checkbox.style.width = 'auto';
            checkbox.checked = includedAssets.has(normalizeAssetId(value));
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(category.Label || category.DisplayName || value));
            assetOptions.appendChild(label);
        });
    }

    document.querySelectorAll('input[name="fire-assets"]').forEach(cb => {
        cb.checked = includedAssets.has(normalizeAssetId(cb.value));
    });

    const spGroup = document.getElementById('state-pension-amount-group');
    if (spGroup) spGroup.style.display = spCb?.checked ? 'block' : 'none';

    const wfCb = document.getElementById('fire-setting-include-windfalls');
    if (wfCb) {
        const includeWf = s.includeWindfalls !== undefined ? s.includeWindfalls : (s.windfalls && s.windfalls.length > 0);
        wfCb.checked = includeWf;
        const wfGroup = document.getElementById('windfalls-group');
        if (wfGroup) {
            wfGroup.style.display = wfCb.checked ? 'block' : 'none';
        }
    }
}

function setupWindfallTableInteractions(tbody) {
    if (!tbody?.addEventListener || tbody.dataset.windfallInteractionsInit === 'true') return;
    tbody.dataset.windfallInteractionsInit = 'true';

    tbody.addEventListener('change', event => {
        const toggle = event.target?.closest?.('[data-windfall-toggle]');
        if (!toggle) return;
        const index = Number(toggle.dataset.windfallToggle);
        if (Number.isInteger(index) && index >= 0) toggleWindfall(index, toggle.checked);
    });
    tbody.addEventListener('click', event => {
        const removeButton = event.target?.closest?.('[data-windfall-remove]');
        if (!removeButton) return;
        const index = Number(removeButton.dataset.windfallRemove);
        if (!Number.isInteger(index) || index < 0) return;
        event.preventDefault();
        removeWindfall(index);
    });
}

export function renderWindfallsTable() {
    const tbody = document.getElementById('windfalls-tbody');
    if (!tbody) return;

    setupWindfallTableInteractions(tbody);
    tbody.innerHTML = '';
    window.tempWindfalls.forEach((wf, index) => {
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td data-label="Inc." style="text-align: center; padding: 0.5rem;"><input type="checkbox" ${wf.IncludeInCalculation ? 'checked' : ''} data-windfall-toggle="${index}" style="margin: 0; width: 1.1rem; height: 1.1rem; cursor: pointer; display: inline-block;"></td>
            <td data-label="Name" style="padding: 0.5rem; font-size: 0.95rem;">${escapeHtml(wf.Name)}</td>
            <td data-label="Amount" style="padding: 0.5rem; text-align: right; font-size: 0.95rem;">£${parseFloat(wf.Amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td data-label="Date" style="padding: 0.5rem; text-align: right; font-size: 0.95rem;">${escapeHtml(wf.ExpectedDate)}</td>
            <td data-label="Action" style="text-align: center; padding: 0.5rem;"><button type="button" class="action-btn icon-only" data-windfall-remove="${index}" title="Remove ${escapeHtml(wf.Name)}" aria-label="Remove ${escapeHtml(wf.Name)}" style="margin: 0;"><span aria-hidden="true" style="color: #ef4444; font-size: 1.2rem; line-height: 1;">&times;</span></button></td>
        `;
        tbody.appendChild(tr);
    });
}

export function addWindfall() {
    const nameInput = document.getElementById('new-wf-name');
    const amountInput = document.getElementById('new-wf-amount');
    const dateInput = document.getElementById('new-wf-date');
    const includeInput = document.getElementById('new-wf-include');
    
    const amountStr = amountInput.value.replace(/,/g, '');
    const amount = parseFloat(amountStr);
    
    if (!nameInput.value || isNaN(amount) || amount <= 0 || !dateInput.value) {
        requestNotification({
            title: 'Invalid windfall',
            message: 'Please provide a valid name, amount, and date.'
        });
        return;
    }
    
    window.tempWindfalls.push({
        Name: nameInput.value,
        Amount: amount,
        ExpectedDate: dateInput.value,
        IncludeInCalculation: includeInput.checked
    });
    
    nameInput.value = '';
    amountInput.value = '';
    dateInput.value = '';
    includeInput.checked = true;
    
    renderWindfallsTable();
    scheduleFireSave();
}

export function removeWindfall(index) {
    window.tempWindfalls.splice(index, 1);
    renderWindfallsTable();
    scheduleFireSave();
}

export function toggleWindfall(index, isChecked) {
    window.tempWindfalls[index].IncludeInCalculation = isChecked;
    scheduleFireSave();
}

export function populateGeneralSettings() {
    renderGeneralSettingsControls();
    const s = normalizeGeneralSettings(store.state.generalSettings || {});
    const dashboard = document.getElementById('general-setting-show-zero-values-dashboard');
    if (dashboard) {
        dashboard.checked = s.showZeroValuesOnDashboard === true;
    } else {
        const legacyDashboard = document.getElementById('general-setting-hide-zero-values');
        if (legacyDashboard) legacyDashboard.checked = s.showZeroValuesOnDashboard !== true;
    }
    const history = document.getElementById('general-setting-show-zero-values-history');
    if (history) {
        history.checked = s.showZeroValuesOnHistory === true;
    }
    const sparklines = document.getElementById('general-setting-show-sparklines');
    if (sparklines) {
        sparklines.checked = s.showSparklines !== false;
    }
}

// Make these available globally for inline onclicks until we refactor HTML
window.openModal = openModal;
window.closeModal = closeModal;
window.addWindfall = addWindfall;
window.removeWindfall = removeWindfall;
window.toggleWindfall = toggleWindfall;
window.populateGeneralSettings = populateGeneralSettings;
