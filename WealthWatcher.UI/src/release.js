const runtimeEnv = import.meta.env || {};

export const RELEASE_MANIFEST_URL = `${runtimeEnv.BASE_URL || '/'}release.json`;
export const RELEASE_ENDPOINT = runtimeEnv.VITE_RELEASE_ENDPOINT
    || 'https://api.github.com/repos/paevans87/wealth-watcher-public/releases/latest';

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function normalizeVersion(value) {
    const match = String(value ?? '').trim().match(SEMVER_PATTERN);
    if (!match) return null;
    return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ''}`;
}

function parseVersion(value) {
    const normalized = normalizeVersion(value);
    if (!normalized) return null;
    const match = normalized.match(SEMVER_PATTERN);
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : []
    };
}

function comparePrerelease(left, right) {
    if (left.length === 0 && right.length === 0) return 0;
    if (left.length === 0) return 1;
    if (right.length === 0) return -1;

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index];
        const rightPart = right[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);
        if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return leftPart < rightPart ? -1 : 1;
    }

    return 0;
}

export function compareVersions(left, right) {
    const leftVersion = parseVersion(left);
    const rightVersion = parseVersion(right);
    if (!leftVersion || !rightVersion) return 0;

    for (const part of ['major', 'minor', 'patch']) {
        if (leftVersion[part] !== rightVersion[part]) {
            return leftVersion[part] - rightVersion[part];
        }
    }

    return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function normalizeReleaseManifest(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const version = normalizeVersion(payload.version || payload.tag || payload.tag_name);
    if (!version) return null;

    return {
        schemaVersion: Number(payload.schemaVersion || 1),
        name: String(payload.name || 'Wealth Watcher'),
        version,
        tag: `v${version}`,
        channel: String(payload.channel || 'stable'),
        releasedAt: payload.releasedAt || payload.publishedAt || payload.published_at || null,
        requiresMigration: payload.requiresMigration === true,
        requiresConfigurationChange: payload.requiresConfigurationChange === true,
        releaseUrl: String(payload.releaseUrl || payload.html_url || `https://github.com/paevans87/wealth-watcher-public/releases/tag/v${version}`),
        notesMarkdown: String(payload.notesMarkdown ?? payload.body ?? '').trim()
    };
}

export function parseReleaseNotesMarkdown(markdown = '') {
    const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
        if (!paragraph.length) return;
        blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
        paragraph = [];
    };

    const flushList = () => {
        if (!list) return;
        blocks.push(list);
        list = null;
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        const bullet = trimmed.match(/^[-*+]\s+(.+)$/);

        if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
        }

        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
            continue;
        }

        if (bullet) {
            flushParagraph();
            if (!list) list = { type: 'list', items: [] };
            list.items.push(bullet[1].trim());
            continue;
        }

        flushList();
        paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    return blocks;
}

