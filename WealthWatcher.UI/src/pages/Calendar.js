import { fetchFresh, API_BASE_URL } from '../api/apiClient.js';
import { formatter } from '../utils/formatters.js';
import { setPageLoading } from '../components/PageLoading.js';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDateKey(year, monthIndex, day) {
    return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getHistory(result) {
    if (Array.isArray(result)) return result;
    return result?.data?.Data || result?.Data || [];
}

function unavailableChange(previousDateKey = null) {
    return {
        available: false,
        delta: null,
        percentage: null,
        previousDateKey,
        previousTotal: null
    };
}

export function parseCalendarDateKey(dateKey) {
    const match = ISO_DATE_PATTERN.exec(dateKey || '');
    if (!match) return null;

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, monthIndex, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== monthIndex ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, monthIndex, day };
}

export function getPreviousCalendarDateKey(dateKey) {
    const parts = parseCalendarDateKey(dateKey);
    if (!parts) return null;

    const date = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
    date.setUTCDate(date.getUTCDate() - 1);

    return toDateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function aggregateCategoryTimelines(categoryResults) {
    const globalTimeline = new Map();
    const observedDates = new Set();

    categoryResults.forEach(result => {
        getHistory(result).forEach(entry => {
            if (!parseCalendarDateKey(entry?.Time)) return;

            const value = Number(entry.Value);
            if (!Number.isFinite(value)) return;

            const currentTotal = globalTimeline.get(entry.Time) || 0;
            globalTimeline.set(entry.Time, currentTotal + value);

            if (entry.HasObservation) {
                observedDates.add(entry.Time);
            }
        });
    });

    return {
        totals: new Map(Array.from(globalTimeline.entries()).sort(([left], [right]) => left.localeCompare(right))),
        observedDates
    };
}

export function calculateDailyChange(dateKey, totals, observedDates = null) {
    const previousDateKey = getPreviousCalendarDateKey(dateKey);
    if (
        !previousDateKey ||
        !totals?.has(dateKey) ||
        !totals.has(previousDateKey) ||
        (observedDates && (!observedDates.has(dateKey) || !observedDates.has(previousDateKey)))
    ) {
        return unavailableChange(previousDateKey);
    }

    const total = totals.get(dateKey);
    const previousTotal = totals.get(previousDateKey);
    if (!Number.isFinite(total) || !Number.isFinite(previousTotal)) {
        return unavailableChange(previousDateKey);
    }

    const delta = total - previousTotal;
    const percentage = previousTotal === 0 ? 0 : (delta / previousTotal) * 100;

    return {
        available: true,
        delta,
        percentage: Number.isFinite(percentage) ? percentage : 0,
        previousDateKey,
        previousTotal
    };
}

export function formatDailyChange(change) {
    if (!change?.available) return null;

    const amountSign = change.delta > 0 ? '+' : '';
    const percentageSign = change.percentage > 0 ? '+' : '';

    return {
        amount: `${amountSign}${formatter.format(change.delta)}`,
        percentage: `${percentageSign}${change.percentage.toFixed(2)}%`
    };
}

export function getLatestObservedTotalInMonth(month, totals = new Map(), observedDates = null, latestDateKey = null) {
    if (!month || !Number.isInteger(month.year) || !Number.isInteger(month.monthIndex)) {
        return null;
    }

    let latest = null;
    for (const [dateKey, total] of totals?.entries?.() || []) {
        const parts = parseCalendarDateKey(dateKey);
        if (
            !parts ||
            parts.year !== month.year ||
            parts.monthIndex !== month.monthIndex ||
            (latestDateKey && dateKey > latestDateKey) ||
            (observedDates && !observedDates.has(dateKey)) ||
            !Number.isFinite(total)
        ) {
            continue;
        }

        if (!latest || dateKey > latest.dateKey) {
            latest = { dateKey, total };
        }
    }

    return latest;
}

export function calculateMonthComparison(month, totals = new Map(), observedDates = null, currentDate = new Date()) {
    const viewDate = currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
        ? currentDate
        : new Date();
    const browserMonth = {
        year: viewDate.getFullYear(),
        monthIndex: viewDate.getMonth()
    };
    const currentMonthLimit = month && compareMonths(month, browserMonth) === 0
        ? toDateKey(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate())
        : null;
    const previousMonth = month ? moveMonth(month, -1) : null;
    const currentPoint = getLatestObservedTotalInMonth(month, totals, observedDates, currentMonthLimit);
    const previousPoint = getLatestObservedTotalInMonth(previousMonth, totals, observedDates);

    if (!currentPoint || !previousPoint) {
        return {
            available: false,
            currentDateKey: currentPoint?.dateKey || null,
            currentTotal: currentPoint?.total ?? null,
            previousDateKey: previousPoint?.dateKey || null,
            previousTotal: previousPoint?.total ?? null,
            previousMonth
        };
    }

    const delta = currentPoint.total - previousPoint.total;
    const percentage = previousPoint.total === 0 ? null : (delta / previousPoint.total) * 100;

    return {
        available: true,
        currentDateKey: currentPoint.dateKey,
        currentTotal: currentPoint.total,
        previousDateKey: previousPoint.dateKey,
        previousTotal: previousPoint.total,
        previousMonth,
        delta,
        percentage: percentage === null || Number.isFinite(percentage) ? percentage : null
    };
}

export function formatMonthComparison(comparison) {
    if (!comparison?.available) return null;

    const amountSign = comparison.delta > 0 ? '+' : '';
    const percentageSign = comparison.percentage > 0 ? '+' : '';

    return {
        amount: `${amountSign}${formatter.format(comparison.delta)}`,
        percentage: comparison.percentage === null
            ? '—'
            : `${percentageSign}${comparison.percentage.toFixed(2)}%`,
        direction: comparison.delta > 0 ? 'up' : comparison.delta < 0 ? 'down' : 'flat',
        arrow: comparison.delta > 0 ? '↑' : comparison.delta < 0 ? '↓' : '→'
    };
}

export function buildCalendarMonth(year, monthIndex, totals = new Map(), currentDate = new Date(), observedDates = null) {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
        throw new RangeError('Calendar month requires a valid year and zero-based month index.');
    }

    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const firstWeekdaySundayFirst = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const leadingPlaceholderCount = (firstWeekdaySundayFirst + 6) % 7;
    const todayKey = toDateKey(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const cells = Array.from({ length: leadingPlaceholderCount }, () => ({ type: 'placeholder' }));

    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateKey = toDateKey(year, monthIndex, day);
        const isFuture = dateKey > todayKey;
        const hasTotal = totals.has(dateKey);
        const hasObservation = observedDates ? observedDates.has(dateKey) : hasTotal;
        const change = isFuture
            ? unavailableChange(getPreviousCalendarDateKey(dateKey))
            : hasObservation
                ? calculateDailyChange(dateKey, totals, observedDates)
                : unavailableChange(getPreviousCalendarDateKey(dateKey));

        cells.push({
            type: 'day',
            dateKey,
            day,
            total: hasTotal ? totals.get(dateKey) : null,
            hasTotal,
            hasObservation,
            isFuture,
            change,
            state: !change.available
                ? 'unavailable'
                : change.delta > 0
                    ? 'gain'
                    : change.delta < 0
                        ? 'loss'
                        : 'neutral'
        });
    }

    const trailingPlaceholderCount = (7 - (cells.length % 7)) % 7;
    cells.push(...Array.from({ length: trailingPlaceholderCount }, () => ({ type: 'placeholder' })));

    return {
        year,
        monthIndex,
        daysInMonth,
        leadingPlaceholderCount,
        trailingPlaceholderCount,
        cells
    };
}

