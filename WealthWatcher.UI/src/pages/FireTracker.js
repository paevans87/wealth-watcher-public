import { store } from '../store/store.js';
import { formatter } from '../utils/formatters.js';
import { PAGE_STATUS, setPageStatus } from '../components/PageState.js';
import {
    calculateFireSummary
} from '../components/FireModel.js';

export { getCurrentWindfallsAmount } from '../components/FireModel.js';

export function renderFireView() {
    const targetIncomeInput = document.getElementById('fire-setting-income');
    const swrInput = document.getElementById('fire-setting-swr');
    const includeStatePensionCb = document.getElementById('fire-setting-include-state-pension');
    const statePensionAmountInput = document.getElementById('fire-setting-state-pension');
    
    const s = store.state.fireSettings || {};
    const fireSummary = calculateFireSummary({
        categories: store.state.categories || {},
        fire: s,
        categoryDefinitions: Array.isArray(store.state.CATEGORIES) ? store.state.CATEGORIES : []
    });
    const targetIncome = fireSummary.targetIncome;
    const swr = fireSummary.swr;
    const includeStatePension = fireSummary.includeStatePension;
    const statePensionAmount = fireSummary.statePensionAmount;

    const includedAssets = new Set(fireSummary.includedAssets);
    
    if (targetIncomeInput) targetIncomeInput.value = targetIncome.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (swrInput) swrInput.value = swr;
    if (includeStatePensionCb) includeStatePensionCb.checked = includeStatePension;
    if (statePensionAmountInput) statePensionAmountInput.value = statePensionAmount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    // Check checkboxes based on includedAssets
    document.querySelectorAll('input[name="fire-assets"]').forEach(cb => {
        cb.checked = includedAssets.has(String(cb.value).trim().toLowerCase());
    });
    
    // Calculations
    const hasTrackingData = fireSummary.hasTrackingData;
    if (hasTrackingData) {
        setPageStatus('fire-view', PAGE_STATUS.READY);
        showTrackerReadyState();
    } else {
        setPageStatus('fire-view', PAGE_STATUS.EMPTY);
        clearTrackerReadyState();
        renderTrackerEmptyState();
        return;
    }

    // A zero/negative withdrawal rate is invalid for the FIRE calculation. Keep
    // the configured value visible and avoid replacing it with the default or
    // rendering an infinite target for malformed persisted settings.
    const targetNumber = fireSummary.target;
    const investableAssets = fireSummary.investableAssets;
    const currentPassiveIncome = fireSummary.currentPassiveIncome;
    const remaining = fireSummary.remaining;
    const completion = fireSummary.completion;
    
    // UI Updates
    const targetDisplay = document.getElementById('fire-target-display');
    if (targetDisplay) targetDisplay.innerText = formatter.format(targetNumber);

    const currentAssetsEl = document.getElementById('fire-current-assets');
    if (currentAssetsEl) currentAssetsEl.innerText = formatter.format(investableAssets);

    const remainingEl = document.getElementById('fire-remaining');
    if (remainingEl) remainingEl.innerText = formatter.format(remaining);

    const percentEl = document.getElementById('fire-percent');
    if (percentEl) percentEl.innerText = completion.toFixed(2) + '%';
    
    const swrDisplayEl = document.getElementById('fire-swr-display');
    if (swrDisplayEl) swrDisplayEl.innerText = swr.toFixed(1) + '%';

    const targetIncomeEl = document.getElementById('fire-target-income');
    if (targetIncomeEl) targetIncomeEl.innerText = formatter.format(targetIncome);
    
    let displayedIncome = currentPassiveIncome;
    let incomeDesc = "If you retired today using your current investable assets.";
    if (includeStatePension) {
        displayedIncome += (statePensionAmount / 12);
        incomeDesc = "Portfolio income + State Pension.";
    }
    
    const currentIncomeEl = document.getElementById('fire-current-income');
    if (currentIncomeEl) currentIncomeEl.innerText = formatter.format(displayedIncome);
    
    const descEl = document.getElementById('fire-current-income-desc');
    if (descEl) descEl.innerText = incomeDesc;
    
    // Progress Bar
    const fill = document.getElementById('fire-progress-fill');
    if (fill) fill.style.width = completion + '%';
    
    // Handle Obfuscation state
    if (window.isObfuscated) {
        document.querySelectorAll('#fire-view .obfuscate-val').forEach(el => el.classList.add('obfuscated'));
    } else {
        document.querySelectorAll('#fire-view .obfuscate-val').forEach(el => el.classList.remove('obfuscated'));
    }
}

