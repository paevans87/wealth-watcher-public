import { store } from '../store/store.js';
import { API_BASE_URL, fetchFreshStrict, saveDbSettings } from '../api/apiClient.js';
import { formatter } from '../utils/formatters.js';
import { isFeatureEnabled, setFeatureEnabled } from '../utils/featureFlags.js';
import { showToast } from '../components/Toast.js';
import { PAGE_STATUS, setPageStatus } from '../components/PageState.js';
import {
    closeAssetTypeaheads,
    getAssetTypeaheadState,
    renderAssetTypeahead,
    setupAssetTypeahead
} from '../components/AssetTypeahead.js';
import {
    renderCatalogInputField,
    renderCurrencyInputField,
    renderFeatureToggle,
    renderSelectField
} from '../components/FormFields.js';
import {
    closeFormFlyout,
    initFormFlyout,
    openFormFlyout
} from '../components/FormFlyout.js';
import { escapeHtml, safeCssColor } from '../utils/html.js';
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_CONFIG } from './budgetConfig.js';
import { createBudgetFlowModel, renderBudgetFlow } from './BudgetFlow.js';

let budgetSaveTimer = null;
let budgetSaveContext = null;
let budgetSaveSnapshot = null;
let budgetFlowSelection = null;
let budgetPlanEditMode = false;
let budgetExpandedCategories = new Set();
let budgetLineEditorState = null;

const BUDGET_CADENCE_MONTHS = Object.freeze({
    monthly: 1,
    month: 1,
    '1m': 1,
    quarterly: 3,
    quarter: 3,
    '3m': 3,
    annually: 12,
    annual: 12,
    yearly: 12,
    year: 12,
    '12m': 12
});

const BUDGET_CADENCES = Object.freeze([
    Object.freeze({ value: 'monthly', label: 'Monthly' }),
    Object.freeze({ value: 'quarterly', label: 'Quarterly' }),
    Object.freeze({ value: 'annually', label: 'Annually' })
]);

function cloneBudgetSettings(settings) {
    if (settings === undefined || settings === null) return {};
    try {
        return JSON.parse(JSON.stringify(settings));
    } catch {
        return {};
    }
}

function parseBudgetNumber(value) {
    if (typeof value === 'string') value = value.replace(/,/g, '').trim();
    const amount = Number.parseFloat(value);
    return Number.isFinite(amount) ? amount : NaN;
}

function normalizeCadence(value) {
    const cadence = String(value || 'monthly').trim().toLowerCase();
    if (cadence === 'month' || cadence === '1m') return 'monthly';
    if (cadence === 'quarter' || cadence === '3m') return 'quarterly';
    if (cadence === 'annual' || cadence === 'yearly' || cadence === 'year' || cadence === '12m') return 'annually';
    return BUDGET_CADENCE_MONTHS[cadence] ? cadence : 'monthly';
}

export function getMonthlyBudgetAmount(item) {
    const amount = parseBudgetNumber(item?.amount);
    if (!Number.isFinite(amount)) return 0;

    const cadence = String(item?.cadence || 'monthly').trim().toLowerCase();
    const months = BUDGET_CADENCE_MONTHS[cadence] || 1;
    return amount / months;
}

export function getMonthlyBudgetTotals(budgetSettings = {}) {
    const totalFor = category => (Array.isArray(budgetSettings?.[category])
        ? budgetSettings[category].reduce((total, item) => {
            const monthlyAmount = getMonthlyBudgetAmount(item);
            return Number.isFinite(monthlyAmount) ? total + monthlyAmount : total;
        }, 0)
        : 0);
    const income = totalFor('income');
    const bills = totalFor('bills');
    const savings = totalFor('savings');
    const spend = totalFor('spend');

    return {
        income,
        bills,
        savings,
        spend,
        unallocated: income - bills - savings - spend
    };
}

function createBudgetId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        const value = character === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

function ensureBudgetSettings() {
    if (!store.state.budgetSettings || typeof store.state.budgetSettings !== 'object' || Array.isArray(store.state.budgetSettings)) {
        store.state.budgetSettings = {};
    }

    BUDGET_CATEGORIES.forEach(category => {
        const source = Array.isArray(store.state.budgetSettings[category])
            ? store.state.budgetSettings[category]
            : [];
        store.state.budgetSettings[category] = source.map(item => {
            const normalized = { ...(item || {}) };
            const isPendingLine = Object.prototype.hasOwnProperty.call(normalized, 'id') && normalized.id === null;
            if (!isPendingLine) normalized.id = normalized.id || createBudgetId();
            normalized.name = normalized.name ?? '';
            normalized.cadence = normalizeCadence(normalized.cadence);
            if (category === 'savings') normalized.assetId = normalized.assetId || null;
            return normalized;
        });
    });

    return store.state.budgetSettings;
}

function hasConfiguredBudgetData(budgetSettings) {
    return BUDGET_CATEGORIES.some(category =>
        Array.isArray(budgetSettings?.[category]) && budgetSettings[category].length > 0
    );
}

function hasPendingBudgetLines(budgetSettings = store.state.budgetSettings) {
    return BUDGET_CATEGORIES.some(category =>
        (budgetSettings?.[category] || []).some(item => item?.id === null)
    );
}

