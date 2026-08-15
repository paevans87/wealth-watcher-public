import { store } from '../store/store.js';
import { renderFireView } from '../pages/FireTracker.js';
import { loadHistoryView } from '../pages/History.js';
import { loadCalendarView } from '../pages/Calendar.js';
import { loadForecastView } from '../pages/ForecastV2.js';
import { populateFireSettings, populateGeneralSettings } from '../components/Modals.js';
import { populateForecastSettings } from '../pages/ForecastV2.js';
import { loadBudgetView, populateBudgetSettings } from '../pages/Budget.js';
import { expandPane, initAllCollapsiblePanes } from '../components/CollapsiblePane.js';
import { populateFireFeatureSettings } from '../components/FireSettings.js';
import { populateMilestoneSettings } from '../components/Milestones.js';
import { updateHourlyRefreshLifecycle } from '../pages/Dashboard.js';
import { applyFeatureVisibility, getFeatureKeyForRoute, isFeatureEnabled } from '../utils/featureFlags.js';

export function setupRouter() {
    window.addEventListener('hashchange', handleRouting);
}

function syncActiveNavState() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.removeAttribute('aria-current');
        if (link.classList.contains('active')) {
            link.setAttribute('aria-current', 'page');
        }
    });
}

/**
 * Reads the optional settings target from a direct settings hash link.
 * Examples: #settings?panel=monthly-budget and
 * #settings?panel=fire-settings&focus=fire-forecast-settings.
 * @param {string} hash
 * @returns {{panelId: string, focusId: string|null}|null}
 */
export function getSettingsPanelTarget(hash = '') {
    const [route, query = ''] = String(hash || '').split('?');
    if (route !== '#settings') return null;

    const params = new URLSearchParams(query);
    const panelId = params.get('panel')?.trim();
    if (!panelId) return null;

    return {
        panelId,
        focusId: params.get('focus')?.trim() || null
    };
}

/**
 * Removes a one-time settings panel target after it has been revealed.
 * This prevents the deep-link from overriding the pane's saved state on refresh.
 * @param {string} hash
 * @returns {boolean} True when the settings query was consumed.
 */
export function clearSettingsPanelQuery(hash = '') {
    const [route, query = ''] = String(hash || '').split('?');
    if (route !== '#settings' || !query) return false;

    const history = globalThis.window?.history;
    if (typeof history?.replaceState !== 'function') return false;

    history.replaceState(history.state ?? null, '', route);
    return true;
}

/**
 * Expands a settings pane requested by a direct route and scrolls to an
 * optional subsection. The anchor remains the accessible navigation control;
 * this helper only reveals the requested destination after routing.
 * @param {{panelId: string, focusId?: string|null}|null} target
 * @returns {HTMLElement|null}
 */
export function revealSettingsPanel(target) {
    if (!target) return null;

    const panel = document.getElementById(target.panelId)
        || document.querySelector(`[data-pane-id="${target.panelId}"]`);
    if (!panel || !expandPane(panel)) return null;

    const focusTarget = target.focusId
        ? document.getElementById(target.focusId)
        : panel;
    focusTarget?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });

    return panel;
}

export function handleRouting() {
    const hash = window.location.hash || '#dashboard';
    const route = hash.split('?')[0];

    applyFeatureVisibility();
    
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const featureKey = getFeatureKeyForRoute(route);
    if (featureKey && !isFeatureEnabled(featureKey)) {
        const dashboardView = document.getElementById('dashboard-view');
        const navDashboard = document.getElementById('nav-dashboard');
        if (dashboardView) dashboardView.classList.add('active');
        if (navDashboard) navDashboard.classList.add('active');
        if (window.location.hash !== '#dashboard') {
            window.location.hash = '#dashboard';
        }
        syncActiveNavState();
        updateHourlyRefreshLifecycle({ immediate: true });
        return;
    }
    
    if (route === '#fire') {
        const fireView = document.getElementById('fire-view');
        const navFire = document.getElementById('nav-fire');
        if(fireView) fireView.classList.add('active');
        if(navFire) navFire.classList.add('active');
        
        if (store.state.isDashboardLoaded) {
            renderFireView();
        }
    } else if (route === '#budget') {
        const budgetView = document.getElementById('budget-view');
        const navBudget = document.getElementById('nav-budget');
        if(budgetView) budgetView.classList.add('active');
        if(navBudget) navBudget.classList.add('active');
        
        loadBudgetView();
    } else if (route === '#history') {
        const historyView = document.getElementById('history-view');
        const navHistory = document.getElementById('nav-history');
        if(historyView) historyView.classList.add('active');
        if(navHistory) navHistory.classList.add('active');
        
        if (!store.state.isHistoryLoaded) {
            loadHistoryView();
            store.state.isHistoryLoaded = true;
        }
    } else if (route === '#calendar') {
        const calendarView = document.getElementById('calendar-view');
        const navCalendar = document.getElementById('nav-calendar');
        if(calendarView) calendarView.classList.add('active');
        if(navCalendar) navCalendar.classList.add('active');

        if (!store.state.isCalendarLoaded) {
            loadCalendarView();
            store.state.isCalendarLoaded = true;
        }
    } else if (route === '#forecast') {
        const forecastView = document.getElementById('forecast-view');
        const navForecast = document.getElementById('nav-forecast');
        if(forecastView) forecastView.classList.add('active');
        if(navForecast) navForecast.classList.add('active');
        
        if (!store.state.isForecastLoaded) {
            loadForecastView();
            store.state.isForecastLoaded = true;
        }
    } else if (route === '#settings') {
        const settingsView = document.getElementById('settings-view');
        const navSettings = document.getElementById('nav-settings');
        if(settingsView) settingsView.classList.add('active');
        if(navSettings) navSettings.classList.add('active');

        // Populate form fields with current state data when view opens
        populateGeneralSettings();
        populateFireFeatureSettings();
        populateFireSettings();
        populateForecastSettings();
        populateBudgetSettings();
        populateMilestoneSettings();
        initAllCollapsiblePanes(settingsView);
        const settingsPanelTarget = getSettingsPanelTarget(hash);
        if (revealSettingsPanel(settingsPanelTarget)) {
            clearSettingsPanelQuery(hash);
        }
    } else {
        const dashboardView = document.getElementById('dashboard-view');
        const navDashboard = document.getElementById('nav-dashboard');
        if(dashboardView) dashboardView.classList.add('active');
        if(navDashboard) navDashboard.classList.add('active');
    }

    syncActiveNavState();
    updateHourlyRefreshLifecycle({ immediate: route === '#dashboard' });
}
