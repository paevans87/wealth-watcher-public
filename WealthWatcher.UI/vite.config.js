import { defineConfig, loadEnv } from 'vite';

const demoMetadata = `
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="WealthWatcher">
    <meta property="og:title" content="WealthWatcher live demo - explore the dashboard">
    <meta property="og:description" content="Explore WealthWatcher with fictional data in your browser. No API, database, account, or provider connection required.">
    <meta property="og:url" content="https://wealthwatcher.co.uk/demo/">
    <meta property="og:image" content="https://wealthwatcher.co.uk/og-image.svg">
    <meta property="og:image:alt" content="WealthWatcher dashboard preview with net worth and asset cards">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="WealthWatcher live demo - explore the dashboard">
    <meta name="twitter:description" content="Explore WealthWatcher with fictional data in your browser. No API, database, account, or provider connection required.">
    <meta name="twitter:image" content="https://wealthwatcher.co.uk/og-image.svg">
    <link rel="canonical" href="https://wealthwatcher.co.uk/">`;

const demoAnalytics = `
    <script src="../clarity-config.js"></script>
    <script src="../ga4-config.js"></script>
    <script src="../analytics.js" defer></script>`;

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const demoMode = env.VITE_DEMO_MODE === 'true';
    const demoDescription = 'Explore WealthWatcher with fictional data in your browser. No API, database, account, or provider connection required.';
    const privateDescription = 'Private WealthWatcher dashboard for tracking wealth, budgets, forecasts, and financial independence.';

    return {
        plugins: [{
            name: 'wealth-watcher-demo-mode-markup',
            transformIndexHtml(html) {
                const demoMarkup = demoMode ? demoMetadata : '';
                return html
                    .replace('data-demo-mode="false"', `data-demo-mode="${demoMode}"`)
                    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${demoMode ? demoDescription : privateDescription}">`)
                    .replace(/<meta name="robots"[^>]*>/, `<meta name="robots" content="${demoMode ? 'noindex, follow' : 'noindex, nofollow'}">`)
                    .replace(/<title>[^<]*<\/title>/, demoMode ? '<title>WealthWatcher live demo - explore the dashboard</title>' : '<title>WealthWatcher dashboard</title>')
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
