import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    location: { hostname: 'localhost' }
};

function createCalendarElement() {
    const listeners = new Map();
    const attributes = new Map();

    return {
        innerHTML: '',
        textContent: '',
        className: '',
        hidden: false,
        disabled: false,
        addEventListener(type, listener) {
            const callbacks = listeners.get(type) || [];
            callbacks.push(listener);
            listeners.set(type, callbacks);
        },
        click() {
            return Promise.all((listeners.get('click') || []).map(listener => listener()));
        },
        listenerCount(type) {
            return (listeners.get(type) || []).length;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) || null;
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        querySelector(selector) {
            if (selector === '#calendar-retry') {
                this.retryButton ||= createCalendarElement();
                return this.retryButton;
            }
            return null;
        }
    };
}

const calendarElements = new Map([
    ['calendar-month-label', createCalendarElement()],
    ['calendar-prev-month', createCalendarElement()],
    ['calendar-next-month', createCalendarElement()],
    ['calendar-status', createCalendarElement()],
    ['calendar-month-comparison', createCalendarElement()],
    ['calendar-grid', createCalendarElement()]
]);

const calendarStateElements = new Map();
const calendarHeader = createCalendarElement();
calendarHeader.nextElementSibling = null;
const calendarPanel = createCalendarElement();
const calendarView = {
    querySelector(selector) {
        if (selector === ':scope > header' || selector === 'header') return calendarHeader;
        if (selector === '.calendar-panel') return calendarPanel;
        return null;
    },
    insertBefore(element) {
        calendarStateElements.set(element.id, element);
    },
    prepend(element) {
        calendarStateElements.set(element.id, element);
    },
    appendChild(element) {
        calendarStateElements.set(element.id, element);
    }
};

globalThis.document = {
    getElementById(id) {
        return calendarElements.get(id) || calendarStateElements.get(id) || (id === 'calendar-view' ? calendarView : null);
    },
    createElement() {
        return createCalendarElement();
    }
};

const requestedUrls = [];
const failedCategories = new Set();
let currentObservationCategories = ['pensions', 'investments'];
const responsesByCategory = {
    pensions: [
        { Time: '2024-02-28', Value: 100, HasObservation: true },
        { Time: '2024-02-29', Value: 110, HasObservation: true }
    ],
    investments: [
        { Time: '2024-02-28', Value: 300, HasObservation: true },
        { Time: '2024-02-29', Value: 330, HasObservation: true }
    ]
};

function buildCalendarResponse(year, month) {
    const totals = new Map();
    const observedDates = new Set();
    const categoryIds = new Set(store.state.CATEGORIES.map(category => String(category.Id)));
    Object.entries(responsesByCategory)
        .filter(([category]) => categoryIds.has(category))
        .flatMap(([, points]) => points)
        .forEach(point => {
        totals.set(point.Time, (totals.get(point.Time) || 0) + point.Value);
        if (point.HasObservation) observedDates.add(point.Time);
    });
    const today = '2024-02-29';
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const previous = new Date(`${date}T00:00:00Z`);
        previous.setUTCDate(previous.getUTCDate() - 1);
        const previousDate = previous.toISOString().slice(0, 10);
        const hasTotal = totals.has(date);
        const isFuture = date > today;
        const changeAvailable = !isFuture && hasTotal && totals.has(previousDate)
            && observedDates.has(date) && observedDates.has(previousDate);
        const change = changeAvailable ? totals.get(date) - totals.get(previousDate) : null;
        const previousTotal = totals.get(previousDate);
        days.push({
            Date: date,
            Total: hasTotal ? totals.get(date) : null,
            HasObservation: observedDates.has(date),
            IsFuture: isFuture,
            ChangeAvailable: changeAvailable,
            Change: change,
            Percentage: changeAvailable && previousTotal !== 0
                ? (change / previousTotal) * 100
                : null
        });
    }

    const currentDates = [...totals.keys()]
        .filter(date => date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
            && date <= today && observedDates.has(date))
        .sort();
    const previousMonth = new Date(Date.UTC(year, month - 2, 1));
    const previousPrefix = `${previousMonth.getUTCFullYear()}-${String(previousMonth.getUTCMonth() + 1).padStart(2, '0')}`;
    const previousDates = [...totals.keys()]
        .filter(date => date.startsWith(previousPrefix) && observedDates.has(date))
        .sort();
    const currentDate = currentDates.at(-1) || null;
    const previousDate = previousDates.at(-1) || null;
    const currentTotal = currentDate ? totals.get(currentDate) : null;
    const previousTotal = previousDate ? totals.get(previousDate) : null;
    const comparisonChange = currentTotal !== null && previousTotal !== null
        ? currentTotal - previousTotal
        : null;

    return {
        Year: year,
        Month: month,
        Today: today,
        EarliestHistoryDate: [...totals.keys()].sort()[0] || null,
        Days: days,
        MonthComparison: {
            Available: comparisonChange !== null,
            CurrentDate: currentDate,
            CurrentTotal: currentTotal,
            PreviousDate: previousDate,
            PreviousTotal: previousTotal,
            Change: comparisonChange,
            Percentage: comparisonChange !== null && previousTotal !== 0
                ? (comparisonChange / previousTotal) * 100
                : null
        }
    };
}

