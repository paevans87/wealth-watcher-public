import { escapeHtml } from '../utils/html.js';

function displayValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('en-GB');
    return String(value ?? '—');
}

/**
 * Renders a keyboard and screen-reader friendly alternative for a canvas
 * chart. The canvas remains the visual presentation, while the details table
 * provides the same information without requiring pointer interaction.
 */
export function renderAccessibleChartData(target, {
    summary = 'View chart data',
    caption = '',
    headers = [],
    rows = [],
    formatCell = null
} = {}) {
    if (!target) return null;

    const headerDefinitions = headers.map(header => (
        typeof header === 'string' ? { key: header, label: header } : header
    ));
    const rowMarkup = rows.length
        ? rows.map(row => `<tr>${headerDefinitions.map(header => {
            const rawValue = typeof formatCell === 'function'
                ? formatCell(row, header.key)
                : row?.[header.key];
            return `<td>${escapeHtml(displayValue(rawValue))}</td>`;
        }).join('')}</tr>`).join('')
        : `<tr><td colspan="${Math.max(1, headerDefinitions.length)}">No chart data available.</td></tr>`;

    target.innerHTML = `
        <summary>${escapeHtml(summary)}</summary>
        ${caption ? `<p class="chart-data-caption">${escapeHtml(caption)}</p>` : ''}
        <div class="chart-data-table-wrap">
            <table class="chart-data-table">
                <thead><tr>${headerDefinitions.map(header => `<th scope="col">${escapeHtml(header.label)}</th>`).join('')}</tr></thead>
                <tbody>${rowMarkup}</tbody>
            </table>
        </div>`;
    return target;
}

export function chartDataRows(labels = [], values = [], labelKey = 'Date', valueKey = 'Value') {
    return labels.map((label, index) => ({
        [labelKey]: label,
        [valueKey]: values[index]
    }));
}
