import { store } from '../store/store.js';
import { API_BASE_URL, fetchFreshStrict, saveDbSettings } from '../api/apiClient.js';
import { formatter } from '../utils/formatters.js';
import { showToast } from '../components/Toast.js';
import { requestConfirmation } from '../components/ConfirmationModal.js';
import { PAGE_STATUS, setPageStatus } from '../components/PageState.js';
import { renderAccessibleChartData } from '../components/AccessibleChartData.js';
import {
    closeAssetTypeaheads,
    getAssetTypeaheadState,
    renderAssetTypeahead,
    setupAssetTypeahead
} from '../components/AssetTypeahead.js';
import {
    renderCatalogInputField,
    renderCurrencyInputField,
    renderSelectField
} from '../components/FormFields.js';
import {
    closeFormFlyout,
    initFormFlyout,
    openFormFlyout
} from '../components/FormFlyout.js';
import { escapeHtml, safeCssColor } from '../utils/html.js';
import {
    BUDGET_CATEGORIES,
    BUDGET_CATEGORY_CONFIG,
    BUDGET_GROUP_COLORS,
    getBudgetGroupColorSuggestion,
    getBudgetGroupTotal,
    getBudgetGroups,
    getBudgetItemCategory,
    getRealBudgetItemCategory,
    isIncomeBudgetGroup,
    normalizeBudgetSettings,
    UNCATEGORISED_LABEL
} from './budgetConfig.js';
import { createBudgetFlowModel, renderBudgetFlow } from './BudgetFlow.js';
import { renderBudgetV2Flow } from './BudgetV2Flow.js';

let budgetChartInstance = null;
let budgetSaveTimer;
let budgetSaveContext = null;
let budgetSaveSnapshot = null;
let budgetSettingsBound = false;
let budgetBoundForm = null;
let budgetStorageMode = 'v2';
let legacyFlowSelection = null;
let collapsedBudgetGroupIds = new Set();
let renderedBudgetGroupIds = new Set();
let budgetLineEditorState = null;
let budgetGroupEditorState = null;

const BUDGET_SETTINGS_KEY = 'wealthWatcherBudgetSettings';
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

const BUDGET_COLORS = Object.freeze([
    '#ef4444', '#f97316', '#ec4899', '#f59e0b', '#f43f5e',
    '#10b981', '#14b8a6', '#84cc16', '#06b6d4', '#22c55e',
    '#8b5cf6', '#3b82f6', '#d946ef', '#6366f1', '#0ea5e9'
]);

let currentChartView = { level: 'overview', groupId: null, category: null };

function cloneBudgetSettings(settings) {
    if (settings === undefined || settings === null) return {};
    try {
        return JSON.parse(JSON.stringify(settings));
    } catch {
        return {};
    }
}

export function getMonthlyBudgetAmount(item) {
    const amount = Number.parseFloat(String(item?.amount ?? '').replace(/,/g, ''));
    if (!Number.isFinite(amount)) return 0;

    const cadence = String(item?.cadence || 'monthly').trim().toLowerCase();
    const months = BUDGET_CADENCE_MONTHS[cadence] || 1;
    return amount / months;
}

export function getMonthlyBudgetTotals(budgetSettings = {}) {
    const groups = getBudgetGroups(budgetSettings);
    const groupTotals = Object.fromEntries(groups.map(group => [group.id, getBudgetGroupTotal(group, getMonthlyBudgetAmount)]));
    const incomeGroup = groups.find(isIncomeBudgetGroup);
    const income = incomeGroup ? groupTotals[incomeGroup.id] || 0 : 0;
    const customGroups = groups.filter(group => !isIncomeBudgetGroup(group));
    const allocated = customGroups.reduce((total, group) => total + (groupTotals[group.id] || 0), 0);
    const byLegacyId = id => {
        const group = groups.find(candidate => candidate.id === id);
        return group ? groupTotals[group.id] || 0 : 0;
    };

    const totals = {
        income,
        bills: byLegacyId('bills'),
        savings: byLegacyId('savings'),
        spend: byLegacyId('spend'),
        unallocated: income - allocated,
    };
    // Keep the historic enumerable shape for callers which compare the
    // summary object directly, while exposing the richer v2 data to the new
    // flow/editor without breaking those callers.
    Object.defineProperties(totals, {
        allocated: { value: allocated, enumerable: false },
        groupTotals: { value: groupTotals, enumerable: false },
        groups: { value: groups, enumerable: false }
    });
    return totals;
}

function createBudgetId(prefix = 'budget-item') {
    return globalThis.crypto?.randomUUID?.()
        || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isLegacyBudgetHost() {
    return !document.getElementById('budget-groups-editor');
}

function normalizeLegacyHostSettings(settings = {}) {
    const normalized = { ...settings };
    BUDGET_CATEGORIES.forEach(category => {
        normalized[category] = (Array.isArray(settings?.[category]) ? settings[category] : []).map(item => ({
            ...item,
            id: Object.prototype.hasOwnProperty.call(item || {}, 'id') ? item.id : null,
            name: String(item?.name || '').trim(),
            amount: Number.parseFloat(String(item?.amount ?? 0).replace(/,/g, '')) || 0,
            cadence: item?.cadence || 'monthly',
            assetId: item?.assetId || null
        }));
    });
    return normalized;
}

function ensureBudgetSettings() {
    const source = store.state.budgetSettings || {};
    // The old table-only host is still used by embedded pages and older
    // consumers. Preserve its array contract there so legacy handlers keep
    // working, while the current settings pane always receives v2 groups.
    if (isLegacyBudgetHost() && !Array.isArray(source.groups)) {
        budgetStorageMode = 'legacy';
        const legacySettings = normalizeLegacyHostSettings(source);
        store.state.budgetSettings = legacySettings;
        return legacySettings;
    }

    budgetStorageMode = 'v2';
    const normalized = normalizeBudgetSettings(source);
    store.state.budgetSettings = normalized;
    return normalized;
}

function getBudgetGroup(groupId, settings = ensureBudgetSettings()) {
    return Array.isArray(settings?.groups)
        ? settings.groups.find(group => String(group.id) === String(groupId)) || null
        : null;
}

function getBudgetGroupByLegacyCategory(category, settings = ensureBudgetSettings()) {
    const normalizedCategory = String(category || '').trim().toLowerCase();
    if (Array.isArray(settings?.groups)) {
        return settings.groups.find(group => String(group.id).toLowerCase() === normalizedCategory)
            || settings.groups.find(group => group.name.toLowerCase() === normalizedCategory)
            || null;
    }
    if (BUDGET_CATEGORIES.includes(normalizedCategory)) {
        return {
            id: normalizedCategory,
            name: BUDGET_CATEGORY_CONFIG[normalizedCategory].label,
            items: Array.isArray(settings[normalizedCategory]) ? settings[normalizedCategory] : [],
            builtIn: normalizedCategory === 'income',
            kind: normalizedCategory === 'income' ? 'income' : 'custom',
            role: normalizedCategory === 'income' ? 'income' : 'custom'
        };
    }
    return null;
}

function getBudgetItem(groupId, itemId, settings = ensureBudgetSettings()) {
    const group = getBudgetGroup(groupId, settings);
    return group?.items.find(item => String(item.id) === String(itemId)) || null;
}

function getBudgetGroupColor(group, index = 0) {
    return safeCssColor(group?.color, BUDGET_GROUP_COLORS[index % BUDGET_GROUP_COLORS.length]);
}

function renderBudgetEntryForms() {
    // Older host pages can still supply the four legacy entry mounts. Keep
    // these rendered as a compatibility fallback; the current page uses the
    // group editor below instead.
    BUDGET_CATEGORIES.forEach(category => {
        const config = BUDGET_CATEGORY_CONFIG[category];
        const targetId = `budget-entry-${category}`;
        const nameId = `new-${category}-name`;
        const amountId = `new-${category}-amount`;
        const buttonId = `btn-add-budget-${category}`;
        const target = document.getElementById(targetId);
        if (!target || target.dataset.rendered === 'true') return;
        target.innerHTML = `
            <div class="add-item-row budget-entry-row">
                ${renderCatalogInputField({ id: nameId, label: 'Name', placeholder: config.namePlaceholder })}
                ${renderCurrencyInputField({ id: amountId, label: 'Amount (£)', placeholder: '0.00' })}
                <button class="action-btn catalog-add-button" type="button" id="${buttonId}" data-budget-add="${config.action}">Add ${escapeHtml(config.itemLabel)}</button>
            </div>`;
        target.dataset.rendered = 'true';
    });
}

function setCurrentChartView(viewMode) {
    if (!viewMode || viewMode === 'overview') {
        currentChartView = { level: 'overview', groupId: null, category: null };
        return;
    }

    if (typeof viewMode === 'object') {
        const groupId = String(viewMode.groupId || '');
        currentChartView = viewMode.category
            ? { level: 'item', groupId, category: String(viewMode.category) }
            : { level: 'group', groupId, category: null };
        return;
    }

    const settings = ensureBudgetSettings();
    const group = settings.groups.find(candidate =>
        String(candidate.id).toLowerCase() === String(viewMode).toLowerCase()
        || candidate.name.toLowerCase() === String(viewMode).toLowerCase());
    currentChartView = group
        ? { level: 'group', groupId: group.id, category: null }
        : { level: 'overview', groupId: null, category: null };
}

function getLegacyFlowBreakdowns(settings) {
    const groups = getBudgetGroups(settings);
    return Object.fromEntries(BUDGET_CATEGORIES.map(category => {
        const group = groups.find(candidate => candidate.id === category);
        return [category, (group?.items || []).map(item => ({
            ...item,
            assetName: getSelectedAssetName(item.assetId)
        }))];
    }));
}

function renderLegacyBudgetFlow(target, settings, totals) {
    if (!target) return;
    const model = createBudgetFlowModel(totals, getLegacyFlowBreakdowns(settings));
    renderBudgetFlow(target, model, {
        formatter: value => formatter.format(value),
        obfuscated: globalThis.window?.isObfuscated === true,
        selectedCategory: legacyFlowSelection
    });

    if (target.dataset.bound === 'true') return;
    target.dataset.bound = 'true';
    const handleActivation = event => {
        const control = event.target?.closest?.('[data-budget-flow-focus],[data-budget-flow-clear]');
        if (!control) return;
        if (control.dataset.budgetFlowClear !== undefined) legacyFlowSelection = null;
        else if (control.dataset.budgetFlowFocus) legacyFlowSelection = control.dataset.budgetFlowFocus;
        renderLegacyBudgetFlow(target, ensureBudgetSettings(), getMonthlyBudgetTotals(store.state.budgetSettings));
    };
    target.addEventListener?.('click', handleActivation);
    target.addEventListener?.('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') handleActivation(event);
    });
}