function getBudgetFlowBreakdowns(budgetSettings) {
    return Object.fromEntries(BUDGET_CATEGORIES.map(category => [category,
        (budgetSettings?.[category] || []).map((item, index) => {
            const asset = category === 'savings'
                ? (store.state.assets || []).find(candidate =>
                    String(candidate?.Id ?? candidate?.id ?? '') === String(item?.assetId || ''))
                : null;
            return {
                id: item?.id || `${category}-${index + 1}`,
                name: String(item?.name || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`),
                amount: parseBudgetNumber(item?.amount),
                cadence: normalizeCadence(item?.cadence),
                monthlyAmount: getMonthlyBudgetAmount(item),
                assetName: asset?.DisplayName ?? asset?.displayName ?? asset?.Name ?? asset?.name ?? ''
            };
        })
    ]));
}

function getBudgetValidationErrors(budgetSettings = ensureBudgetSettings()) {
    const errors = [];
    BUDGET_CATEGORIES.forEach(category => {
        (budgetSettings[category] || []).forEach((item, index) => {
            const label = String(item?.name || '').trim() || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`;
            const amount = parseBudgetNumber(item?.amount);
            if (!String(item?.name || '').trim()) errors.push(`${label} needs a name.`);
            if (!Number.isFinite(amount) || amount < 0) errors.push(`${label} needs a zero or positive amount.`);
            if (!BUDGET_CADENCE_MONTHS[String(item?.cadence || '').toLowerCase()]) {
                errors.push(`${label} needs a supported cadence.`);
            }
        });
    });
    return [...new Set(errors)];
}

function setValidationMessage(errors = []) {
    const message = document.getElementById('budget-validation-message');
    if (!message) return;
    if (!errors.length) {
        message.hidden = true;
        message.textContent = '';
        return;
    }
    message.hidden = false;
    message.textContent = errors.length === 1
        ? errors[0]
        : `${errors[0]} Complete the highlighted fields before saving.`;
}

function renderBudgetEnabledToggle() {
    const target = document.getElementById('budget-setting-enabled-toggle');
    if (!target || target.dataset.rendered === 'true') return;
    target.innerHTML = renderFeatureToggle({ id: 'budget-setting-enabled', label: 'Enabled' });
    target.dataset.rendered = 'true';
}

function renderCadenceOptions(selected = 'monthly') {
    return BUDGET_CADENCES.map(option =>
        `<option value="${option.value}"${option.value === normalizeCadence(selected) ? ' selected' : ''}>${option.label}</option>`
    ).join('');
}

function renderBudgetEntryForms() {
    BUDGET_CATEGORIES.forEach(category => {
        const config = BUDGET_CATEGORY_CONFIG[category];
        const target = document.getElementById(`budget-entry-${category}`);
        if (!target || target.dataset.rendered === 'true') return;
        const nameId = `new-${category}-name`;
        const amountId = `new-${category}-amount`;
        const cadenceId = `new-${category}-cadence`;
        target.innerHTML = `
            <div class="add-item-row budget-entry-row" data-budget-entry="${category}">
                ${renderCatalogInputField({ id: nameId, label: 'Name', placeholder: config.namePlaceholder, inputAttributes: { 'data-budget-new-field': 'name' } })}
                ${renderCurrencyInputField({ id: amountId, label: 'Amount (£)', placeholder: '0.00', inputAttributes: { min: '0', step: '0.01', 'data-budget-new-field': 'amount' } })}
                ${renderSelectField({ id: cadenceId, label: 'Cadence', className: 'budget-cadence-select', options: renderCadenceOptions(), attributes: { 'data-budget-new-field': 'cadence' } })}
                <button class="action-btn catalog-add-button" type="button" id="btn-add-budget-${category}" data-budget-add="${category}">Add ${config.itemLabel}</button>
            </div>`;
        target.dataset.rendered = 'true';
    });
}

function formatBudgetInputValue(value) {
    if (value === undefined || value === null || value === '') return '';
    const amount = parseBudgetNumber(value);
    return Number.isFinite(amount) ? String(amount) : String(value);
}

function formatBudgetDisplayAmount(value) {
    if (globalThis.window?.isObfuscated) return 'Amount hidden in privacy mode';
    const amount = parseBudgetNumber(value);
    return Number.isFinite(amount)
        ? formatter.format(amount)
        : 'Enter an amount';
}

function budgetCategoryLabel(category) {
    return BUDGET_CATEGORY_CONFIG[category]?.label || category;
}

function budgetCadenceLabel(cadence) {
    return BUDGET_CADENCES.find(option => option.value === normalizeCadence(cadence))?.label || 'Monthly';
}

function budgetPeriodLabel(cadence) {
    return normalizeCadence(cadence) === 'annually' ? 'year' : 'quarter';
}

function getBudgetAssetName(item) {
    if (!item?.assetId) return '';
    const asset = (store.state.assets || []).find(candidate =>
        String(candidate?.Id ?? candidate?.id ?? '') === String(item.assetId)
    );
    return asset?.DisplayName ?? asset?.displayName ?? asset?.Name ?? asset?.name ?? '';
}

function formatBudgetLineAmount(item) {
    if (globalThis.window?.isObfuscated) return 'Amount hidden';
    const amount = parseBudgetNumber(item?.amount);
    const monthly = getMonthlyBudgetAmount(item);
    if (!Number.isFinite(amount)) return 'Enter an amount';
    if (normalizeCadence(item?.cadence) === 'monthly') return `${formatter.format(monthly)} monthly`;
    return `${formatter.format(monthly)}/mo · ${formatter.format(amount)}/${budgetPeriodLabel(item?.cadence)}`;
}

function renderBudgetPlanLine(item, category, index) {
    const reference = item?.id === undefined || item?.id === null || item?.id === ''
        ? String(index)
        : String(item.id);
    const itemName = String(item?.name || '').trim() || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`;
    const assetName = category === 'savings' ? getBudgetAssetName(item) : '';
    const destination = category === 'savings'
        ? (assetName ? `Linked to ${assetName}` : 'No Forecast asset linked')
        : `${budgetCadenceLabel(item?.cadence)} plan line`;
    return `<button type="button" class="budget-plan-line" data-budget-plan-edit data-budget-category="${escapeHtml(category)}" data-budget-item-id="${escapeHtml(reference)}" data-budget-index="${index}" aria-label="Edit ${escapeHtml(itemName)}">
        <span class="budget-plan-line-main">
            <strong>${escapeHtml(itemName)}</strong>
            <span class="budget-plan-line-meta">${escapeHtml(destination)}</span>
        </span>
        <span class="budget-plan-line-amount obfuscate-val">${escapeHtml(formatBudgetLineAmount(item))}</span>
        <span class="budget-plan-line-cadence">${escapeHtml(budgetCadenceLabel(item?.cadence))}</span>
        <span class="budget-plan-line-action" aria-hidden="true">Edit <span>›</span></span>
    </button>`;
}

function updateBudgetPlanToolbar(settings) {
    const count = BUDGET_CATEGORIES.reduce((total, category) => total + (settings?.[category] || []).length, 0);
    const lineCount = document.getElementById('budget-plan-line-count');
    if (lineCount) {
        lineCount.textContent = count
            ? `${count} ${count === 1 ? 'line' : 'lines'} · review each amount, cadence and destination.`
            : 'Start with a line for income, bills, savings or spending.';
    }
    const editButton = document.getElementById('budget-edit-plan-button');
    if (editButton) {
        editButton.textContent = budgetPlanEditMode ? 'Done editing' : 'Edit plan';
        editButton.setAttribute?.('aria-pressed', String(budgetPlanEditMode));
    }
}

function renderBudgetPlanGroups(settings) {
    const target = document.getElementById('budget-plan-groups');
    updateBudgetPlanToolbar(settings);
    if (!target) return;

    target.innerHTML = BUDGET_CATEGORIES.map(category => {
        const items = Array.isArray(settings?.[category]) ? settings[category] : [];
        const expanded = budgetPlanEditMode || budgetExpandedCategories.has(category);
        const total = items.reduce((sum, item) => sum + getMonthlyBudgetAmount(item), 0);
        const groupId = `budget-plan-group-${category}`;
        const itemCopy = `${items.length} ${items.length === 1 ? 'line' : 'lines'}`;
        const lines = items.length
            ? `<div class="budget-plan-line-list">${items.map((item, index) => renderBudgetPlanLine(item, category, index)).join('')}</div>`
            : '<p class="budget-plan-empty-copy">No lines yet. Add one to give this part of the plan a job.</p>';
        return `<section class="budget-plan-group" data-budget-plan-group="${escapeHtml(category)}">
            <button type="button" class="budget-plan-group-header" data-budget-plan-group-toggle="${escapeHtml(category)}" aria-expanded="${expanded}" aria-controls="${groupId}">
                <span class="budget-plan-group-accent" style="--budget-plan-accent: ${safeCssColor(BUDGET_CATEGORY_CONFIG[category].color)}" aria-hidden="true"></span>
                <span class="budget-plan-group-heading"><strong>${escapeHtml(budgetCategoryLabel(category))}</strong><small>${escapeHtml(itemCopy)}</small></span>
                <span class="budget-plan-group-total obfuscate-val">${escapeHtml(displayedBudgetAmount(total))}<small>/mo</small></span>
                <span class="budget-plan-group-chevron" aria-hidden="true">⌄</span>
            </button>
            <div id="${groupId}" class="budget-plan-group-content" data-budget-plan-group-content${expanded ? '' : ' hidden'}>
                ${lines}
                <button type="button" class="budget-plan-add-button" data-budget-plan-add="${escapeHtml(category)}">+ Add ${escapeHtml(BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase())}</button>
            </div>
        </section>`;
    }).join('');
}

function getBudgetEditorAssetName(assetId) {
    if (!assetId) return '';
    const asset = (store.state.assets || []).find(candidate =>
        String(candidate?.Id ?? candidate?.id ?? '') === String(assetId)
    );
    return asset?.DisplayName ?? asset?.displayName ?? asset?.Name ?? asset?.name ?? '';
}

function getBudgetEditorValidationErrors(draft) {
    const errors = [];
    const category = budgetLineEditorState?.category;
    const label = BUDGET_CATEGORY_CONFIG[category]?.itemLabel || 'Budget';
    if (!String(draft?.name || '').trim()) errors.push(`Add a name for this ${label.toLowerCase()}.`);
    const amount = parseBudgetNumber(draft?.amount);
    if (!Number.isFinite(amount) || amount < 0) errors.push(`${label} amount must be zero or positive.`);
    if (!BUDGET_CADENCE_MONTHS[String(draft?.cadence || '').toLowerCase()]) errors.push(`${label} needs a supported cadence.`);
    return errors;
}

function renderBudgetLineEditorPreview() {
    const preview = document.getElementById('budget-line-editor-preview');
    const validation = document.getElementById('budget-line-editor-validation');
    const draft = budgetLineEditorState?.draft;
    if (!preview || !draft) return;

    const monthly = getMonthlyBudgetAmount(draft);
    const amount = parseBudgetNumber(draft.amount);
    const cadence = normalizeCadence(draft.cadence);
    const validAmount = Number.isFinite(amount) && amount >= 0;
    const value = validAmount
        ? (cadence === 'monthly'
            ? `${formatter.format(monthly)} planned each month`
            : `${formatter.format(monthly)} planned each month · ${formatter.format(amount)} per ${budgetPeriodLabel(cadence)}`)
        : 'Enter an amount to preview the monthly plan impact.';
    preview.innerHTML = `<span class="budget-line-editor-preview-label">Monthly plan impact</span><strong class="obfuscate-val">${escapeHtml(globalThis.window?.isObfuscated ? 'Amount hidden' : value)}</strong>`;

    const errors = getBudgetEditorValidationErrors(draft);
    if (validation) {
        validation.hidden = errors.length === 0;
        validation.textContent = errors.length ? errors[0] : '';
    }
}

function renderBudgetLineEditorFields() {
    const fields = document.getElementById('budget-line-editor-fields');
    const state = budgetLineEditorState;
    if (!fields || !state) return;
    const { category, draft } = state;
    const key = state.reference === null || state.reference === undefined
        ? `new-${category}`
        : String(state.reference);
    const nameLabel = BUDGET_CATEGORY_CONFIG[category]?.itemLabel || 'Budget';
    const assetField = category === 'savings'
        ? `<div class="budget-line-editor-field budget-line-editor-asset-field">
            <span class="budget-line-editor-field-label">Forecast asset <small>optional</small></span>
            ${renderAssetTypeahead({
                id: `budget-editor-asset-${key}`,
                selectedAssetId: draft.assetId || '',
                selectedAssetName: getBudgetEditorAssetName(draft.assetId),
                ariaLabel: `Forecast asset for ${draft.name || 'saving'}`,
                pickerClass: 'budget-line-editor-asset-picker',
                pickerAttributes: { 'data-budget-editor-asset-picker': 'true' },
                valueAttributes: { 'data-budget-editor-asset-value': 'true' },
                searchAttributes: { 'data-budget-editor-asset-search': 'true' },
                optionsAttributes: { 'data-budget-editor-asset-options': 'true' },
                emptyChoiceLabel: 'Unallocated'
            })}
            <small class="budget-line-editor-help">Link this saving to a Forecast asset so its planned contribution can be tracked there.</small>
        </div>`
        : '';
    fields.innerHTML = `
        ${renderCatalogInputField({
            id: `budget-editor-${category}-${key}-name`,
            label: `${nameLabel} name`,
            className: 'catalog-field budget-line-editor-field',
            placeholder: BUDGET_CATEGORY_CONFIG[category]?.namePlaceholder || '',
            value: draft.name || '',
            required: true,
            inputAttributes: { 'data-budget-editor-field': 'name', autocomplete: 'off' }
        })}
        ${renderCurrencyInputField({
            id: `budget-editor-${category}-${key}-amount`,
            label: 'Amount (£)',
            className: 'catalog-field budget-line-editor-field',
            placeholder: '0.00',
            value: formatBudgetInputValue(draft.amount),
            required: true,
            inputAttributes: { min: '0', step: '0.01', 'data-budget-editor-field': 'amount' }
        })}
        ${renderSelectField({
            id: `budget-editor-${category}-${key}-cadence`,
            label: 'How often?',
            className: 'integration-select budget-line-editor-select',
            options: renderCadenceOptions(draft.cadence),
            wrapperClassName: 'catalog-field budget-line-editor-field',
            attributes: { 'data-budget-editor-field': 'cadence' }
        })}
        ${assetField}`;
}

function openBudgetLineEditor(category, reference = null) {
    if (!BUDGET_CATEGORIES.includes(category)) return;
    const panel = document.getElementById('budget-line-editor');
    if (!panel) return;
    const existing = reference === null || reference === undefined
        ? null
        : resolveBudgetItem(category, reference);
    const index = existing ? (ensureBudgetSettings()[category] || []).indexOf(existing) : -1;
    const editorReference = existing
        ? (existing.id === undefined || existing.id === null ? index : existing.id)
        : null;
    budgetLineEditorState = {
        category,
        reference: editorReference,
        isNew: !existing,
        draft: existing
            ? cloneBudgetSettings(existing)
            : { id: null, name: '', amount: '', cadence: 'monthly', ...(category === 'savings' ? { assetId: null } : {}) }
    };
    budgetPlanEditMode = true;
    budgetExpandedCategories.add(category);
    renderBudgetPlanGroups(ensureBudgetSettings());
    renderBudgetLineEditorFields();
    renderBudgetLineEditorPreview();

    const kicker = document.getElementById('budget-line-editor-kicker');
    const title = document.getElementById('budget-line-editor-title');
    const copy = document.getElementById('budget-line-editor-copy');
    const deleteButton = document.getElementById('budget-line-editor-delete');
    if (kicker) kicker.textContent = existing ? `Edit ${BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase()}` : `Add ${BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase()}`;
    if (title) title.textContent = existing ? (existing.name || `Edit ${BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase()}`) : `Add ${BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase()}`;
    if (copy) copy.textContent = existing
        ? 'Update this line without changing the rest of your plan. Cancel to discard your draft.'
        : 'Add one clear line to your plan. You can link savings to a Forecast asset after choosing the amount and cadence.';
    if (deleteButton) deleteButton.hidden = !existing;
    openFormFlyout(panel, {
        initialFocus: `#budget-editor-${category}-${editorReference ?? `new-${category}`}-name`
    });
}

function closeBudgetLineEditor({ restoreFocus = true } = {}) {
    const panel = document.getElementById('budget-line-editor');
    closeAssetTypeaheads(panel);
    if (panel) closeFormFlyout(panel, { restoreFocus });
    else budgetLineEditorState = null;
}

function chooseBudgetEditorAsset(picker, assetId) {
    if (!budgetLineEditorState) return;
    budgetLineEditorState.draft.assetId = assetId || null;
    renderBudgetLineEditorFields();
    renderBudgetLineEditorPreview();
}

function handleBudgetLineEditorFieldChange(input) {
    const state = budgetLineEditorState;
    if (!state || !input?.dataset?.budgetEditorField) return;
    const field = input.dataset.budgetEditorField;
    if (field === 'name') state.draft.name = input.value;
    if (field === 'amount') state.draft.amount = input.value === '' ? '' : parseBudgetNumber(input.value);
    if (field === 'cadence') state.draft.cadence = normalizeCadence(input.value);
    const title = document.getElementById('budget-line-editor-title');
    if (field === 'name' && title && state.draft.name.trim()) title.textContent = state.draft.name.trim();
    renderBudgetLineEditorPreview();
}

function submitBudgetLineEditor(event) {
    event.preventDefault?.();
    const state = budgetLineEditorState;
    if (!state) return;
    const errors = getBudgetEditorValidationErrors(state.draft);
    if (errors.length) {
        renderBudgetLineEditorPreview();
        document.getElementById(`budget-editor-${state.category}-${state.reference ?? `new-${state.category}`}-name`)?.focus?.();
        return;
    }

    const previousSettings = beginBudgetMutation();
    const settings = ensureBudgetSettings();
    const payload = {
        name: String(state.draft.name).trim(),
        amount: parseBudgetNumber(state.draft.amount),
        cadence: normalizeCadence(state.draft.cadence)
    };
    if (state.category === 'savings') payload.assetId = state.draft.assetId || null;
    if (state.isNew) {
        settings[state.category].push({ id: null, ...payload });
    } else {
        const item = resolveBudgetItem(state.category, state.reference);
        if (!item) return;
        Object.assign(item, payload);
    }
    const message = state.isNew ? `${payload.name} was added to your budget.` : `${payload.name} was updated successfully.`;
    populateBudgetSettings();
    closeBudgetLineEditor({ restoreFocus: false });
    scheduleBudgetSave({
        title: state.isNew ? 'Budget item added' : 'Budget item updated',
        message
    }, previousSettings);
}

function deleteBudgetLineEditor() {
    const state = budgetLineEditorState;
    if (!state || state.isNew) return;
    const reference = state.reference;
    closeBudgetLineEditor({ restoreFocus: false });
    removeBudgetItem(state.category, reference);
}

function bindBudgetPlanInteractions() {
    const groups = document.getElementById('budget-plan-groups');
    if (groups && groups.dataset.budgetPlanInteractions !== 'true') {
        groups.dataset.budgetPlanInteractions = 'true';
        groups.addEventListener('click', event => {
            const toggle = event.target?.closest?.('[data-budget-plan-group-toggle]');
            if (toggle) {
                const category = toggle.dataset.budgetPlanGroupToggle;
                if (budgetExpandedCategories.has(category)) budgetExpandedCategories.delete(category);
                else budgetExpandedCategories.add(category);
                renderBudgetPlanGroups(ensureBudgetSettings());
                return;
            }
            const addButton = event.target?.closest?.('[data-budget-plan-add]');
            if (addButton) {
                event.preventDefault?.();
                openBudgetLineEditor(addButton.dataset.budgetPlanAdd);
                return;
            }
            const line = event.target?.closest?.('[data-budget-plan-edit]');
            if (line) {
                event.preventDefault?.();
                openBudgetLineEditor(line.dataset.budgetCategory, line.dataset.budgetItemId || line.dataset.budgetIndex);
            }
        });
    }

    const editButton = document.getElementById('budget-edit-plan-button');
    if (editButton && editButton.dataset.budgetPlanEditInit !== 'true') {
        editButton.dataset.budgetPlanEditInit = 'true';
        editButton.addEventListener('click', () => {
            budgetPlanEditMode = !budgetPlanEditMode;
            if (budgetPlanEditMode) BUDGET_CATEGORIES.forEach(category => budgetExpandedCategories.add(category));
            renderBudgetPlanGroups(ensureBudgetSettings());
        });
    }

    const panel = document.getElementById('budget-line-editor');
    if (panel) {
        initFormFlyout(panel, {
            onClose: () => {
                closeAssetTypeaheads(panel);
                budgetLineEditorState = null;
            }
        });
    }
    const form = document.getElementById('budget-line-editor-form');
    if (form && form.dataset.budgetLineEditorInit !== 'true') {
        form.dataset.budgetLineEditorInit = 'true';
        setupAssetTypeahead(form, { emptyChoiceLabel: 'Unallocated', onChoose: chooseBudgetEditorAsset });
        form.addEventListener('submit', submitBudgetLineEditor);
        form.addEventListener('input', event => handleBudgetLineEditorFieldChange(event.target?.closest?.('[data-budget-editor-field]')));
        form.addEventListener('change', event => handleBudgetLineEditorFieldChange(event.target?.closest?.('[data-budget-editor-field]')));
    }
    if (panel && panel.dataset.budgetLineEditorInteractions !== 'true') {
        panel.dataset.budgetLineEditorInteractions = 'true';
        panel.addEventListener('click', event => {
            if (event.target?.closest?.('[data-budget-editor-delete]')) deleteBudgetLineEditor();
        });
    }
}

function renderBudgetCadenceCell(item, category, index, itemKey) {
    return `<td data-label="Cadence" class="budget-cadence-cell">
        ${renderSelectField({
            id: `budget-${category}-${itemKey}-cadence`,
            ariaLabel: `Cadence for ${item.name || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`}`,
            className: 'budget-cadence-select',
            options: renderCadenceOptions(item.cadence),
            attributes: {
                'data-budget-field': 'cadence',
                'data-budget-category': category,
                'data-budget-item-id': item.id ?? '',
                'data-budget-index': index,
                'data-budget-saving-cadence': category === 'savings' ? index : undefined
            }
        })}
    </td>`;
}

function renderBudgetAssetCell(item, index, itemKey) {
    const selectedAsset = (store.state.assets || []).find(asset =>
        String(asset.Id) === String(item.assetId || '')
    );
    return `<td data-label="Forecast asset" class="budget-asset-cell">
        ${renderAssetTypeahead({
            id: `budget-${itemKey}`,
            selectedAssetId: item.assetId || '',
            selectedAssetName: selectedAsset?.DisplayName || '',
            ariaLabel: `Forecast asset for ${item.name || `saving ${index + 1}`}`,
            pickerClass: 'budget-asset-typeahead',
            pickerAttributes: {
                'data-budget-saving-asset-picker': index,
                'data-budget-item-id': item.id ?? ''
            },
            valueAttributes: {
                'data-budget-saving-asset': index,
                'data-budget-item-id': item.id
            },
            searchAttributes: {
                'data-budget-saving-asset-search': index,
                'data-budget-item-id': item.id
            },
            optionsAttributes: { 'data-budget-saving-asset-options': index },
            emptyChoiceLabel: 'Unallocated'
        })}
    </td>`;
}

function renderBudgetTable(tbodyId, array, color, category) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    const safeColor = safeCssColor(color);

    (Array.isArray(array) ? array : []).forEach((item, index) => {
        const row = document.createElement('tr');
        const itemId = item.id === undefined || item.id === null ? '' : String(item.id);
        const itemKey = itemId || `new-${category}-${index}`;
        const itemLabel = item.name || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`;
        const escapedItemLabel = escapeHtml(itemLabel);
        const amountValue = formatBudgetInputValue(item.amount);
        const assetCell = category === 'savings' ? renderBudgetAssetCell(item, index, itemKey) : '';
        row.className = 'budget-item-row';
        row.dataset.budgetCategory = category;
        row.dataset.budgetItemId = itemId;
        row.innerHTML = `
            <td data-label="Name" class="budget-name-cell">
                <label class="budget-cell-field" for="budget-${category}-${escapeHtml(itemKey)}-name">
                    <span class="sr-only">Name for ${escapedItemLabel}</span>
                    <input id="budget-${category}-${escapeHtml(itemKey)}-name" class="budget-editable-input" type="text" value="${escapeHtml(item.name)}" data-budget-field="name" data-budget-category="${category}" data-budget-item-id="${escapeHtml(itemId)}" data-budget-index="${index}" aria-label="Name for ${escapedItemLabel}" autocomplete="off">
                </label>
            </td>
            <td data-label="Amount" class="budget-amount-cell">
                <label class="budget-cell-field" for="budget-${category}-${escapeHtml(itemKey)}-amount">
                    <span class="sr-only">Amount for ${escapedItemLabel}</span>
                    <input id="budget-${category}-${escapeHtml(itemKey)}-amount" class="budget-editable-input budget-amount-input obfuscate-val" type="number" min="0" step="0.01" value="${escapeHtml(amountValue)}" data-budget-field="amount" data-budget-category="${category}" data-budget-item-id="${escapeHtml(itemId)}" data-budget-index="${index}" aria-label="Amount for ${escapedItemLabel}. ${escapeHtml(formatBudgetDisplayAmount(item.amount))}" inputmode="decimal">
                </label>
            </td>
            ${assetCell}
            ${renderBudgetCadenceCell(item, category, index, itemKey)}
            <td data-label="Actions" class="budget-row-actions">
                <button type="button" class="action-btn icon-only budget-remove-button" data-budget-remove="${category}" data-budget-item-id="${escapeHtml(itemId)}" data-budget-index="${index}" aria-label="Remove ${escapedItemLabel}" title="Remove ${escapedItemLabel}">&times;</button>
            </td>`;
        tbody.appendChild(row);
        if (item.cadence === undefined) item.cadence = 'monthly';
    });
}

