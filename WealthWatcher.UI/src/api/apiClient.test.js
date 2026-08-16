import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestError, fetchFresh, fetchFreshStrict, requestJson } from './apiClient.js';

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

test('requestJson parses successful payloads and preserves server error messages', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, value: 42 })
    });
    assert.deepEqual(await requestJson('/payload'), { ok: true, value: 42 });

    globalThis.fetch = async () => ({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({ Error: 'The value is invalid.' })
    });
    await assert.rejects(requestJson('/invalid'), error =>
        error instanceof ApiRequestError
        && error.status === 422
        && error.message === 'The value is invalid.');
});

test('requestJson handles empty successful responses without calling json', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        status: 204,
        json: async () => { throw new Error('should not be called'); }
    });
    assert.equal(await requestJson('/empty'), null);
});

test.after(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
});