window.loadBudgetOverview = () => loadBudgetView('overview');

export function loadBudgetView(viewMode = null) {
    if (viewMode !== null) setCurrentChartView(viewMode);

    const budgetSettings = ensureBudgetSettings();
    const hasBudgetData = hasConfiguredBudgetData(budgetSettings);
    if (!hasBudgetData) {
        renderBudgetOverBudgetAlert({ unallocated: 0 });
        setPageStatus('budget-view', PAGE_STATUS.EMPTY);
        clearBudgetReadyState();
        renderBudgetEmptyState();
        return;
    }

    setPageStatus('budget-view', PAGE_STATUS.READY);
    showBudgetReadyState();
    const totals = getMonthlyBudgetTotals(budgetSettings);
    renderBudgetOverBudgetAlert(totals);

    // Preserve the existing SVG flow mount for older host fragments and its
    // keyboard/mobile interaction contract. The current page uses the richer
    // group/category/item view below when its v2 canvas mount is present.
    const legacyFlowTarget = document.getElementById('budget-flow-renderer');
    if (legacyFlowTarget && !Array.isArray(budgetSettings.groups)) {
        renderLegacyBudgetFlow(legacyFlowTarget, budgetSettings, totals);
        return;
    }

    const flow = getBudgetFlowData(budgetSettings, currentChartView, totals);
    const v2FlowTarget = document.getElementById('budget-flow-renderer');
    if (v2FlowTarget && Array.isArray(budgetSettings.groups)) {
        renderBudgetV2Flow(v2FlowTarget, {
            ...flow,
            view: currentChartView
        }, {
            formatter: value => formatter.format(value),
            obfuscated: globalThis.window?.isObfuscated === true,
            onNavigate: action => {
                if (action.type === 'all' || action.type === 'overview') return loadBudgetView('overview');
                if (action.type === 'back') return loadBudgetView({ groupId: currentChartView.groupId });
                if (action.type === 'navigation') {
                    if (action.navigation === 'all') return loadBudgetView('overview');
                    if (action.navigation === 'back') return loadBudgetView({ groupId: currentChartView.groupId });
                }
                if (action.type === 'group') return loadBudgetView({ groupId: action.groupId });
                if (action.type === 'category') return loadBudgetView({ groupId: action.groupId, category: action.category });
            }
        });
        return;
    }

    const canvas = document.getElementById('budgetChart');
    renderBudgetDrilldownControls(flow);
    renderBudgetFlowList(flow);
    renderAccessibleChartData(document.getElementById('budget-chart-data'), {
        summary: flow.summary,
        caption: flow.caption,
        headers: [{ key: 'label', label: 'Budget level' }, { key: 'value', label: 'Monthly amount' }],
        rows: flow.rows,
        formatCell: (row, key) => key === 'value'
            ? (globalThis.window?.isObfuscated ? '£***' : formatter.format(row.value))
            : row[key]
    });
    canvas?.setAttribute?.('aria-label', `${flow.summary} chart`);

    if (!canvas || typeof globalThis.Chart !== 'function') return;
    budgetChartInstance?.destroy?.();

    const chartPlugins = globalThis.window?.ChartDataLabels ? [globalThis.window.ChartDataLabels] : [];
    budgetChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: flow.rows.map(row => row.label),
            datasets: [{
                data: flow.rows.map(row => row.value),
                backgroundColor: flow.rows.map((row, index) => row.color || BUDGET_COLORS[index % BUDGET_COLORS.length]),
                borderWidth: 1,
                borderColor: 'rgba(0, 0, 0, 0.5)',
                hoverOffset: 4
            }]
        },
        plugins: chartPlugins,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (_event, elements) => {
                const index = elements?.[0]?.index;
                const action = Number.isInteger(index) ? flow.rows[index]?.action : null;
                if (action?.type === 'group') loadBudgetView({ groupId: action.groupId });
                if (action?.type === 'category') loadBudgetView({ groupId: action.groupId, category: action.category });
            },
            plugins: {
                legend: { position: 'right', labels: { color: '#a0aec0', padding: 20 } },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 12 },
                    formatter: (value, context) => {
                        const data = context.chart.data.datasets[0].data;
                        const total = data.reduce((sum, entry) => sum + (Number(entry) || 0), 0);
                        if (!total || (value * 100 / total) <= 4) return null;
                        return `${(value * 100 / total).toFixed(0)}%`;
                    }
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const amount = Number(context.parsed) || 0;
                            const data = context.chart.data.datasets[0].data;
                            const total = data.reduce((sum, entry) => sum + (Number(entry) || 0), 0);
                            const percentage = total ? ` (${(amount * 100 / total).toFixed(1)}%)` : '';
                            const hint = flow.rows[context.dataIndex]?.action ? ' · Select to drill down' : '';
                            return `${context.label || ''}: ${formatter.format(amount)}${percentage}${hint}`;
                        }
                    }
                }
            },
            cutout: '60%',
            onHover: (event, elements) => {
                if (event?.native?.target) event.native.target.style.cursor = elements?.length ? 'pointer' : 'default';
            }
        }
    });
}

function hasConfiguredBudgetData(budgetSettings) {
    if (Array.isArray(budgetSettings?.groups)) return budgetSettings.groups.some(group => group.items.length > 0);
    return BUDGET_CATEGORIES.some(category => Array.isArray(budgetSettings?.[category]) && budgetSettings[category].length > 0);
}

function refreshBudgetViewAfterSettingsChange(settings = ensureBudgetSettings()) {
    if (!document.getElementById('budget-flow-renderer')) return;

    const selectedGroup = currentChartView.groupId
        ? getBudgetGroup(currentChartView.groupId, settings)
        : null;
    if (currentChartView.level !== 'overview' && !selectedGroup) {
        loadBudgetView('overview');
        return;
    }

    if (currentChartView.level === 'item' && selectedGroup && (
        !getRealBudgetItemCategory({ category: currentChartView.category })
        || !selectedGroup.items.some(item => getRealBudgetItemCategory(item) === currentChartView.category)
    )) {
        loadBudgetView({ groupId: selectedGroup.id });
        return;
    }

    loadBudgetView();
}

function showBudgetReadyState() {
    const emptyState = document.getElementById('budget-empty-state');
    if (emptyState) emptyState.hidden = true;
    const overviewContent = document.getElementById('budget-overview-content');
    if (overviewContent) overviewContent.hidden = false;
}

function clearBudgetReadyState() {
    budgetChartInstance?.destroy?.();
    budgetChartInstance = null;
    currentChartView = { level: 'overview', groupId: null, category: null };
    renderBudgetOverBudgetAlert({ unallocated: 0 });

    const overviewContent = document.getElementById('budget-overview-content');
    if (overviewContent) overviewContent.hidden = true;
    ['budget-total-income', 'budget-total-bills', 'budget-total-savings', 'budget-total-spend', 'budget-unallocated']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.innerText = '';
                if (element.style) element.style.color = '';
            }
        });
    document.querySelectorAll?.('[data-budget-summary-group]')?.forEach(element => {
        element.hidden = true;
    });
    const backButton = document.getElementById('budget-chart-back-btn');
    if (backButton) backButton.hidden = true;
    const chart = document.getElementById('budgetChart');
    if (chart && 'innerHTML' in chart) chart.innerHTML = '';
    const legacyFlow = document.getElementById('budget-flow-renderer');
    if (legacyFlow) {
        legacyFlow.innerHTML = '';
        legacyFlow.dataset.flowState = '';
        legacyFlow.dataset.bound = '';
    }
    const drilldowns = document.getElementById('budget-chart-drilldowns');
    if (drilldowns) drilldowns.innerHTML = '';
    const flowList = document.getElementById('budget-flow-list');
    if (flowList) flowList.innerHTML = '';
    renderAccessibleChartData(document.getElementById('budget-chart-data'), {
        headers: [{ key: 'label', label: 'Budget level' }, { key: 'value', label: 'Monthly amount' }],
        rows: []
    });
}

function renderBudgetOverBudgetAlert(totals = {}) {
    const alert = document.getElementById('budget-over-budget-alert');
    if (!alert) return;

    const unallocated = Number(totals.unallocated);
    const overBudget = Number.isFinite(unallocated) && unallocated < 0;
    alert.hidden = !overBudget;
    if (!overBudget) return;

    const message = document.getElementById('budget-over-budget-alert-message');
    if (message) message.textContent = `You've allocated ${formatter.format(Math.abs(unallocated))} more than your monthly income. Adjust a group or line item to bring the plan back within budget.`;
}

