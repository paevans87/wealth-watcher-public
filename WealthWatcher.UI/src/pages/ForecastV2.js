import { store } from '../store/store.js';
import { fetchCached, fetchFreshStrict, saveDbSettings, API_BASE_URL } from '../api/apiClient.js';
import { isFeatureEnabled } from '../utils/featureFlags.js';
import { getAssetTypeaheadState, renderAssetTypeahead, setupAssetTypeahead } from '../components/AssetTypeahead.js';
import { renderFeatureToggle } from '../components/FormFields.js';
import { PAGE_STATUS, setPageStatus } from '../components/PageState.js';
import { showToast } from '../components/Toast.js';
import { setPageLoading } from '../components/PageLoading.js';
import { createPageRequestController } from '../components/PageRequest.js';
import { renderAccessibleChartData } from '../components/AccessibleChartData.js';
import { currencyFormatter } from '../utils/formatters.js';
import { calculateFireTarget, getIncludedFireAssetIds } from '../components/FireModel.js';
import { getBudgetGroups, isIncomeBudgetGroup } from './budgetConfig.js';

let forecastChart;
let forecastSaveTimer;
let forecastStrategyChangeHandler;
let forecastRateSources = [];
let showForecastAssetCalculations = true;
const forecastRequests = createPageRequestController();
let boundForecastRetryButton = null;
const DEFAULT_ANNUAL_RETURN = 4;
const DEFAULT_MONTHLY_CONTRIBUTION = 1500;
const DEFAULT_FORECAST_STRATEGY = 'fire-default';
export const FIRST_LAST_ANNUALIZED_STRATEGY = 'first-last-annualized';
export const FORECAST_CALCULATIONS_STORAGE_KEY = 'wealthwatcher_forecast_show_asset_calculations';
const fallbackColors = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#84cc16', '#f97316'];

function cloneSettings(settings) {
    if (settings === undefined || settings === null) return {};
    try {
        return JSON.parse(JSON.stringify(settings));
    } catch {
        return {};
    }
}

export function getForecastTargetFromFireSettings(fire = {}) {
    return calculateFireTarget(fire);
}

// The method descriptions are also the UI explanation of the assumptions sent to the API.
export const FORECAST_STRATEGIES = [
    {
        value: 'fire-default', label: 'FIRE default return',
        description: 'Uses the configured FIRE/default annual return and does not extrapolate history.'
    },
    {
        value: 'cash-flow-adjusted-cagr', label: 'Cash-flow-adjusted CAGR',
        description: 'Links completed monthly returns after removing known invested-capital changes, then annualizes compounded growth.'
    },
    {
        value: 'median-monthly-return', label: 'Median monthly return',
        description: 'Annualizes the median completed-month return so unusual months have less influence.'
    },
    {
        value: 'weighted-log-return', label: 'Recency-weighted log return',
        description: 'Averages monthly log returns with more weight on recent months before annualizing.'
    },
    {
        value: 'regression-trend', label: 'Log-return regression trend',
        description: 'Fits a straight line to cumulative cash-flow-adjusted log wealth and annualizes its slope.'
    },
    {
        value: 'winsorized-monthly-return', label: 'Winsorized monthly return',
        description: 'Clamps extreme completed-month returns to the 10th/90th percentile before compounding.'
    },
    {
        value: FIRST_LAST_ANNUALIZED_STRATEGY, label: 'First-to-last annualized return',
        description: 'Compares the first and last observed history values, annualizes the change over the elapsed period, and compounds that annual rate in the forecast.'
    }
];

function getRecordValue(record, ...keys) {
    for (const key of keys) {
        if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
    }
    return '';
}

function getConfiguredColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

export function getForecastCalculationStrategy(settings = store.state.forecastSettings || {}) {
    const selected = String(settings.forecastStrategy || '').trim().toLowerCase();
    return FORECAST_STRATEGIES.some(strategy => strategy.value === selected)
        ? selected
        : DEFAULT_FORECAST_STRATEGY;
}

export function getForecastStrategyDetails(value) {
    return FORECAST_STRATEGIES.find(strategy => strategy.value === value)
        || FORECAST_STRATEGIES[0];
}

