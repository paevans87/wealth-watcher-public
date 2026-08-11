import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditResponse } from './AuditLog.js';

test('normalizes the current sync audit response into renderable rows', () => {
    const result = normalizeAuditResponse({
        Total: 1117,
        Page: 1,
        PageSize: 10,
        Audits: [{
            StartTime: '2026-08-05T19:06:45.877026+00:00',
            ConnectionDisplayNameSnapshot: 'ISA',
            Status: 2,
            RecordsAdded: 1,
            LogMessage: 'Account balance pulled'
        }]
    });

    assert.equal(result.total, 1117);
    assert.equal(result.pageSize, 10);
    assert.deepEqual(result.rows[0], {
        startTime: '2026-08-05T19:06:45.877026+00:00',
        providerName: 'ISA',
        status: 'Success',
        statusClass: 'Success',
        recordsAdded: 1,
        logMessage: 'Account balance pulled'
    });
});

test('accepts camel-case responses and preserves detailed string statuses', () => {
    const result = normalizeAuditResponse({
        total: 1,
        page: 2,
        pageSize: 5,
        audits: [{
            startTime: '2026-08-06T08:00:00Z',
            providerName: 'Manual',
            status: 'Partial / 1 warning',
            recordsAdded: 0,
            message: 'Completed with a warning'
        }]
    });

    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 5);
    assert.equal(result.rows[0].status, 'Partial / 1 warning');
    assert.equal(result.rows[0].statusClass, 'Partial');
    assert.equal(result.rows[0].logMessage, 'Completed with a warning');
});