globalThis.fetch = async url => {
    requestedUrls.push(url);
    if (url.includes('/calendar')) {
        if ([...failedCategories].length > 0) {
            return { ok: false, status: 503, statusText: 'Unavailable' };
        }
        const query = new URL(url).searchParams;
        return {
            ok: true,
            json: async () => buildCalendarResponse(
                Number(query.get('year')),
                Number(query.get('month')))
        };
    }
    const category = Object.keys(responsesByCategory).find(id => url.includes(`/wealth/${id}/`));

    if (failedCategories.has(category)) {
        return { ok: false, status: 503, statusText: 'Unavailable' };
    }

    return {
        ok: true,
        json: async () => ({ Data: responsesByCategory[category] || [] })
    };
};

const { store } = await import('../store/store.js');
const {
    aggregateCategoryTimelines,
    buildCalendarMonth,
    calculateDailyChange,
    calculateMonthComparison,
    formatDailyChange,
    formatMonthComparison,
    getEarliestHistoryMonth,
    getPreviousCalendarDateKey,
    loadCalendarHistory,
    loadCalendarView
} = await import('./Calendar.js');

test('aggregates every category into one total for each literal ISO date', () => {
    const timeline = aggregateCategoryTimelines([
        {
            data: {
                Data: [
                    { Time: '2024-02-28', Value: 100, HasObservation: true },
                    { Time: '2024-02-29', Value: 120, HasObservation: true }
                ]
            }
        },
        {
            data: {
                Data: [
                    { Time: '2024-02-28', Value: 300, HasObservation: true },
                    { Time: '2024-02-29', Value: 330, HasObservation: true }
                ]
            }
        }
    ]);

    assert.deepEqual(Array.from(timeline.totals.entries()), [
        ['2024-02-28', 400],
        ['2024-02-29', 450]
    ]);
    assert.deepEqual([...timeline.observedDates], ['2024-02-28', '2024-02-29']);
});

test('tracks observed dates separately from carry-forward totals', () => {
    const timeline = aggregateCategoryTimelines([
        {
            data: {
                Data: [
                    { Time: '2024-02-28', Value: 100, HasObservation: true },
                    { Time: '2024-02-29', Value: 100, HasObservation: false }
                ]
            }
        },
        {
            data: {
                Data: [
                    { Time: '2024-02-28', Value: 300, HasObservation: true },
                    { Time: '2024-02-29', Value: 300, HasObservation: false }
                ]
            }
        }
    ]);

    assert.deepEqual(Array.from(timeline.totals.entries()), [
        ['2024-02-28', 400],
        ['2024-02-29', 400]
    ]);
    assert.deepEqual([...timeline.observedDates], ['2024-02-28']);
});

test('includes a newly tracked category from its first observed date onward', () => {
    const timeline = aggregateCategoryTimelines([
        {
            data: {
                Data: [
                    { Time: '2024-02-28', Value: 400, HasObservation: true },
                    { Time: '2024-02-29', Value: 400, HasObservation: false },
                    { Time: '2024-03-01', Value: 400, HasObservation: false }
                ]
            }
        },
        {
            data: {
                Data: [
                    { Time: '2024-03-01', Value: 100, HasObservation: true }
                ]
            }
        }
    ]);

    assert.deepEqual(Array.from(timeline.totals.entries()), [
        ['2024-02-28', 400],
        ['2024-02-29', 400],
        ['2024-03-01', 500]
    ]);
    assert.deepEqual([...timeline.observedDates], ['2024-02-28', '2024-03-01']);
});

