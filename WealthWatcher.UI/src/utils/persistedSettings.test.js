import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonObject } from './persistedSettings.js';

test('parseJsonObject accepts persisted JSON objects', () => {
    assert.deepEqual(parseJsonObject('{"annualReturn":5}'), { annualReturn: 5 });
});

test('parseJsonObject falls back for malformed or non-object values', () => {
    const fallback = { enabled: true };

    for (const value of ['null', '[]', '"text"', '{invalid']) {
        assert.strictEqual(parseJsonObject(value, fallback), fallback);
    }
    assert.strictEqual(parseJsonObject(null, fallback), fallback);
});
