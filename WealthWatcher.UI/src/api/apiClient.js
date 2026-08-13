import { store } from '../store/store.js';

// Vite serves the UI directly during local development, so keep using the
// host-published API port there. The production image proxies /api through
// Nginx, which keeps browser requests on the same HTTPS origin. The fallback
// also keeps the module usable from the native Node test runner, where Vite's
// import.meta.env object is not present.
const isDevelopment = import.meta.env?.DEV ?? true;
const isViteRuntime = import.meta.env != null;
const apiHost = globalThis.window?.location?.hostname ?? 'localhost';
const apiPort = import.meta.env?.VITE_API_PORT ?? '5000';
const configuredApiBaseUrl = import.meta.env?.VITE_API_BASE_URL;
const useDevelopmentProxy = isViteRuntime && isDevelopment && !configuredApiBaseUrl;

export const isDemoMode = import.meta.env?.VITE_DEMO_MODE === 'true'
    || globalThis.__WEALTH_WATCHER_DEMO_MODE__ === true;

export const API_BASE_URL = isDevelopment
    ? (configuredApiBaseUrl || (useDevelopmentProxy ? '/api' : `http://${apiHost}:${apiPort}/api`))
    : '/api';

export class ApiRequestError extends Error {
    constructor(message, { url = '', status = null, statusText = '', cause = null } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ApiRequestError';
        this.url = url;
        this.status = status;
        this.statusText = statusText;
    }
}

function normalizeApiRequestUrl(url) {
    if (url instanceof URL) return url;
    const value = String(url ?? '');
    if (!value.startsWith('/') || value === '/api' || value.startsWith('/api/')) return url;
    return `${API_BASE_URL}${value}`;
}

export async function apiRequest(url, options = {}) {
    const requestOptions = options || {};
    if (isDemoMode) {
        const { handleDemoRequest } = await import('../demo/demoApi.js');
        return handleDemoRequest(normalizeApiRequestUrl(url), requestOptions);
    }

    if (typeof globalThis.fetch !== 'function') {
        throw new Error('The browser fetch API is unavailable.');
    }
    return globalThis.fetch(normalizeApiRequestUrl(url), requestOptions);
}

export async function resetDemoData() {
    if (!isDemoMode) return false;
    const { resetDemoState } = await import('../demo/demoApi.js');
    resetDemoState();
    return true;
}

export async function fetchCached(url, options = null, cacheOptions = {}) {
    const method = options?.method || 'GET';
    const body = options?.body || '';
    const throwOnError = cacheOptions.throwOnError === true;
    const cacheKey = `${method}:${url}:${body}:${throwOnError ? 'strict' : 'compat'}`;
    const shouldCache = cacheOptions.cacheResponse !== false;
    const generation = store.cacheGeneration;
    const now = Date.now();
    const expiry = store.apiCacheMeta[cacheKey]?.expiresAt;
    const hasCachedValue = Object.prototype.hasOwnProperty.call(store.apiCache, cacheKey);
    if (shouldCache && hasCachedValue && (!expiry || expiry > now)) return store.apiCache[cacheKey];
    if (shouldCache && hasCachedValue) {
        delete store.apiCache[cacheKey];
        delete store.apiCacheMeta[cacheKey];
        delete store.apiCacheTags[cacheKey];
    }

    if (store.apiInflight[cacheKey]) return store.apiInflight[cacheKey];

    const request = (async () => {
        try {
            const res = await apiRequest(url, options);
            if (!res.ok) {
                const error = new ApiRequestError(
                    `API request failed (${res.status || 'unknown'}): ${res.statusText || 'Request failed'}`,
                    { url, status: res.status ?? null, statusText: res.statusText || '' }
                );
                if (throwOnError) throw error;
                console.error(error.message, `for ${url}`);
                return null;
            }
            const data = await res.json();
            if (shouldCache && store.cacheGeneration === generation) {
                store.apiCache[cacheKey] = data;
                const ttlMs = Number(cacheOptions.ttlMs);
                store.apiCacheMeta[cacheKey] = {
                    expiresAt: Number.isFinite(ttlMs) && ttlMs > 0 ? Date.now() + ttlMs : null
                };
                store.apiCacheTags[cacheKey] = Array.isArray(cacheOptions.tags)
                    ? cacheOptions.tags.filter(Boolean)
                    : [];
            }
            return data;
        } catch (e) {
            if (throwOnError) {
                if (e instanceof ApiRequestError) throw e;
                throw new ApiRequestError(
                    e?.message || 'Unable to complete the API request.',
                    { url, cause: e }
                );
            }
            console.error("Fetch Error:", e);
            return null;
        } finally {
            if (store.apiInflight[cacheKey] === request) delete store.apiInflight[cacheKey];
        }
    })();

    store.apiInflight[cacheKey] = request;
    return request;
}

export function fetchFresh(url, options = null) {
    return fetchCached(url, options, { cacheResponse: false });
}

export function fetchFreshStrict(url, options = null) {
    return fetchCached(url, options, { cacheResponse: false, throwOnError: true });
}

export async function saveDbSettings(key, valueObj) {
    const payload = {};
    payload[key] = JSON.stringify(valueObj);
    try {
        const res = await apiRequest(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch (e) {
        console.error("Save DB Settings Error:", e);
        return false;
    }
}