function getForecastStrategyOptions() {
    return FORECAST_STRATEGIES.map(strategy => ({
        Id: strategy.value,
        DisplayName: strategy.label
    }));
}

function getForecastStrategyPicker(controlId) {
    if (typeof document === 'undefined') return null;
    const host = document.querySelector?.(`[data-forecast-strategy-control="${controlId}"]`);
    return host?.matches?.('[data-asset-typeahead]')
        ? host
        : host?.querySelector?.('[data-asset-typeahead]') || null;
}

function setForecastControlValue(id, value) {
    if (typeof document === 'undefined') return;
    const control = document.getElementById(id);
    if (control) control.value = value;

    const picker = getForecastStrategyPicker(id);
    const state = getAssetTypeaheadState(picker);
    const selected = FORECAST_STRATEGIES.find(strategy => strategy.value === value);
    if (state.value) state.value.value = value;
    if (state.search) {
        state.search.value = selected?.label || '';
        state.search.title = selected?.description || '';
        state.search.setAttribute?.('aria-invalid', selected ? 'false' : 'true');
    }
}

function configureForecastStrategyPicker({ controlId, hostId } = {}) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById(hostId);
    if (!host) return;

    let picker = host.querySelector?.('[data-asset-typeahead]');
    if (!picker) {
        host.innerHTML = renderAssetTypeahead({
            id: controlId,
            selectedAssetId: getForecastCalculationStrategy(),
            selectedAssetName: getForecastStrategyDetails(getForecastCalculationStrategy()).label,
            ariaLabel: 'Projection strategy',
            placeholder: 'Search strategies…',
            pickerClass: 'forecast-strategy-typeahead',
            pickerAttributes: {
                'data-forecast-strategy-control': controlId
            },
            valueAttributes: {
                id: controlId
            },
            searchAttributes: {
                id: `${controlId}-search`
            },
            emptyChoiceLabel: 'Select a strategy…'
        });
        picker = host.querySelector?.('[data-asset-typeahead]');
        if (!picker) return;

        setupAssetTypeahead(picker, {
            includeEmptyChoice: false,
            getAssets: getForecastStrategyOptions,
            onClear: (_selectedPicker, state) => {
                if (state.value) state.value.value = '';
                state.search?.setAttribute?.('aria-invalid', 'true');
            },
            onChoose: (selectedPicker, value) => {
                setForecastControlValue(controlId, value);
                syncForecastCalculationControl(controlId);
                forecastStrategyChangeHandler?.(controlId);
                selectedPicker.querySelector?.('[data-asset-typeahead-search]')?.focus?.();
            }
        });
    }

    setForecastControlValue(controlId, getForecastCalculationStrategy());
}

function configureForecastStrategyControls() {
    if (typeof document === 'undefined') return;
    configureForecastStrategyPicker({
        controlId: 'forecast-setting-calculation-strategy',
        hostId: 'forecast-setting-calculation-strategy-picker'
    });
    configureForecastStrategyPicker({
        controlId: 'forecast-screen-calculation-strategy',
        hostId: 'forecast-screen-calculation-strategy-picker'
    });
}

function syncForecastCalculationControl(controlId) {
    const ids = ['forecast-setting-calculation-strategy', 'forecast-screen-calculation-strategy'];
    if (!ids.includes(controlId) || typeof document === 'undefined') return;
    const source = document.getElementById(controlId);
    const otherId = ids.find(id => id !== controlId);
    if (source && otherId) setForecastControlValue(otherId, source.value);
}

