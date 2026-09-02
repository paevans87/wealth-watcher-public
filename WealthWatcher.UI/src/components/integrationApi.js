/**
 * Endpoint façade for integration setup. The wizard remains responsible for
 * user flow and rendering; this module owns the provider-facing routes.
 */
export function createIntegrationApi(request) {
    const call = request || (async () => { throw new Error('Integration API is unavailable.'); });
    return {
        catalog: () => call('/integrations/catalog'),
        connections: () => call('/integrations'),
        webhookRelayStatus: () => call('/integrations/webhook-relay/status'),
        updateWebhookRelaySettings: body => call('/integrations/webhook-relay/settings', { method: 'PUT', body: JSON.stringify(body) }),
        webhookRelayTest: () => call('/integrations/webhook-relay/test', { method: 'POST' }),
        assets: () => call('/assets'),
        settings: () => call('/integrations/settings'),
        enable: providerKey => call(`/integrations/${encodeURIComponent(providerKey)}`, { method: 'POST', body: '{}' }),
        update: (id, body) => call(`/integrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
        remove: id => call(`/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        credentials: (id, body) => call(`/integrations/${encodeURIComponent(id)}/credentials`, { method: 'PUT', body: JSON.stringify(body) }),
        test: id => call(`/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' }),
        discover: id => call(`/integrations/${encodeURIComponent(id)}/accounts/discover`, { method: 'POST' }),
        allocation: (connectionId, accountId, body) => call(
            `/integrations/${encodeURIComponent(connectionId)}/accounts/${encodeURIComponent(accountId)}/allocation`,
            { method: 'PUT', body: JSON.stringify(body) }
        ),
        saveSettings: body => call('/integrations/settings', { method: 'PUT', body: JSON.stringify(body) })
    };
}
