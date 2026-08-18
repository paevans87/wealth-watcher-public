export const UNCATEGORISED_LABEL = 'Uncategorised';

export const BUDGET_GROUP_COLORS = Object.freeze([
    '#06b6d4', '#ef4444', '#10b981', '#8b5cf6', '#f59e0b',
    '#ec4899', '#14b8a6', '#84cc16', '#3b82f6', '#d946ef',
    '#f43f5e', '#22c55e', '#0ea5e9', '#6366f1', '#f97316'
]);

// These exports keep the legacy global handlers and the existing settings
// copy compatible while the stored document moves to the group-based model.
export const BUDGET_CATEGORY_CONFIG = Object.freeze({
    income: Object.freeze({
        label: 'Income',
        itemLabel: 'income item',
        namePlaceholder: 'e.g. Salary',
        color: '#06b6d4',
        action: 'addBudgetIncome'
    }),
    bills: Object.freeze({
        label: 'Bills',
        itemLabel: 'line item',
        namePlaceholder: 'e.g. Mortgage',
        color: '#ef4444',
        action: 'addBudgetBills',
        role: 'bills'
    }),
    savings: Object.freeze({
        label: 'Savings',
        itemLabel: 'line item',
        namePlaceholder: 'e.g. Emergency Fund',
        color: '#10b981',
        action: 'addBudgetSavings',
        role: 'savings'
    }),
    spend: Object.freeze({
        label: 'Spend',
        itemLabel: 'line item',
        namePlaceholder: 'e.g. Groceries',
        color: '#8b5cf6',
        action: 'addBudgetSpend',
        role: 'spend'
    })
});

export const BUDGET_CATEGORIES = Object.freeze(Object.keys(BUDGET_CATEGORY_CONFIG));

export const DEFAULT_BUDGET_GROUP_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'income', name: 'Income', kind: 'income', role: 'income', builtIn: true }),
    Object.freeze({ id: 'bills', name: 'Bills', kind: 'custom', role: 'bills', builtIn: false }),
    Object.freeze({ id: 'savings', name: 'Savings', kind: 'custom', role: 'savings', builtIn: false }),
    Object.freeze({ id: 'spend', name: 'Spend', kind: 'custom', role: 'spend', builtIn: false })
]);

export const DEFAULT_BUDGET_SETTINGS = Object.freeze({
    version: 2,
    needsUpdate: false,
    groups: Object.freeze(DEFAULT_BUDGET_GROUP_DEFINITIONS.map(definition => Object.freeze({
        ...definition,
        items: Object.freeze([])
    })))
});

