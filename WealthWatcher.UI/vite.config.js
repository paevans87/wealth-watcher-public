import { defineConfig } from 'vite';

export default defineConfig({
    // Relative asset URLs let the demo run beneath /demo/ on both repository
    // Pages URLs and custom domains. Normal builds remain root-relative.
    base: process.env.VITE_BASE_PATH || '/',
    server: {
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5200',
                changeOrigin: true
            }
        }
    }
});
