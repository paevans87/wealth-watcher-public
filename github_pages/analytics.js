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
    const demoMode = document.documentElement?.dataset.demoMode === 'true';
    let analyticsStarted = false;
    let trackedEventsReady = false;
    const trackedScrollMilestones = new Set();

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

    function getRoute() {
        return `${window.location.pathname || '/'}${window.location.hash || ''}`.slice(0, 120);
    }

    function sanitizeParams(params) {
        return Object.fromEntries(Object.entries(params || {})
            .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value).slice(0, 120)]));
    }

    function trackEvent(eventName, params = {}) {
        if (!analyticsStarted || typeof eventName !== 'string' || !eventName) return;

        const safeParams = sanitizeParams(params);
        if (typeof window.gtag === 'function') {
            window.gtag('event', eventName, safeParams);
        }

        // Custom tags remain limited to route and interaction metadata. No
        // dashboard, account, asset, balance, or free-text values are sent.
        if (typeof window.clarity === 'function') {
            window.clarity('set', 'ww_event', eventName);
            Object.entries(safeParams).forEach(([key, value]) => {
                window.clarity('set', `ww_${key}`, value);
            });
        }
    }

    function getElementParams(element) {
        const href = element.getAttribute('href') || '';
        let destinationPath = '';
        let destinationHost = element.dataset.analyticsDestinationHost || '';
        try {
            const destination = new URL(href, window.location.href);
            if (destination.origin === window.location.origin) {
                destinationPath = destination.pathname;
            } else if (!destinationHost) {
                destinationHost = destination.hostname;
            }
        } catch {
            // Invalid or non-link elements simply omit destination metadata.
        }

        return {
            cta_id: element.dataset.analyticsCtaId,
            link_id: element.dataset.analyticsLinkId,
            placement: element.dataset.analyticsPlacement,
            action: element.dataset.analyticsAction,
            route: element.dataset.analyticsRoute || getRoute(),
            destination_path: destinationPath,
            destination_host: destinationHost
        };
    }

    function handleTrackedClick(event) {
        const target = event.target?.closest?.('[data-analytics-event]');
        if (!target) return;
        trackEvent(target.dataset.analyticsEvent, getElementParams(target));
    }

    function trackScrollMilestones() {
        if (demoMode || !document.documentElement) return;
        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollableHeight <= 0) return;

        const progress = Math.round((window.scrollY / scrollableHeight) * 100);
        [25, 50, 75, 90].forEach(milestone => {
            if (progress < milestone || trackedScrollMilestones.has(milestone)) return;
            trackedScrollMilestones.add(milestone);
            trackEvent('scroll_milestone', { milestone, route: getRoute() });
        });
    }

    function setupTrackedEvents() {
        if (trackedEventsReady) return;
        trackedEventsReady = true;
        document.addEventListener('click', handleTrackedClick, true);
        if (demoMode) {
            trackEvent('demo_view', { route: getRoute(), demo_mode: 'fictional' });
        } else {
            window.addEventListener('scroll', trackScrollMilestones, { passive: true });
            trackScrollMilestones();
        }
    }

    window.wealthWatcherTrack = trackEvent;

    if ((!projectId && !measurementId) || !consentBanner || !acceptButton || !declineButton) {
        if (consentBanner) consentBanner.hidden = true;
        if (manageButton) manageButton.hidden = true;
        return;
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
        analyticsStarted = true;
        setupTrackedEvents();
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
        hideConsentBanner();
        loadAnalytics();
    } else if (consent === 'denied') {
        hideConsentBanner();
    } else {
        showConsentBanner();
    }
})();
