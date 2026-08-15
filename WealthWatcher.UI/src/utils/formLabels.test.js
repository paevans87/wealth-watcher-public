import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const documentMarkup = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('critical static form controls have associated labels', () => {
    for (const id of [
        'entry-name',
        'entry-value',
        'entry-mortgage',
        'entry-invested',
        'entry-date',
        'fire-setting-income',
        'fire-setting-swr',
        'forecast-setting-dob',
        'forecast-setting-return',
        'forecast-setting-contribution'
    ]) {
        assert.match(documentMarkup, new RegExp(`<label\\s+for=["']${id}["']`));
    }
});
