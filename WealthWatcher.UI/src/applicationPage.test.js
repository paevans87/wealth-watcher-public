import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const html = await readFile(indexPath, 'utf8');

function countId(id) {
    return (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
}

test('Application release content has one dedicated static page contract', () => {
    assert.equal(countId('application-view'), 1);
    assert.equal(countId('application-release-panel'), 1);
    assert.equal(countId('settings-view'), 1);
    assert.match(html, /href="#application" class="nav-brand-version" id="app-bar-version"/);
    assert.doesNotMatch(html, /id="nav-application"/);
    assert.doesNotMatch(html, /id="application-version-pane"/);
    assert.doesNotMatch(html, /data-pane-id="application-version"/);
    assert.ok(html.indexOf('id="application-view"') < html.indexOf('id="settings-view"'));
});

test('release DOM IDs remain unique after moving the page out of Settings', () => {
    for (const id of [
        'release-update-status',
        'release-current-version',
        'release-current-date',
        'release-update-details',
        'release-check-button',
        'release-link',
        'release-check-message',
        'release-notes-version',
        'release-notes'
    ]) {
        assert.equal(countId(id), 1, `${id} should occur exactly once`);
    }
});