test('calculates daily movement only when the preceding calendar day has a total', () => {
    const totals = new Map([
        ['2024-12-31', 100],
        ['2025-01-01', 110],
        ['2025-01-02', 0],
        ['2025-01-03', 25]
    ]);

    assert.deepEqual(calculateDailyChange('2024-12-31', totals), {
        available: false,
        delta: null,
        percentage: null,
        previousDateKey: '2024-12-30',
        previousTotal: null
    });
    assert.deepEqual(calculateDailyChange('2025-01-01', totals), {
        available: true,
        delta: 10,
        percentage: 10,
        previousDateKey: '2024-12-31',
        previousTotal: 100
    });
    assert.deepEqual(calculateDailyChange('2025-01-02', totals), {
        available: true,
        delta: -110,
        percentage: -100,
        previousDateKey: '2025-01-01',
        previousTotal: 110
    });
    assert.deepEqual(calculateDailyChange('2025-01-03', totals), {
        available: true,
        delta: 25,
        percentage: 0,
        previousDateKey: '2025-01-02',
        previousTotal: 0
    });
    assert.deepEqual(calculateDailyChange('2025-01-03', new Map([
        ['2025-01-01', 100],
        ['2025-01-03', 120]
    ])), {
        available: false,
        delta: null,
        percentage: null,
        previousDateKey: '2025-01-02',
        previousTotal: null
    });
    assert.deepEqual(calculateDailyChange('2025-01-03', totals, new Set([
        '2025-01-01',
        '2025-01-03'
    ])), {
        available: false,
        delta: null,
        percentage: null,
        previousDateKey: '2025-01-02',
        previousTotal: null
    });
});

test('formats signed movements with a finite zero-baseline percentage', () => {
    assert.deepEqual(formatDailyChange({ available: true, delta: 12.5, percentage: 4.5 }), {
        amount: '+£12.50',
        percentage: '+4.50%'
    });
    assert.deepEqual(formatDailyChange({ available: true, delta: 0, percentage: 0 }), {
        amount: '£0.00',
        percentage: '0.00%'
    });
    assert.equal(formatDailyChange({ available: false }), null);
});

test('compares the latest observed snapshot in the selected month with the prior month', () => {
    const comparison = calculateMonthComparison(
        { year: 2024, monthIndex: 1 },
        new Map([
            ['2024-01-31', 100],
            ['2024-02-01', 110],
            ['2024-02-02', 120],
            ['2024-02-03', 120]
        ]),
        new Set(['2024-01-31', '2024-02-01', '2024-02-02']),
        new Date(2024, 1, 3, 12)
    );

    assert.equal(comparison.available, true);
    assert.equal(comparison.currentDateKey, '2024-02-02');
    assert.equal(comparison.currentTotal, 120);
    assert.equal(comparison.previousDateKey, '2024-01-31');
    assert.equal(comparison.previousTotal, 100);
    assert.equal(comparison.delta, 20);
    assert.equal(comparison.percentage, 20);
    assert.deepEqual(formatMonthComparison(comparison), {
        amount: '+£20.00',
        percentage: '+20.00%',
        direction: 'up',
        arrow: '↑'
    });
});

test('does not invent a month comparison without an observed prior-month baseline', () => {
    const comparison = calculateMonthComparison(
        { year: 2024, monthIndex: 1 },
        new Map([['2024-02-01', 100]]),
        new Set(['2024-02-01']),
        new Date(2024, 1, 2, 12)
    );

    assert.equal(comparison.available, false);
    assert.equal(formatMonthComparison(comparison), null);
});