function renderBudgetEditorTables(settings) {
    closeAssetTypeaheads(document.getElementById('budget-settings-form'));
    renderBudgetTable('budget-income-tbody', settings.income, BUDGET_CATEGORY_CONFIG.income.color, 'income');
    renderBudgetTable('budget-bills-tbody', settings.bills, BUDGET_CATEGORY_CONFIG.bills.color, 'bills');
    renderBudgetTable('budget-savings-tbody', settings.savings, BUDGET_CATEGORY_CONFIG.savings.color, 'savings');
    renderBudgetTable('budget-spend-tbody', settings.spend, BUDGET_CATEGORY_CONFIG.spend.color, 'spend');
}

function updateBudgetDisabledDescription() {
    const enabled = isFeatureEnabled('budget');
    const enabledToggle = document.getElementById('budget-setting-enabled');
    if (enabledToggle) enabledToggle.checked = enabled;
    const description = document.getElementById('budget-disabled-description');
    if (description) description.hidden = enabled;
    const form = document.getElementById('budget-settings-form');
    if (form) form.hidden = !enabled;
    const planEditor = document.getElementById('budget-plan-editor');
    if (planEditor) planEditor.hidden = !enabled;
    if (!enabled && budgetLineEditorState) closeBudgetLineEditor({ restoreFocus: false });
}