function renderBudgetSummary(totals) {
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.innerText = formatter.format(value);
    };
    setText('budget-total-income', totals.income);
    setText('budget-total-bills', totals.bills);
    setText('budget-total-savings', totals.savings);
    setText('budget-total-spend', totals.spend);
    const unallocated = document.getElementById('budget-unallocated');
    if (unallocated) {
        unallocated.innerText = formatter.format(totals.unallocated);
        unallocated.style.color = totals.unallocated < 0 ? '#ef4444' : '#ffffff';
    }

    const legacyIds = new Set(['bills', 'savings', 'spend']);
    document.querySelectorAll?.('[data-budget-summary-group]')?.forEach(card => {
        const groupId = card.dataset.budgetSummaryGroup;
        const group = totals.groups.find(candidate => candidate.id === groupId);
        card.hidden = !group;
        const label = card.querySelector?.('[data-budget-summary-label]');
        const value = card.querySelector?.('[data-budget-summary-value]');
        if (group) {
            if (label) label.textContent = group.name;
            if (value) value.textContent = formatter.format(totals.groupTotals[group.id] || 0);
        }
    });

    const customSummary = document.getElementById('budget-custom-summary');
    if (customSummary) {
        const extraGroups = totals.groups.filter(group => !isIncomeBudgetGroup(group) && !legacyIds.has(group.id));
        customSummary.innerHTML = extraGroups.map((group, index) => `
            <article class="card glass-panel budget-summary-card" data-budget-summary-group="${escapeHtml(group.id)}">
                <span class="budget-summary-label" data-budget-summary-label>${escapeHtml(group.name)}</span>
                <h2 class="obfuscate-val" data-budget-summary-value style="color: ${safeCssColor(getBudgetGroupColor(group, index + 1))}">${escapeHtml(formatter.format(totals.groupTotals[group.id] || 0))}</h2>
            </article>`).join('');
    }
}

function getBudgetFlowData(settings, view, totals) {
    if (view.level === 'overview') {
        const incomeGroup = settings.groups.find(isIncomeBudgetGroup);
        const rows = settings.groups
            .filter(group => !isIncomeBudgetGroup(group))
            .map((group, index) => ({
                label: group.name,
                value: totals.groupTotals[group.id] || 0,
                color: getBudgetGroupColor(group, index + 1),
                action: { type: 'group', groupId: group.id }
            }))
            .filter(row => row.value > 0 || settings.groups.some(group => group.name === row.label && group.items.length > 0));
        if (totals.unallocated > 0) rows.push({
            label: 'Unallocated (Remaining)',
            value: totals.unallocated,
            color: 'rgba(255, 255, 255, 0.24)',
            action: null
        });
        return {
            rows,
            source: { label: incomeGroup?.name || 'Income', value: totals.income, color: getBudgetGroupColor(incomeGroup) },
            sourceAction: null,
            summary: 'Budget groups',
            caption: 'Select a group to see its categories, then select a category to see its line items.'
        };
    }

    const group = getBudgetGroup(view.groupId, settings);
    if (!group) {
        currentChartView = { level: 'overview', groupId: null, category: null };
        return getBudgetFlowData(settings, currentChartView, totals);
    }

    if (view.level === 'group') {
        const categories = new Map();
        const uncategorisedItems = [];
        group.items.forEach(item => {
            const category = getRealBudgetItemCategory(item);
            if (!category) {
                uncategorisedItems.push(item);
                return;
            }
            categories.set(category, (categories.get(category) || 0) + getMonthlyBudgetAmount(item));
        });
        const groupColor = getBudgetGroupColor(group);
        const categoryRows = Array.from(categories.entries()).map(([category, value]) => ({
            label: category,
            value,
            color: groupColor,
            action: { type: 'category', groupId: group.id, category }
        }));
        const uncategorisedRows = uncategorisedItems.map(item => ({
            label: item.name,
            value: getMonthlyBudgetAmount(item),
            color: groupColor,
            action: null
        }));
        const hasCategories = categoryRows.length > 0;
        const hasUncategorisedItems = uncategorisedRows.length > 0;
        return {
            rows: [...categoryRows, ...uncategorisedRows],
            source: { label: group.name, value: totals.groupTotals[group.id] || 0, color: groupColor },
            sourceAction: {
                type: 'navigation',
                navigation: 'all',
                ariaLabel: 'Back to all budget groups'
            },
            groupName: group.name,
            summary: `${group.name} ${hasCategories ? 'categories' : 'items'}`,
            caption: hasCategories && hasUncategorisedItems
                ? 'Select a category to see its line items. Items without a category are shown directly.'
                : hasCategories
                    ? 'Select a category to see the line items assigned to it.'
                    : 'Line items without a category are shown directly.'
        };
    }

    const category = getRealBudgetItemCategory({ category: view.category });
    if (!category) {
        currentChartView = { level: 'group', groupId: group.id, category: null };
        return getBudgetFlowData(settings, currentChartView, totals);
    }
    const items = group.items.filter(item => getRealBudgetItemCategory(item) === category);
    return {
        rows: items.map(item => ({
            label: item.name,
            value: getMonthlyBudgetAmount(item),
            color: getBudgetGroupColor(group),
            action: null
        })),
        source: {
            label: `${group.name} · ${category}`,
            value: items.reduce((total, item) => total + getMonthlyBudgetAmount(item), 0),
            color: getBudgetGroupColor(group)
        },
        sourceAction: {
            type: 'navigation',
            navigation: 'back',
            ariaLabel: `Back to ${group.name} categories`
        },
        groupName: group.name,
        summary: `${group.name} · ${category}`,
        caption: 'Line items assigned to this category.'
    };
}

function renderBudgetDrilldownControls(flow) {
    const target = document.getElementById('budget-chart-drilldowns');
    if (!target) return;
    if (target.dataset.bound !== 'true') {
        target.dataset.bound = 'true';
        target.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-budget-view-action]');
            if (!button) return;
            if (button.dataset.budgetViewAction === 'overview') return loadBudgetView('overview');
            if (button.dataset.budgetViewAction === 'group') return loadBudgetView({ groupId: button.dataset.budgetGroup });
            if (button.dataset.budgetViewAction === 'category') {
                return loadBudgetView({
                    groupId: button.dataset.budgetGroup,
                    category: button.dataset.budgetCategory
                });
            }
        });
    }

    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(currentChartView.groupId, settings);
    const buttons = [];
    if (currentChartView.level !== 'overview') {
        buttons.push('<button type="button" class="action-btn budget-drilldown-button" data-budget-view-action="overview">&larr; All groups</button>');
        if (currentChartView.level === 'item' && group) {
            buttons.push(`<button type="button" class="action-btn budget-drilldown-button" data-budget-view-action="group" data-budget-group="${escapeHtml(group.id)}">&larr; ${escapeHtml(group.name)} categories</button>`);
        }
    }
    if (currentChartView.level === 'overview') {
        buttons.push('<span class="budget-flow-hint">Select a group to drill into categories</span>');
    } else if (group) {
        buttons.push(`<span class="budget-flow-breadcrumb" aria-current="step">${escapeHtml(group.name)}${currentChartView.level === 'item' ? ` · ${escapeHtml(currentChartView.category)}` : ''}</span>`);
    }
    target.innerHTML = buttons.join('');
    target.hidden = buttons.length === 0;

    const backButton = document.getElementById('budget-chart-back-btn');
    if (backButton) {
        backButton.hidden = currentChartView.level === 'overview';
        backButton.onclick = () => {
            if (currentChartView.level === 'item') loadBudgetView({ groupId: currentChartView.groupId });
            else loadBudgetView('overview');
        };
    }
    void flow;
}

function renderBudgetFlowList(flow) {
    const target = document.getElementById('budget-flow-list');
    if (!target) return;
    target.innerHTML = flow.rows.length
        ? flow.rows.map(row => {
            const action = row.action;
            const attributes = action?.type === 'group'
                ? `data-budget-flow-action="group" data-budget-group="${escapeHtml(action.groupId)}"`
                : action?.type === 'category'
                    ? `data-budget-flow-action="category" data-budget-group="${escapeHtml(action.groupId)}" data-budget-category="${escapeHtml(action.category)}"`
                    : '';
            const control = attributes
                ? `<button type="button" class="budget-flow-list-button" ${attributes}><span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatter.format(row.value))}</strong></button>`
                : `<div class="budget-flow-list-row"><span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatter.format(row.value))}</strong></div>`;
            return `<li>${control}</li>`;
        }).join('')
        : '<li class="budget-flow-list-empty">No amounts at this level.</li>';
    if (target.dataset.bound === 'true') return;
    target.dataset.bound = 'true';
    target.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-budget-flow-action]');
        if (!button) return;
        if (button.dataset.budgetFlowAction === 'group') loadBudgetView({ groupId: button.dataset.budgetGroup });
        if (button.dataset.budgetFlowAction === 'category') loadBudgetView({
            groupId: button.dataset.budgetGroup,
            category: button.dataset.budgetCategory
        });
    });
}

function renderBudgetEmptyState() {
    const view = document.getElementById('budget-view');
    if (!view) return;

    let emptyState = document.getElementById('budget-empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'budget-empty-state';
        emptyState.className = 'catalog-workspace presentation-empty-state budget-empty-state budget-page-state';
        emptyState.setAttribute?.('role', 'status');
        emptyState.innerHTML = `
            <div class="presentation-empty-state-layout">
                <div class="presentation-empty-copy">
                    <span class="presentation-empty-kicker">Monthly allocation</span>
                    <h2>Give every pound a clear job.</h2>
                    <p>No budget data yet. Add income, bills, savings and spending below or in Settings, then use the budget flow to see each group, category and item.</p>
                    <p class="presentation-empty-note">Your groups stay editable whenever you need them, with no separate editing mode to unlock.</p>
                    <a class="action-btn" href="#budget-settings-pane" aria-controls="budget-settings-pane">Open Budget Settings</a>
                </div>
                <div class="presentation-preview budget-preview" role="img" aria-label="Illustrative example of a configured budget flow">
                    <div class="presentation-preview-header"><div><span class="presentation-preview-label">Illustrative example</span><strong>Budget flow</strong></div><span class="presentation-preview-status">Group · category · item</span></div>
                    <div class="budget-preview-summary"><div class="budget-preview-stat budget-preview-stat-income"><span>Income</span><strong>£4,800</strong></div><div class="budget-preview-stat"><span>Bills</span><strong>£1,820</strong></div><div class="budget-preview-stat"><span>Remaining</span><strong>£1,800</strong></div></div>
                    <div class="budget-preview-breakdown"><div class="budget-preview-ring" aria-hidden="true"><span>62%<small>allocated</small></span></div><div class="budget-preview-lines" aria-hidden="true"><div><span><i class="preview-dot preview-dot-bills"></i>Bills</span><strong>£1,820</strong></div><div><span><i class="preview-dot preview-dot-savings"></i>Savings</span><strong>£720</strong></div><div><span><i class="preview-dot preview-dot-spend"></i>Spend</span><strong>£460</strong></div><div class="budget-preview-remaining"><span>Remaining</span><strong>£1,800</strong></div></div></div>
                </div>
            </div>`;
        const header = view.querySelector?.(':scope > header') || view.querySelector?.('header');
        if (header && typeof view.insertBefore === 'function') view.insertBefore(emptyState, header.nextElementSibling || null);
        else if (typeof view.prepend === 'function') view.prepend(emptyState);
        else view.appendChild?.(emptyState);
    }
    emptyState.hidden = false;
}