function getForecastStorage(storage) {
    if (storage !== undefined) return storage;
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

export function getForecastAssetCalculationsPreference(storage) {
    const value = getForecastStorage(storage)?.getItem?.(FORECAST_CALCULATIONS_STORAGE_KEY);
    return value === null || value === undefined ? true : value !== 'false';
}

export function setForecastAssetCalculationsPreference(value, storage) {
    const normalized = value === true;
    try {
        getForecastStorage(storage)?.setItem?.(FORECAST_CALCULATIONS_STORAGE_KEY, String(normalized));
    } catch {
        // A restricted browser storage context should not prevent the chart from rendering.
    }
    showForecastAssetCalculations = normalized;
    return normalized;
}

export function getForecastStackColor(stackName, categories = store.state.CATEGORIES, index = 0) {
    const normalizedName = String(stackName || '').trim().toLowerCase();
    const category = (Array.isArray(categories) ? categories : []).find(candidate =>
        [getRecordValue(candidate, 'Id', 'id'),
            getRecordValue(candidate, 'Label', 'label'),
            getRecordValue(candidate, 'DisplayName', 'displayName')]
            .some(value => String(value || '').trim().toLowerCase() === normalizedName));
    return getConfiguredColor(getRecordValue(category, 'Color', 'color'))
        || fallbackColors[index % fallbackColors.length];
}

export function populateForecastSettings() {
    const s = store.state.forecastSettings || {};
    configureForecastStrategyControls();
    setForecastControlValue('forecast-setting-dob', s.dateOfBirth || '');
    setForecastControlValue('forecast-setting-return', s.annualReturn ?? DEFAULT_ANNUAL_RETURN);
    setForecastControlValue('forecast-setting-contribution', s.monthlyContribution ?? DEFAULT_MONTHLY_CONTRIBUTION);
    setForecastControlValue('forecast-setting-calculation-strategy', getForecastCalculationStrategy(s));
    setForecastControlValue('forecast-screen-calculation-strategy', getForecastCalculationStrategy(s));
}

function updateForecastCalculationsToggle() {
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('forecast-show-asset-calculations');
    if (!toggle) return;
    toggle.checked = showForecastAssetCalculations;
    toggle.setAttribute?.('aria-checked', String(showForecastAssetCalculations));
}

function setupForecastCalculationsToggle() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('forecast-calculations-toggle');
    if (!host) return;

    if (!host.querySelector?.('#forecast-show-asset-calculations')) {
        host.innerHTML = renderFeatureToggle({
            id: 'forecast-show-asset-calculations',
            label: 'Show Asset Calculations',
            className: 'forecast-calculations-toggle',
            title: 'Show or hide the per-asset rate calculations above the forecast chart.',
            inputAttributes: {
                'aria-controls': 'forecast-rate-sources'
            }
        });
        document.getElementById('forecast-show-asset-calculations')?.addEventListener('change', event => {
            setForecastAssetCalculationsPreference(event.target.checked);
            updateForecastCalculationsToggle();
            renderHistoricalRateSources();
        });
    }

    updateForecastCalculationsToggle();
}

export function setupForecast() {
    const form = document.getElementById('forecast-settings-form');
    const scheduleSave = event => {
        syncForecastCalculationControl(event?.target?.id);
        clearTimeout(forecastSaveTimer);
        forecastSaveTimer = setTimeout(async () => {
            if (!form?.checkValidity()) return;
            const selectedStrategy = document.getElementById('forecast-setting-calculation-strategy')?.value;
            if (!FORECAST_STRATEGIES.some(strategy => strategy.value === selectedStrategy)) return;
            const annualReturn = parseFloat(document.getElementById('forecast-setting-return')?.value);
            const monthlyContribution = parseFloat(document.getElementById('forecast-setting-contribution')?.value);
            if (![annualReturn, monthlyContribution].every(Number.isFinite)) return;

            const previousSettings = cloneSettings(store.state.forecastSettings);
            store.state.forecastSettings = {
                dateOfBirth: document.getElementById('forecast-setting-dob')?.value || '',
                annualReturn,
                monthlyContribution,
                forecastStrategy: getForecastCalculationStrategy({
                    forecastStrategy: document.getElementById('forecast-setting-calculation-strategy')?.value
                })
            };
            if (!await saveDbSettings('wealthWatcherForecastSettings', store.state.forecastSettings)) {
                store.state.forecastSettings = previousSettings;
                populateForecastSettings();
                showToast({
                    title: 'Unable to save forecast settings',
                    message: 'Your forecast changes could not be saved.',
                    type: 'error',
                    key: 'forecast-settings'
                });
                return;
            }
            store.clearCache();
            await loadForecastView();
            globalThis.refreshDashboardFireStatus?.();
            showToast({
                title: 'Forecast settings saved',
                message: 'Your forecast settings were saved successfully.',
                type: 'success',
                key: 'forecast-settings'
            });
        }, 500);
    };

    forecastStrategyChangeHandler = scheduleSave;
    configureForecastStrategyControls();
    showForecastAssetCalculations = getForecastAssetCalculationsPreference();
    setupForecastCalculationsToggle();

    form?.addEventListener('input', scheduleSave);
    form?.addEventListener('change', scheduleSave);
    form?.addEventListener('submit', event => {
        event.preventDefault();
        scheduleSave();
    });
}