function displayedBudgetAmount(value) {
    return globalThis.window?.isObfuscated ? '£***' : formatter.format(value);
}

function renderBudgetSummary(totals) {
    const values = {
        'budget-total-income': totals.income,
        'budget-total-bills': totals.bills,
        'budget-total-savings': totals.savings,
        'budget-total-spend': totals.spend,
        'budget-unallocated': totals.unallocated
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.innerText = displayedBudgetAmount(value);
    });

    const unallocated = document.getElementById('budget-unallocated');
    const label = document.getElementById('budget-unallocated-label');
    if (label) label.innerText = totals.unallocated < 0 ? 'Funding gap' : 'Left to allocate';
    if (unallocated?.style) unallocated.style.color = totals.unallocated < 0 ? '#f87171' : '';
}

function clearBudgetSummary() {
    ['budget-total-income', 'budget-total-bills', 'budget-total-savings', 'budget-total-spend', 'budget-unallocated']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.innerText = '';
                if (element.style) element.style.color = '';
            }
        });
    const label = document.getElementById('budget-unallocated-label');
    if (label) label.innerText = 'Left to allocate';
}

function renderBudgetEmptyState() {
    const view = document.getElementById('budget-view');
    if (!view) return;
    let emptyState = document.getElementById('budget-empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'budget-empty-state';
        emptyState.className = 'budget-page-state budget-empty-state';
        emptyState.setAttribute?.('role', 'status');
        emptyState.innerHTML = `
            <span class="budget-empty-kicker">Monthly allocation</span>
            <h2>Give every pound a clear job.</h2>
            <p>Add income, bills, savings and spending below to see a calm monthly flow from income to outcomes.</p>
            <p class="budget-empty-note">Your first line will appear in the overview as soon as it is saved.</p>`;
        const header = view.querySelector?.(':scope > header') || view.querySelector?.('header');
        if (header && typeof view.insertBefore === 'function') view.insertBefore(emptyState, header.nextElementSibling || null);
        else if (typeof view.prepend === 'function') view.prepend(emptyState);
        else if (typeof view.insertBefore === 'function') view.insertBefore(emptyState, view.firstChild || null);
        else view.appendChild?.(emptyState);
    }
    emptyState.hidden = false;
}

