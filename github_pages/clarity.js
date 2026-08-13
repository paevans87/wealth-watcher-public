(function initialiseClarityConsent() {
    'use strict';

    const config = window.WEALTH_WATCHER_CLARITY_CONFIG || {};
    const projectId = typeof config.projectId === 'string' ? config.projectId.trim() : '';
    const consentStorageKey = 'wealthwatcher-clarity-consent';
    const consentBanner = document.getElementById('clarity-consent');
    const acceptButton = document.getElementById('clarity-consent-accept');
    const declineButton = document.getElementById('clarity-consent-decline');
    const manageButton = document.getElementById('clarity-consent-manage');

    if (!projectId || !consentBanner || !acceptButton || !declineButton) {
        if (consentBanner) consentBanner.hidden = true;
        if (manageButton) manageButton.hidden = true;
        return;
    }

    function readConsent() {
        try {
            return window.localStorage.getItem(consentStorageKey);
        } catch {
            return null;
        }
    }

    function writeConsent(value) {
        try {
            window.localStorage.setItem(consentStorageKey, value);
        } catch {
            // A blocked storage API should not prevent the visitor from using the page.
        }
    }

    function showConsentBanner() {
        consentBanner.hidden = false;
        acceptButton.focus();
    }

    function hideConsentBanner() {
        consentBanner.hidden = true;
        if (manageButton) manageButton.hidden = false;
    }

    function loadClarity() {
        if (window.__wealthWatcherClarityLoaded) return;
        window.__wealthWatcherClarityLoaded = true;

        window.clarity = window.clarity || function clarityQueue() {
            (window.clarity.q = window.clarity.q || []).push(arguments);
        };

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
        document.head.appendChild(script);
    }

    acceptButton.addEventListener('click', () => {
        writeConsent('granted');
        hideConsentBanner();
        loadClarity();
    });

    declineButton.addEventListener('click', () => {
        writeConsent('denied');
        hideConsentBanner();
    });

    manageButton?.addEventListener('click', showConsentBanner);

    const consent = readConsent();
    if (consent === 'granted') {
        if (manageButton) manageButton.hidden = false;
        loadClarity();
    } else if (consent === 'denied') {
        if (manageButton) manageButton.hidden = false;
    } else {
        showConsentBanner();
    }
})();
