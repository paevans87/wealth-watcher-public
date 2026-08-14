import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const demoMode = env.VITE_DEMO_MODE === 'true';

    return {
        plugins: [{
            name: 'wealth-watcher-demo-mode-markup',
            transformIndexHtml(html) {
                return html.replace('data-demo-mode="false"', `data-demo-mode="${demoMode}"`);
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