function showBudgetDisabledState() {
    const disabledState = document.getElementById('budget-disabled-state');
    if (disabledState) disabledState.hidden = false;
    const emptyState = document.getElementById('budget-empty-state');
    if (emptyState) emptyState.hidden = true;
    const overview = document.getElementById('budget-overview-content');
    if (overview) overview.hidden = true;
}

function hideBudgetStatePanels() {
    ['budget-loading-state', 'budget-disabled-state', 'budget-empty-state'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.hidden = true;
    });
}

function bindBudgetFlowInteractions() {
    const flowTarget = document.getElementById('budget-flow-renderer');
    if (!flowTarget || flowTarget.dataset.budgetFlowInteractions === 'true') return;
    flowTarget.dataset.budgetFlowInteractions = 'true';

    const activateFlowControl = control => {
        if (control.dataset.budgetFlowClear !== undefined) budgetFlowSelection = null;
        else budgetFlowSelection = control.dataset.budgetFlowFocus || null;
        const result = renderBudgetPresentation(ensureBudgetSettings());
        const view = document.getElementById('budget-view');
        if (view) {
            view.dataset.budgetState = result.state;
            view.dataset.budgetHasData = String(result.hasData);
            view.dataset.budgetFundingGap = String(result.totals.unallocated < 0);
        }
    };

    flowTarget.addEventListener('click', event => {
        const control = event.target?.closest?.('[data-budget-flow-focus], [data-budget-flow-clear]');
        if (!control) return;
        event.preventDefault();
        activateFlowControl(control);
    });
    flowTarget.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const control = event.target?.closest?.('[data-budget-flow-focus], [data-budget-flow-clear]');
        if (!control) return;
        event.preventDefault();
        activateFlowControl(control);
    });
}

