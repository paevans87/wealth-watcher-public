import { defineConfig } from 'vite';

export default defineConfig({
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
