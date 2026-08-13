import { apiRequest, API_BASE_URL } from '../api/apiClient.js';
import { store } from '../store/store.js';
import { requestNotification } from './ConfirmationModal.js';
import { showToast } from './Toast.js';

const formState = {
    mode: 'generic',
    propertyId: null
};

let refreshDashboard = async () => {};
let isInitialized = false;
let pendingArchive = null;

function propertyValue(property, name, fallback = '') {
    return property?.[name] ?? fallback;
}

export function getPropertyFormState() {
    return { ...formState };
}

export function resetPropertyFormState() {
    formState.mode = 'generic';
    formState.propertyId = null;

    const title = document.getElementById('entry-modal-title');
    if (title) title.innerText = 'Add Wealth Entry';

    const submitButton = document.getElementById('entry-submit-btn');
    if (submitButton) submitButton.innerText = 'Save Entry';

    const nameInput = document.getElementById('entry-name');
    if (nameInput) nameInput.readOnly = false;
}

export function openPropertyEntry(property = null) {
    if (window.openModal) {
        window.openModal('entry-modal');
    } else {
        document.getElementById('entry-modal')?.classList.add('active');
    }

    formState.mode = property ? 'entry' : 'add';
    formState.propertyId = property ? propertyValue(property, 'Id', null) : null;

    document.getElementById('entry-category').value = 'property';
    document.getElementById('entry-name').readOnly = Boolean(property);
    document.getElementById('entry-name').value = propertyValue(property, 'Name');
    document.getElementById('entry-value').value = propertyValue(property, 'Value');
    document.getElementById('entry-mortgage').value = propertyValue(property, 'Mortgage', 0);
    document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('mortgage-group').style.display = 'block';
    window.currentCategoryNames = [];

    const title = document.getElementById('entry-modal-title');
    if (title) title.innerText = property ? `Add Property Entry` : 'Add Property';

    const submitButton = document.getElementById('entry-submit-btn');
    if (submitButton) submitButton.innerText = property ? 'Add Entry' : 'Add Property';
}

function requestArchiveProperty(id, name) {
    if (!id) return;

    pendingArchive = { id, name };
    const nameElement = document.getElementById('property-delete-name');
    if (nameElement) nameElement.textContent = name || 'this property';

    const dialog = document.getElementById('property-delete-modal');
    if (!dialog) {
        pendingArchive = null;
        console.error('Property removal dialog is not available.');
        return;
    }

    if (window.openModal) {
        window.openModal('property-delete-modal');
    } else {
        dialog.classList.add('active');
    }
}

function cancelPropertyRemoval() {
    pendingArchive = null;
    window.closeModal?.('property-delete-modal');
}

async function confirmPropertyRemoval() {
    const property = pendingArchive;
    cancelPropertyRemoval();
    if (!property) return;

    try {
        const response = await apiRequest(`${API_BASE_URL}/properties/${encodeURIComponent(property.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Archived: true })
        });

        if (!response.ok) {
            await requestNotification({
                title: 'Unable to remove property',
                message: 'The property could not be removed.'
            });
            return;
        }

        store.clearCache();
        await refreshDashboard({ force: true });
        showToast({
            title: 'Property archived',
            message: `${property.name || 'The property'} was archived successfully.`,
            type: 'success',
            key: 'property-archive'
        });
    } catch (error) {
        console.error(error);
        await requestNotification({
            title: 'Unable to remove property',
            message: error.message || 'There was a problem communicating with the API.'
        });
    }
}

export function setupPropertyPanel(options = {}) {
    if (options.refresh) refreshDashboard = options.refresh;
    if (isInitialized) return;
    isInitialized = true;

    window.openPropertyEntry = openPropertyEntry;
    window.resetPropertyFormState = resetPropertyFormState;
    window.cancelPropertyRemoval = cancelPropertyRemoval;
    window.removeProperty = requestArchiveProperty;

    document.getElementById('property-delete-confirm')?.addEventListener('click', confirmPropertyRemoval);
    document.getElementById('property-delete-cancel')?.addEventListener('click', cancelPropertyRemoval);
    document.getElementById('property-delete-close')?.addEventListener('click', cancelPropertyRemoval);

    document.addEventListener('click', (event) => {
        const action = event.target?.closest?.('[data-property-action]');
        if (!action) return;

        event.preventDefault();
        const actionName = action.dataset.propertyAction;
        if (actionName === 'add') {
            openPropertyEntry();
            return;
        }

        const property = {
            Id: action.dataset.propertyId,
            Name: action.dataset.propertyName,
            Value: Number(action.dataset.propertyValue),
            Mortgage: Number(action.dataset.propertyMortgage)
        };

        if (actionName === 'entry') {
            openPropertyEntry(property);
        } else if (actionName === 'remove') {
            requestArchiveProperty(property.Id, property.Name);
        }
    });
}