function renderBudgetPresentation(settings, { preserveEditor = true } = {}) {
    const enabled = isFeatureEnabled('budget');
    const overview = document.getElementById('budget-overview-content');
    const emptyState = document.getElementById('budget-empty-state');
    const disabledState = document.getElementById('budget-disabled-state');
    const flowTarget = document.getElementById('budget-flow-renderer');
    const totals = getMonthlyBudgetTotals(settings);
    const flowBreakdowns = getBudgetFlowBreakdowns(settings);
    const errors = getBudgetValidationErrors(settings);
    const hasData = hasConfiguredBudgetData(settings);

    bindBudgetFlowInteractions();
    bindBudgetPlanInteractions();
    if (budgetFlowSelection && !(flowBreakdowns[budgetFlowSelection] || []).length) budgetFlowSelection = null;

    updateBudgetDisabledDescription();
    renderBudgetPlanGroups(settings);
    setValidationMessage(errors);
    if (!preserveEditor) renderBudgetEditorTables(settings);

    if (!enabled) {
        budgetFlowSelection = null;
        budgetPlanEditMode = false;
        if (overview) overview.hidden = true;
        if (emptyState) emptyState.hidden = true;
        if (disabledState) disabledState.hidden = false;
        if (flowTarget) flowTarget.innerHTML = '';
        if (document.getElementById('budget-plan-groups')) document.getElementById('budget-plan-groups').innerHTML = '';
        clearBudgetSummary();
        return { totals, errors, hasData, state: 'disabled' };
    }

    if (disabledState) disabledState.hidden = true;
    if (hasData) {
        if (overview) overview.hidden = false;
        if (emptyState) emptyState.hidden = true;
        renderBudgetSummary(totals);
        renderBudgetFlow(flowTarget, createBudgetFlowModel(totals, flowBreakdowns), {
            formatter: value => displayedBudgetAmount(value),
            obfuscated: Boolean(globalThis.window?.isObfuscated),
            selectedCategory: budgetFlowSelection
        });
        return { totals, errors, hasData, state: errors.length ? 'invalid' : 'ready' };
    }

    if (overview) overview.hidden = true;
    budgetFlowSelection = null;
    renderBudgetEmptyState();
    if (flowTarget) flowTarget.innerHTML = '';
    clearBudgetSummary();
    return { totals, errors, hasData, state: errors.length ? 'invalid' : 'empty' };
}

