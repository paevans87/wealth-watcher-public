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
    { method: 'GET', path: '/api/integrations/webhook-relay/status' },
    { method: 'PUT', path: '/api/integrations/webhook-relay/settings', body: { Enabled: false } },
    { method: 'POST', path: '/api/integrations/webhook-relay/test' },
    { method: 'GET', path: '/api/integrations/settings' },
    { method: 'GET', path: '/api/wealth/investments/aggregate' },
    { method: 'GET', path: '/api/wealth/current-observations' },
    { method: 'POST', path: '/api/settings', body: { wealthWatcherGeneralSettings: JSON.stringify({ showSparklines: true }) } },
    { method: 'POST', path: '/api/settings', body: { wealthWatcherMilestoneSettings: JSON.stringify({ targets: [500000, 600000] }) } },
    { method: 'POST', path: '/api/sync' },
    { method: 'POST', path: '/api/wealth', body: { Type: 'cash', AssetId: 'asset-cash', Name: 'Emergency Cash', Value: 32000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/properties', body: { Name: 'Demo Rental', Value: 275000, Mortgage: 160000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/properties/asset-home/entries', body: { Value: 356000, Mortgage: 174000, Date: '2026-08-13', Time: '12:00:00' } },
    { method: 'POST', path: '/api/assets', body: { DisplayName: 'Demo ISA', AssetKindId: 'kind-investments' } },
    { method: 'POST', path: '/api/classification-groups/asset-kind/values', body: { DisplayName: 'Demo asset kind', Key: 'demo-asset-kind' } },
    { method: 'POST', path: '/api/settings', body: { wealthWatcherFeatureSettings: JSON.stringify({ fire: true, tracker: true, forecast: true, budget: true, milestones: false }) } },
    {
        method: 'POST',
        path: '/api/settings',
        body: {
            wealthWatcherBudgetSettings: JSON.stringify({
                version: 2,
                needsUpdate: false,
                groups: [
                    {
                        id: 'income',
                        name: 'Income',
                        kind: 'income',
                        role: 'income',
                        builtIn: true,
                        items: [{ id: 'contract-income', name: 'Salary', amount: 6000, cadence: 'monthly', assetId: null, category: 'Employment' }]
                    },
                    {
                        id: 'bills',
                        name: 'Bills',
                        kind: 'custom',
                        role: 'bills',
                        builtIn: false,
                        items: [{ id: 'contract-bill', name: 'Annual insurance', amount: 1200, cadence: 'annually', assetId: null, category: 'Protection' }]
                    },
                    {
                        id: 'savings',
                        name: 'Savings',
                        kind: 'custom',
                        role: 'savings',
                        builtIn: false,
                        items: [
                            { id: 'contract-linked-saving', name: 'ISA contribution', amount: 500, cadence: 'monthly', assetId: 'asset-isa', category: 'Investing' },
                            { id: 'contract-unlinked-saving', name: 'Rainy day fund', amount: 250, cadence: 'quarterly', assetId: null, category: 'Safety net' }
                        ]
                    },
                    {
                        id: 'spend',
                        name: 'Spend',
                        kind: 'custom',
                        role: 'spend',
                        builtIn: false,
                        items: [{ id: 'contract-spend', name: 'Groceries', amount: 450, cadence: 'monthly', assetId: null, category: 'Food & household' }]
                    }
                ]
            })
        }
    },
    {
        method: 'POST',
        path: '/api/settings',
        body: {
            wealthWatcherBudgetSettings: JSON.stringify({
                income: [{ id: 'legacy-contract-income', name: 'Legacy salary', amount: 6000 }],
                bills: [{ id: 'legacy-contract-bill', name: 'Legacy insurance', amount: 1200 }],
                savings: [],
                spend: []
            })
        }
    },
    { method: 'POST', path: '/api/wealth/forecast', body: {
        target: 1200000,
        annualReturn: 4,
        monthlyContribution: 0,
        contributions: [
            { name: 'Emergency fund', amount: 450, assetId: 'asset-cash', cadence: 'monthly' },
            { name: 'Index fund contribution', amount: 1500, assetId: 'asset-isa', cadence: 'monthly' }
        ],
        forecastStrategy: 'fire-default',
        windfalls: [],
        includedAssets: ['investments', 'pensions', 'property']
    } },
    { method: 'PATCH', path: '/api/assets/asset-isa', body: { DisplayName: 'Demo ISA renamed' } },
    { method: 'PATCH', path: '/api/classification-values/kind-cash', body: { DisplayName: 'Cash accounts' } },
    { method: 'PATCH', path: '/api/properties/asset-home', body: { Archived: false } },
    { method: 'PUT', path: '/api/integrations/settings', body: { Days: [] } }
]);
