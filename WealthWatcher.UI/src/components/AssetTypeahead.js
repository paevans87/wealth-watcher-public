import { store } from '../store/store.js';
import { escapeHtml } from '../utils/html.js';

const TYPEAHEAD_SELECTOR = '[data-asset-typeahead]';
const SEARCH_SELECTOR = '[data-asset-typeahead-search]';
const VALUE_SELECTOR = '[data-asset-typeahead-value]';
const OPTIONS_SELECTOR = '[data-asset-typeahead-options]';
const CHOICE_SELECTOR = '[data-asset-typeahead-choice]';

const optionOwners = new WeakMap();
const portalPositions = new WeakMap();
const optionHandlers = new WeakSet();
const handledChoiceEvents = new WeakSet();
const handledPointerChoices = new WeakSet();

export const escapeAssetTypeaheadHtml = escapeHtml;

function renderAttributes(attributes = {}) {
    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => ` ${name}="${escapeAssetTypeaheadHtml(value)}"`)
        .join('');
}

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function findPicker(element) {
    return element?.closest?.(TYPEAHEAD_SELECTOR)
        || element?.closest?.('.integration-asset-typeahead')
        || element?.closest?.('.budget-asset-typeahead');
}

function findSearch(element) {
    const search = element?.closest?.(SEARCH_SELECTOR);
    if (search) return search;

    const dataset = element?.dataset || {};
    const searchKeys = ['assetTypeaheadSearch', 'accountAssetSearch', 'accountCashAssetSearch', 'budgetSavingAssetSearch'];
    return searchKeys.some(key => Object.prototype.hasOwnProperty.call(dataset, key))
        ? element
        : null;
}

function findChoice(event) {
    const target = event?.target;
    return target?.closest?.(CHOICE_SELECTOR)
        || target?.parentElement?.closest?.(CHOICE_SELECTOR)
        || event?.composedPath?.().find(item => item?.matches?.(CHOICE_SELECTOR))
        || null;
}

function choiceAssetId(choice) {
    return choice?.dataset?.assetTypeaheadChoice
        ?? choice?.getAttribute?.('data-asset-typeahead-choice')
        ?? '';
}

export function renderAssetTypeahead({
    id,
    selectedAssetId = '',
    selectedAssetName = '',
    ariaLabel,
    placeholder = 'Search existing assets…',
    pickerClass = '',
    pickerAttributes = {},
    valueAttributes = {},
    searchAttributes = {},
    optionsAttributes = {},
    emptyChoiceLabel = 'Create a new asset…'
}) {
    const key = String(id ?? '');
    const optionsId = `asset-typeahead-options-${safeId(key)}`;
    const classes = ['asset-typeahead', pickerClass].filter(Boolean).join(' ');
    const optionsClasses = 'asset-typeahead-options integration-asset-options';

    return `<div class="${escapeAssetTypeaheadHtml(classes)}" data-asset-typeahead data-asset-typeahead-key="${escapeAssetTypeaheadHtml(key)}" data-asset-typeahead-empty-label="${escapeAssetTypeaheadHtml(emptyChoiceLabel)}"${renderAttributes(pickerAttributes)}>
        <input type="hidden" data-asset-typeahead-value${renderAttributes(valueAttributes)} value="${escapeAssetTypeaheadHtml(selectedAssetId)}">
        <input type="text" class="asset-typeahead-search integration-asset-search" data-asset-typeahead-search${renderAttributes(searchAttributes)} aria-label="${escapeAssetTypeaheadHtml(ariaLabel)}" placeholder="${escapeAssetTypeaheadHtml(placeholder)}" value="${escapeAssetTypeaheadHtml(selectedAssetName)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${optionsId}">
        <div class="${optionsClasses}" id="${optionsId}" data-asset-typeahead-options${renderAttributes(optionsAttributes)} role="listbox" hidden></div>
    </div>`;
}