export function loadBudgetView(_viewMode = null) {
    const view = document.getElementById('budget-view');
    const settings = ensureBudgetSettings();
    renderBudgetEnabledToggle();
    renderBudgetEntryForms();
    renderBudgetEditorTables(settings);
    hideBudgetStatePanels();
    setPageStatus('budget-view', PAGE_STATUS.LOADING);

    const result = renderBudgetPresentation(settings);
    if (result.state === 'disabled') {
        showBudgetDisabledState();
        setPageStatus('budget-view', PAGE_STATUS.READY);
    } else if (result.state === 'empty') {
        setPageStatus('budget-view', PAGE_STATUS.EMPTY);
    } else {
        setPageStatus('budget-view', PAGE_STATUS.READY);
    }
    if (view) {
        view.dataset.budgetState = result.state;
        view.dataset.budgetHasData = String(result.hasData);
        view.dataset.budgetFundingGap = String(result.totals.unallocated < 0);
        view.setAttribute?.('aria-busy', 'false');
    }
    return result;
}

window.loadBudgetOverview = () => loadBudgetView();

function resolveBudgetItem(category, reference) {
    const items = ensureBudgetSettings()[category] || [];
    const referenceString = reference === undefined || reference === null ? '' : String(reference);
    const byId = referenceString
        ? items.find(item => String(item.id) === referenceString)
        : null;
    if (byId) return byId;
    const index = referenceString === '' ? -1 : Number(reference);
    return Number.isInteger(index) && index >= 0 ? items[index] : null;
}

function beginBudgetMutation() {
    const previousSettings = cloneBudgetSettings(store.state.budgetSettings);
    if (budgetSaveSnapshot === null) budgetSaveSnapshot = previousSettings;
    return previousSettings;
}

function refreshBudgetPresentation() {
    const settings = ensureBudgetSettings();
    const view = document.getElementById('budget-view');
    const result = renderBudgetPresentation(settings);
    if (view) {
        view.dataset.budgetState = result.state;
        view.dataset.budgetHasData = String(result.hasData);
        view.dataset.budgetFundingGap = String(result.totals.unallocated < 0);
    }
    return result;
}

function handleBudgetFieldChange(input) {
    const category = input?.dataset?.budgetCategory;
    const item = resolveBudgetItem(category, input?.dataset?.budgetItemId || input?.dataset?.budgetIndex);
    if (!item || !BUDGET_CATEGORIES.includes(category)) return;

    beginBudgetMutation();
    const field = input.dataset.budgetField;
    if (field === 'name') item.name = input.value;
    if (field === 'amount') item.amount = input.value === '' ? '' : parseBudgetNumber(input.value);
    if (field === 'cadence') item.cadence = normalizeCadence(input.value);

    const result = refreshBudgetPresentation();
    if (result.errors.length) return;
    scheduleBudgetSave({
        title: 'Budget settings saved',
        message: 'Your budget changes were saved successfully.'
    });
}

function addBudgetItem(category) {
    const nameInput = document.getElementById(`new-${category}-name`);
    const amountInput = document.getElementById(`new-${category}-amount`);
    const cadenceInput = document.getElementById(`new-${category}-cadence`);
    if (!nameInput || !amountInput) {
        openBudgetLineEditor(category);
        return;
    }

    const name = String(nameInput.value || '').trim();
    const amount = parseBudgetNumber(amountInput.value);
    if (!name) {
        setValidationMessage([`Add a name for this ${BUDGET_CATEGORY_CONFIG[category].itemLabel.toLowerCase()}.`]);
        nameInput.focus?.();
        return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
        setValidationMessage([`${BUDGET_CATEGORY_CONFIG[category].itemLabel} amount must be zero or positive.`]);
        amountInput.focus?.();
        return;
    }

    const previousSettings = beginBudgetMutation();
    ensureBudgetSettings()[category].push({
        id: null,
        name,
        amount,
        cadence: normalizeCadence(cadenceInput?.value),
        ...(category === 'savings' ? { assetId: null } : {})
    });
    nameInput.value = '';
    amountInput.value = '';
    if (cadenceInput) cadenceInput.value = 'monthly';
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget item added',
        message: `${name} was added to your budget.`
    }, previousSettings);
}

function removeBudgetItem(category, reference) {
    if (!BUDGET_CATEGORIES.includes(category)) return;
    const item = resolveBudgetItem(category, reference);
    if (!item) return;
    // resolveBudgetItem normalises the current category and may replace the
    // array with its normalised copy. Read the live array after that lookup so
    // the selected object can be removed by identity.
    const items = store.state.budgetSettings[category];
    const previousSettings = beginBudgetMutation();
    const itemIndex = items.indexOf(item);
    if (itemIndex >= 0) items.splice(itemIndex, 1);
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget item removed',
        message: 'The budget item was removed successfully.'
    }, previousSettings);
}

