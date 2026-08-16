import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateTimelineEntries, normalizeTimelineEntries } from './TimelineModel.js';

test('timeline model normalizes numeric values and drops invalid dates', () => {
    const entries = normalizeTimelineEntries([
        { Time: '2026-01-02', Value: '25', HasObservation: true },
        { Time: '', Value: 10 },
        { Time: '2026-01-03', Value: 'not-a-number' }
    ], { validateDate: value => /^2026-/.test(value) });

    assert.deepEqual(entries.map(entry => [entry.date, entry.value, entry.observed]), [
        ['2026-01-02', 25, true]
    ]);
});

test('timeline model aggregates same-date categories in stable date order', () => {
    const result = aggregateTimelineEntries([
        { Date: '2026-01-03', Value: 30, HasObservation: true },
        { Date: '2026-01-02', Value: 10, HasObservation: true },
        { Date: '2026-01-03', Value: 5, HasObservation: false }
    ], { getDate: entry => entry.Date });

    assert.deepEqual([...result.totals.entries()], [['2026-01-02', 10], ['2026-01-03', 35]]);
    assert.deepEqual([...result.observedDates], ['2026-01-02', '2026-01-03']);
});