export function getAssetTypeaheadState(picker) {
    const search = picker?.querySelector?.(SEARCH_SELECTOR)
        || picker?.querySelector?.('[data-account-asset-search]')
        || picker?.querySelector?.('[data-account-cash-asset-search]')
        || picker?.querySelector?.('[data-budget-saving-asset-search]');
    const optionsId = search?.getAttribute?.('aria-controls');
    const options = (optionsId ? globalThis.document?.getElementById?.(optionsId) : null)
        || picker?.querySelector?.(OPTIONS_SELECTOR)
        || picker?.querySelector?.('[data-account-asset-options]')
        || picker?.querySelector?.('[data-account-cash-asset-options]')
        || picker?.querySelector?.('[data-budget-saving-asset-options]');
    const value = picker?.querySelector?.(VALUE_SELECTOR)
        || picker?.querySelector?.('[data-account-asset]')
        || picker?.querySelector?.('[data-account-cash-asset]')
        || picker?.querySelector?.('[data-budget-saving-asset]');

    return { picker, value, search, options };
}

function getAssets(getAssetsForPicker, picker) {
    const assets = getAssetsForPicker?.(picker) ?? store.state.assets ?? [];
    return assets
        .filter(asset => !asset.ArchivedAt)
        .filter(asset => asset.DisplayName);
}

export function renderAssetTypeaheadOptions(
    picker,
    { query = '', emptyChoiceLabel, getAssets: getAssetsForPicker, includeEmptyChoice = true } = {}) {
    const state = getAssetTypeaheadState(picker);
    if (!state.options) return;

    const selectedId = String(state.value?.value || '');
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const assets = getAssets(getAssetsForPicker, picker)
        .filter(asset => String(asset.DisplayName).toLowerCase().includes(normalizedQuery));
    const label = emptyChoiceLabel
        || picker?.dataset?.assetTypeaheadEmptyLabel
        || 'Create a new asset…';

    const emptyChoice = includeEmptyChoice
        ? `<div class="asset-typeahead-option asset-typeahead-option-create integration-asset-option integration-asset-option-create" data-asset-typeahead-choice="" role="option" aria-selected="${selectedId ? 'false' : 'true'}">${escapeAssetTypeaheadHtml(label)}</div>`
        : '';
    state.options.innerHTML = `
        ${emptyChoice}
        ${assets.map(asset => `<div class="asset-typeahead-option integration-asset-option" data-asset-typeahead-choice="${escapeAssetTypeaheadHtml(asset.Id)}" role="option" aria-selected="${String(asset.Id) === selectedId ? 'true' : 'false'}">${escapeAssetTypeaheadHtml(asset.DisplayName)}</div>`).join('')}
        ${assets.length ? '' : '<div class="asset-typeahead-options-empty integration-asset-options-empty">No matching existing assets.</div>'}`;
    state.options.hidden = false;
    optionOwners.set(state.options, picker);
    if (picker?.dataset) picker.dataset.assetOptionIndex = '-1';
}

export function getAssetTypeaheadChoices(picker) {
    const state = getAssetTypeaheadState(picker);
    return state.options?.querySelectorAll
        ? [...state.options.querySelectorAll(CHOICE_SELECTOR)]
        : [];
}

function portalOptions(options) {
    const body = globalThis.document?.body;
    if (!body?.appendChild || !options?.parentNode || options.parentNode === body) return;

    portalPositions.set(options, {
        parent: options.parentNode,
        nextSibling: options.nextSibling
    });
    body.appendChild(options);
}

function restoreOptions(options) {
    const portal = options && portalPositions.get(options);
    if (!portal?.parent?.appendChild) return;

    if (portal.nextSibling?.parentNode === portal.parent) {
        portal.parent.insertBefore(options, portal.nextSibling);
    } else {
        portal.parent.appendChild(options);
    }
    portalPositions.delete(options);
}

export function positionAssetTypeaheadOptions(state) {
    if (!state.options || !state.search || typeof state.search.getBoundingClientRect !== 'function') return;

    const rect = state.search.getBoundingClientRect();
    const viewportWidth = globalThis.window?.innerWidth
        || globalThis.document?.documentElement?.clientWidth
        || rect.right;
    const viewportHeight = globalThis.window?.innerHeight
        || globalThis.document?.documentElement?.clientHeight
        || rect.bottom + 224;
    const viewportPadding = 8;
    const gap = 4;
    const maxHeight = 224;
    const width = Math.min(
        Math.max(rect.width, 1),
        Math.max(1, viewportWidth - (viewportPadding * 2))
    );
    const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding)
    );
    const spaceBelow = viewportHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(96, Math.min(maxHeight, openAbove ? spaceAbove : spaceBelow));
    const top = openAbove
        ? Math.max(viewportPadding, rect.top - availableHeight - gap)
        : rect.bottom + gap;

    state.options.classList?.add('is-floating');
    if (!state.options.style) return;
    Object.assign(state.options.style, {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        right: 'auto',
        width: `${width}px`,
        maxHeight: `${availableHeight}px`,
        zIndex: '4000'
    });
}

