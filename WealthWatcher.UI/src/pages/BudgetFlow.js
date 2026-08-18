import { escapeHtml, safeCssColor } from '../utils/html.js';
import { BUDGET_CATEGORY_CONFIG } from './budgetConfig.js';

const FLOW_DESTINATIONS = Object.freeze(['bills', 'savings', 'spend']);
const FLOW_DRILLDOWN_CATEGORIES = Object.freeze(['income', ...FLOW_DESTINATIONS]);
const SVG_WIDTH = 920;
const SVG_HEIGHT = 420;
const SVG_TOP = 72;
const SVG_BOTTOM = 348;
const SVG_NODE_WIDTH = 22;
const SVG_SOURCE_X = 48;
const SVG_TARGET_X = 690;
const DRILLDOWN_NODE_GAP = 40;

function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function normaliseAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function cadenceMonths(cadence) {
    const normalized = String(cadence || 'monthly').trim().toLowerCase();
    if (normalized === 'quarterly' || normalized === 'quarter') return 3;
    if (['annually', 'annual', 'yearly', 'year'].includes(normalized)) return 12;
    return 1;
}

function normalizeBreakdowns(breakdowns = {}) {
    return Object.fromEntries(FLOW_DRILLDOWN_CATEGORIES.map(category => [category,
        (Array.isArray(breakdowns?.[category]) ? breakdowns[category] : []).map((item, index) => {
            const amount = normaliseAmount(item?.amount);
            const cadence = String(item?.cadence || 'monthly').trim().toLowerCase();
            const monthlyAmount = item?.monthlyAmount === undefined
                ? amount / cadenceMonths(cadence)
                : normaliseAmount(item.monthlyAmount);
            return {
                id: String(item?.id || `${category}-${index + 1}`),
                name: String(item?.name || `${BUDGET_CATEGORY_CONFIG[category].itemLabel} ${index + 1}`),
                amount,
                cadence,
                monthlyAmount,
                assetName: item?.assetName ? String(item.assetName) : ''
            };
        })
    ]));
}

export function createBudgetFlowModel(totals = {}, breakdowns = {}) {
    const income = normaliseAmount(totals.income);
    const bills = finitePositive(totals.bills);
    const savings = finitePositive(totals.savings);
    const spend = finitePositive(totals.spend);
    const plannedOutflows = bills + savings + spend;
    const leftToAllocate = Math.max(income - plannedOutflows, 0);
    const fundingGap = Math.max(plannedOutflows - income, 0);
    const status = fundingGap > 0.005
        ? 'funding-gap'
        : leftToAllocate > 0.005
            ? 'left-to-allocate'
            : 'balanced';

    const nodes = [
        { id: 'income', label: 'Income', amount: income, kind: 'source', color: '#06b6d4' },
        { id: 'bills', label: BUDGET_CATEGORY_CONFIG.bills.label, amount: bills, kind: 'destination', color: BUDGET_CATEGORY_CONFIG.bills.color },
        { id: 'savings', label: BUDGET_CATEGORY_CONFIG.savings.label, amount: savings, kind: 'destination', color: BUDGET_CATEGORY_CONFIG.savings.color },
        { id: 'spend', label: BUDGET_CATEGORY_CONFIG.spend.label, amount: spend, kind: 'destination', color: BUDGET_CATEGORY_CONFIG.spend.color },
        status === 'funding-gap'
            ? { id: 'funding-gap', label: 'Funding gap', amount: fundingGap, kind: 'status', color: '#ef4444' }
            : { id: 'unallocated', label: 'Left to allocate', amount: leftToAllocate, kind: 'destination', color: '#94a3b8' }
    ];

    const links = FLOW_DESTINATIONS
        .map(category => ({
            id: `income-to-${category}`,
            source: 'income',
            target: category,
            label: BUDGET_CATEGORY_CONFIG[category].label,
            amount: category === 'bills' ? bills : category === 'savings' ? savings : spend,
            color: BUDGET_CATEGORY_CONFIG[category].color
        }))
        .filter(link => link.amount > 0);

    if (leftToAllocate > 0.005) {
        links.push({
            id: 'income-to-unallocated',
            source: 'income',
            target: 'unallocated',
            label: 'Left to allocate',
            amount: leftToAllocate,
            color: '#94a3b8'
        });
    }

    if (fundingGap > 0.005) {
        links.push({
            id: 'funding-gap-link',
            source: 'planned-outflows',
            target: 'funding-gap',
            label: 'Funding gap',
            amount: fundingGap,
            color: '#ef4444',
            kind: 'warning'
        });
    }

    return {
        income,
        bills,
        savings,
        spend,
        plannedOutflows,
        leftToAllocate,
        fundingGap,
        status,
        nodes,
        links,
        breakdowns: normalizeBreakdowns(breakdowns)
    };
}

