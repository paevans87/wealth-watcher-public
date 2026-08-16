import { store } from '../store/store.js';
import { saveDbSettings } from '../api/apiClient.js';
import { formatter } from '../utils/formatters.js';
import { isFeatureEnabled, setFeatureEnabled } from '../utils/featureFlags.js';
import { showToast } from '../components/Toast.js';
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
    renderFeatureToggle,
    renderSelectField
} from '../components/FormFields.js';
import { escapeHtml, safeCssColor } from '../utils/html.js';
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_CONFIG } from './budgetConfig.js';

let budgetChartInstance = null;
let budgetSaveTimer;
let budgetSaveContext = null;
let budgetSaveSnapshot = null;

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

function cloneBudgetSettings(settings) {
    if (settings === undefined || settings === null) return {};
    try {
        return JSON.parse(JSON.stringify(settings));
    } catch {
        return {};
    }
}

export function getMonthlyBudgetAmount(item) {
    const amount = Number.parseFloat(item?.amount);
    if (!Number.isFinite(amount)) return 0;

    const cadence = String(item?.cadence || 'monthly').trim().toLowerCase();
    const months = BUDGET_CADENCE_MONTHS[cadence] || 1;
    return amount / months;
}

export function getMonthlyBudgetTotals(budgetSettings = {}) {
    const totalFor = category => (Array.isArray(budgetSettings?.[category])
        ? budgetSettings[category].reduce((total, item) => total + getMonthlyBudgetAmount(item), 0)
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

function renderBudgetEnabledToggle() {
    const target = document.getElementById('budget-setting-enabled-toggle');
    if (!target || target.dataset.rendered === 'true') return;
    target.innerHTML = renderFeatureToggle({ id: 'budget-setting-enabled', label: 'Enabled' });
    target.dataset.rendered = 'true';
}

function renderBudgetEntryForms() {
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
                ${renderCurrencyInputField({
                    id: amountId,
                    label: 'Amount (£)',
                    placeholder: '0.00'
                })}
                <button class="action-btn catalog-add-button" type="button" id="${buttonId}" data-budget-add="${config.action}">Add ${config.itemLabel}</button>
            </div>`;
        target.dataset.rendered = 'true';
    });
}

let currentChartView = 'overview';
window.loadBudgetOverview = () => loadBudgetView('overview');

export function loadBudgetView(viewMode = null) {
    if (viewMode) {
        currentChartView = viewMode;
    }
    
    const budgetSettings = ensureBudgetSettings();
    const hasBudgetData = hasConfiguredBudgetData(budgetSettings);
    if (hasBudgetData) {
        setPageStatus('budget-view', PAGE_STATUS.READY);
        showBudgetReadyState();
    } else {
        setPageStatus('budget-view', PAGE_STATUS.EMPTY);
        clearBudgetReadyState();
        renderBudgetEmptyState();
        return;
    }
    
    const {
        income: totalIncome,
        bills: totalBills,
        savings: totalSavings,
        spend: totalSpend,
        unallocated
    } = getMonthlyBudgetTotals(budgetSettings);
    
    // Format Display Values
    document.getElementById('budget-total-income').innerText = formatter.format(totalIncome);
    document.getElementById('budget-total-bills').innerText = formatter.format(totalBills);
    document.getElementById('budget-total-savings').innerText = formatter.format(totalSavings);
    document.getElementById('budget-total-spend').innerText = formatter.format(totalSpend);
    
    const unallocatedEl = document.getElementById('budget-unallocated');
    unallocatedEl.innerText = formatter.format(unallocated);
    if (unallocated < 0) {
        unallocatedEl.style.color = '#ef4444'; // Red if negative
    } else {
        unallocatedEl.style.color = '#ffffff'; 
    }

    const chartLabels = [];
    const chartData = [];
    const chartColors = [];

    // Curated palettes for the categories with distinct variations for drill-down
    const billsColors = ['#ef4444', '#f97316', '#ec4899', '#f59e0b', '#f43f5e', '#c2410c', '#be185d', '#b91c1c', '#fb923c', '#fda4af']; // Warm colors
    const savingsColors = ['#10b981', '#14b8a6', '#84cc16', '#06b6d4', '#22c55e', '#0f766e', '#4d7c0f', '#047857', '#34d399', '#5eead4']; // Cool/Nature colors
    const spendColors = ['#8b5cf6', '#3b82f6', '#d946ef', '#6366f1', '#0ea5e9', '#6d28d9', '#1d4ed8', '#a21caf', '#a78bfa', '#93c5fd']; // Rich purples/blues

    const backBtn = document.getElementById('budget-chart-back-btn');

    if (currentChartView === 'overview') {
        if (backBtn) backBtn.hidden = true;
        
        if (totalBills > 0) {
            chartLabels.push('Bills');
            chartData.push(totalBills);
            chartColors.push(billsColors[0]);
        }
        if (totalSavings > 0) {
            chartLabels.push('Savings');
            chartData.push(totalSavings);
            chartColors.push(savingsColors[0]);
        }
        if (totalSpend > 0) {
            chartLabels.push('Spend');
            chartData.push(totalSpend);
            chartColors.push(spendColors[0]);
        }
        if (unallocated > 0) {
            chartLabels.push('Unallocated (Remaining)');
            chartData.push(unallocated);
            chartColors.push('rgba(255, 255, 255, 0.2)');
        }
    } else {
        if (backBtn) backBtn.hidden = false;
        
        if (currentChartView === 'Bills' && budgetSettings.bills) {
            budgetSettings.bills.forEach((item, index) => {
                chartLabels.push(item.name);
                chartData.push(getMonthlyBudgetAmount(item));
                chartColors.push(billsColors[index % billsColors.length]);
            });
        } else if (currentChartView === 'Savings' && budgetSettings.savings) {
            budgetSettings.savings.forEach((item, index) => {
                chartLabels.push(item.name);
                chartData.push(getMonthlyBudgetAmount(item));
                chartColors.push(savingsColors[index % savingsColors.length]);
            });
        } else if (currentChartView === 'Spend' && budgetSettings.spend) {
            budgetSettings.spend.forEach((item, index) => {
                chartLabels.push(item.name);
                chartData.push(getMonthlyBudgetAmount(item));
                chartColors.push(spendColors[index % spendColors.length]);
            });
        }
    }

    // Chart Configuration
    const ctx = document.getElementById('budgetChart');
    if (!ctx) return;

    renderBudgetDrilldownControls(chartLabels, chartData);
    renderAccessibleChartData(document.getElementById('budget-chart-data'), {
        summary: currentChartView === 'overview' ? 'View budget breakdown data' : `View ${currentChartView} data`,
        caption: 'Monthly amounts represented by the selected budget breakdown.',
        headers: [{ key: 'label', label: 'Category' }, { key: 'value', label: 'Monthly amount' }],
        rows: chartLabels.map((label, index) => ({ label, value: chartData[index] })),
        formatCell: (row, key) => key === 'value'
            ? (globalThis.window?.isObfuscated ? '£***' : formatter.format(row.value))
            : row[key]
    });
    ctx.setAttribute?.('aria-label', `${currentChartView === 'overview' ? 'Budget breakdown' : `${currentChartView} budget breakdown`} chart`);

    if (budgetChartInstance) {
        budgetChartInstance.destroy();
    }

    const chartPlugins = [];
    if (window.ChartDataLabels) {
        chartPlugins.push(window.ChartDataLabels);
    }

    budgetChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: chartColors,
                borderWidth: 1,
                borderColor: 'rgba(0, 0, 0, 0.5)',
                hoverOffset: 4
            }]
        },
        plugins: chartPlugins,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements, chart) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const labelClicked = chart.data.labels[idx];
                    if (currentChartView === 'overview') {
                        if (['Bills', 'Savings', 'Spend'].includes(labelClicked)) {
                            loadBudgetView(labelClicked);
                        }
                    } else {
                        loadBudgetView('overview');
                    }
                } else if (currentChartView !== 'overview') {
                    // Clicked on white space while drilled down, go back
                    loadBudgetView('overview');
                }
            },
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#a0aec0', padding: 20 }
                },
                datalabels: {
                    color: '#fff',
                    font: {
                        weight: 'bold',
                        size: 12
                    },
                    formatter: (value, ctx) => {
                        let sum = 0;
                        let dataArr = ctx.chart.data.datasets[0].data;
                        dataArr.forEach(data => {
                            sum += data;
                        });
                        let percentage = (value * 100 / sum).toFixed(0) + "%";
                        // Only show if the slice is large enough to fit text
                        if ((value * 100 / sum) > 4) {
                            return percentage;
                        } else {
                            return null;
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += '£' + context.parsed.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                
                                // Add percentage to tooltip as well
                                let sum = 0;
                                let dataArr = context.chart.data.datasets[0].data;
                                dataArr.forEach(data => { sum += data; });
                                let percentage = (context.parsed * 100 / sum).toFixed(1) + "%";
                                label += ' (' + percentage + ')';
                            }
                            if (currentChartView === 'overview' && ['Bills', 'Savings', 'Spend'].includes(context.label)) {
                                label += ' (Click to view breakdown)';
                            }
                            return label;
                        }
                    }
                }
            },
            cutout: '60%',
            onHover: (event, elements) => {
                if (elements.length > 0 && currentChartView === 'overview') {
                    event.native.target.style.cursor = 'pointer';
                } else if (currentChartView !== 'overview') {
                    event.native.target.style.cursor = 'pointer';
                } else {
                    event.native.target.style.cursor = 'default';
                }
            }
        }
    });
}

// --- SETTINGS LOGIC ---

function ensureBudgetSettings() {
    if (!store.state.budgetSettings || typeof store.state.budgetSettings !== 'object') {
        store.state.budgetSettings = {};
    }

    ['income', 'bills', 'savings', 'spend'].forEach(category => {
        if (!Array.isArray(store.state.budgetSettings[category])) {
            store.state.budgetSettings[category] = [];
        }
    });
    store.state.budgetSettings.income = store.state.budgetSettings.income.map(item => ({
        ...item,
        cadence: item.cadence || 'monthly'
    }));
    store.state.budgetSettings.bills = store.state.budgetSettings.bills.map(item => ({
        ...item,
        cadence: item.cadence || 'monthly'
    }));
    store.state.budgetSettings.savings = store.state.budgetSettings.savings.map(item => ({
        ...item,
        id: item.id || createBudgetId(),
        cadence: item.cadence || 'monthly',
        assetId: item.assetId || null
    }));
    store.state.budgetSettings.spend = store.state.budgetSettings.spend.map(item => ({
        ...item,
        cadence: item.cadence || 'monthly'
    }));

    return store.state.budgetSettings;
}

function hasConfiguredBudgetData(budgetSettings) {
    return ['income', 'bills', 'savings', 'spend']
        .some(category => Array.isArray(budgetSettings?.[category]) && budgetSettings[category].length > 0);
}

function showBudgetReadyState() {
    const emptyState = document.getElementById('budget-empty-state');
    if (emptyState) emptyState.hidden = true;
    const overviewContent = document.getElementById('budget-overview-content');
    if (overviewContent) overviewContent.hidden = false;
}

function clearBudgetReadyState() {
    budgetChartInstance?.destroy();
    budgetChartInstance = null;
    currentChartView = 'overview';

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

    const backBtn = document.getElementById('budget-chart-back-btn');
    if (backBtn) backBtn.hidden = true;

    const chart = document.getElementById('budgetChart');
    if (chart && 'innerHTML' in chart) chart.innerHTML = '';
    const drilldowns = document.getElementById('budget-chart-drilldowns');
    if (drilldowns) drilldowns.innerHTML = '';
    renderAccessibleChartData(document.getElementById('budget-chart-data'), {
        headers: [{ key: 'label', label: 'Category' }, { key: 'value', label: 'Monthly amount' }],
        rows: []
    });
}

function renderBudgetDrilldownControls(labels, values) {
    const target = document.getElementById('budget-chart-drilldowns');
    if (!target) return;
    if (target.dataset.bound !== 'true') {
        target.dataset.bound = 'true';
        target.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-budget-view]');
            if (!button) return;
            const view = button.dataset.budgetView;
            if (view === 'overview') return loadBudgetView('overview');
            if (['Bills', 'Savings', 'Spend'].includes(view)) loadBudgetView(view);
        });
    }

    const available = currentChartView === 'overview'
        ? ['Bills', 'Savings', 'Spend'].filter(label => labels.includes(label))
        : ['overview'];
    target.innerHTML = available.map(view => `
        <button type="button" class="action-btn budget-drilldown-button" data-budget-view="${escapeHtml(view)}"${view === currentChartView ? ' aria-current="page"' : ''}>
            ${view === 'overview' ? '&larr; Back to overview' : `View ${escapeHtml(view.toLowerCase())}`}
        </button>`).join('');
    target.hidden = available.length === 0;
}

function renderBudgetEmptyState() {
    const view = document.getElementById('budget-view');
    if (!view) return;

    let emptyState = document.getElementById('budget-empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'budget-empty-state';
        emptyState.className = 'catalog-workspace presentation-empty-state budget-empty-state';
        emptyState.setAttribute?.('role', 'status');
        emptyState.innerHTML = `
            <div class="presentation-empty-state-layout">
                <div class="presentation-empty-copy">
                    <span class="presentation-empty-kicker">Monthly allocation</span>
                    <h2>Give every pound a clear job.</h2>
                    <p>No budget data yet. Bring income, bills, savings and spending together in one calm monthly view, then use the breakdown to see where your money is going.</p>
                    <p class="presentation-empty-note">Add your first budget item in Settings and this illustrative example will become your live allocation overview.</p>
                    <a class="action-btn" href="#settings?panel=monthly-budget" aria-controls="budget-settings-pane">Open Budget Settings</a>
                </div>
                <div class="presentation-preview budget-preview" role="img" aria-label="Illustrative example of a configured budget overview">
                    <div class="presentation-preview-header">
                        <div>
                            <span class="presentation-preview-label">Illustrative example</span>
                            <strong>Budget overview</strong>
                        </div>
                        <span class="presentation-preview-status">Monthly</span>
                    </div>
                    <div class="budget-preview-summary">
                        <div class="budget-preview-stat budget-preview-stat-income"><span>Total income</span><strong>£4,800</strong></div>
                        <div class="budget-preview-stat"><span>Bills</span><strong>£1,820</strong></div>
                        <div class="budget-preview-stat"><span>Future</span><strong>£720</strong></div>
                    </div>
                    <div class="budget-preview-breakdown">
                        <div class="budget-preview-ring" aria-hidden="true"><span>62%<small>allocated</small></span></div>
                        <div class="budget-preview-lines" aria-hidden="true">
                            <div><span><i class="preview-dot preview-dot-bills"></i>Bills</span><strong>£1,820</strong></div>
                            <div><span><i class="preview-dot preview-dot-savings"></i>Savings</span><strong>£720</strong></div>
                            <div><span><i class="preview-dot preview-dot-spend"></i>Flexible spend</span><strong>£460</strong></div>
                            <div class="budget-preview-remaining"><span>Remaining</span><strong>£1,800</strong></div>
                        </div>
                    </div>
                </div>
            </div>`;
        const header = view.querySelector?.(':scope > header') || view.querySelector?.('header');
        if (header && typeof view.insertBefore === 'function') {
            view.insertBefore(emptyState, header.nextElementSibling || null);
        } else if (typeof view.prepend === 'function') view.prepend(emptyState);
        else if (typeof view.insertBefore === 'function') view.insertBefore(emptyState, view.firstChild || null);
        else view.appendChild(emptyState);
    }

    emptyState.hidden = false;
}

export function populateBudgetSettings() {
    renderBudgetEnabledToggle();
    renderBudgetEntryForms();
    const budgetSettings = ensureBudgetSettings();
    const enabledToggle = document.getElementById('budget-setting-enabled');
    if (enabledToggle) {
        enabledToggle.checked = isFeatureEnabled('budget');
    }
    updateBudgetDisabledDescription();
    const form = document.getElementById('budget-settings-form');
    if (form) closeAssetTypeaheads(form);
    
    renderBudgetTable('budget-income-tbody', budgetSettings.income, '#06b6d4', 'income');
    renderBudgetTable('budget-bills-tbody', budgetSettings.bills, '#ef4444', 'bills');
    renderBudgetTable('budget-savings-tbody', budgetSettings.savings, '#10b981', 'savings');
    renderBudgetTable('budget-spend-tbody', budgetSettings.spend, '#8b5cf6', 'spend');
}

function updateBudgetDisabledDescription() {
    const isEnabled = isFeatureEnabled('budget');
    const description = document.getElementById('budget-disabled-description');
    if (description) {
        description.hidden = isEnabled;
    }

    const form = document.getElementById('budget-settings-form');
    if (form) {
        form.hidden = !isEnabled;
    }
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
        const assetCell = tbodyId === 'budget-savings-tbody'
            ? renderBudgetAssetCell(item, index)
            : '';
        const cadenceCell = tbodyId === 'budget-savings-tbody'
            ? renderBudgetCadenceCell(item, index)
            : '';
        tr.innerHTML = `
            <td data-label="Name" style="padding: 0.75rem 0.5rem;">${escapeHtml(item.name)}</td>
            <td data-label="Amount" style="padding: 0.75rem 0.5rem; text-align: right; color: ${safeColor};" class="obfuscate-val">£${parseFloat(item.amount).toLocaleString('en-GB', {minimumFractionDigits: 2})}</td>
            ${assetCell}
            ${cadenceCell}
            <td data-label="" class="budget-row-actions" style="padding: 0.75rem 0.5rem; text-align: center;">
                <button type="button" class="action-btn icon-only" data-budget-remove="${category}" data-budget-index="${index}" aria-label="Remove ${escapeHtml(item.name || 'budget item')}" title="Remove ${escapeHtml(item.name || 'budget item')}" style="background: transparent; color: #ef4444; border: none; cursor: pointer; padding: 4px;">&times;</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBudgetAssetCell(item, index) {
    const selectedAsset = (store.state.assets || []).find(asset =>
        String(asset.Id) === String(item.assetId || ''));
    const selectedAssetName = selectedAsset?.DisplayName || '';
    return `<td data-label="Forecast asset" style="padding: 0.5rem;">
        ${renderAssetTypeahead({
            id: `budget-${index}`,
            selectedAssetId: item.assetId || '',
            selectedAssetName,
            ariaLabel: `Asset for ${item.name || 'saving'}`,
            pickerClass: 'budget-asset-typeahead',
            pickerAttributes: { 'data-budget-saving-asset-picker': index },
            valueAttributes: { 'data-budget-saving-asset': index },
            searchAttributes: { 'data-budget-saving-asset-search': index },
            optionsAttributes: { 'data-budget-saving-asset-options': index },
            emptyChoiceLabel: 'Unallocated'
        })}
    </td>`;
}

function renderBudgetCadenceCell(item, index) {
    const cadence = item.cadence || 'monthly';
    const options = `
        <option value="monthly" ${cadence === 'monthly' ? 'selected' : ''}>Monthly</option>
        <option value="quarterly" ${cadence === 'quarterly' ? 'selected' : ''}>Quarterly</option>
        <option value="annually" ${cadence === 'annually' ? 'selected' : ''}>Annually</option>`;
    return `<td data-label="Cadence" style="padding: 0.5rem;">
        ${renderSelectField({
            id: `budget-cadence-${index}`,
            ariaLabel: `Cadence for ${item.name || 'saving'}`,
            options,
            attributes: { 'data-budget-saving-cadence': index }
        })}
    </td>`;
}

function budgetAssetPickerState(picker) {
    const index = picker?.dataset.budgetSavingAssetPicker;
    const typeahead = getAssetTypeaheadState(picker);
    return {
        index,
        assetId: typeahead.value || picker?.querySelector(`[data-budget-saving-asset="${index}"]`),
        search: typeahead.search || picker?.querySelector(`[data-budget-saving-asset-search="${index}"]`),
        options: typeahead.options || picker?.querySelector(`[data-budget-saving-asset-options="${index}"]`)
    };
}

function chooseBudgetAsset(picker, assetId) {
    const state = budgetAssetPickerState(picker);
    if (state.index === undefined) return;
    window.updateBudgetSavingAsset(state.index, assetId || '');
}

// Helper to add items
function addBudgetItem(category, nameInputId, amountInputId) {
    const nameInput = document.getElementById(nameInputId);
    const amountInput = document.getElementById(amountInputId);
    
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value.replace(/,/g, ''));
    
    if (name && !isNaN(amount)) {
        const budgetSettings = ensureBudgetSettings();
        const previousSettings = cloneBudgetSettings(budgetSettings);
        if (!budgetSettings[category]) budgetSettings[category] = [];
        
        budgetSettings[category].push(category === 'savings'
            ? { id: createBudgetId(), name, amount, cadence: 'monthly', assetId: null }
            : { name, amount });
        
        nameInput.value = '';
        amountInput.value = '';
        
        populateBudgetSettings();
        scheduleBudgetSave({
            title: 'Budget item added',
            message: `${name} was added to your budget.`
        }, previousSettings);
    }
}

function removeBudgetItem(category, index) {
    if (store.state.budgetSettings && store.state.budgetSettings[category]) {
        const previousSettings = cloneBudgetSettings(store.state.budgetSettings);
        store.state.budgetSettings[category].splice(index, 1);
        populateBudgetSettings();
        scheduleBudgetSave({
            title: 'Budget item removed',
            message: 'The budget item was removed successfully.'
        }, previousSettings);
    }
}

export function setupBudgetSettings() {
    renderBudgetEnabledToggle();
    renderBudgetEntryForms();
    const form = document.getElementById('budget-settings-form');
    const enabledToggle = document.getElementById('budget-setting-enabled');

    if (enabledToggle && enabledToggle.dataset.budgetToggleInit !== 'true') {
        enabledToggle.dataset.budgetToggleInit = 'true';
        enabledToggle.addEventListener('change', async (event) => {
            const saved = await setFeatureEnabled('budget', event.target.checked);
            if (!saved) {
                event.target.checked = isFeatureEnabled('budget');
            }
            updateBudgetDisabledDescription();
        });
    }

    if (!form || form.dataset.budgetSettingsInit === 'true') return;
    form.dataset.budgetSettingsInit = 'true';
    setupAssetTypeahead(form, {
        emptyChoiceLabel: 'Unallocated',
        onChoose: chooseBudgetAsset
    });

    // Add/remove actions save automatically; prevent Enter from submitting the form.
    form.addEventListener('submit', (event) => {
        event.preventDefault();
    });

    const addActions = {
        addBudgetIncome: () => addBudgetItem('income', 'new-income-name', 'new-income-amount'),
        addBudgetBills: () => addBudgetItem('bills', 'new-bills-name', 'new-bills-amount'),
        addBudgetSavings: () => addBudgetItem('savings', 'new-savings-name', 'new-savings-amount'),
        addBudgetSpend: () => addBudgetItem('spend', 'new-spend-name', 'new-spend-amount')
    };
    form.addEventListener('click', (event) => {
        const addButton = event.target?.closest?.('[data-budget-add]');
        if (addButton) {
            event.preventDefault();
            addActions[addButton.dataset.budgetAdd]?.();
            return;
        }

        const removeButton = event.target?.closest?.('[data-budget-remove]');
        if (!removeButton) return;
        const category = removeButton.dataset.budgetRemove;
        const index = Number(removeButton.dataset.budgetIndex);
        if (!['income', 'bills', 'savings', 'spend'].includes(category) || !Number.isInteger(index) || index < 0) return;
        removeBudgetItem(category, index);
    });

    form.addEventListener('change', (event) => {
        const cadence = event.target.closest?.('[data-budget-saving-cadence]');
        if (!cadence) return;
        window.updateBudgetSavingCadence(cadence.dataset.budgetSavingCadence, cadence.value);
    });

    populateBudgetSettings();
}

function scheduleBudgetSave(context = null, previousSettings = null) {
    if (context) budgetSaveContext = context;
    if (previousSettings && budgetSaveSnapshot === null) {
        budgetSaveSnapshot = previousSettings;
    }
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
        if (!await saveDbSettings('wealthWatcherBudgetSettings', store.state.budgetSettings)) {
            if (saveSnapshot) {
                store.state.budgetSettings = saveSnapshot;
                populateBudgetSettings();
            }
            showToast({
                title: 'Unable to save budget',
                message: 'Your budget changes could not be saved.',
                type: 'error',
                key: 'budget-settings'
            });
            return;
        }
        store.clearCache();
        showToast({ ...saveContext, type: 'success', key: 'budget-settings' });
    }, 300);
}

