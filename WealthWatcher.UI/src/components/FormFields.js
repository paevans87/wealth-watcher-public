const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

function renderAttributes(attributes = {}) {
    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== null && value !== false)
        .map(([name, value]) => ` ${name}="${escapeHtml(value === true ? '' : value)}"`)
        .join('');
}

/**
 * Shared catalog-style field shell used by static and dynamic settings forms.
 * The control markup is deliberately kept in one place so labels, ids, and
 * class hooks do not drift between create and edit flows.
 */
export function renderCatalogInputField({
    id,
    name,
    label,
    type = 'text',
    className = 'catalog-field catalog-field-grow',
    wrapperId = '',
    required = false,
    placeholder = '',
    value = '',
    min,
    step,
    title = '',
    inputAttributes = {}
    } = {}) {
    const wrapperAttributes = wrapperId ? ` id="${escapeHtml(wrapperId)}"` : '';
    const attributes = renderAttributes({
        id,
        name,
        type,
        required,
        placeholder,
        value,
        min,
        step,
        title,
        ...inputAttributes
    });
    return `<label class="${escapeHtml(className)}"${wrapperAttributes}>
        <span>${escapeHtml(label)}</span>
        <input${attributes}>
    </label>`;
}

export function renderCurrencyInputField(options = {}) {
    return renderCatalogInputField({
        ...options,
        inputAttributes: {
            class: 'currency-input',
            inputmode: 'decimal',
            ...(options.inputAttributes || {})
        }
    });
}

export function renderDateInputField(options = {}) {
    return renderCatalogInputField({
        ...options,
        inputAttributes: {
            class: 'flatpickr-input',
            ...(options.inputAttributes || {})
        }
    });
}

export function renderSelectField({
    id,
    name,
    label = '',
    className = 'integration-select',
    options = '',
    required = false,
    disabled = false,
    hidden = false,
    ariaLabel = '',
    wrapperClassName = '',
    wrapperId = '',
    labelSpanId = '',
    attributes: extraAttributes = {}
} = {}) {
    const wrapperIdAttribute = wrapperId ? ` id="${escapeHtml(wrapperId)}"` : '';
    const wrapper = label
        ? `<label class="${escapeHtml(wrapperClassName || 'catalog-field catalog-field-parent')}"${wrapperIdAttribute}><span${labelSpanId ? ` id="${escapeHtml(labelSpanId)}"` : ''}>${escapeHtml(label)}</span>`
        : '';
    const closeWrapper = label ? '</label>' : '';
    const attributes = renderAttributes({
        id,
        name,
        required,
        disabled,
        hidden,
        'aria-label': ariaLabel,
        ...extraAttributes
    });
    return `${wrapper}<select class="${escapeHtml(className)}"${attributes}>${options}</select>${closeWrapper}`;
}

export function renderFeatureToggle({
    id,
    label,
    className = '',
    title = '',
    inputAttributes = {}
} = {}) {
    const extraClass = className ? ` ${escapeHtml(className)}` : '';
    const extraAttributes = renderAttributes(inputAttributes);
    return `<label class="feature-toggle${extraClass}" for="${escapeHtml(id)}"${title ? ` title="${escapeHtml(title)}"` : ''}>
        <span>${escapeHtml(label)}</span>
        <input type="checkbox" id="${escapeHtml(id)}" role="switch"${extraAttributes}>
        <span class="feature-toggle-track" aria-hidden="true"><span class="feature-toggle-thumb"></span></span>
    </label>`;
}

export { escapeHtml };