export function populateBudgetSettings() {
    renderBudgetEntryForms();
    const budgetSettings = ensureBudgetSettings();
    const form = document.getElementById('budget-settings-form');
    if (form) closeAssetTypeaheads(form);

    const editor = document.getElementById('budget-groups-editor');
    if (editor) {
        renderBudgetMigrationNote(budgetSettings);
        renderBudgetGroups(budgetSettings);
        return;
    }

    // Compatibility rendering for earlier host markup and tests.
    renderBudgetTable('budget-income-tbody', getBudgetGroupByLegacyCategory('income', budgetSettings)?.items || [], '#06b6d4', 'income');
    renderBudgetTable('budget-bills-tbody', getBudgetGroupByLegacyCategory('bills', budgetSettings)?.items || [], '#ef4444', 'bills');
    renderBudgetTable('budget-savings-tbody', getBudgetGroupByLegacyCategory('savings', budgetSettings)?.items || [], '#10b981', 'savings');
    renderBudgetTable('budget-spend-tbody', getBudgetGroupByLegacyCategory('spend', budgetSettings)?.items || [], '#8b5cf6', 'spend');
}

function renderBudgetMigrationNote(settings) {
    const note = document.getElementById('budget-migration-note');
    if (!note) return;
    note.hidden = settings.needsUpdate !== true;
    note.textContent = settings.needsUpdate === true
        ? 'This budget uses your historic layout. You can keep editing it now; saving will update it to the new group format.'
        : '';
}

function safeBudgetId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getSelectedAssetName(assetId) {
    const asset = (store.state.assets || []).find(candidate => String(candidate.Id ?? candidate.id) === String(assetId || ''));
    return asset?.DisplayName || asset?.Name || '';
}