export function createProjectionChartConfig(points, stackOrder, target, categories = store.state.CATEGORIES) {
    const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
    const datasets = stackOrder.map((name, index) => ({
        label: name,
        data: points.map(point => point.Values[name] || 0),
        borderColor: getForecastStackColor(name, categories, index),
        backgroundColor: `${getForecastStackColor(name, categories, index)}99`,
        borderWidth: 1.5, pointRadius: 2, fill: true
    }));
    datasets.push({
        label: 'FIRE Target', data: points.map(() => target), borderColor: '#ef4444',
        borderWidth: 2, borderDash: [10, 5], pointRadius: 0, fill: false, stack: 'target'
    });
    return {
        type: 'line',
        data: {
            labels: points.map(p => new Date(`${p.Date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })),
            datasets
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#a0aec0', padding: 16 } },
                tooltip: { callbacks: {
                    label: c => window.isObfuscated ? `${c.dataset.label}: £***` : `${c.dataset.label}: ${money(c.parsed.y)}`,
                    footer(items) {
                        const point = points[items[0]?.dataIndex];
                        if (!point) return '';
                        if (window.isObfuscated) return 'Total: £***';
                        return [`Total: ${money(point.Total)}`, `FIRE target: ${money(target)}`,
                            point.Total >= target ? 'FIRE target reached' : 'FIRE target not reached'];
                    }
                }}
            },
            scales: {
                x: { stacked: true, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#a0aec0', maxTicksLimit: 12 } },
                y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,.05)' },
                    ticks: { color: '#a0aec0', callback: value => window.isObfuscated ? '£***' :
                        new Intl.NumberFormat('en-GB', { notation: 'compact', style: 'currency', currency: 'GBP' }).format(value) } }
            }
        }
    };
}

function showChart(id, oldChart, points, order, target, categories) {
    oldChart?.destroy();
    const canvas = document.getElementById(id);
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    return new Chart(context, createProjectionChartConfig(points, order, target, categories));
}

function hideLegacyForecastPanels() {
    if (typeof document === 'undefined') return;
    const canvases = [...document.querySelectorAll('#forecast-view canvas')];
    const retainedCanvas = document.getElementById('forecastExpectedChart');
    canvases.filter(canvas => canvas !== retainedCanvas).forEach(canvas => {
        const panel = canvas.closest('.full-width-col') || canvas.parentElement;
        if (panel) panel.hidden = true;
    });
}

function insertForecastState(view, state) {
    const header = view.querySelector?.(':scope > header') || view.querySelector?.('header');
    if (header && typeof view.insertBefore === 'function') {
        view.insertBefore(state, header.nextElementSibling || null);
    } else if (typeof view.prepend === 'function') view.prepend(state);
    else if (typeof view.insertBefore === 'function') view.insertBefore(state, view.firstChild || null);
    else if (typeof view.appendChild === 'function') view.appendChild(state);
}

function ensureForecastEmptyState(view) {
    if (typeof document.createElement !== 'function') return null;
    let emptyState = document.getElementById('forecast-empty-state');
    if (emptyState) return emptyState;

    emptyState = document.createElement('div');
    emptyState.id = 'forecast-empty-state';
    emptyState.className = 'catalog-workspace presentation-empty-state forecast-empty-state';
    emptyState.setAttribute?.('role', 'status');
    emptyState.innerHTML = `
        <div class="presentation-empty-state-layout">
            <div class="presentation-empty-copy">
                <span class="presentation-empty-kicker">Future projections</span>
                <h2>See the shape of your future.</h2>
                <p>No forecast data yet. Explore how your portfolio could grow towards its FIRE target with a projection strategy that matches the way you want to think about the future.</p>
                <p class="presentation-empty-note">Add asset history and choose a strategy in Settings to turn this illustrative preview into your live forecast.</p>
                <a class="action-btn" href="#settings?panel=fire-settings&focus=fire-forecast-settings" aria-controls="fire-settings-pane">Open Forecast Settings</a>
            </div>
            <div class="presentation-preview forecast-preview" role="img" aria-label="Illustrative preview of a configured wealth forecast; not your data">
                <div class="presentation-preview-header">
                    <div>
                        <span class="presentation-preview-label">Illustrative preview</span>
                        <strong>Wealth forecast</strong>
                    </div>
                    <span class="presentation-preview-status">FIRE strategy</span>
                </div>
                <div class="forecast-preview-metrics">
                    <div><span>Target date</span><strong>Jun 2042</strong></div>
                    <div><span>Time remaining</span><strong>15y 10m</strong></div>
                </div>
                <div class="forecast-preview-chart" aria-hidden="true">
                    <div class="forecast-preview-chart-label">Projected portfolio</div>
                    <svg viewBox="0 0 560 190" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="forecast-preview-fill" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.34"></stop>
                                <stop offset="100%" stop-color="#06b6d4" stop-opacity="0"></stop>
                            </linearGradient>
                        </defs>
                        <path class="forecast-preview-area" d="M0 174 C80 166, 108 145, 164 150 S250 126, 290 111 S365 108, 410 76 S500 44, 560 18 L560 190 L0 190 Z"></path>
                        <polyline class="forecast-preview-line" points="0,174 64,165 112,148 164,150 220,133 290,111 350,113 410,76 475,54 520,46 560,18"></polyline>
                        <line class="forecast-preview-target" x1="0" y1="62" x2="560" y2="62"></line>
                    </svg>
                    <div class="forecast-preview-axis"><span>Today</span><span>Target</span><span>2042</span></div>
                </div>
                <div class="forecast-preview-legend"><span><i class="preview-dot preview-dot-investments"></i>Portfolio value</span><span><i class="preview-dot preview-dot-target"></i>FIRE target</span></div>
            </div>
        </div>`;
    insertForecastState(view, emptyState);
    return emptyState;
}

function ensureForecastErrorState(view) {
    if (typeof document.createElement !== 'function') return null;
    let errorState = document.getElementById('forecast-error-state');
    if (errorState) return errorState;

    errorState = document.createElement('div');
    errorState.id = 'forecast-error-state';
    errorState.className = 'catalog-workspace presentation-empty-state forecast-error-state';
    errorState.setAttribute?.('role', 'alert');
    errorState.innerHTML = `
        <div class="presentation-empty-state-layout">
            <div class="presentation-empty-copy">
                <span class="presentation-empty-kicker">Forecast unavailable</span>
                <h2>We couldn't load your forecast.</h2>
                <p>Your projection could not be calculated right now. Try again, or check your settings if the problem continues.</p>
                <button id="forecast-retry" class="action-btn" type="button">Try again</button>
            </div>
        </div>`;
    insertForecastState(view, errorState);
    return errorState;
}

function clearForecastResults() {
    forecastChart?.destroy();
    forecastChart = null;

    if (typeof document === 'undefined') {
        forecastRateSources = [];
        return;
    }

    ['forecast-fire-date', 'forecast-time-remaining', 'forecast-age'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerText = '--';
    });
    const trend = document.getElementById('forecast-historical-trend');
    if (trend) {
        trend.innerText = '';
        trend.title = '';
    }
    renderHistoricalRateSources([], false);
    renderAccessibleChartData(document.getElementById('forecast-chart-data'), {
        headers: [{ key: 'date', label: 'Period' }, { key: 'total', label: 'Projected total' }, { key: 'target', label: 'FIRE target' }],
        rows: []
    });
}

export function setForecastPageState(status) {
    const view = document.getElementById('forecast-view');
    if (!view) return;

    setPageStatus(view, status);

    const emptyState = status === PAGE_STATUS.EMPTY
        ? ensureForecastEmptyState(view)
        : document.getElementById('forecast-empty-state');
    const errorState = status === PAGE_STATUS.ERROR
        ? ensureForecastErrorState(view)
        : document.getElementById('forecast-error-state');
    if (emptyState) emptyState.hidden = status !== PAGE_STATUS.EMPTY;
    if (errorState) errorState.hidden = status !== PAGE_STATUS.ERROR;

    const strategyControls = view.querySelector?.('.forecast-strategy-controls');
    const results = view.querySelector?.('.forecast-results');
    if (strategyControls) strategyControls.hidden = status !== PAGE_STATUS.READY;
    if (results) results.hidden = status === PAGE_STATUS.EMPTY || status === PAGE_STATUS.ERROR;

    if (status === PAGE_STATUS.EMPTY || status === PAGE_STATUS.ERROR) clearForecastResults();

    if (status === PAGE_STATUS.ERROR && errorState) {
        const retryButton = errorState.querySelector?.('#forecast-retry');
        if (retryButton && retryButton !== boundForecastRetryButton) {
            retryButton.addEventListener('click', () => {
                void loadForecastView();
            });
            boundForecastRetryButton = retryButton;
        }
    }
}

function hitResult(current, target, months, date) {
    if (current >= target) return { date: 'Achieved', remaining: '0 Years, 0 Months', hit: new Date() };
    if (months < 0 || !date) return { date: 'Never', remaining: 'Negative/Zero Growth', hit: null };
    const [year, month] = date.split('-').map(Number);
    const parts = [];
    if (Math.floor(months / 12)) parts.push(`${Math.floor(months / 12)} Years`);
    if (months % 12) parts.push(`${months % 12} Months`);
    return { date: new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        remaining: parts.join(', ') || 'Less than 1 Month', hit: new Date(year, month - 1) };
}

function summary(prefix, result, dob) {
    document.getElementById(`${prefix}-fire-date`).innerText = result.date;
    document.getElementById(`${prefix}-time-remaining`).innerText = result.remaining;
    const age = document.getElementById(`${prefix}-age`);
    if (!age) return;
    if (!result.hit || !dob) { age.innerText = '--'; return; }
    const birth = new Date(`${dob}T00:00:00`);
    let years = result.hit.getFullYear() - birth.getFullYear();
    if (result.hit < new Date(result.hit.getFullYear(), birth.getMonth(), birth.getDate())) years--;
    age.innerText = `${years} Years`;
}

export function getBudgetForecastContributions() {
    const groups = isFeatureEnabled('budget')
        ? getBudgetGroups(store.state.budgetSettings || {})
        : [];
    const savings = groups
        .filter(group => !isIncomeBudgetGroup(group)
            && (String(group.id).toLowerCase() === 'savings'
                || String(group.name).toLowerCase().includes('saving')
                || String(group.role).toLowerCase() === 'savings'))
        .flatMap(group => group.items || [])
        .filter(item => Number(item.amount) > 0);
    return savings.map(item => ({
        name: item.name || '', amount: Number(item.amount), assetId: item.assetId || null,
        cadence: item.cadence || 'monthly'
    }));
}

export function getForecastContributionInputs(settings = store.state.forecastSettings || {}) {
    const savings = getBudgetForecastContributions();
    const linkedSavings = savings.filter(item => item.assetId);
    const hasUnlinkedSavings = savings.some(item => !item.assetId);
    return {
        monthlyContribution: hasUnlinkedSavings || !linkedSavings.length
            ? (settings.monthlyContribution ?? DEFAULT_MONTHLY_CONTRIBUTION) : 0,
        contributions: linkedSavings
    };
}

function getIncludedAssets(fire = {}) {
    if (Array.isArray(fire.includedAssets)) return fire.includedAssets;
    return getIncludedFireAssetIds(fire, store.state.CATEGORIES);
}

export function buildForecastRequest(settings = store.state.forecastSettings || {}, target, fire = store.state.fireSettings || {}) {
    const contributionInputs = getForecastContributionInputs(settings);
    return {
        target,
        annualReturn: settings.annualReturn ?? DEFAULT_ANNUAL_RETURN,
        monthlyContribution: contributionInputs.monthlyContribution,
        contributions: contributionInputs.contributions,
        forecastStrategy: getForecastCalculationStrategy(settings),
        windfalls: fire.includeWindfalls === false ? [] : (fire.windfalls || []),
        includedAssets: getIncludedAssets(fire)
    };
}

function readForecastField(data, upperKey, lowerKey) {
    return data?.[upperKey] ?? data?.[lowerKey];
}

function isForecastDate(value) {
    const date = String(value ?? '').trim();
    const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(date);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3] || '01');
    const parsed = new Date(year, month - 1, day);
    if (Number.isNaN(parsed.valueOf())
        || parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day) return null;

    return `${match[1]}-${match[2]}`;
}

export function getForecastProjectionStatus(data, target) {
    const current = Number(readForecastField(data, 'CurrentNW', 'currentNW'));
    const months = Number(readForecastField(data, 'TargetHitMonth', 'targetHitMonth'));
    const date = isForecastDate(readForecastField(data, 'TargetHitDate', 'targetHitDate'));
    const points = readForecastField(data, 'Projection', 'projection')
        || readForecastField(data, 'Expected', 'expected')
        || [];

    if (target > 0 && Number.isFinite(current) && current >= target) return 'achieved';
    if (months === 0) return 'achieved';
    if (months > 0 && date) return 'projected';
    if (months < 0) return 'unreachable';
    if (date) return 'projected';
    return Array.isArray(points) && points.length > 0 ? 'unavailable' : 'empty';
}

export function getForecastProjectionDate(data) {
    return isForecastDate(readForecastField(data, 'TargetHitDate', 'targetHitDate'));
}

/**
 * Loads the existing forecast endpoint for the Dashboard card. This is kept
 * separate from the full Forecast page so the card can render FIRE math first
 * and treat this request as an optional projection enhancement.
 */
export async function loadForecastSnapshot({
    settings = store.state.forecastSettings || {},
    fire = store.state.fireSettings || {},
    force = false
} = {}) {
    if (!isFeatureEnabled('forecast')) {
        const snapshot = { key: 'disabled', status: 'disabled', target: 0, data: null, date: null };
        store.state.fireStatusForecast = snapshot;
        return snapshot;
    }

    const target = getForecastTargetFromFireSettings(fire);
    const request = buildForecastRequest(settings, target, fire);
    const key = JSON.stringify(request);
    const previous = store.state.fireStatusForecast;
    if (!force && previous?.key === key && previous.status && previous.status !== 'pending') {
        return previous;
    }

    const pending = { key, status: 'pending', target, data: null, date: null };
    store.state.fireStatusForecast = pending;
    if (target <= 0) {
        const setupSnapshot = { ...pending, status: 'setup' };
        store.state.fireStatusForecast = setupSnapshot;
        return setupSnapshot;
    }

    try {
        const data = await fetchCached(`${API_BASE_URL}/wealth/forecast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        }, {
            cacheResponse: !force,
            ttlMs: 5 * 60 * 1000,
            tags: ['fire-status', 'forecast'],
            throwOnError: true
        });
        const currentRequest = buildForecastRequest(
            store.state.forecastSettings || {},
            getForecastTargetFromFireSettings(store.state.fireSettings || {}),
            store.state.fireSettings || {}
        );
        if (JSON.stringify(currentRequest) !== key) {
            return { ...pending, status: 'stale' };
        }

        const validData = data && typeof data === 'object' ? data : null;
        const snapshot = {
            key,
            status: validData ? getForecastProjectionStatus(validData, target) : 'unavailable',
            target,
            data: validData,
            date: validData ? getForecastProjectionDate(validData) : null
        };
        store.state.fireStatusForecast = snapshot;
        return snapshot;
    } catch (error) {
        const snapshot = { ...pending, status: 'unavailable', error };
        store.state.fireStatusForecast = snapshot;
        return snapshot;
    }
}

export function renderHistoricalRateSources(rates = forecastRateSources, visible = showForecastAssetCalculations) {
    const container = document.getElementById('forecast-rate-sources');
    if (!container) return;
    forecastRateSources = Array.isArray(rates) ? rates : [];
    container.innerHTML = '';
    container.hidden = !visible;
    container.setAttribute?.('aria-hidden', String(!visible));
    if (!visible) return;
    if (!forecastRateSources.length) { container.innerText = 'No historical asset rates available.'; return; }

    forecastRateSources.forEach(rate => {
        const row = document.createElement('div');
        const periods = Number(rate.HistoricalPeriodCount ?? rate.historicalPeriodCount ?? 0);
        const percentage = Number(rate.AnnualRatePercent ?? rate.annualRatePercent ?? 0);
        const source = String(rate.Source ?? rate.source ?? '');
        const sourceLabel = source === 'fallback' ? 'FIRE/default fallback' : getForecastStrategyDetails(source).label;
        const assetName = rate.AssetName ?? rate.assetName ?? rate.AssetType ?? rate.assetType ?? 'Asset';
        row.innerText = `${assetName}: ${percentage.toFixed(2)}% (${sourceLabel}${periods ? `, ${periods} month${periods === 1 ? '' : 's'}` : ''})`;
        container.appendChild(row);
    });
}

export async function loadForecastView() {
    const requestId = forecastRequests.next();
    setPageLoading('forecast-view', true);
    setForecastPageState(PAGE_STATUS.LOADING);
    const fire = store.state.fireSettings || {};
    const settings = store.state.forecastSettings || {};
    showForecastAssetCalculations = getForecastAssetCalculationsPreference();
    setupForecastCalculationsToggle();
    populateForecastSettings();
    const target = getForecastTargetFromFireSettings(fire);
    try {
        const data = await fetchFreshStrict(`${API_BASE_URL}/wealth/forecast`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildForecastRequest(settings, target, fire))
        });
        if (!forecastRequests.isCurrent(requestId)) return data;
        if (!data || typeof data !== 'object') {
            throw new Error('Forecast response was invalid.');
        }
        const categories = Array.isArray(store.state.CATEGORIES) ? store.state.CATEGORIES : [];
        const points = data.Projection || data.projection || data.Expected || data.expected || [];
        if (!Array.isArray(points)) {
            throw new Error('Forecast response did not include a projection.');
        }
        if (!points.length) {
            setForecastPageState(PAGE_STATUS.EMPTY);
            return;
        }
        hideLegacyForecastPanels();
        setForecastPageState(PAGE_STATUS.READY);
        forecastChart = showChart('forecastExpectedChart', forecastChart, points,
            data.StackOrder || data.stackOrder || [], target, categories);
        renderAccessibleChartData(document.getElementById('forecast-chart-data'), {
            summary: 'View forecast data',
            caption: 'Projected total wealth and the FIRE target for each forecast period.',
            headers: [{ key: 'date', label: 'Period' }, { key: 'total', label: 'Projected total' }, { key: 'target', label: 'FIRE target' }],
            rows: points.map(point => ({
                date: point.Date || point.date,
                total: point.Total ?? point.total ?? 0,
                target
            })),
            formatCell: (row, key) => {
                if (key === 'date') return row.date;
                return globalThis.window?.isObfuscated ? '£***' : currencyFormatter.format(row[key]);
            }
        });
        const selectedStrategy = data.SelectedStrategy || data.selectedStrategy
            || getForecastCalculationStrategy(settings);
        const details = getForecastStrategyDetails(selectedStrategy);
        const rates = data.RateSources || data.rateSources || [];
        const status = document.getElementById('forecast-historical-trend');
        if (status) {
            status.innerText = `${details.label} · ${rates.length} asset rate${rates.length === 1 ? '' : 's'}`;
            status.title = details.description;
        }
        renderHistoricalRateSources(rates);
        summary('forecast', hitResult(data.CurrentNW ?? data.currentNW, target,
            data.TargetHitMonth ?? data.targetHitMonth, data.TargetHitDate ?? data.targetHitDate), settings.dateOfBirth);
    } catch (error) {
        if (!forecastRequests.isCurrent(requestId)) return;
        setForecastPageState(PAGE_STATUS.ERROR);
        console.error('Failed to load forecast:', error);
    } finally {
        if (forecastRequests.isCurrent(requestId)) setPageLoading('forecast-view', false);
    }
}