export function getEarliestHistoryMonth(totals) {
    const earliestDateKey = Array.from(totals?.keys() || []).sort()[0];
    const parts = parseCalendarDateKey(earliestDateKey);

    return parts ? { year: parts.year, monthIndex: parts.monthIndex } : null;
}

function getUtcDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function getCurrentObservationCategories(result) {
    const categories = result?.Categories || result?.categories || result;
    return Array.isArray(categories) ? new Set(categories.map(category => String(category))) : new Set();
}

export function mergeHistoricalAndCurrentData(historical, current, historicalEndDate) {
    const points = new Map();
    getHistory(historical).forEach(point => {
        if (parseCalendarDateKey(point?.Time)) points.set(point.Time, point);
    });
    getHistory(current).forEach(point => {
        if (parseCalendarDateKey(point?.Time) && point.Time > historicalEndDate) {
            points.set(point.Time, point);
        }
    });

    return {
        Data: Array.from(points.values()).sort((left, right) => left.Time.localeCompare(right.Time))
    };
}

export async function loadCalendarHistory({ year, monthIndex } = {}) {
    const viewDate = new Date();
    const selectedYear = Number.isInteger(year) ? year : viewDate.getFullYear();
    const selectedMonthIndex = Number.isInteger(monthIndex) ? monthIndex : viewDate.getMonth();
    const response = await fetchFresh(
        `${API_BASE_URL}/calendar?year=${selectedYear}&month=${selectedMonthIndex + 1}`);
    if (!response) {
        throw new Error('Unable to load calendar history.');
    }

    const days = Array.isArray(response.Days) ? response.Days : [];
    const totals = new Map();
    const observedDates = new Set();
    days.forEach(day => {
        if (!parseCalendarDateKey(day?.Date)) return;
        if (day.Total !== null && day.Total !== undefined && Number.isFinite(Number(day.Total))) {
            totals.set(day.Date, Number(day.Total));
        }
        if (day.HasObservation) observedDates.add(day.Date);
    });

    return {
        totals,
        observedDates,
        days,
        monthComparison: response.MonthComparison || null,
        earliestHistoryDate: response.EarliestHistoryDate || null,
        response
    };
}