function budgetAssetPickerState(picker) {
    const index = picker?.dataset?.budgetSavingAssetPicker;
    const itemId = picker?.dataset?.budgetItemId;
    const typeahead = getAssetTypeaheadState(picker);
    return {
        index,
        itemId,
        assetId: typeahead.value?.value || picker?.querySelector?.(`[data-budget-saving-asset="${index}"]`)?.value || '',
        search: typeahead.search || picker?.querySelector?.(`[data-budget-saving-asset-search="${index}"]`),
        options: typeahead.options || picker?.querySelector?.(`[data-budget-saving-asset-options="${index}"]`)
    };
}

function chooseBudgetAsset(picker, assetId) {
    const state = budgetAssetPickerState(picker);
    updateBudgetSavingAsset(state.itemId || state.index, assetId || '');
}

function updateBudgetSavingAsset(reference, assetId) {
    const saving = resolveBudgetItem('savings', reference);
    if (!saving) return;
    const previousSettings = beginBudgetMutation();
    saving.assetId = assetId || null;
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget saving updated',
        message: 'The saving destination was updated successfully.'
    }, previousSettings);
}

function updateBudgetSavingCadence(reference, cadence) {
    const saving = resolveBudgetItem('savings', reference);
    if (!saving) return;
    const previousSettings = beginBudgetMutation();
    saving.cadence = normalizeCadence(cadence);
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget saving updated',
        message: 'The saving cadence was updated successfully.'
    }, previousSettings);
}

export function populateBudgetSettings() {
    loadBudgetView();
}

export function setupBudgetSettings() {
    renderBudgetEnabledToggle();
    renderBudgetEntryForms();
    bindBudgetPlanInteractions();
    const form = document.getElementById('budget-settings-form');
    const enabledToggle = document.getElementById('budget-setting-enabled');

    if (enabledToggle && enabledToggle.dataset.budgetToggleInit !== 'true') {
        enabledToggle.dataset.budgetToggleInit = 'true';
        enabledToggle.addEventListener('change', async event => {
            const saved = await setFeatureEnabled('budget', event.target.checked);
            if (!saved) {
                event.target.checked = isFeatureEnabled('budget');
            }
            loadBudgetView();
        });
    }

    if (!form || form.dataset.budgetSettingsInit === 'true') {
        loadBudgetView();
        return;
    }
    form.dataset.budgetSettingsInit = 'true';
    setupAssetTypeahead(form, {
        emptyChoiceLabel: 'Unallocated',
        onChoose: chooseBudgetAsset
    });

    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('input', event => {
        const input = event.target?.closest?.('[data-budget-field]');
        if (input) handleBudgetFieldChange(input);
    });
    form.addEventListener('change', event => {
        const input = event.target?.closest?.('[data-budget-field]');
        if (input?.dataset?.budgetField === 'cadence') handleBudgetFieldChange(input);
    });
    form.addEventListener('click', event => {
        const addButton = event.target?.closest?.('[data-budget-add]');
        if (addButton) {
            event.preventDefault();
            addBudgetItem(addButton.dataset.budgetAdd);
            return;
        }
        const removeButton = event.target?.closest?.('[data-budget-remove]');
        if (removeButton) {
            event.preventDefault();
            removeBudgetItem(removeButton.dataset.budgetRemove, removeButton.dataset.budgetItemId || removeButton.dataset.budgetIndex);
        }
    });

    loadBudgetView();
}

function scheduleBudgetSave(context = null, previousSettings = null) {
    if (context) budgetSaveContext = context;
    if (previousSettings && budgetSaveSnapshot === null) budgetSaveSnapshot = previousSettings;
    clearTimeout(budgetSaveTimer);
    budgetSaveTimer = setTimeout(async () => {
        budgetSaveTimer = null;
        const saveSnapshot = budgetSaveSnapshot;
        budgetSaveSnapshot = null;
        const saveContext = budgetSaveContext || {
            title: 'Budget settings saved',
            message: 'Your budget settings were saved successfully.'
        };
        budgetSaveContext = null;

        const errors = getBudgetValidationErrors(store.state.budgetSettings);
        if (errors.length) {
            setValidationMessage(errors);
            return;
        }

        if (!await saveDbSettings('wealthWatcherBudgetSettings', store.state.budgetSettings)) {
            if (saveSnapshot) store.state.budgetSettings = saveSnapshot;
            populateBudgetSettings();
            showToast({
                title: 'Unable to save budget',
                message: 'Your budget changes could not be saved. The last saved plan was restored.',
                type: 'error',
                key: 'budget-settings'
            });
            return;
        }
        if (hasPendingBudgetLines(store.state.budgetSettings)) {
            try {
                const settingsResponse = await fetchFreshStrict(`${API_BASE_URL}/settings`);
                const serializedBudget = settingsResponse?.wealthWatcherBudgetSettings;
                const refreshedBudget = typeof serializedBudget === 'string'
                    ? JSON.parse(serializedBudget)
                    : serializedBudget;
                if (refreshedBudget && typeof refreshedBudget === 'object' && !Array.isArray(refreshedBudget)) {
                    store.state.budgetSettings = refreshedBudget;
                }
            } catch (error) {
                console.error('Budget settings saved, but the refreshed budget IDs could not be loaded.', error);
            }
        }
        store.clearCache();
        globalThis.refreshDashboardFireStatus?.();
        showToast({ ...saveContext, type: 'success', key: 'budget-settings' });
    }, 300);
}

window.updateBudgetSavingAsset = (reference, assetId) => updateBudgetSavingAsset(reference, assetId);
window.updateBudgetSavingCadence = (reference, cadence) => updateBudgetSavingCadence(reference, cadence);

window.addBudgetIncome = () => addBudgetItem('income');
window.removeBudgetIncome = reference => removeBudgetItem('income', reference);
window.addBudgetBills = () => addBudgetItem('bills');
window.removeBudgetBill = reference => removeBudgetItem('bills', reference);
window.addBudgetSavings = () => addBudgetItem('savings');
window.removeBudgetSaving = reference => removeBudgetItem('savings', reference);
window.addBudgetSpend = () => addBudgetItem('spend');
window.removeBudgetSpend = reference => removeBudgetItem('spend', reference);
