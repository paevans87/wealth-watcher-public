import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditResponse, renderAuditRows } from './AuditLog.js';

function createDomNode(tagName) {
    return {
        tagName: tagName.toUpperCase(),
        className: '',
        textContent: '',
        children: [],
        appendChild(child) {
            this.children.push(child);
            return child;
        }
    };
}

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

test('renders audit data as text instead of executable HTML', () => {
    const originalDocument = globalThis.document;
    globalThis.document = { createElement: createDomNode };
    const tbody = {
        innerHTML: 'stale markup',
        children: [],
        appendChild(row) {
            this.children.push(row);
        }
    };

    try {
        renderAuditRows(tbody, [{
            startTime: '2026-08-05T19:06:45.877026Z',
            providerName: '<img src=x onerror=alert(1)>',
            status: 'Success',
            statusClass: 'Success',
            recordsAdded: 1,
            logMessage: '</td><script>alert(1)</script>'
        }]);

        assert.equal(tbody.innerHTML, '');
        assert.equal(tbody.children.length, 1);
        assert.equal(tbody.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
        assert.equal(tbody.children[0].children[4].textContent, '</td><script>alert(1)</script>');
    } finally {
        globalThis.document = originalDocument;
    }
});
