const STATUS_LABELS = Object.freeze({
    1: 'Running',
    2: 'Success',
    3: 'Partial',
    4: 'Failed'
});

function readValue(record, ...keys) {
    for (const key of keys) {
        if (record?.[key] !== undefined && record[key] !== null) {
            return record[key];
        }
    }

    return null;
}

function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function normalizeAuditStatus(value) {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
        const numericValue = Number(value);
        return STATUS_LABELS[numericValue] || String(value);
    }

    const label = String(value ?? '').trim();
    return label || 'Unknown';
}

export function normalizeAuditResponse(response) {
    const rawAudits = readValue(response, 'Audits', 'audits');
    const audits = Array.isArray(rawAudits) ? rawAudits : [];

    return {
        total: toNumber(readValue(response, 'Total', 'total'), audits.length),
        page: toNumber(readValue(response, 'Page', 'page'), 1),
        pageSize: toNumber(readValue(response, 'PageSize', 'pageSize'), 10),
        rows: audits.map(audit => {
            const status = normalizeAuditStatus(readValue(audit, 'Status', 'status'));
            const providerName = readValue(
                audit,
                'ConnectionDisplayNameSnapshot',
                'connectionDisplayNameSnapshot',
                'ProviderName',
                'providerName'
            );

            return {
                startTime: readValue(audit, 'StartTime', 'startTime'),
                providerName: typeof providerName === 'string' && providerName.trim()
                    ? providerName.trim()
                    : 'Manual',
                status,
                statusClass: status.split('/')[0].trim(),
                recordsAdded: readValue(audit, 'RecordsAdded', 'recordsAdded') ?? 0,
                logMessage: readValue(audit, 'LogMessage', 'logMessage', 'Message', 'message') ?? ''
            };
        })
    };
}

function formatAuditTime(startTime) {
    const parsedTime = startTime ? new Date(startTime) : null;
    return parsedTime && !Number.isNaN(parsedTime.getTime())
        ? parsedTime.toLocaleString()
        : '—';
}

function appendAuditCell(documentRef, row, value, className = '') {
    const cell = documentRef.createElement('td');
    if (className) cell.className = className;
    cell.textContent = String(value ?? '');
    row.appendChild(cell);
}

export function renderAuditRows(tbody, rows = []) {
    if (!tbody) return null;
    tbody.innerHTML = '';

    const documentRef = tbody.ownerDocument || globalThis.document;
    if (!documentRef?.createElement) return tbody;

    rows.forEach(audit => {
        const row = documentRef.createElement('tr');
        appendAuditCell(documentRef, row, formatAuditTime(audit.startTime));
        appendAuditCell(documentRef, row, audit.providerName);
        appendAuditCell(documentRef, row, audit.status, `status-${String(audit.statusClass || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`);
        appendAuditCell(documentRef, row, audit.recordsAdded);
        appendAuditCell(documentRef, row, audit.logMessage);
        tbody.appendChild(row);
    });

    return tbody;
}

/**
 * Owns audit pagination, rendering, and button state so the entry point does
 * not need to know how the audit response is shaped or how the modal table is
 * updated.
 */
export function createAuditLogController({
    request,
    getElement = id => globalThis.document?.getElementById?.(id),
    pageSize = 10,
    onError = null
} = {}) {
    let page = 1;
    let pageCount = 1;

    function syncControls(data) {
        const pageInfo = getElement('audit-page-info');
        const previous = getElement('audit-prev');
        const next = getElement('audit-next');
        if (pageInfo) pageInfo.textContent = `Page ${page} of ${pageCount}`;
        if (previous) previous.disabled = page <= 1;
        if (next) next.disabled = page >= pageCount;
        return data;
    }

    async function load(pageDelta = 0) {
        page = Math.max(1, page + Number(pageDelta || 0));
        try {
            const response = await request?.(page, pageSize);
            const data = normalizeAuditResponse(response);
            pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
            page = Math.min(page, pageCount);
            renderAuditRows(getElement('audit-tbody'), data.rows);
            syncControls(data);
            return data;
        } catch (error) {
            onError?.(error);
            return null;
        }
    }

    return {
        load,
        open() {
            page = 1;
            return load(0);
        },
        get page() { return page; },
        get pageCount() { return pageCount; }
    };
}
