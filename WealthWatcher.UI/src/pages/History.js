import { store } from '../store/store.js';
import { fetchFresh, API_BASE_URL } from '../api/apiClient.js';
import { setPageLoading } from '../components/PageLoading.js';

let historyChartInstances = [];
let historySnapshot = null;
let historyPeriod = '1M';
let showHistoryTrend = false;
let historyControlsBound = false;
let historyRequestId = 0;

const HISTORY_PERIODS = ['1H', '1D', '1W', '1M', '3M', '1Y', 'MAX'];
export const HISTORY_TREND_STORAGE_KEY = 'wealthwatcher_history_show_trend';

const currencyFormatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 0
});

const percentFormatter = new Intl.NumberFormat('en-GB', {
    style: 'percent',
    signDisplay: 'always',
    maximumFractionDigits: 1
});

export async function loadHistoryView() {
    const storedTrend = readStoredHistoryTrend();
    if (storedTrend !== null) showHistoryTrend = storedTrend;
    bindHistoryControls();
    return loadHistoryPeriod(historyPeriod);
}

function getHistoryTrendStorage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        return null;
    }
    return null;
}

function readStoredHistoryTrend() {
    const storage = getHistoryTrendStorage();
    if (!storage) return null;
    try {
        return storage.getItem(HISTORY_TREND_STORAGE_KEY) === 'true';
    } catch {
        return null;
    }
}