function getBudgetCategoryOptions(settings = ensureBudgetSettings()) {
    const seen = new Set();
    return (settings?.groups || [])
        .flatMap(group => Array.isArray(group.items) ? group.items : [])
        .map(item => getRealBudgetItemCategory(item))
        .filter(category => {
            const key = category.toLowerCase();
            if (!category || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(category => ({ Id: category, DisplayName: category }));
}

function isSavingsBudgetGroup(group) {
    return group.id.toLowerCase() === 'savings' || group.name.toLowerCase().includes('saving');
}

function renderBudgetItemAsset(item, group) {
    const key = `${group.id}::${item.id}`;
    return renderAssetTypeahead({
        id: `budget-item-${safeBudgetId(key)}`,
        selectedAssetId: item.assetId || '',
        selectedAssetName: getSelectedAssetName(item.assetId),
        ariaLabel: `Forecast asset for ${item.name}`,
        pickerClass: 'budget-asset-typeahead',
        pickerAttributes: { 'data-budget-item-asset-picker': key },
        valueAttributes: { 'data-budget-item-asset': key },
        searchAttributes: { 'data-budget-item-asset-search': key },
        optionsAttributes: { 'data-budget-item-asset-options': key },
        emptyChoiceLabel: isSavingsBudgetGroup(group) ? 'Unallocated' : 'No forecast asset'
    });
}

function renderBudgetCadenceOptions(cadence) {
    return ['monthly', 'quarterly', 'annually'].map(value =>
        `<option value="${value}"${cadence === value ? ' selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join('');
}

function renderBudgetItemRow(group, item) {
    const itemLabel = `${item.name} in ${group.name}`;
    const category = getBudgetItemCategory(item);
    const cadence = String(item.cadence || 'monthly');
    const assetName = isSavingsBudgetGroup(group) ? getSelectedAssetName(item.assetId) : '';
    return `<tr class="budget-v2-item-row" data-budget-item-id="${escapeHtml(item.id)}">
        <td data-label="Name"><span class="budget-v2-item-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(category)}</small></span></td>
        <td data-label="Amount" class="obfuscate-val">${escapeHtml(formatter.format(Number(item.amount) || 0))}</td>
        <td data-label="Category">${escapeHtml(category)}</td>
        <td data-label="Cadence">${escapeHtml(cadence[0].toUpperCase() + cadence.slice(1))}</td>
        <td data-label="Forecast asset">${escapeHtml(assetName || (isSavingsBudgetGroup(group) ? 'Unallocated' : '—'))}</td>
        <td class="budget-row-actions" data-label="Actions"><button type="button" class="action-btn budget-item-edit-button" data-budget-edit-item data-budget-group-id="${escapeHtml(group.id)}" data-budget-item-id="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(itemLabel)}">Edit</button></td>
    </tr>`;
}

function renderBudgetGroup(group, index, totalGroups) {
    const collapsed = collapsedBudgetGroupIds.has(group.id);
    const groupContentId = `budget-group-content-${safeBudgetId(group.id)}`;
    const income = isIncomeBudgetGroup(group);
    const canMoveUp = !income && index > 1;
    const canMoveDown = !income && index < totalGroups - 1;
    const groupColor = getBudgetGroupColor(group, index);
    return `<section class="budget-group-editor${collapsed ? ' is-collapsed' : ''}" data-budget-group-id="${escapeHtml(group.id)}">
        <button type="button" class="budget-group-header" data-budget-toggle-group aria-expanded="${String(!collapsed)}" aria-controls="${groupContentId}">
            <span class="budget-group-header-main"><span class="budget-group-color" aria-hidden="true" style="background: ${safeCssColor(groupColor)}"></span><span><strong>${escapeHtml(group.name)}</strong><small>${income ? 'Built-in group · cannot be deleted' : `${group.items.length} line item${group.items.length === 1 ? '' : 's'}`}</small></span></span>
            <span class="budget-group-header-total"><span class="obfuscate-val">${escapeHtml(formatter.format(getBudgetGroupTotal(group, getMonthlyBudgetAmount)))}</span><span class="budget-group-chevron" aria-hidden="true">⌄</span></span>
        </button>
        <div id="${groupContentId}" class="budget-group-content"${collapsed ? ' hidden' : ''}>
            <div class="budget-group-toolbar">
                ${income
                    ? `<span class="budget-group-locked-note">Income is built in and cannot be removed. Add and edit its line items below.</span><div class="budget-group-actions"><button type="button" class="action-btn" data-budget-edit-group data-budget-group-id="${escapeHtml(group.id)}" aria-label="Edit ${escapeHtml(group.name)} group">Edit group</button></div>`
                    : `<span class="budget-group-edit-summary"><span class="budget-group-edit-summary-label">Custom group</span><strong>${escapeHtml(group.name)}</strong></span>
                    <div class="budget-group-actions"><button type="button" class="action-btn" data-budget-edit-group data-budget-group-id="${escapeHtml(group.id)}" aria-label="Edit ${escapeHtml(group.name)} group">Edit group</button><button type="button" class="action-btn" data-budget-group-move="up"${canMoveUp ? '' : ' disabled'} aria-label="Move ${escapeHtml(group.name)} up">Move up</button><button type="button" class="action-btn" data-budget-group-move="down"${canMoveDown ? '' : ' disabled'} aria-label="Move ${escapeHtml(group.name)} down">Move down</button><button type="button" class="action-btn danger-outline" data-budget-remove-group aria-label="Remove ${escapeHtml(group.name)}">Remove group</button></div>`}
            </div>
            <div class="table-container budget-v2-table-container"><table class="budget-table budget-v2-table"><thead><tr><th scope="col">Name</th><th scope="col">Amount (£)</th><th scope="col">Category</th><th scope="col">Cadence</th><th scope="col">Forecast asset</th><th scope="col">Actions</th></tr></thead><tbody>${group.items.length ? group.items.map(item => renderBudgetItemRow(group, item)).join('') : '<tr><td colspan="6" class="budget-group-empty">No line items yet. Add one to start planning this group.</td></tr>'}</tbody></table></div>
            <div class="budget-group-item-actions"><button type="button" class="action-btn budget-add-item-action" data-budget-add-item data-budget-group-id="${escapeHtml(group.id)}">+ Add line item</button></div>
        </div>
    </section>`;
}

function syncCollapsedBudgetGroups(settings, target) {
    const groupIds = settings.groups.map(group => group.id);
    const firstRender = target.dataset.budgetGroupsInitialized !== 'true';
    if (firstRender) {
        collapsedBudgetGroupIds = new Set(groupIds);
    } else {
        const nextCollapsedIds = new Set([...collapsedBudgetGroupIds].filter(id => groupIds.includes(id)));
        groupIds.forEach(groupId => {
            if (!renderedBudgetGroupIds.has(groupId)) nextCollapsedIds.add(groupId);
        });
        collapsedBudgetGroupIds = nextCollapsedIds;
    }
    renderedBudgetGroupIds = new Set(groupIds);
    target.dataset.budgetGroupsInitialized = 'true';
}

function renderBudgetGroups(settings) {
    const target = document.getElementById('budget-groups-editor');
    if (!target) return;
    syncCollapsedBudgetGroups(settings, target);
    target.innerHTML = `${settings.groups.map((group, index) => renderBudgetGroup(group, index, settings.groups.length)).join('')}
        <div class="budget-add-group-form">
            <label><span>Add custom group</span><input id="budget-new-group-name" type="text" placeholder="e.g. Giving or Travel"></label>
            <button type="button" class="action-btn" data-budget-add-group>Add group</button>
        </div>`;
}

function renderBudgetGroupEditorFields() {
    const fields = document.getElementById('budget-group-editor-fields');
    const state = budgetGroupEditorState;
    if (!fields || !state) return;

    fields.innerHTML = `
        <label class="budget-line-editor-field">
            <span>Group name</span>
            <input id="budget-group-editor-name" type="text" value="${escapeHtml(state.draft.name)}" data-budget-group-editor-field="name" autocomplete="off" required>
        </label>
        <label class="budget-line-editor-field budget-group-editor-color-field">
            <span>Group colour</span>
            <span class="budget-group-editor-color-control">
                <input id="budget-group-editor-color" type="color" value="${escapeHtml(state.draft.color)}" data-budget-group-editor-field="color" aria-label="Group colour">
                <code>${escapeHtml(state.draft.color)}</code>
            </span>
            <small class="budget-line-editor-help">Categories and their flow links will use this colour.</small>
            <div id="budget-group-editor-color-suggestion" class="budget-group-editor-color-suggestion" role="status" aria-live="polite" hidden></div>
        </label>`;
    renderBudgetGroupColorSuggestion();
}

function renderBudgetGroupColorSuggestion() {
    const state = budgetGroupEditorState;
    const suggestionTarget = document.getElementById('budget-group-editor-color-suggestion');
    if (!suggestionTarget || !state) return;

    const suggestion = getBudgetGroupColorSuggestion(state.draft.color);
    if (!suggestion) {
        suggestionTarget.hidden = true;
        suggestionTarget.innerHTML = '';
        return;
    }

    const suggestedColor = safeCssColor(suggestion.color);
    suggestionTarget.hidden = false;
    suggestionTarget.innerHTML = `<span class="budget-group-editor-color-suggestion-copy"><span class="budget-group-editor-color-swatch" aria-hidden="true" style="background: ${suggestedColor}"></span><span><strong>Closest palette match</strong><small>${escapeHtml(suggestion.color)}</small></span></span><button type="button" class="action-btn budget-group-editor-color-suggestion-action" data-budget-group-color-use-suggestion="${escapeHtml(suggestion.color)}">Use this colour</button>`;
}

function updateBudgetGroupEditorField(input) {
    const state = budgetGroupEditorState;
    if (!state || !input?.dataset?.budgetGroupEditorField) return;
    const field = input.dataset.budgetGroupEditorField;
    if (field === 'name') state.draft.name = input.value;
    if (field === 'color') state.draft.color = safeCssColor(input.value, state.draft.color);
    if (field === 'color') {
        const value = input.closest?.('.budget-group-editor-color-control')?.querySelector?.('code');
        if (value) value.textContent = state.draft.color;
        renderBudgetGroupColorSuggestion();
    }
    const validation = document.getElementById('budget-group-editor-validation');
    if (validation && state.showValidation) {
        validation.hidden = Boolean(String(state.draft.name || '').trim());
        validation.textContent = validation.hidden ? '' : 'Add a name for this group.';
    }
}

function openBudgetGroupEditor(groupId) {
    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(groupId, settings);
    const panel = document.getElementById('budget-group-editor');
    if (!group || !panel) return false;

    budgetGroupEditorState = {
        groupId: group.id,
        showValidation: false,
        draft: {
            name: group.name,
            color: getBudgetGroupColor(group)
        }
    };

    const title = document.getElementById('budget-group-editor-title');
    const copy = document.getElementById('budget-group-editor-copy');
    if (title) title.textContent = group.name;
    if (copy) copy.textContent = isIncomeBudgetGroup(group)
        ? `Update ${group.name}'s display name and colour. Income remains built in and cannot be removed.`
        : `Update ${group.name}'s name and colour. Categories in this group inherit the selected colour.`;
    renderBudgetGroupEditorFields();
    openFormFlyout(panel, {
        initialFocus: document.getElementById('budget-group-editor-name')
    });
    return true;
}

function closeBudgetGroupEditor(options = {}) {
    return closeFormFlyout(document.getElementById('budget-group-editor'), options);
}

function submitBudgetGroupEditor(event) {
    event.preventDefault?.();
    const state = budgetGroupEditorState;
    if (!state) return;
    state.showValidation = true;
    const name = String(state.draft.name || '').trim();
    if (!name) {
        const validation = document.getElementById('budget-group-editor-validation');
        if (validation) {
            validation.hidden = false;
            validation.textContent = 'Add a name for this group.';
        }
        document.getElementById('budget-group-editor-name')?.focus?.();
        return;
    }

    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(state.groupId, settings);
    if (!group) return;
    const color = getBudgetGroupColor({ color: state.draft.color });
    const saved = updateBudgetState(current => {
        const currentGroup = getBudgetGroup(state.groupId, current);
        if (!currentGroup) return false;
        currentGroup.name = name;
        currentGroup.color = color;
        return true;
    }, {
        title: 'Budget group updated',
        message: `${name} was updated successfully.`
    });
    if (saved) closeBudgetGroupEditor({ restoreFocus: false });
}

function getBudgetLineEditorValidationErrors(draft) {
    const errors = [];
    const name = String(draft?.name || '').trim();
    const amount = Number.parseFloat(String(draft?.amount ?? '').replace(/,/g, ''));
    const cadence = String(draft?.cadence || '').toLowerCase();
    if (!name) errors.push('Add a name for this line item.');
    if (!Number.isFinite(amount) || amount < 0) errors.push('The amount must be zero or positive.');
    if (!['monthly', 'quarterly', 'annually'].includes(cadence)) errors.push('Choose a supported cadence.');
    return errors;
}

function renderBudgetLineEditorPreview() {
    const preview = document.getElementById('budget-line-editor-preview');
    const validation = document.getElementById('budget-line-editor-validation');
    const state = budgetLineEditorState;
    if (!preview || !state) return;

    const group = getBudgetGroup(state.groupId);
    const amount = Number.parseFloat(String(state.draft.amount ?? '').replace(/,/g, ''));
    const cadence = ['monthly', 'quarterly', 'annually'].includes(state.draft.cadence)
        ? state.draft.cadence
        : 'monthly';
    const monthly = Number.isFinite(amount) && amount >= 0
        ? getMonthlyBudgetAmount({ amount, cadence })
        : null;
    const impact = monthly === null
        ? 'Enter an amount to preview the monthly plan impact.'
        : `${formatter.format(monthly)} planned each month`;
    const category = String(state.draft.category || '').trim() || UNCATEGORISED_LABEL;
    preview.innerHTML = `<span class="budget-line-editor-preview-label">Monthly plan impact</span><strong class="obfuscate-val">${escapeHtml(globalThis.window?.isObfuscated ? 'Amount hidden' : impact)}</strong><small>${escapeHtml(`${category} · ${group?.name || 'Budget group'}`)}</small>`;

    if (validation) {
        const errors = state.showValidation ? getBudgetLineEditorValidationErrors(state.draft) : [];
        validation.hidden = errors.length === 0;
        validation.textContent = errors[0] || '';
    }
}

function renderBudgetLineEditorFieldMarkup(state, group) {
    const key = safeBudgetId(`${state.groupId}-${state.itemId || 'new'}`);
    const assetField = isSavingsBudgetGroup(group)
        ? `<div class="budget-line-editor-field budget-line-editor-asset-field">
            <span class="budget-line-editor-field-label">Forecast asset <small>optional</small></span>
            ${renderAssetTypeahead({
                id: `budget-editor-asset-${key}`,
                selectedAssetId: state.draft.assetId || '',
                selectedAssetName: getSelectedAssetName(state.draft.assetId),
                ariaLabel: `Forecast asset for ${state.draft.name || 'saving'}`,
                pickerClass: 'budget-line-editor-asset-picker',
                pickerAttributes: { 'data-budget-editor-asset-picker': 'true' },
                valueAttributes: { 'data-budget-editor-asset-value': 'true' },
                searchAttributes: { 'data-budget-editor-asset-search': 'true' },
                optionsAttributes: { 'data-budget-editor-asset-options': 'true' },
                emptyChoiceLabel: 'Unallocated'
            })}
            <small class="budget-line-editor-help">Link this item to a Forecast asset if it should contribute to a tracked balance.</small>
        </div>`
        : '';

    return `
        <label class="budget-line-editor-field">
            <span>Line item name</span>
            <input id="budget-editor-${key}-name" type="text" value="${escapeHtml(state.draft.name)}" placeholder="e.g. Mortgage" data-budget-editor-field="name" autocomplete="off" required>
        </label>
        <label class="budget-line-editor-field">
            <span>Amount (£)</span>
            <input id="budget-editor-${key}-amount" type="number" value="${escapeHtml(state.draft.amount)}" min="0" step="0.01" inputmode="decimal" placeholder="0.00" data-budget-editor-field="amount" required>
        </label>
        <div class="budget-line-editor-field">
            <span class="budget-line-editor-field-label">Category <small>optional</small></span>
            ${renderAssetTypeahead({
                id: `budget-editor-category-${key}`,
                selectedAssetId: state.draft.category,
                selectedAssetName: state.draft.category,
                ariaLabel: `Category for ${state.draft.name || 'budget line'}`,
                placeholder: 'Search or enter a category…',
                pickerClass: 'budget-line-editor-category-typeahead',
                pickerAttributes: { 'data-budget-editor-category-picker': 'true' },
                valueAttributes: { 'data-budget-editor-category-value': 'true' },
                searchAttributes: { 'data-budget-editor-field': 'category', 'data-budget-editor-category-search': 'true' },
                optionsAttributes: { 'data-budget-editor-category-options': 'true' },
                emptyChoiceLabel: 'No category'
            })}
        </div>
        <label class="budget-line-editor-field">
            <span>Cadence</span>
            ${renderSelectField({
                id: `budget-editor-${key}-cadence`,
                className: 'integration-select budget-line-editor-select',
                options: renderBudgetCadenceOptions(state.draft.cadence),
                attributes: { 'data-budget-editor-field': 'cadence' }
            })}
        </label>
        ${assetField}`;
}

function renderBudgetLineEditorFields() {
    const fields = document.getElementById('budget-line-editor-fields');
    const state = budgetLineEditorState;
    const group = state ? getBudgetGroup(state.groupId) : null;
    if (!fields || !state || !group) return;
    fields.innerHTML = renderBudgetLineEditorFieldMarkup(state, group);
}

function chooseBudgetEditorAsset(_picker, assetId) {
    if (!budgetLineEditorState) return;
    const normalizedAssetId = String(assetId || '').trim() || null;
    budgetLineEditorState.draft.assetId = normalizedAssetId;
    const typeahead = getAssetTypeaheadState(_picker);
    if (typeahead.value) typeahead.value.value = normalizedAssetId || '';
    if (typeahead.search) typeahead.search.value = getSelectedAssetName(normalizedAssetId);
    renderBudgetLineEditorPreview();
}

function chooseBudgetEditorCategory(_picker, category) {
    if (!budgetLineEditorState) return;
    const normalizedCategory = String(category || '').trim();
    budgetLineEditorState.draft.category = normalizedCategory;
    const typeahead = getAssetTypeaheadState(_picker);
    if (typeahead.value) typeahead.value.value = normalizedCategory;
    if (typeahead.search) typeahead.search.value = normalizedCategory;
    renderBudgetLineEditorPreview();
}

function getBudgetLineEditorTypeaheadAssets(picker) {
    return picker?.dataset?.budgetEditorCategoryPicker
        ? getBudgetCategoryOptions()
        : undefined;
}

function chooseBudgetLineEditorTypeahead(picker, value) {
    if (picker?.dataset?.budgetEditorCategoryPicker) {
        chooseBudgetEditorCategory(picker, value);
        return;
    }
    chooseBudgetEditorAsset(picker, value);
}

function updateBudgetLineEditorField(input) {
    const state = budgetLineEditorState;
    if (!state || !input?.dataset?.budgetEditorField) return;
    if (state.deleteArmed) {
        state.deleteArmed = false;
        renderBudgetLineEditorDeleteButton();
    }
    const field = input.dataset.budgetEditorField;
    if (field === 'name') state.draft.name = input.value;
    if (field === 'amount') state.draft.amount = input.value;
    if (field === 'category') state.draft.category = input.value;
    if (field === 'cadence') state.draft.cadence = input.value;
    if (field === 'name' && input.value.trim()) {
        const title = document.getElementById('budget-line-editor-title');
        if (title) title.textContent = input.value.trim();
    }
    renderBudgetLineEditorPreview();
    renderBudgetLineEditorDeleteButton();
}

function openBudgetLineEditor(groupId, itemId = null) {
    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(groupId, settings);
    const item = itemId === null || itemId === undefined
        ? null
        : getBudgetItem(groupId, itemId, settings);
    const panel = document.getElementById('budget-line-editor');
    if (!group || (itemId !== null && itemId !== undefined && !item) || !panel) return false;

    budgetLineEditorState = {
        groupId: group.id,
        itemId: item?.id || null,
        isNew: !item,
        deleteArmed: false,
        showValidation: false,
        draft: {
            name: item?.name || '',
            amount: item ? String(item.amount ?? '') : '',
            category: item?.category || '',
            cadence: item?.cadence || 'monthly',
            assetId: item?.assetId || null
        }
    };

    const kicker = document.getElementById('budget-line-editor-kicker');
    const title = document.getElementById('budget-line-editor-title');
    const copy = document.getElementById('budget-line-editor-copy');
    if (kicker) kicker.textContent = item ? 'Edit line item' : 'Add line item';
    if (title) title.textContent = item?.name || 'New budget line';
    if (copy) copy.textContent = item
        ? `Update this line in ${group.name}. Changes are saved when you choose Save line.`
        : `Add a line to ${group.name}. You can assign a category now or leave it uncategorised.`;
    renderBudgetLineEditorDeleteButton();

    renderBudgetLineEditorFields();
    renderBudgetLineEditorPreview();
    openFormFlyout(panel, {
        initialFocus: document.querySelector('[data-budget-editor-field="name"]')
    });
    return true;
}

function closeBudgetLineEditor(options = {}) {
    return closeFormFlyout(document.getElementById('budget-line-editor'), options);
}

function submitBudgetLineEditor(event) {
    event.preventDefault?.();
    const state = budgetLineEditorState;
    if (!state) return;
    state.showValidation = true;
    const errors = getBudgetLineEditorValidationErrors(state.draft);
    if (errors.length) {
        renderBudgetLineEditorPreview();
        document.querySelector('[data-budget-editor-field="name"]')?.focus?.();
        return;
    }

    const payload = {
        name: String(state.draft.name).trim(),
        amount: Number.parseFloat(String(state.draft.amount).replace(/,/g, '')),
        category: String(state.draft.category || '').trim(),
        cadence: state.draft.cadence,
        assetId: String(state.draft.assetId || '').trim() || null
    };
    const saved = updateBudgetState(settings => {
        const group = getBudgetGroup(state.groupId, settings);
        if (!group) return false;
        if (state.isNew) {
            group.items.push({ id: createBudgetId(), ...payload });
            return true;
        }
        const item = getBudgetItem(state.groupId, state.itemId, settings);
        if (!item) return false;
        Object.assign(item, payload);
        return true;
    }, {
        title: state.isNew ? 'Budget item added' : 'Budget item updated',
        message: state.isNew ? `${payload.name} was added to your budget.` : `${payload.name} was updated successfully.`
    });
    if (saved) closeBudgetLineEditor({ restoreFocus: false });
}

function renderBudgetLineEditorDeleteButton() {
    const deleteButton = document.getElementById('budget-line-editor-delete');
    const state = budgetLineEditorState;
    if (!deleteButton) return;

    const itemName = state?.draft?.name || 'budget item';
    deleteButton.hidden = !state || state.isNew;
    if (deleteButton.hidden) return;

    const confirming = state.deleteArmed === true;
    deleteButton.textContent = confirming ? 'Confirm delete' : 'Delete';
    deleteButton.dataset.budgetEditorDeleteState = confirming ? 'confirm' : 'idle';
    deleteButton.setAttribute?.('aria-label', confirming ? `Confirm delete ${itemName}` : `Delete ${itemName}`);
    deleteButton.classList?.toggle?.('is-confirming', confirming);
}

function deleteBudgetLineEditor() {
    const state = budgetLineEditorState;
    if (!state || state.isNew) return;
    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(state.groupId, settings);
    const item = getBudgetItem(state.groupId, state.itemId, settings);
    if (!group || !item) return;

    if (!state.deleteArmed) {
        state.deleteArmed = true;
        renderBudgetLineEditorDeleteButton();
        return;
    }

    state.deleteArmed = false;
    closeBudgetLineEditor({ restoreFocus: false });
    updateBudgetState(current => {
        const currentGroup = getBudgetGroup(state.groupId, current);
        if (!currentGroup) return false;
        currentGroup.items = currentGroup.items.filter(candidate => candidate.id !== state.itemId);
        return true;
    }, { title: 'Budget item removed', message: `${item.name} was removed from ${group.name}.` });
}

function renderBudgetTable(tbodyId, array, color, category) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    const safeColor = safeCssColor(color);
    array.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = 'budget-item-row';
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        const assetCell = tbodyId === 'budget-savings-tbody' ? renderBudgetAssetCell(item, index) : '';
        const cadenceCell = tbodyId === 'budget-savings-tbody' ? renderBudgetCadenceCell(item, index) : '';
        tr.innerHTML = `<td data-label="Name" style="padding: 0.75rem 0.5rem;">${escapeHtml(item.name)}</td><td data-label="Amount" style="padding: 0.75rem 0.5rem; text-align: right; color: ${safeColor};" class="obfuscate-val">£${Number.parseFloat(item.amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>${assetCell}${cadenceCell}<td data-label="" class="budget-row-actions" style="padding: 0.75rem 0.5rem; text-align: center;"><button type="button" class="action-btn icon-only" data-budget-remove="${category}" data-budget-index="${index}" aria-label="Remove ${escapeHtml(item.name || 'budget item')}" title="Remove ${escapeHtml(item.name || 'budget item')}" style="background: transparent; color: #ef4444; border: none; cursor: pointer; padding: 4px;">&times;</button></td>`;
        tbody.appendChild(tr);
    });
}

function renderBudgetAssetCell(item, index) {
    return `<td data-label="Forecast asset" style="padding: 0.5rem;">${renderAssetTypeahead({
        id: `budget-${index}`,
        selectedAssetId: item.assetId || '',
        selectedAssetName: getSelectedAssetName(item.assetId),
        ariaLabel: `Asset for ${item.name || 'saving'}`,
        pickerClass: 'budget-asset-typeahead',
        pickerAttributes: { 'data-budget-saving-asset-picker': index },
        valueAttributes: { 'data-budget-saving-asset': index },
        searchAttributes: { 'data-budget-saving-asset-search': index },
        optionsAttributes: { 'data-budget-saving-asset-options': index },
        emptyChoiceLabel: 'Unallocated'
    })}</td>`;
}

function renderBudgetCadenceCell(item, index) {
    return `<td data-label="Cadence" style="padding: 0.5rem;">${renderSelectField({
        id: `budget-cadence-${index}`,
        ariaLabel: `Cadence for ${item.name || 'saving'}`,
        options: renderBudgetCadenceOptions(item.cadence || 'monthly'),
        attributes: { 'data-budget-saving-cadence': index }
    })}</td>`;
}

function budgetAssetPickerState(picker) {
    const index = picker?.dataset?.budgetSavingAssetPicker;
    const typeahead = getAssetTypeaheadState(picker);
    return {
        index,
        assetId: typeahead.value || picker?.querySelector?.(`[data-budget-saving-asset="${index}"]`),
        search: typeahead.search || picker?.querySelector?.(`[data-budget-saving-asset-search="${index}"]`),
        options: typeahead.options || picker?.querySelector?.(`[data-budget-saving-asset-options="${index}"]`)
    };
}

function chooseBudgetAsset(picker, assetId) {
    const key = picker?.dataset?.budgetItemAssetPicker;
    if (key) {
        const separator = key.indexOf('::');
        const groupId = separator >= 0 ? key.slice(0, separator) : '';
        const itemId = separator >= 0 ? key.slice(separator + 2) : key;
        updateBudgetItemField(groupId, itemId, 'assetId', assetId || null, {
            title: 'Budget item updated',
            message: 'The forecast asset was updated successfully.'
        });
        return;
    }
    const state = budgetAssetPickerState(picker);
    if (state.index !== undefined) window.updateBudgetSavingAsset(state.index, assetId || '');
}

function updateBudgetState(mutator, context) {
    const settings = ensureBudgetSettings();
    const previousSettings = cloneBudgetSettings(settings);
    if (mutator(settings) === false) return false;
    store.state.budgetSettings = normalizeBudgetSettings(settings);
    populateBudgetSettings();
    refreshBudgetViewAfterSettingsChange(store.state.budgetSettings);
    scheduleBudgetSave(context, previousSettings);
    return true;
}

function addBudgetItemToGroup(groupId, name, amount, category = '', cadence = 'monthly') {
    const normalizedName = String(name || '').trim();
    const parsedAmount = Number.parseFloat(String(amount ?? '').replace(/,/g, ''));
    if (!normalizedName || !Number.isFinite(parsedAmount)) return false;
    return updateBudgetState(settings => {
        const group = getBudgetGroup(groupId, settings);
        if (!group) return false;
        group.items.push({ id: createBudgetId(), name: normalizedName, amount: parsedAmount, cadence, assetId: null, category: String(category || '').trim() });
        return true;
    }, { title: 'Budget item added', message: `${normalizedName} was added to ${getBudgetGroup(groupId)?.name || 'your budget'}.` });
}

function addLegacyBudgetItem(category, nameInputId, amountInputId) {
    const nameInput = document.getElementById(nameInputId);
    const amountInput = document.getElementById(amountInputId);
    const cadenceInput = document.getElementById(`new-${category}-cadence`);
    const normalizedName = String(nameInput?.value || '').trim();
    const parsedAmount = Number.parseFloat(String(amountInput?.value ?? '').replace(/,/g, ''));
    if (!nameInput || !amountInput || !normalizedName || !Number.isFinite(parsedAmount)) return false;

    const settings = ensureBudgetSettings();
    const previousSettings = cloneBudgetSettings(settings);
    settings[category] = Array.isArray(settings[category]) ? settings[category] : [];
    settings[category].push({
        id: null,
        name: normalizedName,
        amount: parsedAmount,
        cadence: cadenceInput?.value || 'monthly',
        assetId: null
    });
    store.state.budgetSettings = settings;
    nameInput.value = '';
    amountInput.value = '';
    populateBudgetSettings();
    refreshBudgetViewAfterSettingsChange(store.state.budgetSettings);
    scheduleBudgetSave({ title: 'Budget item added', message: `${normalizedName} was added successfully.` }, previousSettings);
    return true;
}

function addBudgetItem(category, nameInputId, amountInputId) {
    const nameInput = document.getElementById(nameInputId);
    const amountInput = document.getElementById(amountInputId);
    if (budgetStorageMode === 'legacy' || (!Array.isArray(store.state.budgetSettings?.groups) && isLegacyBudgetHost())) {
        return addLegacyBudgetItem(category, nameInputId, amountInputId);
    }
    const group = getBudgetGroupByLegacyCategory(category);
    if (!nameInput || !amountInput || !group) return false;
    const saved = addBudgetItemToGroup(group.id, nameInput.value, amountInput.value);
    if (saved) {
        nameInput.value = '';
        amountInput.value = '';
    }
    return saved;
}

function removeBudgetItem(category, index) {
    const settings = ensureBudgetSettings();
    if (budgetStorageMode === 'legacy') {
        if (!Array.isArray(settings[category]) || !settings[category][Number(index)]) return false;
        const previousSettings = cloneBudgetSettings(settings);
        settings[category].splice(Number(index), 1);
        populateBudgetSettings();
        refreshBudgetViewAfterSettingsChange(settings);
        scheduleBudgetSave({ title: 'Budget item removed', message: 'The budget item was removed successfully.' }, previousSettings);
        return true;
    }
    const group = getBudgetGroupByLegacyCategory(category, settings);
    if (!group || !Number.isInteger(Number(index)) || !group.items[Number(index)]) return false;
    return updateBudgetState(current => {
        const target = getBudgetGroup(group.id, current);
        target.items.splice(Number(index), 1);
        return true;
    }, { title: 'Budget item removed', message: 'The budget item was removed successfully.' });
}

function updateBudgetItemField(groupId, itemId, field, value, context = null) {
    return updateBudgetState(settings => {
        const item = getBudgetItem(groupId, itemId, settings);
        const group = getBudgetGroup(groupId, settings);
        if (!item || !group) return false;
        if (field === 'amount') {
            const amount = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
            if (!Number.isFinite(amount)) return false;
            item.amount = amount;
        } else if (field === 'name') {
            item.name = String(value || '').trim() || 'Untitled item';
        } else if (field === 'category') {
            item.category = String(value || '').trim();
        } else if (field === 'assetId') {
            item.assetId = String(value || '').trim() || null;
        } else if (field === 'cadence') {
            item.cadence = ['monthly', 'quarterly', 'annually'].includes(value) ? value : 'monthly';
        } else {
            return false;
        }
        return true;
    }, context || { title: 'Budget item updated', message: 'Your budget item was updated successfully.' });
}

async function removeBudgetGroup(groupId) {
    const settings = ensureBudgetSettings();
    const group = getBudgetGroup(groupId, settings);
    if (!group || isIncomeBudgetGroup(group)) return false;
    if (group.items.length > 0) {
        const confirmed = await requestConfirmation({
            title: `Remove ${group.name}?`,
            message: `${group.name} contains ${group.items.length} line item${group.items.length === 1 ? '' : 's'}. Removing it will remove those items too.`,
            confirmLabel: 'Remove group'
        });
        if (!confirmed) return false;
    }
    return updateBudgetState(current => {
        current.groups = current.groups.filter(candidate => candidate.id !== group.id);
        return true;
    }, { title: 'Budget group removed', message: `${group.name} was removed from your budget.` });
}

function addBudgetGroup(name) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return false;
    const saved = updateBudgetState(settings => {
        settings.groups.push({ id: createBudgetId('budget-group'), name: normalizedName, kind: 'custom', role: 'custom', builtIn: false, items: [] });
        return true;
    }, { title: 'Budget group added', message: `${normalizedName} was added to your budget.` });
    if (saved) {
        const input = document.getElementById('budget-new-group-name');
        if (input) input.value = '';
    }
    return saved;
}

