export const DEFAULT_TARGET_INCOME = 4000;
export const DEFAULT_SWR = 4.0;
export const DEFAULT_STATE_PENSION_AMOUNT = 12547;
export const DEFAULT_INCLUDED_ASSETS = ['investments', 'bonds', 'pensions', 'property'];

export function parseFiniteNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWindfallDateKey(windfall) {
    const expectedDate = String(windfall?.ExpectedDate ?? windfall?.expectedDate ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) return null;

    const parsed = new Date(`${expectedDate}T00:00:00`);
    if (Number.isNaN(parsed.valueOf()) || getLocalDateKey(parsed) !== expectedDate) return null;
    return expectedDate;
}

export function getCurrentWindfallsAmount(windfalls = [], today = getLocalDateKey()) {
    return (Array.isArray(windfalls) ? windfalls : [])
        .filter(windfall => {
            const included = windfall?.IncludeInCalculation === true
                || windfall?.includeInCalculation === true;
            const expectedDate = getWindfallDateKey(windfall);
            return included && expectedDate !== null && expectedDate <= today;
        })
        .reduce((sum, windfall) => sum + parseFiniteNumber(
            windfall.Amount ?? windfall.amount,
            0
        ), 0);
}

function getCategoryId(category) {
    return category?.Id ?? category?.id ?? category?.Key ?? category?.key;
}

export function getDefaultIncludedAssets(categories = []) {
    if (!Array.isArray(categories) || categories.length === 0) return [...DEFAULT_INCLUDED_ASSETS];

    return categories
        .map(getCategoryId)
        .filter(id => id && !['cash', 'savings'].includes(String(id).toLowerCase()));
}

export function getIncludedFireAssetIds(fire = {}, categories = []) {
    const source = Array.isArray(fire.includedAssets)
        ? fire.includedAssets
        : getDefaultIncludedAssets(categories);

    return [...new Set(source
        .map(assetId => String(assetId ?? '').trim().toLowerCase())
        .filter(Boolean))];
}

/**
 * Calculates the FIRE target used by both the tracker and forecast request.
 * Keeping this in one place prevents small differences in pension or zero-value
 * handling from producing contradictory figures across the app.
 */
export function calculateFireTarget(fire = {}) {
    const targetIncome = parseFiniteNumber(fire.targetIncome, DEFAULT_TARGET_INCOME);
    const swr = parseFiniteNumber(fire.swr, DEFAULT_SWR);
    const statePensionAmount = parseFiniteNumber(
        fire.statePensionAmount,
        DEFAULT_STATE_PENSION_AMOUNT
    );
    const effectiveMonthlyTarget = fire.includeStatePension === true
        ? Math.max(0, targetIncome - (Math.max(0, statePensionAmount) / 12))
        : Math.max(0, targetIncome);

    return swr > 0 ? (effectiveMonthlyTarget * 12) / (swr / 100) : 0;
}

export function calculateFireSummary({
    categories = {},
    fire = {},
    categoryDefinitions = [],
    today = getLocalDateKey()
} = {}) {
    fire = fire || {};
    const targetIncome = parseFiniteNumber(fire.targetIncome, DEFAULT_TARGET_INCOME);
    const swr = parseFiniteNumber(fire.swr, DEFAULT_SWR);
    const statePensionAmount = parseFiniteNumber(
        fire.statePensionAmount,
        DEFAULT_STATE_PENSION_AMOUNT
    );
    const includeStatePension = fire.includeStatePension === true;
    const includedAssets = getIncludedFireAssetIds(fire, categoryDefinitions);
    const normalizedCategories = Object.fromEntries(
        Object.entries(categories || {})
            .map(([key, value]) => [String(key).trim().toLowerCase(), value])
    );
    const includeWindfalls = fire.includeWindfalls !== false;
    const activeWindfallsAmount = includeWindfalls
        ? getCurrentWindfallsAmount(fire.windfalls || [], today)
        : 0;

    let investableAssets = activeWindfallsAmount;
    let selectedAssetDataCount = 0;
    includedAssets.forEach(assetId => {
        if (!Object.prototype.hasOwnProperty.call(normalizedCategories, assetId)) return;
        const value = parseFiniteNumber(normalizedCategories[assetId], NaN);
        if (!Number.isFinite(value)) return;
        investableAssets += value;
        selectedAssetDataCount += 1;
    });

    const target = calculateFireTarget(fire);
    const hasTrackingData = Object.keys(normalizedCategories).length > 0;
    const hasUsableSelectedAssetData = selectedAssetDataCount > 0 || activeWindfallsAmount > 0;
    const configured = swr > 0 && target > 0;
    const state = !hasTrackingData
        ? 'empty'
        : !configured || !hasUsableSelectedAssetData
            ? 'setup'
            : 'ready';
    const remaining = Math.max(0, target - investableAssets);
    const completion = target > 0
        ? Math.max(0, Math.min(100, (investableAssets / target) * 100))
        : 100;
    const currentPassiveIncome = swr > 0 ? (investableAssets * (swr / 100)) / 12 : 0;
    const displayedIncome = currentPassiveIncome
        + (includeStatePension ? Math.max(0, statePensionAmount) / 12 : 0);

    return {
        state,
        configured,
        hasTrackingData,
        hasUsableSelectedAssetData,
        selectedAssetDataCount,
        targetIncome,
        swr,
        includeStatePension,
        statePensionAmount,
        includeWindfalls,
        includedAssets,
        activeWindfallsAmount,
        investableAssets,
        target,
        remaining,
        gap: remaining,
        completion,
        currentPassiveIncome,
        displayedIncome,
        targetReached: configured && investableAssets >= target
    };
}