function emptyCalendarTimeline() {
    return {
        totals: new Map(),
        observedDates: new Set()
    };
}

export const CALENDAR_DOM_IDS = Object.freeze({
    monthLabel: 'calendar-month-label',
    previousButton: 'calendar-prev-month',
    nextButton: 'calendar-next-month',
    status: 'calendar-status',
    monthComparison: 'calendar-month-comparison',
    grid: 'calendar-grid'
});

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let calendarViewState = {
    currentDate: new Date(),
    currentMonth: null,
    currentBrowserMonth: null,
    earliestHistoryMonth: null,
    totals: new Map(),
    observedDates: new Set(),
    days: [],
    monthComparison: null,
    status: 'loading'
};

let boundPreviousButton = null;
let boundNextButton = null;

function getCalendarElements() {
    if (typeof document === 'undefined') return {};

    return {
        monthLabel: document.getElementById(CALENDAR_DOM_IDS.monthLabel),
        previousButton: document.getElementById(CALENDAR_DOM_IDS.previousButton),
        nextButton: document.getElementById(CALENDAR_DOM_IDS.nextButton),
        status: document.getElementById(CALENDAR_DOM_IDS.status),
        monthComparison: document.getElementById(CALENDAR_DOM_IDS.monthComparison),
        grid: document.getElementById(CALENDAR_DOM_IDS.grid)
    };
}

function getValidCurrentDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    return new Date();
}

function getMonthFromDate(date) {
    return {
        year: date.getFullYear(),
        monthIndex: date.getMonth()
    };
}

function compareMonths(left, right) {
    return (left.year * 12 + left.monthIndex) - (right.year * 12 + right.monthIndex);
}

function moveMonth(month, offset) {
    const totalMonths = month.year * 12 + month.monthIndex + offset;
    return {
        year: Math.floor(totalMonths / 12),
        monthIndex: ((totalMonths % 12) + 12) % 12
    };
}

function formatMonthLabel(month) {
    return new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric'
    }).format(new Date(month.year, month.monthIndex, 1));
}

function getStatusMessage() {
    if (calendarViewState.status === 'loading') {
        return 'Loading daily portfolio history…';
    }

    if (calendarViewState.status === 'empty') {
        return 'No wealth data is available yet.';
    }

    if (calendarViewState.status === 'error') {
        return 'Unable to load wealth data. Please try again.';
    }

    return 'Daily change vs previous day';
}