function formatAmount(value, formatter, obfuscated) {
    if (obfuscated) return '£***';
    if (typeof formatter === 'function') return formatter(value);
    return `£${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nodeLabel(node) {
    return node.kind === 'destination' && node.id !== 'unallocated'
        ? node.label.replace(/\s+\(.+\)$/, '')
        : node.label;
}

function cadenceLabel(cadence) {
    const normalized = String(cadence || 'monthly').trim().toLowerCase();
    if (normalized === 'quarterly') return 'quarterly';
    if (['annually', 'annual', 'yearly'].includes(normalized)) return 'annually';
    return 'monthly';
}

function isInteractiveNode(model, node) {
    return FLOW_DRILLDOWN_CATEGORIES.includes(node?.id)
        && (model.breakdowns?.[node.id] || []).length > 0;
}

function buildNodeGroup(model, node, {
    x,
    y,
    height,
    labelX,
    labelY,
    anchor,
    formatter,
    obfuscated,
    valueText,
    action = 'focus'
}) {
    const safeHeight = Number.isFinite(height) ? Math.max(height, 0) : 0;
    const interactive = action === 'clear' || isInteractiveNode(model, node);
    const assetAttribute = node.assetName
        ? ` data-budget-flow-asset-name="${escapeHtml(node.assetName)}"`
        : '';
    const groupAttributes = interactive
        ? action === 'clear'
            ? ` class="budget-flow-node-group" data-budget-flow-clear role="button" tabindex="0" aria-label="Return to all flows"${assetAttribute}`
            : ` class="budget-flow-node-group" data-budget-flow-focus="${escapeHtml(node.id)}" role="button" tabindex="0" aria-label="View ${escapeHtml(nodeLabel(node))} breakdown"${assetAttribute}`
        : assetAttribute;
    const anchorAttribute = anchor ? ` text-anchor="${anchor}"` : '';
    const hitX = anchor === 'end'
        ? Math.max(0, x - 230)
        : Math.max(0, x - 10);
    const hitRight = anchor === 'end'
        ? x + SVG_NODE_WIDTH + 10
        : Math.min(SVG_WIDTH, labelX + 230);
    const hitHeight = Math.max(safeHeight, 28);
    const hitY = Math.max(0, y - ((hitHeight - safeHeight) / 2));
    const hitArea = interactive
        ? `<rect class="budget-flow-node-hit-area" x="${hitX.toFixed(2)}" y="${hitY.toFixed(2)}" width="${Math.max(hitRight - hitX, SVG_NODE_WIDTH + 20).toFixed(2)}" height="${hitHeight.toFixed(2)}" fill="#ffffff" opacity="0" pointer-events="all" aria-hidden="true"></rect>`
        : '';
    const displayedValue = valueText === undefined
        ? formatAmount(node.amount, formatter, obfuscated)
        : valueText;
    const textY = labelY + Math.max(safeHeight / 2, 9);
    const nodeTitle = node.assetName
        ? `<title>${escapeHtml(`${nodeLabel(node)} linked to ${node.assetName}`)}</title>`
        : '';
    return `<g${groupAttributes}>
        ${nodeTitle}
        ${hitArea}
        <rect class="budget-flow-node budget-flow-node-${escapeHtml(node.id)}" data-budget-flow-node="${escapeHtml(node.id)}" x="${x}" y="${y.toFixed(2)}" width="${SVG_NODE_WIDTH}" height="${safeHeight.toFixed(2)}" rx="5" fill="${safeCssColor(node.color)}" aria-hidden="true"></rect>
        <text class="budget-flow-svg-label" x="${labelX}" y="${textY.toFixed(2)}"${anchorAttribute} aria-hidden="true">${escapeHtml(nodeLabel(node))} <tspan class="budget-flow-svg-value obfuscate-val">(${escapeHtml(displayedValue)})</tspan></text>
    </g>`;
}

function buildOverviewSvg(model, formatter, obfuscated) {
    const positiveLinks = model.links.filter(link =>
        link.target !== 'funding-gap' && finitePositive(link.amount)
    );
    const plannedTotal = positiveLinks.reduce((total, link) => total + link.amount, 0);
    const visualRatio = model.status === 'funding-gap' && plannedTotal > 0
        ? Math.min(model.income / plannedTotal, 1)
        : 1;
    const visualLinks = positiveLinks.map(link => ({
        ...link,
        visualAmount: finitePositive(link.amount) * visualRatio
    }));
    const visualDestinationTotal = visualLinks.reduce((total, link) => total + link.visualAmount, 0);
    const scaleBase = Math.max(model.income, visualDestinationTotal, 1);
    const scale = Math.min((SVG_BOTTOM - SVG_TOP) / scaleBase, 1);
    const sourceHeight = Math.min(SVG_BOTTOM - SVG_TOP, model.income * scale);
    const sourceY = (SVG_HEIGHT - sourceHeight) / 2;
    const gap = visualLinks.length > 1 ? 14 : 0;
    const destinationHeights = visualLinks.map(link => Math.max(0, link.visualAmount * scale));
    const destinationTotalHeight = destinationHeights.reduce((total, height) => total + height, 0) + gap * Math.max(0, destinationHeights.length - 1);
    let destinationY = (SVG_HEIGHT - destinationTotalHeight) / 2;
    let sourceOffset = (sourceHeight - destinationHeights.reduce((total, height) => total + height, 0)) / 2;
    if (!Number.isFinite(sourceOffset)) sourceOffset = 0;

    const sourceNode = model.nodes.find(node => node.id === 'income');
    const linkMarkup = [];
    const destinationMarkup = [];
    const sourceX = SVG_SOURCE_X + SVG_NODE_WIDTH;
    const targetX = SVG_TARGET_X;
    const controlX = sourceX + ((targetX - sourceX) / 2);

    visualLinks.forEach((link, index) => {
        const height = Math.max(0, destinationHeights[index]);
        const sourceStart = sourceY + sourceOffset;
        const destinationStart = destinationY;
        const sourceCenter = sourceStart + height / 2;
        const destinationCenter = destinationStart + height / 2;
        const safeHeight = Number.isFinite(height) ? height : 0;

        if (safeHeight > 0) {
            linkMarkup.push(`<path class="budget-flow-link" data-budget-flow-link="${escapeHtml(link.id)}" d="M ${sourceX.toFixed(2)} ${sourceCenter.toFixed(2)} C ${controlX.toFixed(2)} ${sourceCenter.toFixed(2)}, ${controlX.toFixed(2)} ${destinationCenter.toFixed(2)}, ${targetX.toFixed(2)} ${destinationCenter.toFixed(2)}" stroke="${safeCssColor(link.color)}" stroke-width="${safeHeight.toFixed(2)}" opacity="0.62" fill="none" aria-hidden="true"></path>`);
        }

        const node = model.nodes.find(candidate => candidate.id === link.target);
        if (node) {
            destinationMarkup.push(buildNodeGroup(model, node, {
                x: targetX,
                y: destinationStart,
                height: safeHeight,
                labelX: targetX + SVG_NODE_WIDTH + 18,
                labelY: destinationStart,
                formatter,
                obfuscated
            }));
        }
        sourceOffset += safeHeight;
        destinationY += safeHeight + gap;
    });

    const sourceMarkup = sourceNode
        ? buildNodeGroup(model, sourceNode, {
            x: SVG_SOURCE_X,
            y: sourceHeight > 0 ? sourceY : SVG_HEIGHT / 2 - 4,
            height: sourceHeight > 0 ? sourceHeight : 8,
            labelX: SVG_SOURCE_X - 8,
            labelY: sourceHeight > 0 ? sourceY : SVG_HEIGHT / 2 - 4,
            anchor: 'end',
            formatter,
            obfuscated
        })
        : '';
    const fundingGapLink = model.links.find(link => link.id === 'funding-gap-link');
    const fundingGapNode = model.nodes.find(node => node.id === 'funding-gap');
    const fundingGapHeight = fundingGapNode
        ? Math.max(12, Math.min(30, finitePositive(fundingGapNode.amount) * Math.max(scale, 0.02)))
        : 0;
    const fundingGapY = SVG_HEIGHT - 90;
    const fundingGapX = SVG_TARGET_X + 70;
    const fundingGapMarkup = fundingGapLink && fundingGapNode
        ? `<path class="budget-flow-warning-link" data-budget-flow-link="funding-gap-link" d="M ${(SVG_TARGET_X + SVG_NODE_WIDTH).toFixed(2)} ${(fundingGapY + fundingGapHeight / 2).toFixed(2)} C ${(SVG_TARGET_X + 34).toFixed(2)} ${(fundingGapY + fundingGapHeight / 2).toFixed(2)}, ${(fundingGapX - 22).toFixed(2)} ${(fundingGapY + fundingGapHeight / 2).toFixed(2)}, ${fundingGapX.toFixed(2)} ${(fundingGapY + fundingGapHeight / 2).toFixed(2)}" stroke="#ef4444" stroke-width="${fundingGapHeight.toFixed(2)}" stroke-dasharray="6 4" opacity="0.9" fill="none" aria-hidden="true"></path>
            <rect class="budget-flow-node budget-flow-node-funding-gap" data-budget-flow-node="funding-gap" x="${fundingGapX.toFixed(2)}" y="${fundingGapY.toFixed(2)}" width="${SVG_NODE_WIDTH}" height="${fundingGapHeight.toFixed(2)}" rx="5" fill="#ef4444" aria-hidden="true"></rect>
            <text class="budget-flow-svg-label budget-flow-svg-warning-label" x="${fundingGapX + SVG_NODE_WIDTH + 18}" y="${(fundingGapY + fundingGapHeight / 2 + 9).toFixed(2)}">Funding gap <tspan class="budget-flow-svg-value budget-flow-svg-warning-value obfuscate-val">(${escapeHtml(formatAmount(fundingGapNode.amount, formatter, obfuscated))})</tspan></text>`
        : '';
    const statusText = model.status === 'funding-gap'
        ? `<text class="budget-flow-svg-status budget-flow-svg-status-warning" x="${SVG_WIDTH - 30}" y="${SVG_HEIGHT - 32}" text-anchor="end">Funding gap ${escapeHtml(formatAmount(model.fundingGap, formatter, obfuscated))}</text>`
        : '';

    return `<svg class="budget-flow-svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="group" aria-labelledby="budget-flow-svg-title budget-flow-svg-description" preserveAspectRatio="xMidYMid meet">
        <title id="budget-flow-svg-title">Planned monthly budget flow</title>
        <desc id="budget-flow-svg-description">Income flows to bills, savings, spending and any amount left to allocate. Select an income or destination node to see its line-item breakdown.</desc>
        ${sourceMarkup}
        ${linkMarkup.join('')}
        ${destinationMarkup.join('')}
        ${fundingGapMarkup}
        ${statusText}
    </svg>`;
}

function flowItemValueText(item, formatter, obfuscated) {
    const cadence = cadenceLabel(item.cadence);
    const monthly = formatAmount(item.monthlyAmount, formatter, obfuscated);
    if (cadence === 'monthly') return `${monthly} monthly`;
    const period = cadence === 'annually' ? 'year' : 'quarter';
    return `${monthly}/mo · ${formatAmount(item.amount, formatter, obfuscated)}/${period}`;
}

function buildDrilldownSvg(model, selectedCategory, items, formatter, obfuscated) {
    const categoryNode = model.nodes.find(node => node.id === selectedCategory);
    if (!categoryNode) return buildOverviewSvg(model, formatter, obfuscated);

    const sourceNode = { ...categoryNode, kind: 'source', label: nodeLabel(categoryNode) };
    const destinationNodes = items.map((item, index) => ({
        id: `${selectedCategory}-item-${item.id || index + 1}`,
        label: item.name,
        amount: finitePositive(item.monthlyAmount),
        kind: 'destination',
        color: categoryNode.color,
        assetName: item.assetName,
        valueText: flowItemValueText(item, formatter, obfuscated)
    }));
    const visualLinks = destinationNodes
        .map(node => ({
            id: `${selectedCategory}-to-${node.id}`,
            source: selectedCategory,
            target: node.id,
            amount: node.amount,
            color: categoryNode.color
        }))
        .filter(link => link.amount > 0);
    const sourceAmount = finitePositive(categoryNode.amount);
    const destinationTotal = visualLinks.reduce((total, link) => total + link.amount, 0);
    const scaleBase = Math.max(sourceAmount, destinationTotal, 1);
    const gap = visualLinks.length > 1 ? DRILLDOWN_NODE_GAP : 0;
    const availableHeight = SVG_BOTTOM - SVG_TOP;
    const scale = Math.min(Math.max(availableHeight - gap * Math.max(0, visualLinks.length - 1), 1) / scaleBase, 1);
    const sourceHeight = Math.min(SVG_BOTTOM - SVG_TOP, sourceAmount * scale);
    const sourceY = sourceHeight > 0 ? (SVG_HEIGHT - sourceHeight) / 2 : SVG_HEIGHT / 2 - 4;
    const destinationHeights = visualLinks.map(link => Math.max(0, link.amount * scale));
    const destinationTotalHeight = destinationHeights.reduce((total, height) => total + height, 0) + gap * Math.max(0, destinationHeights.length - 1);
    let destinationY = (SVG_HEIGHT - destinationTotalHeight) / 2;
    let sourceOffset = (sourceHeight - destinationHeights.reduce((total, height) => total + height, 0)) / 2;
    if (!Number.isFinite(sourceOffset)) sourceOffset = 0;

    const drilldownSourceX = 180;
    const sourceX = drilldownSourceX + SVG_NODE_WIDTH;
    const targetX = SVG_TARGET_X;
    const controlX = sourceX + ((targetX - sourceX) / 2);
    const linkMarkup = [];
    const destinationMarkup = [];

    visualLinks.forEach((link, index) => {
        const safeHeight = Number.isFinite(destinationHeights[index]) ? destinationHeights[index] : 0;
        const sourceStart = sourceY + sourceOffset;
        const destinationStart = destinationY;
        const sourceCenter = sourceStart + safeHeight / 2;
        const destinationCenter = destinationStart + safeHeight / 2;
        if (safeHeight > 0) {
            linkMarkup.push(`<path class="budget-flow-link" data-budget-flow-link="${escapeHtml(link.id)}" d="M ${sourceX.toFixed(2)} ${sourceCenter.toFixed(2)} C ${controlX.toFixed(2)} ${sourceCenter.toFixed(2)}, ${controlX.toFixed(2)} ${destinationCenter.toFixed(2)}, ${targetX.toFixed(2)} ${destinationCenter.toFixed(2)}" stroke="${safeCssColor(link.color)}" stroke-width="${safeHeight.toFixed(2)}" opacity="0.62" fill="none" aria-hidden="true"></path>`);
        }
        const node = destinationNodes.find(candidate => candidate.id === link.target);
        if (node) {
            destinationMarkup.push(buildNodeGroup(model, node, {
                x: targetX,
                y: destinationStart,
                height: safeHeight,
                labelX: targetX + SVG_NODE_WIDTH + 18,
                labelY: destinationStart,
                formatter,
                obfuscated,
                valueText: node.valueText
            }));
        }
        sourceOffset += safeHeight;
        destinationY += safeHeight + gap;
    });

    const sourceMarkup = buildNodeGroup(model, sourceNode, {
        x: drilldownSourceX,
        y: sourceY,
        height: sourceHeight > 0 ? sourceHeight : 8,
        labelX: drilldownSourceX - 10,
        labelY: sourceY,
        anchor: 'end',
        formatter,
        obfuscated,
        valueText: `${formatAmount(sourceAmount, formatter, obfuscated)} monthly`,
        action: 'clear'
    });
    const title = `${nodeLabel(categoryNode)} budget flow`;
    const description = `${nodeLabel(categoryNode)} flows to its configured line items. Amounts are shown using monthly equivalents.`;

    return `<svg class="budget-flow-svg budget-flow-svg-drilldown" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="group" aria-labelledby="budget-flow-svg-title budget-flow-svg-description" preserveAspectRatio="xMidYMid meet">
        <title id="budget-flow-svg-title">${escapeHtml(title)}</title>
        <desc id="budget-flow-svg-description">${escapeHtml(description)}</desc>
        ${sourceMarkup}
        ${linkMarkup.join('')}
        ${destinationMarkup.join('')}
    </svg>`;
}

function buildFlowSelectionHeader(model, selectedCategory) {
    const selected = FLOW_DRILLDOWN_CATEGORIES.includes(selectedCategory) ? selectedCategory : null;
    const items = selected ? model.breakdowns?.[selected] || [] : [];
    if (!selected || !items.length) return '';
    const node = model.nodes.find(candidate => candidate.id === selected);

    return `<section class="budget-flow-selection" data-budget-flow-breakdown="${escapeHtml(selected)}" aria-labelledby="budget-flow-selection-title">
        <div class="budget-flow-selection-header">
            <div>
                <span class="budget-section-kicker">Selected flow</span>
                <h5 id="budget-flow-selection-title">${escapeHtml(nodeLabel(node))} breakdown</h5>
            </div>
            <button type="button" class="budget-flow-drilldown-button" data-budget-flow-clear>Show all flows</button>
        </div>
        <p class="budget-flow-selection-copy">${escapeHtml(`Amounts are shown as monthly equivalents. ${items.length} configured ${items.length === 1 ? 'line' : 'lines'} flow from ${nodeLabel(node)}.`)}</p>
    </section>`;
}

function buildFlowHint() {
    return '<p class="budget-flow-drilldown-hint" data-budget-flow-drilldown-hint>Click a flow node to inspect its line items.</p>';
}

function buildMobileFlowNode(node, model, formatter, obfuscated) {
    const interactive = isInteractiveNode(model, node);
    const element = interactive ? 'button' : 'div';
    const attributes = interactive
        ? ` type="button" data-budget-flow-focus="${escapeHtml(node.id)}" aria-label="View ${escapeHtml(nodeLabel(node))} breakdown"`
        : '';
    const actionCopy = interactive
        ? '<span class="budget-flow-mobile-action">View breakdown</span>'
        : '';
    const accent = safeCssColor(node.color);

    return `<${element} class="budget-flow-mobile-node${interactive ? ' is-interactive' : ''}"${attributes} style="--budget-flow-accent: ${accent}">
        <span class="budget-flow-mobile-node-copy">
            <span class="budget-flow-mobile-node-label">${escapeHtml(nodeLabel(node))}</span>
            ${actionCopy}
        </span>
        <strong class="budget-flow-mobile-node-value obfuscate-val">${escapeHtml(formatAmount(node.amount, formatter, obfuscated))}</strong>
    </${element}>`;
}

function buildMobileOverview(model, formatter, obfuscated) {
    const sourceNode = model.nodes.find(node => node.id === 'income');
    const destinationNodes = model.nodes.filter(node => node.id !== 'income' && finitePositive(node.amount));

    return `<div class="budget-flow-mobile-view" data-budget-flow-mobile aria-label="Monthly budget flow summary">
        <div class="budget-flow-mobile-source">
            <span class="budget-flow-mobile-kicker">Starting income</span>
            <strong class="budget-flow-mobile-source-value obfuscate-val">${escapeHtml(formatAmount(sourceNode?.amount, formatter, obfuscated))}</strong>
            <span class="budget-flow-mobile-source-cadence">monthly</span>
        </div>
        <div class="budget-flow-mobile-connector" aria-hidden="true">↓</div>
        <div class="budget-flow-mobile-destinations">
            ${destinationNodes.map(node => buildMobileFlowNode(node, model, formatter, obfuscated)).join('')}
        </div>
    </div>`;
}

function buildMobileBreakdown(model, selectedCategory, items, formatter, obfuscated) {
    const categoryNode = model.nodes.find(node => node.id === selectedCategory);
    const accent = safeCssColor(categoryNode?.color);
    const rows = items.map(item => `<li class="budget-flow-mobile-line" style="--budget-flow-accent: ${accent}">
        <span class="budget-flow-mobile-line-copy">
            <span class="budget-flow-mobile-node-label">${escapeHtml(item.name)}</span>
            ${item.assetName ? `<span class="budget-flow-mobile-linked">Linked to ${escapeHtml(item.assetName)}</span>` : ''}
        </span>
        <strong class="budget-flow-mobile-line-value obfuscate-val">${escapeHtml(flowItemValueText(item, formatter, obfuscated))}</strong>
    </li>`).join('');

    return `<div class="budget-flow-mobile-view" data-budget-flow-mobile data-budget-flow-breakdown="${escapeHtml(selectedCategory)}" aria-label="${escapeHtml(nodeLabel(categoryNode))} budget breakdown">
        <button type="button" class="budget-flow-mobile-back" data-budget-flow-clear>← Show all flows</button>
        <div class="budget-flow-mobile-breakdown-heading">
            <div>
                <span class="budget-flow-mobile-kicker">Selected flow</span>
                <h5>${escapeHtml(nodeLabel(categoryNode))}</h5>
            </div>
            <strong class="budget-flow-mobile-source-value obfuscate-val">${escapeHtml(formatAmount(categoryNode?.amount, formatter, obfuscated))}</strong>
        </div>
        <ul class="budget-flow-mobile-lines">${rows}</ul>
    </div>`;
}

function buildMobileFlowView(model, selectedCategory, formatter, obfuscated) {
    const selected = FLOW_DRILLDOWN_CATEGORIES.includes(selectedCategory) ? selectedCategory : null;
    const items = selected ? model.breakdowns?.[selected] || [] : [];
    return selected && items.length
        ? buildMobileBreakdown(model, selected, items, formatter, obfuscated)
        : buildMobileOverview(model, formatter, obfuscated);
}

export function renderBudgetFlow(target, model, {
    formatter,
    obfuscated = false,
    selectedCategory = null
} = {}) {
    if (!target) return null;
    const safeModel = model || createBudgetFlowModel();
    const selected = FLOW_DRILLDOWN_CATEGORIES.includes(selectedCategory) ? selectedCategory : null;
    const selectedItems = selected ? safeModel.breakdowns?.[selected] || [] : [];
    const hasSelection = Boolean(selected && selectedItems.length);
    const flowSvg = hasSelection
        ? buildDrilldownSvg(safeModel, selected, selectedItems, formatter, obfuscated)
        : buildOverviewSvg(safeModel, formatter, obfuscated);

    target.dataset.flowState = safeModel.status;
    target.setAttribute?.('data-budget-flow-state', safeModel.status);
    target.innerHTML = `
        <div class="budget-flow-visual" data-budget-flow-visual>
            ${buildFlowSelectionHeader(safeModel, selected)}
            ${flowSvg}
            ${buildMobileFlowView(safeModel, selected, formatter, obfuscated)}
        </div>
        ${hasSelection ? '' : buildFlowHint()}`;
    return safeModel;
}