const LEGACY_KEYS = Object.freeze(['income', 'bills', 'savings', 'spend']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function readAmount(value) {
    const number = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(number) ? number : 0;
}

function readColor(...values) {
    const color = readString(...values);
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color.slice(1).split('').map(part => part + part).join('')}`;
    }
    return '';
}

function normalizeCadence(value) {
    const cadence = readString(value).toLowerCase();
    if (['quarterly', 'quarter', '3m'].includes(cadence)) return 'quarterly';
    if (['annually', 'annual', 'yearly', 'year', '12m'].includes(cadence)) return 'annually';
    return 'monthly';
}

function stableId(prefix, index) {
    return `${prefix}-${index + 1}`;
}

function ensureUniqueId(candidate, used, fallback) {
    let id = readString(candidate) || fallback;
    let suffix = 2;
    while (used.has(id)) {
        id = `${fallback}-${suffix}`;
        suffix += 1;
    }
    used.add(id);
    return id;
}

export function normalizeBudgetItem(item = {}, fallbackId = 'item-1', usedIds = new Set()) {
    const source = isPlainObject(item) ? item : {};
    return {
        id: ensureUniqueId(source.id ?? source.Id, usedIds, fallbackId),
        name: readString(source.name, source.Name) || 'Untitled item',
        amount: readAmount(source.amount ?? source.Amount),
        cadence: normalizeCadence(source.cadence ?? source.Cadence),
        assetId: readString(source.assetId, source.AssetId) || null,
        category: readString(source.category, source.Category)
    };
}

function normalizeGroup(source, fallback, index, forceIncome = false, usedGroupIds = new Set()) {
    const input = isPlainObject(source) ? source : {};
    const isIncome = forceIncome || input.builtIn === true
        || String(input.kind ?? input.role ?? '').trim().toLowerCase() === 'income'
        || String(input.id ?? '').trim().toLowerCase() === 'income';
    const fallbackId = fallback?.id || stableId('group', index);
    const groupId = ensureUniqueId(input.id ?? input.Id, usedGroupIds, fallbackId);
    const itemIds = new Set();
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items = rawItems.map((item, itemIndex) => normalizeBudgetItem(
        item,
        `${groupId}-item-${itemIndex + 1}`,
        itemIds
    ));
    const normalizedRole = isIncome
        ? 'income'
        : readString(input.role, fallback?.role) || 'custom';

    return {
        id: groupId,
        name: isIncome
            ? readString(input.name, input.Name) || 'Income'
            : readString(input.name, input.Name) || fallback?.name || `Group ${index + 1}`,
        kind: isIncome ? 'income' : 'custom',
        role: normalizedRole,
        builtIn: isIncome,
        color: readColor(input.color, input.Color) || BUDGET_GROUP_COLORS[index % BUDGET_GROUP_COLORS.length],
        items
    };
}

function normalizeV2Settings(source, needsUpdateOverride) {
    const rawGroups = Array.isArray(source.groups) ? source.groups : [];
    const incomeIndex = rawGroups.findIndex(group => {
        const candidate = isPlainObject(group) ? group : {};
        return candidate.builtIn === true
            || String(candidate.kind ?? candidate.role ?? '').trim().toLowerCase() === 'income'
            || String(candidate.id ?? '').trim().toLowerCase() === 'income';
    });
    const orderedSources = incomeIndex >= 0
        ? [rawGroups[incomeIndex], ...rawGroups.filter((_, index) => index !== incomeIndex)]
        : [{ id: 'income', name: 'Income', kind: 'income', role: 'income', builtIn: true, items: [] }, ...rawGroups];
    const usedGroupIds = new Set();
    const groups = orderedSources.map((group, index) => normalizeGroup(
        group,
        DEFAULT_BUDGET_GROUP_DEFINITIONS[index] || { id: stableId('group', index), name: `Group ${index + 1}` },
        index,
        index === 0,
        usedGroupIds
    ));

    return {
        version: 2,
        needsUpdate: needsUpdateOverride ?? source.needsUpdate === true,
        groups
    };
}

function normalizeLegacySettings(source, needsUpdateOverride) {
    const hasHistoricData = LEGACY_KEYS.some(key => Array.isArray(source[key]) && source[key].length > 0);
    const usedGroupIds = new Set();
    const groups = DEFAULT_BUDGET_GROUP_DEFINITIONS.map((definition, index) => {
        const items = Array.isArray(source[definition.id]) ? source[definition.id] : [];
        return normalizeGroup({
            ...definition,
            items
        }, definition, index, definition.id === 'income', usedGroupIds);
    });

    return {
        version: 2,
        needsUpdate: needsUpdateOverride ?? hasHistoricData,
        groups
    };
}

/**
 * Normalize both persisted budget contracts to the v2 client shape.
 * Legacy documents with actual line items remain marked until a successful
 * v2 save so the settings page can explain the migration without blocking use.
 */
export function normalizeBudgetSettings(settings = {}, { needsUpdate } = {}) {
    const source = isPlainObject(settings) ? settings : {};
    const isV2 = Number(source.version) === 2 || Array.isArray(source.groups);
    return isV2
        ? normalizeV2Settings(source, needsUpdate)
        : normalizeLegacySettings(source, needsUpdate);
}

export function getBudgetGroups(settings = {}) {
    return normalizeBudgetSettings(settings).groups;
}

export function getBudgetItemCategory(item = {}) {
    const category = readString(item.category, item.Category);
    return category || UNCATEGORISED_LABEL;
}

export function getRealBudgetItemCategory(item = {}) {
    const category = readString(item.category, item.Category);
    const normalized = category.toLowerCase();
    return category
        && normalized !== UNCATEGORISED_LABEL.toLowerCase()
        && normalized !== 'uncategorized'
        ? category
        : '';
}

export function getBudgetGroupTotal(group = {}, monthlyAmount) {
    const amountFor = typeof monthlyAmount === 'function'
        ? monthlyAmount
        : item => readAmount(item.amount);
    return Array.isArray(group.items)
        ? group.items.reduce((total, item) => total + amountFor(item), 0)
        : 0;
}

export function isIncomeBudgetGroup(group = {}) {
    return group.builtIn === true
        || String(group.kind ?? group.role ?? '').trim().toLowerCase() === 'income';
}