test('builds Monday-first leap-year and year-boundary month grids', () => {
    const february = buildCalendarMonth(2024, 1, new Map([
        ['2024-02-28', 400],
        ['2024-02-29', 450]
    ]), new Date(2024, 2, 1));

    assert.equal(february.daysInMonth, 29);
    assert.equal(february.leadingPlaceholderCount, 3);
    assert.equal(february.trailingPlaceholderCount, 3);
    assert.equal(february.cells.length, 35);
    assert.deepEqual(february.cells.slice(0, 3), [
        { type: 'placeholder' },
        { type: 'placeholder' },
        { type: 'placeholder' }
    ]);
    assert.equal(february.cells[3].dateKey, '2024-02-01');
    assert.equal(february.cells[31].dateKey, '2024-02-29');

    const january = buildCalendarMonth(2025, 0, new Map([
        ['2024-12-31', 100],
        ['2025-01-01', 110]
    ]), new Date(2025, 0, 2));
    const newYearsDay = january.cells.find(cell => cell.dateKey === '2025-01-01');

    assert.equal(january.leadingPlaceholderCount, 2);
    assert.equal(newYearsDay.change.delta, 10);
    assert.equal(newYearsDay.change.percentage, 10);
    assert.equal(getPreviousCalendarDateKey('2025-01-01'), '2024-12-31');
    assert.deepEqual(getEarliestHistoryMonth(new Map([
        ['2024-12-31', 100],
        ['2025-01-01', 110]
    ])), {
        year: 2024,
        monthIndex: 11
    });
});

test('keeps genuine flat observations as zero but marks carried-forward days unavailable', () => {
    const february = buildCalendarMonth(2024, 1, new Map([
        ['2024-01-31', 400],
        ['2024-02-01', 400],
        ['2024-02-02', 400],
        ['2024-02-03', 400],
        ['2024-02-04', 410]
    ]), new Date(2024, 1, 3), new Set([
        '2024-01-31',
        '2024-02-01',
        '2024-02-02'
    ]));

    const observedFlatDay = february.cells.find(cell => cell.dateKey === '2024-02-02');
    const carriedForwardDay = february.cells.find(cell => cell.dateKey === '2024-02-03');
    const observedAfterGap = buildCalendarMonth(2024, 1, new Map([
        ['2024-01-31', 400],
        ['2024-02-01', 400],
        ['2024-02-02', 400],
        ['2024-02-03', 400],
        ['2024-02-04', 410]
    ]), new Date(2024, 1, 4), new Set([
        '2024-01-31',
        '2024-02-01',
        '2024-02-02',
        '2024-02-04'
    ])).cells.find(cell => cell.dateKey === '2024-02-04');

    assert.equal(observedFlatDay.hasObservation, true);
    assert.equal(observedFlatDay.change.delta, 0);
    assert.equal(observedFlatDay.change.available, true);
    assert.equal(carriedForwardDay.hasObservation, false);
    assert.equal(carriedForwardDay.change.available, false);
    assert.equal(observedAfterGap.hasObservation, true);
    assert.equal(observedAfterGap.change.available, false);
});

test('loads a selected month through the consolidated calendar endpoint', async () => {
    store.clearCache();
    store.state.CATEGORIES = [
        { Id: 'pensions', Label: 'Pensions', Color: '#8b5cf6' },
        { Id: 'investments', Label: 'Investments', Color: '#10b981' }
    ];
    requestedUrls.length = 0;

    const timeline = await loadCalendarHistory({ year: 2024, monthIndex: 1 });

    assert.deepEqual(requestedUrls, [
        'http://localhost:5000/api/calendar?year=2024&month=2'
    ]);
    assert.deepEqual(Array.from(timeline.totals.entries()), [
        ['2024-02-28', 400],
        ['2024-02-29', 440]
    ]);
    assert.deepEqual([...timeline.observedDates], ['2024-02-28', '2024-02-29']);
});

test('does not fan out to category aggregate endpoints for calendar data', async () => {
    store.clearCache();
    store.state.CATEGORIES = [
        { Id: 'pensions', Label: 'Pensions', Color: '#8b5cf6' },
        { Id: 'investments', Label: 'Investments', Color: '#10b981' }
    ];
    requestedUrls.length = 0;

    await loadCalendarHistory({ year: 2024, monthIndex: 1 });

    assert.deepEqual(requestedUrls, [
        'http://localhost:5000/api/calendar?year=2024&month=2'
    ]);
    currentObservationCategories = ['pensions', 'investments'];
});