function moveBudgetGroup(groupId, direction) {
    return updateBudgetState(settings => {
        const index = settings.groups.findIndex(group => group.id === groupId);
        if (index <= 0 || isIncomeBudgetGroup(settings.groups[index])) return false;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex <= 0 || targetIndex >= settings.groups.length) return false;
        [settings.groups[index], settings.groups[targetIndex]] = [settings.groups[targetIndex], settings.groups[index]];
        return true;
    }, { title: 'Budget groups reordered', message: 'Your budget group order was updated.' });
}

function readBudgetAddItemForm(form) {
    const read = field => form.querySelector?.(`[data-budget-new-field="${field}"]`)?.value ?? '';
    return { name: read('name'), amount: read('amount'), category: read('category'), cadence: read('cadence') || 'monthly' };
}

export function setupBudgetSettings() {
    renderBudgetEntryForms();
    const form = document.getElementById('budget-settings-form');

    if (form && budgetBoundForm !== form) {
        budgetSettingsBound = true;
        budgetBoundForm = form;
        setupAssetTypeahead(form, { emptyChoiceLabel: 'Unallocated', onChoose: chooseBudgetAsset });
        form.addEventListener('submit', event => event.preventDefault());
        form.addEventListener('click', async event => {
            const addGroupButton = event.target?.closest?.('[data-budget-add-group]');
            if (addGroupButton) {
                event.preventDefault();
                addBudgetGroup(document.getElementById('budget-new-group-name')?.value);
                return;
            }
            const toggleButton = event.target?.closest?.('[data-budget-toggle-group]');
            if (toggleButton) {
                const group = toggleButton.closest?.('[data-budget-group-id]');
                const groupId = group?.dataset?.budgetGroupId;
                if (!groupId) return;
                if (collapsedBudgetGroupIds.has(groupId)) collapsedBudgetGroupIds.delete(groupId);
                else collapsedBudgetGroupIds.add(groupId);
                renderBudgetGroups(ensureBudgetSettings());
                return;
            }
            const addItemButton = event.target?.closest?.('[data-budget-add-item]');
            if (addItemButton) {
                event.preventDefault();
                const groupEl = addItemButton.closest?.('[data-budget-group-id]');
                openBudgetLineEditor(groupEl?.dataset?.budgetGroupId);
                return;
            }

            const editItemButton = event.target?.closest?.('[data-budget-edit-item]');
            if (editItemButton) {
                event.preventDefault();
                openBudgetLineEditor(editItemButton.dataset.budgetGroupId, editItemButton.dataset.budgetItemId);
                return;
            }
            const editGroupButton = event.target?.closest?.('[data-budget-edit-group]');
            if (editGroupButton) {
                event.preventDefault();
                openBudgetGroupEditor(editGroupButton.dataset.budgetGroupId);
                return;
            }
            const removeGroupButton = event.target?.closest?.('[data-budget-remove-group]');
            if (removeGroupButton) {
                event.preventDefault();
                await removeBudgetGroup(removeGroupButton.closest?.('[data-budget-group-id]')?.dataset?.budgetGroupId);
                return;
            }
            const moveButton = event.target?.closest?.('[data-budget-group-move]');
            if (moveButton && !moveButton.disabled) {
                event.preventDefault();
                moveBudgetGroup(moveButton.closest?.('[data-budget-group-id]')?.dataset?.budgetGroupId, moveButton.dataset.budgetGroupMove);
                return;
            }
            const removeItemButton = event.target?.closest?.('[data-budget-remove-item]');
            if (removeItemButton) {
                event.preventDefault();
                const groupEl = removeItemButton.closest?.('[data-budget-group-id]');
                const itemEl = removeItemButton.closest?.('[data-budget-item-id]');
                updateBudgetState(settings => {
                    const group = getBudgetGroup(groupEl?.dataset?.budgetGroupId, settings);
                    if (!group || !itemEl) return false;
                    group.items = group.items.filter(item => item.id !== itemEl.dataset.budgetItemId);
                    return true;
                }, { title: 'Budget item removed', message: 'The budget item was removed successfully.' });
            }
        });
        form.addEventListener('change', event => {
            const target = event.target;
            const groupEl = target.closest?.('[data-budget-group-id]');
            const itemEl = target.closest?.('[data-budget-item-id]');
            if (itemEl && target.dataset.budgetItemField) {
                updateBudgetItemField(groupEl?.dataset?.budgetGroupId, itemEl.dataset.budgetItemId, target.dataset.budgetItemField, target.value);
                return;
            }
            const oldCadence = target.closest?.('[data-budget-saving-cadence]');
            if (oldCadence) window.updateBudgetSavingCadence(oldCadence.dataset.budgetSavingCadence, oldCadence.value);
        });
        form.addEventListener('focusout', event => {
            const target = event.target;
            const groupEl = target.closest?.('[data-budget-group-id]');
            const itemEl = target.closest?.('[data-budget-item-id]');
            if (itemEl && target.dataset.budgetItemField && target.dataset.budgetItemField !== 'cadence') {
                updateBudgetItemField(groupEl?.dataset?.budgetGroupId, itemEl.dataset.budgetItemId, target.dataset.budgetItemField, target.value);
            }
        });
    }

    const editorPanel = document.getElementById('budget-line-editor');
    if (editorPanel) {
        initFormFlyout(editorPanel, {
            onClose: () => {
                closeAssetTypeaheads(editorPanel);
                budgetLineEditorState = null;
            }
        });
    }
    const editorForm = document.getElementById('budget-line-editor-form');
    if (editorForm && editorForm.dataset.budgetLineEditorInit !== 'true') {
        editorForm.dataset.budgetLineEditorInit = 'true';
        setupAssetTypeahead(editorForm, {
            emptyChoiceLabel: 'Unallocated',
            getAssets: getBudgetLineEditorTypeaheadAssets,
            onChoose: chooseBudgetLineEditorTypeahead
        });
        editorForm.addEventListener('submit', submitBudgetLineEditor);
        editorForm.addEventListener('input', event => updateBudgetLineEditorField(event.target?.closest?.('[data-budget-editor-field]')));
        editorForm.addEventListener('change', event => updateBudgetLineEditorField(event.target?.closest?.('[data-budget-editor-field]')));
        editorForm.addEventListener('click', event => {
            if (event.target?.closest?.('[data-budget-editor-delete]')) void deleteBudgetLineEditor();
        });
    }

    const groupEditorPanel = document.getElementById('budget-group-editor');
    if (groupEditorPanel) {
        initFormFlyout(groupEditorPanel, {
            onClose: () => {
                budgetGroupEditorState = null;
            }
        });
    }
    const groupEditorForm = document.getElementById('budget-group-editor-form');
    if (groupEditorForm && groupEditorForm.dataset.budgetGroupEditorInit !== 'true') {
        groupEditorForm.dataset.budgetGroupEditorInit = 'true';
        groupEditorForm.addEventListener('submit', submitBudgetGroupEditor);
        groupEditorForm.addEventListener('input', event => updateBudgetGroupEditorField(event.target?.closest?.('[data-budget-group-editor-field]')));
        groupEditorForm.addEventListener('change', event => updateBudgetGroupEditorField(event.target?.closest?.('[data-budget-group-editor-field]')));
        groupEditorForm.addEventListener('click', event => {
            const suggestionButton = event.target?.closest?.('[data-budget-group-color-use-suggestion]');
            if (!suggestionButton) return;
            event.preventDefault();
            const input = document.getElementById('budget-group-editor-color');
            if (!input) return;
            input.value = suggestionButton.dataset.budgetGroupColorUseSuggestion || input.value;
            updateBudgetGroupEditorField(input);
        });
    }

    populateBudgetSettings();
}

