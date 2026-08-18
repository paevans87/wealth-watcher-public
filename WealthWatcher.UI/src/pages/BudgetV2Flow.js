import { escapeHtml, safeCssColor } from '../utils/html.js';

const FLOW_WIDTH = 920;
const FLOW_HEIGHT = 420;
const FLOW_TOP = 72;
const FLOW_BOTTOM = 348;
const SOURCE_X = 48;
const TARGET_X = 690;
const NODE_WIDTH = 22;
const FLOW_GAP = 18;

function finiteAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatAmount(value, formatter, obfuscated) {
    if (obfuscated) return '£***';
    if (typeof formatter === 'function') return formatter(value);
    return `£${Number(value || 0).toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function actionAttributes(action) {
    if (!action) return '';
    if (action.type === 'navigation') {
        return ` data-budget-v2-flow-navigation="${escapeHtml(action.navigation)}"`;
    }
    if (action.type === 'group') {
        return ` data-budget-v2-flow-action="group" data-budget-group="${escapeHtml(action.groupId)}"`;
    }
    if (action.type === 'category') {
        return ` data-budget-v2-flow-action="category" data-budget-group="${escapeHtml(action.groupId)}" data-budget-category="${escapeHtml(action.category)}"`;
    }
    return '';
}

function buildNavigation(model) {
    const buttons = [];
    if (model.view.level !== 'overview') {
        buttons.push('<button type="button" class="action-btn budget-drilldown-button" data-budget-v2-flow-navigation="all">&larr; All groups</button>');
        if (model.view.level === 'item') {
            buttons.push(`<button type="button" class="action-btn budget-drilldown-button" data-budget-v2-flow-navigation="back">&larr; ${escapeHtml(model.groupName || 'Group')} categories</button>`);
        }
    }
    if (model.view.level === 'overview') {
        buttons.push('<span class="budget-flow-hint">Select a group to drill into categories</span>');
    } else {
        buttons.push(`<span class="budget-flow-breadcrumb" aria-current="step">${escapeHtml(model.summary)}</span>`);
    }
    return buttons.join('');
}

function buildNode({ x, y, height, labelX, labelY, label, value, color, action, formatter, obfuscated, source = false }) {
    const interactive = Boolean(action);
    const isCategory = action?.type === 'category' && !source;
    const actionMarkup = actionAttributes(action);
    const actionLabel = action?.ariaLabel
        || (action?.type === 'navigation'
            ? `Back from ${label}`
            : action?.type === 'category'
                ? `View ${label} category breakdown`
                : `View ${label} breakdown`);
    const safeHeight = Math.max(Number(height) || 0, 0);
    const textAnchor = source ? 'end' : 'start';
    const textY = labelY + Math.max(safeHeight / 2, 4) - 4;
    const valueY = labelY + Math.max(safeHeight / 2, 4) + 16;
    const visualLabelX = isCategory ? labelX + 10 : labelX;
    const roleMarkup = interactive
        ? ` role="button" tabindex="0" aria-label="${escapeHtml(actionLabel)}"${actionMarkup}`
        : '';
    const hitX = Math.max(0, x - 230);
    const hitRight = source
        ? x + NODE_WIDTH + 10
        : Math.min(FLOW_WIDTH, visualLabelX + 230);
    const hitWidth = Math.max(hitRight - hitX, NODE_WIDTH + 20);
    const categoryMarker = isCategory
        ? `<circle class="budget-flow-svg-category-marker" cx="${(labelX + 2).toFixed(2)}" cy="${(textY - 4).toFixed(2)}" r="2.5" fill="${safeCssColor(color)}" opacity="0.58" aria-hidden="true"></circle>`
        : '';
    return `<g class="budget-v2-flow-node-group${interactive ? ' is-interactive' : ''}${isCategory ? ' is-category' : ''}"${roleMarkup}>
        ${interactive ? `<rect class="budget-flow-node-hit-area" x="${hitX.toFixed(2)}" y="${Math.max(0, y - 12).toFixed(2)}" width="${hitWidth.toFixed(2)}" height="${Math.max(safeHeight + 24, 48).toFixed(2)}" fill="#fff" opacity="0" aria-hidden="true"></rect>` : ''}
        <rect class="budget-v2-flow-node" x="${x}" y="${y.toFixed(2)}" width="${NODE_WIDTH}" height="${safeHeight.toFixed(2)}" rx="5" fill="${safeCssColor(color)}" aria-hidden="true"></rect>
        ${categoryMarker}
        <text class="budget-flow-svg-label" x="${visualLabelX}" y="${textY.toFixed(2)}" text-anchor="${textAnchor}" aria-hidden="true">${escapeHtml(label)}</text>
        <text class="budget-flow-svg-value obfuscate-val" x="${visualLabelX}" y="${valueY.toFixed(2)}" text-anchor="${textAnchor}" aria-hidden="true">${escapeHtml(formatAmount(value, formatter, obfuscated))}</text>
    </g>`;
}

function buildFlowSvg(model, formatter, obfuscated) {
    const rows = model.rows.filter(row => finiteAmount(row.value) > 0 || row.action);
    const sourceValue = finiteAmount(model.source?.value);
    const rowTotal = rows.reduce((total, row) => total + finiteAmount(row.value), 0);
    const availableHeight = FLOW_BOTTOM - FLOW_TOP;
    const gap = rows.length > 1 ? FLOW_GAP : 0;
    const gapTotal = gap * Math.max(0, rows.length - 1);
    const scale = Math.min(Math.max(availableHeight - gapTotal, 1) / Math.max(sourceValue, rowTotal, 1), 1);
    const rawTargetHeights = rows.map(row => Math.max(finiteAmount(row.value) * scale, row.value > 0 ? 0 : 24));
    const rawStackHeight = rawTargetHeights.reduce((total, height) => total + height, 0) + gapTotal;
    const fitScale = rawStackHeight > availableHeight ? availableHeight / rawStackHeight : 1;
    const targetHeights = rawTargetHeights.map(height => height * fitScale);
    const flowHeight = targetHeights.reduce((total, height) => total + height, 0) + gapTotal;
    const sourceHeight = rows.length ? flowHeight : 30;
    const sourceY = (FLOW_HEIGHT - sourceHeight) / 2;
    let targetY = sourceY;
    let sourceOffset = 0;
    const controlX = SOURCE_X + 310;
    const linkMarkup = [];
    const targetMarkup = [];

    rows.forEach((row, index) => {
        const height = targetHeights[index];
        const sourceCenter = sourceY + sourceOffset + height / 2;
        const targetCenter = targetY + height / 2;
        linkMarkup.push(`<path class="budget-v2-flow-link" d="M ${SOURCE_X + NODE_WIDTH} ${sourceCenter.toFixed(2)} C ${controlX} ${sourceCenter.toFixed(2)}, ${controlX} ${targetCenter.toFixed(2)}, ${TARGET_X} ${targetCenter.toFixed(2)}" stroke="${safeCssColor(row.color)}" stroke-width="${Math.max(2, height).toFixed(2)}" opacity="0.72" fill="none" aria-hidden="true"></path>`);
        targetMarkup.push(buildNode({
            x: TARGET_X,
            y: targetY,
            height,
            labelX: TARGET_X + NODE_WIDTH + 18,
            labelY: targetY,
            label: row.label,
            value: row.value,
            color: row.color,
            action: row.action,
            formatter,
            obfuscated
        }));
        sourceOffset += height + gap;
        targetY += height + gap;
    });

    return `<svg class="budget-flow-svg budget-v2-flow-svg" data-budget-v2-flow-svg viewBox="0 0 ${FLOW_WIDTH} ${FLOW_HEIGHT}" role="img" aria-labelledby="budget-v2-flow-title budget-v2-flow-caption">
        <title id="budget-v2-flow-title">${escapeHtml(model.summary)}</title>
        <desc id="budget-v2-flow-caption">${escapeHtml(model.caption)}</desc>
        ${linkMarkup.join('')}
        ${buildNode({
            x: SOURCE_X,
            y: sourceY,
            height: sourceHeight,
            labelX: SOURCE_X - 8,
            labelY: sourceY,
            label: model.source?.label || 'Income',
            value: sourceValue,
            color: model.source?.color || '#06b6d4',
            action: model.sourceAction,
            formatter,
            obfuscated,
            source: true
        })}
        ${targetMarkup.join('')}
    </svg>`;
}

function buildAccessibleFlowList(model, formatter, obfuscated) {
    if (!model.rows.length) return '<p class="budget-flow-list-empty">No amounts at this level.</p>';
    return `<ol class="budget-flow-accessible-list" data-budget-flow-accessible aria-label="${escapeHtml(model.summary)}">
        ${model.rows.map(row => {
            const action = row.action;
            const attributes = actionAttributes(action);
            const control = action
                ? `<button type="button" class="budget-flow-list-button"${attributes}><span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatAmount(row.value, formatter, obfuscated))}</strong></button>`
                : `<div class="budget-flow-list-row"><span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatAmount(row.value, formatter, obfuscated))}</strong></div>`;
            return `<li>${control}</li>`;
        }).join('')}
    </ol>`;
}

function buildMobileFlow(model, formatter, obfuscated) {
    const sourceColor = safeCssColor(model.source?.color || '#06b6d4');
    return `<div class="budget-flow-mobile-view" data-budget-flow-mobile aria-label="${escapeHtml(model.summary)} mobile budget flow">
        <div class="budget-v2-flow-mobile-source" style="--budget-flow-accent: ${sourceColor}">
            <strong>${escapeHtml(model.source?.label || 'Income')}</strong>
            <span class="obfuscate-val">${escapeHtml(formatAmount(model.source?.value, formatter, obfuscated))}</span>
        </div>
        <ul>${model.rows.map(row => {
            const color = safeCssColor(row.color || model.source?.color);
            const categoryMarker = row.action?.type === 'category'
                ? '<span class="budget-flow-mobile-category-marker" aria-hidden="true">●</span>'
                : '';
            return `<li style="--budget-flow-accent: ${color}">${row.action ? `<button type="button" class="budget-flow-list-button"${actionAttributes(row.action)}>${categoryMarker}<span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatAmount(row.value, formatter, obfuscated))}</strong></button>` : `<span>${escapeHtml(row.label)}</span><strong class="obfuscate-val">${escapeHtml(formatAmount(row.value, formatter, obfuscated))}</strong>`}</li>`;
        }).join('')}</ul>
    </div>`;
}

/**
 * Render the v2 group/category/item flow. The SVG is paired with the same
 * semantic list on every viewport so touch, keyboard, screen-reader and
 * desktop interactions all share one navigation contract.
 */
export function renderBudgetV2Flow(target, model, {
    formatter,
    obfuscated = false,
    onNavigate = () => {}
} = {}) {
    if (!target || !model) return;
    target._budgetV2FlowNavigate = onNavigate;
    if (target.dataset.budgetV2FlowBound !== 'true') {
        target.dataset.budgetV2FlowBound = 'true';
        const activate = event => {
            const navigation = event.target?.closest?.('[data-budget-v2-flow-navigation]');
            if (navigation?.dataset?.budgetV2FlowNavigation) {
                target._budgetV2FlowNavigate({ type: navigation.dataset.budgetV2FlowNavigation });
                return;
            }
            const action = event.target?.closest?.('[data-budget-v2-flow-action]');
            if (!action) return;
            const type = action.dataset.budgetV2FlowAction;
            target._budgetV2FlowNavigate({
                type,
                groupId: action.dataset.budgetGroup,
                category: action.dataset.budgetCategory
            });
        };
        target.addEventListener?.('click', activate);
        target.addEventListener?.('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') activate(event);
        });
    }

    target.dataset.flowState = model.view.level;
    target.innerHTML = `
        <div class="budget-v2-flow-shell">
            <div class="budget-v2-flow-navigation" data-budget-v2-flow-navigation-bar role="group" aria-label="Budget flow navigation">${buildNavigation(model)}</div>
            ${buildFlowSvg(model, formatter, obfuscated)}
            ${buildMobileFlow(model, formatter, obfuscated)}
            ${buildAccessibleFlowList(model, formatter, obfuscated)}
        </div>`;
}