test('preserves historical API responses when clearing current-day cache state', () => {
    store.clearCache();
    store.apiCache.history = { Data: [] };
    store.apiCacheMeta.history = { expiresAt: null };
    store.apiCacheTags.history = ['wealth-historical'];
    store.apiCache.current = { Data: [] };
    store.apiCacheMeta.current = { expiresAt: null };
    store.apiCacheTags.current = ['wealth-current'];

    store.clearCache({ preserveTags: ['wealth-historical'] });

    assert.deepEqual(store.apiCache.history, { Data: [] });
    assert.equal(Object.hasOwn(store.apiCache, 'current'), false);
    store.clearCache();
});

test('does not silently omit a category when its history request fails', async () => {
    store.clearCache();
    store.state.CATEGORIES = [
        { Id: 'pensions', Label: 'Pensions', Color: '#8b5cf6' }
    ];
    failedCategories.add('pensions');

    await assert.rejects(
        loadCalendarHistory({ year: 2024, monthIndex: 1 }),
        /Unable to load calendar history\./
    );

    failedCategories.clear();
});

test('renders a navigable Monday-first calendar with signed, private daily changes', async () => {
    store.clearCache();
    store.state.CATEGORIES = [
        { Id: 'pensions', Label: 'Pensions', Color: '#8b5cf6' },
        { Id: 'investments', Label: 'Investments', Color: '#10b981' }
    ];
    responsesByCategory.pensions = [
        { Time: '2024-01-31', Value: 40, HasObservation: true },
        { Time: '2024-02-01', Value: 50, HasObservation: true },
        { Time: '2024-02-02', Value: 50, HasObservation: true },
        { Time: '2024-02-03', Value: 45, HasObservation: true },
        { Time: '2024-02-04', Value: 45, HasObservation: false },
        { Time: '2024-02-05', Value: 45, HasObservation: false },
        { Time: '2024-02-06', Value: 45, HasObservation: true }
    ];
    responsesByCategory.investments = [
        { Time: '2024-01-31', Value: 60, HasObservation: true },
        { Time: '2024-02-01', Value: 60, HasObservation: true },
        { Time: '2024-02-02', Value: 60, HasObservation: true },
        { Time: '2024-02-03', Value: 60, HasObservation: true },
        { Time: '2024-02-04', Value: 60, HasObservation: false },
        { Time: '2024-02-05', Value: 60, HasObservation: false },
        { Time: '2024-02-06', Value: 60, HasObservation: true }
    ];
    requestedUrls.length = 0;

    await loadCalendarView({ currentDate: new Date(2024, 1, 29, 12) });

    const monthLabel = calendarElements.get('calendar-month-label');
    const previousButton = calendarElements.get('calendar-prev-month');
    const nextButton = calendarElements.get('calendar-next-month');
    const status = calendarElements.get('calendar-status');
    const monthComparison = calendarElements.get('calendar-month-comparison');
    const grid = calendarElements.get('calendar-grid');

    assert.equal(monthLabel.textContent, 'February 2024');
    assert.equal(status.textContent, 'Daily change vs previous day');
    assert.match(monthComparison.innerHTML, /↑/);
    assert.match(monthComparison.innerHTML, /\+£5\.00/);
    assert.match(monthComparison.innerHTML, /\+5\.00%/);
    assert.match(monthComparison.innerHTML, /vs January 2024/);
    assert.equal(monthComparison.hidden, false);
    assert.match(monthComparison.getAttribute('aria-label'), /Up from January 2024/);
    assert.equal((grid.innerHTML.match(/calendar-weekday/g) || []).length, 7);
    assert.equal((grid.innerHTML.match(/data-date=/g) || []).length, 29);
    assert.equal((grid.innerHTML.match(/calendar-placeholder/g) || []).length, 6);
    assert.match(grid.innerHTML, /calendar-day-gain/);
    assert.match(grid.innerHTML, /calendar-day-loss/);
    assert.match(grid.innerHTML, /calendar-day-neutral/);
    assert.match(grid.innerHTML, /\+£10\.00/);
    assert.match(grid.innerHTML, /-£5\.00/);
    assert.match(grid.innerHTML, /£0\.00/);
    assert.match(grid.innerHTML, /data-date="2024-02-04" aria-label="2024-02-04: No snapshot recorded"/);
    assert.match(grid.innerHTML, /-4\.55%/);
    assert.match(grid.innerHTML, /calendar-change-amount obfuscate-val/);
    assert.match(grid.innerHTML, /calendar-change-percentage obfuscate-val/);
    assert.match(grid.innerHTML, /data-date="2024-02-06" aria-label="2024-02-06: Previous day snapshot unavailable"/);
    assert.equal(previousButton.getAttribute('aria-label'), 'Previous month');
    assert.equal(nextButton.getAttribute('aria-label'), 'Next month');
    assert.equal(previousButton.listenerCount('click'), 1);
    assert.equal(nextButton.listenerCount('click'), 1);
    assert.equal(previousButton.disabled, false);
    assert.equal(nextButton.disabled, true);

    const requestCountAfterLoad = requestedUrls.length;
    await previousButton.click();
    assert.equal(monthLabel.textContent, 'January 2024');
    assert.equal(previousButton.disabled, true);
    assert.equal(nextButton.disabled, false);
    await previousButton.click();
    assert.equal(monthLabel.textContent, 'January 2024');
    await nextButton.click();
    assert.equal(monthLabel.textContent, 'February 2024');
    assert.equal(nextButton.disabled, true);
    assert.equal(requestedUrls.length, requestCountAfterLoad + 2);

    await loadCalendarView({ currentDate: new Date(2024, 1, 3, 12) });
    assert.equal(previousButton.listenerCount('click'), 1);
    assert.equal(nextButton.listenerCount('click'), 1);
    assert.match(grid.innerHTML, /data-date="2024-02-04" aria-label="2024-02-04: Future date"/);
    assert.equal(requestedUrls.length, requestCountAfterLoad + 3);
});

