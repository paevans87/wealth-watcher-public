import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const demoMetadata = `
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Wealth Watcher">
    <meta property="og:title" content="Wealth Watcher live demo - explore the dashboard">
    <meta property="og:description" content="Explore Wealth Watcher with fictional data in your browser. No API, database, account, or provider connection required.">
    <meta property="og:url" content="https://wealthwatcher.co.uk/demo/">
    <meta property="og:image" content="https://wealthwatcher.co.uk/og-image.svg">
    <meta property="og:image:alt" content="Wealth Watcher dashboard preview with net worth and asset cards">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Wealth Watcher live demo - explore the dashboard">
    <meta name="twitter:description" content="Explore Wealth Watcher with fictional data in your browser. No API, database, account, or provider connection required.">
    <meta name="twitter:image" content="https://wealthwatcher.co.uk/og-image.svg">
    <link rel="canonical" href="https://wealthwatcher.co.uk/">`;

const demoAnalytics = `
    <script src="../clarity-config.js?demo=1"></script>
    <script src="../ga4-config.js?demo=1"></script>
    <script src="../analytics.js?demo=1" defer></script>`;

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const demoMode = env.VITE_DEMO_MODE === 'true';
    const demoDescription = 'Explore Wealth Watcher with fictional data in your browser. No API, database, account, or provider connection required.';
    const privateDescription = 'Private Wealth Watcher dashboard for tracking wealth, budgets, forecasts, and financial independence.';

    return {
        // Keep normal and demo dev servers isolated when they run side by side
        // during manual verification.
        cacheDir: demoMode ? 'node_modules/.vite-demo' : 'node_modules/.vite',
        plugins: [{
            name: 'wealth-watcher-demo-mode-markup',
            configureServer(server) {
                if (!demoMode) return;

                const publicSiteRoot = resolve(process.cwd(), '..', 'github_pages');
                const publicSiteScripts = new Map([
                    ['/clarity-config.js', 'clarity-config.js'],
                    ['/ga4-config.js', 'ga4-config.js'],
                    ['/analytics.js', 'analytics.js']
                ]);

                server.middlewares.use((request, response, next) => {
                    const requestPath = (request.url || '').split('?')[0];
                    const scriptName = publicSiteScripts.get(requestPath);
                    if (!scriptName) {
                        next();
                        return;
                    }

                    readFile(resolve(publicSiteRoot, scriptName))
                        .then(contents => {
                            response.statusCode = 200;
                            response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                            response.end(contents);
                        })
                        .catch(next);
                });
            },
            transformIndexHtml(html) {
                const demoMarkup = demoMode ? demoMetadata : '';
                return html
                    .replace('data-demo-mode="false"', `data-demo-mode="${demoMode}"`)
                    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${demoMode ? demoDescription : privateDescription}">`)
                    .replace(/<meta name="robots"[^>]*>/, `<meta name="robots" content="${demoMode ? 'noindex, follow' : 'noindex, nofollow'}">`)
                    .replace(/<title>[^<]*<\/title>/, demoMode ? '<title>Wealth Watcher live demo - explore the dashboard</title>' : '<title>Wealth Watcher dashboard</title>')
                    .replace('<!-- VITE_DEMO_METADATA -->', demoMarkup)
                    .replace('<!-- VITE_DEMO_ANALYTICS -->', demoMode ? demoAnalytics : '');
            }
        }],
        // Relative asset URLs let the demo run beneath /demo/ on both repository
        // Pages URLs and custom domains. Normal builds remain root-relative.
        base: env.VITE_BASE_PATH || '/',
        server: {
            host: '0.0.0.0',
            proxy: {
                '/api': {
                    target: env.VITE_API_PROXY_TARGET || 'http://localhost:5200',
                    changeOrigin: true
                }
            }
        }
    };
});
