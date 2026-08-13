import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestError, fetchFresh, fetchFreshStrict } from './apiClient.js';

const originalFetch = globalThis.fetch;

test('strict fresh requests preserve HTTP failures as typed errors', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Unavailable' });

    await assert.rejects(
        fetchFreshStrict('/health-check'),
        error => error instanceof ApiRequestError
            && error.status === 503
            && error.url === '/health-check'
    );
});

test('strict fresh requests preserve transport and JSON failures', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); }
    });

    await assert.rejects(fetchFreshStrict('/broken-json'), error =>
        error instanceof ApiRequestError && /Invalid JSON/.test(error.message));

    globalThis.fetch = async () => { throw new Error('Offline'); };
    await assert.rejects(fetchFreshStrict('/offline'), error =>
        error instanceof ApiRequestError && /Offline/.test(error.message));
});

test('compatibility requests retain null-on-failure behaviour', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Failed' });
    assert.equal(await fetchFresh('/legacy-compatible'), null);
});

test.after(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
});