test('renders a mutually exclusive illustrative empty experience without stale calendar results', async () => {
    store.clearCache();
    store.state.CATEGORIES = [];

    await loadCalendarView({ currentDate: new Date(2024, 1, 29, 12) });

    const previousButton = calendarElements.get('calendar-prev-month');
    const nextButton = calendarElements.get('calendar-next-month');
    const status = calendarElements.get('calendar-status');
    const monthComparison = calendarElements.get('calendar-month-comparison');
    const grid = calendarElements.get('calendar-grid');
    const emptyState = calendarStateElements.get('calendar-empty-state');
    const errorState = calendarStateElements.get('calendar-error-state');

    assert.equal(status.textContent, 'No wealth data is available yet.');
    assert.equal(monthComparison.hidden, true);
    assert.equal(grid.innerHTML, '');
    assert.equal(emptyState.hidden, false);
    assert.match(emptyState.innerHTML, /Illustrative preview/);
    assert.match(emptyState.innerHTML, /not your data/i);
    assert.equal(errorState?.hidden ?? true, true);
    assert.equal(calendarHeader.hidden, true);
    assert.equal(calendarPanel.hidden, true);
    assert.equal(previousButton.disabled, true);
    assert.equal(nextButton.disabled, true);
});

test('renders a distinct calendar error with retry instead of the empty preview', async () => {
    store.clearCache();
    store.state.CATEGORIES = [{ Id: 'pensions', Label: 'Pensions', Color: '#8b5cf6' }];
    failedCategories.add('pensions');

    await loadCalendarView({ currentDate: new Date(2024, 1, 29, 12) });
    failedCategories.clear();

    const status = calendarElements.get('calendar-status');
    const grid = calendarElements.get('calendar-grid');
    const emptyState = calendarStateElements.get('calendar-empty-state');
    const errorState = calendarStateElements.get('calendar-error-state');

    assert.equal(status.textContent, 'Unable to load wealth data. Please try again.');
    assert.equal(grid.innerHTML, '');
    assert.equal(emptyState.hidden, true);
    assert.equal(errorState.hidden, false);
    assert.match(errorState.innerHTML, /We couldn't load your calendar/);
    assert.match(errorState.innerHTML, /calendar-retry/);
    assert.doesNotMatch(errorState.innerHTML, /calendar-preview/);
});
