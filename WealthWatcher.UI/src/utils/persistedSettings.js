/**
 * Parse a value persisted by the settings API when it is expected to be a
 * JSON object. Older or manually edited databases can contain null, arrays,
 * or malformed JSON; those values should fall back to the caller's defaults
 * instead of aborting application bootstrap.
 */
export function parseJsonObject(value, fallback = {}) {
    if (typeof value !== 'string') return fallback;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : fallback;
    } catch {
        return fallback;
    }
}
