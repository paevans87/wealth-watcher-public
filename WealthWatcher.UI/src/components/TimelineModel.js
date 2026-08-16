/**
 * Normalizes time-series values before a page-specific renderer decides how
 * to present them. Calendar, history, and dashboard data all arrive with the
 * same loose API shape, so validation and numeric coercion belong here.
 */
export function normalizeTimelineEntries(entries, {
    getDate = entry => entry?.Time ?? entry?.Date ?? entry?.date,
    getValue = entry => entry?.Value ?? entry?.value,
    getObserved = entry => entry?.HasObservation ?? entry?.hasObservation,
    validateDate = date => Boolean(date)
} = {}) {
    if (!Array.isArray(entries)) return [];

    return entries
        .map(entry => {
            const date = getDate(entry);
            const value = Number(getValue(entry));
            if (!date || !validateDate(date) || !Number.isFinite(value)) return null;
            return {
                date: String(date),
                value,
                observed: Boolean(getObserved(entry)),
                source: entry
            };
        })
        .filter(Boolean);
}

export function aggregateTimelineEntries(entries, options = {}) {
    const totals = new Map();
    const observedDates = new Set();
    const normalized = normalizeTimelineEntries(entries, options);

    normalized.forEach(({ date, value, observed }) => {
        totals.set(date, (totals.get(date) || 0) + value);
        if (observed) observedDates.add(date);
    });

    return {
        entries: normalized,
        totals: new Map(Array.from(totals.entries()).sort(([left], [right]) => left.localeCompare(right))),
        observedDates: new Set([...observedDates].sort())
    };
}