function scheduleBudgetSave(context = null, previousSettings = null) {
    if (context) budgetSaveContext = context;
    if (previousSettings && budgetSaveSnapshot === null) budgetSaveSnapshot = previousSettings;
    clearTimeout(budgetSaveTimer);
    budgetSaveTimer = setTimeout(async () => {
        budgetSaveTimer = null;
        const saveSnapshot = budgetSaveSnapshot;
        budgetSaveSnapshot = null;
        const saveContext = budgetSaveContext || { title: 'Budget settings saved', message: 'Your budget settings were saved successfully.' };
        budgetSaveContext = null;
        const legacySave = budgetStorageMode === 'legacy' && isLegacyBudgetHost();
        const settingsToSave = legacySave
            ? cloneBudgetSettings(store.state.budgetSettings)
            : normalizeBudgetSettings(store.state.budgetSettings, { needsUpdate: false });
        store.state.budgetSettings = settingsToSave;
        if (!await saveDbSettings(BUDGET_SETTINGS_KEY, settingsToSave)) {
            if (saveSnapshot) {
                store.state.budgetSettings = saveSnapshot;
                populateBudgetSettings();
                refreshBudgetViewAfterSettingsChange(store.state.budgetSettings);
            }
            showToast({ title: 'Unable to save budget', message: 'Your budget changes could not be saved.', type: 'error', key: 'budget-settings' });
            return;
        }

        if (legacySave) {
            // Older API contracts assign line-item identifiers during the
            // write. Re-read the document so the legacy table gets those
            // server ids just as it did before the v2 editor shipped.
            try {
                const response = await fetchFreshStrict(`${API_BASE_URL}/settings`);
                const persisted = response?.[BUDGET_SETTINGS_KEY];
                const parsed = typeof persisted === 'string' ? JSON.parse(persisted) : persisted;
                if (parsed && typeof parsed === 'object') store.state.budgetSettings = normalizeLegacyHostSettings(parsed);
            } catch {
                // A successful save is still useful if the follow-up refresh
                // is unavailable; the next page load will hydrate the ids.
            }
        } else {
            // Saving a v2 document is the explicit migration acknowledgement.
            store.state.budgetSettings = settingsToSave;
        }
        store.clearCache();
        populateBudgetSettings();
        refreshBudgetViewAfterSettingsChange(store.state.budgetSettings);
        globalThis.refreshDashboardFireStatus?.();
        showToast({ ...saveContext, type: 'success', key: 'budget-settings' });
    }, 300);
}

