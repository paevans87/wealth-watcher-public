(function initialiseAnalyticsConsent() {
    'use strict';

    const clarityConfig = window.WEALTH_WATCHER_CLARITY_CONFIG || {};
    const ga4Config = window.WEALTH_WATCHER_GA4_CONFIG || {};
    const projectId = typeof clarityConfig.projectId === 'string' ? clarityConfig.projectId.trim() : '';
    const measurementId = typeof ga4Config.measurementId === 'string' ? ga4Config.measurementId.trim() : '';
    const consentStorageKey = 'wealthwatcher-analytics-consent';
    const legacyConsentStorageKey = 'wealthwatcher-clarity-consent';
    const consentBanner = document.getElementById('analytics-consent');
    const acceptButton = document.getElementById('analytics-consent-accept');
    const declineButton = document.getElementById('analytics-consent-decline');
    const manageButton = document.getElementById('analytics-consent-manage');

    if ((!projectId && !measurementId) || !consentBanner || !acceptButton || !declineButton) {
        if (consentBanner) consentBanner.hidden = true;
        if (manageButton) manageButton.hidden = true;
        return;
    }

    function readConsent() {
        try {
            return window.localStorage.getItem(consentStorageKey)
                || window.localStorage.getItem(legacyConsentStorageKey);
        } catch {
            return null;
        }
    }

    function writeConsent(value) {
        try {
            window.localStorage.setItem(consentStorageKey, value);
            // Keep the previous key in sync so an existing Clarity choice is
            // respected by the combined analytics preference.
            window.localStorage.setItem(legacyConsentStorageKey, value);
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
        if (!projectId || window.__wealthWatcherClarityLoaded) return;
        window.__wealthWatcherClarityLoaded = true;

        window.clarity = window.clarity || function clarityQueue() {
            (window.clarity.q = window.clarity.q || []).push(arguments);
        };

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
        document.head.appendChild(script);
    }

    function loadGoogleAnalytics() {
        if (!measurementId || window.__wealthWatcherGoogleAnalyticsLoaded) return;
        window.__wealthWatcherGoogleAnalyticsLoaded = true;

        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function gtagQueue() {
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        window.gtag('config', measurementId);

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
        document.head.appendChild(script);
    }

    function loadAnalytics() {
        loadClarity();
        loadGoogleAnalytics();
    }

    acceptButton.addEventListener('click', () => {
        writeConsent('granted');
        hideConsentBanner();
        loadAnalytics();
    });

    declineButton.addEventListener('click', () => {
        writeConsent('denied');
        hideConsentBanner();
    });

    manageButton?.addEventListener('click', showConsentBanner);

    const consent = readConsent();
    if (consent === 'granted') {
        if (manageButton) manageButton.hidden = false;
        loadAnalytics();
    } else if (consent === 'denied') {
        if (manageButton) manageButton.hidden = false;
    } else {
        showConsentBanner();
    }
})();