function showTrackerReadyState() {
    const view = document.getElementById('fire-view');
    if (!view) return;

    const trackerHeader = typeof view.querySelector === 'function'
        ? view.querySelector('header')
        : null;
    const trackerDashboard = typeof view.querySelector === 'function'
        ? view.querySelector('.fire-dashboard')
        : null;

    if (trackerHeader) trackerHeader.hidden = false;
    if (trackerDashboard) trackerDashboard.hidden = false;

    const emptyState = document.getElementById('fire-empty-state');
    if (emptyState) emptyState.hidden = true;
}

function clearTrackerReadyState() {
    const view = document.getElementById('fire-view');
    if (!view) return;

    const trackerHeader = typeof view.querySelector === 'function'
        ? view.querySelector('header')
        : null;
    const trackerDashboard = typeof view.querySelector === 'function'
        ? view.querySelector('.fire-dashboard')
        : null;
    if (trackerHeader) trackerHeader.hidden = true;
    if (trackerDashboard) trackerDashboard.hidden = true;

    ['fire-target-display', 'fire-current-assets', 'fire-remaining', 'fire-percent',
        'fire-swr-display', 'fire-target-income', 'fire-current-income', 'fire-current-income-desc']
        .forEach(id => {
            const element = document.getElementById(id);
            if (element) element.innerText = '';
        });
    const progressFill = document.getElementById('fire-progress-fill');
    if (progressFill?.style) progressFill.style.width = '0%';
}

function renderTrackerEmptyState() {
    const view = document.getElementById('fire-view');
    if (!view) return;

    if (typeof document.createElement !== 'function') return;

    let emptyState = document.getElementById('fire-empty-state');
    if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'fire-empty-state';
        emptyState.className = 'catalog-workspace presentation-empty-state fire-empty-state';
        emptyState.setAttribute?.('role', 'status');
        emptyState.innerHTML = `
            <div class="presentation-empty-state-layout">
                <div class="presentation-empty-copy">
                    <span class="presentation-empty-kicker">FIRE tracker</span>
                    <h2>Turn progress into momentum.</h2>
                    <p>No tracking data yet. See how close your current portfolio is to your FIRE target, with the assets and windfalls you choose to include.</p>
                    <p class="presentation-empty-note">Add portfolio data and choose the assets to include in Settings to replace this illustrative example with your live progress.</p>
                    <a class="action-btn" href="#settings?panel=fire-settings&focus=fire-tracker-settings" aria-controls="fire-settings-pane">Open FIRE Settings</a>
                </div>
                <div class="presentation-preview tracker-preview" role="img" aria-label="Illustrative example of a configured FIRE tracker">
                    <div class="presentation-preview-header">
                        <div>
                            <span class="presentation-preview-label">Illustrative example</span>
                            <strong>FIRE progress</strong>
                        </div>
                        <span class="presentation-preview-status">Illustrative projection</span>
                    </div>
                    <div class="tracker-preview-main">
                        <div class="tracker-preview-ring" aria-hidden="true"><div><strong>68%</strong><span>complete</span></div></div>
                        <div class="tracker-preview-copy"><span>Investable assets</span><strong>£634,280</strong><small>of £934,325 target</small><div class="tracker-preview-bar"><i></i></div></div>
                    </div>
                    <div class="tracker-preview-stats">
                        <div><span>Remaining</span><strong>£300,045</strong></div>
                        <div><span>Est. income</span><strong>£2,114/mo</strong></div>
                        <div><span>Target date</span><strong>Jun 2042</strong></div>
                    </div>
                </div>
            </div>`;
        if (typeof view.prepend === 'function') view.prepend(emptyState);
        else if (typeof view.insertBefore === 'function') view.insertBefore(emptyState, view.firstChild || null);
        else view.appendChild(emptyState);
    }

    emptyState.hidden = false;
}