function renderMonthComparison(elements) {
    if (!elements.monthComparison) return;

    if (calendarViewState.status === 'loading') {
        elements.monthComparison.textContent = 'Comparing with previous month…';
        elements.monthComparison.className = 'calendar-month-comparison calendar-month-comparison-loading';
        elements.monthComparison.hidden = false;
        return;
    }

    if (calendarViewState.status !== 'ready') {
        elements.monthComparison.textContent = '';
        elements.monthComparison.className = 'calendar-month-comparison';
        elements.monthComparison.hidden = true;
        return;
    }

    const serverComparison = calendarViewState.monthComparison;
    const comparison = serverComparison
        ? {
            available: serverComparison.Available ?? serverComparison.available ?? false,
            currentDateKey: serverComparison.CurrentDate ?? serverComparison.currentDateKey ?? null,
            currentTotal: serverComparison.CurrentTotal ?? serverComparison.currentTotal ?? null,
            previousDateKey: serverComparison.PreviousDate ?? serverComparison.previousDateKey ?? null,
            previousTotal: serverComparison.PreviousTotal ?? serverComparison.previousTotal ?? null,
            previousMonth: moveMonth(calendarViewState.currentMonth, -1),
            delta: serverComparison.Change ?? serverComparison.delta ?? null,
            percentage: serverComparison.Percentage ?? serverComparison.percentage ?? null
        }
        : calculateMonthComparison(
            calendarViewState.currentMonth,
            calendarViewState.totals,
            calendarViewState.observedDates,
            calendarViewState.currentDate
        );

    if (!comparison.available) {
        elements.monthComparison.textContent = 'No previous month baseline';
        elements.monthComparison.className = 'calendar-month-comparison calendar-month-comparison-unavailable';
        elements.monthComparison.setAttribute('aria-label', 'No previous month baseline available');
        elements.monthComparison.hidden = false;
        return;
    }

    const formatted = formatMonthComparison(comparison);
    const previousMonthLabel = formatMonthLabel(comparison.previousMonth);
    const percentageLabel = formatted.percentage === '—' ? 'percentage unavailable' : formatted.percentage;
    const directionLabel = formatted.direction === 'up'
        ? 'Up'
        : formatted.direction === 'down'
            ? 'Down'
            : 'No change';

    elements.monthComparison.innerHTML = `
        <span class="calendar-month-comparison-arrow" aria-hidden="true">${formatted.arrow}</span>
        <span class="calendar-month-comparison-values">
            <span class="calendar-month-comparison-amount obfuscate-val">${formatted.amount}</span>
            <span class="calendar-month-comparison-percentage obfuscate-val">${formatted.percentage}</span>
        </span>
        <span class="calendar-month-comparison-label">vs ${previousMonthLabel}</span>`;
    elements.monthComparison.className = `calendar-month-comparison calendar-month-comparison-${formatted.direction}`;
    elements.monthComparison.setAttribute(
        'aria-label',
        `${directionLabel} from ${previousMonthLabel}: ${formatted.amount}, ${percentageLabel}`
    );
    elements.monthComparison.hidden = false;
}

function renderCalendarCell(cell) {
    if (cell.type === 'placeholder') {
        return '<div class="calendar-cell calendar-placeholder" aria-hidden="true"></div>';
    }

    const dayLabel = `<time class="calendar-day-number" datetime="${cell.dateKey}">${cell.day}</time>`;
    if (!cell.change.available) {
        const unavailableReason = cell.isFuture
            ? 'Future date'
            : !cell.hasObservation
                ? 'No snapshot recorded'
                : cell.hasTotal
                    ? 'Previous day snapshot unavailable'
                    : 'No wealth data';

        return `
            <div class="calendar-cell calendar-day calendar-day-unavailable" role="gridcell" data-date="${cell.dateKey}" aria-label="${cell.dateKey}: ${unavailableReason}">
                ${dayLabel}
                <span class="calendar-change-unavailable" aria-label="${unavailableReason}">—</span>
            </div>`;
    }

    const formattedChange = formatDailyChange(cell.change);
    const changeClass = cell.state === 'gain'
        ? 'text-green'
        : cell.state === 'loss'
            ? 'text-red'
            : 'calendar-change-neutral';

    return `
        <div class="calendar-cell calendar-day calendar-day-${cell.state}" role="gridcell" data-date="${cell.dateKey}" aria-label="${cell.dateKey}: ${formattedChange.amount}, ${formattedChange.percentage}">
            ${dayLabel}
            <div class="calendar-change ${changeClass}">
                <span class="calendar-change-amount obfuscate-val">${formattedChange.amount}</span>
                <span class="calendar-change-percentage obfuscate-val">${formattedChange.percentage}</span>
            </div>
        </div>`;
}