export function getHistoryTrendPreference(storage = getHistoryTrendStorage()) {
    try {
        return storage?.getItem(HISTORY_TREND_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setHistoryTrendPreference(value, storage = getHistoryTrendStorage()) {
    showHistoryTrend = value === true;
    try {
        storage?.setItem(HISTORY_TREND_STORAGE_KEY, String(showHistoryTrend));
    } catch {
        // localStorage can be unavailable or restricted; the in-memory choice remains usable.
    }
    return showHistoryTrend;
}

async function loadHistoryPeriod(period) {
    const requestId = ++historyRequestId;
    setPageLoading('history-view', true);
    const timeZone = period === '1H'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : null;
    const requestUrl = `${API_BASE_URL}/history?period=${encodeURIComponent(period)}${
        timeZone ? `&timeZone=${encodeURIComponent(timeZone)}` : ''}`;
    try {
        const response = await fetchFresh(requestUrl);
        const results = (response?.Categories || []).map(category => ({
            cat: {
                Id: category.Id,
                Label: category.Label,
                Color: category.Color,
                DisplayOrder: category.DisplayOrder,
                ClassificationValueId: category.ClassificationValueId
            },
            data: category.Aggregate || category
        }));
        if (requestId !== historyRequestId) return;

        historySnapshot = buildHistorySnapshot(results);
        renderHistoryView();
    } finally {
        if (requestId === historyRequestId) setPageLoading('history-view', false);
    }
}

export function buildHistorySnapshot(results) {
    const globalTimeline = new Map();
    const categoryDefinitions = results.length > 0
        ? results.map(result => result.cat)
        : store.state.CATEGORIES;
    const categoryDatasets = categoryDefinitions.map(cat => ({
        id: cat.Id,
        label: cat.Label,
        borderColor: cat.Color || '#06b6d4',
        backgroundColor: hexToRgba(cat.Color || '#06b6d4', 0.16),
        dataMap: new Map(),
        fullData: [],
        lastRecordedValue: null,
        lastRecordedTime: null
    }));
    let latestSync = null;

    results.forEach(({ cat, data }) => {
        const history = Array.isArray(data?.Data) ? data.Data : [];
        const dataset = categoryDatasets.find(d => String(d.id) === String(cat.Id))
            || categoryDatasets.find(d => d.label === cat.Label);

        if (data?.LastSyncDateTime) {
            const sync = new Date(data.LastSyncDateTime);
            if (!Number.isNaN(sync.getTime()) && (!latestSync || sync > latestSync)) {
                latestSync = sync;
            }
        }

        history.forEach(h => {
            const value = Number(h?.Value ?? 0);
            if (dataset && (!dataset.lastRecordedTime || String(h?.Time || '') >= dataset.lastRecordedTime)) {
                dataset.lastRecordedTime = String(h?.Time || '');
                dataset.lastRecordedValue = value;
            }
            if (!shouldIncludeHistoryValue(value)) {
                return;
            }

            const currentGlobal = globalTimeline.get(h.Time) || 0;
            globalTimeline.set(h.Time, currentGlobal + value);
            dataset?.dataMap.set(h.Time, value);
        });
    });

    const dates = Array.from(globalTimeline.keys()).sort();
    const totalData = dates.map(date => globalTimeline.get(date) || 0);

    categoryDatasets.forEach(dataset => {
        dataset.fullData = dates.map(date => (
            dataset.dataMap.has(date) ? dataset.dataMap.get(date) : null
        ));
        delete dataset.dataMap;
    });

    return { dates, totalData, categories: categoryDatasets, latestSync };
}

function getVisibleHistoryData() {
    if (!historySnapshot || historySnapshot.dates.length === 0) {
        return { dates: [], totalData: [], categories: [], startIndex: 0 };
    }

    const categories = historySnapshot.categories
        .map(category => ({
            ...category,
            data: category.fullData.map(value => (
                shouldIncludeHistoryValue(value) ? Number(value) : null
            ))
        }))
        .filter(category => category.data.some(value => value !== null))
        .filter(category => store.state.generalSettings?.showZeroValuesOnHistory === true
            || category.lastRecordedValue !== 0);

    return {
        dates: historySnapshot.dates,
        totalData: historySnapshot.totalData,
        categories,
        startIndex: 0
    };
}

function shouldIncludeHistoryValue(value) {
    if (value === null || value === undefined) return false;
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
        && (numericValue !== 0 || store.state.generalSettings?.showZeroValuesOnHistory === true);
}

function renderHistoryView() {
    historyChartInstances.forEach(chart => chart.destroy());
    historyChartInstances = [];

    const visible = getVisibleHistoryData();
    updateRangeButtonState();
    updateHistorySummary(visible);

    const grid = document.getElementById('history-grid');
    if (grid) grid.innerHTML = '';

    if (visible.dates.length === 0) {
        if (grid) {
            grid.innerHTML = '<div class="history-empty-state">No historical data is available yet.</div>';
        }
        return;
    }

    renderNetWorthChart(visible);
    renderCategoryCharts(visible);
}

function renderNetWorthChart(visible) {
    const canvas = document.getElementById('netWorthChart');
    if (!canvas) return;

    const importantIndices = getImportantPointIndices(visible.totalData);
    const trendData = getTrendData(visible.totalData);
    const netWorthChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: visible.dates,
            datasets: [
                {
                    label: 'Total net worth',
                    data: visible.totalData,
                    borderColor: '#dbeafe',
                    backgroundColor: 'rgba(103, 232, 249, 0.10)',
                    fill: true,
                    tension: 0.18,
                    borderWidth: 2.5,
                    pointRadius: context => importantIndices.has(context.dataIndex) ? 3.5 : 0,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#0f172a',
                    pointBorderColor: '#e0f2fe',
                    pointBorderWidth: 2
                },
                {
                    label: 'Start to latest trend',
                    data: trendData,
                    borderColor: '#22d3ee',
                    borderWidth: 1.5,
                    borderDash: [6, 6],
                    tension: 0,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    hidden: !showHistoryTrend
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 450, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111c31',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(148, 163, 184, 0.18)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        title: contexts => formatFullDate(visible.dates[contexts[0]?.dataIndex]),
                        label: context => {
                            if (window.isObfuscated) return context.datasetIndex === 1 ? 'Trend: £***' : 'Net worth: £***';
                            const label = context.datasetIndex === 1 ? 'Trend' : 'Net worth';
                            return `${label}: ${currencyFormatter.format(context.parsed.y)}`;
                        },
                        afterLabel: context => {
                            if (context.datasetIndex !== 0 || window.isObfuscated) return '';
                            const index = context.dataIndex;
                            if (index === 0) return 'Start of selected range';
                            const change = visible.totalData[index] - visible.totalData[index - 1];
                            return `Daily change: ${formatSignedMoney(change)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(148, 163, 184, 0.07)', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        color: '#8190a8',
                        maxTicksLimit: 9,
                        maxRotation: 0,
                        padding: 8,
                        callback: historyTickCallback
                    }
                },
                y: {
                    grace: '8%',
                    grid: { color: 'rgba(148, 163, 184, 0.08)', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        color: '#8190a8',
                        maxTicksLimit: 6,
                        padding: 8,
                        callback: value => window.isObfuscated ? '£***' : compactCurrencyFormatter.format(value)
                    }
                }
            }
        }
    });
    historyChartInstances.push(netWorthChart);
}

function renderCategoryCharts(visible) {
    const grid = document.getElementById('history-grid');
    if (!grid) return;

    visible.categories.forEach((dataset, index) => {
        const latest = getLastNumber(dataset.data);
        const first = getFirstNumber(dataset.data);
        const change = latest !== null && first !== null ? latest - first : null;
        const displayChange = change !== null && shouldIncludeHistoryValue(change) ? change : null;
        const total = visible.totalData[visible.totalData.length - 1] || 0;
        const share = latest !== null && total > 0 ? latest / total : null;
        const accent = dataset.borderColor;

        const card = document.createElement('div');
        card.className = 'card glass-panel history-chart-card';
        card.innerHTML = `
            <div class="history-card-header" style="--history-accent: ${accent}">
                <div class="history-card-title">
                    <span class="history-card-dot" aria-hidden="true"></span>
                    <h4>${dataset.label}</h4>
                </div>
                <span class="history-card-share obfuscate-val">${formatShare(share)}</span>
            </div>
            <div class="history-card-value obfuscate-val">${formatMoney(latest)}</div>
            <div class="history-card-meta ${displayChange !== null && displayChange < 0 ? 'negative' : ''}">
                <span><span class="obfuscate-val">${formatSignedMoney(displayChange)}</span> over range</span>
                <span class="obfuscate-val">${formatPercentChange(displayChange, first)}</span>
            </div>
            <div class="history-canvas-container">
                <canvas id="historyChart-${index}"></canvas>
            </div>
        `;
        grid.appendChild(card);

        const canvas = document.getElementById(`historyChart-${index}`);
        if (!canvas) return;

        const catChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: visible.dates,
                datasets: [{
                    label: dataset.label,
                    data: dataset.data,
                    borderColor: accent,
                    backgroundColor: dataset.backgroundColor,
                    fill: true,
                    tension: 0.18,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 350, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#111c31',
                        titleColor: '#94a3b8',
                        bodyColor: accent,
                        borderColor: 'rgba(148, 163, 184, 0.18)',
                        borderWidth: 1,
                        padding: 9,
                        displayColors: false,
                        callbacks: {
                            title: contexts => formatFullDate(visible.dates[contexts[0]?.dataIndex]),
                            label: context => window.isObfuscated ? '£***' : currencyFormatter.format(context.parsed.y)
                        }
                    }
                },
                scales: {
                    x: { display: false },
                    y: {
                        grace: '10%',
                        grid: { color: 'rgba(148, 163, 184, 0.07)', drawBorder: false },
                        border: { display: false },
                        ticks: {
                            color: '#8190a8',
                            maxTicksLimit: 4,
                            padding: 6,
                            callback: value => window.isObfuscated ? '£***' : compactCurrencyFormatter.format(value)
                        }
                    }
                }
            }
        });
        historyChartInstances.push(catChart);
    });
}

function updateHistorySummary(visible) {
    const current = getLastNumber(visible.totalData);
    const first = getFirstNumber(visible.totalData);
    const change = current !== null && first !== null ? current - first : null;
    const peak = visible.totalData.length ? Math.max(...visible.totalData) : null;

    setText('history-current-value', formatMoney(current));
    setText('history-period-change', `${formatSignedMoney(change)} (${formatPercentChange(change, first)})`);
    setText('history-peak-value', formatMoney(peak));
    setText('history-last-updated', formatLastUpdated());

    const rangeLabel = visible.dates.length > 0
        ? `${formatFullDate(visible.dates[0])} – ${formatFullDate(visible.dates[visible.dates.length - 1])}`
        : 'No data available';
    setText('history-range-caption', rangeLabel);

    const changeElement = document.getElementById('history-period-change');
    if (changeElement?.classList?.toggle) {
        changeElement.classList.toggle('negative', change !== null && change < 0);
    }
}

function formatLastUpdated() {
    if (historySnapshot?.latestSync) {
        return `Updated ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(historySnapshot.latestSync)}`;
    }
    const lastDate = historySnapshot?.dates?.at(-1);
    return lastDate ? `Updated ${formatFullDate(lastDate)}` : 'Awaiting first sync';
}

function bindHistoryControls() {
    if (historyControlsBound) return;

    HISTORY_PERIODS.forEach(period => {
        const button = document.getElementById(`history-range-${period.toLowerCase()}`);
        if (!button || typeof button.addEventListener !== 'function') return;
        button.addEventListener('click', async () => {
            historyPeriod = period;
            updateRangeButtonState();
            await loadHistoryPeriod(period);
        });
    });

    const trendButton = document.getElementById('history-trend-toggle');
    if (trendButton && typeof trendButton.addEventListener === 'function') {
        trendButton.addEventListener('click', () => {
            showHistoryTrend = !showHistoryTrend;
            setHistoryTrendPreference(showHistoryTrend);
            renderHistoryView();
        });
    }

    historyControlsBound = true;
}

function updateRangeButtonState() {
    HISTORY_PERIODS.forEach(period => {
        const button = document.getElementById(`history-range-${period.toLowerCase()}`);
        if (!button) return;
        button.classList?.toggle?.('active', historyPeriod === period);
        button.setAttribute?.('aria-pressed', String(historyPeriod === period));
    });

    const trendButton = document.getElementById('history-trend-toggle');
    if (trendButton) {
        trendButton.classList?.toggle?.('active', showHistoryTrend);
        trendButton.setAttribute?.('aria-pressed', String(showHistoryTrend));
        if ('textContent' in trendButton) trendButton.textContent = showHistoryTrend ? 'Hide trend' : 'Show trend';
    }
}

function getImportantPointIndices(data) {
    const indices = new Set();
    if (data.length === 0) return indices;

    indices.add(0);
    indices.add(data.length - 1);

    let minIndex = 0;
    let maxIndex = 0;
    let largestMoveIndex = null;
    let largestMove = -1;

    data.forEach((value, index) => {
        if (value < data[minIndex]) minIndex = index;
        if (value > data[maxIndex]) maxIndex = index;
        if (index > 0) {
            const move = Math.abs(value - data[index - 1]);
            if (move > largestMove) {
                largestMove = move;
                largestMoveIndex = index;
            }
        }
    });

    indices.add(minIndex);
    indices.add(maxIndex);
    if (largestMoveIndex !== null) indices.add(largestMoveIndex);
    return indices;
}

function getTrendData(data) {
    if (data.length < 2) return data.slice();
    const start = data[0];
    const end = data[data.length - 1];
    return data.map((_, index) => start + ((end - start) * index) / (data.length - 1));
}

function monthTickCallback(value, index, ticks) {
    const currentLabel = this.getLabelForValue(value);
    const previousTick = ticks[index - 1];
    const previousLabel = previousTick ? this.getLabelForValue(previousTick.value) : null;
    const currentDate = parseHistoryDate(currentLabel);
    const previousDate = previousLabel ? parseHistoryDate(previousLabel) : null;

    if (previousDate
        && currentDate.getMonth() === previousDate.getMonth()
        && currentDate.getFullYear() === previousDate.getFullYear()) {
        return '';
    }
    return formatAxisDate(currentLabel);
}

function historyTickCallback(value, index, ticks) {
    const dateValue = this.getLabelForValue(value);
    if (historyPeriod === '1H' || historyPeriod === '1D') {
        return formatTimeAxisDate(dateValue);
    }
    if (historyPeriod === '1W' || historyPeriod === '1M' || historyPeriod === '3M') {
        return formatDayAxisDate(dateValue);
    }
    return monthTickCallback.call(this, value, index, ticks);
}

function getFirstNumber(values) {
    return values.find(value => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

function getLastNumber(values) {
    for (let index = values.length - 1; index >= 0; index--) {
        if (typeof values[index] === 'number' && Number.isFinite(values[index])) return values[index];
    }
    return null;
}

function formatMoney(value) {
    return value === null || value === undefined ? '—' : currencyFormatter.format(value);
}

function formatSignedMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${currencyFormatter.format(Math.abs(value))}`;
}

function formatPercentChange(change, base) {
    if (change === null || base === null || !Number.isFinite(change) || !Number.isFinite(base) || base === 0) return '—';
    return percentFormatter.format(change / base);
}

function formatShare(share) {
    if (share === null || !Number.isFinite(share)) return '—';
    return `${(share * 100).toFixed(1)}%`;
}

function formatAxisDate(dateValue) {
    if (!dateValue) return '';
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(parseHistoryDate(dateValue));
}

function formatDayAxisDate(dateValue) {
    if (!dateValue) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parseHistoryDate(dateValue));
}

function formatTimeAxisDate(dateValue) {
    if (!dateValue) return '';
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(parseHistoryDate(dateValue));
}

function formatFullDate(dateValue) {
    if (!dateValue) return '';
    const options = historyPeriod === '1H'
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat('en-GB', options).format(parseHistoryDate(dateValue));
}

function parseHistoryDate(dateValue) {
    if (dateValue instanceof Date) return dateValue;
    if (!dateValue) return new Date(NaN);
    return new Date(dateValue.includes('T') ? dateValue : `${dateValue}T00:00:00`);
}

function hexToRgba(color, alpha) {
    if (!color || !color.startsWith('#')) return `rgba(6, 182, 212, ${alpha})`;
    const hex = color.length === 4
        ? color.slice(1).split('').map(part => part + part).join('')
        : color.slice(1);
    const value = Number.parseInt(hex, 16);
    if (Number.isNaN(value)) return `rgba(6, 182, 212, ${alpha})`;
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}