window.updateBudgetSavingAsset = (index, assetId) => {
    const settings = ensureBudgetSettings();
    if (budgetStorageMode === 'legacy') {
        const item = settings.savings?.[Number(index)];
        if (!item) return;
        const previousSettings = cloneBudgetSettings(settings);
        item.assetId = String(assetId || '').trim() || null;
        populateBudgetSettings();
        refreshBudgetViewAfterSettingsChange(settings);
        scheduleBudgetSave({ title: 'Budget saving updated', message: 'The saving allocation was updated successfully.' }, previousSettings);
        return;
    }
    const group = getBudgetGroupByLegacyCategory('savings', settings);
    const item = group?.items[Number(index)];
    if (!group || !item) return;
    updateBudgetItemField(group.id, item.id, 'assetId', assetId || null, { title: 'Budget saving updated', message: 'The saving allocation was updated successfully.' });
};

window.updateBudgetSavingCadence = (index, cadence) => {
    const settings = ensureBudgetSettings();
    if (budgetStorageMode === 'legacy') {
        const item = settings.savings?.[Number(index)];
        if (!item) return;
        const previousSettings = cloneBudgetSettings(settings);
        item.cadence = cadence || 'monthly';
        populateBudgetSettings();
        refreshBudgetViewAfterSettingsChange(settings);
        scheduleBudgetSave({ title: 'Budget saving updated', message: 'The saving cadence was updated successfully.' }, previousSettings);
        return;
    }
    const group = getBudgetGroupByLegacyCategory('savings', settings);
    const item = group?.items[Number(index)];
    if (!group || !item) return;
    updateBudgetItemField(group.id, item.id, 'cadence', cadence || 'monthly', { title: 'Budget saving updated', message: 'The saving cadence was updated successfully.' });
};

// Legacy global handlers remain available to older page fragments and tests.
window.addBudgetIncome = () => addBudgetItem('income', 'new-income-name', 'new-income-amount');
window.removeBudgetIncome = index => removeBudgetItem('income', index);
window.addBudgetBills = () => addBudgetItem('bills', 'new-bills-name', 'new-bills-amount');
window.removeBudgetBill = index => removeBudgetItem('bills', index);
window.addBudgetSavings = () => addBudgetItem('savings', 'new-savings-name', 'new-savings-amount');
window.removeBudgetSaving = index => removeBudgetItem('savings', index);
window.addBudgetSpend = () => addBudgetItem('spend', 'new-spend-name', 'new-spend-amount');
window.removeBudgetSpend = index => removeBudgetItem('spend', index);

export {
    ensureBudgetSettings,
    getBudgetCategoryOptions,
    getBudgetFlowData,
    renderBudgetLineEditorFieldMarkup,
    renderBudgetLineEditorDeleteButton
};