function resetAssetTypeaheadPosition(options) {
    options?.classList?.remove('is-floating');
    const properties = ['position', 'top', 'left', 'right', 'width', 'max-height', 'z-index'];
    if (typeof options?.style?.removeProperty === 'function') {
        properties.forEach(property => options.style.removeProperty(property));
    }
}

export function setAssetTypeaheadOpen(picker, open) {
    const state = getAssetTypeaheadState(picker);
    if (!state.options || !state.search) return;

    optionOwners.set(state.options, picker);
    if (open) {
        state.options.hidden = false;
        portalOptions(state.options);
    } else {
        restoreOptions(state.options);
        state.options.hidden = true;
        resetAssetTypeaheadPosition(state.options);
        if (picker?.dataset) delete picker.dataset.assetOptionIndex;
    }

    picker?.classList?.toggle('is-open', open);
    state.search.setAttribute?.('aria-expanded', String(open));
    if (open) positionAssetTypeaheadOptions(state);
}

export function closeAssetTypeaheads(root) {
    globalThis.document?.querySelectorAll?.(`${OPTIONS_SELECTOR}.is-floating`)?.forEach(options => {
        const picker = optionOwners.get(options);
        if (!picker || (root && root !== picker && root.contains?.(picker) === false)) return;
        setAssetTypeaheadOpen(picker, false);
    });
}

function repositionOpenAssetTypeaheads(root) {
    root?.querySelectorAll?.(`${TYPEAHEAD_SELECTOR}.is-open`)?.forEach(picker => {
        positionAssetTypeaheadOptions(getAssetTypeaheadState(picker));
    });
}

