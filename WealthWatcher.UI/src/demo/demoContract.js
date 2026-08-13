/**
 * The endpoint surface the browser UI currently consumes. Keeping this list
 * next to the demo adapter makes API-backed feature work explicit: a new
 * request must add a contract case and corresponding demo behaviour.
 */
export const DEMO_API_CONTRACT = Object.freeze([
    { method: 'GET', path: '/api/settings' },
    { method: 'GET', path: '/api/classification-groups' },
    { method: 'GET', path: '/api/categories' },
    { method: 'GET', path: '/api/assets' },
    { method: 'GET', path: '/api/wealth/investments/names' },
    { method: 'GET', path: '/api/dashboard?period=1M' },
    { method: 'GET', path: '/api/history?period=1M' },
    { method: 'GET', path: '/api/calendar?year=2026&month=8' },
    { method: 'GET', path: '/api/audits?page=1&pageSize=10' },
    { method: 'GET', path: '/api/integrations/catalog' },
    { method: 'GET', path: '/api/integrations' },
    { method: 'GET', path: '/api/integrations/settings' },
    { method: 'GET', path: '/api/wealth/investments/aggregate' },
    { method: 'GET', path: '/api/wealth/current-observations' },
    { method: 'POST', path: '/api/settings', body: { wealthWatcherGeneralSettings: JSON.stringify({ showSparklines: true }) } },
    { method: 'POST', path: '/api/sync' },
    { method: 'POST', path: '/api/wealth', body: { Type: 'cash', AssetId: 'asset-cash', Name: 'Emergency Cash', Value: 32000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/properties', body: { Name: 'Demo Rental', Value: 275000, Mortgage: 160000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/properties/asset-home/entries', body: { Value: 356000, Mortgage: 174000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/assets', body: { DisplayName: 'Demo ISA', AssetKindId: 'kind-investments' } },
    { method: 'POST', path: '/api/classification-groups/asset-kind/values', body: { DisplayName: 'Demo asset kind', Key: 'demo-asset-kind' } },
    { method: 'POST', path: '/api/wealth/forecast', body: { target: 1200000, annualReturn: 4, monthlyContribution: 1500, includedAssets: ['investments', 'pensions', 'property'] } },
    { method: 'PATCH', path: '/api/assets/asset-isa', body: { DisplayName: 'Demo ISA renamed' } },
    { method: 'PATCH', path: '/api/classification-values/kind-cash', body: { DisplayName: 'Cash accounts' } },
    { method: 'PATCH', path: '/api/properties/asset-home', body: { Archived: false } },
    { method: 'PUT', path: '/api/integrations/settings', body: { Days: [] } }
]);