function createBudgetId() {
    return globalThis.crypto?.randomUUID?.() || `saving-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

window.updateBudgetSavingAsset = (index, assetId) => {
    const savings = ensureBudgetSettings().savings;
    if (!savings[index]) return;
    const previousSettings = cloneBudgetSettings(store.state.budgetSettings);
    savings[index].assetId = assetId || null;
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget saving updated',
        message: 'The saving allocation was updated successfully.'
    }, previousSettings);
};

window.updateBudgetSavingCadence = (index, cadence) => {
    const savings = ensureBudgetSettings().savings;
    if (!savings[index]) return;
    const previousSettings = cloneBudgetSettings(store.state.budgetSettings);
    savings[index].cadence = cadence || 'monthly';
    populateBudgetSettings();
    scheduleBudgetSave({
        title: 'Budget saving updated',
        message: 'The saving cadence was updated successfully.'
    }, previousSettings);
};

// Global functions for inline HTML events
window.addBudgetIncome = () => addBudgetItem('income', 'new-income-name', 'new-income-amount');
window.removeBudgetIncome = (index) => removeBudgetItem('income', index);

window.addBudgetBills = () => addBudgetItem('bills', 'new-bills-name', 'new-bills-amount');
window.removeBudgetBill = (index) => removeBudgetItem('bills', index);

window.addBudgetSavings = () => addBudgetItem('savings', 'new-savings-name', 'new-savings-amount');
window.removeBudgetSaving = (index) => removeBudgetItem('savings', index);

window.addBudgetSpend = () => addBudgetItem('spend', 'new-spend-name', 'new-spend-amount');
window.removeBudgetSpend = (index) => removeBudgetItem('spend', index);
