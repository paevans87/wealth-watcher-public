/**
 * API façade for catalogue mutations. Rendering and editor state can evolve
 * independently from endpoint paths and HTTP payload conventions.
 */
export function createAssetCatalogApi(request) {
    const call = request || (async () => { throw new Error('Catalogue API is unavailable.'); });
    return {
        createAsset(payload) {
            return call('/assets', { method: 'POST', body: JSON.stringify(payload) });
        },
        updateAsset(id, payload, { create = false } = {}) {
            return call(create ? '/assets' : `/assets/${encodeURIComponent(id)}`, {
                method: create ? 'POST' : 'PATCH',
                body: JSON.stringify(payload)
            });
        },
        moveAsset(id, payload) {
            return call(`/assets/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
        },
        archiveAsset(id) {
            return call(`/assets/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ Archived: true })
            });
        },
        createClassification(groupKey, payload) {
            return call(`/classification-groups/${encodeURIComponent(groupKey)}/values`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        },
        updateClassification(id, payload) {
            return call(`/classification-values/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
        },
        archiveClassification(id) {
            return call(`/classification-values/${encodeURIComponent(id)}`, { method: 'DELETE' });
        }
    };
}