function renderCalendarWeekdayHeadings() {
    return WEEKDAY_LABELS.map(day =>
        `<div class="calendar-weekday" role="columnheader" aria-label="${day}">${day}</div>`
    ).join('');
}

function renderCalendarSkeleton(monthLabel) {
    const { currentMonth } = calendarViewState;
    const month = buildCalendarMonth(
        currentMonth.year,
        currentMonth.monthIndex,
        new Map(),
        calendarViewState.currentDate,
        new Set()
    );
    const cells = month.cells.map(cell => cell.type === 'placeholder'
        ? '<div class="calendar-skeleton-cell calendar-skeleton-placeholder" aria-hidden="true"></div>'
        : `
            <div class="calendar-skeleton-cell" aria-hidden="true">
                <span class="skeleton skeleton-calendar-number"></span>
                <span class="skeleton skeleton-calendar-value"></span>
                <span class="skeleton skeleton-calendar-change"></span>
            </div>`
    ).join('');

    return `
        <div class="calendar-grid-content calendar-skeleton-grid" role="grid" aria-label="${monthLabel} daily portfolio changes loading">
            ${renderCalendarWeekdayHeadings()}
            ${cells}
        </div>`;
}

function updateCalendarControls(elements) {
    const { currentMonth, currentBrowserMonth, earliestHistoryMonth } = calendarViewState;
    if (!currentMonth || !currentBrowserMonth) return;

    const previousDisabled = !earliestHistoryMonth || compareMonths(currentMonth, earliestHistoryMonth) <= 0;
    const nextDisabled = compareMonths(currentMonth, currentBrowserMonth) >= 0;

    if (elements.previousButton) {
        elements.previousButton.disabled = previousDisabled;
        elements.previousButton.setAttribute('aria-disabled', String(previousDisabled));
    }

    if (elements.nextButton) {
        elements.nextButton.disabled = nextDisabled;
        elements.nextButton.setAttribute('aria-disabled', String(nextDisabled));
    }
}

function applyServerCalendarDays(month) {
    const daysByDate = new Map(
        (calendarViewState.days || [])
            .filter(day => day?.Date)
            .map(day => [day.Date, day])
    );

    return {
        ...month,
        cells: month.cells.map(cell => {
            if (cell.type !== 'day' || !daysByDate.has(cell.dateKey)) return cell;

            const day = daysByDate.get(cell.dateKey);
            const changeAvailable = day.ChangeAvailable === true;
            const change = changeAvailable
                ? {
                    available: true,
                    delta: Number(day.Change) || 0,
                    percentage: Number.isFinite(Number(day.Percentage)) ? Number(day.Percentage) : 0,
                    previousDateKey: getPreviousCalendarDateKey(cell.dateKey),
                    previousTotal: null
                }
                : unavailableChange(getPreviousCalendarDateKey(cell.dateKey));

            return {
                ...cell,
                total: day.Total === null || day.Total === undefined ? null : Number(day.Total),
                hasTotal: day.Total !== null && day.Total !== undefined,
                hasObservation: day.HasObservation === true,
                isFuture: cell.isFuture || day.IsFuture === true,
                change,
                state: !change.available
                    ? 'unavailable'
                    : change.delta > 0
                        ? 'gain'
                        : change.delta < 0
                            ? 'loss'
                            : 'neutral'
            };
        })
    };
}