function isSafeLink(value) {
    try {
        const url = new URL(value, globalThis.window?.location?.origin || 'https://wealthwatcher.co.uk');
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function appendInlineMarkdown(parent, value) {
    const text = String(value ?? '');
    const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g;
    let cursor = 0;

    const appendText = textValue => {
        if (textValue) parent.appendChild(document.createTextNode(textValue));
    };

    for (const match of text.matchAll(tokenPattern)) {
        appendText(text.slice(cursor, match.index));
        const token = match[0];

        if (token.startsWith('**')) {
            const strong = document.createElement('strong');
            strong.textContent = token.slice(2, -2);
            parent.appendChild(strong);
        } else if (token.startsWith('`')) {
            const code = document.createElement('code');
            code.textContent = token.slice(1, -1);
            parent.appendChild(code);
        } else {
            const linkMatch = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
            if (!linkMatch || !isSafeLink(linkMatch[2])) {
                appendText(token);
            } else {
                const link = document.createElement('a');
                link.href = linkMatch[2];
                link.target = '_blank';
                link.rel = 'noreferrer noopener';
                link.textContent = linkMatch[1];
                parent.appendChild(link);
            }
        }

        cursor = match.index + token.length;
    }

    appendText(text.slice(cursor));
}

export function renderReleaseNotes(container, markdown) {
    if (!container) return;
    const blocks = parseReleaseNotesMarkdown(markdown);

    if (typeof container.replaceChildren === 'function') container.replaceChildren();
    else container.innerHTML = '';

    for (const block of blocks) {
        if (block.type === 'heading') {
            const heading = document.createElement(block.level <= 1 ? 'h4' : block.level === 2 ? 'h5' : 'h6');
            appendInlineMarkdown(heading, block.text);
            container.appendChild(heading);
            continue;
        }

        if (block.type === 'list') {
            const list = document.createElement('ul');
            block.items.forEach(item => {
                const listItem = document.createElement('li');
                appendInlineMarkdown(listItem, item);
                list.appendChild(listItem);
            });
            container.appendChild(list);
            continue;
        }

        const paragraph = document.createElement('p');
        appendInlineMarkdown(paragraph, block.text);
        container.appendChild(paragraph);
    }
}

async function fetchJson(fetchImpl, url) {
    if (typeof fetchImpl !== 'function' || !url) throw new Error('Release metadata is unavailable.');
    const response = await fetchImpl(url, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response?.ok) throw new Error(`Release metadata request failed with status ${response?.status || 'unknown'}.`);
    return response.json();
}

export async function loadLocalReleaseManifest({ fetchImpl = globalThis.fetch, url = RELEASE_MANIFEST_URL } = {}) {
    try {
        return normalizeReleaseManifest(await fetchJson(fetchImpl, url));
    } catch (error) {
        console.warn('Unable to load bundled release metadata.', error);
        return null;
    }
}

export async function checkForLatestRelease({
    currentRelease,
    endpoint = RELEASE_ENDPOINT,
    fetchImpl = globalThis.fetch
} = {}) {
    if (!currentRelease || !endpoint) return { currentRelease, latestRelease: null, updateAvailable: false };

    try {
        const latestRelease = normalizeReleaseManifest(await fetchJson(fetchImpl, endpoint));
        return {
            currentRelease,
            latestRelease,
            updateAvailable: Boolean(latestRelease && compareVersions(latestRelease.version, currentRelease.version) > 0),
            error: null
        };
    } catch (error) {
        return {
            currentRelease,
            latestRelease: null,
            updateAvailable: false,
            error
        };
    }
}

function releaseElements() {
    const get = id => document.getElementById(id);
    return {
        appBarVersion: get('app-bar-version'),
        appBarVersionNumber: get('app-bar-version-number'),
        appBarUpdateStatus: get('app-bar-update-status'),
        currentVersion: get('release-current-version'),
        currentReleaseDate: get('release-current-date'),
        releaseUpdateStatus: get('release-update-status'),
        releaseUpdateDetails: get('release-update-details'),
        releaseNotesVersion: get('release-notes-version'),
        releaseNotes: get('release-notes'),
        releaseLink: get('release-link'),
        checkButton: get('release-check-button'),
        checkMessage: get('release-check-message')
    };
}

function formatReleasedAt(value) {
    if (!value) return 'Release date unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
}

function renderReleaseState({ currentRelease, latestRelease, updateAvailable, error = null }) {
    const elements = releaseElements();
    if (!currentRelease) {
        setHidden(elements.appBarVersion, true);
        setHidden(elements.releaseLink, true);
        if (elements.currentVersion) elements.currentVersion.textContent = 'Version unavailable';
        if (elements.currentReleaseDate) elements.currentReleaseDate.textContent = 'Release date unavailable';
        if (elements.releaseUpdateStatus) {
            elements.releaseUpdateStatus.textContent = 'Version metadata is unavailable.';
            elements.releaseUpdateStatus.classList.remove('is-update-available');
        }
        if (elements.releaseUpdateDetails) {
            elements.releaseUpdateDetails.textContent = 'Release information could not be loaded. Try again later or contact the deployment owner.';
        }
        if (elements.releaseNotesVersion) elements.releaseNotesVersion.textContent = '';
        renderReleaseNotes(elements.releaseNotes, 'Release notes are unavailable until version metadata can be loaded.');
        if (elements.checkMessage) elements.checkMessage.textContent = 'Version metadata is unavailable.';
        return;
    }

    const displayedRelease = updateAvailable ? latestRelease : currentRelease;
    const currentVersionText = `v${currentRelease.version}`;
    if (elements.appBarVersionNumber) elements.appBarVersionNumber.textContent = currentVersionText;
    if (elements.appBarVersion) elements.appBarVersion.hidden = false;
    if (elements.currentVersion) elements.currentVersion.textContent = currentVersionText;
    if (elements.currentReleaseDate) elements.currentReleaseDate.textContent = formatReleasedAt(currentRelease.releasedAt);
    if (elements.releaseNotesVersion) elements.releaseNotesVersion.textContent = `v${displayedRelease.version}`;
    if (elements.releaseLink) {
        setHidden(elements.releaseLink, false);
        elements.releaseLink.href = displayedRelease.releaseUrl;
        elements.releaseLink.textContent = updateAvailable ? `View v${displayedRelease.version} release` : 'View release details';
    }
    renderReleaseNotes(elements.releaseNotes, displayedRelease.notesMarkdown || 'Release notes are available at the linked release page.');

    setHidden(elements.appBarUpdateStatus, !updateAvailable);
    if (elements.releaseUpdateStatus) {
        elements.releaseUpdateStatus.textContent = updateAvailable
            ? `Update available: v${latestRelease.version}`
            : 'You are up to date.';
        elements.releaseUpdateStatus.classList.toggle('is-update-available', updateAvailable);
    }
    if (elements.releaseUpdateDetails) {
        elements.releaseUpdateDetails.textContent = updateAvailable
            ? 'A newer image release is available. Docker updates are applied manually by the deployment owner.'
            : 'Updates are checked against the latest stable release. Docker updates are applied manually by the deployment owner.';
    }
    if (elements.checkMessage) {
        elements.checkMessage.textContent = error
            ? 'The latest release could not be checked. Check your connection or try again later.'
            : `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}.`;
    }
}

export async function setupReleaseInfo({
    checkForUpdates = true,
    endpoint = RELEASE_ENDPOINT,
    fetchImpl = globalThis.fetch
} = {}) {
    const elements = releaseElements();
    if (!elements.currentVersion && !elements.appBarVersion) return null;

    let currentRelease = await loadLocalReleaseManifest({ fetchImpl });
    renderReleaseState({ currentRelease, latestRelease: null, updateAvailable: false });

    let checking = null;
    const refresh = async () => {
        if (checking) return checking;
        checking = (async () => {
            if (!currentRelease) {
                currentRelease = await loadLocalReleaseManifest({ fetchImpl });
            }
            const result = await checkForLatestRelease({ currentRelease, endpoint, fetchImpl });
            renderReleaseState(result);
            return result;
        })().finally(() => {
            checking = null;
        });
        return checking;
    };

    if (elements.checkButton && elements.checkButton.dataset.releaseInit !== 'true') {
        elements.checkButton.dataset.releaseInit = 'true';
        elements.checkButton.addEventListener('click', () => {
            elements.checkButton.disabled = true;
            void refresh().finally(() => {
                elements.checkButton.disabled = false;
            });
        });
    }

    if (checkForUpdates) await refresh();
    return { currentRelease, refresh };
}