export function setupAssetTypeahead(
    root,
    {
        emptyChoiceLabel = 'Create a new asset…',
        includeEmptyChoice = true,
        getAssets: getAssetsForPicker,
        onClear,
        onChoose
    } = {}
) {
    if (!root || root.dataset?.assetTypeaheadInit === 'true') return;
    if (root.dataset) root.dataset.assetTypeaheadInit = 'true';

    const ownsPicker = picker => root === picker || root.contains?.(picker) !== false;
    const getEmptyChoiceLabel = picker => picker?.dataset?.assetTypeaheadEmptyLabel || emptyChoiceLabel;
    const openPicker = search => {
        const picker = findPicker(search);
        if (!picker || !ownsPicker(picker)) return;

        const state = getAssetTypeaheadState(picker);
        if (state.value?.value) {
            state.search.select?.();
            renderAssetTypeaheadOptions(picker, {
                emptyChoiceLabel: getEmptyChoiceLabel(picker),
                includeEmptyChoice,
                getAssets: getAssetsForPicker
            });
        } else {
            renderAssetTypeaheadOptions(picker, {
                query: state.search?.value,
                emptyChoiceLabel: getEmptyChoiceLabel(picker),
                includeEmptyChoice,
                getAssets: getAssetsForPicker
            });
        }
        bindPickerOptions(picker);
        setAssetTypeaheadOpen(picker, true);
    };
    const choosePickerAsset = (picker, assetId) => {
        onChoose?.(picker, assetId);
        setAssetTypeaheadOpen(picker, false);
    };
    const bindPickerOptions = picker => {
        const options = getAssetTypeaheadState(picker).options;
        if (!options?.addEventListener || optionHandlers.has(options)) return;

        optionHandlers.add(options);
        options.addEventListener('pointerdown', event => {
            const choice = findChoice(event);
            const owner = optionOwners.get(options);
            if (!choice || (owner && owner !== picker)) return;

            // The portaled list is not part of the picker, so clicking an
            // option can blur the search input before the click event fires.
            // Select on pointerdown while the option is still present, then
            // ignore the click generated by the same pointer interaction.
            event.preventDefault?.();
            handledPointerChoices.add(choice);
            handledChoiceEvents.add(event);
            choosePickerAsset(picker, choiceAssetId(choice));
        });
        options.addEventListener('click', event => {
            if (handledChoiceEvents.has(event)) return;
            const choice = findChoice(event);
            const owner = optionOwners.get(options);
            if (!choice || (owner && owner !== picker)) return;
            if (handledPointerChoices.has(choice)) {
                handledPointerChoices.delete(choice);
                handledChoiceEvents.add(event);
                return;
            }
            handledChoiceEvents.add(event);
            choosePickerAsset(picker, choiceAssetId(choice));
        });
    };

    root.addEventListener('click', event => {
        const search = findSearch(event.target);
        if (search && root.contains?.(search) !== false) openPicker(search);
    });

    globalThis.document?.addEventListener?.('click', event => {
        if (handledChoiceEvents.has(event)) return;
        const choice = findChoice(event);
        const options = choice?.closest?.(OPTIONS_SELECTOR);
        const picker = options && (optionOwners.get(options) || options.closest?.(TYPEAHEAD_SELECTOR));
        if (!choice || !picker || !ownsPicker(picker)) return;
        if (handledPointerChoices.has(choice)) {
            handledPointerChoices.delete(choice);
            handledChoiceEvents.add(event);
            return;
        }
        handledChoiceEvents.add(event);
        choosePickerAsset(picker, choiceAssetId(choice));
    });

    root.addEventListener('focusin', event => {
        const search = findSearch(event.target);
        if (search && root.contains?.(search) !== false) openPicker(search);
    });

    root.addEventListener('focusout', event => {
        const picker = findPicker(event.target);
        if (!picker || !ownsPicker(picker)) return;
        const options = getAssetTypeaheadState(picker).options;
        if (event.relatedTarget && (picker.contains?.(event.relatedTarget) || options?.contains?.(event.relatedTarget))) return;
        setTimeout(() => setAssetTypeaheadOpen(picker, false), 0);
    });

    root.addEventListener('input', event => {
        const search = findSearch(event.target);
        if (!search || root.contains?.(search) === false) return;

        const picker = findPicker(search);
        const state = getAssetTypeaheadState(picker);
        const selected = getAssets(getAssetsForPicker).find(asset =>
            String(asset.Id) === String(state.value?.value || ''));
        if (selected && search.value !== selected.DisplayName) {
            onClear?.(picker, state);
            if (state.value) state.value.value = '';
        }
        renderAssetTypeaheadOptions(picker, {
            query: search.value,
            emptyChoiceLabel: getEmptyChoiceLabel(picker),
            includeEmptyChoice,
            getAssets: getAssetsForPicker
        });
        bindPickerOptions(picker);
        setAssetTypeaheadOpen(picker, true);
    });

    root.addEventListener('keydown', event => {
        const search = findSearch(event.target);
        if (!search || root.contains?.(search) === false) return;
        const picker = findPicker(search);
        if (!picker || !ownsPicker(picker)) return;

        if (event.key === 'Escape') {
            setAssetTypeaheadOpen(picker, false);
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        const state = getAssetTypeaheadState(picker);
        const options = getAssetTypeaheadChoices(picker);
        if (!options.length) return;
        if (state.options.hidden) openPicker(search);

        let index = Number(picker.dataset.assetOptionIndex ?? -1);
        if (event.key === 'Enter') {
            if (index >= 0) choosePickerAsset(picker, options[index].dataset.assetTypeaheadChoice || '');
            event.preventDefault();
            return;
        }

        index = event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : (index - 1 + options.length) % options.length;
        picker.dataset.assetOptionIndex = String(index);
        options.forEach((option, optionIndex) => option.classList.toggle('is-focused', optionIndex === index));
        event.preventDefault();
    });

    const reposition = () => repositionOpenAssetTypeaheads(root);
    root.addEventListener('scroll', reposition, true);
    globalThis.window?.addEventListener?.('scroll', reposition, true);
    globalThis.window?.addEventListener?.('resize', reposition);
}