function renderCalendarView() {
    const elements = getCalendarElements();
    const { currentMonth } = calendarViewState;
    if (!currentMonth) return;

    const monthLabel = formatMonthLabel(currentMonth);
    if (elements.monthLabel) {
        elements.monthLabel.textContent = monthLabel;
    }

    if (elements.status) {
        elements.status.textContent = getStatusMessage();
        elements.status.className = `calendar-status calendar-status-${calendarViewState.status}`;
        elements.status.setAttribute('aria-live', 'polite');
    }

    renderMonthComparison(elements);

    if (elements.grid) {
        if (calendarViewState.status === 'loading') {
            elements.grid.innerHTML = renderCalendarSkeleton(monthLabel);
        } else {
            const month = applyServerCalendarDays(buildCalendarMonth(
                currentMonth.year,
                currentMonth.monthIndex,
                calendarViewState.totals,
                calendarViewState.currentDate,
                calendarViewState.observedDates
            ));

            elements.grid.innerHTML = `
                <div class="calendar-grid-content" role="grid" aria-label="${monthLabel} daily portfolio changes">
                    ${renderCalendarWeekdayHeadings()}
                    ${month.cells.map(renderCalendarCell).join('')}
                </div>`;
        }
    }

    updateCalendarControls(elements);
}

async function loadCalendarMonth(month) {
    setPageLoading('calendar-view', true);
    try {
        const timeline = await loadCalendarHistory({
            year: month.year,
            monthIndex: month.monthIndex
        });
        calendarViewState.totals = timeline.totals;
        calendarViewState.observedDates = timeline.observedDates;
        calendarViewState.days = timeline.days;
        calendarViewState.monthComparison = timeline.monthComparison;
        if (timeline.earliestHistoryDate) {
            const earliest = parseCalendarDateKey(timeline.earliestHistoryDate);
            calendarViewState.earliestHistoryMonth = earliest
                ? { year: earliest.year, monthIndex: earliest.monthIndex }
                : null;
        } else {
            calendarViewState.earliestHistoryMonth = getEarliestHistoryMonth(timeline.totals);
        }
        calendarViewState.status = timeline.totals.size > 0 ? 'ready' : 'empty';
        renderCalendarView();
        return timeline;
    } finally {
        setPageLoading('calendar-view', false);
    }
}

async function changeCalendarMonth(offset) {
    const { currentMonth, currentBrowserMonth, earliestHistoryMonth } = calendarViewState;
    if (!currentMonth || !currentBrowserMonth) return;

    const targetMonth = moveMonth(currentMonth, offset);
    if (
        compareMonths(targetMonth, currentBrowserMonth) > 0 ||
        (offset < 0 && (!earliestHistoryMonth || compareMonths(targetMonth, earliestHistoryMonth) < 0))
    ) {
        return;
    }

    calendarViewState.currentMonth = targetMonth;
    calendarViewState.status = 'loading';
    calendarViewState.totals = new Map();
    calendarViewState.observedDates = new Set();
    calendarViewState.days = [];
    calendarViewState.monthComparison = null;
    renderCalendarView();

    try {
        return await loadCalendarMonth(targetMonth);
    } catch (error) {
        console.error('Error loading calendar month:', error);
        calendarViewState.status = 'error';
        renderCalendarView();
        return emptyCalendarTimeline();
    }
}

function bindCalendarControls(elements) {
    if (elements.previousButton && elements.previousButton !== boundPreviousButton) {
        elements.previousButton.setAttribute('aria-label', 'Previous month');
        elements.previousButton.addEventListener('click', () => changeCalendarMonth(-1));
        boundPreviousButton = elements.previousButton;
    }

    if (elements.nextButton && elements.nextButton !== boundNextButton) {
        elements.nextButton.setAttribute('aria-label', 'Next month');
        elements.nextButton.addEventListener('click', () => changeCalendarMonth(1));
        boundNextButton = elements.nextButton;
    }
}

export async function loadCalendarView({ currentDate } = {}) {
    const viewDate = getValidCurrentDate(currentDate);
    const currentBrowserMonth = getMonthFromDate(viewDate);

    calendarViewState = {
        currentDate: viewDate,
        currentMonth: currentBrowserMonth,
        currentBrowserMonth,
        earliestHistoryMonth: null,
        totals: new Map(),
        observedDates: new Set(),
        days: [],
        monthComparison: null,
        status: 'loading'
    };

    const elements = getCalendarElements();
    bindCalendarControls(elements);
    renderCalendarView();

    try {
        const timeline = await loadCalendarMonth(currentBrowserMonth);
        return timeline;
    } catch (error) {
        console.error('Error loading calendar view:', error);
        calendarViewState.status = 'error';
        renderCalendarView();
        return emptyCalendarTimeline();
    }
}
