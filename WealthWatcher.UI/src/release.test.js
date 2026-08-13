import assert from 'node:assert/strict';
import test from 'node:test';

import {
    checkForLatestRelease,
    compareVersions,
    normalizeReleaseManifest,
    parseReleaseNotesMarkdown
} from './release.js';

test('release versions compare using Semantic Version precedence', () => {
    assert.equal(compareVersions('v0.2.0', '0.1.9') > 0, true);
    assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10') < 0, true);
    assert.equal(compareVersions('1.0.0', '1.0.0-rc.1') > 0, true);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('GitHub release payloads normalize to the application release contract', () => {
    const release = normalizeReleaseManifest({
        tag_name: 'v0.2.0',
        published_at: '2026-08-14T12:00:00Z',
        html_url: 'https://github.com/paevans87/wealth-watcher-public/releases/tag/v0.2.0',
        body: '## Highlights\n\n- A new feature'
    });

    assert.deepEqual({
        version: release.version,
        tag: release.tag,
        releasedAt: release.releasedAt,
        releaseUrl: release.releaseUrl,
        notesMarkdown: release.notesMarkdown
    }, {
        version: '0.2.0',
        tag: 'v0.2.0',
        releasedAt: '2026-08-14T12:00:00Z',
        releaseUrl: 'https://github.com/paevans87/wealth-watcher-public/releases/tag/v0.2.0',
        notesMarkdown: '## Highlights\n\n- A new feature'
    });
});

test('release Markdown parser supports the constrained headings, lists, and paragraphs', () => {
    assert.deepEqual(parseReleaseNotesMarkdown('# Title\n\nIntro text.\n\n## Highlights\n\n- First\n- Second'), [
        { type: 'heading', level: 1, text: 'Title' },
        { type: 'paragraph', text: 'Intro text.' },
        { type: 'heading', level: 2, text: 'Highlights' },
        { type: 'list', items: ['First', 'Second'] }
    ]);
});

test('newer release metadata produces an update result without updating Docker', async () => {
    const result = await checkForLatestRelease({
        currentRelease: normalizeReleaseManifest({ version: '0.1.0', notesMarkdown: '' }),
        endpoint: '/latest.json',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ version: '0.2.0', body: '## Fixes\n\n- A fix' })
        })
    });

    assert.equal(result.updateAvailable, true);
    assert.equal(result.latestRelease.version, '0.2.0');
});
